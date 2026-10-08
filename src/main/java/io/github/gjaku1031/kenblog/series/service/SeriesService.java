package io.github.gjaku1031.kenblog.series.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.global.text.Text;
import io.github.gjaku1031.kenblog.post.domain.*;
import io.github.gjaku1031.kenblog.post.dto.PostSeriesItem;
import io.github.gjaku1031.kenblog.post.repository.*;
import io.github.gjaku1031.kenblog.series.domain.*;
import io.github.gjaku1031.kenblog.series.dto.*;
import io.github.gjaku1031.kenblog.series.repository.SeriesRepository;
import io.github.gjaku1031.kenblog.stack.service.StackBadgeService;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 시리즈 메타데이터 저장과 첫 공개 글 대문 계산
 */
@Service
@RequiredArgsConstructor
public class SeriesService {
    /**
     * 시리즈 저장소
     */
    private final SeriesRepository series;

    /**
     * 게시글 메타데이터 조회기
     */
    private final PostQueries queries;

    /**
     * 기술 뱃지 서비스
     */
    private final StackBadgeService badges;

    /**
     * 초안·관련 글 삭제 제약 조회
     */
    private final PostRepository posts;

    /**
     * 저장 순서에 따른 관리자 시리즈 목록
     */
    @Transactional(readOnly = true)
    public List<SeriesResponse> list() {
        return series.findAll().stream()
                .sorted(
                        Comparator.comparingLong(SeriesEntity::getSortOrder)
                                .thenComparing(SeriesEntity::getId))
                .map(this::response)
                .toList();
    }

    /**
     * 공개 스냅샷 행을 재사용하여 시리즈·뱃지 N+1 조회 제거
     */
    public List<SeriesResponse> publicSnapshot(List<PostRow> rows) {
        var groups =
                rows.stream()
                        .sorted(
                                Comparator.comparing(
                                                PostRow::seriesOrder,
                                                Comparator.nullsLast(Comparator.naturalOrder()))
                                        .thenComparing(
                                                PostRow::publishedAt,
                                                Comparator.nullsLast(Comparator.naturalOrder()))
                                        .thenComparingLong(PostRow::id))
                        .filter(row -> row.series() != null)
                        .collect(Collectors.groupingBy(row -> row.series().id()));
        var stacks = badges.batchForSeries();
        return series.findAll().stream()
                .filter(entity -> groups.containsKey(entity.getId()))
                .sorted(
                        Comparator.comparingLong(SeriesEntity::getSortOrder)
                                .thenComparing(SeriesEntity::getId))
                .map(
                        entity -> {
                            long id =
                                    Objects.requireNonNull(
                                            entity.getId(), "Persisted series has no ID");
                            var siblings = groups.get(id);
                            var cover = siblings.getFirst();
                            return new SeriesResponse(
                                    id,
                                    entity.getSlug(),
                                    entity.getName(),
                                    entity.getKind(),
                                    entity.getDescription(),
                                    entity.getProjectStatus(),
                                    entity.getStartPeriod(),
                                    entity.getEndPeriod(),
                                    entity.getSortOrder(),
                                    entity.getUpdatedAt(),
                                    new PostSeriesItem(cover.id(), cover.slug(), cover.title(), 1),
                                    siblings.size(),
                                    entity.getKind() == SeriesKind.PROJECT
                                            ? stacks.getOrDefault(id, List.of())
                                            : List.of());
                        })
                .toList();
    }

    /**
     * 관리자 시리즈 상세와 초안 포함 문서 목록
     */
    @Transactional(readOnly = true)
    public SeriesDetailResponse detail(long id) {
        var entity = series.findById(id).orElseThrow(SeriesNotFoundException::new);
        return new SeriesDetailResponse(
                response(entity),
                queries.seriesPosts(id, false).stream()
                        .map(
                                row ->
                                        new SeriesPostResponse(
                                                row.id(),
                                                row.title(),
                                                row.slug(),
                                                row.seriesOrder(),
                                                row.status() == PostStatus.PUBLISHED))
                        .toList());
    }

