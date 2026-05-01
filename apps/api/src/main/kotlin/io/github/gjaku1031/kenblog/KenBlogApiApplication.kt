package io.github.gjaku1031.kenblog

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

/**
 * 블로그 API의 Spring 설정과 컴포넌트 탐색을 위한 진입점.
 *
 * 현재 웹 서버와 Actuator 상태 확인만 활성화. [main]이 이 클래스를 사용해
 * 애플리케이션 컨텍스트 생성.
 */
@SpringBootApplication
class KenBlogApiApplication

/**
 * 명령행 인자를 Spring Boot에 전달해 API 서버 시작.
 *
 * 시작 중 설정이나 서버 바인딩에 실패하면 [runApplication]의 예외 전파.
 *
 * @param args Spring Boot에 전달할 명령행 인자
 */
fun main(args: Array<String>) {
    runApplication<KenBlogApiApplication>(*args)
}
