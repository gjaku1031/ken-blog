-- 기존 7299253 스키마의 유지보수 창에서 한 번만 실행
-- API 쓰기 중지·백업·열 존재 여부 확인 후 적용, 기존 본문·해시·계정·세션은 보존
ALTER TABLE posts ADD COLUMN edit_version BIGINT NOT NULL DEFAULT 0;

-- 출처 원문 없이 해시와 짧은 실패 창만 저장
CREATE TABLE admin_login_sources (
    source_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    failure_count INT NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    KEY ix_login_source_expiry (expires_at)
) ENGINE=InnoDB;

-- 기존 전역 실패 상태를 새 연산 한도 창으로 전환
UPDATE admin_auth_state SET failure_count = 0, locked_until = NULL WHERE id = 1;