    /**
     * 주소·메타데이터 검증 후 시리즈와 프로젝트 기술 선택을 함께 저장
     */
    @Transactional
    public SeriesResponse create(SeriesCreateRequest input) {
        String prefix = input.kind() == SeriesKind.PROJECT ? "project" : "series";
        String slug =
                Text.trim(input.slug() == null ? prefix + "-" + UUID.randomUUID() : input.slug())
                        .toLowerCase(Locale.ROOT);
        if (slug.length() > 160
                || !slug.matches("[a-z0-9]+(?:-[a-z0-9]+)*")
                || input.metadata().baseUpdatedAt() != null)
            throw new InvalidSeriesRequestException();
        var value = SeriesRequests.validate(input.kind(), input.metadata());
        SeriesEntity entity;
        try {
            entity =
                    series.saveAndFlush(
                            new SeriesEntity(
                                    slug,
                                    input.kind(),
                                    value.name(),
                                    value.description(),
                                    value.projectStatus(),
                                    value.startPeriod(),
                                    value.endPeriod(),
                                    now()));
        } catch (DataIntegrityViolationException exception) {
            throw new SeriesConflictException();
        }
        // 기술 선택 실패도 시리즈 생성과 함께 롤백
        if (entity.getKind() == SeriesKind.PROJECT)
            badges.replaceSeriesStack(
                    Objects.requireNonNull(entity.getId()), value.stackBadgeNames());
        return response(entity);
    }

    /**
     * 잠금 안에서 수정 시각 대조 후 속성과 프로젝트 기술 선택 교체
     */
    @Transactional
    public SeriesResponse update(long id, SeriesMetadataRequest input) {
        var entity = series.findLockedById(id);
        if (entity == null) throw new SeriesNotFoundException();
        if (input.baseUpdatedAt() == null || !input.baseUpdatedAt().equals(entity.getUpdatedAt()))
            throw new SeriesConflictException();
        var value = SeriesRequests.validate(entity.getKind(), input);
        entity.replace(
                value.name(),
                value.description(),
                value.projectStatus(),
                value.startPeriod(),
                value.endPeriod(),
                now());
        series.saveAndFlush(entity);
        if (entity.getKind() == SeriesKind.PROJECT)
            badges.replaceSeriesStack(id, value.stackBadgeNames());
        return response(entity);
    }

    /**
     * 시리즈 표시 순서 저장
     */
    @Transactional
    public SeriesResponse setOrder(long id, long order) {
        if (order < Integer.MIN_VALUE || order > Integer.MAX_VALUE)
            throw new InvalidSeriesRequestException();
        var entity = series.findLockedById(id);
        if (entity == null) throw new SeriesNotFoundException();
        entity.reorder(order);
        series.saveAndFlush(entity);
        return response(entity);
    }

    /**
     * 부모 잠금 후 초안 포함 모든 소속·관련 글이 없는 시리즈만 삭제
     */
    @Transactional
    public void delete(long id) {
        if (id <= 0) throw new InvalidSeriesRequestException();
        var entity = series.findLockedById(id);
        if (entity == null) throw new SeriesNotFoundException();
        if (posts.existsBySeriesIdOrRelatedSeriesId(id, id)) throw new SeriesInUseException();
        series.delete(entity);
        series.flush();
    }

    /**
     * 속성·첫 공개 문서·기술 뱃지를 응답에 결합
     */
    private SeriesResponse response(SeriesEntity entity) {
        long id = Objects.requireNonNull(entity.getId());
        var publicPosts = queries.seriesPosts(id, true);
        var first = publicPosts.isEmpty() ? null : publicPosts.getFirst();
        return new SeriesResponse(
                id,
                entity.getSlug(),
                entity.getName(),
                entity.getKind(),
                entity.getDescription(),
                entity.getProjectStatus(),
                entity.getStartPeriod(),
                entity.getEndPeriod(),
                entity.getSortOrder(),
                entity.getUpdatedAt(),
                first == null
                        ? null
                        : new PostSeriesItem(first.id(), first.slug(), first.title(), 1),
                queries.seriesPosts(id, false).size(),
                entity.getKind() == SeriesKind.PROJECT ? badges.listForSeries(id) : List.of());
    }

    /**
     * 마이크로초 정밀도의 현재 UTC 시각
     */
    private LocalDateTime now() {
        return LocalDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.MICROS);
    }
}
