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
     * 공개 사이트에 싣는 출간 글 조건
     */
    public Condition readable() {
        return p.STATUS.eq("PUBLISHED");
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
     * 연결 교체 트랜잭션에서 ID 순서로 호출하는 첨부 행 잠금, 없으면 false
     */
    public boolean lockAttachment(long id) {
        return sql.select(ATTACHMENTS.ID)
                        .from(ATTACHMENTS)
                        .where(ATTACHMENTS.ID.eq(id))
                        .forUpdate()
                        .fetchOne()
                != null;
    }

    /**
     * 공개 출간 글에 연결된 첨부의 전달 정보
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
                                .and(ATTACHMENTS.ID.eq(attachmentId)))
                .fetchOne(
                        record ->
                                new AttachmentDeliveryRow(
                                        record.value1(), record.value2(), record.value3()));
    }

    /**
     * 공개 글의 첨부 연결·형식·수정 정보
     */
    public List<String> attachmentRevisions() {
        return sql.select(
                        POST_ATTACHMENTS.POST_ID,
                        ATTACHMENTS.ID,
                        ATTACHMENTS.OBJECT_KEY,
                        ATTACHMENTS.CONTENT_TYPE,
                        ATTACHMENTS.BYTE_SIZE,
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
