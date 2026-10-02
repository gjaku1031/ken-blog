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

/** 본문 열을 선택하지 않는 공통 조회 행. */
data class PostRow(val id: Long, val title: String, val slug: String, val summary: String,
    val createdAt: LocalDateTime, val updatedAt: LocalDateTime, val publishedAt: LocalDateTime?,
    val status: PostStatus, val visibility: PostVisibility, val categoryId: Long?,
    val series: SeriesRef?, val seriesOrder: Int?, val relatedSeriesId: Long?, val legacyPath: String?)
data class PostRows(val items: List<PostRow>, val total: Long, val pages: Int)

/** 공개 조건·정렬·집계를 생성된 테이블 타입으로 구성. 저장은 JPA 담당, 첨부 연결 검증은 상태 열만 잠금 조회. */
@Repository
class PostQueries(private val sql: DSLContext) {
    private val p = POSTS
    private val s = SERIES
    private val joined get() = p.leftJoin(s).on(p.SERIES_ID.eq(s.ID))
    private val fields get() = listOf(p.ID, p.TITLE, p.SLUG, p.SUMMARY, p.CREATED_AT, p.UPDATED_AT,
        p.PUBLISHED_AT, p.STATUS, p.VISIBILITY, p.CATEGORY_ID, p.SERIES_ORDER, p.RELATED_SERIES_ID,
        p.LEGACY_PATH, s.ID, s.SLUG, s.NAME, s.KIND)
    private val newest get() = listOf(p.PUBLISHED_AT.desc(), p.ID.desc())
    private val ordered get() = listOf(p.SERIES_ORDER.asc().nullsLast(), p.PUBLISHED_AT.asc().nullsLast(), p.ID.asc())

    /** 미이관 구획과 고아 시리즈는 공개하지 않는 보수적인 공통 조건. */
    fun readable(): Condition = p.STATUS.eq("PUBLISHED").and(p.VISIBILITY.eq("PUBLIC"))
        .and(p.SECTION.eq("TECH"))
        .and(p.SERIES_ID.isNull.or(s.VISIBILITY.eq("PUBLIC")))
    private fun general(): Condition = p.SERIES_ID.isNull.or(s.KIND.eq("TECH"))

    fun adminPage(page: Int, size: Int): PostRows = page(trueCondition(), page, size, false)
    fun publicPage(page: Int, size: Int): PostRows = page(readable(), page, size, true)
    private fun page(condition: Condition, page: Int, size: Int, published: Boolean): PostRows {
        val total = sql.selectCount().from(joined).where(condition).fetchOne(0, Long::class.java)!!
        val rows = sql.select(fields).from(joined).where(condition)
            .orderBy(if (published) newest else listOf(p.UPDATED_AT.desc(), p.ID.desc()))
            .limit(size).offset(page * size).fetch(::row)
        return PostRows(rows, total, ((total + size - 1) / size).toInt())
    }
    fun publicBySlug(slug: String): PostRow? = sql.select(fields).from(joined)
        .where(readable().and(p.SLUG.eq(slug))).fetchOne(::row)
    fun seriesPosts(id: Long, publicOnly: Boolean): List<PostRow> = sql.select(fields).from(joined)
        .where(p.SERIES_ID.eq(id).and(if (publicOnly) readable() else trueCondition())).orderBy(ordered).fetch(::row)
    fun categoryPosts(id: Long): List<PostRow> = sql.select(fields).from(joined)
        .where(readable().and(general()).and(p.CATEGORY_ID.eq(id))).orderBy(ordered).fetch(::row)
    fun categoryCounts(): List<CategoryPostCountRow> = sql.select(p.CATEGORY_ID, count())
        .from(joined).where(p.CATEGORY_ID.isNotNull)
        .groupBy(p.CATEGORY_ID).fetch { CategoryPostCountRow(it.value1()!!, it.value2().toLong()) }
    fun tagCounts(): List<TagCountResponse> = sql.select(min(POST_TAGS.DISPLAY_NAME), count())
        .from(POST_TAGS.join(joined).on(POST_TAGS.POST_ID.eq(p.ID)))
        .groupBy(POST_TAGS.TAG_NAME).orderBy(count().desc(), POST_TAGS.TAG_NAME.asc())
        .fetch { TagCountResponse(it.value1()!!, it.value2().toLong()) }

