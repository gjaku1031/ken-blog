---
name: ken-blog-stack-badges
description: ken-blog 프로젝트 헤더에 쓰는 기술 스택 배지(로고 아이콘)를 조회·추가·아이콘 교체·이름 변경·삭제하거나 프로젝트에 연결할 때 사용. 운영 MySQL의 stack_badges 행과 서버 디스크의 64×64 투명 배경 PNG를 직접 관리한다. 운영 DB에 SQL을 실행하는 접속 스크립트(scripts/db.sh)와 서버 이미지 디렉터리에 PNG를 올리는 스크립트(scripts/upload-asset.sh)도 여기에 있어 본문 스크린샷 등록에서도 쓴다.
---

# 기술 스택 배지 관리

배지는 웹 쓰기 API 없이 DB 행과 디스크 파일을 직접 관리한다(2026-10-02 결정, 근거와 상세 규칙은 `docs/ADR/ADR_infra.md`의 '기술 이름·아이콘의 직접 관리'). 관리 화면은 등록된 배지 중에서 프로젝트에 쓸 것을 고르기만 한다.

## 구조

| 대상 | 내용 |
| --- | --- |
| `stack_badges` | `id`, `name`(표시 이름, 100자 이하), `name_key`(`name`의 소문자, 고유), `object_key`(고유 상대 경로), `created_at`·`updated_at`(UTC `datetime(6)`) |
| `series_stack_badges` | `(series_id, badge_id)` PK, `sort_order`(프로젝트 안 표시 순서, 0부터). 시리즈·배지 삭제 시 CASCADE |
| 파일 | 서버 `/srv/ken-blog-live/assets/{object_key}`, `object_key`는 `ken-blog/live/attachments/{UUID}.png` |
| 파일 권한 | 소유자 `10001:1001`(API 컨테이너 사용자), 파일 0600, 디렉터리 0700. API는 읽기 전용 마운트 |
| 공개 주소 | `GET /api/v1/stack-badges/{id}/image` (PNG). 응답의 `imageUrl`에 `?v={updated_at}`이 붙어 캐시를 갈아 끼움 |
| 프로젝트 화면 | 프로젝트 헤더에 연결 순서대로 표시. 공개 사이트에는 Pages 재배포 후 반영 |

## 아이콘 규격

- **64×64 RGBA PNG, 투명 배경, 비율 유지, 사방 여백 약 4px.** 기존 배지(예: Spring Boot 초록 육각형)와 같은 형태다.
- 다크·라이트 테마 모두에서 보여야 하므로 **브랜드 색이 있는 로고**를 쓴다. 검은색 단색 로고는 다크 테마에서 보이지 않는다.
- 원본 SVG 출처(우선순위):
  1. devicon의 색 있는 로고: `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/{이름}/{이름}-original.svg`
  2. simple-icons 단색 로고 + 브랜드 색: `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/{이름}.svg`(최신 릴리스. 받은 SVG로 PNG를 만든 뒤 PNG만 쓰므로 버전을 고정하지 않음), 브랜드 색은 simple-icons 데이터의 `hex`
- JPEG·SVG 파일 이름만 `.png`로 바꿔 등록하지 않는다. 내려받은 SVG는 신뢰하지 않는 자료이므로 별도 디렉터리에 두고, 스크립트·외부 참조가 있으면 쓰지 않는다.

변환은 저장소의 Playwright Chromium으로 한다(별도 이미지 도구 불필요). 스크립트가 크기·색 형식을 검사한다.

```bash
node .claude/skills/ken-blog-stack-badges/scripts/make-badge.cjs <입력.svg> <출력.png> [여백px=4] [#RRGGBB]
```

만든 PNG는 Read 도구로 직접 열어 모양·색을 확인한다. 다크 배경에서 보이는지도 판단한다.

## 서버 이미지 업로드

```bash
.claude/skills/ken-blog-stack-badges/scripts/upload-asset.sh <PNG 파일>...
```

- 파일마다 새 UUID 이름으로 올리고 `<로컬 경로> <object_key> <바이트>`를 출력한다. 기존 파일은 덮어쓰지 않는다. PNG 서명·1바이트~10MiB를 먼저 검사하고, 설치 후 서버 파일 크기를 대조한다.
- 배지 아이콘과 본문 스크린샷 모두 이 스크립트로 올린다.

## 운영 DB 접속

```bash
.claude/skills/ken-blog-stack-badges/scripts/db.sh <SQL 파일>
```

