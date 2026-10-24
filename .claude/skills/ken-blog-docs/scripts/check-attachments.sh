#!/usr/bin/env bash
# 발행 글의 첨부 연결(post_attachments)과 게시 원고의 attachment:·dark= 참조를 대조함. 운영 DB는 읽기만 함
# 실행용: check-attachments.sh
# 출력: 어긋난 글마다 한 줄 "<글 ID> <slug> 원고가 안 쓰는 연결=[…] 연결 없는 참조=[…]", 어긋남이 없으면 "ok"
# 발행 글에 연결된 첨부는 원고가 쓰지 않아도 공개 API로 내려받을 수 있으므로, 첨부를 바꾼 뒤 옛 연결이 남지 않았는지 확인할 때 씀
# 종료 코드: 0 일치, 1 어긋남 있음, 그 밖은 db.sh 종료 코드
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../.." && pwd)
sql=$(mktemp)
out=$(mktemp)
trap 'rm -f "$sql" "$out"' EXIT

# 발행 글마다 연결된 첨부 ID 목록(없으면 빈 값)
cat > "$sql" <<'SQL'
SELECT p.id, p.slug, COALESCE(GROUP_CONCAT(pa.attachment_id ORDER BY pa.attachment_id), '')
FROM posts p LEFT JOIN post_attachments pa ON pa.post_id = p.id
WHERE p.status = 'PUBLISHED'
GROUP BY p.id, p.slug
ORDER BY p.id;
SQL
bash "$root/.claude/skills/ken-blog-stack-badges/scripts/db.sh" "$sql" > "$out"

# 원고의 첨부 참조와 비교해 어긋난 글만 출력
python3 -I - "$out" "$root/content/posts" <<'PY'
import os, re, sys
rows, posts = sys.argv[1], sys.argv[2]
mismatch = 0
with open(rows, encoding="utf-8") as f:
    next(f, None)  # 열 이름 줄
    for line in f:
        post_id, slug, ids = (line.rstrip("\n").split("\t") + [""])[:3]
        linked = {int(x) for x in ids.split(",") if x}
        path = os.path.join(posts, f"{slug}.md")
        if not os.path.exists(path):
            print(post_id, slug, "원고 없음")
            mismatch += 1
            continue
        with open(path, encoding="utf-8") as m:
            used = {int(x) for x in re.findall(r"(?:attachment:|dark=)(\d+)", m.read())}
        if linked != used:
            print(post_id, slug, f"원고가 안 쓰는 연결={sorted(linked - used)}", f"연결 없는 참조={sorted(used - linked)}")
            mismatch += 1
if not mismatch:
    print("ok")
sys.exit(1 if mismatch else 0)
PY
