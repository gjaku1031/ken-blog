package io.github.gjaku1031.kenblog.post.repository;

import lombok.RequiredArgsConstructor;

import static io.github.gjaku1031.kenblog.jooq.Tables.*;

import static org.jooq.impl.DSL.*;

import io.github.gjaku1031.kenblog.attachment.dto.AttachmentDeliveryRow;
import io.github.gjaku1031.kenblog.category.dto.CategoryPostCountRow;
import io.github.gjaku1031.kenblog.jooq.tables.Posts;
import io.github.gjaku1031.kenblog.jooq.tables.Series;
import io.github.gjaku1031.kenblog.post.domain.*;
import io.github.gjaku1031.kenblog.post.dto.*;
import io.github.gjaku1031.kenblog.series.domain.SeriesKind;

import org.jooq.*;
import org.jooq.Record;
import org.jooq.impl.SQLDataType;
import org.springframework.stereotype.Repository;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 공개 조건·정렬·집계를 생성된 테이블 타입으로 구성
 */
@Repository
@RequiredArgsConstructor
public class PostQueries {
    /**
     * jOOQ 쿼리 실행기
     */
    private final DSLContext sql;

    /**
     * 게시글 테이블
     */
    private final Posts p = POSTS;

    /**
     * 시리즈 테이블
     */
    private final Series s = SERIES;

    /**
     * 게시글·시리즈 LEFT JOIN 구성
     */
    private Table<?> joined() {
        return p.leftJoin(s).on(p.SERIES_ID.eq(s.ID));
    }

    /**
     * 본문을 제외한 조회 열
     */
    private List<SelectFieldOrAsterisk> fields() {
        return List.of(
                p.ID,
                p.TITLE,
                p.SLUG,
                p.SUMMARY,
                p.CREATED_AT,
                p.UPDATED_AT,
                p.PUBLISHED_AT,
                p.STATUS,
                p.VISIBILITY,
                p.CATEGORY_ID,
                p.SERIES_ORDER,
                p.RELATED_SERIES_ID,
                p.LEGACY_PATH,
                p.EDIT_VERSION,
                s.ID,
                s.SLUG,
                s.NAME,
                s.KIND);
    }

    /**
     * 출간 시각·ID 내림차순
     */
    private List<SortField<?>> newest() {
        return List.of(p.PUBLISHED_AT.desc(), p.ID.desc());
    }

    /**
     * 문서 순서·출간 시각·ID 오름차순
     */
    private List<SortField<?>> ordered() {
        return List.of(
                p.SERIES_ORDER.asc().nullsLast(), p.PUBLISHED_AT.asc().nullsLast(), p.ID.asc());
    }

    /**
     * 미이관 구획과 고아 시리즈를 공개하지 않는 공통 조건
     */
    public Condition readable() {
        return p.STATUS
                .eq("PUBLISHED")
                .and(p.VISIBILITY.eq("PUBLIC"))
                .and(p.SECTION.eq("TECH"))
                .and(p.SERIES_ID.isNull().or(s.VISIBILITY.eq("PUBLIC")));
    }

    /**
     * 일반 글 또는 TECH 시리즈의 글 조건
     */
    private Condition general() {
        return p.SERIES_ID.isNull().or(s.KIND.eq("TECH"));
    }

    /**
     * 초안 포함 관리자 글 목록
     */
    public PostRows adminPage(int page, int size) {
        return page(trueCondition(), page, size, false);
    }

    /**
     * 공개 출간 글 목록
     */
    public PostRows publicPage(int page, int size) {
        return page(readable(), page, size, true);
    }

    /**
     * 전체 메타데이터 스냅샷, 10,000건 초과 시 부분 응답 대신 실패
     */
    public List<PostRow> snapshotRows(boolean publicOnly) {
        var rows =
                sql.select(fields())
                        .from(joined())
                        .where(publicOnly ? readable() : trueCondition())
                        .orderBy(publicOnly ? newest() : List.of(p.UPDATED_AT.desc(), p.ID.desc()))
                        .limit(10_001)
                        .fetch(this::row);
        if (rows.size() > 10_000) throw new IllegalStateException("Metadata snapshot too large");
        return rows;
    }

