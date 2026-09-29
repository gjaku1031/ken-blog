package io.github.gjaku1031.kenblog.deployment

import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.bind.annotation.RequestParam

/** 세션 관리자만 조회·시작·원격 종료 확인을 할 수 있는 배포 API. */
@RestController
@RequestMapping("/api/v1/admin/deployments")
class AdminDeploymentController(private val lifecycle: DeploymentLifecycle) {
    /** 현재 배포 상태를 반환. */
    @GetMapping
    fun current(): DeploymentState = lifecycle.current()

    /** 동일 게이트로 수동 Pages 배포를 요청. */
    @PostMapping
    fun start(): DeploymentState = lifecycle.startManual()

    /** Actions의 실제 terminal 상태를 조회하고 누락된 완료 콜백을 복구. */
    @PostMapping("/recover")
    fun recover(): DeploymentState = lifecycle.recover()

    /** 원격에 실행이 존재하지 않는 미귀속 QUEUED를 운영자가 명시적으로 폐기. */
    @PostMapping("/{id}/abandon")
    fun abandon(@PathVariable id: String): DeploymentState = lifecycle.abandon(id)
}

/** GitHub Actions run 번호가 포함된 claim 요청. */
data class ClaimRequest(val operationId: String? = null, val runId: String = "", val runAttempt: Int = 0)

/** 터미널 Pages 결과를 동일 run에 귀속하는 요청. */
data class CompleteRequest(val runId: String = "", val runAttempt: Int = 0, val status: String = "")

/** 종료 이벤트의 정확한 run/attempt만 복구를 요청. */
data class RecoverRequest(val runId: String = "", val runAttempt: Int = 0)

/** 전용 bearer 체인을 통과한 워크플로만 사용할 수 있는 배포 콜백 API. */
@RestController
@RequestMapping("/api/v1/deployments")
class WorkflowDeploymentController(private val lifecycle: DeploymentLifecycle) {
    /** 사전 생성된 operation을 점유하거나 push/manual run용 게이트를 생성. */
    @PostMapping("/claim")
    fun claim(@RequestBody request: ClaimRequest): DeploymentState =
        lifecycle.claim(request.operationId, request.runId, request.runAttempt)

    /** 공개 콘텐츠 수집 구간의 소유권을 짧게 재검사. */
    @GetMapping("/capture-state")
    fun captureState(@RequestParam id: String, @RequestParam runId: String, @RequestParam runAttempt: Int): DeploymentState =
        lifecycle.captureState(id, runId, runAttempt)

    /** 동일 배포 ID와 run ID의 종료만 받아 쓰기 차단을 해제. */
    @PostMapping("/{id}/complete")
    fun complete(@PathVariable id: String, @RequestBody request: CompleteRequest): DeploymentState =
        lifecycle.complete(id, request.runId, request.runAttempt, request.status)

    /** 별도 workflow_run completed 이벤트의 정확한 실행만 최종 확인. */
    @PostMapping("/recover")
    fun recover(@RequestBody request: RecoverRequest): DeploymentState = lifecycle.recover(request.runId, request.runAttempt)
}
