# 기술 스택 목록 확장·검색 전환 보정

## 요청·수용 기준

- 기술 스택 관리자 탭·페이지 제거, AI 운영 경로와 프로젝트 기술 선택 보존.
- Kubernetes·Next.js·NestJS·JavaScript·htmx·Kotlin 포함 자주 쓰는 기술의 원본 로고 다수 등록. 사용자 확인으로 ASP.NET Core·Classic ASP 모두 추가. JPA 제외·기존 14개 뱃지와 프로젝트 연결 보존.
- 글 관리 삭제 시작·확인 버튼에 빨간색 적용, 취소 기본색 유지.
- 검색 아이콘 클릭 시 가로로 펼쳐지는 전환 강화. 고정 오른쪽 경계와 실제 중간 프레임·초점·Escape·모바일·동작 줄이기 검증.
- 현재 코드 구문 강조 지원 12종과 별칭 사용자 안내. 언어 지원 확장 요청 없음.

## 검증 계획

- 웹 타입 검사·기존 검사·정적 빌드, 삭제 버튼 색상·탭/경로 제거·검색 동작 및 프로젝트 기술 검색/선택 브라우저 검증.
- 로고 출처·파일 무결성 확인 후 기존 ADMIN API로 등록, 읽기 목록·이미지·기존 ID와 연결 보존 확인. 신규 뱃지는 QA 삭제 대상에 포함하지 않는 영구 자료.
- 비밀값 노출·운영 복구 코드 소비·사용자 원고 저장 없음. main 묶음 반영 뒤 동일 SHA Pages·CI 및 실제 화면 확인.

## 로컬 구현·검증

- 관리 탭·정적 경로·전용 화면/CSS 제거, 로그인 허용 이동 경로 및 기존 CI 404 검사 갱신. 프로젝트 기술 선택과 관리자 API 유지.
- 검색 아이콘과 입력을 한 컨테이너로 통합, 40→320px·350ms 전환과 첫 프레임 이후 입력 초점 적용. 1712/1234/900/390px에서 실제 다수 중간 프레임·컨테이너 오른쪽 경계·Escape 초점 복귀·검색어 이동·가로 넘침 없음 확인. 동작 줄이기 설정 확인.
- 웹 타입 검사·기존 7개·정적 17경로 빌드 통과. 삭제 시작/확인 버튼 라이트·다크 색상, 관리 메뉴 제거와 `/admin/stacks/` HTTP404 확인. 런타임 오류 없음.
- 신규 52개·기존 14개 총 66개 로고 준비와 시각 대조 완료. Devicon 고정 커밋·Microsoft 공식 자산 사용. Classic ASP는 독립 제품 로고가 아닌 Microsoft Visual Studio의 공식 ASP 플랫폼 아이콘 사용, 출처 기록에 구별.
- 출처: [Devicon](https://github.com/devicons/devicon/tree/7330accdbc47e2dc0c19789a48533c4a3c50fe58), [.NET 브랜드](https://github.com/dotnet/brand), [Microsoft ASP 아이콘](https://learn.microsoft.com/en-us/visualstudio/extensibility/ux-guidelines/images-and-icons-for-visual-studio).

## 운영 목록 적용·검증

- 기존 관리자 API로 신규 52개 등록 완료, 전체 66개 이름·ID 유일성 확인. 기존 14개 이름·ID·이미지 해시와 6개 프로젝트 연결 불변 확인. JPA 제외 유지.
- 신규 이미지 전체 64×64 PNG 형식과 원본 대비 픽셀 비교 통과. Kubernetes·Next.js·NestJS·JavaScript·htmx·Kotlin·ASP.NET Core·Classic ASP의 프로젝트 선택기 검색·선택·제거, 실제 로고 표시와 흰 배경 타일 확인. 프로젝트 저장 없음.
- 원본·PNG·출처·라이선스·등록 완료 기록의 저장소 밖 보관. 신규 뱃지는 QA 정리 목록에 추가하지 않는 재사용 자료.
- 브라우저 검증 도구의 한국어 CSS 선택자 이스케이프 오류 수정 후 최종 통과. 제품 동작 오류와 구분.
- 웹 소스 main 반영 및 동일 SHA CI·Pages 배포 확인 대상. API 소스·운영 이미지 변경 없음.
