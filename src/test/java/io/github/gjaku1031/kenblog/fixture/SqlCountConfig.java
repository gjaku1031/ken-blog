package io.github.gjaku1031.kenblog.fixture;

import org.jooq.ExecuteListenerProvider;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * 공개 스냅샷의 jOOQ 조회 횟수를 실제 실행 경계에서 측정
 */
@TestConfiguration(proxyBeanMethods = false)
public final class SqlCountConfig {
    /**
     * 검사에서 초기화·조회할 SELECT 계수
     */
    @Bean
    public SelectCounter selectCounter() {
        return new SelectCounter();
    }

    /**
     * 앱 jOOQ 구성에 실행 관측기 연결
     */
    @Bean
    public ExecuteListenerProvider selectCounterProvider(SelectCounter counter) {
        return () -> counter;
    }
}
