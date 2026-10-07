package io.github.gjaku1031.kenblog.fixture;

import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 운영 JAR에 없는 관리자 권한 경계 검사 Controller
 */
@RestController
public final class TestAdminProbeController {
    /**
     * {@code /api/v1/admin/} 경로의 역할 검사에 성공한 경우만 응답
     *
     * @return 관리자 접근 성공을 나타내는 테스트 전용 응답
     */
    @GetMapping("/api/v1/admin/__test")
    public Map<String, Boolean> adminOnly() {
        return Map.of("authorized", true);
    }
}
