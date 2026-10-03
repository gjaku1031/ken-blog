# 코드 컨벤션

상태: 적용. 작성일: 2026-10-03.

Kotlin 코드의 접근 범위·상속·JPA 엔티티에 적용하는 기준. 주석의 형식과 간격은 [KDoc.md](KDoc.md), 영속 모델의 설계 근거는 [ADR_persistence.md](../ADR/ADR_persistence.md) 참조.

## 접근 범위

- 선언의 접근 범위는 실제 호출자에게 필요한 수준으로 제한.
- 클래스 내부에서만 사용하는 상태·도우미는 `private`, 모듈 내부 계약은 `internal` 사용.
- 일반 클래스는 Kotlin의 기본 `final` 유지. 상속 계약이나 프레임워크 프록시가 필요한 경우에만 상속 허용.
- `protected`는 하위 클래스에 공개할 필요가 있는 멤버에만 사용. 상속 불가능한 일반 클래스에서 `protected` 사용 금지.
- 외부 조회만 허용하는 일반 클래스의 `var`는 `private set` 사용. JPA 엔티티의 프록시 접근자는 아래 별도 기준 적용.

## JPA 엔티티와 프록시

### 상속 가능 범위

- `@Entity`와 `@MappedSuperclass`는 `build.gradle.kts`의 `allOpen` 설정으로 클래스와 재정의 가능한 멤버의 `final` 해제.
- 기존 `kotlin("plugin.spring")`이 제공하는 all-open 기능에 JPA 어노테이션 추가. Spring 기본 대상만으로 `@Entity`까지 열리는 것으로 가정하지 않음.
- 엔티티마다 `open`을 반복하거나 경고가 보이는 클래스만 개별 수정하지 않음. 앱과 DDL 생성용 `jpaModel` 소스셋에 같은 컴파일 설정 적용.
- 프록시가 호출하는 프로퍼티·메서드에 명시적인 `final` 사용 금지. 클래스만 열고 접근자는 닫아 두는 구성도 금지.
- 프록시 대상이 아닌 복합 키 `@Embeddable`과 DTO·enum은 이 설정에서 제외. 엔티티에 `data class` 사용 금지. 값 비교가 필요한 복합 키에는 `data class` 사용 가능.

클래스·접근자의 상속 가능 여부는 [Kotlin all-open 설정](https://kotlinlang.org/docs/all-open-plugin.html)과 [Hibernate 프록시 요구 조건](https://docs.hibernate.org/orm/7.4/userguide/html_single/#entity-pojo-final)에 근거.

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
class AttachmentEntity protected constructor() {
    /**
     * ID
     */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
        protected set
}
```

위 예시의 클래스와 접근자는 JPA 어노테이션을 대상으로 한 `allOpen` 설정으로 상속 허용. `protected set`은 이 설정과 함께 사용하는 엔티티 규칙.

### 열린 프로퍼티의 값 사용

- 열린 프로퍼티는 재정의될 수 있으므로 읽을 때마다 같은 값이라고 가정하지 않음.
- null 검사 후 같은 값을 계속 사용해야 하면 지역 `val`에 한 번 저장한 뒤 검사·사용. 스마트 캐스트 오류를 피하기 위한 무조건적인 `!!` 추가 금지.
- 생성자·초기화 블록에서 재정의 가능한 업무 메서드를 호출하지 않음. 엔티티 초기화와 조회·수정 흐름 분리.

## 경고 처리와 검증

- 경고의 선언과 사용처를 확인하여 접근 범위·상속·프레임워크 설정 중 원인을 먼저 수정.
- `ProtectedInFinal`을 포함한 경고를 일괄 `@Suppress` 처리하거나 IDE 검사를 끄는 방식으로 해결하지 않음.
- 빌드 설정 변경 후 Gradle 프로젝트를 다시 불러와 IDE의 컴파일 플러그인 정보 갱신. 컴파일 결과가 맞아도 에디터가 플러그인 정보를 반영하지 못하면 도구 상태를 별도로 확인.
- 엔티티 변경 시 앱·`jpaModel` 컴파일 결과에서 클래스와 프록시 접근자의 `final` 여부 확인.
- 접근 제어만 변경한 경우 생성 DDL의 동일성 확인. 테이블·열·FK·인덱스 변경이 섞이지 않도록 검증.
- 프록시를 통한 실제 지연 조회·도메인 메서드 호출·변경 감지·재조회는 격리 DB 통합 검사로 확인. 컴파일 성공만으로 영속 동작을 검증했다고 보고하지 않음.
