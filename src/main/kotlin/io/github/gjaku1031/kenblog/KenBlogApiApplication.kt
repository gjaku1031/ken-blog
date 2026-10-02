package io.github.gjaku1031.kenblog

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

/**
 * 웹 서버와 Actuator를 구성하기 위한 컴포넌트 탐색 제공
 *
 * [main]이 이 클래스를 사용해 애플리케이션 컨텍스트 생성
 */
@SpringBootApplication
class KenBlogApiApplication

/**
 * Spring 애플리케이션 실행
 */
fun main(args: Array<String>) {
    runApplication<KenBlogApiApplication>(*args)
}
