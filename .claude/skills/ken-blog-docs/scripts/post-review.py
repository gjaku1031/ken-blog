#!/usr/bin/env python3
"""공개하지 않은 글의 DB 본문과 공개 범위 전환을 다루는 운영 스크립트.

본문은 한 곳에만 둔다: 공개 글은 저장소의 content/posts/{slug}.md, 그 밖의 글은 운영 DB의 post_bodies.
관리자 API는 본문을 읽기만 하므로 본문 쓰기와 본문이 따라가는 상태 전환은 이 스크립트의 SQL로 한다.

사용:
  post-review.py list                          공개하지 않은 글의 단계·본문 유무 표시
  post-review.py upload <글> <원고.md>          DB 본문 올리기(검수 표시 초기화, 본문 속 첨부를 글에 연결)
  post-review.py download <글> [출력.md]        DB 본문 내려받기(출력 경로를 생략하면 표준 출력)
  post-review.py export <글>...                 검수 완료 글의 DB 본문을 content/posts/{slug}.md로 쓰기
  post-review.py finish <글>...                 커밋한 원고와 DB 본문이 같으면 공개로 바꾸고 DB 본문 삭제
  post-review.py withdraw <글>...               공개 글을 미검수로 내리고 원고를 DB 본문으로 복사
  post-review.py link <글> <연결할 글>          관리자에게만 보이는 글 연결 추가
  post-review.py unlink <글> <연결한 글>        글 연결 삭제

<글>은 posts.id 또는 slug. 종료 코드: 0 성공, 1 조건 불일치로 중단, 2 인자 오류, 그 외는 DB 접속 스크립트의 종료 코드.
공개 전환 순서: export → 원고 커밋·push → finish → Pages 실행. 내리기 순서: withdraw → Pages 실행·404 확인 → 원고 git rm.
"""
import base64
import hashlib
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# 저장소 루트와 운영 DB 접속 스크립트. KEN_BLOG_DB_SH는 시험용 DB로 바꿔 실행할 때만 지정
ROOT = Path(__file__).resolve().parents[4]
DB_SH = os.environ.get("KEN_BLOG_DB_SH", str(ROOT / ".claude/skills/ken-blog-stack-badges/scripts/db.sh"))
CONTENT = ROOT / "content/posts"
# 렌더러의 원문 상한(shared/markdown.ts prepareMarkdown)과 같은 1 MiB
MAX_BODY_BYTES = 1024 * 1024


def fail(message, code=1):
    """사유를 표준 오류에 쓰고 종료."""
    print(message, file=sys.stderr)
    sys.exit(code)


def run_sql(sql):
    """SQL을 임시 파일로 넘겨 실행하고 결과 행을 열 이름 사전의 목록으로 반환. 본문이 든 파일은 실행 뒤 삭제."""
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "statement.sql"
        path.write_text(sql, encoding="utf-8")
        path.chmod(0o600)
        result = subprocess.run([DB_SH, str(path)], capture_output=True, text=True)
    if result.returncode != 0:
        fail(f"DB 실행 실패({result.returncode}): {result.stderr.strip()}", result.returncode)
    lines = [line for line in result.stdout.split("\n") if line]
    if not lines:
        return []
    header = lines[0].split("\t")
    return [dict(zip(header, line.split("\t"))) for line in lines[1:]]


def post(ref):
    """ID 또는 slug로 글의 상태·검수 시각·본문 지문을 조회, 없으면 중단."""
    if re.fullmatch(r"[1-9][0-9]*", ref):
        where = f"p.id = {int(ref)}"
    elif re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", ref):
        where = f"p.slug = '{ref}'"
    else:
        fail(f"글 식별자 형식 오류: {ref}", 2)
    rows = run_sql(
        "SELECT p.id, p.slug, p.status, p.title, IFNULL(p.reviewed_at, '') AS reviewed_at, "
        "IFNULL(b.updated_at, '') AS body_updated_at, IFNULL(SHA2(b.body, 256), '') AS body_sha, "
        "IF(p.reviewed_at IS NOT NULL AND b.post_id IS NOT NULL AND p.reviewed_at >= b.updated_at, 1, 0) AS reviewed_current "
        f"FROM posts p LEFT JOIN post_bodies b ON b.post_id = p.id WHERE {where};")
    if not rows:
        fail(f"글을 찾을 수 없음: {ref}")
    return rows[0]


