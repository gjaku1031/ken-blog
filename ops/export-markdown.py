#!/usr/bin/env python3
"""기존 MySQL 원고·편집본을 파일로 한 번 추출하는 읽기 전용 DB 도구.

운영 앱을 멈추고 DB 백업을 확보한 뒤 실행한다. DB에 쓰지 않으며 기존 파일은
절대 덮어쓰지 않는다. 출력 content 루트는 절대경로를 명시해야 한다.
mysql --defaults-extra-file에 사용할 자격 파일은 저장소 밖의 0600 파일이어야 한다.

예: python3 ops/export-markdown.py --defaults-file /private/mysql.cnf \
    --database ken_blog --content-root /srv/ken-blog/content --apply
"""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile


TABLES = (
    "posts", "editor_drafts", "post_attachments", "post_wiki_links", "post_tags",
    "editor_draft_attachments", "editor_draft_wiki_links",
)
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")


def query(defaults: Path, database: str, sql: str):
    """서버 결과를 비밀값 로그 없이 줄 단위로 소비한다."""
    args = ["mysql", f"--defaults-extra-file={defaults}", "--batch", "--skip-column-names",
            "--raw", "--default-character-set=utf8mb4", "--database", database, "--execute", sql]
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                               encoding="utf-8", errors="strict")
    try:
        assert process.stdout is not None
        for line in process.stdout:
            yield line.rstrip("\n")
    finally:
        process.stdout.close()
        if process.wait() != 0:
            raise RuntimeError("MySQL 읽기 실패; 대상 DB와 권한을 확인하세요")


def columns(defaults: Path, database: str, table: str) -> list[str]:
    sql = ("select column_name from information_schema.columns "
           f"where table_schema = database() and table_name = '{table}' order by ordinal_position")
    result = list(query(defaults, database, sql))
    if any(not re.fullmatch(r"[a-z][a-z0-9_]*", name) for name in result):
        raise RuntimeError(f"기존 {table} 테이블의 열을 확인할 수 없습니다")
    return result


def visible_slugs(defaults: Path, database: str) -> set[str]:
    """Pages snapshot과 같은 부모 공개 조건으로 Git에 놓을 slug만 선별한다."""
    project_exists = bool(columns(defaults, database, "projects"))
    course_exists = bool(columns(defaults, database, "courses"))
    joins = []
    sections = ["p.section = 'TECH'"]
    if project_exists:
        joins += ["left join projects project on project.id = p.project_id",
                  "left join posts home on home.id = project.home_post_id"]
        sections += ["(p.section = 'PROJECT_HOME' and project.visibility = 'PUBLIC' "
                     "and project.home_post_id = p.id)",
                     "(p.section = 'PROJECT_DOC' and project.visibility = 'PUBLIC' "
                     "and home.status = 'PUBLISHED' and home.visibility = 'PUBLIC' "
                     "and home.section = 'PROJECT_HOME' and home.project_id = project.id)"]
    if course_exists:
        joins.append("left join courses course on course.id = p.course_id")
        sections.append("(p.section = 'NOTE_CHAPTER' and course.id is not null)")
    sql = ("select p.slug from posts p " + " ".join(joins) +
           " where p.status = 'PUBLISHED' and p.visibility = 'PUBLIC' and (" +
           " or ".join(sections) + ")")
    return set(query(defaults, database, sql))


def private_directory(path: Path) -> None:
    """새 경로만 만들고 기존 링크·특수 파일을 거부한다."""
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            current.mkdir(mode=0o700)
            mode = current.lstat().st_mode
        if not stat.S_ISDIR(mode):
            raise RuntimeError(f"출력 경로가 디렉터리가 아닙니다: {current}")


