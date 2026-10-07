package io.github.gjaku1031.kenblog.post.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.attachment.service.AttachmentLinkService;
import io.github.gjaku1031.kenblog.category.domain.CategoryNotFoundException;
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository;
import io.github.gjaku1031.kenblog.global.text.Text;
import io.github.gjaku1031.kenblog.post.domain.*;
import io.github.gjaku1031.kenblog.post.dto.*;
import io.github.gjaku1031.kenblog.post.repository.*;
import io.github.gjaku1031.kenblog.series.domain.*;
import io.github.gjaku1031.kenblog.series.repository.SeriesRepository;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.ObjectMapper;

import java.sql.SQLIntegrityConstraintViolationException;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.IntStream;
import java.util.stream.Stream;

/**
 * 게시글의 DB 메타데이터·출간 상태·첨부 및 위키 관계 관리
 */
@Service
@RequiredArgsConstructor
public class PostService {
    /**
     * 게시글 저장소
     */
    private final PostRepository repository;

    /**
     * 분류 저장소
     */
    private final CategoryRepository categories;

    /**
     * 게시글 태그 저장소
     */
    private final PostTagRepository tags;

    /**
     * 분류·태그 조회기
     */
    private final PostTaxonomyMetadata taxonomy;

    /**
     * 첨부 연결 서비스
     */
    private final AttachmentLinkService attachmentLinks;

    /**
     * 위키 선언 관리 서비스
     */
    private final WikiLinkMetadata wikiLinks;

    /**
     * 시리즈 저장소
     */
    private final SeriesRepository series;

    /**
     * 게시글 메타데이터 조회기
     */
    private final PostQueries queries;

    /**
     * 전체 메타데이터 응답 바이트 상한 검사
     */
    private final ObjectMapper mapper;

    /**
     * 주소 식별자 패턴
     */
    private static final Pattern SLUG_PATTERN = Pattern.compile("[a-z0-9]+(?:-[a-z0-9]+)*");

    /**
     * 입력 검증·글 저장·태그·첨부·위키 선언을 같은 트랜잭션에서 수행
     */
    @Transactional
    public PostDetailResponse createMetadata(PostMetadataCreateRequest request) {
        // 분류와 시리즈를 먼저 검증·잠금한 뒤 메타데이터 초기화
        String title = validTitle(request.title());
        String slug = validSlug(request.slug() == null ? "post-" + UUID.randomUUID() : request.slug());
        String summary = validSummary(request.summary());
        var normalizedTags = TagNames.displayAll(request.tags());
        if (request.categoryId() != null)
            validCategory(request.categoryId());
        if (request.order() != null
                && (request.order() <= 0
                        || request.seriesId() == null && request.categoryId() == null))
            throw new InvalidPostRequestException();
        lockSeries(request.seriesId(), request.relatedSeriesId());
        var now = now();
        var post = new PostEntity(title, slug, "", now);
        post.replaceMetadata(title, summary, now);
        post.changeCategory(request.categoryId(), now);
        post.assignSeries(request.seriesId(), request.order(), request.relatedSeriesId(), now);
        // 지정된 주소 고유 제약 충돌만 업무 오류로 변환
        PostEntity saved;
        try {
            saved = repository.saveAndFlush(post);
        } catch (DataIntegrityViolationException exception) {
            if (isDuplicateSlugConstraint(exception))
                throw new DuplicatePostSlugException(exception);
            throw exception;
        }
        // 연결 선언까지 함께 커밋하거나 전체 롤백
        long id = Objects.requireNonNull(saved.getId(), "Persisted post has no ID");
        saveTags(id, normalizedTags);
        attachmentLinks.replacePost(id, request.attachmentIds());
        wikiLinks.replacePost(id, request.wikiTargets());
        return adminDetail(saved);
    }

