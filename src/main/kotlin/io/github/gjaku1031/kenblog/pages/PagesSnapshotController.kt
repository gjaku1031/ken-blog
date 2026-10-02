package io.github.gjaku1031.kenblog.pages

import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

/**
 * 공개 메타만 GitHub Actions에 제공하는 단일 읽기 경로
 */
@RestController
class PagesSnapshotController(
    /**
     * 공개 스냅샷 서비스
     */
    private val snapshots: PagesSnapshotService
) {
    /**
     * 공개 메타데이터 스냅샷 조회
     */
    @GetMapping("/api/v1/pages/snapshot")
    fun snapshot(): ResponseEntity<Map<String, Any?>> = ResponseEntity.ok()
        .cacheControl(CacheControl.noStore()).body(snapshots.snapshot())
}
