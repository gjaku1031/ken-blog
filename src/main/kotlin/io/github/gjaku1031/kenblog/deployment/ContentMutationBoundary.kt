package io.github.gjaku1031.kenblog.deployment

import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import org.aspectj.lang.ProceedingJoinPoint
import org.aspectj.lang.annotation.Around
import org.aspectj.lang.annotation.Aspect
import org.springframework.aop.support.AopUtils
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component

/** 서비스 쓰기 전체를 배포 경계에 넣고 성공한 공개 변경만 커밋 뒤 dispatch. */
@Aspect
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
class ContentMutationBoundary(private val lifecycle: DeploymentLifecycle) {
    private val scope = ThreadLocal<CallScope?>()

    /* 외부 HTTP 방식이나 MCP 도구 이름에 의존하지 않는 쓰기 서비스 메서드 계약. */
    private val mutations = mapOf(
        "PostService" to setOf("createDraft", "createDraftFromEditor", "updateDraft", "deleteDraft", "publish", "unpublish",
            "createDraftDetail", "updateDraftDetail", "replaceWikiLinks", "publishDetail", "unpublishDetail",
            "replaceTaxonomy", "createProjectPost", "updateProjectPost", "publishProjectPost",
            "relateTechPost", "setTechSeriesOrder", "replaceSummary", "createChapterPost", "updateChapterPost", "publishChapterPost"),
        "EditorDraftService" to setOf("create", "update", "delete", "publish"),
        "ProjectService" to setOf("createProject", "attachHome", "updateHome", "setOrder", "deleteDocument", "deleteProject"),
        "CourseService" to setOf("create", "update", "deleteChapter", "delete"),
        "CategoryService" to setOf("create", "delete", "setOrder"),
        "StackBadgeService" to setOf("replaceProjectStack", "create", "rename", "replaceImage", "delete"),
        "HomeProfileService" to setOf("update", "save", "uploadPhoto", "removePhoto"),
        "AttachmentService" to setOf("upload", "delete"),
        "AttachmentMetadataService" to setOf("createPending", "markReady", "beginDelete", "claimFailedUpload", "finishDelete"),
        "AttachmentLinkService" to setOf("replacePost", "replaceDraft", "publishDraft"),
        "WikiLinkMetadata" to setOf("replacePost", "replaceDraft", "publishDraft"),
    )
    private val publicMutations = mapOf(
        "PostService" to setOf("deleteDraft", "updateDraft", "updateDraftDetail", "updateProjectPost", "updateChapterPost",
            "publish", "unpublish", "publishDetail", "unpublishDetail", "replaceWikiLinks", "replaceTaxonomy",
            "publishProjectPost", "relateTechPost", "setTechSeriesOrder", "replaceSummary", "publishChapterPost"),
        "EditorDraftService" to setOf("publish"),
        "ProjectService" to setOf("createProject", "attachHome", "updateHome", "setOrder", "deleteDocument", "deleteProject"),
        "CourseService" to setOf("create", "update", "deleteChapter", "delete"),
        "CategoryService" to setOf("create", "delete", "setOrder"),
        "StackBadgeService" to setOf("replaceProjectStack", "create", "rename", "replaceImage", "delete"),
        "HomeProfileService" to setOf("update", "save", "uploadPhoto", "removePhoto"),
    )

    /** 가장 바깥 서비스 호출만 잠금을 획득해 중첩 저장·OCI 작업·DB 커밋까지 포함. */
    @Around("execution(public * io.github.gjaku1031.kenblog..service.*.*(..))")
    fun guard(joinPoint: ProceedingJoinPoint): Any? {
        val type = AopUtils.getTargetClass(joinPoint.target).simpleName
        val method = joinPoint.signature.name
        if (method !in mutations[type].orEmpty()) return joinPoint.proceed()
        val existing = scope.get()
        if (existing != null) {
            // 복합 발행의 외곽 메서드가 공개 여부를 판단. 내부 초안 준비를 공개로 오인하지 않음.
            return joinPoint.proceed()
        }
        val current = CallScope()
        scope.set(current)
        try {
            val externalIo = type == "StackBadgeService" && method in setOf("create", "replaceImage") ||
                type == "HomeProfileService" && (method == "uploadPhoto" ||
                    method == "save" && joinPoint.args.getOrNull(1) != null)
            return lifecycle.mutate(type !in setOf("AttachmentService", "AttachmentMetadataService"), externalIo,
                {
                    val value = joinPoint.proceed()
                    if (isPublicChange(type, method, value)) current.publicChanged = true
                    value
                }, { current.publicChanged })
        } finally {
            scope.remove()
        }
    }

    /** 반환된 글이 공개 출간 상태인 수정만 배포 대상으로 삼고 삭제는 보수적으로 포함. */
    private fun isPublicChange(type: String, method: String, result: Any?): Boolean {
        if (method !in publicMutations[type].orEmpty()) return false
        if (type == "PostService" && method in setOf("updateDraft", "updateProjectPost", "updateChapterPost")) {
            val post = result as? PostEntity ?: return false
            return post.status == PostStatus.PUBLISHED && post.visibility == PostVisibility.PUBLIC
        }
        if (type == "PostService" && method == "updateDraftDetail") {
            val detail = result as? PostDetailResponse ?: return false
            return detail.status == PostStatus.PUBLISHED && detail.visibility == PostVisibility.PUBLIC
        }
        if (type == "PostService" && method in setOf("replaceWikiLinks", "replaceTaxonomy")) {
            val detail = result as? PostDetailResponse ?: return false
            return detail.status == PostStatus.PUBLISHED && detail.visibility == PostVisibility.PUBLIC
        }
        if (type == "PostService" && method in setOf("relateTechPost", "setTechSeriesOrder", "replaceSummary")) {
            return true // 직접 호출은 출간 원문 변경; 편집본 발행의 중첩 호출은 외곽 커밋 뒤 합쳐짐.
        }
        return true
    }

    /** 중첩 호출에서 출간 사실을 외곽 트랜잭션 종료까지 보관. */
    private class CallScope(var publicChanged: Boolean = false)
}
