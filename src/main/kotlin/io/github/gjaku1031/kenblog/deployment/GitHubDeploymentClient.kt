package io.github.gjaku1031.kenblog.deployment

import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import io.github.gjaku1031.kenblog.operations.domain.OperationFailure
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/** GitHub Actions의 dispatch와 원격 종료 상태만 조회하며 인증값과 응답 본문은 로그에 남기지 않음. */
class GitHubDeploymentClient(
    private val mapper: ObjectMapper,
    private val token: String,
    private val repository: String,
    private val workflow: String,
    private val ref: String,
    private val markerUrl: String = "https://gjaku1031.github.io/ken-blog/deployment.json",
    private val apiBase: String = "https://api.github.com",
) {
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build()
    private val root = "$apiBase/repos/$repository"

    /** 구성된 저장소의 Actions 실행 링크를 반환. */
    fun runUrl(runId: String): String = "https://github.com/$repository/actions/runs/$runId"

    /** 확정 거부와 전달 불확실성을 구분하여 호출자에게 반환. */
    fun dispatch(id: String): DispatchOutcome {
        if (token.isBlank()) return DispatchOutcome.Rejected
        val payload = try {
            mapper.writeValueAsString(mapOf("ref" to ref, "inputs" to mapOf("deploymentId" to id)))
        } catch (_: Exception) {
            return DispatchOutcome.Rejected
        }
        return try {
            val response = http.send(request("$root/actions/workflows/$workflow/dispatches")
                .POST(HttpRequest.BodyPublishers.ofString(payload)).build(), HttpResponse.BodyHandlers.ofString())
            when (response.statusCode()) {
                200 -> {
                    val node = mapper.readTree(response.body())
                    val runId = node.get("workflow_run_id")?.asText()
                    if (runId == null || !runId.matches(Regex("[1-9][0-9]{0,19}"))) DispatchOutcome.Uncertain
                    else DispatchOutcome.Accepted(runId, node.get("html_url")?.asText())
                }
                204 -> DispatchOutcome.AcceptedWithoutIdentity // 이전 API 버전 호환.
                in 400..499 -> DispatchOutcome.Rejected
                else -> DispatchOutcome.Uncertain
            }
        } catch (_: Exception) {
            DispatchOutcome.Uncertain
        }
    }

    /** 설정된 저장소·워크플로·브랜치와 요청한 operation에 속한 run만 반환. */
    fun run(runId: String, operationId: String? = null): GitHubRun {
        val node = read("$root/actions/runs/$runId")
        return parseRun(node, operationId).also { if (it.id != runId) throw remoteFailure() }
    }

    /** dispatch 응답이 유실된 경우 run-name의 operation ID로 실제 run을 탐색. */
    fun findByOperation(id: String): GitHubRun? {
        for (page in 1..10) {
            val node = read("$root/actions/workflows/$workflow/runs?event=workflow_dispatch&per_page=100&page=$page")
            val runs = node.get("workflow_runs") ?: return null
            for (run in runs) {
                if (run.get("display_title")?.asText() == "Pages $id") return parseRun(run, id)
            }
            if (runs.size() < 100) return null
            if (page == 10) throw remoteFailure() // 조회 범위 밖을 '실행 없음'으로 오인하지 않음.
        }
        return null
    }

    /** 동일 run attempt의 Pages action 단계 결론만 조회. */
    fun pagesStep(runId: String, attempt: Int): String? {
        val node = read("$root/actions/runs/$runId/attempts/$attempt/jobs?per_page=100")
        val jobs = node.get("jobs") ?: throw remoteFailure()
        if (node.get("total_count")?.asInt() != jobs.size()) throw remoteFailure()
        val steps = jobs.flatMap { job -> job.get("steps")?.toList().orEmpty() }
        return steps.singleOrNull { it.get("name")?.asText() == "Deploy completed artifact" }
            ?.get("conclusion")?.asText() ?: "not_started"
    }

    /** 공개 사이트가 해당 실행 시도의 marker를 실제 제공하는지 확인. */
    fun markerMatches(id: String, run: GitHubRun): Boolean {
        val url = "$markerUrl?operationId=$id&runId=${run.id}&attempt=${run.attempt}"
        val response = try {
            http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(15))
                .header("Cache-Control", "no-cache").GET().build(), HttpResponse.BodyHandlers.ofString())
        } catch (_: Exception) { return false }
        if (response.statusCode() != 200 || response.body().length > 2048) return false
        val node = try { mapper.readTree(response.body()) } catch (_: Exception) { return false }
        return node.get("operationId")?.asText() == id && node.get("runId")?.asText() == run.id &&
            node.get("runAttempt")?.asInt() == run.attempt && node.get("sourceSha")?.asText() == run.headSha
    }

    /** GitHub 응답의 실행 출처를 검증하고 종료 여부와 Pages URL을 정규화. */
    private fun parseRun(node: tools.jackson.databind.JsonNode, operationId: String? = null): GitHubRun {
        val path = node.get("path")?.asText()
        val expectedPath = ".github/workflows/$workflow"
        val repositoryName = node.get("repository")?.get("full_name")?.asText()
        val event = node.get("event")?.asText()
        if (repositoryName?.equals(repository, ignoreCase = true) != true ||
            path !in setOf(expectedPath, "$expectedPath@$ref", "$expectedPath@refs/heads/$ref") ||
            node.get("head_branch")?.asText() != ref || event !in setOf("push", "workflow_dispatch") ||
            (operationId != null && (event != "workflow_dispatch" || node.get("display_title")?.asText() != "Pages $operationId"))) {
            throw remoteFailure()
        }
        val id = node.get("id")?.asText() ?: throw remoteFailure()
        val finished = node.get("status")?.asText() == "completed"
        val conclusion = if (finished) node.get("conclusion")?.asText() else null
        val htmlUrl = node.get("html_url")?.asText()
        val attempt = node.get("run_attempt")?.asInt() ?: throw remoteFailure()
        val headSha = node.get("head_sha")?.asText() ?: throw remoteFailure()
        if (attempt <= 0 || !headSha.matches(Regex("[0-9a-f]{40}"))) throw remoteFailure()
        return GitHubRun(id, attempt, finished, conclusion, htmlUrl, headSha)
    }

    /** 인증 헤더를 포함한 읽기 요청을 수행하고 오류 본문은 폐기. */
    private fun read(url: String): tools.jackson.databind.JsonNode {
        if (token.isBlank()) throw remoteFailure()
        val response = try {
            http.send(request(url).GET().build(), HttpResponse.BodyHandlers.ofString())
        } catch (_: Exception) {
            throw remoteFailure()
        }
        if (response.statusCode() != 200) throw remoteFailure()
        return try { mapper.readTree(response.body()) } catch (_: Exception) { throw remoteFailure() }
    }

    /** 허용된 GitHub API 경로와 고정 시간제한을 가진 요청 빌더. */
    private fun request(url: String): HttpRequest.Builder = HttpRequest.newBuilder(URI.create(url))
        .timeout(Duration.ofSeconds(20))
        .header("Authorization", "Bearer $token")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2026-03-10")
        .header("Content-Type", "application/json")

    /** 원격 확인 실패의 공개 메시지를 고정하고 게이트를 유지. */
    private fun remoteFailure() = OperationFailure(HttpStatus.SERVICE_UNAVAILABLE, "GitHub 배포 상태를 확인하지 못했습니다. 쓰기 차단은 유지됩니다.")
}

/** dispatch HTTP 결과; 5xx와 전송 예외는 도착 여부가 불확실함. */
sealed interface DispatchOutcome {
    data class Accepted(val runId: String, val htmlUrl: String?) : DispatchOutcome
    data object AcceptedWithoutIdentity : DispatchOutcome
    data object Rejected : DispatchOutcome
    data object Uncertain : DispatchOutcome
}

/** 원격 run의 터미널 결론이 null이면 실행 중 또는 대기 중. */
data class GitHubRun(val id: String, val attempt: Int, val finished: Boolean, val conclusion: String?,
    val htmlUrl: String?, val headSha: String)