def write_new(path: Path, data: bytes, mode: int = 0o600) -> None:
    """완성·fsync한 임시 파일만 hard link로 공개하고 기존 파일은 보존한다."""
    private_directory(path.parent)
    descriptor, temporary = tempfile.mkstemp(prefix=".markdown-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fchmod(output.fileno(), mode)
            os.fsync(output.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            if path.is_symlink() or not path.is_file() or path.read_bytes() != data:
                raise RuntimeError(f"기존 원고와 DB 추출본이 다릅니다: {path}")
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        os.unlink(temporary)


def json_expression(names: list[str]) -> str:
    values = ", ".join(f"'{name}', `{name}`" for name in names)
    return f"JSON_OBJECT({values})"


def export_rows(defaults: Path, database: str, root: Path, table: str, public: set[str]) -> int:
    names = columns(defaults, database, table)
    if not names:
        if table == "posts":
            raise RuntimeError("기존 posts 테이블을 찾을 수 없습니다")
        return 0
    if table in {"posts", "editor_drafts"}:
        if "id" not in names or "body" not in names:
            raise RuntimeError(f"{table}의 원고 열이 없습니다")
        metadata = json_expression([name for name in names if name != "body"])
        sql = (f"select id, replace(to_base64(cast(body as binary)), char(10), ''), {metadata} "
               f"from `{table}` order by id")
    else:
        sql = f"select {json_expression(names)} from `{table}`"
    count = 0
    manifest = []
    for line in query(defaults, database, sql):
        if table in {"posts", "editor_drafts"}:
            parts = line.split("\t", 2)
            if len(parts) != 3:
                raise RuntimeError(f"{table} 원고 응답 형식 오류")
            row_id, encoded, raw_metadata = parts
            item = json.loads(raw_metadata)
            if int(row_id) != item.get("id"):
                raise RuntimeError(f"{table} ID 불일치")
            body = base64.b64decode(encoded, validate=True)
            if len(body) > 1024 * 1024:
                raise RuntimeError(f"{table} 원고 1 MiB 초과: {row_id}")
            body.decode("utf-8", errors="strict")
            if table == "posts":
                slug = item.get("slug")
                if not isinstance(slug, str) or not SLUG.fullmatch(slug):
                    raise RuntimeError(f"기존 slug 형식 오류: {row_id}")
                folder = "posts" if slug in public else "local-posts"
                target = root / folder / f"{slug}.md"
            else:
                target = root / "local-drafts" / f"{row_id}.md"
            write_new(target, body, 0o660)
            item["exportedPath"] = str(target.relative_to(root))
            item["exportedSha256"] = hashlib.sha256(body).hexdigest()
        else:
            item = json.loads(line)
        manifest.append(json.dumps(item, ensure_ascii=False, separators=(",", ":")))
        count += 1
    write_new(root / "legacy-metadata" / f"{table}.jsonl", ("\n".join(manifest) + "\n").encode("utf-8"))
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--defaults-file", type=Path)
    parser.add_argument("--database")
    parser.add_argument("--content-root", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.apply:
        print("읽기 전용 추출 도구입니다. DB 백업과 경로를 확인한 뒤 --apply를 지정하세요.")
        return
    if not args.defaults_file or not args.database or not args.content_root:
        parser.error("--defaults-file, --database, --content-root가 필요합니다")
    if not args.content_root.is_absolute() or not re.fullmatch(r"[A-Za-z0-9_-]+", args.database):
        parser.error("절대 출력 경로와 단순 DB 이름이 필요합니다")
    if not args.defaults_file.is_absolute() or args.defaults_file.stat().st_mode & 0o077:
        parser.error("자격 파일은 저장소 밖의 0600 절대경로여야 합니다")
    repository_root = Path(__file__).resolve().parent.parent
    if args.defaults_file.resolve() == repository_root or repository_root in args.defaults_file.resolve().parents:
        parser.error("자격 파일은 저장소 밖에 있어야 합니다")
    if args.content_root.is_symlink():
        parser.error("출력 루트는 심볼릭 링크일 수 없습니다")
    root = args.content_root.resolve(strict=False)
    if root.is_symlink() or root.name != "content":
        parser.error("출력 루트는 이름이 content인 실제 디렉터리여야 합니다")
    private_directory(root)
    public = visible_slugs(args.defaults_file, args.database)
    for table in TABLES:
        count = export_rows(args.defaults_file, args.database, root, table, public)
        print(f"{table}: {count}건 추출")


if __name__ == "__main__":
    main()