    // LOWER 뒤 이진 비교로 대소문자만 무시하며 SQL 와일드카드는 해석하지 않음.
    private fun titleKey(field: org.jooq.Field<String?>) = lower(field).cast(org.jooq.impl.SQLDataType.VARBINARY)
    fun wikiTarget(title: String): PostRow? = sql.select(fields).from(joined)
        .where(readable().and(titleKey(p.TITLE).eq(titleKey(value(title)))))
        .orderBy(p.PUBLISHED_AT.asc(), p.ID.asc()).limit(1).fetchOne(::row)
    fun titleSearch(query: String): List<PostRow> {
        val older = p.`as`("older")
        val parent = s.`as`("parent")
        val canonical = notExists(sql.selectOne().from(older.leftJoin(parent).on(older.SERIES_ID.eq(parent.ID)))
            .where(older.STATUS.eq("PUBLISHED").and(older.VISIBILITY.eq("PUBLIC")).and(older.SECTION.eq("TECH"))
                .and(older.SERIES_ID.isNull.or(parent.VISIBILITY.eq("PUBLIC")))
                .and(titleKey(older.TITLE).eq(titleKey(p.TITLE)))
                .and(older.PUBLISHED_AT.lt(p.PUBLISHED_AT).or(older.PUBLISHED_AT.eq(p.PUBLISHED_AT).and(older.ID.lt(p.ID))))))
        return sql.select(fields).from(joined).where(readable().and(p.TITLE.containsIgnoreCase(query)).and(canonical))
            .orderBy(newest).limit(7).fetch(::row)
    }
    /** 연결 교체 트랜잭션에서 ID 순서대로 호출하여 직접 DB 변경과 직렬화. */
    fun lockAttachmentStatus(id: Long): String? = sql.select(ATTACHMENTS.STATUS).from(ATTACHMENTS)
        .where(ATTACHMENTS.ID.eq(id)).forUpdate().fetchOne(ATTACHMENTS.STATUS)
    fun readableAttachment(postId: Long, attachmentId: Long): AttachmentDeliveryRow? = sql
        .select(ATTACHMENTS.OBJECT_KEY, ATTACHMENTS.CONTENT_TYPE, ATTACHMENTS.BYTE_SIZE)
        .from(joined.join(POST_ATTACHMENTS).on(POST_ATTACHMENTS.POST_ID.eq(p.ID))
            .join(ATTACHMENTS).on(ATTACHMENTS.ID.eq(POST_ATTACHMENTS.ATTACHMENT_ID)))
        .where(readable().and(p.ID.eq(postId)).and(ATTACHMENTS.ID.eq(attachmentId)).and(ATTACHMENTS.STATUS.eq("READY")))
        .fetchOne { AttachmentDeliveryRow(it.value1()!!, it.value2()!!, it.value3()!!) }
    fun attachmentRevisions(): List<String> = sql.select(POST_ATTACHMENTS.POST_ID, ATTACHMENTS.ID,
        ATTACHMENTS.OBJECT_KEY, ATTACHMENTS.CONTENT_TYPE, ATTACHMENTS.BYTE_SIZE, ATTACHMENTS.STATUS, ATTACHMENTS.UPDATED_AT)
        .from(joined.join(POST_ATTACHMENTS).on(POST_ATTACHMENTS.POST_ID.eq(p.ID))
            .join(ATTACHMENTS).on(ATTACHMENTS.ID.eq(POST_ATTACHMENTS.ATTACHMENT_ID)))
        .where(readable()).orderBy(p.ID.asc(), ATTACHMENTS.ID.asc()).fetch { it.intoArray().joinToString("\u0000") }
    private fun row(r: Record): PostRow = PostRow(r[p.ID]!!, r[p.TITLE]!!, r[p.SLUG]!!, r[p.SUMMARY]!!,
        r[p.CREATED_AT]!!, r[p.UPDATED_AT]!!, r[p.PUBLISHED_AT], PostStatus.valueOf(r[p.STATUS]!!),
        PostVisibility.valueOf(r[p.VISIBILITY]!!), r[p.CATEGORY_ID], r[s.ID]?.let {
            SeriesRef(it, r[s.SLUG]!!, r[s.NAME]!!, SeriesKind.valueOf(r[s.KIND]!!))
        }, r[p.SERIES_ORDER], r[p.RELATED_SERIES_ID], r[p.LEGACY_PATH])
}
