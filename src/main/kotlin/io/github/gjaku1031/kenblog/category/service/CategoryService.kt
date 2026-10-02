package io.github.gjaku1031.kenblog.category.service


import io.github.gjaku1031.kenblog.category.domain.CategoryConflictException
import io.github.gjaku1031.kenblog.category.domain.CategoryEntity
import io.github.gjaku1031.kenblog.category.domain.CategoryNotFoundException
import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException
import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.category.dto.CategoryTreeResponse
import io.github.gjaku1031.kenblog.category.dto.reference
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import io.github.gjaku1031.kenblog.post.repository.ContentStateRepository
import java.util.Locale
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.PessimisticLockingFailureException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 분류 경로 생성·순서 변경·삭제와 관리자 트리 집계
 */
@Service
class CategoryService(
    /**
     * 분류 저장소
     */
    private val categories: CategoryRepository,

    /**
     * 게시글 저장소
     */
    private val posts: PostRepository,

    /**
     * 콘텐츠 집합 잠금 저장소
     */
    private val state: ContentStateRepository,

    /**
     * 게시글 메타데이터 조회기
     */
    private val queries: io.github.gjaku1031.kenblog.post.repository.PostQueries
    ) {
    /**
     * 경로의 기존 중간 폴더를 잠가 재사용하고 없는 단계를 한 트랜잭션에서 생성
     *
     * 1. 경로 깊이·이름 정규화
     * 2. 트리 잠금으로 형제 집합 변경 직렬화
     * 3. 기존 중간 분류 재사용, 없는 단계는 형제의 마지막 순서로 생성
     *
     * @param path 슬래시 구분 1~2단계 입력
     * @return 새 마지막 폴더의 [CategoryRefResponse]
     * @throws InvalidCategoryRequestException 깊이·이름·기호가 잘못되었을 때
     * @throws CategoryConflictException 마지막 경로 중복 또는 동시 FK·잠금 충돌일 때
     */
    @Transactional
    fun create(path: String): CategoryRefResponse {
        // 경로 깊이·이름 정규화
        val segments = normalizePath(path)
        return try {
            // 트리 잠금으로 형제 집합 변경 직렬화
            lockTree()
            var parent: CategoryEntity? = null
            var currentPath = ""
            // 기존 중간 분류 재사용, 없는 단계는 형제의 마지막 순서로 생성
            for ((index, segment) in segments.withIndex()) {
                currentPath = if (index == 0) segment.slug else "$currentPath/${segment.slug}"
                val existing = categories.findLockedByPath(currentPath)
                if (existing != null) {
                    if (index == segments.lastIndex) throw CategoryConflictException()
                    parent = existing
                } else {
                    val siblings = categories.findSiblings(parent?.id)
                    val last = siblings.maxOfOrNull { it.sortOrder } ?: 0
                    if (last == Int.MAX_VALUE) throw CategoryConflictException()
                    parent = categories.saveAndFlush(CategoryEntity(parent?.id, currentPath, segment.name,
                        index + 1, last + 1))
                }
            }
            parent!!.reference()
        } catch (ex: DataIntegrityViolationException) {
            throw CategoryConflictException()
        } catch (ex: PessimisticLockingFailureException) {
            throw CategoryConflictException()
        }
    }

    /**
     * 분류 자체와 자손을 잠근 뒤 소속 글을 대상의 부모로 옮기고 자손부터 삭제
     *
     * 글 본문·해시·출간 상태를 변경하지 않으며 실패하면 이동과 삭제가 함께 롤백됨
     *
     * 1. 양수 ID 검사
     * 2. 트리와 삭제할 하위 분류 잠금
     * 3. 소속 글을 삭제 대상의 부모로 이동
     * 4. FK 순서를 지키도록 깊은 자손부터 삭제, 실패 시 함께 롤백
     *
     * @param id 삭제할 양수 분류 ID
     * @throws InvalidCategoryRequestException ID가 양수가 아닐 때
     * @throws CategoryNotFoundException 해당 분류가 없을 때
     * @throws CategoryConflictException 새 자손·참조의 FK 또는 잠금 경합일 때
     */
    @Transactional
    fun delete(id: Long) {
        // 양수 ID 검사
        if (id <= 0) throw InvalidCategoryRequestException()
        try {
            // 트리와 삭제할 하위 분류 잠금
            lockTree()
            val target = categories.findLockedById(id) ?: throw CategoryNotFoundException()
            val subtree = categories.findSubtreeLocked(target.path, "${target.path}/%")
            // 소속 글을 삭제 대상의 부모로 이동
            posts.moveCategories(subtree.mapNotNull { it.id }, target.parentId)
            categories.flush()
            // FK 순서를 지키도록 깊은 자손부터 삭제, 실패 시 함께 롤백
            subtree.sortedWith(compareByDescending<CategoryEntity> { it.depth }.thenByDescending { it.id }).forEach {
                categories.delete(it)
                categories.flush()
            }
        } catch (ex: DataIntegrityViolationException) {
            throw CategoryConflictException()
        } catch (ex: PessimisticLockingFailureException) {
            throw CategoryConflictException()
        }
    }

    /**
     * 한 분류의 형제 내 숫자 순서만 저장; 동률은 기존 ID 오름차순으로 정렬
     *
     * 1. ID와 저장 가능한 정수 범위 검사
     * 2. 트리·분류를 잠근 뒤 순서 변경
     */
    @Transactional
    fun setOrder(id: Long, order: Long): CategoryRefResponse {
        // ID와 저장 가능한 정수 범위 검사
        if (id <= 0 || order !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong())
            throw InvalidCategoryRequestException()
        return try {
            // 트리·분류를 잠근 뒤 순서 변경
            lockTree()
            val category = categories.findLockedById(id) ?: throw CategoryNotFoundException()
            category.reorder(order.toInt())
            categories.saveAndFlush(category).reference()
        } catch (ex: DataIntegrityViolationException) {
            throw CategoryConflictException()
        } catch (ex: PessimisticLockingFailureException) {
            throw CategoryConflictException()
        }
    }

    /**
     * 모든 빈 분류를 보존하고 초안을 포함한 글을 직접/하위 건수에 반영
     *
     * 1. 빈 분류까지 조회하고 직접 글 수 집계
     * 2. 부모별 분류 묶음 구성
     * 3. 최상위부터 자손 건수를 누적한 트리 반환
     *
     * @return 대분류부터 이어지는 [CategoryTreeResponse] 목록
     */
    @Transactional(readOnly = true)
    fun tree(): List<CategoryTreeResponse> {
        // 빈 분류까지 조회하고 직접 글 수 집계
        val all = categories.findAllByOrderByDepthAscSortOrderAscIdAsc()
        val direct = queries.categoryCounts()
            .associate { it.categoryId to it.count }
        // 부모별 분류 묶음 구성
        val children = all.groupBy { it.parentId }

        /**
         * 초안을 포함한 직접 글 수와 자손 글 수를 합산해 분류 노드 구성
         */
        fun node(category: CategoryEntity): CategoryTreeResponse {
            val descendants = children[category.id].orEmpty().map(::node)
            val ownCount = direct[category.id] ?: 0L
            return CategoryTreeResponse(category.id ?: error("Persisted category has no ID"), category.path,
                category.name, category.depth, category.sortOrder, ownCount,
                ownCount + descendants.sumOf { it.totalCount }, descendants)
        }
        // 최상위부터 자손 건수를 누적한 트리 반환
        return children[null].orEmpty().map(::node)
    }

    /**
     * 단계별 표시명과 대소문자 비민감 경로 조각을 분리하고 잘못된 기호·제어 문자를 거부
     *
     * 1. 대분류·소분류 1~2단계 입력만 허용
     * 2. 단계별 문자·길이·이름 정규화 후 경로 검사
     *
     * @param rawPath 사용자가 입력한 슬래시 경로
     * @return 순서대로 검증된 1~2단계 조각
     * @throws InvalidCategoryRequestException 단계·길이·문자 계약 위반
     */
    private fun normalizePath(rawPath: String): List<PathSegment> {
        // 대분류·소분류 1~2단계 입력만 허용
        val raw = rawPath.split('/')
        if (raw.size !in 1..2) throw InvalidCategoryRequestException()
        // 단계별 문자·길이·이름 정규화 후 경로 검사
        return raw.map { segment ->
            if (segment.any { Character.isISOControl(it) }) throw InvalidCategoryRequestException()
            val name = segment.trim().replace(Regex(" +"), " ")
            if (name.codePointCount(0, name.length) !in 1..60 || !DISPLAY_PATTERN.matches(name)) {
                throw InvalidCategoryRequestException()
            }
            val slug = name.lowercase(Locale.ROOT).replace(' ', '-')
            if (!SLUG_PATTERN.matches(slug)) throw InvalidCategoryRequestException()
            PathSegment(name, slug)
        }
    }

    /**
     * 사용자 표시명과 정규화된 경로 조각을 함께 보관
     */
    private data class PathSegment(
        /**
         * 이름
         */
        val name: String,

        /**
         * 공개 주소 식별자
         */
        val slug: String
        )

    /**
     * 분류 생성·삭제·순서 변경의 형제 집합 검증에 쓸 전역 잠금 행을 먼저 취득
     */
    private fun lockTree() { state.lockCategoryTree() ?: error("Missing content state row") }

    /**
     * 공통 상수·도우미
     */
    private companion object {
        /**
         * 분류 표시 이름 패턴
         */
        val DISPLAY_PATTERN = Regex("[\\p{L}\\p{N}]+(?:[ -][\\p{L}\\p{N}]+)*")

        /**
         * 주소 식별자 패턴
         */
        val SLUG_PATTERN = Regex("[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*")
    }
}
