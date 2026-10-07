package io.github.gjaku1031.kenblog.fixture;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * 운영 JAR에 없는 입력 변환·예외 유발 Controller
 */
@RestController
@RequestMapping("/__test")
public final class TestProbeController {
    /**
     * 수치형 필수 쿼리 입력을 받아 변환 오류 검증에 사용
     *
     * @param count 변환 대상 입력
     * @return 정상 변환된 값을 담은 {@code TestProbePayload}
     */
    @GetMapping("/input")
    public TestProbePayload input(@RequestParam int count) {
        return new TestProbePayload(count);
    }

    /**
     * JSON 본문을 받아 파싱과 미디어 타입 오류 검증에 사용
     *
     * @param payload 파싱 대상 JSON 값
     * @return 정상 파싱된 값을 담은 {@code TestProbePayload}
     */
    @PostMapping(value = "/body", consumes = MediaType.APPLICATION_JSON_VALUE)
    public TestProbePayload body(@RequestBody TestProbePayload payload) {
        return payload;
    }

    /**
     * 처리되지 않은 앱 예외를 던져 공개 오류 응답을 검증
     *
     * @throws IllegalStateException 테스트용 내부 메시지와 함께 항상 발생
     */
    @GetMapping("/failure")
    public TestProbePayload failure() {
        throw new IllegalStateException("secret-marker");
    }

    /**
     * 명시적 {@link ResponseStatusException}의 상태와 비공개 사유 처리 검증에 사용
     *
     * @throws ResponseStatusException HTTP 400과 테스트용 내부 사유로 항상 발생
     */
    @GetMapping("/status-error")
    public TestProbePayload statusError() {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "secret-marker");
    }
}
