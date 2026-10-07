package io.github.gjaku1031.kenblog.global.security;

import lombok.RequiredArgsConstructor;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.*;
import org.springframework.stereotype.Component;

import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * MVC 밖 인증·접근 거부를 고정 설명의 ProblemDetail JSON으로 기록
 */
@Component
@RequiredArgsConstructor
public final class SecurityProblemWriter {
    /**
     * JSON 직렬화기
     */
    private final ObjectMapper objectMapper;

    /**
     * 장애 ID 없이 보안 오류 기록
     */
    public void write(HttpServletResponse response, HttpStatus status) throws IOException {
        write(response, status, null);
    }

    /**
     * 응답이 아직 확정되지 않았을 때 고정 설명만 포함한 오류를 반환
     *
     * 1. 이미 확정된 응답은 변경하지 않고 실패
     * 2. 기존 버퍼를 비우고 오류 상태·JSON 헤더 설정
     * 3. 상태별 고정 설명만 선택해 내부 원문 제외
     * 4. ProblemDetail JSON으로 응답 기록
     *
     * @param response 현재 Servlet 응답
     * @param status 공개할 HTTP 상태
     * @throws IllegalStateException 이미 응답이 확정되어 오류로 바꿀 수 없을 때
     */
    public void write(HttpServletResponse response, HttpStatus status, String eventId)
            throws IOException {
        if (response.isCommitted())
            throw new IllegalStateException("Security response is already committed");
        var representation =
                Set.of(
                        "content-length",
                        "content-type",
                        "content-disposition",
                        "content-encoding",
                        "etag",
                        "last-modified",
                        "accept-ranges",
                        "content-range",
                        "cache-control",
                        "expires");
        var retained = new LinkedHashMap<String, List<String>>();
        for (String name : response.getHeaderNames())
            if (!representation.contains(name.toLowerCase(Locale.ROOT)))
                retained.put(name, List.copyOf(response.getHeaders(name)));
        // 내부 길이·출력 상태까지 초기화하고 표현과 무관한 헤더 복원
        response.reset();
        retained.forEach(
                (name, values) -> values.forEach(value -> response.addHeader(name, value)));
        response.setHeader("Cache-Control", "no-store");
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        String detail =
                switch (status) {
                    case UNAUTHORIZED -> "인증이 필요합니다.";
                    case FORBIDDEN -> "접근 권한이 없습니다.";
                    case SERVICE_UNAVAILABLE -> "데이터베이스에 연결할 수 없습니다.";
                    default -> "요청을 처리할 수 없습니다.";
                };
        var problem = ProblemDetail.forStatusAndDetail(status, detail);
        if (eventId != null) problem.setProperty("eventId", eventId);
        objectMapper.writeValue(response.getOutputStream(), problem);
    }
}
