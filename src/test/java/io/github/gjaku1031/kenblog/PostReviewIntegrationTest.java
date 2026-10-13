package io.github.gjaku1031.kenblog;

import static org.junit.jupiter.api.Assertions.*;

import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig;
import io.github.gjaku1031.kenblog.pages.PagesSnapshotService;
import io.github.gjaku1031.kenblog.post.domain.PostNotFoundException;
import io.github.gjaku1031.kenblog.post.domain.PostStateConflictException;
import io.github.gjaku1031.kenblog.post.domain.PostStatus;
import io.github.gjaku1031.kenblog.post.dto.PostLinkResponse;
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest;
import io.github.gjaku1031.kenblog.post.service.PostService;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 공개 범위 전환·검수 표시·DB 본문·연결의 계약을 격리 MySQL에서 검증
 * 본문과 연결은 운영 절차와 같이 SQL로 직접 넣음
 */
@SpringBootTest
@Import(TestMysqlConfig.class)
final class PostReviewIntegrationTest {
    /**
     * 게시글 서비스
     */
    @Autowired private PostService service;

    /**
     * 공개 스냅샷 서비스
     */
    @Autowired private PagesSnapshotService snapshots;

    /**
     * 본문·연결 행 준비와 저장 결과 대조
     */
    @Autowired private JdbcTemplate jdbc;

    /**
     * 테스트 간 글과 종속 행 초기화
     */
    @BeforeEach
    void clearPosts() {
        jdbc.update("DELETE FROM posts");
    }

    /**
     * 새 글은 미검수로 시작하고, 전환마다 편집 버전이 오르며 최초 출간 시각은 내린 뒤에도 유지
     */
    @Test
    void statusTransitionsKeepFirstPublicationTime() {
        var created = service.createMetadata(request("상태 전환", "status-post"));
        assertEquals(PostStatus.UNREVIEWED, created.status());
        assertNull(created.publishedAt());
        var published = service.changeStatus(created.id(), PostStatus.PUBLISHED);
        assertEquals(PostStatus.PUBLISHED, published.status());
        assertNotNull(published.publishedAt());
        assertEquals(created.editVersion() + 1, published.editVersion());
        var hidden = service.changeStatus(created.id(), PostStatus.PRIVATE);
        assertEquals(PostStatus.PRIVATE, hidden.status());
        assertEquals(published.publishedAt(), hidden.publishedAt());
        var again = service.changeStatus(created.id(), PostStatus.PUBLISHED);
        assertEquals(published.publishedAt(), again.publishedAt());
        assertEquals(created.editVersion() + 3, again.editVersion());
    }

    /**
     * DB 본문이 남은 글은 공개로 바꾸지 못하고, 본문을 지운 뒤에는 공개 가능
     */
    @Test
    void publishingRejectsPostsWithDatabaseBody() {
        long id = service.createMetadata(request("DB 본문 글", "body-post")).id();
        insertBody(id, "# 본문");
        assertThrows(
                PostStateConflictException.class,
                () -> service.changeStatus(id, PostStatus.PUBLISHED));
        assertEquals(PostStatus.UNREVIEWED, service.adminMetadata(id).status());
        assertEquals(
                PostStatus.PRIVATE, service.changeStatus(id, PostStatus.PRIVATE).status());
        jdbc.update("DELETE FROM post_bodies WHERE post_id = ?", id);
        assertEquals(
                PostStatus.PUBLISHED, service.changeStatus(id, PostStatus.PUBLISHED).status());
    }

    /**
     * 검수 완료는 미검수 글의 현재 본문에만 표시되고 상태 전환 시 초기화
     *
     * 1. 본문이 없거나 읽은 시각이 다르면 거부
     * 2. 표시·해제는 메타데이터 편집 버전을 올리지 않음
     * 3. 상태를 바꾸면 표시가 지워지고, 미검수가 아닌 글은 표시 불가
     */
    @Test
    void reviewMarksOnlyTheBodyThatWasRead() {
        var created = service.createMetadata(request("검수 글", "review-post"));
        long id = created.id();
        assertThrows(
                PostStateConflictException.class,
                () -> service.setReviewed(id, true, LocalDateTime.of(2026, 1, 1, 0, 0)));
        insertBody(id, "첫 본문");
        var readAt = service.body(id).updatedAt();
        assertThrows(
                PostStateConflictException.class,
                () -> service.setReviewed(id, true, readAt.minusSeconds(1)));
        var reviewed = service.setReviewed(id, true, readAt);
        assertNotNull(reviewed.reviewedAt());
        assertEquals(readAt, reviewed.bodyUpdatedAt());
        assertEquals(created.editVersion(), reviewed.editVersion());
        assertNull(service.setReviewed(id, false, null).reviewedAt());
        // 상태 전환이 검수 표시를 지우고, 비공개 글은 다시 표시할 수 없음
        service.setReviewed(id, true, readAt);
        assertNull(service.changeStatus(id, PostStatus.PRIVATE).reviewedAt());
        assertThrows(
                PostStateConflictException.class, () -> service.setReviewed(id, true, readAt));
        assertThrows(
                PostStateConflictException.class, () -> service.setReviewed(id, false, null));
    }

