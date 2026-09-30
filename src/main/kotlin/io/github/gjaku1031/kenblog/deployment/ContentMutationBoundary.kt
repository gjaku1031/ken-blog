package io.github.gjaku1031.kenblog.deployment

import io.github.gjaku1031.kenblog.post.domain.PostStatus
import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.post.domain.PostEntity
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse
import org.aspectj.lang.ProceedingJoinPoint
import org.aspectj.lang.annotation.Around
import org.aspectj.lang.annotation.Aspect
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component

/** 명시한 콘텐츠 서비스 진입점을 잠금·트랜잭션으로 감싸고 외곽 변경만 배포로 연결. */
@Aspect
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
class ContentMutationBoundary(private val lifecycle: DeploymentLifecycle) {
    private val entered = ThreadLocal<Boolean>()

    /** 내부 저장·로컬 파일 I/O 종료까지 경계를 유지하며 서비스 이름 목록을 별도로 관리하지 않음. */
    @Around("@annotation(mutation)")
    fun guard(joinPoint: ProceedingJoinPoint, mutation: ContentMutation): Any? {
        if (entered.get() == true) return joinPoint.proceed()
        entered.set(true)
        try {
            val externalIo = mutation.externalIo || mutation.externalIoArgument >= 0 &&
                joinPoint.args.getOrNull(mutation.externalIoArgument) != null
            return lifecycle.mutate(mutation.atomic, externalIo,
                { joinPoint.proceed() }, { result ->
                    when (mutation.publication) {
                        PublicationChange.NEVER -> false
                        PublicationChange.ALWAYS -> true
                        PublicationChange.IF_PUBLISHED -> published(result)
                    }
                })
        } finally {
            entered.remove()
        }
    }

    /** 초안 준비를 공개 변경으로 오인하지 않도록 반환된 원고 상태를 검사. */
    private fun published(result: Any?): Boolean = when (result) {
        is PostEntity -> result.status == PostStatus.PUBLISHED && result.visibility == PostVisibility.PUBLIC
        is PostDetailResponse -> result.status == PostStatus.PUBLISHED && result.visibility == PostVisibility.PUBLIC
        else -> false
    }
}
