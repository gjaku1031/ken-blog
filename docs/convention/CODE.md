# 코드 컨벤션

상태: 적용. 작성일: 2026-10-03.

Kotlin 코드의 접근 범위·상속·JPA 엔티티·null 처리·표현식·API 사용에 적용하는 기준. 주석의 형식과 간격은 [KDoc.md](KDoc.md), 영속 모델의 설계 근거는 [ADR_persistence.md](../ADR/ADR_persistence.md) 참조.

## 접근 범위

- 선언의 접근 범위는 실제 호출자에게 필요한 수준으로 제한.
- 클래스 내부에서만 사용하는 상태·도우미는 `private`, 모듈 내부 계약은 `internal` 사용.
- 일반 클래스는 Kotlin의 기본 `final` 유지. 상속 계약이나 프레임워크 프록시가 필요한 경우에만 상속 허용.
- `protected`는 하위 클래스에 공개할 필요가 있는 멤버에만 사용. 상속 불가능한 일반 클래스에서 `protected` 사용 금지.
- 외부 조회만 허용하는 일반 클래스의 `var`는 `private set` 사용. JPA 엔티티의 프록시 접근자는 아래 별도 기준 적용.

## JPA 엔티티와 프록시

### 상속 가능 범위

- `@Entity` 클래스는 `open class`로 선언. `@MappedSuperclass`를 추가할 때도 `open` 또는 `abstract`로 상속 허용.
- 프록시가 호출하는 엔티티의 공개·모듈 내부 프로퍼티와 인스턴스 메서드에도 `open` 명시. `protected set`만으로 프로퍼티의 재정의가 허용되는 것으로 가정하지 않음.
- JPA 타입을 여는 별도 `allOpen` 설정은 사용하지 않음. 소스 선언만으로 상속 계약을 확인하고, 앱과 DDL 생성용 `jpaModel`에서 같은 원본 사용.
- `kotlin("plugin.spring")`은 Spring 컴포넌트·AOP 용도로 유지. Spring 기본 대상만으로 `@Entity`까지 열리는 것으로 가정하지 않음.
- 프록시가 호출하는 프로퍼티·메서드에 명시적인 `final` 사용 금지. 클래스만 열고 접근자는 닫아 두는 구성도 금지.
- 프록시 대상이 아닌 복합 키 `@Embeddable`과 DTO·enum은 기본 `final` 유지. 엔티티에 `data class` 사용 금지. 값 비교가 필요한 복합 키에는 `data class` 사용 가능.

