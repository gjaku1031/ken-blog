package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.fixture.TestProbeController
import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig
import org.hamcrest.Matchers.containsString
import org.hamcrest.Matchers.not
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.content
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.context.annotation.Import

/**
 * 실제 MVC 설정에서 상태 계약, OpenAPI 문서와 오류 응답을 검증하는 통합 테스트.
 *
 * [TestMysqlConfig]가 실제 MySQL에 마이그레이션을 적용하고,
 * [TestProbeController]는 테스트에서만 오류 입력과 예상하지 못한 예외를 생성함.
 *
 * @property mvc 테스트 HTTP 요청을 처리할 Spring MVC 인스턴스
 */
@SpringBootTest(properties = ["app.cors.allowed-origins=https://gjaku1031.github.io,http://127.0.0.1:14000"])
@AutoConfigureMockMvc
@Import(TestProbeController::class, TestMysqlConfig::class)
class StatusApiIntegrationTest(@Autowired private val mvc: MockMvc) {
    /** 지정한 Pages origin의 공개 GET에만 읽기 허용 헤더를 반환하는지 검증. */
    @Test
    fun statusAllowsPagesOriginWithoutCredentials() {
        mvc.perform(get("/api/v1/status").header("Origin", "https://gjaku1031.github.io"))
            .andExpect(status().isOk)
            .andExpect(header().string("Access-Control-Allow-Origin", "https://gjaku1031.github.io"))
            .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"))
            .andExpect(jsonPath("$.status").value("UP"))
    }

    /** 로컬 정적 화면의 GET 사전 요청이 허용 origin과 메서드를 반환하는지 검증. */
    @Test
    fun statusAllowsLocalGetPreflight() {
        mvc.perform(options("/api/v1/status")
            .header("Origin", "http://127.0.0.1:14000")
            .header("Access-Control-Request-Method", "GET")
            .header("Access-Control-Request-Headers", "Accept"))
            .andExpect(status().isOk)
            .andExpect(header().string("Access-Control-Allow-Origin", "http://127.0.0.1:14000"))
            .andExpect(header().string("Access-Control-Allow-Methods", "GET"))
            .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"))
    }

    /** 허용하지 않은 origin과 메서드의 사전 요청을 거부하는지 검증. */
    @Test
    fun statusRejectsOtherOriginAndMethod() {
        mvc.perform(get("/api/v1/status").header("Origin", "https://other.example"))
            .andExpect(status().isForbidden)
            .andExpect(header().doesNotExist("Access-Control-Allow-Origin"))

        mvc.perform(options("/api/v1/status")
            .header("Origin", "https://gjaku1031.github.io")
            .header("Access-Control-Request-Method", "POST"))
            .andExpect(status().isForbidden)
            .andExpect(header().doesNotExist("Access-Control-Allow-Origin"))
    }

    /** 정상 프로세스 요청의 JSON 계약과 미디어 타입을 검증. */
    @Test
    fun statusReturnsUp() {
        mvc.perform(get("/api/v1/status"))
            .andExpect(status().isOk)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.status").value("UP"))
    }

