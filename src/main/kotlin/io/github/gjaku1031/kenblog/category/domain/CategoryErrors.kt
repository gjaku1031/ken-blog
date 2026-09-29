package io.github.gjaku1031.kenblog.category.domain

/** 경로·깊이·단계 이름 또는 식별자 입력이 분류 계약을 벗어날 때. */
class InvalidCategoryRequestException : RuntimeException()

/** 요청한 분류 ID가 DB에 없을 때. */
class CategoryNotFoundException : RuntimeException()

/** 고유 경로 또는 동시 FK·행잠금 충돌로 분류 변경을 커밋할 수 없을 때. */
class CategoryConflictException : RuntimeException()
