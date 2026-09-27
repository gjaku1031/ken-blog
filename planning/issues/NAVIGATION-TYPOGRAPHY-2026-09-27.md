# 탐색 UI와 제목 크기 QA 보정

## 문제와 확정 범위

- Home 분류 펼침 문자 11px·클릭 영역 20×26px로 조작과 상태 식별 어려움. Home/Tech/검색 공통 트리 개선 범위.
- Notes/Projects 목차에 문서 메뉴의 `padding: 8px 0`·고정 높이·말줄임과 둥근 테두리 적용. 왼쪽 표시선에 글자가 붙는 CSS 우선순위 충돌 확인.
- Tech 글 제목 40px·본문 제목 30/24/19px 실측. Velog 공개 소스의 제목 3rem·본문 제목 2.5/2/1.5rem 확인 후 사용자가 블로그에 32/28/24/20px 적용 확정. 외부 서비스와 동일한 크기라는 의미 아님.
- 사용자 QA 자료 유지, DB/백엔드/외부 비밀 설정 변경 없음. 신규 테스트 코드와 사용자용 설명 문서 추가 없음.

## 변경과 수용 기준

- 16px SVG 펼침 화살표·32×32px 버튼·키보드 focus 표시, leaf 텍스트와 중첩 안내선 정렬. 긴 이름/좁은 패널 가로 넘침 방지.
- 프로젝트/과목 문서 메뉴 CSS를 직접 하위의 목차 아닌 nav로 제한. 목차 직선 표시선·12px 여백·3수준 24px·자동 높이·긴 제목 줄바꿈 복원.
- 공통 CSS 변수로 읽기 제목·본문과 글쓰기 제목·선택 줄·미리보기 크기 일치. 데스크톱 32/28/24/20px, 860px 이하 28/26/22/19px, 420px 이하 25/23/21/18px. 글 제목 스타일이 본문 h1까지 덮던 선택자 범위 제한.
- 관련 페이지의 분류 마우스/키보드 조작·목차 이동/포커스·폰트 계산값 및 작은 화면 확인. 타입검사·기존 웹 검사·정적 빌드 후 main/Pages 반영.

## 실제 검증

- 수정 전 운영 브라우저: 분류 버튼 20×26px/문자11px, Notes 목차 좌측 padding0px/border-radius8px/높이36px/nowrap 확인.
- 로컬 브라우저: Home/Tech/검색 분류 32px 버튼/16px SVG·클릭 펼침·Space/Enter 접기·주소 유지 확인. Notes/프로젝트 문서/Tech 글 목차 12px·직선 표시선·정확한 제목 이동/포커스 확인.
- 390px dark 분류와 light 목차 가로 넘침 없음 확인. 긴 목차 문자열은 브라우저 DOM에서만 교체해 줄바꿈 확인, DB 저장 없음.
- 읽기 제목/H1/H2/H3를 1440·768·390px에서 실측하여 32/28/24/20, 28/26/22/19, 25/23/21/18 확인. 샘플에 없는 H3는 브라우저 DOM 추가 후 CSS 확인, DB 저장 없음.
- 신규 미저장 글에서 실제 `#`/`##`/`###` 입력 후 세 화면 폭의 제목·선택 textarea·미리보기 크기 일치, Markdown 기호 유지, 가로 넘침·브라우저 오류 없음 확인. 관리자 검증 세션 만료 후 정상 로그인 갱신, 계정 데이터 변경 없음.
- 웹 타입검사·기존 7개 검사·20경로 정적 빌드 성공. 별도 수동 도구·JSON·PNG는 저장소 밖 `/tmp/ken-blog-navigation-fix` 보관. 실제 push/CI/Pages 결과는 최종 인계에 별도 기록.

## 비교 근거

- [Velog 글 제목 공개 코드](https://github.com/velopert/velog-client/blob/master/src/components/post/PostHead.tsx)
- [Velog 본문 제목 공개 코드](https://github.com/velopert/velog-client/blob/master/src/components/common/Typography.tsx)
- [Notion 공식 제목 안내](https://www.notion.com/help/columns-headings-and-dividers): 3단계 제목 사용 방법 확인, 정확한 픽셀 크기는 이 문서에 명시 없음. 조회한 공개 샘플 페이지는 접근 불가로 실측 근거에 사용하지 않음.
