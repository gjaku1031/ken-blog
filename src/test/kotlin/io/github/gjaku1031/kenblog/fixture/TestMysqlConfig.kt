package io.github.gjaku1031.kenblog.fixture

import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.context.annotation.Bean
import org.testcontainers.mysql.MySQLContainer

/**
 * 실제 MySQL을 테스트별 Spring 컨텍스트에 연결하는 전용 설정.
 *
 * [ServiceConnection]이 DataSource와 Flyway 접속 정보를 컨테이너에서 공급하고,
 * Spring이 컨텍스트 종료 시 컨테이너를 함께 정리함.
 */
@TestConfiguration(proxyBeanMethods = false)
class TestMysqlConfig {
    /**
     * ARM64와 AMD64 모두 지원하는 MySQL 8.4 테스트 인스턴스를 생성.
     *
     * @return 저장소의 개발 DB 및 다른 테스트 컨텍스트와 분리된 [MySQLContainer]
     */
    @Bean
    @ServiceConnection
    fun mysqlContainer(): MySQLContainer = MySQLContainer("mysql:8.4.11")
}
