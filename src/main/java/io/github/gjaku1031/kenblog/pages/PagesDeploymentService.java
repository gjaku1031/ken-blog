package io.github.gjaku1031.kenblog.pages;

import io.github.gjaku1031.kenblog.global.error.BusinessException;
import io.github.gjaku1031.kenblog.global.text.Text;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.*;

import tools.jackson.databind.JsonNode;

import java.net.http.HttpClient;
import java.time.*;
import java.util.*;
import java.util.function.Supplier;

/**
 * 서버에 보관한 GitHub 토큰으로 Pages 워크플로를 수동 실행하고 실행 상태를 요약
 *
 * 토큰은 이 서비스 밖으로 반환하거나 기록하지 않음. 저장소·워크플로·브랜치는 고정값이며 요청으로 바꿀 수 없음
 */
@Service
public final class PagesDeploymentService {
    /**
     * 배포 대상 저장소
     */
    private static final String REPOSITORY = "gjaku1031/ken-blog";

    /**
     * 공개 사이트를 생성·배포하는 워크플로 파일
     */
    private static final String WORKFLOW = "pages.yml";

    /**
     * 수동 실행 기준 브랜치
     */
    private static final String REF = "main";

    /**
     * 성공 기록이 없을 때 쓰는 예상 소요 시간(초)
     */
    private static final long DEFAULT_ESTIMATE = 90;

    /**
     * 예상 소요 시간을 다시 계산하기 전까지 재사용하는 시간
     */
    private static final Duration ESTIMATE_TTL = Duration.ofMinutes(10);

    /**
     * 저장소 Actions API 클라이언트
     */
    private final RestClient client;

    /**
     * 토큰 설정 여부; 미설정이면 모든 요청을 503으로 거부
     */
    private final boolean configured;

    /**
     * 마지막으로 계산한 예상 소요 시간(초)
     */
    private volatile long estimate = DEFAULT_ESTIMATE;

    /**
     * 예상 소요 시간 계산 시각; 계산 전에는 {@code null}
     */
    private volatile Instant estimatedAt;