def read_manuscript(path):
    """원고 파일을 UTF-8로 읽고 크기 상한 검사."""
    if not Path(path).is_file():
        fail(f"원고 파일이 없음: {path}")
    data = Path(path).read_bytes()
    if len(data) > MAX_BODY_BYTES:
        fail(f"원고가 1 MiB를 넘음: {path}")
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        fail(f"원고가 UTF-8이 아님: {path}")
    return data


def body_literal(data):
    """본문 바이트를 따옴표·줄바꿈 이스케이프 없이 넘기는 SQL 식."""
    return f"CONVERT(FROM_BASE64('{base64.b64encode(data).decode()}') USING utf8mb4)"


def attachment_ids(data):
    """본문의 기본 이미지와 dark= 이미지가 가리키는 첨부 ID."""
    text = data.decode("utf-8")
    return sorted({int(value) for value in re.findall(r"attachment:([1-9][0-9]*)", text)}
                  | {int(value) for value in re.findall(r"\|dark=([1-9][0-9]*)", text)})


def command_list(_):
    """공개하지 않은 글을 단계별로 표시."""
    rows = run_sql(
        "SELECT p.id, p.status, IF(p.reviewed_at IS NULL, '', '검수 완료') AS review, "
        "IF(b.post_id IS NULL, '', 'DB') AS body, p.slug, p.title "
        "FROM posts p LEFT JOIN post_bodies b ON b.post_id = p.id WHERE p.status <> 'PUBLISHED' "
        "ORDER BY p.status DESC, p.reviewed_at IS NULL, p.id;")
    for row in rows:
        print("\t".join([row["id"], row["status"], row["review"], row["body"], row["slug"], row["title"]]))
    print(f"{len(rows)}건", file=sys.stderr)


def command_upload(args):
    """DB 본문을 올리고 검수 표시를 초기화. 공개 글은 저장소 원고가 정본이므로 거부."""
    if len(args) != 2:
        fail(__doc__, 2)
    row, data = post(args[0]), read_manuscript(args[1])
    if row["status"] == "PUBLISHED":
        fail(f"공개 글은 저장소 원고를 고침: content/posts/{row['slug']}.md")
    pid = row["id"]
    ids = attachment_ids(data)
    # 글 행을 먼저 갱신해 서버의 잠금 순서(글 → 본문)와 맞추고, 같은 트랜잭션에서 본문 교체
    statements = [
        "START TRANSACTION;",
        f"UPDATE posts SET reviewed_at = NULL, edit_version = edit_version + 1, updated_at = UTC_TIMESTAMP(6) "
        f"WHERE id = {pid} AND status <> 'PUBLISHED';",
        f"INSERT INTO post_bodies (post_id, body, updated_at) "
        f"SELECT * FROM (SELECT id, {body_literal(data)} AS body, UTC_TIMESTAMP(6) AS updated_at FROM posts "
        f"WHERE id = {pid} AND status <> 'PUBLISHED') AS fresh "
        f"ON DUPLICATE KEY UPDATE body = fresh.body, updated_at = fresh.updated_at;",
    ]
    # 관리자 열람 경로는 글에 연결된 첨부만 전달하므로 본문이 쓰는 첨부를 연결(기존 연결은 지우지 않음)
    if ids:
        statements.append(
            f"INSERT IGNORE INTO post_attachments (post_id, attachment_id) "
            f"SELECT {pid}, id FROM attachments WHERE id IN ({', '.join(map(str, ids))});")
    statements.append("COMMIT;")
    run_sql("\n".join(statements))
    after = post(pid)
    if after["body_sha"] != hashlib.sha256(data).hexdigest():
        fail(f"본문이 반영되지 않음: {after['slug']} (상태 {after['status']})")
    linked = run_sql(f"SELECT attachment_id FROM post_attachments WHERE post_id = {pid};")
    missing = sorted(set(ids) - {int(item["attachment_id"]) for item in linked})
    print(f"올림: {after['id']} {after['slug']} {after['status']} 본문 {len(data)}바이트, 첨부 연결 {len(ids) - len(missing)}/{len(ids)}")
    if missing:
        print(f"등록되지 않은 첨부 ID: {missing}", file=sys.stderr)