    /**
     * 본문 없는 관리자 단건 메타데이터
     */
    public PostRow adminById(long id) {
        return sql.select(fields()).from(joined()).where(p.ID.eq(id)).fetchOne(this::row);
    }

    /**
     * 조건에 맞는 총건수와 정렬된 페이지
     */
    private PostRows page(Condition condition, int page, int size, boolean published) {
        long total =
                Objects.requireNonNull(
                        sql.selectCount().from(joined()).where(condition).fetchOne(0, Long.class));
        var rows =
                sql.select(fields())
                        .from(joined())
                        .where(condition)
                        .orderBy(published ? newest() : List.of(p.UPDATED_AT.desc(), p.ID.desc()))
                        .limit(size)
                        .offset(page * size)
                        .fetch(this::row);
        return new PostRows(rows, total, (int) ((total + size - 1) / size));
    }

    /**
     * 주소에 해당하는 공개 출간 글
     */
    public PostRow publicBySlug(String slug) {
        return sql.select(fields())
                .from(joined())
                .where(readable().and(p.SLUG.eq(slug)))
                .fetchOne(this::row);
    }

    /**
     * 시리즈 문서, 공개 여부에 따라 초안 포함
     */
    public List<PostRow> seriesPosts(long id, boolean publicOnly) {
        return sql.select(fields())
                .from(joined())
                .where(p.SERIES_ID.eq(id).and(publicOnly ? readable() : trueCondition()))
                .orderBy(ordered())
                .fetch(this::row);
    }

    /**
     * 해당 분류의 공개 일반·TECH 글
     */
    public List<PostRow> categoryPosts(long id) {
        return sql.select(fields())
                .from(joined())
                .where(readable().and(general()).and(p.CATEGORY_ID.eq(id)))
                .orderBy(ordered())
                .fetch(this::row);
    }

    /**
     * 초안 포함 분류별 글 수
     */
    public List<CategoryPostCountRow> categoryCounts() {
        return sql.select(p.CATEGORY_ID, count())
                .from(joined())
                .where(p.CATEGORY_ID.isNotNull())
                .groupBy(p.CATEGORY_ID)
                .fetch(
                        record ->
                                new CategoryPostCountRow(
                                        record.value1(), record.value2().longValue()));
    }

    /**
     * 초안 포함 관리자 태그 사용량
     */
    public List<TagCountResponse> tagCounts() {
        return sql.select(min(POST_TAGS.DISPLAY_NAME), count())
                .from(POST_TAGS.join(joined()).on(POST_TAGS.POST_ID.eq(p.ID)))
                .groupBy(POST_TAGS.TAG_NAME)
                .orderBy(count().desc(), POST_TAGS.TAG_NAME.asc())
                .fetch(
                        record ->
                                new TagCountResponse(record.value1(), record.value2().longValue()));
    }

    /**
     * LOWER 뒤 이진 비교로 대소문자만 무시
     */
    private Field<byte[]> titleKey(Field<String> field) {
        return lower(field).cast(SQLDataType.VARBINARY);
    }

    /**
     * 같은 제목의 공개 글 중 최초 출간 글
     */
    public PostRow wikiTarget(String title) {
        return sql.select(fields())
                .from(joined())
                .where(readable().and(titleKey(p.TITLE).eq(titleKey(value(title)))))
                .orderBy(p.PUBLISHED_AT.asc(), p.ID.asc())
                .limit(1)
                .fetchOne(this::row);
    }

    /**
     * 중복 제목의 대표 글만 남긴 부분 제목 후보 최대 7개
     */
    public List<PostRow> titleSearch(String query) {
        // 동일 제목의 더 이른 공개 글을 별칭으로 조회
        var older = p.as("older");
        var parent = s.as("parent");
        var canonical =
                notExists(
                        sql.selectOne()
                                .from(older.leftJoin(parent).on(older.SERIES_ID.eq(parent.ID)))
                                .where(
                                        older.STATUS
                                                .eq("PUBLISHED")
                                                .and(older.VISIBILITY.eq("PUBLIC"))
                                                .and(older.SECTION.eq("TECH"))
                                                .and(
                                                        older.SERIES_ID
                                                                .isNull()
                                                                .or(parent.VISIBILITY.eq("PUBLIC")))
                                                .and(titleKey(older.TITLE).eq(titleKey(p.TITLE)))
                                                .and(
                                                        older.PUBLISHED_AT
                                                                .lt(p.PUBLISHED_AT)
                                                                .or(
                                                                        older.PUBLISHED_AT
                                                                                .eq(p.PUBLISHED_AT)
                                                                                .and(
                                                                                        older.ID.lt(
                                                                                                p.ID))))));
        // 대표 글만 최신순으로 반환하며 검색어의 SQL 와일드카드를 해석하지 않음
        return sql.select(fields())
                .from(joined())
                .where(readable().and(p.TITLE.containsIgnoreCase(query)).and(canonical))
                .orderBy(newest())
                .limit(7)
                .fetch(this::row);
    }