    /**
     * 비공개·미검수 글의 메타데이터·본문·연결은 공개 스냅샷과 revision에 영향 없음
     */
    @Test
    void hiddenPostsDoNotChangePublicSnapshot() {
        long open = service.createMetadata(request("공개 글", "open-post")).id();
        service.changeStatus(open, PostStatus.PUBLISHED);
        var before = snapshots.snapshot();
        long note =
                service.createMetadata(
                                new PostMetadataCreateRequest(
                                        "비공개 노트",
                                        "private-note",
                                        "요약",
                                        null,
                                        List.of("숨김"),
                                        null,
                                        null,
                                        null,
                                        List.of()))
                        .id();
        service.changeStatus(note, PostStatus.PRIVATE);
        insertBody(note, "비공개 본문");
        long waiting = service.createMetadata(request("미검수 글", "waiting-post")).id();
        insertBody(waiting, "미검수 본문");
        service.setReviewed(waiting, true, service.body(waiting).updatedAt());
        jdbc.update("INSERT INTO post_links (post_id, linked_post_id) VALUES (?, ?)", open, note);
        var after = snapshots.snapshot();
        assertEquals(before.get("revision"), after.get("revision"));
        var posts = (List<?>) after.get("posts");
        assertEquals(1, posts.size());
        assertEquals(open, ((Map<?, ?>) posts.getFirst()).get("id"));
        assertFalse(after.toString().contains("비공개"));
        assertEquals(3, service.snapshot().size());
    }

    /**
     * 본문 조회의 부재 처리와 방향 없는 연결 조회
     */
    @Test
    void bodyAndLinksAreReadableByAdmin() {
        long post = service.createMetadata(request("본 글", "main-post")).id();
        long note = service.createMetadata(request("노트", "note-post")).id();
        assertThrows(PostNotFoundException.class, () -> service.body(post));
        assertThrows(PostNotFoundException.class, () -> service.links(Long.MAX_VALUE));
        insertBody(note, "노트 본문");
        assertEquals("노트 본문", service.body(note).body());
        assertEquals(List.of(), service.links(post));
        jdbc.update("INSERT INTO post_links (post_id, linked_post_id) VALUES (?, ?)", post, note);
        assertEquals(
                List.of(new PostLinkResponse(note, "노트", "note-post", PostStatus.UNREVIEWED)),
                service.links(post));
        assertEquals(
                List.of(new PostLinkResponse(post, "본 글", "main-post", PostStatus.UNREVIEWED)),
                service.links(note));
    }

    /**
     * 글 삭제 시 DB 본문과 양쪽 방향의 연결 연쇄 삭제
     */
    @Test
    void deletingPostCascadesBodyAndLinks() {
        long post = service.createMetadata(request("남는 글", "kept-post")).id();
        long note = service.createMetadata(request("지울 노트", "removed-note")).id();
        insertBody(note, "지울 본문");
        jdbc.update("INSERT INTO post_links (post_id, linked_post_id) VALUES (?, ?)", post, note);
        jdbc.update("INSERT INTO post_links (post_id, linked_post_id) VALUES (?, ?)", note, post);
        service.delete(note);
        assertEquals(0, count("post_bodies"));
        assertEquals(0, count("post_links"));
        assertEquals(List.of(), service.links(post));
    }

    /**
     * 운영 절차와 같은 방식의 본문 행 준비
     */
    private void insertBody(long id, String body) {
        jdbc.update(
                "INSERT INTO post_bodies (post_id, body, updated_at) VALUES (?, ?,"
                    + " UTC_TIMESTAMP(6))",
                id,
                body);
    }

    /**
     * 지정 테이블의 행 수
     */
    private int count(String table) {
        return Objects.requireNonNull(
                jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class));
    }

    /**
     * 분류·시리즈 없는 글 입력
     */
    private PostMetadataCreateRequest request(String title, String slug) {
        return new PostMetadataCreateRequest(
                title, slug, "", null, List.of(), null, null, null, List.of());
    }
}
