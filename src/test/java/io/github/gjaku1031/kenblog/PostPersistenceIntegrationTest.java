package io.github.gjaku1031.kenblog;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.gjaku1031.kenblog.category.service.CategoryService;
import io.github.gjaku1031.kenblog.fixture.SelectCounter;
import io.github.gjaku1031.kenblog.fixture.SqlCountConfig;
import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig;
import io.github.gjaku1031.kenblog.pages.PagesSnapshotService;
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException;
import io.github.gjaku1031.kenblog.post.domain.PostEditConflictException;
import io.github.gjaku1031.kenblog.post.domain.PostEntity;
import io.github.gjaku1031.kenblog.post.domain.PostVisibility;
import io.github.gjaku1031.kenblog.post.dto.PostDetailResponse;
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest;
import io.github.gjaku1031.kenblog.post.service.PostService;

import jakarta.persistence.EntityManager;

import org.hibernate.Hibernate;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.IntStream;

/**
 * 본문을 저장하지 않는 글 메타데이터와 스키마 보존 계약을 격리 MySQL에서 검증
 */
@SpringBootTest
@Import({TestMysqlConfig.class, SqlCountConfig.class})
final class PostPersistenceIntegrationTest {
    /**
     * 게시글 서비스
     */
    @Autowired private PostService service;

    /**
     * JDBC 쿼리 실행기
     */
    @Autowired private JdbcTemplate jdbc;

    /**
     * 테스트 트랜잭션 관리자
     */
    @Autowired private PlatformTransactionManager transactionManager;

    /**
     * 현재 트랜잭션의 엔티티·프록시 조회기
     */
    @Autowired private EntityManager entityManager;

    /**
     * 분류 삭제의 실제 일괄 이동 검증
     */
    @Autowired private CategoryService categories;

    /**
     * 공개 스냅샷과 일괄 탐색 조립 검증
     */
    @Autowired private PagesSnapshotService snapshots;

    /**
     * 스냅샷의 jOOQ 조회 실행 횟수
     */
    @Autowired private SelectCounter selects;

    /**
     * 테스트 간 글 상태 초기화
     */
    @BeforeEach
    void clearPosts() {
        jdbc.update("DELETE FROM posts");
    }

    /**
     * 태그만 바뀌어도 오래된 폼 거부, 잘못된 소속 변경은 전체 롤백
     */
    @Test
    void atomicEditsRejectStaleVersionsAndRollback() {
        var created = service.createMetadata(request("기준 글", "versioned-post", ""));
        var input =
                new PostMetadataCreateRequest(
                        "기준 글",
                        null,
                        "",
                        null,
                        List.of("새 태그"),
                        null,
                        null,
                        null,
                        List.of(),
                        List.of());
        var edited = service.updateMetadata(created.id(), input, created.editVersion());
        assertEquals(created.editVersion() + 1, edited.editVersion());
        assertThrows(
                PostEditConflictException.class,
                () ->
                        service.updateMetadata(
                                created.id(),
                                new PostMetadataCreateRequest(
                                        "덮어쓰기",
                                        null,
                                        "",
                                        null,
                                        input.tags(),
                                        null,
                                        null,
                                        null,
                                        List.of(),
                                        List.of()),
                                created.editVersion()));
        assertThrows(
                InvalidPostRequestException.class,
                () ->
                        service.updateMetadata(
                                created.id(),
                                new PostMetadataCreateRequest(
                                        "롤백할 제목",
                                        null,
                                        "",
                                        null,
                                        input.tags(),
                                        null,
                                        3,
                                        null,
                                        List.of(),
                                        List.of()),
                                edited.editVersion()));
        var reloaded = service.adminMetadata(created.id());
        assertEquals("기준 글", reloaded.title());
        assertEquals(List.of("새 태그"), reloaded.tags());
        assertEquals(edited.editVersion(), reloaded.editVersion());
        assertEquals(
                "",
                jdbc.queryForObject(
                        "SELECT body FROM posts WHERE id = ?", String.class, created.id()));
    }

    /**
     * 같은 버전의 동시 저장 중 하나만 커밋
     */
    @Test
    void concurrentEditorsHaveOneWinner() throws Exception {
        var created = service.createMetadata(request("동시 글", "concurrent-edit", ""));
        try (var pool = Executors.newFixedThreadPool(2)) {
            var gate = new CountDownLatch(1);
            var results = new ArrayList<Future<Boolean>>();
            for (int index = 1; index <= 2; index++) {
                int editor = index;
                results.add(
                        pool.submit(
                                () -> {
                                    gate.await();
                                    try {
                                        service.updateMetadata(
                                                created.id(),
                                                new PostMetadataCreateRequest("제목 " + editor),
                                                created.editVersion());
                                        return true;
                                    } catch (PostEditConflictException exception) {
                                        return false;
                                    }
                                }));
            }
            gate.countDown();
            int winners = 0;
            for (var result : results) if (result.get(15, TimeUnit.SECONDS)) winners++;
            assertEquals(1, winners);
        }
    }

