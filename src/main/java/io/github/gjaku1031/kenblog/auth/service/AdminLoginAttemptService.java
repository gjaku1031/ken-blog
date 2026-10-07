package io.github.gjaku1031.kenblog.auth.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.account.domain.UserRole;
import io.github.gjaku1031.kenblog.account.repository.AccountRepository;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.Objects;

/**
 * 단일 DB 행 잠금 안에서 관리자 비밀번호와 로그인 실패 제한 처리
 */
@Service
@RequiredArgsConstructor
public class AdminLoginAttemptService implements ApplicationRunner {
    /**
     * JDBC 쿼리 실행기
     */
    private final JdbcTemplate jdbc;

    /**
     * 계정 조회 저장소
     */
    private final AccountRepository accounts;

    /**
     * 비밀번호 검증기
     */
    private final PasswordEncoder encoder;

    /**
     * 단일 관리자 설정
     */
    private final AdminAuthSettings settings;

    /**
     * 제한 기간 계산 UTC 시계
     */
    private final Clock clock;

    /**
     * 관리자 미설정 상태 지문
     */
    private static final String UNCONFIGURED_FINGERPRINT = "0".repeat(64);

    /**
     * 출처별 실패 한도
     */
    private static final int MAX_FAILURES = 5;

    /**
     * 제한 창 길이, 초 단위
     */
    private static final long LOCK_SECONDS = 60;

    /**
     * 재시작 시 설정 회전 기록 및 JPA 외부 보조 테이블·필수 상태 행 확인
     */
    @Transactional
    @Override
    public void run(ApplicationArguments args) {
        synchronizeSettings(lockedState(), settings.configured());
        jdbc.queryForList(
                "SELECT source_key, failure_count, expires_at FROM admin_login_sources WHERE 1 ="
                    + " 0");
        jdbc.queryForList(
                "SELECT PRIMARY_ID, SESSION_ID, CREATION_TIME, LAST_ACCESS_TIME,"
                    + " MAX_INACTIVE_INTERVAL, EXPIRY_TIME, PRINCIPAL_NAME FROM SPRING_SESSION"
                    + " WHERE 1 = 0");
        jdbc.queryForList(
                "SELECT SESSION_PRIMARY_ID, ATTRIBUTE_NAME, ATTRIBUTE_BYTES FROM"
                    + " SPRING_SESSION_ATTRIBUTES WHERE 1 = 0");
        jdbc.queryForObject("SELECT id FROM content_state WHERE id = 1", Byte.class);
    }

    /**
     * 직접 서비스 호출의 기본 출처에 인증 제한 적용
     */
    @Transactional
    public AdminLoginResult attempt(String password) {
        return attempt(password, "direct-service");
    }

    /**
     * 실패 상태도 커밋되도록 결과 반환; 공유 잠금·연산 예산·인증·출처별 실패 순서
     */
    @Transactional
    public AdminLoginResult attempt(String password, String source) {
        var state = lockedState();
        var config = settings.configured();
        synchronizeSettings(state, config);
        Instant now = clock.instant();
        var timestamp = LocalDateTime.ofInstant(now, ZoneOffset.UTC);
        var expires = LocalDateTime.ofInstant(now.plusSeconds(LOCK_SECONDS), ZoneOffset.UTC);
        // 최초 실패부터 60초 창을 유지하고 차단 요청으로 연장하지 않음
        jdbc.update("DELETE FROM admin_login_sources WHERE expires_at <= ?", timestamp);
        var failures =
                jdbc.query(
                        "SELECT failure_count FROM admin_login_sources WHERE source_key = ?",
                        (rs, index) -> rs.getInt(1),
                        source);
        int sourceFailures = failures.isEmpty() ? 0 : failures.getFirst();
        if (sourceFailures >= MAX_FAILURES) return AdminLoginResult.Locked.INSTANCE;
        // 전체 BCrypt 실행은 60초당 30회, 출처 상태는 최대 4096개
        boolean inWindow = state.lockedUntil != null && state.lockedUntil.isAfter(now);
        int work = inWindow ? state.failureCount : 0;
        if (work >= 30) return AdminLoginResult.Locked.INSTANCE;
        if (sourceFailures == 0
                && Objects.requireNonNull(
                                jdbc.queryForObject(
                                        "SELECT COUNT(*) FROM admin_login_sources", Integer.class))
                        >= 4096) return AdminLoginResult.Locked.INSTANCE;
        jdbc.update(
                "UPDATE admin_auth_state SET failure_count = ?, locked_until = ? WHERE id = 1",
                work + 1,
                inWindow ? LocalDateTime.ofInstant(state.lockedUntil, ZoneOffset.UTC) : expires);
        // 비밀번호 원문을 trim하지 않고 UTF-8 72바이트 상한 적용
        var account = config == null ? null : accounts.findByUsername(config.username());
        boolean validPassword =
                account != null
                        && !password.isEmpty()
                        && password.getBytes(StandardCharsets.UTF_8).length <= 72
                        && encoder.matches(password, account.getPasswordHash());
        boolean validOwner =
                account != null && account.getEnabled() && account.getRole() == UserRole.ADMIN;
        if (validPassword && validOwner) {
            jdbc.update("DELETE FROM admin_login_sources WHERE source_key = ?", source);
            return new AdminLoginResult.Success(
                    config.username(),
                    sessionProof(config.fingerprint(), account.getPasswordHash()),
                    state.authVersion);
        }
        // 실패 결과도 예외 없이 커밋하여 출처 제한 우회 방지
        jdbc.update(
                "INSERT INTO admin_login_sources (source_key, failure_count, expires_at) VALUES (?,"
                    + " 1, ?) ON DUPLICATE KEY UPDATE failure_count = failure_count + 1",
                source,
                expires);
        return sourceFailures + 1 >= MAX_FAILURES
                ? AdminLoginResult.Locked.INSTANCE
                : AdminLoginResult.Denied.INSTANCE;
    }