def command_download(args):
    """DB 본문을 파일 또는 표준 출력으로 내려받음."""
    if len(args) not in (1, 2):
        fail(__doc__, 2)
    row = post(args[0])
    data = stored_body(row)
    if len(args) == 2:
        Path(args[1]).write_bytes(data)
        print(f"내려받음: {row['slug']} → {args[1]} ({len(data)}바이트)", file=sys.stderr)
    else:
        sys.stdout.buffer.write(data)


def stored_body(row):
    """DB 본문 바이트를 읽고 조회한 지문과 대조, 본문이 없으면 중단."""
    if not row["body_sha"]:
        fail(f"DB에 본문이 없음: {row['slug']}")
    rows = run_sql(f"SELECT REPLACE(TO_BASE64(body), '\\n', '') AS body FROM post_bodies WHERE post_id = {row['id']};")
    data = base64.b64decode(rows[0]["body"])
    if hashlib.sha256(data).hexdigest() != row["body_sha"]:
        fail(f"내려받은 본문이 DB 지문과 다름: {row['slug']}")
    return data


def require_reviewed(row):
    """검수 완료 뒤 본문이 바뀌지 않은 미검수 글만 공개 전환 대상으로 허용."""
    if row["status"] != "UNREVIEWED" or row["reviewed_current"] != "1":
        fail(f"검수 완료된 미검수 글이 아님: {row['slug']} (상태 {row['status']}, 검수 {row['reviewed_at'] or '없음'}, "
             f"본문 수정 {row['body_updated_at'] or '없음'})")


def command_export(args):
    """검수 완료 글의 DB 본문을 저장소 원고로 씀. 이어서 커밋·push한 뒤 finish 실행."""
    if not args:
        fail(__doc__, 2)
    for ref in args:
        row = post(ref)
        require_reviewed(row)
        target = CONTENT / f"{row['slug']}.md"
        target.write_bytes(stored_body(row))
        print(f"원고 작성: {target.relative_to(ROOT)} ({row['title']})")
    print("다음: 위 원고를 커밋·push한 뒤 finish 실행", file=sys.stderr)


def command_finish(args):
    """커밋한 원고가 DB 본문과 같을 때만 공개로 바꾸고 DB 본문을 지움."""
    if not args:
        fail(__doc__, 2)
    for ref in args:
        row = post(ref)
        require_reviewed(row)
        relative = f"content/posts/{row['slug']}.md"
        target = ROOT / relative
        if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != row["body_sha"]:
            fail(f"저장소 원고가 DB 본문과 다름: {relative} (export를 다시 실행)")
        # 지운 뒤에는 저장소 원고가 유일한 본문이므로 커밋되지 않은 원고로는 진행하지 않음
        tracked = subprocess.run(["git", "-C", str(ROOT), "ls-files", "--error-unmatch", relative], capture_output=True)
        clean = subprocess.run(["git", "-C", str(ROOT), "diff", "--quiet", "HEAD", "--", relative])
        if tracked.returncode != 0 or clean.returncode != 0:
            fail(f"원고가 커밋되지 않음: {relative}")
        pid = row["id"]
        # 검수한 본문과 같은 지문일 때만 상태를 바꾸고, 공개로 바뀐 경우에만 본문 행 삭제
        run_sql("\n".join([
            "START TRANSACTION;",
            f"UPDATE posts p JOIN post_bodies b ON b.post_id = p.id SET p.status = 'PUBLISHED', "
            f"p.published_at = COALESCE(p.published_at, UTC_TIMESTAMP(6)), p.reviewed_at = NULL, "
            f"p.edit_version = p.edit_version + 1, p.updated_at = UTC_TIMESTAMP(6) "
            f"WHERE p.id = {pid} AND p.status = 'UNREVIEWED' AND p.reviewed_at >= b.updated_at "
            f"AND SHA2(b.body, 256) = '{row['body_sha']}';",
            f"DELETE b FROM post_bodies b JOIN posts p ON p.id = b.post_id WHERE b.post_id = {pid} AND p.status = 'PUBLISHED';",
            "COMMIT;",
        ]))
        after = post(pid)
        if after["status"] != "PUBLISHED" or after["body_sha"]:
            fail(f"공개 전환이 반영되지 않음: {after['slug']} (상태 {after['status']})")
        print(f"공개: {after['id']} {after['slug']} ({after['title']})")
    print("다음: Pages 실행(gh workflow run pages.yml --repo gjaku1031/ken-blog) 후 공개 주소 확인", file=sys.stderr)