    /**
     * 분류 일괄 이동의 편집 버전 증가와 정렬 보존
     */
    @Test
    void categoryMovesInvalidateEditors() {
        long category = categories.create("move-root-" + UUID.randomUUID()).id();
        var created =
                service.createMetadata(
                        new PostMetadataCreateRequest(
                                "이동 글",
                                "category-edit",
                                "",
                                category,
                                List.of(),
                                null,
                                3,
                                null,
                                List.of(),
                                List.of()));
        categories.delete(category);
        assertEquals(created.editVersion() + 1, service.adminMetadata(created.id()).editVersion());
        assertEquals(3, service.adminMetadata(created.id()).seriesOrder());
        assertThrows(
                PostEditConflictException.class,
                () ->
                        service.updateMetadata(
                                created.id(),
                                new PostMetadataCreateRequest("오래된 이동"),
                                created.editVersion()));
    }

    /**
     * 300개 글 탐색의 단일 직렬화·제한된 SQL 수·관리자 스냅샷 일관 읽기
     */
    @Test
    void largeSnapshotsAreBoundedAndConsistent() {
        long category = categories.create("snapshot-" + UUID.randomUUID() + "/child").id();
        String sql =
                "INSERT INTO posts (title, slug, body, body_sha256, summary, created_at,"
                    + " updated_at, status, visibility, section, view_count, edit_version,"
                    + " category_id, published_at) VALUES (?, ?, '', REPEAT('0', 64), '',"
                    + " UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'PUBLISHED', 'PUBLIC', 'TECH', 0, 0, ?,"
                    + " UTC_TIMESTAMP(6))";
        var batch =
                IntStream.rangeClosed(1, 300)
                        .mapToObj(
                                index ->
                                        new Object[] {
                                            "스냅샷 " + index, "snapshot-" + index, category
                                        })
                        .toList();
        jdbc.batchUpdate(sql, batch);
        var statistics =
                entityManager
                        .getEntityManagerFactory()
                        .unwrap(SessionFactory.class)
                        .getStatistics();
        statistics.setStatisticsEnabled(true);
        statistics.clear();
        selects.getCount().set(0);
        var payload = snapshots.snapshot();
        assertTrue(statistics.getPrepareStatementCount() + selects.getCount().get() <= 10);
        statistics.setStatisticsEnabled(false);
        assertEquals(3, payload.get("version"));
        var navigation = (Map<?, ?>) payload.get("navigation");
        assertEquals(1, navigation.size());
        assertEquals(300, ((List<?>) navigation.values().iterator().next()).size());
        assertTrue(
                JsonMapper.builder()
                                .findAndAddModules()
                                .build()
                                .writeValueAsBytes(payload)
                                .length
                        < 500_000);
        var transaction = new TransactionTemplate(transactionManager);
        transaction.setIsolationLevel(
                TransactionDefinition.ISOLATION_REPEATABLE_READ);
        try (var pool = Executors.newSingleThreadExecutor()) {
            transaction.executeWithoutResult(
                    status -> {
                        var before = service.snapshot();
                        assertEquals(300, before.size());
                        var target = before.getLast();
                        var future =
                                pool.submit(
                                        () ->
                                                service.updateMetadata(
                                                        target.id(),
                                                        new PostMetadataCreateRequest(
                                                                "동시 변경", null, "", category,
                                                                List.of(), null, null, null,
                                                                List.of(), List.of()),
                                                        target.editVersion()));
                        assertDoesNotThrow(() -> future.get(15, TimeUnit.SECONDS));
                        assertEquals(before, service.snapshot());
                    });
        }
        assertEquals(300, service.snapshot().stream().map(row -> row.id()).distinct().count());
        assertTrue(service.snapshot().stream().anyMatch(row -> row.title().equals("동시 변경")));
    }

