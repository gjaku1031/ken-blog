package io.github.gjaku1031.kenblog.category.service

import io.github.gjaku1031.kenblog.category.domain.CategoryConflictException
import io.github.gjaku1031.kenblog.category.domain.CategoryEntity
import io.github.gjaku1031.kenblog.category.domain.CategoryNotFoundException
import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException
import io.github.gjaku1031.kenblog.category.dto.CategoryRefResponse
import io.github.gjaku1031.kenblog.category.dto.CategoryTreeResponse
import io.github.gjaku1031.kenblog.category.dto.reference
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository
import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.repository.PostRepository
import java.util.Locale
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.PessimisticLockingFailureException
import org.springframework.security.core.Authentication
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 경로 생성·하위 글 이동 삭제·권한별 분류 트리 집계를 담당하는 구체 서비스. */
@Service
class CategoryService(private val categories: CategoryRepository, private val posts: PostRepository) {
    /**
     * 경로의 기존 중간 폴더를 잠가 재사용하고 없는 단계를 한 트랜잭션에서 생성.
     *
     * @param path 슬래시 구분 1~3단계 입력
     * @return 새 마지막 폴더의 [CategoryRefResponse]
     * @throws InvalidCategoryRequestException 깊이·이름·기호가 잘못되었을 때
     * @throws CategoryConflictException 마지막 경로 중복 또는 동시 FK·잠금 충돌일 때
     */
    @Transactional
    fun create(path: String): CategoryRefResponse {
        val segments = normalizePath(path)
        return try {
            var parent: CategoryEntity? = null
            var currentPath = ""
            for ((index, segment) in segments.withIndex()) {
                currentPath = if (index == 0) segment.slug else "$currentPath/${segment.slug}"
                val existing = categories.findLockedByPath(currentPath)
                if (existing != null) {
                    if (index == segments.lastIndex) throw CategoryConflictException()
                    parent = existing
                } else {
                    parent = categories.saveAndFlush(CategoryEntity(parent?.id, currentPath, segment.name, index + 1))
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
     * 분류 자체와 자손을 잠근 뒤 소속 글을 대상의 부모로 옮기고 자손부터 삭제.
     *
     * 글 본문·해시·출간 상태를 변경하지 않으며 실패하면 이동과 삭제가 함께 롤백됨.
     *
     * @param id 삭제할 양수 분류 ID
     * @throws InvalidCategoryRequestException ID가 양수가 아닐 때
     * @throws CategoryNotFoundException 해당 분류가 없을 때
     * @throws CategoryConflictException 새 자손·참조의 FK 또는 잠금 경합일 때
     */
    @Transactional
    fun delete(id: Long) {
        if (id <= 0) throw InvalidCategoryRequestException()
        try {
            val target = categories.findLockedById(id) ?: throw CategoryNotFoundException()
            val subtree = categories.findSubtreeLocked(target.path, "${target.path}/%")
            posts.moveCategories(subtree.mapNotNull { it.id }, target.parentId)
            categories.flush()
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
     * 모든 빈 분류를 보존하고 현재 역할로 읽을 수 있는 글만 직접/하위 건수에 반영.
     *
     * @param admin 관리자 집계이면 초안까지 포함
     * @param authentication 공개 조회의 USER·ADMIN 권한 검사 대상
     * @return 대분류부터 이어지는 [CategoryTreeResponse] 목록
     */
    @Transactional(readOnly = true)
    fun tree(admin: Boolean, authentication: Authentication?): List<CategoryTreeResponse> {
        val all = categories.findAllByOrderByDepthAscPathAsc()
        val includePrivate = authentication?.authorities?.any { it.authority == "ROLE_USER" || it.authority == "ROLE_ADMIN" } == true
        val direct = posts.countByCategoryForRole(admin, PostStatus.PUBLISHED, PostVisibility.PUBLIC, includePrivate)
            .associate { it.categoryId to it.count }
        val children = all.groupBy { it.parentId }
        /** 현재 폴더와 모든 자손의 권한별 글 수를 합산한 트리 노드를 구성. */
        fun node(category: CategoryEntity): CategoryTreeResponse {
            val descendants = children[category.id].orEmpty().map(::node)
            val ownCount = direct[category.id] ?: 0L
            return CategoryTreeResponse(category.id ?: error("Persisted category has no ID"), category.path,
                category.name, category.depth, ownCount, ownCount + descendants.sumOf { it.totalCount }, descendants)
        }
        return children[null].orEmpty().map(::node)
    }

    /**
     * 단계별 표시명과 대소문자 비민감 경로 조각을 분리하고 잘못된 기호·제어 문자를 거부.
     *
     * @param rawPath 사용자가 입력한 슬래시 경로
     * @return 순서대로 검증된 1~3단계 조각
     * @throws InvalidCategoryRequestException 단계·길이·문자 계약 위반
     */
    private fun normalizePath(rawPath: String): List<PathSegment> {
        val raw = rawPath.split('/')
        if (raw.size !in 1..3) throw InvalidCategoryRequestException()
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

    /** 사용자 표시명과 정규화된 경로 조각을 함께 보관. */
    private data class PathSegment(val name: String, val slug: String)

    private companion object {
        val DISPLAY_PATTERN = Regex("[\\p{L}\\p{N}]+(?:[ -][\\p{L}\\p{N}]+)*")
        val SLUG_PATTERN = Regex("[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*")
    }
}
