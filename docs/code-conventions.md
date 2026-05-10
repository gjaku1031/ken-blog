# 코드와 문서 작성 기준

## 백엔드

Kotlin 사용. Java 소스 추가 없음. 생성자 주입과 `val` 우선. Service는 구체 클래스, JPA Repository는 Spring Data JPA의 `JpaRepository`를 확장하는 인터페이스로 선언. Swagger용 Controller 계약도 인터페이스로 선언. 기본 CRUD는 상속받고 필요한 조건 조회만 파생 쿼리 등으로 선언하며 기본 메서드를 중복 선언하거나 불필요한 공통 Repository 계층을 만들지 않음.

오류 응답은 `ProblemDetail` 기반으로 구성. `ApiErrorHandler`의 Spring 기본 예외 처리 흐름과 HTTP 상태·헤더 보존. 예상하지 못한 예외의 내부 메시지를 응답에 포함하지 않음. 도메인 입력 검증에 일반 `IllegalArgumentException` 사용 금지. 아직 없는 계층이나 기능을 완료된 것으로 설명하지 않음.

## 프론트

Next.js App Router와 TypeScript 사용. 필요한 화면만 클라이언트 컴포넌트로 구성. 인증·권한·데이터 접근은 향후 Spring API에서 처리. 서버용 비밀값을 브라우저 번들에 포함하지 않음.

## 주석

새로 만들거나 수정하는 클래스·함수에 한국어 KDoc 또는 JSDoc/TSDoc 작성. 역할을 먼저 설명하고 실제 흐름·반환 의미·예외·필요한 인자를 보충. `Unit` 반환 같은 불필요한 태그와 타입 반복 제외. 실제 선언을 가리키는 심볼 링크 사용, IDE 직접 확인 여부는 검증 기록에 구분.

## 변경 기록

영어 `type: summary` 또는 `type(scope): summary` 사용. 구현·검증·설명을 한 목적의 단위로 묶고 관련 없는 정리는 분리. 한국어 설명은 문제·변경 결과·실제 검증 순서로 작성, 문서의 종결은 `없음`, `반환`, `확인` 등 명사형 사용.

## 참고

- [Kotlin KDoc](https://kotlinlang.org/docs/kotlin-doc.html)
- [TSDoc](https://tsdoc.org/)
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [Google 변경 설명 지침](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)
