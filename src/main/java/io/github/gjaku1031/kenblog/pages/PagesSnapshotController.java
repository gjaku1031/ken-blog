package io.github.gjaku1031.kenblog.pages;

import lombok.RequiredArgsConstructor;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * GitHub Actions용 단일 공개 메타데이터 읽기 경로
 */
@RestController
@RequiredArgsConstructor
public final class PagesSnapshotController {
    /**
     * 공개 스냅샷 서비스
     */
    private final PagesSnapshotService snapshots;

    /**
     * 공개 메타데이터 스냅샷 조회
     */
    @GetMapping("/api/v1/pages/snapshot")
    public ResponseEntity<Map<String, Object>> snapshot() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(snapshots.snapshot());
    }
}