    /**
     * 출간 상태만 명시적으로 전환하고 편집 기준 무효화
     */
    @Transactional
    public PostDetailResponse setPublished(long id, boolean published) {
        var post = lockedPost(id);
        if (published)
            post.publish(PostVisibility.PUBLIC, now());
        else
            post.unpublish(now());
        post.advanceEdit(now());
        repository.saveAndFlush(post);
        return adminDetail(post);
    }

    /**
     * 메타데이터와 FK CASCADE 연결 삭제, Git 원고·첨부 파일은 유지
     */
    @Transactional
    public void delete(long id) {
        repository.delete(lockedPost(id));
        repository.flush();
    }

    /**
     * 페이지 범위를 검사하고 본문 없는 행에 분류·태그를 일괄 결합
     */
    @Transactional(readOnly = true)
    public PostPageResponse listDrafts(int page, int size) {
        if (page < 0 || size < 1 || size > 100 || (long) page * size > Integer.MAX_VALUE)
            throw new InvalidPostRequestException();
        var result = queries.adminPage(page, size);
        return new PostPageResponse(
                summaries(result.items()), page, size, result.total(), result.pages());
    }

    /**
     * 파일이 없는 새 글도 제목·상태 등 메타데이터 조회
     */
    @Transactional(readOnly = true)
    public PostDetailResponse adminMetadata(long id) {
        if (id <= 0)
            throw new InvalidPostRequestException();
        var row = queries.adminById(id);
        if (row == null)
            throw new PostNotFoundException();
        var view = taxonomy.one(id, row.categoryId());
        return new PostDetailResponse(
                id,
                row.title(),
                row.slug(),
                row.createdAt(),
                row.updatedAt(),
                row.status(),
                row.visibility(),
                row.publishedAt(),
                view.category(),
                view.tags(),
                attachmentLinks.postIds(id),
                wikiLinks.postTitles(id),
                row.series(),
                row.seriesOrder(),
                row.relatedSeriesId(),
                row.summary(),
                row.editVersion());
    }

    /**
     * 관리자 전체 메타데이터 일관 읽기, 최대 10,000건·8,000,000바이트
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<PostSummaryResponse> snapshot() {
        var items = summaries(queries.snapshotRows(false));
        if (mapper.writeValueAsBytes(items).length > 8_000_000)
            throw new IllegalStateException("Admin metadata snapshot too large");
        return items;
    }

    /**
     * 조회 행과 일괄 메타데이터를 같은 글 ID로 결합
     */
    private List<PostSummaryResponse> summaries(List<PostRow> rows) {
        var metadata = taxonomy.batch(
                rows.stream().map(PostRow::id).toList(),
                rows.stream().map(PostRow::categoryId).toList());
        return rows.stream()
                .map(
                        row -> {
                            var view = metadata.get(row.id());
                            return new PostSummaryResponse(
                                    row.id(),
                                    row.title(),
                                    row.slug(),
                                    row.createdAt(),
                                    row.updatedAt(),
                                    row.status(),
                                    row.visibility(),
                                    row.publishedAt(),
                                    view.category(),
                                    view.tags(),
                                    row.series(),
                                    row.seriesOrder(),
                                    row.summary(),
                                    row.relatedSeriesId(),
                                    row.editVersion());
                        })
                .toList();
    }

    /**
     * 분류 → ID 오름차순 시리즈 → 글 잠금 후 기준 버전을 검사하여 편집 전체 교체
     */
    @Transactional
    public PostDetailResponse updateMetadata(
            long id, PostMetadataCreateRequest request, long baseVersion) {
        String title = validTitle(request.title());
        String summary = validSummary(request.summary());
        var normalizedTags = TagNames.displayAll(request.tags());
        if (request.categoryId() != null)
            validCategory(request.categoryId());
        lockSeries(request.seriesId(), request.relatedSeriesId());
        if (request.order() != null
                && (request.order() <= 0
                        || request.seriesId() == null && request.categoryId() == null))
            throw new InvalidPostRequestException();
        // 글 잠금 안에서 기준 버전 검사 후 모든 필드 반영
        var post = lockedPost(id);
        requireVersion(post, baseVersion);
        var now = now();
        post.replaceMetadata(title, summary, now);
        post.changeCategory(request.categoryId(), now);
        post.assignSeries(request.seriesId(), request.order(), request.relatedSeriesId(), now);
        post.advanceEdit(now);
        repository.saveAndFlush(post);
        if (!tags.findNamesByPostId(id).equals(normalizedTags)) {
            tags.deleteByPostId(id);
            saveTags(id, normalizedTags);
        }
        return adminDetail(post);
    }

