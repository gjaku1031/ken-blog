package io.github.gjaku1031.kenblog.auth.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Objects;

/**
 * 단일 관리자 로그인 요청, 비밀번호는 로그 문자열에서 숨김
 */
@JsonIgnoreProperties("username")
public final class LoginRequest {
    /**
     * 원문 비밀번호, 필수
     */
    private final String password;

    /**
     * 30일 비활동 만료·브라우저 쿠키 사용 여부, 생략하면 일반 로그인
     */
    @JsonProperty private boolean rememberMe = false;

    /**
     * 필수 비밀번호를 읽고 생략한 로그인 유지 여부는 false로 초기화
     */
    @JsonCreator
    public LoginRequest(@JsonProperty(value = "password", required = true) String password) {
        this(password, false);
    }

    /**
     * 직접 호출의 비밀번호·로그인 유지 여부 초기화
     */
    public LoginRequest(String password, boolean rememberMe) {
        this.password = Objects.requireNonNull(password, "password");
        this.rememberMe = rememberMe;
    }

    /**
     * 인증에 사용할 원문 비밀번호
     */
    @JsonProperty
    public String password() {
        return password;
    }

    /**
     * 로그인 유지 여부
     */
    public boolean rememberMe() {
        return rememberMe;
    }

    /**
     * 실수로 요청 객체를 로깅해도 비밀번호가 출력되지 않게 고정 문자열을 반환
     *
     * @return 비밀값을 제외한 요청 식별 문자열
     */
    @Override
    public String toString() {
        return "LoginRequest(redacted)";
    }
}
