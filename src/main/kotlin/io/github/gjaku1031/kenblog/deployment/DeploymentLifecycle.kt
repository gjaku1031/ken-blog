package io.github.gjaku1031.kenblog.deployment

import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.write
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager

/** 단일 JVM에서 콘텐츠 커밋·OCI 완료와 배포 게이트 전환을 직렬화. */
@Service
class DeploymentLifecycle(
    private val store: DeploymentStateStore,
    private val github: GitHubDeploymentClient,
    manager: PlatformTransactionManager,
    @Value("\${app.deployment.enabled:false}") private val enabled: Boolean,
) {
    private val boundary = ReentrantReadWriteLock(true)
    private val transactions = TransactionTemplate(manager)
    private val active = setOf("QUEUED", "RUNNING")
    private val dispatching = ConcurrentHashMap.newKeySet<String>()

    /** 공개 DB 변경은 QUEUED와 함께 커밋하고 OCI 변경은 사전 게이트를 사용. */
    fun <T> mutate(publicCandidate: Boolean, externalIo: Boolean, block: () -> T, changed: (T) -> Boolean): T {
        val outcome = boundary.write {
            if (store.current().status in active) throw locked()
            if (!enabled || !publicCandidate) return@write Mutation(block(), null)
            if (externalIo) {
                val reserved = queue("PUBLICATION")
                try {
                    val value = block()
                    if (changed(value)) Mutation(value, reserved.id)
                    else {
                        store.change { old -> old.copy(status = "CANCELLED", version = old.version + 1) to Unit }
                        dispatching.remove(reserved.id)
                        Mutation(value, null)
                    }
                } catch (ex: Throwable) {
                    store.change { old ->
                        if (old.id != reserved.id || old.status != "QUEUED" || old.runId != null) old to Unit
                        else old.copy(status = "CANCELLED", error = "콘텐츠 변경이 완료되지 않았습니다.", version = old.version + 1) to Unit
                    }
                    dispatching.remove(reserved.id)
                    throw ex
                }
            } else {
                transactions.execute {
                    val value = block()
                    Mutation(value, if (changed(value)) queue("PUBLICATION").id else null)
                } ?: error("콘텐츠 변경 트랜잭션 결과가 없습니다.")
            }
        }
        if (outcome.operationId != null) dispatch(outcome.operationId, reportFailure = false)
        return outcome.value
    }

    fun current(): DeploymentState = store.current()

    /** 관리자 수동 배포 요청도 발행과 같은 게이트를 사용. */
    fun startManual(): DeploymentState {
        ensureEnabled()
        val queued = boundary.write {
            if (store.current().status in active) throw conflict()
            queue("MANUAL")
        }
        return dispatch(queued.id ?: error("배포 ID가 없습니다."), reportFailure = true)
    }

    /** runner가 콘텐츠·이미지를 수집할 때 소유권을 재확인. */
    fun captureState(id: String, runId: String, runAttempt: Int): DeploymentState {
        validOperationId(id)
        validRunId(runId)
        validAttempt(runAttempt)
        val state = store.current()
        if (state.id != id || state.status != "RUNNING" || state.runId != runId || state.runAttempt != runAttempt) throw conflict()
        return state
    }

    /** 정확한 GitHub 실행 시도를 확인한 뒤에만 capture 소유권을 부여. */
    fun claim(operationId: String?, runId: String, runAttempt: Int): DeploymentState {
        ensureEnabled()
        validRunId(runId)
        validAttempt(runAttempt)
        val supplied = operationId?.takeIf(String::isNotBlank)
        if (supplied != null) validOperationId(supplied)
        val remote = github.run(runId, supplied)
        if (remote.attempt != runAttempt || remote.finished) throw conflict()
        return boundary.write {
            store.change { old ->
                if (supplied == null) {
                    if (old.status in active) throw conflict()
                    val next = DeploymentState(UUID.randomUUID().toString(), "RUNNING", runId, runAttempt,
                        remote.htmlUrl ?: github.runUrl(runId), null, "WORKFLOW", old.version + 1,
                        old.lastSuccessfulOperationId)
                    next to next
                } else {
                    if (old.id != supplied || old.status !in active ||
                        (old.runId != null && old.runId != runId) ||
                        (old.runAttempt != null && old.runAttempt != runAttempt)) throw conflict()
                    if (old.status == "RUNNING") old to old
                    else {
                        val next = old.copy(status = "RUNNING", runId = runId, runAttempt = runAttempt,
                            htmlUrl = remote.htmlUrl ?: github.runUrl(runId), version = old.version + 1)
                        next to next
                    }
                }
            }
        }
    }

    /** Pages step 성공과 공개 marker가 모두 확인된 경우만 즉시 성공 처리. */
    fun complete(id: String, runId: String, runAttempt: Int, result: String): DeploymentState {
        ensureEnabled()
        if (result !in setOf("SUCCEEDED", "FAILED", "CANCELLED")) throw badRequest()
        val previous = store.current()
        if (previous.id == id && previous.runId == runId && previous.runAttempt == runAttempt &&
            previous.status !in active) {
            if (previous.status == result || previous.status == "FAILED" && result == "CANCELLED") return previous
            throw conflict()
        }
        val snapshot = captureState(id, runId, runAttempt)
        val remote = github.run(runId, id.takeIf { snapshot.source != "WORKFLOW" })
        if (remote.attempt != runAttempt) throw conflict()
        val step = github.pagesStep(runId, runAttempt)
        if (result == "SUCCEEDED") {
            if (step != "success" || !github.markerMatches(id, remote)) throw uncertainPages()
            return finish(id, runId, runAttempt, true, remote)
        }
        // 마지막 callback 단계에서는 workflow 자체가 아직 completed가 아닐 수 있음.
        if (!remote.finished) return snapshot
        if (step == "success") {
            if (!github.markerMatches(id, remote)) throw uncertainPages()
            return finish(id, runId, runAttempt, true, remote)
        }
        if (step !in setOf("failure", "skipped", "cancelled") &&
            !(step == "not_started" && remote.conclusion in setOf("failure", "cancelled", "timed_out", "stale")))
            throw uncertainPages()
        return finish(id, runId, runAttempt, false, remote)
    }

    /** callback 유실과 취소를 실제 원격 종료·Pages 단계로 검증해 복구. */
    fun recover(expectedRunId: String? = null, expectedAttempt: Int? = null): DeploymentState {
        ensureEnabled()
        val snapshot = store.current()
        if (snapshot.status !in active) return snapshot
        val id = snapshot.id ?: throw conflict()
        val remote = if (snapshot.runId != null) github.run(snapshot.runId, id.takeIf { snapshot.source != "WORKFLOW" })
            else github.findByOperation(id)
        if (remote == null) throw OperationFailure(HttpStatus.CONFLICT, "배포 실행을 확인할 수 없습니다. 쓰기 차단은 유지됩니다.")
        if ((expectedRunId != null && remote.id != expectedRunId) ||
            (expectedAttempt != null && remote.attempt != expectedAttempt) ||
            (snapshot.runId != null && snapshot.runId != remote.id) ||
            (snapshot.runAttempt != null && snapshot.runAttempt != remote.attempt)) throw conflict()
        if (!remote.finished) return boundary.write {
            store.change { old ->
                if (old.id != id || old.status !in active) throw conflict()
                val next = old.copy(runId = remote.id, runAttempt = remote.attempt, htmlUrl = remote.htmlUrl,
                    status = "RUNNING", version = old.version + 1)
                next to next
            }
        }
        val step = github.pagesStep(remote.id, remote.attempt)
        if (step == "success") {
            if (!github.markerMatches(id, remote)) throw uncertainPages()
            return finish(id, remote.id, remote.attempt, true, remote)
        }
        if (step !in setOf("failure", "skipped", "cancelled") &&
            !(step == "not_started" && remote.conclusion in setOf("failure", "cancelled", "timed_out", "stale")))
            throw uncertainPages()
        return finish(id, remote.id, remote.attempt, false, remote)
    }

    /** 미귀속 QUEUED만 명시적으로 폐기; 뒤늦은 run은 claim 거부. */
    fun abandon(id: String): DeploymentState {
        ensureEnabled()
        validOperationId(id)
        val snapshot = store.current()
        if (snapshot.id != id || snapshot.status != "QUEUED" || snapshot.runId != null || id in dispatching) throw conflict()
        if (github.findByOperation(id) != null) throw conflict()
        return boundary.write {
            store.change { old ->
                if (old.id != id || old.status != "QUEUED" || old.runId != null || id in dispatching) throw conflict()
                val next = old.copy(status = "CANCELLED", error = "미귀속 배포 요청을 관리자가 폐기했습니다.", version = old.version + 1)
                next to next
            }
        }
    }

    private fun finish(id: String, runId: String, attempt: Int, success: Boolean, remote: GitHubRun): DeploymentState = boundary.write {
        store.change { old ->
            if (old.id != id || (old.runId != null && old.runId != runId) ||
                (old.runAttempt != null && old.runAttempt != attempt)) throw conflict()
            val terminal = if (success) "SUCCEEDED" else "FAILED"
            if (old.status == terminal) old to old
            else {
                if (old.status !in active) throw conflict()
                val next = old.copy(status = terminal, runId = runId, runAttempt = attempt,
                    htmlUrl = remote.htmlUrl ?: github.runUrl(runId),
                    error = if (success) null else "Pages 배포가 완료되지 않았습니다.",
                    lastSuccessfulOperationId = if (success) id else old.lastSuccessfulOperationId,
                    version = old.version + 1)
                next to next
            }
        }
    }

    private fun queue(source: String): DeploymentState = store.change { old ->
        if (old.status in active) throw conflict()
        val id = UUID.randomUUID().toString()
        val next = DeploymentState(id, "QUEUED", null, null, null, null, source,
            old.version + 1, old.lastSuccessfulOperationId)
        dispatching.add(id)
        if (TransactionSynchronizationManager.isSynchronizationActive())
            TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
                override fun afterCompletion(status: Int) {
                    if (status != TransactionSynchronization.STATUS_COMMITTED) dispatching.remove(id)
                }
            })
        next to next
    }

    /** GitHub 호출은 콘텐츠·상태 DB transaction 밖에서만 수행. */
    private fun dispatch(id: String, reportFailure: Boolean): DeploymentState {
        val outcome = github.dispatch(id)
        try {
            val state = when (outcome) {
            is DispatchOutcome.Accepted -> boundary.write {
                store.change { old ->
                    if (old.id != id || old.status !in active) old to old
                    else if (old.runId != null && old.runId != outcome.runId) throw conflict()
                    else {
                        val next = old.copy(runId = outcome.runId, runAttempt = old.runAttempt ?: 1,
                            htmlUrl = outcome.htmlUrl ?: github.runUrl(outcome.runId), version = old.version + 1)
                        next to next
                    }
                }
            }
            DispatchOutcome.AcceptedWithoutIdentity -> store.current()
            DispatchOutcome.Rejected -> boundary.write {
                store.change { old ->
                    if (old.id != id || old.status != "QUEUED" || old.runId != null) old to old
                    else {
                        val next = old.copy(status = "FAILED", error = "GitHub 배포 요청이 거부되었습니다.", version = old.version + 1)
                        next to next
                    }
                }
            }
            DispatchOutcome.Uncertain -> store.current()
            }
            if (reportFailure && (outcome == DispatchOutcome.Rejected || outcome == DispatchOutcome.Uncertain))
                throw OperationFailure(HttpStatus.SERVICE_UNAVAILABLE, "배포 요청 결과가 불확실합니다. 배포 상태를 확인하세요.")
            return state
        } finally {
            dispatching.remove(id)
        }
    }

    private fun ensureEnabled() { if (!enabled) throw OperationFailure(HttpStatus.SERVICE_UNAVAILABLE, "배포 기능이 설정되지 않았습니다.") }
    private fun validRunId(id: String) { if (!id.matches(Regex("[1-9][0-9]{0,19}"))) throw badRequest() }
    private fun validAttempt(attempt: Int) { if (attempt <= 0) throw badRequest() }
    private fun validOperationId(id: String) { try { UUID.fromString(id) } catch (_: Exception) { throw badRequest() } }
    private fun conflict() = OperationFailure(HttpStatus.CONFLICT, "다른 배포가 진행 중이거나 배포 ID가 일치하지 않습니다.")
    private fun locked() = OperationFailure(HttpStatus.CONFLICT, "배포 중에는 콘텐츠를 변경할 수 없습니다.", "CONTENT_WRITE_LOCKED")
    private fun badRequest() = OperationFailure(HttpStatus.BAD_REQUEST, "배포 요청 값을 확인하세요.")
    private fun uncertainPages() = OperationFailure(HttpStatus.SERVICE_UNAVAILABLE, "Pages 결과를 확인하지 못했습니다. 쓰기 차단은 유지됩니다.")
    private data class Mutation<T>(val value: T, val operationId: String?)
}