클래스·접근자의 상속 가능 여부는 [Kotlin 상속 규칙](https://kotlinlang.org/docs/inheritance.html)과 [Hibernate 프록시 요구 조건](https://docs.hibernate.org/orm/7.4/userguide/html_single/#entity-pojo-final)에 근거.

### 생성자와 상태 변경

- JPA 인스턴스 생성용 인자 없는 생성자는 `protected constructor()` 유지. 생성자 가시성을 경고 제거 목적으로 `private`로 변경하지 않음.
- 업무용 생성자와 팩터리는 호출 범위에 맞게 별도 제공. 빈 생성자로 만든 불완전한 인스턴스를 일반 호출자에게 노출하지 않음.
- 외부 조회가 필요한 엔티티 프로퍼티는 getter를 공개하고 setter는 `protected set` 사용. 직접 대입을 허용하는 `public set`으로 완화하지 않음.
- 상태 변경은 검증·수정 시각 등의 계약을 가진 도메인 메서드로 수행. 쓰기 권한을 숨기기 위해 엔티티 전체 프로퍼티를 `private`로 바꾸지 않음.
- JPA 매핑만을 위한 내부 연관관계와 호환 필드는 `private` 유지 가능. 기존 필드 접근 방식을 보존하며 매핑 어노테이션을 getter로 임의 이동하지 않음.
- 이미 인자 없는 생성자를 명시한 클래스에 no-arg 플러그인을 중복 도입하지 않음. 생성자 생성과 클래스 상속 허용은 서로 다른 설정으로 구분.

```kotlin
/**
 * 첨부 파일의 식별 정보
 */
@Entity
@Table(name = "attachments")
open class AttachmentEntity protected constructor() {
    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    open var id: Long? = null
        protected set
}
```

위 예시는 클래스와 접근자의 상속을 소스에서 명시적으로 허용. `protected set`은 외부 직접 대입을 막으면서 프록시의 재정의는 허용하는 엔티티 규칙.

### 열린 프로퍼티의 값 사용

- 열린 프로퍼티는 재정의될 수 있으므로 읽을 때마다 같은 값이라고 가정하지 않음.
- null 검사 후 같은 값을 계속 사용해야 하면 지역 `val`에 한 번 저장한 뒤 검사·사용. 스마트 캐스트 오류를 피하기 위한 무조건적인 `!!` 추가 금지.
- 생성자·초기화 블록에서 재정의 가능한 업무 메서드를 호출하지 않음. 엔티티 초기화와 조회·수정 흐름 분리.

## null 처리와 JDBC 조회

- 타입·앞선 조건으로 non-null이 보장된 값에 불필요한 `?:`, `?.`, `!= null`을 추가하지 않음. `USELESS_ELVIS`, `SENSELESS_COMPARISON`은 실제 타입과 분기 흐름을 확인한 뒤 정리.
- nullable 값의 정상적인 조기 반환은 유지. 경고 제거를 위해 반환 타입을 임의로 nullable로 바꾸거나 `!!`로 강제하지 않음.
- `queryForObject`는 정확히 한 행을 요구. 조회 결과가 0행이면 `null` 대신 `EmptyResultDataAccessException` 발생. `RowMapper`의 nullable 반환과 행 누락을 구분.
- 0행을 정상적인 부재로 처리해야 하면 해당 호출에서 `EmptyResultDataAccessException`만 처리하거나 행 개수를 명시적으로 다루는 조회 사용. `?: return`으로 0행을 처리한다고 가정하지 않음.
- 반드시 존재해야 하는 상태 행의 누락은 시스템 오류로 전파. DB 연결 장애·잘못된 SQL·중복 행까지 `Exception`으로 묶어 `false`나 빈 값으로 숨기지 않음.
- 인증 상태 누락의 세션 거부·로그인 중단 계약은 [애플리케이션 ADR](../ADR/ADR_application.md#인증-상태-행-누락-처리--2026-10-03) 참조.

## 람다와 지역 변수

- 함수 호출의 마지막 인자가 유일한 람다이면 괄호 밖에 작성. 오버로드 선택·문법상 제약이 있는 호출은 의미 보존 우선.
- 콜백을 여러 개 전달하면 역할을 함께 읽을 수 있도록 괄호 안에 유지 가능. `groupBy({ it.postId }, { it.name })` 같은 호출을 기계적으로 분리하지 않음.
- 변수의 유일한 용도가 `when`의 대상과 해당 분기이면 `when (val result = expression)`으로 선언 범위 제한. 분기 전후에도 필요한 변수는 바깥에 유지.

## 문자열과 라이브러리 API

- 짧은 Spring 설정 문자열은 `@Value("\${app.auth.admin.username:}")` 형태의 기존 이스케이프 유지 가능. multi-dollar 문자열 전환 제안 자체는 오류나 필수 수정 사유가 아님.
- `$`가 반복되는 긴 텍스트에서 읽기 쉬워질 때만 multi-dollar 문자열 고려. 지원 Kotlin 버전과 실제 문자열 값이 같은지 확인.
- 사용 중인 라이브러리의 deprecated API는 공식 대체 API와 동작을 확인한 뒤 교체. 경고를 없애기 위해 의존성을 임의로 올리거나 검증 강도를 낮추지 않음.
- Jackson 3 문자열 노드는 `isString`, `stringValue()`, 명시적으로 변환이 필요한 곳은 `asString()` 사용. 이전 `isTextual`, `textValue()`, `asText()` 별칭은 새 코드에서 사용하지 않음.
- JSON 입력 검증은 문자열 타입 확인 후 값을 읽는 계약 유지. `stringValue()`를 강제 문자열 변환인 `asString()`으로 바꾸어 숫자·불리언을 허용하지 않음.

## 경고 처리와 검증

- VS Code의 노란 밑줄을 모두 같은 종류로 취급하지 않음. 컴파일 진단, 동작 결함 가능성, 스타일 제안을 진단 코드와 실제 사용처로 구분.
- 도달 불가능한 분기·효과 없는 방어 코드·폐기 예정 API는 원인을 확인해 정리. 람다·변수 범위는 위 작성 기준 적용, multi-dollar 문자열은 선택 사항.
- 경고의 선언과 사용처를 확인하여 접근 범위·상속·프레임워크 설정 중 원인을 먼저 수정. IDE 제안을 그대로 적용하기 전에 프레임워크 계약과 동작 보존 확인.
- `ProtectedInFinal`을 포함한 경고를 일괄 `@Suppress` 처리하거나 IDE 검사를 끄는 방식으로 해결하지 않음.
- 빌드 설정 변경 후 Gradle 프로젝트를 다시 불러와 IDE 정보 갱신. 컴파일 경고 0건과 에디터 진단 0건은 구분하여 보고. 에디터 검사를 실행하지 않았다면 실행한 것으로 보고하지 않음.
- 엔티티 변경 시 앱·`jpaModel` 컴파일 결과에서 클래스와 프록시 접근자의 `final` 여부 확인.
- 접근 제어만 변경한 경우 생성 DDL의 동일성 확인. 테이블·열·FK·인덱스 변경이 섞이지 않도록 검증.
- 프록시를 통한 실제 지연 조회·도메인 메서드 호출·변경 감지·재조회는 격리 DB 통합 검사로 확인. 컴파일 성공만으로 영속 동작을 검증했다고 보고하지 않음.
