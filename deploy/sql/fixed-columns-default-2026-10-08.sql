-- 2026-10-08 1단계(확장): 새 API 배포 전 실행. 새 API는 series.visibility를 쓰지 않으므로 시리즈 INSERT가 실패하지 않게 기본값 지정
-- 다른 대상 열은 NULL 허용이거나 기본값이 있고, attachments는 API가 INSERT하지 않음
ALTER TABLE series ALTER COLUMN visibility SET DEFAULT 'PUBLIC';
