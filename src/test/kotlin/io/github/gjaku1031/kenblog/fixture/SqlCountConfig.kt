package io.github.gjaku1031.kenblog.fixture

import org.jooq.ExecuteContext
import org.jooq.ExecuteListener
import org.jooq.ExecuteListenerProvider
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import java.util.concurrent.atomic.AtomicInteger

/**
 * 공개 스냅샷의 jOOQ 조회 횟수를 실제 DB 실행 경계에서 측정
 */
@TestConfiguration(proxyBeanMethods = false)
class SqlCountConfig {
    /**
     * 검사에서 초기화·조회할 SELECT 실행 계수
     */
    @Bean
    fun selectCounter(): SelectCounter = SelectCounter()

    /**
     * 앱의 jOOQ 구성에 실행 관측기 연결
     */
    @Bean
    fun selectCounterProvider(counter: SelectCounter): ExecuteListenerProvider = ExecuteListenerProvider { counter }
}

/**
 * JPA 통계와 분리된 jOOQ SELECT 횟수
 */
class SelectCounter : ExecuteListener {
    /**
     * 실행한 SELECT 수
     */
    val count = AtomicInteger()

    /**
     * DB에 실제 전달하는 조회문만 집계
     */
    override fun executeStart(context: ExecuteContext) {
        if (context.sql()?.trimStart()?.startsWith("select", ignoreCase = true) == true) count.incrementAndGet()
    }
}