    /**
     * 글 잠금과 기준 버전 검사를 거쳐 문서 순서 저장
     */
    @Transactional
    public PostDetailResponse setOrder(long id, Integer order, long baseVersion) {
        if (id <= 0 || order != null && order <= 0)
            throw new InvalidPostRequestException();
        var post = lockedPost(id);
        requireVersion(post, baseVersion);
        if (order != null && post.getSeriesId() == null && post.getCategoryId() == null)
            throw new InvalidPostRequestException();
        post.reorder(order);
        post.advanceEdit(now());
        repository.saveAndFlush(post);
        return adminDetail(post);
    }

    /**
     * 소속·관련 시리즈를 ID 순서로 잠근 뒤 글 소속·순서를 함께 변경
     */
    @Transactional
    public PostDetailResponse setSeries(
            long id, Long seriesId, Integer order, Long relatedId, long baseVersion) {
        if (id <= 0 || order != null && order <= 0)
            throw new InvalidPostRequestException();
        lockSeries(seriesId, relatedId);
        var post = lockedPost(id);
        requireVersion(post, baseVersion);
        if (order != null && seriesId == null && post.getCategoryId() == null)
            throw new InvalidPostRequestException();
        post.assignSeries(seriesId, order, relatedId, now());
        post.advanceEdit(now());
        repository.saveAndFlush(post);
        return adminDetail(post);
    }

    /**
     * 원고 접근 없이 위키 대상 선언 전체 교체, 마지막 저장 선언 사용
     */
    @Transactional
    public PostDetailResponse replaceWikiLinks(long id, List<String> wikiTargets) {
        var post = lockedPost(id);
        wikiLinks.replacePost(id, wikiTargets);
        return adminDetail(post);
    }

    /**
     * Git 원고의 첨부 참조에 대한 공개 다운로드 권한 선언
     */
    @Transactional
    public PostDetailResponse replaceAttachments(long id, List<Long> attachmentIds) {
        var post = lockedPost(id);
        attachmentLinks.replacePost(id, attachmentIds);
        return adminDetail(post);
    }

    /**
     * 초안 포함 관리자 태그 사용량 조회
     */
    @Transactional(readOnly = true)
    public List<TagCountResponse> adminTags() {
        return queries.tagCounts();
    }

    /**
     * 양수 ID로 글 조회 및 쓰기 잠금 취득
     */
    private PostEntity lockedPost(long id) {
        if (id <= 0)
            throw new InvalidPostRequestException();
        var post = repository.findLockedById(id);
        if (post == null)
            throw new PostNotFoundException();
        return post;
    }

    /**
     * 현재 분류·태그·시리즈·첨부·위키를 관리자 응답에 결합
     */
    private PostDetailResponse adminDetail(PostEntity post) {
        long id = Objects.requireNonNull(post.getId(), "Persisted post has no ID");
        var view = taxonomy.one(id, post.getCategoryId());
        Long seriesId = post.getSeriesId();
        var parent = seriesId == null ? null : series.findById(seriesId).orElse(null);
        var ref = parent == null
                ? null
                : new SeriesRef(
                        Objects.requireNonNull(parent.getId()),
                        parent.getSlug(),
                        parent.getName(),
                        parent.getKind());
        return new PostDetailResponse(
                id,
                post.getTitle(),
                post.getSlug(),
                post.getCreatedAt(),
                post.getUpdatedAt(),
                post.getStatus(),
                post.getVisibility(),
                post.getPublishedAt(),
                view.category(),
                view.tags(),
                attachmentLinks.postIds(id),
                wikiLinks.postTitles(id),
                ref,
                post.getSeriesOrder(),
                post.getRelatedSeriesId(),
                post.getSummary(),
                post.getEditVersion());
    }

