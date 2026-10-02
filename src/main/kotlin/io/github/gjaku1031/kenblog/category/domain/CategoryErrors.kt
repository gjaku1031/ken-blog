package io.github.gjaku1031.kenblog.category.domain

import io.github.gjaku1031.kenblog.global.error.BusinessException
import org.springframework.http.HttpStatus

/**
 * 경로·깊이·단계 이름 또는 식별자 입력이 분류 계약을 벗어날 때
 */
class InvalidCategoryRequestException : BusinessException(HttpStatus.BAD_REQUEST, "분류 입력을 확인하세요.")

/**
 * 요청한 분류 ID가 DB에 없을 때
 */
class CategoryNotFoundException : BusinessException(HttpStatus.NOT_FOUND, "분류를 찾을 수 없습니다.")

/**
 * 고유 경로 또는 동시 FK·행잠금 충돌로 분류 변경을 커밋할 수 없을 때
 */
class CategoryConflictException : BusinessException(HttpStatus.CONFLICT, "분류 변경이 충돌했습니다.")