    /**
     * 반대 소속·관련 시리즈의 동시 생성도 같은 잠금 순서로 완료
     */
    @Test
    void oppositeSeriesAssignmentsDoNotDeadlock() throws Exception {
        var slugs = List.of("lock-a-" + UUID.randomUUID(), "lock-b-" + UUID.randomUUID());
        for (String slug : slugs)
            jdbc.update(
                    "INSERT INTO series (slug, name, description, kind, visibility, sort_order,"
                        + " created_at, updated_at) VALUES (?, ?, '', 'PROJECT', 'PUBLIC', 0,"
                        + " UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
                    slug,
                    slug);
        var ids =
                slugs.stream()
                        .map(
                                slug ->
                                        Objects.requireNonNull(
                                                jdbc.queryForObject(
                                                        "SELECT id FROM series WHERE slug = ?",
                                                        Long.class,
                                                        slug)))
                        .toList();
        try (var pool = Executors.newFixedThreadPool(2)) {
            for (int iteration = 0; iteration < 3; iteration++) {
                var gate = new CountDownLatch(1);
                var futures = new ArrayList<Future<PostDetailResponse>>();
                for (int index = 0; index <= 1; index++) {
                    int owner = index;
                    futures.add(
                            pool.submit(
                                    () -> {
                                        gate.await();
                                        return service.createMetadata(
                                                new PostMetadataCreateRequest(
                                                        "교차 소속",
                                                        null,
                                                        "",
                                                        null,
                                                        List.of(),
                                                        ids.get(owner),
                                                        null,
                                                        ids.get(1 - owner),
                                                        List.of(),
                                                        List.of()));
                                    }));
                }
                gate.countDown();
                for (int index = 0; index < futures.size(); index++) {
                    var result = futures.get(index).get(15, TimeUnit.SECONDS);
                    assertEquals(ids.get(index), result.series().id());
                    assertEquals(ids.get(1 - index), result.relatedSeriesId());
                }
            }
        }
    }

    /**
     * 제목·주소 정규화와 DB 호환 본문 초기값·UTC 시각 검증
     */
    @Test
    void savesMetadataAndReloadsByIdAndSlug() {
        var beforeCreate = Instant.now().truncatedTo(ChronoUnit.MICROS);
        var created = service.createMetadata(request("  첫 글  ", "  FIRST-POST  ", ""));
        var afterCreate = Instant.now();
        var byId = service.adminMetadata(created.id());
        assertEquals("첫 글", byId.title());
        assertEquals("first-post", byId.slug());
        assertEquals(
                "",
                jdbc.queryForObject(
                        "SELECT body FROM posts WHERE slug = ?", String.class, "first-post"));
        assertEquals(PostVisibility.PUBLIC, byId.visibility());
        assertEquals(
                created.id(),
                jdbc.queryForObject(
                        "SELECT id FROM posts WHERE slug = ?", Long.class, "first-post"));
        assertEquals(byId.createdAt(), byId.updatedAt());
        var storedInstant = byId.createdAt().toInstant(ZoneOffset.UTC);
        assertFalse(storedInstant.isBefore(beforeCreate));
        assertFalse(storedInstant.isAfter(afterCreate));
    }

    /**
     * 지연 프록시 getter·도메인 변경·커밋 후 재조회 검증
     */
    @Test
    void loadsAndUpdatesMetadataThroughLazyProxy() {
        var created = service.createMetadata(request("변경 전", "lazy-proxy", ""));
        var updatedAt = LocalDateTime.of(2026, 10, 3, 12, 0);
        new TransactionTemplate(transactionManager)
                .executeWithoutResult(
                        status -> {
                            var reference =
                                    entityManager.getReference(PostEntity.class, created.id());
                            assertFalse(Hibernate.isInitialized(reference));
                            assertEquals("변경 전", reference.getTitle());
                            assertTrue(Hibernate.isInitialized(reference));
                            entityManager.clear();
                            var fresh = entityManager.getReference(PostEntity.class, created.id());
                            assertFalse(Hibernate.isInitialized(fresh));
                            fresh.replaceMetadata("변경 후", "프록시 변경", updatedAt);
                            assertTrue(Hibernate.isInitialized(fresh));
                        });
        var reloaded = service.adminMetadata(created.id());
        assertEquals("변경 후", reloaded.title());
        assertEquals("프록시 변경", reloaded.summary());
        assertEquals(updatedAt, reloaded.updatedAt());
    }

    /**
     * Unicode 제목·요약 최대 길이 DB 왕복
     */
    @Test
    void acceptsExactMetadataLimits() {
        String title = "😀".repeat(200);
        String summary = "가".repeat(120);
        var created = service.createMetadata(request(title, "limit-post", summary));
        var reloaded = service.adminMetadata(created.id());
        assertEquals(title, reloaded.title());
        assertEquals(summary, reloaded.summary());
        assertEquals(
                "",
                jdbc.queryForObject(
                        "SELECT body FROM posts WHERE id = ?", String.class, created.id()));
    }

    /**
     * 제목·주소·요약 오류를 저장 전에 거부
     */
    @Test
    void rejectsInvalidInputsBeforeWriting() {
        assertThrows(
                InvalidPostRequestException.class,
                () -> service.createMetadata(request("   ", "blank-title", "")));
        assertThrows(
                InvalidPostRequestException.class,
                () -> service.createMetadata(request("가".repeat(201), "long-title", "")));
        assertThrows(
                InvalidPostRequestException.class,
                () -> service.createMetadata(request("제목", "invalid slug", "")));
        assertThrows(
                InvalidPostRequestException.class,
                () -> service.createMetadata(request("제목", "long-summary", "가".repeat(121))));
        assertEquals(0, countPosts());
    }

