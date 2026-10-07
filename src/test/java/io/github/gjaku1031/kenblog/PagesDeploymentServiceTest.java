package io.github.gjaku1031.kenblog;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;

import io.github.gjaku1031.kenblog.global.error.BusinessException;
import io.github.gjaku1031.kenblog.pages.PagesDeploymentService;

import org.junit.jupiter.api.*;
import org.springframework.http.HttpStatus;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 로컬 GitHub API 대역으로 Pages 수동 실행·중복 방지·워크플로 경계·오류 변환 검증
 */
final class PagesDeploymentServiceTest {
    /**
     * 테스트용 토큰
     */
    private static final String TOKEN = "github_pat_test-secret";

    /**
     * 저장소 Actions API 경로 접두사
     */
    private static final String ACTIONS = "/repos/gjaku1031/ken-blog/actions";

    /**
     * GitHub API 대역 서버
     */
    private HttpServer server;

    /**
     * 경로와 쿼리별 응답; 값은 {HTTP 상태, JSON 본문}
     */
    private final Map<String, Object[]> responses = new HashMap<>();

    /**
     * 받은 요청의 메서드·경로·인증 헤더·본문
     */
    private final List<String[]> requests = new CopyOnWriteArrayList<>();

    /**
     * 등록한 응답을 돌려주고 요청을 기록하는 대역 서버 시작
     */
    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/",
                exchange -> {
                    var uri = exchange.getRequestURI();
                    String key = uri.getRawQuery() == null ? uri.getPath() : uri.getPath() + "?" + uri.getRawQuery();
                    String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                    requests.add(
                            new String[] {
                                exchange.getRequestMethod(),
                                key,
                                exchange.getRequestHeaders().getFirst("Authorization"),
                                body
                            });
                    var response = responses.getOrDefault(key, new Object[] {404, "{\"message\":\"Not Found\"}"});
                    byte[] bytes = ((String) response[1]).getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().add("Content-Type", "application/json");
                    exchange.sendResponseHeaders((int) response[0], bytes.length);
                    exchange.getResponseBody().write(bytes);
                    exchange.close();
                });
        server.start();
        // 최근 성공 수동 실행 60초를 예상 소요 시간으로 사용
        respond(
                ACTIONS + "/workflows/pages.yml/runs?status=success&per_page=1&event=workflow_dispatch",
                200,
                "{\"workflow_runs\":[{\"run_started_at\":\"2026-10-07T00:00:00Z\",\"updated_at\":\"2026-10-07T00:01:00Z\"}]}");
    }

    /**
     * 대역 서버 종료
     */
    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    /**
     * 대역 서버를 바라보는 서비스 생성
     */
    private PagesDeploymentService service(String token) {
        return new PagesDeploymentService("http://127.0.0.1:" + server.getAddress().getPort(), token);
    }

    /**
     * 경로별 응답 등록
     */
    private void respond(String path, int status, String json) {
        responses.put(path, new Object[] {status, json});
    }

    /**
     * 지정 상태의 Pages 실행 JSON
     */
    private static String run(long id, String status, String path) {
        return "{\"id\":" + id + ",\"status\":\"" + status + "\",\"conclusion\":null,\"path\":\"" + path
                + "\",\"html_url\":\"https://github.com/gjaku1031/ken-blog/actions/runs/" + id
                + "\",\"run_started_at\":\"2026-10-07T01:00:00Z\"}";
    }

    /**
     * 최근 실행이 완료됐으면 토큰을 붙여 main으로 실행하고 실행 ID의 단계·예상 시간을 반환하는지 검증
     */
    @Test
    void startDispatchesWhenNoRunIsActive() {
        respond(ACTIONS + "/workflows/pages.yml/runs?per_page=1", 200,
                "{\"workflow_runs\":[" + run(1, "completed", ".github/workflows/pages.yml") + "]}");
        respond(ACTIONS + "/workflows/pages.yml/dispatches", 200,
                "{\"workflow_run_id\":42,\"html_url\":\"https://github.com/gjaku1031/ken-blog/actions/runs/42\"}");
        respond(ACTIONS + "/runs/42", 200, run(42, "in_progress", ".github/workflows/pages.yml"));
        respond(ACTIONS + "/runs/42/jobs", 200,
                "{\"jobs\":[{\"name\":\"build\",\"steps\":[{\"name\":\"Check out\",\"status\":\"completed\"},"
                        + "{\"name\":\"Build site\",\"status\":\"in_progress\"},{\"name\":\"Upload\",\"status\":\"queued\"}]}]}");

        var result = service(TOKEN).start();

        assertEquals(42, result.runId());
        assertEquals("in_progress", result.status());
        assertEquals("build · Build site", result.currentStep());
        assertEquals(1, result.completedSteps());
        assertEquals(3, result.totalSteps());
        assertEquals(60, result.estimatedSeconds());
        var dispatch = requests.stream().filter(request -> request[0].equals("POST")).toList();
        assertEquals(1, dispatch.size());
        assertTrue(dispatch.getFirst()[3].contains("\"ref\":\"main\""));
        assertTrue(dispatch.getFirst()[3].contains("\"return_run_details\":true"));
        assertTrue(requests.stream().allMatch(request -> ("Bearer " + TOKEN).equals(request[2])));
    }

    /**
     * 진행 중 실행이 있으면 새로 실행하지 않고 그 실행을 반환하는지 검증
     */
    @Test
    void startReusesActiveRun() {
        respond(ACTIONS + "/workflows/pages.yml/runs?per_page=1", 200,
                "{\"workflow_runs\":[" + run(7, "queued", ".github/workflows/pages.yml") + "]}");
        respond(ACTIONS + "/runs/7/jobs", 200, "{\"jobs\":[]}");

        var result = service(TOKEN).start();

        assertEquals(7, result.runId());
        assertEquals("queued", result.status());
        assertTrue(requests.stream().noneMatch(request -> request[0].equals("POST")));
    }

    /**
     * 생성 직후 실행 조회가 404면 dispatch 응답으로 대기 상태를 반환하는지 검증
     */
    @Test
    void startReportsQueuedWhenRunIsNotVisibleYet() {
        respond(ACTIONS + "/workflows/pages.yml/runs?per_page=1", 200, "{\"workflow_runs\":[]}");
        respond(ACTIONS + "/workflows/pages.yml/dispatches", 200,
                "{\"workflow_run_id\":43,\"html_url\":\"https://github.com/gjaku1031/ken-blog/actions/runs/43\"}");

        var result = service(TOKEN).start();

        assertEquals(43, result.runId());
        assertEquals("queued", result.status());
        assertEquals("https://github.com/gjaku1031/ken-blog/actions/runs/43", result.htmlUrl());
    }

    /**
     * 다른 워크플로의 실행 ID는 404로 거부하는지 검증
     */
    @Test
    void statusRejectsOtherWorkflowRuns() {
        respond(ACTIONS + "/runs/9", 200, run(9, "in_progress", ".github/workflows/ci.yml"));

        var failure = assertThrows(BusinessException.class, () -> service(TOKEN).status(9));

        assertEquals(HttpStatus.NOT_FOUND, failure.getStatus());
        assertTrue(requests.stream().noneMatch(request -> request[1].endsWith("/runs/9/jobs")));
    }

    /**
     * 토큰이 없으면 GitHub에 요청하지 않고 503을 반환하는지 검증
     */
    @Test
    void missingTokenDisablesDeployment() {
        var failure = assertThrows(BusinessException.class, () -> service(" ").start());

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, failure.getStatus());
        assertEquals("GitHub 배포 토큰이 설정되지 않았습니다.", failure.getPublicDetail());
        assertTrue(requests.isEmpty());
    }

    /**
     * GitHub 인증 실패를 토큰·응답 원문 없는 502로 변환하는지 검증
     */
    @Test
    void gitHubAuthenticationFailureIsBadGateway() {
        respond(ACTIONS + "/workflows/pages.yml/runs?per_page=1", 401, "{\"message\":\"Bad credentials " + TOKEN + "\"}");

        var failure = assertThrows(BusinessException.class, () -> service(TOKEN).latest());

        assertEquals(HttpStatus.BAD_GATEWAY, failure.getStatus());
        assertFalse(failure.getPublicDetail().contains(TOKEN));
        assertNull(failure.getMessage());
    }
}
