package io.github.gjaku1031.kenblog.series.domain

import io.github.gjaku1031.kenblog.global.error.BusinessException
import org.springframework.http.HttpStatus

/**
 * 시리즈 입력의 타입·필수값·기간이 잘못된 경우
 */
class InvalidSeriesRequestException : BusinessException(HttpStatus.BAD_REQUEST, "콘텐츠 입력을 확인하세요.")

/**
 * 시리즈가 없는 경우
 */
class SeriesNotFoundException : BusinessException(HttpStatus.NOT_FOUND, "콘텐츠를 찾을 수 없습니다.")

/**
 * 주소 중복·수정 시각 경합 충돌
 */
class SeriesConflictException : BusinessException(HttpStatus.CONFLICT, "콘텐츠 변경이 충돌했습니다.")