    /**
     * GitHub API 주소·토큰으로 연결 시간 5초·응답 시간 10초 클라이언트 구성
     *
     * @param apiBase GitHub REST API 기준 주소; 테스트에서 대역 서버로 교체
     * @param token Actions 읽기·쓰기 권한의 저장소 한정 토큰; 빈 값이면 기능 비활성
     */
    public PagesDeploymentService(
            @Value("${app.pages.github.api-base}") String apiBase,
            @Value("${app.pages.github.token}") String token) {
        configured = !Text.isBlank(token);
        var factory =
                new JdkClientHttpRequestFactory(
                        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build());
        factory.setReadTimeout(Duration.ofSeconds(10));
        var builder =
                RestClient.builder()
                        .baseUrl(apiBase + "/repos/" + REPOSITORY + "/actions")
                        .requestFactory(factory)
                        .defaultHeader(HttpHeaders.ACCEPT, "application/vnd.github+json")
                        .defaultHeader("X-GitHub-Api-Version", "2022-11-28");
        if (configured) builder.defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + Text.trim(token));
        client = builder.build();
    }

    /**
     * 가장 최근 Pages 실행 조회
     *
     * @return 실행 기록이 없으면 빈 값
     */
    public Optional<PagesDeploymentResponse> latest() {
        return latestRun().map(this::describe);
    }

    /**
     * 진행 중인 실행이 있으면 그 실행을 반환하고, 없으면 {@code main}으로 새로 실행
     *
     * 1. 최근 실행이 완료 전이면 중복 실행 없이 반환
     * 2. {@code return_run_details}로 dispatch해 실행 ID 수신
     * 3. 생성 직후 실행 조회가 아직 안 되면 대기 상태로 응답
     */
    public PagesDeploymentResponse start() {
        var active = latestRun().filter(run -> !completed(run));
        if (active.isPresent()) return describe(active.get());
        JsonNode dispatched =
                call(
                        () ->
                                client.post()
                                        .uri("/workflows/{workflow}/dispatches", WORKFLOW)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .body(Map.of("ref", REF, "return_run_details", true))
                                        .retrieve()
                                        .body(JsonNode.class));
        long runId = dispatched.path("workflow_run_id").longValue();
        try {
            return status(runId);
        } catch (BusinessException notYetVisible) {
            if (notYetVisible.getStatus() != HttpStatus.NOT_FOUND) throw notYetVisible;
            return new PagesDeploymentResponse(
                    runId, "queued", null, text(dispatched, "html_url"), null, 0, 0, null,
                    estimateSeconds());
        }
    }

    /**
     * Pages 워크플로에 속한 실행의 상태·단계 조회
     *
     * @throws BusinessException 다른 워크플로의 실행이거나 없으면 404
     */
    public PagesDeploymentResponse status(long runId) {
        JsonNode run = call(() -> client.get().uri("/runs/{id}", runId).retrieve().body(JsonNode.class));
        if (!Objects.requireNonNullElse(text(run, "path"), "")
                .startsWith(".github/workflows/" + WORKFLOW))
            throw new BusinessException(HttpStatus.NOT_FOUND, "배포 실행을 찾을 수 없습니다.");
        return describe(run);
    }

    /**
     * 워크플로의 최근 실행 1건
     */
    private Optional<JsonNode> latestRun() {
        JsonNode runs =
                call(
                        () ->
                                client.get()
                                        .uri("/workflows/{workflow}/runs?per_page=1", WORKFLOW)
                                        .retrieve()
                                        .body(JsonNode.class));
        var first = runs.path("workflow_runs").path(0);
        return first.isObject() ? Optional.of(first) : Optional.empty();
    }

    /**
     * 실행 응답과 job 단계를 화면용 상태로 변환; 완료한 실행은 단계 조회 생략
     */
    private PagesDeploymentResponse describe(JsonNode run) {
        long runId = run.path("id").longValue();
        int done = 0;
        int total = 0;
        String current = null;
        if (!completed(run)) {
            JsonNode jobs =
                    call(
                            () ->
                                    client.get()
                                            .uri("/runs/{id}/jobs", runId)
                                            .retrieve()
                                            .body(JsonNode.class));
            // 시작한 job의 단계만 집계하고 처음 만나는 진행 중 단계를 현재 단계로 표시
            for (JsonNode job : jobs.path("jobs")) {
                for (JsonNode step : job.path("steps")) {
                    total++;
                    String state = text(step, "status");
                    if ("completed".equals(state)) done++;
                    else if ("in_progress".equals(state) && current == null)
                        current = text(job, "name") + " · " + text(step, "name");
                }
            }
        }
        return new PagesDeploymentResponse(
                runId,
                text(run, "status"),
                text(run, "conclusion"),
                text(run, "html_url"),
                text(run, "run_started_at"),
                done,
                total,
                current,
                estimateSeconds());
    }

    /**
     * 최근 성공 실행의 소요 시간(초); 수동 실행 기록을 우선하고 없으면 전체 성공 기록, 그것도 없으면 기본값
     * 계산 실패는 진행 표시를 막지 않도록 이전 값 사용
     */
    private long estimateSeconds() {
        var at = estimatedAt;
        if (at != null && at.plus(ESTIMATE_TTL).isAfter(Instant.now())) return estimate;
        try {
            long seconds = DEFAULT_ESTIMATE;
            for (String filter : List.of("&event=workflow_dispatch", "")) {
                JsonNode runs =
                        call(
                                () ->
                                        client.get()
                                                .uri(
                                                        "/workflows/{workflow}/runs?status=success&per_page=1"
                                                                + filter,
                                                        WORKFLOW)
                                                .retrieve()
                                                .body(JsonNode.class));
                var run = runs.path("workflow_runs").path(0);
                String started = text(run, "run_started_at");
                String updated = text(run, "updated_at");
                if (started != null && updated != null) {
                    seconds =
                            Math.max(
                                    10,
                                    Duration.between(Instant.parse(started), Instant.parse(updated))
                                            .toSeconds());
                    break;
                }
            }
            estimate = seconds;
        } catch (BusinessException | DateTimeException ignored) {
            // 진행 표시용 보조 값이므로 이전 추정값 유지
        }
        estimatedAt = Instant.now();
        return estimate;
    }

    /**
     * 토큰 확인 후 GitHub 요청 실행, 실패를 토큰·응답 원문 없는 공개 오류로 변환
     *
     * @throws BusinessException 토큰 미설정 503, 인증·권한 실패 502, 실행 없음 404, 그 외 연결·응답 실패 503
     */
    private JsonNode call(Supplier<JsonNode> request) {
        if (!configured)
            throw new BusinessException(
                    HttpStatus.SERVICE_UNAVAILABLE, "GitHub 배포 토큰이 설정되지 않았습니다.");
        try {
            var body = request.get();
            if (body == null)
                throw new BusinessException(HttpStatus.BAD_GATEWAY, "GitHub 응답이 비어 있습니다.");
            return body;
        } catch (RestClientResponseException failure) {
            int code = failure.getStatusCode().value();
            if (code == 401)
                throw new BusinessException(
                        HttpStatus.BAD_GATEWAY, "GitHub 토큰이 만료되었거나 올바르지 않습니다.", failure);
            if (code == 403)
                throw new BusinessException(
                        HttpStatus.BAD_GATEWAY, "GitHub 토큰에 Actions 읽기·쓰기 권한이 없습니다.", failure);
            if (code == 404)
                throw new BusinessException(HttpStatus.NOT_FOUND, "배포 실행을 찾을 수 없습니다.", failure);
            throw new BusinessException(
                    HttpStatus.SERVICE_UNAVAILABLE, "GitHub 요청에 실패했습니다.", failure);
        } catch (RestClientException failure) {
            throw new BusinessException(
                    HttpStatus.SERVICE_UNAVAILABLE, "GitHub에 연결하지 못했습니다.", failure);
        }
    }

    /**
     * 완료 상태 여부
     */
    private static boolean completed(JsonNode run) {
        return "completed".equals(text(run, "status"));
    }

    /**
     * 문자열 필드 값; 없거나 문자열이 아니면 {@code null}
     */
    private static String text(JsonNode node, String field) {
        var value = node.path(field);
        return value.isString() ? value.stringValue() : null;
    }
}