    /** 인터페이스에 선언한 경로·응답 스키마가 OpenAPI에 반영되었는지 검증. */
    @Test
    fun openApiContainsStatusContract() {
        mvc.perform(get("/v3/api-docs"))
            .andExpect(status().isOk)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.paths['/api/v1/status'].get.responses['200'].content['application/json'].schema['\$ref']")
                .value("#/components/schemas/StatusResponse"))
            .andExpect(jsonPath("$.paths['/api/v1/status'].get.responses['406'].content['application/problem+json'].schema['\$ref']")
                .value("#/components/schemas/ProblemDetail"))
            .andExpect(jsonPath("$.paths['/api/v1/status'].get.responses['500'].content['application/problem+json'].schema['\$ref']")
                .value("#/components/schemas/ProblemDetail"))
            .andExpect(jsonPath("$.components.schemas.StatusResponse.properties.status.type").value("string"))
    }

    /** Swagger UI의 실제 정적 진입 파일 제공을 검증. */
    @Test
    fun swaggerUiIsAvailable() {
        mvc.perform(get("/swagger-ui/index.html"))
            .andExpect(status().isOk)
            .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_HTML))
            .andExpect(content().string(containsString("Swagger UI")))
    }

    /** 수치로 변환할 수 없는 입력이 원문 노출 없이 ProblemDetail로 반환되는지 검증. */
    @Test
    fun invalidQueryIsSafeProblem() {
        mvc.perform(get("/__test/input").param("count", "secret-marker"))
            .andExpect(status().isBadRequest)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.title").value("Bad Request"))
            .andExpect(jsonPath("$.instance").value("/__test/input"))
            .andExpect(jsonPath("$.type").doesNotExist())
            .andExpect(jsonPath("$.detail").value("요청을 처리할 수 없습니다."))
            .andExpect(content().string(not(containsString("secret-marker"))))
    }

    /** 누락된 필수 입력이 HTTP 400 ProblemDetail로 반환되는지 검증. */
    @Test
    fun missingQueryIsSafeProblem() {
        mvc.perform(get("/__test/input"))
            .andExpect(status().isBadRequest)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.detail").value("요청을 처리할 수 없습니다."))
    }

    /** 잘못된 JSON 본문이 파서 내부 메시지 없이 반환되는지 검증. */
    @Test
    fun malformedJsonIsSafeProblem() {
        mvc.perform(post("/__test/body").contentType(MediaType.APPLICATION_JSON).content("{\"count\":"))
            .andExpect(status().isBadRequest)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.detail").value("요청을 처리할 수 없습니다."))
    }

    /** 지원하지 않는 메서드가 원래 Allow 헤더를 유지하는지 검증. */
    @Test
    fun unsupportedMethodKeepsAllowHeader() {
        mvc.perform(post("/api/v1/status"))
            .andExpect(status().isMethodNotAllowed)
            .andExpect(header().string("Allow", containsString("GET")))
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.status").value(405))
    }

    /** 지원하지 않는 요청 미디어 타입을 HTTP 415로 반환하는지 검증. */
    @Test
    fun unsupportedContentTypeIsProblem() {
        mvc.perform(post("/__test/body").contentType(MediaType.TEXT_PLAIN).content("secret-marker"))
            .andExpect(status().isUnsupportedMediaType)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.status").value(415))
    }

    /** 협상 불가능한 응답 형식을 HTTP 406으로 반환하는지 검증. */
    @Test
    fun unacceptableResponseTypeIsNotAcceptable() {
        mvc.perform(get("/api/v1/status").accept(MediaType.APPLICATION_XML))
            .andExpect(status().isNotAcceptable)
            .andExpect(header().string("Accept", containsString("application/json")))
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.status").value(406))
    }

    /** 없는 경로가 경로 내용을 설명에 노출하지 않고 HTTP 404를 반환하는지 검증. */
    @Test
    fun missingPathIsSafeProblem() {
        mvc.perform(get("/api/v1/secret-marker"))
            .andExpect(status().isNotFound)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.detail").value("요청을 처리할 수 없습니다."))
    }

    /** 예기치 못한 앱 예외를 고정 설명의 HTTP 500으로 반환하는지 검증. */
    @Test
    fun unexpectedExceptionIsSafeProblem() {
        mvc.perform(get("/__test/failure"))
            .andExpect(status().isInternalServerError)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.status").value(500))
            .andExpect(jsonPath("$.detail").value("서버에서 요청을 처리하지 못했습니다."))
            .andExpect(content().string(not(containsString("secret-marker"))))
    }

    /** 명시적 HTTP 오류의 사유가 원문 노출 없이 상태와 안전한 설명을 유지하는지 검증. */
    @Test
    fun responseStatusReasonIsSanitized() {
        mvc.perform(get("/__test/status-error"))
            .andExpect(status().isBadRequest)
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.detail").value("요청을 처리할 수 없습니다."))
            .andExpect(content().string(not(containsString("secret-marker"))))
    }
}
