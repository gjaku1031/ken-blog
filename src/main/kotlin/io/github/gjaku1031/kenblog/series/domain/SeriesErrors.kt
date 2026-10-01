package io.github.gjaku1031.kenblog.series.domain

/** 시리즈 입력의 타입·필수값·기간이 잘못된 경우. */
class InvalidSeriesRequestException : RuntimeException()
/** 시리즈가 없는 경우. */
class SeriesNotFoundException : RuntimeException()
/** 주소 중복·수정 시각 경합·비어 있지 않은 시리즈 삭제 충돌. */
class SeriesConflictException : RuntimeException()
