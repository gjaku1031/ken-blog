-- 인증 상태 유실 사고 때 API를 중지한 뒤에만 실행하는 명시적 복구
-- 세션을 전부 폐기하여 이전 auth_version이 재사용되어도 세션이 복원되지 않음
START TRANSACTION;
DELETE FROM SPRING_SESSION;
DELETE FROM admin_login_sources;
INSERT INTO admin_auth_state (id, config_fingerprint, auth_version, failure_count, locked_until)
VALUES (1, REPEAT('0', 64), 0, 0, NULL)
ON DUPLICATE KEY UPDATE config_fingerprint = REPEAT('0', 64), auth_version = auth_version + 1,
    failure_count = 0, locked_until = NULL;
COMMIT;
