package io.github.gjaku1031.kenblog.note.domain

/** 과목 입력·회차 순서 형식 오류의 HTTP 400 원인. */
class InvalidCourseRequestException : RuntimeException("과목 입력이 올바르지 않습니다.")

/** 과목 또는 현재 읽기 가능한 회차가 없는 HTTP 404 원인. */
class CourseNotFoundException : RuntimeException("과목을 찾을 수 없습니다.")

/** 삭제된 부모·중복 주소·회차 순서 경합의 HTTP 409 원인. */
class CourseConflictException : RuntimeException("과목 상태가 변경되었습니다.")
