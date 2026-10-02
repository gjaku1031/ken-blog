package io.github.gjaku1031.kenblog.post.repository

import io.github.gjaku1031.kenblog.jooq.tables.references.*
import io.github.gjaku1031.kenblog.post.domain.*
import io.github.gjaku1031.kenblog.post.dto.*
import io.github.gjaku1031.kenblog.category.dto.CategoryPostCountRow
import io.github.gjaku1031.kenblog.attachment.dto.AttachmentDeliveryRow
import io.github.gjaku1031.kenblog.series.domain.SeriesKind
import org.jooq.Condition
import org.jooq.Record
import org.jooq.impl.DSL.*
import org.jooq.DSLContext
import org.springframework.stereotype.Repository
import java.time.LocalDateTime

/**
 * 본문 열을 선택하지 않는 공통 조회 행
 */
data class PostRow(
    /**
     * ID
     */
    val id: Long,
    /**
     * 제목
     */
    val title: String,
    /**
     * 공개 주소 식별자
     */
    val slug: String,
    /**
     * 요약
     */
    val summary: String,
    /**
     * 생성 시각
     */
    val createdAt: LocalDateTime,
    /**
     * 수정 시각
     */
    val updatedAt: LocalDateTime,
    /**
     * 최초 출간 시각
     */
    val publishedAt: LocalDateTime?,
    /**
     * 출간 상태
     */
    val status: PostStatus,
    /**
     * 공개 범위
     */
    val visibility: PostVisibility,
    /**
     * 분류 ID
     */
    val categoryId: Long?,
    /**
     * 시리즈
     */
    val series: SeriesRef?,
    /**
     * 시리즈 내 정렬 순서
     */
    val seriesOrder: Int?,
    /**
     * 관련 프로젝트 시리즈 ID
     */
    val relatedSeriesId: Long?,
    /**
     * 이전 공개 경로
     */
    val legacyPath: String?
)
/**
 * 본문 없는 글 페이지 조회 결과
 */
data class PostRows(
    /**
     * 조회 결과 목록
     */
    val items: List<PostRow>,
    /**
     * 전체 결과 수
     */
    val total: Long,
    /**
     * 전체 페이지 수
     */
    val pages: Int
)

/**
 * 공개 조건·정렬·집계를 생성된 테이블 타입으로 구성
 * 저장은 JPA 담당, 첨부 연결 검증은 상태 열만 잠금 조회
 */
