#!/usr/bin/env python3
"""운영 자산·Markdown 마운트의 UID/GID/모드를 안전하게 준비.

인자 없이 실행하면 권한 계약과 사용법만 출력하며, 경로를 지정해도 기본은 미리보기.
실제 변경은 두 절대경로와 --apply를 모두 지정하고 root/sudo로 실행할 때만 수행.
파일 내용은 읽거나 바꾸지 않고 심볼릭 링크·특수 파일을 먼저 전부 검사함.

자산은 앱 UID 10001 소유, 호스트 Ubuntu GID 1001 읽기 전용 접근.
본문은 기존 소유자를 유지하고 GID 1001/쓰기 권한을 부여해 앱과 호스트가 협업.
새 파일의 그룹 쓰기는 앱 umask 0002 또는 생성 코드의 0660 설정이 별도로 필요.
"""

import argparse
import os
from pathlib import Path
import shlex
import stat
import sys


APP_UID = 10001
HOST_GID = 1001
ASSET_DIR_MODE = 0o750
ASSET_FILE_MODE = 0o640
CONTENT_DIR_MODE = 0o2770
CONTENT_FILE_MODE = 0o660
CONTENT_EXTENSIONS = {".md", ".pending", ".base"}


def validate_root(value: str, name: str) -> Path:
    """명시한 자산·본문 전용 절대경로만 받아 넓은 상위 디렉터리 수정을 방지."""
    path = Path(value)
    if not path.is_absolute() or path.name != name or path == Path("/"):
        raise ValueError(f"--{name}-root는 이름이 {name}인 전용 절대경로여야 합니다")
    return Path(os.path.abspath(path))


def check_ancestors(path: Path) -> None:
    """루트까지의 기존 단계에서 심볼릭 링크와 파일 조상을 거부."""
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(mode):
            raise ValueError(f"디렉터리 경로에 링크 또는 파일이 있습니다: {current}")


def inventory(root: Path) -> tuple[list[Path], list[Path]]:
    """변경 전에 전체 트리를 순회해 링크·특수 파일이 전혀 없는지 확인."""
    check_ancestors(root)
    if not root.exists():
        return [root], []
    directories = [root]
    files = []
    stack = [root]
    while stack:
        directory = stack.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                path = Path(entry.path)
                mode = entry.stat(follow_symlinks=False).st_mode
                if stat.S_ISDIR(mode):
                    directories.append(path)
                    stack.append(path)
                elif stat.S_ISREG(mode):
                    files.append(path)
                else:
                    raise ValueError(f"저장 트리에 링크 또는 특수 파일이 있습니다: {path}")
    return directories, files


def create_root(path: Path) -> None:
    """없는 단계만 만들고 각 단계의 실제 형식을 다시 검사."""
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            current.mkdir(mode=0o700)
            mode = current.lstat().st_mode
        if not stat.S_ISDIR(mode):
            raise ValueError(f"디렉터리 경로가 변경되었습니다: {current}")


def set_group_and_mode(path: Path, group: int, mode: int, owner: int = -1) -> None:
    """링크를 따르지 않는 현재 항목만 chown/chmod하고 파일 바이트는 보존."""
    metadata = path.lstat()
    if not (stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode)):
        raise ValueError(f"경로 형식이 변경되었습니다: {path}")
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    if stat.S_ISDIR(metadata.st_mode):
        flags |= os.O_DIRECTORY
    descriptor = os.open(path, flags)
    try:
        actual = os.fstat(descriptor)
        if (actual.st_dev, actual.st_ino) != (metadata.st_dev, metadata.st_ino):
            raise ValueError(f"경로가 검사 뒤 변경되었습니다: {path}")
        changed_owner = (owner != -1 and actual.st_uid != owner) or actual.st_gid != group
        if changed_owner:
            os.fchown(descriptor, owner, group)
        if changed_owner or stat.S_IMODE(actual.st_mode) != mode:
            os.fchmod(descriptor, mode)
    finally:
        os.close(descriptor)


def print_plan(assets: Path, content: Path, asset_dirs: list[Path], asset_files: list[Path],
    content_dirs: list[Path], content_files: list[Path]) -> None:
    """파일명과 자격 정보 없이 변경 규모와 필요한 root 명령만 출력."""
    editable = sum(file.suffix in CONTENT_EXTENSIONS for file in content_files)
    print(f"자산: {assets} / 디렉터리 {len(asset_dirs)}개(0750, 10001:1001), 파일 {len(asset_files)}개(0640, 10001:1001)")
    print(f"본문: {content} / 디렉터리 {len(content_dirs)}개(2770, GID 1001), .md/.pending/.base {editable}개(0660, GID 1001)")
    command = ["sudo", sys.executable, str(Path(__file__).resolve()),
        "--assets-root", str(assets), "--content-root", str(content), "--apply"]
    print("적용 명령:", shlex.join(command))


def main() -> None:
    """명시한 두 트리를 전부 사전 검사한 뒤에만 권한 변경을 시작."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets-root", help="영속 자산 디렉터리 절대경로; 끝 이름 assets")
    parser.add_argument("--content-root", help="영속 Markdown 디렉터리 절대경로; 끝 이름 content")
    parser.add_argument("--apply", action="store_true", help="root 권한으로 계획한 소유권·모드 적용")
    args = parser.parse_args()
    if args.assets_root is None and args.content_root is None and not args.apply:
        print("미리보기만 실행합니다. 두 전용 절대경로를 지정하면 변경 규모와 sudo 명령을 표시합니다.")
        print("예: python3 ops/prepare-local-storage.py --assets-root /srv/ken-blog/assets --content-root /srv/ken-blog/content")
        return
    if not args.assets_root or not args.content_root:
        parser.error("--assets-root와 --content-root를 모두 지정해야 합니다")
    try:
        assets = validate_root(args.assets_root, "assets")
        content = validate_root(args.content_root, "content")
        if assets == content or assets in content.parents or content in assets.parents:
            raise ValueError("자산과 본문 경로가 겹칩니다")
        asset_dirs, asset_files = inventory(assets)
        content_dirs, content_files = inventory(content)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print_plan(assets, content, asset_dirs, asset_files, content_dirs, content_files)
    if not args.apply:
        print("미리보기 완료: 파일 내용과 권한을 변경하지 않았습니다.")
        return
    if os.geteuid() != 0:
        parser.error("--apply는 sudo/root 권한이 필요합니다")
    create_root(assets)
    create_root(content)
    for file in asset_files:
        set_group_and_mode(file, HOST_GID, ASSET_FILE_MODE, APP_UID)
    for directory in sorted(asset_dirs, key=lambda item: len(item.parts), reverse=True):
        set_group_and_mode(directory, HOST_GID, ASSET_DIR_MODE, APP_UID)
    for file in content_files:
        if file.suffix in CONTENT_EXTENSIONS:
            set_group_and_mode(file, HOST_GID, CONTENT_FILE_MODE)
    for directory in sorted(content_dirs, key=lambda item: len(item.parts), reverse=True):
        set_group_and_mode(directory, HOST_GID, CONTENT_DIR_MODE)
    print("권한 적용 완료: 파일 내용은 변경하지 않았습니다.")


if __name__ == "__main__":
    main()
