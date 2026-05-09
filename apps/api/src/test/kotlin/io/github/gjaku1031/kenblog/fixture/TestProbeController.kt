package io.github.gjaku1031.kenblog.fixture

import io.github.gjaku1031.kenblog.StatusResponse
import io.swagger.v3.oas.annotations.Hidden
import org.springframework.http.MediaType
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/**
 * 테스트에서만 입력 변환과 예기치 못한 예외를 유발하는 Controller.
 *
 * 운영 JAR에는 포함되지 않으며 [Hidden]으로 OpenAPI 명세에서도 제외됨.
 */
@Hidden
@RestController
@RequestMapping("/__test")
class TestProbeController {
    /**
     * 수치형 필수 쿼리 입력을 받아 변환 오류 검증에 사용.
     *
     * @param count 변환 대상 입력
     * @return 정상 변환된 값을 담은 [StatusResponse]
     */
    @GetMapping("/input")
    fun input(@RequestParam count: Int): StatusResponse = StatusResponse(status = count.toString())

    /**
     * JSON 본문을 받아 파싱과 미디어 타입 오류 검증에 사용.
     *
     * @param payload 파싱 대상 JSON 값
     * @return 정상 파싱된 값을 담은 [StatusResponse]
     */
    @PostMapping("/body", consumes = [MediaType.APPLICATION_JSON_VALUE])
    fun body(@RequestBody payload: TestProbePayload): StatusResponse = StatusResponse(status = payload.count.toString())

    /**
     * 처리되지 않은 앱 예외를 던져 공개 오류 응답을 검증.
     *
     * @throws IllegalStateException 테스트용 내부 메시지와 함께 항상 발생
     */
    @GetMapping("/failure")
    fun failure(): StatusResponse = throw IllegalStateException("secret-marker")

    /**
     * 명시적 [ResponseStatusException]의 상태와 비공개 사유 처리 검증에 사용.
     *
     * @throws ResponseStatusException HTTP 400과 테스트용 내부 사유로 항상 발생
     */
    @GetMapping("/status-error")
    fun statusError(): StatusResponse = throw ResponseStatusException(HttpStatus.BAD_REQUEST, "secret-marker")
}

/**
 * [TestProbeController.body]의 JSON 파싱을 위한 테스트 전용 DTO.
 *
 * @property count 수치형 입력값
 */
data class TestProbePayload(val count: Int)
