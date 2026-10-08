# 에이전트 작업 지침

## 컨벤션 준수

- 모든 작업을 시작하기 전에 [docs/convention/](docs/convention/)의 문서 목록과 내용을 확인하고, 작업 대상에 적용되는 규칙을 반드시 지킨다. 새로 추가되거나 수정된 컨벤션도 동일하게 적용한다.
- 코드·테스트·설정·문서를 추가하거나 수정할 때 컨벤션을 함께 확인한다. 기존 코드의 관행이 문서와 다르면 문서의 규칙을 기준으로 작업한다.
- 접근 범위·상속·JPA 엔티티와 관련된 코드는 [CODE.md](docs/convention/CODE.md)를 따른다.
- 주석을 추가하거나 수정할 때는 [COMMENTS.md](docs/convention/COMMENTS.md)를 따른다. 문서에서 규칙으로 정한 내용과 현황 조사·개선 후보를 구분한다.
- 변경을 마치기 전에 수정한 부분이 적용 대상 컨벤션을 지키는지 검토한다. 작업 범위 밖의 기존 위반은 임의로 일괄 수정하지 않고 별도로 알린다.
- 명시적인 사용자 요청이나 상위 지침과 충돌하면 해당 지침을 우선하고 충돌 내용을 알린다. 컨벤션을 지킬 수 없는 경우 이유를 숨기거나 임의의 예외를 만들지 않는다.

## 다이어그램 작성·수정

- 게시글·문서의 다이어그램을 그리거나 수정하기 전에 [다이어그램 스킬](.claude/skills/ken-blog-diagrams/SKILL.md)과 그 안의 [Mermaid 공통 작성 가이드](.claude/skills/ken-blog-diagrams/references/mermaid-common.md)를 반드시 읽는다.
- DB 관계도는 [ERD 작성 가이드](.claude/skills/ken-blog-diagrams/references/erd.md), 기술 아이콘을 사용하는 시스템 구성도는 [Mermaid Architecture 작성 가이드](.claude/skills/ken-blog-diagrams/references/architecture.md)를 추가로 반드시 읽는다. 두 종류를 함께 다루면 두 문서 모두 확인한다.
- 기존 그림과 실제 코드·스키마·배포 설정을 먼저 대조한다. 구성 요소·관계·배포 경계를 임의로 생략하거나 바꾸지 않는다. 전체도 요청은 전체 구성을 한 장에 유지하고, 상세도는 필요할 때 추가한다.
- 역할별 색상·범례·설명을 일관되게 작성한다. 고정 Architecture 배치를 수정할 때는 Mermaid 원고와 배치 JSON을 함께 갱신한다.
- 작성 후 해당 가이드의 검증 절차를 따른다. 문법 검사와 실제 화면 확인을 구분하고, 확인하지 않은 렌더링·배포를 완료했다고 보고하지 않는다.