    /**
     * 연결 교체 트랜잭션에서 ID 순서로 호출하는 첨부 상태 잠금
     */
    public String lockAttachmentStatus(long id) {
        return sql.select(ATTACHMENTS.STATUS)
                .from(ATTACHMENTS)
                .where(ATTACHMENTS.ID.eq(id))
                .forUpdate()
                .fetchOne(ATTACHMENTS.STATUS);
    }

    /**
     * 공개 출간 글의 READY 첨부 연결과 전달 정보
     */
    public AttachmentDeliveryRow readableAttachment(long postId, long attachmentId) {
        return sql.select(ATTACHMENTS.OBJECT_KEY, ATTACHMENTS.CONTENT_TYPE, ATTACHMENTS.BYTE_SIZE)
                .from(
                        joined().join(POST_ATTACHMENTS)
                                .on(POST_ATTACHMENTS.POST_ID.eq(p.ID))
                                .join(ATTACHMENTS)
                                .on(ATTACHMENTS.ID.eq(POST_ATTACHMENTS.ATTACHMENT_ID)))
                .where(
                        readable()
                                .and(p.ID.eq(postId))
                                .and(ATTACHMENTS.ID.eq(attachmentId))
                                .and(ATTACHMENTS.STATUS.eq("READY")))
                .fetchOne(
                        record ->
                                new AttachmentDeliveryRow(
                                        record.value1(), record.value2(), record.value3()));
    }

    /**
     * 공개 글의 첨부 연결·상태·수정 정보
     */
    public List<String> attachmentRevisions() {
        return sql.select(
                        POST_ATTACHMENTS.POST_ID,
                        ATTACHMENTS.ID,
                        ATTACHMENTS.OBJECT_KEY,
                        ATTACHMENTS.CONTENT_TYPE,
                        ATTACHMENTS.BYTE_SIZE,
                        ATTACHMENTS.STATUS,
                        ATTACHMENTS.UPDATED_AT)
                .from(
                        joined().join(POST_ATTACHMENTS)
                                .on(POST_ATTACHMENTS.POST_ID.eq(p.ID))
                                .join(ATTACHMENTS)
                                .on(ATTACHMENTS.ID.eq(POST_ATTACHMENTS.ATTACHMENT_ID)))
                .where(readable())
                .orderBy(p.ID.asc(), ATTACHMENTS.ID.asc())
                .fetch(
                        record ->
                                Arrays.stream(record.intoArray())
                                        .map(String::valueOf)
                                        .collect(Collectors.joining("\u0000")));
    }

    /**
     * 본문 없는 SQL 행을 글 메타데이터로 변환
     */
    private PostRow row(Record r) {
        Long seriesId = r.get(s.ID);
        return new PostRow(
                r.get(p.ID),
                r.get(p.TITLE),
                r.get(p.SLUG),
                r.get(p.SUMMARY),
                r.get(p.CREATED_AT),
                r.get(p.UPDATED_AT),
                r.get(p.PUBLISHED_AT),
                PostStatus.valueOf(r.get(p.STATUS)),
                PostVisibility.valueOf(r.get(p.VISIBILITY)),
                r.get(p.CATEGORY_ID),
                seriesId == null
                        ? null
                        : new SeriesRef(
                                seriesId,
                                r.get(s.SLUG),
                                r.get(s.NAME),
                                SeriesKind.valueOf(r.get(s.KIND))),
                r.get(p.SERIES_ORDER),
                r.get(p.RELATED_SERIES_ID),
                r.get(p.LEGACY_PATH),
                r.get(p.EDIT_VERSION));
    }
}
