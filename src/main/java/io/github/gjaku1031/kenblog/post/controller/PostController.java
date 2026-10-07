package io.github.gjaku1031.kenblog.post.controller;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.attachment.dto.AttachmentIds;
import io.github.gjaku1031.kenblog.post.domain.*;
import io.github.gjaku1031.kenblog.post.dto.*;
import io.github.gjaku1031.kenblog.post.service.*;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import tools.jackson.databind.JsonNode;

import java.net.URI;
import java.util.*;

/**
 * 관리자 메타데이터·출간 상태·선언 관계 HTTP API
 */
@RestController
@RequestMapping("/api/v1/admin/posts")
@RequiredArgsConstructor
public final class PostController {
    /**
     * 게시글 서비스
     */
    private final PostService service;

    /**
     * 위키 제목 조회 서비스
     */
    private final WikiNavigationService navigation;

    /**
     * 메타데이터와 주소 등록, 원고는 Git에서 별도 작성
     */
    @PostMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostDetailResponse> create(@RequestBody JsonNode request) {
        var created = service.createMetadata(PostMetadataCreateRequest.fromJson(request));
        return ResponseEntity.created(URI.create("/api/v1/admin/posts/" + created.id()))
                .cacheControl(CacheControl.noStore())
                .body(created);
    }

    /**
     * 단일 q 입력의 제목 검색
     */
    @GetMapping(value = "/wiki-titles", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<WikiTitleSearchResponse> titleSearch(HttpServletRequest request) {
        var values = request.getParameterValues("q");
        if (values == null || values.length != 1) throw new InvalidWikiLinkRequestException();
        return noStore(navigation.titleSearch(values[0]));
    }

    /**
     * 원고 접근 없는 위키 선언 전체 교체
     */
    @PutMapping(
            value = "/{id}/wiki-links",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostDetailResponse> wikiLinks(
            @PathVariable long id, @RequestBody JsonNode request) {
        return noStore(
                service.replaceWikiLinks(
                        id, WikiLinkCorrectionRequest.fromJson(request).wikiTargets()));
    }

    /**
     * 본문 없는 관리자 목록
     */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostPageResponse> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return noStore(service.listDrafts(page, size));
    }

    /**
     * 같은 DB 시점의 관리자 전체 메타데이터
     */
    @GetMapping(value = "/snapshot", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<PostSummaryResponse>> snapshot() {
        return noStore(service.snapshot());
    }

    /**
     * 원고 파일이 없어도 현재 메타데이터 반환
     */
    @GetMapping(value = "/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostDetailResponse> detail(@PathVariable long id) {
        if (id <= 0) throw new InvalidPostRequestException();
        return noStore(service.adminMetadata(id));
    }

    /**
     * 메타데이터·종속 연결 삭제 후 204
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable long id) {
        service.delete(id);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    /**
     * 단일 불리언 입력으로 출간 상태 변경
     */
    @PutMapping(
            value = "/{id}/publication",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostDetailResponse> publication(
            @PathVariable long id, @RequestBody JsonNode request) {
        var value = request.get("published");
        if (!request.isObject() || value == null || !value.isBoolean() || request.size() != 1)
            throw new InvalidPostRequestException();
        return noStore(service.setPublished(id, value.booleanValue()));
    }

    /**
     * Git 원고의 이미지 ID에 공개 전달 권한 연결
     */
    @PutMapping(
            value = "/{id}/attachments",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostDetailResponse> attachments(
            @PathVariable long id, @RequestBody JsonNode request) {
        if (!request.isObject() || request.size() != 1 || !request.has("attachmentIds"))
            throw new InvalidPostRequestException();
        var ids = AttachmentIds.parse(request.get("attachmentIds"));
        if (ids == null) throw new InvalidPostRequestException();
        return noStore(service.replaceAttachments(id, ids));
    }

    /**
     * 본문 입력을 거부하고 전체 편집 키·기준 버전 검사
     */
    @PatchMapping(
            value = "/{id}/metadata",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostDetailResponse> metadata(
            @PathVariable long id, @RequestBody JsonNode request) {
        var input = PostEditRequest.metadata(request);
        return noStore(service.updateMetadata(id, input, PostEditRequest.version(request)));
    }

    /**
     * 필수 소속·순서·관련 ID와 기준 버전을 검증하여 시리즈 변경
     */
    @PutMapping("/{id}/series")
    public ResponseEntity<PostDetailResponse> series(
            @PathVariable long id, @RequestBody JsonNode request) {
        if (!request.isObject()
                || request.size() != 4
                || !request.has("baseVersion")
                || !request.has("seriesId")
                || !request.has("order")
                || !request.has("relatedSeriesId")) throw new InvalidPostRequestException();
        return noStore(
                service.setSeries(
                        id,
                        PostMetadataCreateRequest.optionalLong(request, "seriesId"),
                        PostMetadataCreateRequest.optionalInt(request, "order"),
                        PostMetadataCreateRequest.optionalLong(request, "relatedSeriesId"),
                        PostEditRequest.version(request)));
    }

    /**
     * 원고를 유지하며 선택 정수 순서와 기준 버전으로 표시 순서 변경
     */
    @PutMapping(
            value = "/{id}/order",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostDetailResponse> order(
            @PathVariable long id, @RequestBody JsonNode request) {
        if (!request.isObject()
                || request.size() != 2
                || !request.has("baseVersion")
                || !request.has("order")) throw new InvalidPostRequestException();
        return noStore(
                service.setOrder(
                        id,
                        PostMetadataCreateRequest.optionalInt(request, "order"),
                        PostEditRequest.version(request)));
    }

    /**
     * 캐시 저장을 금지한 200 응답
     */
    private <T> ResponseEntity<T> noStore(T value) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);
    }
}
