package io.github.gjaku1031.kenblog.category.controller;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.category.dto.*;
import io.github.gjaku1031.kenblog.category.service.CategoryService;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import tools.jackson.databind.JsonNode;

import java.util.*;

/**
 * 관리자 분류 요청과 분류 서비스 연결
 */
@RestController
@RequestMapping("/api/v1/admin/categories")
@RequiredArgsConstructor
public final class AdminCategoryController {
    /**
     * 분류 서비스
     */
    private final CategoryService service;

    /**
     * 엄격한 문자열 경로 생성과 no-store 201
     */
    @PostMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<CategoryRefResponse> create(@RequestBody JsonNode request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(service.create(CategoryCreateRequest.fromJson(request).path()));
    }

    /**
     * 초안 포함 직접·자손 건수 트리
     */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<CategoryTreeResponse>> list() {
        return noStore(service.tree());
    }

    /**
     * 기존 경로를 유지한 표시 이름 변경
     */
    @PutMapping(
            value = "/{id}/name",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<CategoryRefResponse> rename(
            @PathVariable("id") long id, @RequestBody JsonNode request) {
        return noStore(service.rename(id, CategoryNameRequest.fromJson(request).name()));
    }

    /**
     * 같은 부모의 전체 형제 순서 원자적 저장
     */
    @PutMapping(
            value = "/order",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<CategoryRefResponse>> reorder(@RequestBody JsonNode request) {
        var input = CategoryReorderRequest.fromJson(request);
        return noStore(service.reorder(input.parentId(), input.ids()));
    }

    /**
     * 글을 부모로 이동한 뒤 분류만 삭제
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable("id") long id) {
        service.delete(id);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    /**
     * 캐시 저장을 금지한 200 응답
     */
    private <T> ResponseEntity<T> noStore(T value) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);
    }
}
