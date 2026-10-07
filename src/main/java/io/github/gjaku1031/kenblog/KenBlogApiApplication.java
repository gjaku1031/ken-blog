package io.github.gjaku1031.kenblog;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Ken Blog API 실행 설정
 */
@SpringBootApplication(proxyBeanMethods = false)
public final class KenBlogApiApplication {
    /**
     * Spring Boot API 실행
     */
    public static void main(String[] args) {
        SpringApplication.run(KenBlogApiApplication.class, args);
    }
}
