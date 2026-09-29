package io.github.gjaku1031.kenblog.deployment

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.sql.ResultSet

/** 배포 게이트의 단일 영속 행을 반환하며, 각 변경은 짧은 독립 트랜잭션으로 커밋. */
data class DeploymentState(
    val id: String?,
    val status: String,
    val runId: String?,
    val runAttempt: Int?,
    val htmlUrl: String?,
    val error: String?,
    val source: String?,
    val version: Long,
    val lastSuccessfulOperationId: String?,
)

/** [DeploymentState]의 유일한 행을 읽고 교체하는 JDBC 저장소. */
@Repository
class DeploymentStateStore(private val jdbc: JdbcTemplate, manager: PlatformTransactionManager) {
    private val transactions = TransactionTemplate(manager)
    /** 배포 상태의 커밋된 현재 스냅샷을 반환. */
    fun current(): DeploymentState = jdbc.queryForObject(
        "SELECT operation_id, status, run_id, run_attempt, html_url, error_message, source, version, last_successful_operation_id FROM deployment_state WHERE singleton_id = 1",
    ) { rs: ResultSet, _: Int -> state(rs) } ?: error("Deployment state row missing")

    /** 블록 안에서 행 잠금을 보유하고 완료 시 즉시 커밋. 네트워크 호출은 블록 밖에서만 수행. */
    fun <T> change(block: (DeploymentState) -> Pair<DeploymentState, T>): T = transactions.execute {
        val before = jdbc.queryForObject(
            "SELECT operation_id, status, run_id, run_attempt, html_url, error_message, source, version, last_successful_operation_id FROM deployment_state WHERE singleton_id = 1 FOR UPDATE",
        ) { rs: ResultSet, _: Int -> state(rs) } ?: error("Deployment state row missing")
        val (after, result) = block(before)
        if (after != before) {
            val changed = jdbc.update(
                "UPDATE deployment_state SET operation_id=?, status=?, run_id=?, run_attempt=?, html_url=?, error_message=?, source=?, version=?, last_successful_operation_id=?, updated_at=CURRENT_TIMESTAMP(6) WHERE singleton_id=1 AND version=?",
                after.id, after.status, after.runId, after.runAttempt, after.htmlUrl, after.error, after.source, before.version + 1, after.lastSuccessfulOperationId, before.version,
            )
            check(changed == 1) { "Deployment state changed concurrently" }
        }
        result
    } ?: error("Deployment transaction returned null")

    /** JDBC 행을 외부에 노출해도 안전한 상태 DTO로 변환. */
    private fun state(rs: ResultSet) = DeploymentState(
        rs.getString("operation_id"), rs.getString("status"), rs.getString("run_id"), rs.getInt("run_attempt").takeUnless { rs.wasNull() },
        rs.getString("html_url"), rs.getString("error_message"), rs.getString("source"), rs.getLong("version"),
        rs.getString("last_successful_operation_id"),
    )
}
