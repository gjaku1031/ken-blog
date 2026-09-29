package io.github.gjaku1031.kenblog.draft.domain

/** 편집본 필수 JSON 타입·길이·식별자 계약의 위반. */
class InvalidEditorDraftRequestException : RuntimeException()

/** 요청한 양수 ID의 편집본이 없는 경우. */
class EditorDraftNotFoundException : RuntimeException()

/** revision·원본 시각·원본당 단일 편집본 또는 동시 DB 잠금 충돌. */
class EditorDraftConflictException : RuntimeException()
