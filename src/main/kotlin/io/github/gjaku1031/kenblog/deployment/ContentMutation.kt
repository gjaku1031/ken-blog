package io.github.gjaku1031.kenblog.deployment

/** 콘텐츠를 바꾸는 서비스 진입점의 배포 경계. 메서드 이름을 바꿔도 선언이 함께 유지됨. */
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class ContentMutation(
    val publication: PublicationChange = PublicationChange.NEVER,
    val atomic: Boolean = true,
    val externalIo: Boolean = false,
    val externalIoArgument: Int = -1,
)

/** 공개 산출물 변경을 항상 반영할지, 반환한 원고의 출간 상태로 판단할지 구분. */
enum class PublicationChange { NEVER, ALWAYS, IF_PUBLISHED }
