#!/usr/bin/env python3
from datetime import datetime
from pathlib import Path
import hashlib
import json
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = json.loads((ROOT / "results/production-snapshot.json").read_text(encoding="utf-8"))
BODY_DIR = ROOT / "data/posts"
ATTACHMENT_RE = re.compile(r"attachment:(\d+)")
WIKI_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")

def text(value):
    return "" if value is None else str(value)

def sql_text(value):
    encoded = text(value).encode("utf-8")
    return "''" if not encoded else "CONVERT(0x" + encoded.hex() + " USING utf8mb4)"

def sql_num(value):
    return "NULL" if value is None else str(int(value))

def sql_time(value):
    if not value:
        return "'2026-10-07 12:00:00.000000'"
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return "'" + parsed.replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S.%f") + "'"

def emit(rows):
    return ",\n".join("(" + ", ".join(row) + ")" for row in rows)

series_by_id = {int(item["id"]): item for item in SNAPSHOT["series"]}
project_slugs = {sid: series.get("slug", "") for sid, series in series_by_id.items()}
project_slugs[16] = "ken-blog"
post_rows = []
home_ids = {}
attachments = {}
wiki_rows = []
badge_by_id = {}
project_badges = []
tag_rows = []

for series in SNAPSHOT["series"]:
    for position, badge in enumerate(series.get("stackBadges", []), 1):
        bid = int(badge["id"])
        existing = badge_by_id.get(bid)
        if existing and existing["name"] != badge["name"]:
            raise SystemExit("badge ID has conflicting public names")
        badge_by_id[bid] = {"id": bid, "name": badge["name"]}
        project_badges.append((int(series["id"]), bid, position))

for item in SNAPSHOT["posts"]:
    slug = item["slug"]
    body_path = BODY_DIR / (slug + ".md")
    if not body_path.is_file():
        raise SystemExit("missing Markdown body for public post")
    body = body_path.read_text(encoding="utf-8")
    if body.startswith("---\n"):
        raise SystemExit("unexpected front matter; refusing to seed body with metadata")
    section = item.get("section")
    project_id = None
    related_project_id = None
    document_order = None
    if section == "PROJECT":
        relation = item.get("series")
        if not isinstance(relation, dict) or relation.get("id") is None:
            raise SystemExit("project post lacks series relation")
        project_id = int(relation["id"])
        position = int(relation.get("position", 1))
        if position == 1:
            section = "PROJECT_HOME"
            home_ids[project_id] = int(item["id"])
        else:
            section = "PROJECT_DOC"
            document_order = position - 1
    elif section == "TECH":
        related = item.get("relatedSeries")
        related_project_id = int(related["id"]) if isinstance(related, dict) and related.get("id") is not None else None
    else:
        raise SystemExit("unsupported public post section: " + str(section))
    if project_id is not None and project_id not in series_by_id:
        raise SystemExit("project post references a series absent from public snapshot")
    published = sql_time((item.get("publishedDate") or "2026-10-07") + "T12:00:00")
    post_rows.append([
        str(int(item["id"])), sql_text(item["title"]), sql_text(slug), sql_text(body),
        published, published, "'PUBLISHED'", "'PUBLIC'", published,
        sql_text(hashlib.sha256(body.encode("utf-8")).hexdigest()),
        "NULL", sql_text(section), sql_num(project_id), sql_num(related_project_id),
        sql_num(document_order), sql_text(item.get("summary") or ""), "NULL", "0", "NULL"
    ])
    for position, tag in enumerate(item.get("tags") or [], 1):
        tag_rows.append((int(item["id"]), position, str(tag)))
    seen = set()
    for position, match in enumerate(WIKI_RE.finditer(body), 1):
        target = match.group(1).strip()
        if target and target not in seen:
            seen.add(target)
            wiki_rows.append((int(item["id"]), len(seen), target))
    for attachment_id in sorted(set(int(value) for value in ATTACHMENT_RE.findall(body))):
        asset = ROOT / "old-assets" / f"attachment-{attachment_id}.png"
        if not asset.is_file():
            raise SystemExit("referenced attachment has no artifact image")
        attachments.setdefault(attachment_id, {"path": asset, "posts": set()})["posts"].add(int(item["id"]))