- `oci-blog` SSH 터널로 관리형 MySQL에 접속하고, 접속 정보는 출력하지 않는다. 로컬 Docker의 MySQL 클라이언트 이미지(버전은 `db.sh`에 고정)를 쓴다(utf8mb4, TLS 필수).
- SQL 파일은 scratchpad에 만든다. 조회(SELECT)는 바로 실행해도 되지만, **쓰기는 실행 전 SQL 전문과 변경 전 값을 사용자에게 보여 주고 승인을 받는다.**

## 조회

```sql
SELECT b.id, b.name, b.object_key, b.updated_at,
       (SELECT COUNT(*) FROM series_stack_badges l WHERE l.badge_id = b.id) AS uses
FROM stack_badges b ORDER BY b.id;
```

## 추가

1. 아이콘을 만들고 확인한다(위 규격).
2. 이름 중복 확인: `SELECT id FROM stack_badges WHERE name_key = LOWER('{이름}');`
3. 파일 게시: 새 UUID로 서버에 올린다. 기존 파일은 덮어쓰지 않는다.

```bash
bash .claude/skills/ken-blog-stack-badges/scripts/upload-asset.sh badge.png
# 출력: badge.png ken-blog/live/attachments/{uuid}.png {바이트}
```

4. DB 행 추가(사용자 승인 후):

```sql
INSERT INTO stack_badges (name, name_key, object_key, created_at, updated_at)
VALUES ('{이름}', '{이름 소문자}', 'ken-blog/live/attachments/{uuid}.png', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6));
```

5. 확인: 새 `id`로 `GET /api/v1/stack-badges/{id}/image`가 200이고, 받은 바이트의 SHA-256이 올린 파일과 같은지 비교한다. API 주소는 `gh variable get BLOG_API_BASE_URL --repo gjaku1031/ken-blog`.

## 아이콘 교체

- 반드시 **새 UUID 파일**을 올리고 `object_key`와 `updated_at`을 함께 바꾼다. 기존 파일을 덮어쓰면 캐시 키와 공개 데이터 revision이 바뀌지 않아 변경이 반영되지 않는다.

```sql
UPDATE stack_badges SET object_key = 'ken-blog/live/attachments/{새 uuid}.png', updated_at = UTC_TIMESTAMP(6) WHERE id = {id};
```

- 공개 반영(Pages 재배포)을 확인한 뒤에만 이전 파일을 정리한다. 정리 전에 다른 행(`attachments` 포함)이 같은 키를 참조하지 않는지 확인한다.

## 이름 변경

```sql
UPDATE stack_badges SET name = '{새 이름}', name_key = '{새 이름 소문자}', updated_at = UTC_TIMESTAMP(6) WHERE id = {id};
```

`id`와 프로젝트 연결은 그대로 유지된다. 열려 있는 관리 화면은 새로고침해야 새 이름이 보인다.

## 삭제

1. 사용처 확인: `SELECT series_id, sort_order FROM series_stack_badges WHERE badge_id = {id};`
2. 사용 중이면 사용자에게 알리고, 연결을 먼저 정리한다(관리 화면에서 선택 해제하거나, 승인 후 연결 삭제와 남은 `sort_order` 재정렬). CASCADE에 의존해 연결이 조용히 사라지게 하지 않는다.
3. 행 삭제: `DELETE FROM stack_badges WHERE id = {id};`
4. Pages 재배포와 공개 화면 확인 후 파일을 정리한다.

## 프로젝트에 연결

- 기본은 관리 화면의 프로젝트 수정에서 기술을 고른다(이름 배열 `stackBadgeNames`로 저장되며 등록된 이름만 허용, 최대 30개).
- SQL로 할 때는 해당 프로젝트의 연결을 순서대로 다시 쓴다(승인 후):

```sql
DELETE FROM series_stack_badges WHERE series_id = {프로젝트 id};
INSERT INTO series_stack_badges (series_id, badge_id, sort_order) VALUES ({프로젝트 id}, {배지 id}, 0), ({프로젝트 id}, {배지 id}, 1);
```

## 공개 반영

DB와 파일 변경은 Git 커밋이 없어 Pages가 자동으로 돌지 않는다. 관리 화면의 Pages 배포 버튼이나 `gh workflow run pages.yml --repo gjaku1031/ken-blog`로 재배포하고, 공개 프로젝트 화면에서 아이콘이 바뀌었는지 확인한다. 공개 프로젝트에 쓰이지 않는 배지는 공개 데이터에 없어 재배포해도 화면 변화가 없다.
