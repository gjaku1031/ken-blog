package io.github.gjaku1031.kenblog.pages;

import lombok.RequiredArgsConstructor;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

/**
 * 관리자 화면의 Pages 수동 실행과 진행 상태 조회 경로
 */
@RestController
@RequestMapping("/api/v1/admin/pages/deployments")
@RequiredArgsConstructor
public final class AdminPagesDeploymentController {
    /**
     * Pages 워크플로 실행 서비스
     */
    private final PagesDeploymentService deployments;

    /**
     * 진행 중 실행이 있으면 그 실행, 없으면 새 실행 상태
     */
    @PostMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PagesDeploymentResponse> start() {
        return noStore(deployments.start());
    }

    /**
     * 가장 최근 실행 상태; 기록이 없으면 204
     */
    @GetMapping(value = "/latest", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PagesDeploymentResponse> latest() {
        return deployments
                .latest()
                .map(this::noStore)
                .orElseGet(() -> ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build());
    }

    /**
     * 지정 실행의 상태·단계
     */
    @GetMapping(value = "/{runId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PagesDeploymentResponse> status(@PathVariable("runId") long runId) {
        return noStore(deployments.status(runId));
    }

    /**
     * 캐시 저장을 금지한 200 응답
     */
    private <T> ResponseEntity<T> noStore(T value) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);
    }
}
