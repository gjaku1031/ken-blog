-- V26은 적용 여부와 무관하게 그대로 두고 동일 실행의 재시도·마지막 공개 버전을 기록.
ALTER TABLE deployment_state
    ADD COLUMN run_attempt INT NULL,
    ADD COLUMN last_successful_operation_id VARCHAR(36) NULL;