    /**
     * 세션 증명·현재 설정·계정 해시·DB 버전 대조; 행 누락만 인증 거부로 처리
     */
    public boolean isValidSession(
            String username, String passwordHash, Object proof, Object version) {
        var config = settings.configured();
        if (config == null
                || !username.equals(config.username())
                || !(proof instanceof String text)
                || !(version instanceof Long number)) return false;
        if (!MessageDigest.isEqual(
                text.getBytes(StandardCharsets.UTF_8),
                sessionProof(config.fingerprint(), passwordHash).getBytes(StandardCharsets.UTF_8)))
            return false;
        try {
            var state =
                    jdbc.queryForObject(
                            "SELECT config_fingerprint, auth_version FROM admin_auth_state WHERE id"
                                + " = 1",
                            (rs, index) -> new SessionState(rs.getString(1), rs.getLong(2)));
            return state != null
                    && Objects.equals(state.fingerprint(), config.fingerprint())
                    && state.version() == number;
        } catch (EmptyResultDataAccessException exception) {
            return false;
        }
    }

    /**
     * 모든 로그인 시도를 직렬화할 단일 상태 행을 배타적으로 조회
     *
     * @throws EmptyResultDataAccessException 필수 인증 상태 행이 없을 때
     */
    private AuthState lockedState() {
        return Objects.requireNonNull(
                jdbc.queryForObject(
                        "SELECT config_fingerprint, auth_version, failure_count, locked_until FROM"
                            + " admin_auth_state WHERE id = 1 FOR UPDATE",
                        (rs, index) -> {
                            var until = rs.getTimestamp(4);
                            return new AuthState(
                                    rs.getString(1),
                                    rs.getLong(2),
                                    rs.getInt(3),
                                    until == null
                                            ? null
                                            : until.toLocalDateTime().toInstant(ZoneOffset.UTC));
                        }));
    }

    /**
     * 설정 변경마다 DB·메모리 버전을 올리고 이전 인증 예산 초기화
     */
    private void synchronizeSettings(AuthState state, ConfiguredAdminAuth config) {
        String fingerprint = config == null ? UNCONFIGURED_FINGERPRINT : config.fingerprint();
        if (!Objects.equals(state.fingerprint, fingerprint)) {
            jdbc.update(
                    "UPDATE admin_auth_state SET config_fingerprint = ?, auth_version ="
                        + " auth_version + 1, failure_count = 0, locked_until = NULL WHERE id = 1",
                    fingerprint);
            state.fingerprint = fingerprint;
            state.authVersion++;
            state.failureCount = 0;
            state.lockedUntil = null;
        }
    }

    /**
     * 설정 지문과 저장 비밀번호 해시를 묶은 세션 증명
     */
    private String sessionProof(String fingerprint, String passwordHash) {
        return AdminAuthSettings.sha256(
                "admin-session-v2\u0000" + fingerprint + "\u0000" + passwordHash);
    }

    /**
     * 세션 확인용 최신 상태
     */
    private record SessionState(
            /**
             * 설정 지문
             */
            String fingerprint,

            /**
             * 인증 버전
             */
            long version) {}

    /**
     * 잠긴 인증 상태 행의 트랜잭션 내부 상태
     */
    private static final class AuthState {
        /**
         * 설정 지문
         */
        private String fingerprint;

        /**
         * 인증 버전
         */
        private long authVersion;

        /**
         * 현재 창의 검증 횟수
         */
        private int failureCount;

        /**
         * 전체 검증 창 만료 시각
         */
        private Instant lockedUntil;

        /**
         * 잠금 조회 결과 초기화
         */
        private AuthState(
                String fingerprint, long authVersion, int failureCount, Instant lockedUntil) {
            this.fingerprint = fingerprint;
            this.authVersion = authVersion;
            this.failureCount = failureCount;
            this.lockedUntil = lockedUntil;
        }
    }
}
