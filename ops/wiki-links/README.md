# 위키 링크 연결 재색인

기존 게시글에 저장된 제목 연결이 없는 경우, 현재 본문을 웹의 공유 Markdown 파서로 읽어 관리자 연결 목록을 보정하는 일회성 도구. P2-06C API가 준비된 격리 환경에서 사용. 실제 운영 DB에는 이 단계에서 실행하지 않음.

Node.js 24와 `apps/web`의 설치된 npm 의존성 필요. 저장소 루트에서 실행:

```bash
cd apps/web
npm ci
cd ../..
export WIKI_REINDEX_API_BASE_URL=http://127.0.0.1:18081
export WIKI_REINDEX_USERNAME='admin_example'
read -r -s -p '관리자 비밀번호: ' WIKI_REINDEX_PASSWORD
export WIKI_REINDEX_PASSWORD
printf '\n'
node ops/wiki-links/reindex.mjs --max-posts=500
node ops/wiki-links/reindex.mjs --apply --max-posts=500
unset WIKI_REINDEX_PASSWORD
```

첫 명령은 기본 dry-run으로 로그인·로그아웃 세션을 사용하지만 게시글 연결을 수정하지 않고, 변경 예정 글의 ID와 연결 개수만 표시. `--apply`를 명시한 두 번째 명령에서만 관리자 보정 PUT을 전송. 적용 전 dry-run 결과와 대상 DB를 확인. 예시 주소·계정은 실제 비밀값이 아님. 비밀번호를 인자로 전달하거나 기록 파일에 넣지 않음.

`--max-posts=N`의 기본값은 500, 최대 5000. 관리자 목록 전체 건수가 이 값을 넘으면 어떤 글도 쓰기 전에 중단. `--timeout-ms=N`은 요청별 1000~60000밀리초이며 기본 35000. HTTPS 외부 origin 또는 로컬 `127.0.0.1`·`localhost`·`[::1]`의 HTTP만 허용하고 리다이렉트는 오류. 도구는 `KENBLOGSESSION` 쿠키를 프로세스 메모리에만 보관하고 로그인 전·후 CSRF를 새로 받아 사용하며 끝날 때 로그아웃을 시도.

도구는 본문·제목·비밀번호·세션·CSRF를 출력하지 않음. 관리자 목록은 본문 없이 조회하고 상세에서 원문을 읽어 웹의 [`parseAnnotationDocument`](../../apps/web/lib/markdown-details.ts)와 [`collectWikiTitles`](../../apps/web/lib/wiki-link-syntax.ts)를 직접 사용. UTF-8 본문 SHA-256을 `expectedBodySha256`으로 전송하며, 서버가 현재 본문과 다르다고 판단해 `409`를 반환하면 해당 글을 건너뛰고 ID만 기록. 본문을 다시 읽어 dry-run 후 재실행. 적용은 본문·`updatedAt`을 변경하지 않고 연결만 전체 교체하는 API 계약. 읽는 동안 게시글 목록이 바뀌거나 응답 계약이 맞지 않으면 중단.

오래된 클라이언트가 본문을 변경하면서 `wikiTargets`를 생략하면 기존 연결이 지워질 수 있음. 같은 본문에서 생략하면 기존 연결은 유지. 새 글의 생략/null은 빈 연결로 간주. 정적 관리자 편집기는 매 저장에 현재 원문에서 추출한 전체 목록을 명시적으로 전송. 배치 실행 절차와 권한 경계는 [위키 링크 안내](../../docs/wiki-links.md) 참고.

2026-09-26 격리 MySQL·API에서 기존 글 22건의 dry-run 결과 동일 8건·변경 예정 14건을 확인하고 `--apply`로 14건을 보정. 재실행은 동일 22건·변경 예정 0건으로 끝났으며 원문·수정 시각은 그대로. 별도 SHA 충돌 `409`와 잘못된 선언 `400`은 연결과 원문을 바꾸지 않았음. 실제 운영 DB에는 이 도구를 실행하지 않았고, 공개 API HTTPS 연결도 없음.
