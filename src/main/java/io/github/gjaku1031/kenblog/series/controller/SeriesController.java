package io.github.gjaku1031.kenblog.series.controller;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.series.domain.InvalidSeriesRequestException;
import io.github.gjaku1031.kenblog.series.dto.*;
import io.github.gjaku1031.kenblog.series.service.SeriesService;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import tools.jackson.databind.JsonNode;

import java.util.*;

/**
 * 본문 입력 없는 관리자 시리즈 메타데이터 API
 */
@RestController
@RequestMapping("/api/v1/admin/series")
@RequiredArgsConstructor
public final class SeriesController {
    /**
     * 시리즈 서비스
     */
    private final SeriesService service;

    /**
     * 시리즈 목록
     */
    @GetMapping
    public ResponseEntity<List<SeriesResponse>> list() {
        return noStore(service.list(true));
    }

    /**
     * 시리즈 상세와 문서 목록
     */
    @GetMapping("/{id}")
    public ResponseEntity<SeriesDetailResponse> detail(@PathVariable long id) {
        return noStore(service.detail(id));
    }

    /**
     * 참조 글이 없는 시리즈 삭제
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable long id) {
        service.delete(id);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    /**
     * 시리즈 생성
     */
    @PostMapping
    public ResponseEntity<SeriesResponse> create(@RequestBody JsonNode input) {
        return noStore(service.create(SeriesRequests.create(input)));
    }

    /**
     * 기존 수정 시각을 대조하여 속성 변경
     */
    @PutMapping("/{id}/metadata")
    public ResponseEntity<SeriesResponse> update(
            @PathVariable long id, @RequestBody JsonNode input) {
        return noStore(service.update(id, SeriesRequests.metadata(input)));
    }

    /**
     * 정수 표시 순서 변경
     */
    @PutMapping("/{id}/order")
    public ResponseEntity<SeriesResponse> order(
            @PathVariable long id, @RequestBody JsonNode input) {
        if (!input.isObject()
                || input.size() != 1
                || !input.path("order").isIntegralNumber()
                || !input.path("order").canConvertToLong())
            throw new InvalidSeriesRequestException();
        return noStore(service.setOrder(id, input.get("order").longValue()));
    }

    /**
     * 캐시 저장을 금지한 200 응답
     */
    private <T> ResponseEntity<T> noStore(T value) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);
    }
}