project_rows = []
for order, series in enumerate(SNAPSHOT["series"], 1):
    sid = int(series["id"])
    if sid not in home_ids:
        raise SystemExit("project has no published HOME post")
    project_rows.append([
        str(sid), sql_text(project_slugs[sid]), sql_text(series["name"]),
        sql_text(series.get("projectStatus") or "DONE"),
        sql_text(series.get("startPeriod") or "2026.01"),
        "NULL" if not series.get("endPeriod") else sql_text(series["endPeriod"]),
        sql_text(series.get("description") or ""), "'PUBLIC'", "NULL",
        sql_time(series.get("updatedAt")), sql_time(series.get("updatedAt")), str(order)
    ])

badge_rows = []
for bid, badge in sorted(badge_by_id.items()):
    name = badge["name"]
    name_key = unicodedata.normalize("NFKC", name).strip().casefold()
    if not (ROOT / "old-assets" / f"stack-{bid}.png").is_file():
        raise SystemExit("referenced badge has no artifact image")
    badge_rows.append([str(bid), sql_text(name), sql_text(name_key), sql_text(f"stack/{bid}.png"),
                       sql_time(None), sql_time(None)])

profile_time = sql_time(None)
statements = [
    "SET NAMES utf8mb4",
    "INSERT INTO users (id, username, password_hash, role, created_at, display_name, enabled) VALUES "
    + "(" + ", ".join(["1", sql_text("perf-user"), sql_text("x" * 60), "'USER'", profile_time, sql_text("Perf"), "TRUE"]) + ")",
    "INSERT INTO home_profile (id, name, tagline, intro, github, email, photo_object_key, updated_at) VALUES "
    + "(" + ", ".join(["1", sql_text("Ken"), sql_text(""), sql_text(""), sql_text(""), sql_text(""), "NULL", profile_time]) + ")",
    "INSERT INTO projects (id, slug, name, status, start_period, end_period, overview, visibility, home_post_id, created_at, updated_at, sort_order) VALUES\n" + emit(project_rows),
    "INSERT INTO posts (id, title, slug, body, created_at, updated_at, status, visibility, published_at, body_sha256, category_id, section, project_id, related_project_id, document_order, summary, pin_order, view_count, tech_series_order) VALUES\n" + emit(post_rows),
]
for sid, home_id in sorted(home_ids.items()):
    statements.append(f"UPDATE projects SET home_post_id = {home_id} WHERE id = {sid}")
if badge_rows:
    statements.append("INSERT INTO stack_badges (id, name, name_key, object_key, created_at, updated_at) VALUES\n" + emit(badge_rows))
if project_badges:
    statements.append("INSERT INTO project_stack_badges (project_id, badge_id, sort_order) VALUES\n" +
                      emit([[str(p), str(b), str(pos)] for p,b,pos in project_badges]))
if tag_rows:
    statements.append("INSERT INTO post_tags (post_id, position, tag_name, display_name) VALUES\n" +
                      emit([[str(pid), str(pos), sql_text(tag), sql_text(tag)] for pid,pos,tag in tag_rows]))
if wiki_rows:
    statements.append("INSERT INTO post_wiki_links (post_id, position, target_title) VALUES\n" +
                      emit([[str(pid), str(pos), sql_text(target)] for pid,pos,target in wiki_rows]))
if attachments:
    attachment_rows=[]
    for aid, info in sorted(attachments.items()):
        attachment_rows.append([str(aid), sql_text(f"local/attachment-{aid}.png"),
            sql_text(f"attachment-{aid}.png"), sql_text("image/png"), str(info["path"].stat().st_size),
            "1", "'READY'", "FALSE", profile_time, profile_time])
    statements.append("INSERT INTO attachments (id, object_key, original_filename, content_type, byte_size, uploaded_by, status, pending_cleanup, created_at, updated_at) VALUES\n" + emit(attachment_rows))
    link_rows=[]
    for aid, info in sorted(attachments.items()):
        for pid in sorted(info["posts"]):
            link_rows.append([str(pid), str(aid)])
    statements.append("INSERT INTO post_attachments (post_id, attachment_id) VALUES\n" + emit(link_rows))
statements.append("COMMIT")
out=ROOT / "setup/seed.sql"
out.write_text("START TRANSACTION;\n" + ";\n".join(statements) + ";\n", encoding="utf-8")
print("seed_sql_generated=true posts="+str(len(post_rows))+" projects="+str(len(project_rows))+
      " badges="+str(len(badge_rows))+" tags="+str(len(tag_rows))+
      " wiki_links="+str(len(wiki_rows))+" attachments="+str(len(attachments)))
