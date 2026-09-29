package io.github.gjaku1031.kenblog.deployment

import io.github.gjaku1031.kenblog.mcp.service.McpToolCalls
import org.springframework.ai.mcp.annotation.McpTool
import org.springframework.ai.mcp.annotation.McpToolParam
import org.springframework.stereotype.Component

/** 로컬 MCP 관리자에게 배포 상태와 동일한 수동·복구 경로를 제공. */
@Component
class McpDeploymentTools(private val lifecycle: DeploymentLifecycle, private val calls: McpToolCalls) {
    /** DB에 커밋된 배포 상태를 조회. */
    @McpTool(name = "blog_get_deployment", description = "현재 Pages 배포의 ID, 상태, Actions run, 오류를 조회합니다.", annotations = McpTool.McpAnnotations(readOnlyHint = true, destructiveHint = false, openWorldHint = false))
    fun status() = calls.call { lifecycle.current() }

    /** 관리 화면과 같은 게이트로 새 Pages 배포를 요청. */
    @McpTool(name = "blog_start_deployment", description = "수동 Pages 배포를 시작합니다. 진행 중인 배포가 있으면 충돌을 반환합니다.", annotations = McpTool.McpAnnotations(openWorldHint = true))
    fun start() = calls.call { lifecycle.startManual() }

    /** GitHub에서 종료를 확인한 배포의 누락된 콜백을 복구. */
    @McpTool(name = "blog_recover_deployment", description = "GitHub Actions의 종료 상태를 조회해 완료 콜백이 유실된 배포만 복구합니다.", annotations = McpTool.McpAnnotations(openWorldHint = true))
    fun recover() = calls.call { lifecycle.recover() }

    /** GitHub에 run이 없고 claim된 적 없는 정확한 QUEUED만 폐기. */
    @McpTool(name = "blog_abandon_queued_deployment", description = "GitHub 실행이 없는 미귀속 QUEUED 배포 ID만 명시적으로 폐기합니다. 원고는 되돌리지 않습니다.", annotations = McpTool.McpAnnotations(openWorldHint = true))
    fun abandon(@McpToolParam(description = "현재 blog_get_deployment가 반환한 operation ID") operationId: String) =
        calls.call { lifecycle.abandon(operationId) }
}
