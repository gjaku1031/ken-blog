package io.github.gjaku1031.kenblog.post.controller;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.attachment.dto.AttachmentIds;
import io.github.gjaku1031.kenblog.post.domain.*;
import io.github.gjaku1031.kenblog.post.dto.*;
import io.github.gjaku1031.kenblog.post.service.*;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import tools.jackson.databind.JsonNode;

import java.net.URI;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * 관리자 메타데이터·공개 범위·검수·DB 본문 열람 HTTP API
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
     * 단일 상태 이름 입력으로 공개 범위 변경
     */
    @PutMapping(
            value = "/{id}/publication",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostDetailResponse> publication(
            @PathVariable long id, @RequestBody JsonNode request) {
        var value = request.get("status");
        if (!request.isObject() || value == null || !value.isString() || request.size() != 1)
            throw new InvalidPostRequestException();
        PostStatus target;
        try {
            target = PostStatus.valueOf(value.stringValue());
        } catch (IllegalArgumentException exception) {
            throw new InvalidPostRequestException();
        }
        return noStore(service.changeStatus(id, target));
    }

    /**
     * 공개하지 않은 글의 DB 본문, 본문이 저장소 원고에만 있으면 404
     */
    @GetMapping(value = "/{id}/body", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostBodyResponse> body(@PathVariable long id) {
        return noStore(service.body(id));
    }

    /**
     * 검수 완료 표시·해제
     *
     * 표시는 {@code reviewed}와 화면이 읽은 {@code bodyUpdatedAt} 두 키, 해제는 {@code reviewed} 한 키만 허용
     */
    @PutMapping(
            value = "/{id}/review",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostDetailResponse> review(
            @PathVariable long id, @RequestBody JsonNode request) {
        var reviewed = request.get("reviewed");
        if (!request.isObject() || reviewed == null || !reviewed.isBoolean())
            throw new InvalidPostRequestException();
        if (!reviewed.booleanValue()) {
            if (request.size() != 1) throw new InvalidPostRequestException();
            return noStore(service.setReviewed(id, false, null));
        }
        var at = request.get("bodyUpdatedAt");
        if (at == null || !at.isString() || request.size() != 2)
            throw new InvalidPostRequestException();
        LocalDateTime bodyUpdatedAt;
        try {
            bodyUpdatedAt = LocalDateTime.parse(at.stringValue());
        } catch (DateTimeParseException exception) {
            throw new InvalidPostRequestException();
        }
        return noStore(service.setReviewed(id, true, bodyUpdatedAt));
    }

    /**
     * 관리자에게만 보이는 연결 글 목록
     */
    @GetMapping(value = "/{id}/links", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<PostLinkResponse>> links(@PathVariable long id) {
        return noStore(service.links(id));
    }

    /**
     * 본문의 이미지 ID를 글에 연결, 공개 글이면 익명 전달 권한이 됨
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
    @PutMapping(
            value = "/{id}/metadata",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<PostDetailResponse> metadata(
            @PathVariable long id, @RequestBody JsonNode request) {
        var input = PostEditRequest.metadata(request);
        return noStore(service.updateMetadata(id, input, PostEditRequest.version(request)));
    }

    /**
     * 캐시 저장을 금지한 200 응답
     */
    private <T> ResponseEntity<T> noStore(T value) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);
    }
}
