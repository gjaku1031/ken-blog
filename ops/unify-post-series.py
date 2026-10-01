#!/usr/bin/env python3
"""Post·Series 메타데이터 이관. 기본은 읽기 전용 점검, --apply로만 적용.

앱 쓰기를 중지하고 DB 백업·Markdown 추출을 완료한 뒤 실행한다.
원문/ID/slug/기존 테이블을 삭제하지 않으며 출처별 메타데이터를 별도로 보존한다.
mysql --defaults-extra-file 자격 파일은 저장소 밖의 0600 파일로 지정한다.
예: python3 ops/unify-post-series.py --defaults-file /private/mysql.cnf --database ken_blog
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--defaults-file', required=True, type=Path)
    parser.add_argument('--database', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    mode = args.defaults_file.lstat().st_mode
    if not stat.S_ISREG(mode) or stat.S_IMODE(mode) != 0o600 or not args.defaults_file.is_absolute():
        parser.error('절대경로의 일반 0600 자격 파일을 지정하세요.')
    if not re.fullmatch(r'[a-zA-Z0-9_]+', args.database):
        parser.error('DB 이름 형식을 확인하세요.')
    command = ['mysql', f'--defaults-extra-file={args.defaults_file}', '--batch', '--skip-column-names',
               '--raw', '--default-character-set=utf8mb4', f'--database={args.database}']

    def query(sql):
        result = subprocess.run(command, input=sql, text=True, capture_output=True, check=False)
        if result.returncode:
            raise RuntimeError('MySQL 작업 실패. 연결·스키마·고유 제약을 확인하세요. DML 트랜잭션은 롤백됩니다.')
        return result.stdout.splitlines()

    tables = set(query('SHOW TABLES;'))
    if 'content_model_migrations' in tables and query("SELECT name FROM content_model_migrations WHERE name='post-series-v1';"):
        print('이미 이관 완료: 변경 없음'); return
    required = {'posts', 'projects', 'courses', 'project_stack_badges', 'stack_badges'}
    if not required <= tables:
        raise RuntimeError('이 도구는 이전 Post/Projects/Courses 스키마 전용입니다. 새 DB에는 이관이 필요하지 않습니다.')
    columns = query("SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='posts' ORDER BY ordinal_position;")
    if not all(re.fullmatch(r'[a-z][a-z0-9_]*', col) for col in columns):
        raise RuntimeError('알 수 없는 열 이름')
    if not {'section', 'project_id', 'course_id', 'tech_series_order', 'related_project_id'} <= set(columns):
        raise RuntimeError('이전 글 스키마를 확인하세요.')
    if 'series' in tables and query('SELECT id FROM series LIMIT 1;'):
        raise RuntimeError('시리즈 테이블이 비어 있지 않습니다. 이관 완료 여부·주소 충돌을 확인하세요.')
    # 같은 주소를 임의 변경하지 않고 사전 보고 후 중단.
    collisions = query('SELECT p.id FROM projects p JOIN courses c ON p.slug=c.slug LIMIT 1;')
    invalid = query("""SELECT p.id FROM posts p LEFT JOIN projects pr ON pr.id=p.project_id
        LEFT JOIN courses c ON c.id=p.course_id WHERE p.section NOT IN ('TECH','PROJECT_HOME','PROJECT_DOC','NOTE_CHAPTER')
        OR (p.section IN ('PROJECT_HOME','PROJECT_DOC') AND pr.id IS NULL)
        OR (p.section='NOTE_CHAPTER' AND c.id IS NULL) LIMIT 1;""")
    if collisions or invalid:
        raise RuntimeError('부모 주소 중복 또는 고아 글/알 수 없는 구획이 있습니다. 원본을 보존하고 수동 정리가 필요합니다.')
    print(json.dumps({'mode': 'apply' if args.apply else 'check', 'counts': query(
        'SELECT section, COUNT(*) FROM posts GROUP BY section ORDER BY section;'),
        'preserved': ['post IDs/slugs/bodies', 'old tables', 'private/draft metadata'],
        'retired_mfa_data': 'admin_recovery_codes/last_totp_step는 삭제하지 않음'}, ensure_ascii=False))
    if not args.apply:
        return

    def manuscript_digest():
        return hashlib.sha256('\n'.join(query("SELECT id, slug, SHA2(body,256), body_sha256 FROM posts ORDER BY id;")).encode()).hexdigest()
    before = manuscript_digest()
    ddl = """
    CREATE TABLE IF NOT EXISTS series (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name VARCHAR(200) NOT NULL, description VARCHAR(1000) NOT NULL,
      kind VARCHAR(16) NOT NULL, visibility VARCHAR(16) NOT NULL,
      project_status VARCHAR(16), start_period VARCHAR(7), end_period VARCHAR(7),
      sort_order BIGINT NOT NULL, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
      legacy_source VARCHAR(16), legacy_id BIGINT,
      UNIQUE KEY uk_series_slug(slug), UNIQUE KEY uk_series_legacy(legacy_source,legacy_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE IF NOT EXISTS series_stack_badges (
      series_id BIGINT NOT NULL, badge_id BIGINT NOT NULL, sort_order INT NOT NULL,
      PRIMARY KEY(series_id,badge_id), UNIQUE KEY uk_series_stack_badges_order(series_id,sort_order),
      FOREIGN KEY(series_id) REFERENCES series(id) ON DELETE CASCADE,
      FOREIGN KEY(badge_id) REFERENCES stack_badges(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
    CREATE TABLE IF NOT EXISTS post_model_legacy_metadata (
      post_id BIGINT PRIMARY KEY, metadata JSON NOT NULL, saved_at DATETIME(6) NOT NULL
    ) ENGINE=InnoDB;
    CREATE TABLE IF NOT EXISTS content_model_migrations (
      name VARCHAR(64) PRIMARY KEY, completed_at DATETIME(6) NOT NULL
    ) ENGINE=InnoDB;
    """
    for col, definition in {'series_id': 'BIGINT NULL', 'related_series_id': 'BIGINT NULL',
                            'series_order': 'INT NULL', 'legacy_path': 'VARCHAR(500) NULL'}.items():
        if col not in columns:
            ddl += f'ALTER TABLE posts ADD COLUMN {col} {definition};\n'
    query(ddl)  # DDL는 별도 단계. 중단돼도 기존 원고와 상태에는 변화 없음.
    metadata = ','.join(f"'{col}',p.`{col}`" for col in columns if col != 'body')
    sql = f"""
    START TRANSACTION;
    SELECT id FROM posts ORDER BY id FOR UPDATE;
    SELECT id FROM projects ORDER BY id FOR UPDATE;
    SELECT id FROM courses ORDER BY id FOR UPDATE;
    INSERT INTO post_model_legacy_metadata(post_id,metadata,saved_at)
      SELECT p.id,JSON_OBJECT({metadata}),UTC_TIMESTAMP(6) FROM posts p;
    INSERT INTO series(slug,name,description,kind,visibility,project_status,start_period,end_period,sort_order,created_at,updated_at,legacy_source,legacy_id)
      SELECT slug,name,overview,'PROJECT',visibility,status,start_period,end_period,sort_order,created_at,updated_at,'PROJECT',id FROM projects;
    INSERT INTO series(slug,name,description,kind,visibility,sort_order,created_at,updated_at,legacy_source,legacy_id)
      SELECT slug,name,CONCAT(field,CHAR(10),description),'TECH','PUBLIC',id,created_at,updated_at,'COURSE',id FROM courses;
    INSERT INTO series_stack_badges(series_id,badge_id,sort_order)
      SELECT s.id,b.badge_id,b.sort_order FROM project_stack_badges b JOIN series s ON s.legacy_source='PROJECT' AND s.legacy_id=b.project_id;
    CREATE TEMPORARY TABLE visible_before (post_id BIGINT PRIMARY KEY);
    INSERT INTO visible_before SELECT p.id FROM posts p LEFT JOIN projects pr ON pr.id=p.project_id
      LEFT JOIN posts h ON h.id=pr.home_post_id
      WHERE p.status='PUBLISHED' AND p.visibility='PUBLIC' AND (
        p.section IN ('TECH','NOTE_CHAPTER') OR
        (pr.visibility='PUBLIC' AND h.status='PUBLISHED' AND h.visibility='PUBLIC'
          AND h.section='PROJECT_HOME' AND h.project_id=pr.id
          AND (p.section='PROJECT_DOC' OR p.id=h.id)));
    UPDATE posts p LEFT JOIN series s ON
      (s.legacy_source='PROJECT' AND s.legacy_id=p.project_id AND p.section IN ('PROJECT_HOME','PROJECT_DOC')) OR
      (s.legacy_source='COURSE' AND s.legacy_id=p.course_id AND p.section='NOTE_CHAPTER')
      LEFT JOIN series related ON related.legacy_source='PROJECT' AND related.legacy_id=p.related_project_id
      LEFT JOIN projects pr ON pr.id=p.project_id LEFT JOIN courses c ON c.id=p.course_id
      LEFT JOIN visible_before v ON v.post_id=p.id
      SET p.series_id=s.id, p.related_series_id=related.id,
        p.series_order=CASE p.section WHEN 'PROJECT_HOME' THEN 1 WHEN 'PROJECT_DOC' THEN NULL
          WHEN 'NOTE_CHAPTER' THEN IF(p.chapter_order>0,p.chapter_order,NULL) ELSE IF(p.tech_series_order>0,p.tech_series_order,NULL) END,
        p.legacy_path=CASE p.section WHEN 'PROJECT_HOME' THEN CONCAT('project/',pr.slug)
          WHEN 'PROJECT_DOC' THEN CONCAT('project/',pr.slug,'/docs/',p.slug)
          WHEN 'NOTE_CHAPTER' THEN CONCAT('course/',c.slug,'/chapters/',p.slug) ELSE NULL END,
        p.status=IF(p.status='PUBLISHED' AND v.post_id IS NULL,'DRAFT',p.status);
    -- 대문은 1, 기존 문서는 기존 문서순서와 ID순으로 2부터 연속 번호 부여.
    CREATE TEMPORARY TABLE project_order AS
      SELECT id,ROW_NUMBER() OVER(PARTITION BY project_id ORDER BY document_order IS NULL,document_order,id)+1 AS position
      FROM posts WHERE section='PROJECT_DOC';
    UPDATE posts p JOIN project_order o ON o.id=p.id SET p.series_order=o.position;
    UPDATE posts SET section='TECH';
    CREATE TEMPORARY TABLE migration_assert (ok INT CHECK(ok=1));
    INSERT INTO migration_assert SELECT IF(
      (SELECT COUNT(*) FROM post_model_legacy_metadata)=(SELECT COUNT(*) FROM posts) AND
      NOT EXISTS(SELECT 1 FROM posts p LEFT JOIN series s ON s.id=p.series_id LEFT JOIN visible_before v ON v.post_id=p.id
        WHERE p.status='PUBLISHED' AND p.visibility='PUBLIC' AND (p.series_id IS NULL OR s.visibility='PUBLIC') AND v.post_id IS NULL),1,0);
    INSERT INTO content_model_migrations VALUES('post-series-v1',UTC_TIMESTAMP(6));
    COMMIT;
    """
    query(sql)
    if manuscript_digest() != before:
        raise RuntimeError('원고/주소 해시 불일치. 앱 기동을 중단하고 백업과 비교하세요.')
    print('이관 완료: ID·slug·원고 해시 보존 확인. 기존 테이블과 MFA 자료 보존.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError) as error:
        raise SystemExit(str(error))
