#!/usr/bin/env python3
"""DB가 참조하는 OCI 객체를 읽어서 영속 로컬 저장 루트로 복사.

manifest는 DB가 현재 읽는 전체 key를 한 줄씩 저장한 비공개 파일. SQL 출력은
`--print-manifest-sql`로 확인하며, 다음처럼 비밀값 없는 명령으로 내보낼 수 있음.
첨부는 실제 읽을 수 있는 READY 행만 포함하고 PENDING/DELETING은 기존 DB에 남김.

umask 077
mysql --defaults-extra-file=/private/mysql.cnf --batch --skip-column-names --raw DB_NAME \
  -e "$(python3 ops/migrate-oci-assets.py --print-manifest-sql)" > /private/asset-keys.txt

mysql defaults 파일과 결과 manifest는 저장소 밖 0600 권한으로 보관. DB 쓰기 없음.

AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY는 외부 환경에서 제공. 이 도구는 get-object만
호출하며 OCI 객체를 변경하지 않음. 앱을 멈춘 뒤 DB와 원격 객체를 백업하고 실행해야
일관된 시점의 참조를 복사할 수 있음. 출력 manifest와 자격 정보는 저장소에 넣지 않음.
"""

import argparse
import hashlib
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile


KEY = re.compile(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*/[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\.(?:jpg|png)\Z")
# 제거된 프로필 기능의 기존 사진도 이관 시 유실되지 않도록 옛 home_profile 참조 유지.
MANIFEST_SQL = """SELECT object_key FROM attachments WHERE status = 'READY'
UNION SELECT object_key FROM stack_badges
UNION SELECT photo_object_key FROM home_profile WHERE photo_object_key IS NOT NULL;"""


def check_directory(path: Path, root: Path) -> None:
    """기존 링크·타 계정 쓰기를 거부하고 새 디렉터리를 소유자 전용으로 생성."""
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        if current.is_symlink():
            raise RuntimeError("저장 경로에 심볼릭 링크가 있습니다")
        if not current.exists():
            current.mkdir(mode=0o700)
        if not current.is_dir():
            raise RuntimeError("저장 경로가 디렉터리가 아닙니다")
        if (current == root or root in current.parents) and current.stat().st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise RuntimeError("저장 경로가 다른 계정에 쓰기 권한을 허용합니다")


def sha256(path: Path) -> str:
    """파일 전체를 메모리에 올리지 않고 SHA-256을 계산."""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sync_directory(path: Path) -> None:
    """새 파일 이름의 디렉터리 메타데이터를 디스크에 동기화."""
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def copy_object(key: str, root: Path, endpoint: str, region: str, bucket: str) -> bool:
    """OCI 객체를 임시 파일에 받은 뒤 기존 파일과 대조하거나 원자적으로 게시."""
    target = root / key
    check_directory(target.parent, root)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".migration-", suffix=".tmp", dir=target.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        result = subprocess.run(
            ["aws", "--no-cli-pager", "--endpoint-url", endpoint, "--region", region,
             "s3api", "get-object", "--bucket", bucket, "--key", key, str(temporary)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        )
        if result.returncode != 0:
            raise RuntimeError("원격 객체 읽기에 실패했습니다")
        with temporary.open("rb") as source:
            os.fsync(source.fileno())
        if target.is_symlink():
            raise RuntimeError("대상 파일이 심볼릭 링크입니다")
        if target.exists():
            if not target.is_file() or sha256(target) != sha256(temporary):
                raise RuntimeError("기존 로컬 파일과 원격 객체 내용이 다릅니다")
            return False
        try:
            os.link(temporary, target)
        except FileExistsError:
            if target.is_symlink() or not target.is_file() or sha256(target) != sha256(temporary):
                raise RuntimeError("동시 생성된 로컬 파일 내용이 다릅니다")
            return False
        sync_directory(target.parent)
        return True
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    """비공개 manifest의 모든 참조 key를 순서대로 복사·대조."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print-manifest-sql", action="store_true", help="읽기 전용 DB key 추출 SQL 출력")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--endpoint-url")
    parser.add_argument("--region")
    parser.add_argument("--bucket")
    args = parser.parse_args()
    if args.print_manifest_sql:
        print(MANIFEST_SQL)
        return
    if not all((args.manifest, args.root, args.endpoint_url, args.region, args.bucket)):
        parser.error("OCI 읽기에는 --manifest, --root, --endpoint-url, --region, --bucket가 모두 필요합니다")
    if not args.root.is_absolute():
        parser.error("--root는 절대경로여야 합니다")
    if not args.endpoint_url.startswith("https://"):
        parser.error("--endpoint-url은 HTTPS 주소여야 합니다")
    keys = [line.strip() for line in args.manifest.read_text(encoding="ascii").splitlines()]
    if not keys or any(not KEY.fullmatch(key) for key in keys) or len(set(keys)) != len(keys):
        parser.error("manifest는 중복 없는 기존 객체 key 한 줄씩이어야 합니다")
    root = Path(os.path.abspath(args.root))
    check_directory(root, root)
    copied = 0
    for index, key in enumerate(keys, start=1):
        try:
            if copy_object(key, root, args.endpoint_url, args.region, args.bucket):
                copied += 1
        except (OSError, RuntimeError) as exc:
            raise SystemExit(f"{index}/{len(keys)} 객체 처리 실패: {exc}") from None
    print(f"검증 완료: 전체 {len(keys)}개, 신규 복사 {copied}개, 기존 일치 {len(keys) - copied}개")


if __name__ == "__main__":
    main()