    /**
     * 직접 SQL 변경도 주소 고유 제약으로 거부
     */
    @Test
    void duplicateSlugFailsAtDatabaseConstraint() {
        var first = service.createMetadata(request("원본", "same-slug", ""));
        var second = service.createMetadata(request("다른 제목", "other-slug", ""));
        assertThrows(
                DataIntegrityViolationException.class,
                () ->
                        jdbc.update(
                                "UPDATE posts SET slug = ? WHERE id = ?",
                                first.slug(),
                                second.id()));
        assertEquals(2, countPosts());
        assertEquals("원본", service.adminMetadata(first.id()).title());
    }

    /**
     * 후속 검증 실패가 같은 외부 트랜잭션의 첫 등록도 롤백
     */
    @Test
    void rollsBackWholeTransactionAfterValidationFailure() {
        service.createMetadata(request("기존", "existing-post", ""));
        assertThrows(
                InvalidPostRequestException.class,
                () ->
                        new TransactionTemplate(transactionManager)
                                .executeWithoutResult(
                                        status -> {
                                            service.createMetadata(
                                                    request("첫 저장", "first-post", ""));
                                            service.createMetadata(
                                                    request("   ", "invalid-post", ""));
                                        }));
        assertEquals(1, countPosts());
    }

    /**
     * 새 스키마의 글 주소·계정 고유 제약 확인
     */
    @Test
    void freshSchemaHasUniqueConstraints() {
        assertTrue(
                Objects.requireNonNull(
                                jdbc.queryForObject(
                                        "SELECT COUNT(*) FROM information_schema.table_constraints"
                                            + " WHERE table_schema = DATABASE() AND table_name ="
                                            + " 'posts' AND constraint_name = 'uk_posts_slug'",
                                        Integer.class))
                        > 0);
        assertTrue(
                Objects.requireNonNull(
                                jdbc.queryForObject(
                                        "SELECT COUNT(*) FROM information_schema.table_constraints"
                                            + " WHERE table_schema = DATABASE() AND table_name ="
                                            + " 'users' AND constraint_name = 'uk_users_username'",
                                        Integer.class))
                        > 0);
    }

    /**
     * 글 삭제 시 태그·위키 선언 FK 연쇄 삭제
     */
    @Test
    void deletingPostCascadesToItsMetadata() {
        long id = service.createMetadata(request("삭제할 글", "delete-post", "")).id();
        jdbc.update(
                "INSERT INTO post_tags (post_id, position, tag_name, display_name) VALUES (?, 0,"
                    + " 'kotlin', 'Kotlin')",
                id);
        jdbc.update(
                "INSERT INTO post_wiki_links (post_id, position, target_title) VALUES (?, 0, '다른"
                    + " 글')",
                id);
        jdbc.update("DELETE FROM posts WHERE id = ?", id);
        for (String table : List.of("post_tags", "post_wiki_links"))
            assertEquals(
                    0,
                    jdbc.queryForObject(
                            "SELECT COUNT(*) FROM " + table + " WHERE post_id = ?",
                            Integer.class,
                            id));
    }

    /**
     * 초기화 SQL 재실행의 기존 글·실패 상태·잠금 행 보존
     */
    @Test
    void repeatedInitializationPreservesExistingState() {
        var post = service.createMetadata(request("유지할 글", "keep-post", ""));
        jdbc.update("UPDATE admin_auth_state SET failure_count = 2 WHERE id = 1");
        var initializer = new ResourceDatabasePopulator(new ClassPathResource("schema.sql"));
        for (int index = 0; index < 2; index++)
            initializer.execute(Objects.requireNonNull(jdbc.getDataSource()));
        assertEquals("유지할 글", service.adminMetadata(post.id()).title());
        assertEquals(
                2,
                jdbc.queryForObject(
                        "SELECT failure_count FROM admin_auth_state WHERE id = 1", Integer.class));
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM content_state WHERE id = 1", Integer.class));
    }

    /**
     * 관계 없는 글의 메타데이터 입력
     */
    private PostMetadataCreateRequest request(String title, String slug, String summary) {
        return new PostMetadataCreateRequest(
                title, slug, summary, null, List.of(), null, null, null, List.of(), List.of());
    }

    /**
     * 저장된 게시글 수
     */
    private int countPosts() {
        return Objects.requireNonNull(
                jdbc.queryForObject("SELECT COUNT(*) FROM posts", Integer.class));
    }
}
