package io.github.gjaku1031.kenblog.post.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.category.repository.CategoryRepository;
import io.github.gjaku1031.kenblog.global.text.Text;
import io.github.gjaku1031.kenblog.post.domain.*;
import io.github.gjaku1031.kenblog.post.dto.*;
import io.github.gjaku1031.kenblog.post.repository.*;
import io.github.gjaku1031.kenblog.series.domain.SeriesKind;
import io.github.gjaku1031.kenblog.series.repository.SeriesRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.*;
import java.util.*;
import java.util.stream.IntStream;

/**
 * Pages용 공개 글 메타데이터와 시리즈·분류 내 문서 탐색
 */
@Service
@RequiredArgsConstructor
public class PublicPostService {
    /**
     * 게시글 메타데이터 조회기
     */
    private final PostQueries queries;

    /**
     * 분류 저장소
     */
    private final CategoryRepository categories;

    /**
     * 분류·태그 조회기
     */
    private final PostTaxonomyMetadata taxonomy;

    /**
     * 시리즈 저장소
     */
    private final SeriesRepository series;

    /**
     * 공개 글·분류·태그 조회 후 시리즈 우선 탐색과 공개 관련 프로젝트 결합
     */
    @Transactional(readOnly = true)
    public PublicPostDetailResponse detailMetadata(String slug) {
        var row = queries.publicBySlug(Text.trim(slug).toLowerCase(Locale.ROOT));
        if (row == null) throw new PostNotFoundException();
        var view = taxonomy.one(row.id(), row.categoryId());
        PostSeriesResponse navigation = null;
        // 시리즈가 없을 때만 소분류 탐색 사용
        if (row.series() != null) {
            var ref = row.series();
            var siblings = queries.seriesPosts(ref.id(), true);
            navigation =
                    new PostSeriesResponse(
                            ref.id(),
                            ref.slug(),
                            ref.name(),
                            ref.kind(),
                            items(siblings),
                            position(siblings, row.id()));
        } else if (row.categoryId() != null) {
            var category = categories.findById(row.categoryId()).orElse(null);
            if (category != null && category.getDepth() == 2) {
                var siblings = queries.categoryPosts(row.categoryId());
                navigation =
                        new PostSeriesResponse(
                                row.categoryId(),
                                category.getPath(),
                                category.getName(),
                                SeriesKind.TECH,
                                items(siblings),
                                position(siblings, row.id()));
            }
        }
        // 출간 문서가 있는 공개 프로젝트만 관련 시리즈로 노출
        SeriesRef related = null;
        if (row.relatedSeriesId() != null) {
            var entity = series.findById(row.relatedSeriesId()).orElse(null);
            if (entity != null
                    && entity.getKind() == SeriesKind.PROJECT
                    && entity.getVisibility() == PostVisibility.PUBLIC
                    && !queries.seriesPosts(row.relatedSeriesId(), true).isEmpty())
                related =
                        new SeriesRef(
                                Objects.requireNonNull(entity.getId()),
                                entity.getSlug(),
                                entity.getName(),
                                entity.getKind());
        }
        return response(row, view, navigation, related);
    }