    /**
     * 중복 제거한 ID 오름차순 시리즈 잠금과 관련 프로젝트 검증
     */
    private void lockSeries(Long seriesId, Long relatedId) {
        var parents = new HashMap<Long, SeriesEntity>();
        var ids = Stream.of(seriesId, relatedId)
                .filter(Objects::nonNull)
                .distinct()
                .sorted()
                .toList();
        for (long id : ids) {
            if (id <= 0)
                throw new InvalidPostRequestException();
            var parent = series.findLockedById(id);
            if (parent == null)
                throw new SeriesNotFoundException();
            parents.put(id, parent);
        }
        if (relatedId != null && parents.get(relatedId).getKind() != SeriesKind.PROJECT)
            throw new InvalidPostRequestException();
    }

    /**
     * 글 쓰기 잠금 안에서 오래된 편집 기준 거부
     */
    private void requireVersion(PostEntity post, long version) {
        if (version < 0)
            throw new InvalidPostRequestException();
        if (post.getEditVersion() != version)
            throw new PostEditConflictException();
    }

    /**
     * 제목 공백 제거 후 빈 값·200 코드 포인트 초과 검사
     */
    private String validTitle(String value) {
        String title = Text.trim(value);
        if (Text.isBlank(title) || title.codePointCount(0, title.length()) > 200)
            throw new InvalidPostRequestException();
        return title;
    }

    /**
     * 주소 공백 제거·ROOT 소문자화 후 길이·패턴 검사
     */
    private String validSlug(String value) {
        String slug = Text.trim(value).toLowerCase(Locale.ROOT);
        if (slug.length() > 160 || !SLUG_PATTERN.matcher(slug).matches())
            throw new InvalidPostRequestException();
        return slug;
    }

    /**
     * 요약 공백 제거 후 120 코드 포인트 상한 검사
     */
    private String validSummary(String value) {
        String summary = Text.trim(value);
        if (summary.codePointCount(0, summary.length()) > 120)
            throw new InvalidPostRequestException();
        return summary;
    }

    /**
     * 양수 분류 ID와 공유 잠금으로 존재 확인
     */
    private void validCategory(long id) {
        if (id <= 0)
            throw new InvalidPostRequestException();
        if (categories.findSharedById(id) == null)
            throw new CategoryNotFoundException();
    }

    /**
     * 정규화된 태그를 입력 순서대로 저장, 빈 목록은 저장 없음
     */
    private void saveTags(long id, List<String> names) {
        if (!names.isEmpty())
            tags.saveAllAndFlush(
                    IntStream.range(0, names.size())
                            .mapToObj(index -> new PostTagEntity(id, index, names.get(index)))
                            .toList());
    }

    /**
     * 마이크로초 정밀도의 현재 UTC 시각
     */
    private LocalDateTime now() {
        return LocalDateTime.ofInstant(
                Clock.systemUTC().instant().truncatedTo(ChronoUnit.MICROS), ZoneOffset.UTC);
    }

    /**
     * 예외 원인에서 게시글 주소 고유 제약 충돌 확인
     */
    private boolean isDuplicateSlugConstraint(DataIntegrityViolationException exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLIntegrityConstraintViolationException sql
                    && sql.getErrorCode() == 1062
                    && sql.getMessage() != null
                    && sql.getMessage().contains("uk_posts_slug"))
                return true;
        }
        return false;
    }
}
