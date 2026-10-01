package io.github.gjaku1031.kenblog.project.domain

/** 프로젝트 입력 형식과 속성 조합이 유효하지 않을 때 HTTP 400. */
class InvalidProjectRequestException : RuntimeException("프로젝트 요청이 올바르지 않습니다.")

/** 프로젝트를 찾을 수 없거나 현재 읽기 권한이 없을 때 HTTP 404. */
class ProjectNotFoundException : RuntimeException("프로젝트를 찾을 수 없습니다.")

/** 프로젝트와 소속 글의 메타데이터 변경이 충돌했을 때 HTTP 409. */
class ProjectConflictException : RuntimeException("프로젝트 상태가 변경되었습니다. 다시 확인해 주세요.")