    /**
     * 같은 읽기 트랜잭션의 전체 행에서 분류·태그·문서 탐색 일괄 구성
     */
    public List<PublicPostDetailResponse> batch(List<PostRow> rows) {
        var metadata =
                taxonomy.batch(
                        rows.stream().map(PostRow::id).toList(),
                        rows.stream().map(PostRow::categoryId).toList());
        var ordered =
                rows.stream()
                        .sorted(
                                Comparator.comparing(
                                                PostRow::seriesOrder,
                                                Comparator.nullsLast(Comparator.naturalOrder()))
                                        .thenComparing(
                                                PostRow::publishedAt,
                                                Comparator.nullsLast(Comparator.naturalOrder()))
                                        .thenComparingLong(PostRow::id))
                        .toList();
        var seriesGroups = new HashMap<Long, List<PostRow>>();
        var categoryGroups = new HashMap<Long, List<PostRow>>();
        for (var row : ordered) {
            if (row.series() != null)
                seriesGroups.computeIfAbsent(row.series().id(), key -> new ArrayList<>()).add(row);
            if (row.series() == null || row.series().kind() == SeriesKind.TECH)
                categoryGroups.computeIfAbsent(row.categoryId(), key -> new ArrayList<>()).add(row);
        }
        // 탐색 목록과 위치를 그룹마다 한 번씩 계산하여 이차 크기 증가 방지
        var seriesItems = new HashMap<Long, List<PostSeriesItem>>();
        var categoryItems = new HashMap<Long, List<PostSeriesItem>>();
        var positions = new HashMap<Long, Integer>();
        var categoryPositions = new HashMap<Long, Integer>();
        seriesGroups.forEach((id, siblings) -> seriesItems.put(id, items(siblings)));
        categoryGroups.forEach((id, siblings) -> categoryItems.put(id, items(siblings)));
        seriesItems
                .values()
                .forEach(group -> group.forEach(item -> positions.put(item.id(), item.order())));
        categoryItems
                .values()
                .forEach(
                        group ->
                                group.forEach(
                                        item -> categoryPositions.put(item.id(), item.order())));
        return rows.stream()
                .map(
                        row -> {
                            var view = metadata.get(row.id());
                            var category = view.category();
                            PostSeriesResponse navigation = null;
                            if (row.series() != null) {
                                var ref = row.series();
                                navigation =
                                        new PostSeriesResponse(
                                                ref.id(),
                                                ref.slug(),
                                                ref.name(),
                                                ref.kind(),
                                                seriesItems.get(ref.id()),
                                                positions.get(row.id()));
                            } else if (category != null && category.depth() == 2) {
                                navigation =
                                        new PostSeriesResponse(
                                                category.id(),
                                                category.path(),
                                                category.name(),
                                                SeriesKind.TECH,
                                                categoryItems.get(category.id()),
                                                categoryPositions.get(row.id()));
                            }
                            var siblings =
                                    row.relatedSeriesId() == null
                                            ? null
                                            : seriesGroups.get(row.relatedSeriesId());
                            var related =
                                    siblings == null || siblings.isEmpty()
                                            ? null
                                            : siblings.getFirst().series();
                            if (related != null && related.kind() != SeriesKind.PROJECT)
                                related = null;
                            return response(row, view, navigation, related);
                        })
                .toList();
    }

    /**
     * 1 기반 표시 순서로 이동 정보 구성
     */
    private List<PostSeriesItem> items(List<PostRow> rows) {
        return IntStream.range(0, rows.size())
                .mapToObj(
                        index -> {
                            var row = rows.get(index);
                            return new PostSeriesItem(row.id(), row.slug(), row.title(), index + 1);
                        })
                .toList();
    }

    /**
     * 현재 글의 1 기반 위치, 없으면 0
     */
    private int position(List<PostRow> rows, long id) {
        for (int index = 0; index < rows.size(); index++)
            if (rows.get(index).id() == id) return index + 1;
        return 0;
    }

    /**
     * UTC 출간 시각의 한국 날짜와 공개 메타데이터 응답 조립
     */
    private PublicPostDetailResponse response(
            PostRow row, PostTaxonomyView view, PostSeriesResponse navigation, SeriesRef related) {
        var date =
                Objects.requireNonNull(row.publishedAt())
                        .atZone(ZoneOffset.UTC)
                        .withZoneSameInstant(ZoneId.of("Asia/Seoul"))
                        .toLocalDate();
        return new PublicPostDetailResponse(
                row.id(),
                row.title(),
                row.slug(),
                row.summary(),
                date,
                row.series() == null ? SeriesKind.TECH : row.series().kind(),
                view.category(),
                view.tags(),
                navigation,
                related,
                row.legacyPath(),
                row.publishedAt());
    }
}
