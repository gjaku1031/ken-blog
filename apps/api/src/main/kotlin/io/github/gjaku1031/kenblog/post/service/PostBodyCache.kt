package io.github.gjaku1031.kenblog.post.service

import io.github.gjaku1031.kenblog.post.domain.PostBodyHash
import io.lettuce.core.ClientOptions
import io.lettuce.core.RedisClient
import io.lettuce.core.RedisException
import io.lettuce.core.RedisURI
import io.lettuce.core.SocketOptions
import io.lettuce.core.SslOptions
import io.lettuce.core.TimeoutOptions
import io.lettuce.core.api.StatefulRedisConnection
import io.lettuce.core.api.sync.RedisCommands
import jakarta.annotation.PreDestroy
import java.time.Duration
import java.util.concurrent.CancellationException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager

/**
 * 익명 PUBLIC 본문 전용 선택적 Redis 캐시. DB 조회·권한 판정은 [PublicPostService]가 먼저 수행함.
 *
 * 활성화되지 않으면 클라이언트·스레드를 만들지 않음. 활성화 상태의 연결은 단일 daemon에서
 * 비동기로 준비하고 한 연결을 재사용함. 준비 중·실패 유예·잠금 경합은 즉시 캐시 miss로 처리함.
 */
@Component
class PostBodyCache(
    @Value("\${app.cache.redis.enabled:false}") val enabled: Boolean,
    @Value("\${app.cache.redis.host:}") host: String,
    @Value("\${app.cache.redis.port:6379}") port: Int,
    @Value("\${app.cache.redis.username:}") username: String,
    @Value("\${app.cache.redis.password:}") password: String,
    @Value("\${app.cache.redis.tls:true}") tls: Boolean,
    @Value("\${app.cache.redis.prefix:ken-blog:public-posts}") private val prefix: String,
    @Value("\${app.cache.redis.ttl-seconds:300}") private val ttlSeconds: Long,
    @Value("\${app.cache.redis.connect-timeout-ms:300}") connectTimeoutMs: Long,
    @Value("\${app.cache.redis.command-timeout-ms:300}") commandTimeoutMs: Long,
) {
    private val lock = ReentrantLock()
    private val client: RedisClient?
    private val connector: ExecutorService?
    private var connection: StatefulRedisConnection<String, String>? = null
    private var connecting: CompletableFuture<StatefulRedisConnection<String, String>>? = null
    private var retryAfterNanos = 0L
    @Volatile private var closed = false
    private val logger = LoggerFactory.getLogger(PostBodyCache::class.java)

    init {
        if (enabled) {
            check(host.isNotBlank() && !host.contains("://") && !host.contains('@') && !host.contains('/')) { "Cache Redis host must be a hostname" }
            check(port in 1..65535) { "Cache Redis port is invalid" }
            check(username.isBlank() || password.isNotBlank()) { "Cache Redis username requires a password" }
            check(prefix.length in 1..80 && PREFIX_PATTERN.matches(prefix)) { "Cache Redis prefix is invalid" }
            check(ttlSeconds in 1..86400) { "Cache Redis TTL is invalid" }
            check(connectTimeoutMs in 50..5000 && commandTimeoutMs in 50..5000) { "Cache Redis timeout is invalid" }
            val uriBuilder = RedisURI.Builder.redis(host, port)
                .withSsl(tls)
                .withTimeout(Duration.ofMillis(commandTimeoutMs))
            if (password.isNotEmpty()) {
                if (username.isNotEmpty()) uriBuilder.withAuthentication(username, password.toCharArray())
                else uriBuilder.withPassword(password.toCharArray())
            }
            client = RedisClient.create(uriBuilder.build()).apply {
                setOptions(ClientOptions.builder()
                    .autoReconnect(false)
                    .disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)
                    .requestQueueSize(16)
                    .socketOptions(SocketOptions.builder().connectTimeout(Duration.ofMillis(connectTimeoutMs)).build())
                    .sslOptions(SslOptions.builder().handshakeTimeout(Duration.ofMillis(connectTimeoutMs)).build())
                    .timeoutOptions(TimeoutOptions.enabled(Duration.ofMillis(commandTimeoutMs)))
                    .build())
            }
            connector = Executors.newSingleThreadExecutor { task ->
                Thread(task, "public-post-cache-connect").apply { isDaemon = true }
            }
        } else {
            client = null
            connector = null
        }
    }

    /** 서버 준비 후 연결을 백그라운드에서 시작하며 HTTP 요청·기동 완료를 기다리게 하지 않음. */
    @EventListener(ApplicationReadyEvent::class)
    fun prepare() {
        if (!enabled || !lock.tryLock()) return
        try { startConnectionIfAllowed() } finally { lock.unlock() }
    }

    /**
     * 현재 DB 해시와 일치하는 작고 온전한 UTF-8 본문만 반환.
     *
     * @param id DB에서 확인한 PUBLIC 게시글 ID
     * @param hash 현재 DB 본문 SHA-256
     * @return 유효한 캐시 본문, miss·손상·장애면 `null`
     */
    fun read(id: Long, hash: String): String? {
        if (!enabled) return null
        return useCommands { commands ->
            val key = key(id, hash)
            val length = commands.strlen(key)
            if (length > MAX_BODY_BYTES) return@useCommands null
            val body = commands.get(key) ?: return@useCommands null
            if (body.toByteArray(Charsets.UTF_8).size > MAX_BODY_BYTES || PostBodyHash.sha256(body) != hash) null else body
        }
    }

    /**
     * DB 본문이 현재 해시와 일치하고 UTF-8 256 KiB 이하일 때만 TTL을 붙여 저장.
     *
     * @param id DB에서 확인한 PUBLIC 게시글 ID
     * @param hash 현재 DB 본문 SHA-256
     * @param body DB 원문 본문
     */
    fun write(id: Long, hash: String, body: String) {
        if (!enabled || body.toByteArray(Charsets.UTF_8).size > MAX_BODY_BYTES || PostBodyHash.sha256(body) != hash) return
        useCommands { it.setex(key(id, hash), ttlSeconds, body) }
    }

    /**
     * 관리자 쓰기 트랜잭션이 실제 커밋한 뒤 이전 본문 키만 best-effort 제거.
     *
     * @param id 변경 전 게시글 ID
     * @param previousHash 변경 전 본문 SHA-256
     */
    fun evictAfterCommit(id: Long, previousHash: String) {
        if (!enabled) return
        check(TransactionSynchronizationManager.isActualTransactionActive() && TransactionSynchronizationManager.isSynchronizationActive()) {
            "Cache eviction requires an active transaction"
        }
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            /** DB가 실제 커밋된 뒤에만 이전 키 하나를 삭제 시도. */
            override fun afterCommit() { evict(id, previousHash) }
        })
    }

    /** @return 소유 접두사·본문 버전으로 만든 단일 Redis 키. */
    private fun key(id: Long, hash: String): String = "$prefix:v1:post-body:$id:$hash"

    /** 실패 원문을 기록하거나 전파하지 않고 지정한 키 하나를 제거. */
    private fun evict(id: Long, hash: String) { useCommands { it.del(key(id, hash)) } }

    /**
     * 준비된 단일 연결에서만 명령을 실행하고 실패 시 짧은 유예 동안 DB로 우회.
     *
     * @param block Redis 명령 실행
     * @return 성공 결과, 경합·연결·명령 오류면 `null`
     */
    private fun <T> useCommands(block: (RedisCommands<String, String>) -> T): T? {
        if (!enabled || !lock.tryLock()) return null
        try {
            val active = readyConnection() ?: return null
            return block(active.sync())
        } catch (ex: RedisException) {
            markFailure(ex)
            return null
        } finally {
            lock.unlock()
        }
    }

    /**
     * 완료된 연결 Future만 확인하며 아직 준비 중이면 요청을 즉시 DB로 돌림.
     *
     * @return 재사용 가능한 연결, 준비 중·실패 유예·종료 상태면 `null`
     */
    private fun readyConnection(): StatefulRedisConnection<String, String>? {
        if (closed) return null
        connection?.takeIf { it.isOpen }?.let { return it }
        connection = null
        if (retryAfterNanos != 0L && System.nanoTime() - retryAfterNanos < 0) return null
        val future = connecting ?: run { startConnectionIfAllowed(); return null }
        if (!future.isDone) return null
        return try {
            future.join().also { connection = it; connecting = null; retryAfterNanos = 0L }
        } catch (ex: CompletionException) {
            connecting = null
            markFailure(ex)
            null
        } catch (ex: CancellationException) {
            connecting = null
            markFailure(ex)
            null
        }
    }

    /**
     * 실패 유예가 끝났을 때 daemon에서 연결 하나만 시도하고 늦은 완료도 종료 시 해제.
     *
     * 준비 중인 요청은 Future를 기다리지 않으며 다음 요청이 완료 결과를 채택함.
     */
    private fun startConnectionIfAllowed() {
        if (closed || !enabled || connecting != null || connection?.isOpen == true) return
        if (retryAfterNanos != 0L && System.nanoTime() - retryAfterNanos < 0) return
        connecting = CompletableFuture.supplyAsync({ client!!.connect() }, connector!!).also { future ->
            future.whenComplete { opened, _ -> if (closed) runCatching { opened?.closeAsync() } }
        }
    }

    /**
     * 비밀이 포함될 수 있는 예외 메시지·URI·본문 대신 최대 네 단계의 예외 클래스만 DEBUG 기록.
     *
     * @param ex 연결 또는 명령 실패
     */
    private fun markFailure(ex: Throwable) {
        if (logger.isDebugEnabled) {
            val types = generateSequence(ex) { it.cause }.take(4).joinToString(" > ") { it.javaClass.name }
            logger.debug("Public post cache Redis failure types: {}", types)
        }
        runCatching { connection?.closeAsync() }
        connection = null
        retryAfterNanos = System.nanoTime() + TimeUnit.SECONDS.toNanos(RETRY_COOLDOWN_SECONDS)
    }

    /** 앱 종료 시 재사용 연결과 Lettuce 네트워크 자원을 해제. */
    @PreDestroy
    fun close() {
        lock.withLock {
            closed = true
            runCatching { connection?.closeAsync() }
            connection = null
            connecting?.whenComplete { opened, _ -> runCatching { opened?.closeAsync() } }
            connecting = null
            connector?.shutdownNow()
            runCatching { client?.shutdown(Duration.ofMillis(100), Duration.ofMillis(250)) }
        }
    }

    private companion object {
        const val MAX_BODY_BYTES = 256 * 1024
        const val RETRY_COOLDOWN_SECONDS = 5L
        val PREFIX_PATTERN = Regex("[A-Za-z0-9][A-Za-z0-9._:-]*")
    }
}
