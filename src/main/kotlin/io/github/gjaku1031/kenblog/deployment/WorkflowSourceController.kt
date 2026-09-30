package io.github.gjaku1031.kenblog.deployment

import io.github.gjaku1031.kenblog.content.service.RepositoryMarkdown
import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.JsonNode

/** workflow checkout이 보낸 모든 공개 본문의 출처와 실행 소유권. */
data class WorkflowSourceRequest(
    val id: String = "",
    val runId: String = "",
    val runAttempt: Int = 0,
    val bodies: Map<String, JsonNode?> = emptyMap(),
)

/** 전용 workflow bearer만 접근하는 공개 Markdown 소스 동기화 경계. */
@RestController
@RequestMapping("/api/v1/deployments/source")
class WorkflowSourceController(
    private val lifecycle: DeploymentLifecycle,
    private val markdown: RepositoryMarkdown,
) {
    /** 현재 run을 확인한 뒤 커밋·push를 기다리는 slug별 해시 반환. */
    @GetMapping
    fun pending(@RequestParam id: String, @RequestParam runId: String,
        @RequestParam runAttempt: Int): Map<String, String> {
        lifecycle.captureState(id, runId, runAttempt)
        return markdown.pendingVisibleSources()
    }

    /** 같은 배포 잠금 안에서 checkout 전체 본문을 서버 파일·DB 호환 열에 반영. */
    @PostMapping
    fun synchronize(@RequestBody request: WorkflowSourceRequest): Map<String, Int> =
        lifecycle.withCapture(request.id, request.runId, request.runAttempt) {
            if (request.bodies.values.any { it?.isTextual != true })
                throw OperationFailure(HttpStatus.BAD_REQUEST, "공개 Markdown 본문은 문자열이어야 합니다.")
            val bodies = request.bodies.mapValues { it.value!!.textValue() }
            mapOf("synchronized" to markdown.synchronizePublishedSources(bodies))
        }
}
