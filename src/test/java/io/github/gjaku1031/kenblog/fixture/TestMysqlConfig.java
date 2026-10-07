package io.github.gjaku1031.kenblog.fixture;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.mysql.MySQLContainer;

/**
 * 실제 MySQL을 테스트 컨텍스트에 연결하고 종료 시 정리
 */
@TestConfiguration(proxyBeanMethods = false)
public final class TestMysqlConfig {
    /**
     * ARM64와 AMD64 모두 지원하는 MySQL 8.4 테스트 인스턴스를 생성
     *
     * @return 저장소의 개발 DB 및 다른 테스트 컨텍스트와 분리된 {@link MySQLContainer}
     */
    @Bean
    @ServiceConnection
    public MySQLContainer mysqlContainer() {
        // 반환한 컨테이너의 시작·종료는 Spring 테스트 컨텍스트가 관리
        var container = new MySQLContainer("mysql:8.4.11");
        container.withInitScript("bootstrap-auth.sql");
        return container;
    }
}
