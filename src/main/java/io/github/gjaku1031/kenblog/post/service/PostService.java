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
 * 게시글의 DB 메타데이터·공개 범위·검수 표시·첨부 연결 관리
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
     * 공개하지 않은 글의 DB 본문 저장소
     */
    private final PostBodyRepository bodies;

    /**
     * 분류·태그 조회기
     */
    private final PostTaxonomyMetadata taxonomy;

    /**
     * 첨부 연결 서비스
     */
    private final AttachmentLinkService attachmentLinks;

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
     * 입력 검증·글 저장·태그·첨부를 같은 트랜잭션에서 수행
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
        var post = new PostEntity(title, slug, now);
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
        return adminDetail(saved);
    }

    /**
     * 공개 범위만 명시적으로 전환하고 편집 기준 무효화
     *
     * 공개 글의 본문은 저장소 원고에서만 읽으므로 DB 본문이 남은 글은 공개로 바꾸지 않음
     * 원고를 저장소로 옮기고 DB 본문을 지우는 운영 절차가 끝난 글만 공개 가능
     *
     * @throws PostStateConflictException DB 본문이 남은 글을 공개로 바꾸려 할 때
     */
    @Transactional
    public PostDetailResponse changeStatus(long id, PostStatus target) {
        var post = lockedPost(id);
        // 글 잠금 뒤에 본문 위치를 확인하여 운영 절차의 본문 변경과 순서 고정
        if (target == PostStatus.PUBLISHED
                && post.getStatus() != PostStatus.PUBLISHED
                && bodies.existsById(id))
            throw new PostStateConflictException(
                    "본문이 DB에 있는 글은 여기서 공개할 수 없습니다. 검수 완료 뒤 공개 전환 절차로 원고를 저장소에 옮기세요.");
        var now = now();
        post.changeStatus(target, now);
        post.advanceEdit(now);
        repository.saveAndFlush(post);
        return adminDetail(post);
    }

    /**
     * 미검수 글의 검수 완료 표시·해제, 메타데이터 편집 기준은 유지
     *
     * 1. 글 잠금 취득 후 미검수 상태 확인
     * 2. 표시할 때는 화면이 읽은 본문 시각과 현재 DB 본문 시각 대조
     * 3. 일치하면 검수 시각 기록, 해제는 대조 없이 초기화
     *
     * @param bodyUpdatedAt 검수한 화면이 읽은 본문 수정 시각, 해제 요청에서는 사용하지 않음
     * @throws PostStateConflictException 미검수 글이 아니거나, DB 본문이 없거나, 읽은 뒤 본문이 바뀌었을 때
     */
    @Transactional
    public PostDetailResponse setReviewed(long id, boolean reviewed, LocalDateTime bodyUpdatedAt) {
        var post = lockedPost(id);
        if (post.getStatus() != PostStatus.UNREVIEWED)
            throw new PostStateConflictException("미검수 글만 검수 완료로 표시할 수 있습니다. 글을 다시 열어 확인하세요.");
        if (reviewed) {
            // 잠금 뒤의 첫 조회로 본문 시각을 읽어 검수한 본문과 같은지 확인
            var current = bodies.findUpdatedAtByPostId(id);
            if (current == null)
                throw new PostStateConflictException("DB에 본문이 없어 검수할 수 없습니다.");
            if (!current.equals(bodyUpdatedAt))
                throw new PostStateConflictException("읽은 뒤 본문이 바뀌었습니다. 글을 다시 열어 확인하세요.");
            post.markReviewed(now());
        } else {
            post.clearReview();
        }
        repository.saveAndFlush(post);
        return adminDetail(post);
    }

    /**
     * 공개하지 않은 글의 DB 본문 조회
     *
     * @throws PostNotFoundException 글이 없거나 본문이 저장소 원고에만 있을 때
     */
    @Transactional(readOnly = true)
    public PostBodyResponse body(long id) {
        if (id <= 0)
            throw new InvalidPostRequestException();
        var body = bodies.findById(id).orElseThrow(PostNotFoundException::new);
        return new PostBodyResponse(id, body.getBody(), body.getUpdatedAt());
    }

    /**
     * 관리자에게만 보이는 연결 글 목록, 글이 없으면 404
     */
    @Transactional(readOnly = true)
    public List<PostLinkResponse> links(long id) {
        if (id <= 0)
            throw new InvalidPostRequestException();
        if (!repository.existsById(id))
            throw new PostNotFoundException();
        return queries.linkedPosts(id);
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
                row.reviewedAt(),
                row.bodyUpdatedAt(),
                row.publishedAt(),
                view.category(),
                view.tags(),
                attachmentLinks.postIds(id),
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
                                    row.reviewedAt(),
                                    row.bodyUpdatedAt(),
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
     * 본문의 첨부 참조 선언, 공개 글이면 익명 다운로드 권한이 되고 그 밖의 글이면 관리자 열람에만 사용
     */
    @Transactional
    public PostDetailResponse replaceAttachments(long id, List<Long> attachmentIds) {
        var post = lockedPost(id);
        attachmentLinks.replacePost(id, attachmentIds);
        return adminDetail(post);
    }

    /**
     * 공개하지 않은 글을 포함한 관리자 태그 사용량 조회
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
     * 현재 분류·태그·시리즈·첨부를 관리자 응답에 결합
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
                post.getReviewedAt(),
                bodies.findUpdatedAtByPostId(id),
                post.getPublishedAt(),
                view.category(),
                view.tags(),
                attachmentLinks.postIds(id),
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