@Repository
class PostQueries(
    /**
     * jOOQ 쿼리 실행기
     */
    private val sql: DSLContext
) {
    /**
     * 게시글 테이블
     */
    private val p = POSTS
    /**
     * 시리즈 테이블
     */
    private val s = SERIES
    /**
     * 게시글과 시리즈의 LEFT JOIN
     */
    private val joined
        /**
         * 게시글·시리즈 JOIN 구성
         */
        get() = p.leftJoin(s).on(p.SERIES_ID.eq(s.ID))
    /**
     * 본문을 제외한 조회 열
     */
    private val fields
        /**
         * 본문을 제외한 조회 열 구성
         */
        get() = listOf(p.ID, p.TITLE, p.SLUG, p.SUMMARY, p.CREATED_AT, p.UPDATED_AT,
        p.PUBLISHED_AT, p.STATUS, p.VISIBILITY, p.CATEGORY_ID, p.SERIES_ORDER, p.RELATED_SERIES_ID,
        p.LEGACY_PATH, s.ID, s.SLUG, s.NAME, s.KIND)
    /**
     * 출간 시각·ID 내림차순
     */
    private val newest
        /**
         * 최신 출간 순서 구성
         */
        get() = listOf(p.PUBLISHED_AT.desc(), p.ID.desc())
    /**
     * 문서 순서·출간 시각·ID 오름차순
     */
    private val ordered
        /**
         * 문서 표시 순서 구성
         */
        get() = listOf(p.SERIES_ORDER.asc().nullsLast(), p.PUBLISHED_AT.asc().nullsLast(), p.ID.asc())

    /**
     * 미이관 구획과 고아 시리즈는 공개하지 않는 보수적인 공통 조건
     */
    fun readable(): Condition = p.STATUS.eq("PUBLISHED").and(p.VISIBILITY.eq("PUBLIC"))
        .and(p.SECTION.eq("TECH"))
        .and(p.SERIES_ID.isNull.or(s.VISIBILITY.eq("PUBLIC")))
    /**
     * 일반 글 또는 TECH 시리즈의 글 조건
     */
    private fun general(): Condition = p.SERIES_ID.isNull.or(s.KIND.eq("TECH"))

    /**
     * 초안을 포함한 관리자 글 목록 조회
     */
    fun adminPage(page: Int, size: Int): PostRows = page(trueCondition(), page, size, false)
    /**
     * 공개 출간 글 목록 조회
     */
    fun publicPage(page: Int, size: Int): PostRows = page(readable(), page, size, true)
    /**
     * 조건에 맞는 총건수와 정렬된 페이지 조회
     */
    private fun page(condition: Condition, page: Int, size: Int, published: Boolean): PostRows {
        val total = sql.selectCount().from(joined).where(condition).fetchOne(0, Long::class.java)!!
        val rows = sql.select(fields).from(joined).where(condition)
            .orderBy(if (published) newest else listOf(p.UPDATED_AT.desc(), p.ID.desc()))
            .limit(size).offset(page * size).fetch(::row)
        return PostRows(rows, total, ((total + size - 1) / size).toInt())
    }
    /**
     * 주소에 해당하는 공개 출간 글 조회
     */
    fun publicBySlug(slug: String): PostRow? = sql.select(fields).from(joined)
        .where(readable().and(p.SLUG.eq(slug))).fetchOne(::row)
    /**
     * 시리즈 문서 조회, 공개 여부에 따라 초안 포함
     */
    fun seriesPosts(id: Long, publicOnly: Boolean): List<PostRow> = sql.select(fields).from(joined)
        .where(p.SERIES_ID.eq(id).and(if (publicOnly) readable() else trueCondition())).orderBy(ordered).fetch(::row)
    /**
     * 해당 분류의 공개 일반·TECH 글 조회
     */
    fun categoryPosts(id: Long): List<PostRow> = sql.select(fields).from(joined)
        .where(readable().and(general()).and(p.CATEGORY_ID.eq(id))).orderBy(ordered).fetch(::row)
    /**
     * 초안을 포함한 분류별 글 수 집계
     */
    fun categoryCounts(): List<CategoryPostCountRow> = sql.select(p.CATEGORY_ID, count())
        .from(joined).where(p.CATEGORY_ID.isNotNull)
        .groupBy(p.CATEGORY_ID).fetch { CategoryPostCountRow(it.value1()!!, it.value2().toLong()) }
    /**
     * 초안을 포함한 관리자 태그 사용량 집계
     */
    fun tagCounts(): List<TagCountResponse> = sql.select(min(POST_TAGS.DISPLAY_NAME), count())
        .from(POST_TAGS.join(joined).on(POST_TAGS.POST_ID.eq(p.ID)))
        .groupBy(POST_TAGS.TAG_NAME).orderBy(count().desc(), POST_TAGS.TAG_NAME.asc())
        .fetch { TagCountResponse(it.value1()!!, it.value2().toLong()) }

    // LOWER 뒤 이진 비교로 대소문자만 무시하며 SQL 와일드카드는 해석하지 않음
    /**
     * 제목을 소문자화한 뒤 이진 비교 키로 변환
     */
    private fun titleKey(field: org.jooq.Field<String?>) = lower(field).cast(org.jooq.impl.SQLDataType.VARBINARY)
    /**
     * 같은 제목의 공개 글 중 최초 출간 글 조회
     */
    fun wikiTarget(title: String): PostRow? = sql.select(fields).from(joined)
        .where(readable().and(titleKey(p.TITLE).eq(titleKey(value(title)))))
        .orderBy(p.PUBLISHED_AT.asc(), p.ID.asc()).limit(1).fetchOne(::row)
    /**
     * 부분 제목에 맞는 공개 대표 글을 최대 7개 조회
     *
     * 1. 동일 제목의 더 이른 공개 글을 찾을 별칭 준비
     * 2. 대표 글보다 늦게 출간된 중복 제목 후보 제외
     * 3. 부분 제목 검색 후 최신순 최대 7개 반환
     */
    fun titleSearch(query: String): List<PostRow> {
        // 동일 제목의 더 이른 공개 글을 찾을 별칭 준비
        val older = p.`as`("older")
        val parent = s.`as`("parent")
        // 대표 글보다 늦게 출간된 중복 제목 후보 제외
        val canonical = notExists(sql.selectOne().from(older.leftJoin(parent).on(older.SERIES_ID.eq(parent.ID)))
            .where(older.STATUS.eq("PUBLISHED").and(older.VISIBILITY.eq("PUBLIC")).and(older.SECTION.eq("TECH"))
                .and(older.SERIES_ID.isNull.or(parent.VISIBILITY.eq("PUBLIC")))
                .and(titleKey(older.TITLE).eq(titleKey(p.TITLE)))
                .and(older.PUBLISHED_AT.lt(p.PUBLISHED_AT).or(older.PUBLISHED_AT.eq(p.PUBLISHED_AT).and(older.ID.lt(p.ID))))))
        // 부분 제목 검색 후 최신순 최대 7개 반환
        return sql.select(fields).from(joined).where(readable().and(p.TITLE.containsIgnoreCase(query)).and(canonical))
            .orderBy(newest).limit(7).fetch(::row)
    }
    /**
     * 연결 교체 트랜잭션에서 ID 순서대로 호출하여 직접 DB 변경과 직렬화
     */
    fun lockAttachmentStatus(id: Long): String? = sql.select(ATTACHMENTS.STATUS).from(ATTACHMENTS)
        .where(ATTACHMENTS.ID.eq(id)).forUpdate().fetchOne(ATTACHMENTS.STATUS)
    /**
     * 공개 출간 글의 READY 첨부 연결과 전달 정보 조회
     */
    fun readableAttachment(postId: Long, attachmentId: Long): AttachmentDeliveryRow? = sql
        .select(ATTACHMENTS.OBJECT_KEY, ATTACHMENTS.CONTENT_TYPE, ATTACHMENTS.BYTE_SIZE)
        .from(joined.join(POST_ATTACHMENTS).on(POST_ATTACHMENTS.POST_ID.eq(p.ID))
            .join(ATTACHMENTS).on(ATTACHMENTS.ID.eq(POST_ATTACHMENTS.ATTACHMENT_ID)))
        .where(readable().and(p.ID.eq(postId)).and(ATTACHMENTS.ID.eq(attachmentId)).and(ATTACHMENTS.STATUS.eq("READY")))
        .fetchOne { AttachmentDeliveryRow(it.value1()!!, it.value2()!!, it.value3()!!) }
    /**
     * 공개 글의 첨부 연결·상태·수정 정보 조회
     */
    fun attachmentRevisions(): List<String> = sql.select(POST_ATTACHMENTS.POST_ID, ATTACHMENTS.ID,
        ATTACHMENTS.OBJECT_KEY, ATTACHMENTS.CONTENT_TYPE, ATTACHMENTS.BYTE_SIZE, ATTACHMENTS.STATUS, ATTACHMENTS.UPDATED_AT)
        .from(joined.join(POST_ATTACHMENTS).on(POST_ATTACHMENTS.POST_ID.eq(p.ID))
            .join(ATTACHMENTS).on(ATTACHMENTS.ID.eq(POST_ATTACHMENTS.ATTACHMENT_ID)))
        .where(readable()).orderBy(p.ID.asc(), ATTACHMENTS.ID.asc()).fetch { it.intoArray().joinToString("\u0000") }
    /**
     * 본문 없는 SQL 행을 글 메타데이터로 변환
     */
    private fun row(r: Record): PostRow = PostRow(r[p.ID]!!, r[p.TITLE]!!, r[p.SLUG]!!, r[p.SUMMARY]!!,
        r[p.CREATED_AT]!!, r[p.UPDATED_AT]!!, r[p.PUBLISHED_AT], PostStatus.valueOf(r[p.STATUS]!!),
        PostVisibility.valueOf(r[p.VISIBILITY]!!), r[p.CATEGORY_ID], r[s.ID]?.let {
            SeriesRef(it, r[s.SLUG]!!, r[s.NAME]!!, SeriesKind.valueOf(r[s.KIND]!!))
        }, r[p.SERIES_ORDER], r[p.RELATED_SERIES_ID], r[p.LEGACY_PATH])
}