def command_withdraw(args):
    """공개 글을 미검수로 내리고 저장소 원고를 DB 본문으로 복사."""
    if not args:
        fail(__doc__, 2)
    for ref in args:
        row = post(ref)
        if row["status"] != "PUBLISHED" or row["body_sha"]:
            fail(f"DB 본문이 없는 공개 글이 아님: {row['slug']} (상태 {row['status']})")
        data = read_manuscript(CONTENT / f"{row['slug']}.md")
        pid = row["id"]
        run_sql("\n".join([
            "START TRANSACTION;",
            f"UPDATE posts SET status = 'UNREVIEWED', reviewed_at = NULL, edit_version = edit_version + 1, "
            f"updated_at = UTC_TIMESTAMP(6) WHERE id = {pid} AND status = 'PUBLISHED';",
            f"INSERT INTO post_bodies (post_id, body, updated_at) "
            f"SELECT id, {body_literal(data)}, UTC_TIMESTAMP(6) FROM posts WHERE id = {pid} AND status = 'UNREVIEWED' "
            f"AND NOT EXISTS (SELECT 1 FROM post_bodies WHERE post_id = {pid});",
            "COMMIT;",
        ]))
        after = post(pid)
        if after["status"] != "UNREVIEWED" or after["body_sha"] != hashlib.sha256(data).hexdigest():
            fail(f"내림이 반영되지 않음: {after['slug']} (상태 {after['status']})")
        print(f"내림: {after['id']} {after['slug']} ({after['title']}) 본문 {len(data)}바이트")
    print("다음: Pages 실행 후 공개 주소 404 확인, 그다음 원고 git rm·커밋", file=sys.stderr)


def command_link(args, remove=False):
    """관리자에게만 보이는 글 연결을 추가하거나 삭제. 조회는 방향이 없으므로 한 방향만 저장."""
    if len(args) != 2:
        fail(__doc__, 2)
    first, second = post(args[0]), post(args[1])
    if first["id"] == second["id"]:
        fail("같은 글끼리는 연결하지 않음")
    a, b = first["id"], second["id"]
    if remove:
        run_sql(f"DELETE FROM post_links WHERE (post_id = {a} AND linked_post_id = {b}) OR (post_id = {b} AND linked_post_id = {a});")
    else:
        # 반대 방향 행이 이미 있으면 같은 연결이므로 추가하지 않음
        run_sql(f"INSERT INTO post_links (post_id, linked_post_id) SELECT {a}, {b} FROM DUAL WHERE NOT EXISTS "
                f"(SELECT 1 FROM post_links WHERE (post_id = {a} AND linked_post_id = {b}) OR (post_id = {b} AND linked_post_id = {a}));")
    count = run_sql(f"SELECT COUNT(*) AS n FROM post_links WHERE (post_id = {a} AND linked_post_id = {b}) OR (post_id = {b} AND linked_post_id = {a});")[0]["n"]
    print(f"{'연결 삭제' if remove else '연결'}: {first['slug']} ↔ {second['slug']} (현재 {count}행)")


COMMANDS = {
    "list": command_list, "upload": command_upload, "download": command_download, "export": command_export,
    "finish": command_finish, "withdraw": command_withdraw, "link": command_link,
    "unlink": lambda args: command_link(args, remove=True),
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        fail(__doc__, 2)
    COMMANDS[sys.argv[1]](sys.argv[2:])
