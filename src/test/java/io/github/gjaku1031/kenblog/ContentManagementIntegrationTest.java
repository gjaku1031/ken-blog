package io.github.gjaku1031.kenblog;

import static org.junit.jupiter.api.Assertions.*;

import io.github.gjaku1031.kenblog.category.domain.CategoryConflictException;
import io.github.gjaku1031.kenblog.category.domain.CategoryEntity;
import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException;
import io.github.gjaku1031.kenblog.category.dto.CategoryNameRequest;
import io.github.gjaku1031.kenblog.category.dto.CategoryReorderRequest;
import io.github.gjaku1031.kenblog.category.service.CategoryService;
import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig;
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest;
import io.github.gjaku1031.kenblog.post.service.PostService;
import io.github.gjaku1031.kenblog.series.domain.ProjectStatus;
import io.github.gjaku1031.kenblog.series.domain.SeriesInUseException;
import io.github.gjaku1031.kenblog.series.domain.SeriesKind;
import io.github.gjaku1031.kenblog.series.dto.SeriesCreateRequest;
import io.github.gjaku1031.kenblog.series.dto.SeriesMetadataRequest;
import io.github.gjaku1031.kenblog.series.service.SeriesService;

import jakarta.persistence.EntityManager;

import org.hibernate.Hibernate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.ObjectMapper;

import java.util.*;

/**
 * 이름 수정·형제 일괄 정렬·연결 글 삭제 제약의 실제 MySQL 검증
 */
@SpringBootTest
@Import(TestMysqlConfig.class)
@Transactional
final class ContentManagementIntegrationTest {
    /**
     * 분류 변경 서비스
     */
    @Autowired private CategoryService categories;

    /**
     * 글 생성·삭제 서비스
     */
    @Autowired private PostService posts;

    /**
     * 시리즈 생성·삭제 서비스
     */
    @Autowired private SeriesService series;

    /**
     * 저장 행·종속 연결 대조
     */
    @Autowired private JdbcTemplate jdbc;

    /**
     * 실제 JSON 입력 파서
     */
    @Autowired private ObjectMapper mapper;

    /**
     * 지연 프록시·변경 감지 검증
     */
    @Autowired private EntityManager entities;

    /**
     * 초안 소속·관련 글이 각각 프로젝트 삭제를 막고 모두 지우면 삭제 가능
     */
    @Test
    void requiresRemovalOfBothOwnedAndRelatedPostsIncludingDrafts() {
        var project =
                series.create(
                        new SeriesCreateRequest(
                                null,
                                SeriesKind.PROJECT,
                                new SeriesMetadataRequest(
                                        "프로젝트",
                                        "",
                                        ProjectStatus.PLAN,
                                        "2026.10",
                                        null,
                                        List.of(),
                                        null)));
        var cover =
                posts.createMetadata(
                        new PostMetadataCreateRequest(
                                "소개",
                                null,
                                "",
                                null,
                                List.of(),
                                project.id(),
                                null,
                                null,
                                List.of()));
        var related =
                posts.createMetadata(
                        new PostMetadataCreateRequest(
                                "관련 초안",
                                null,
                                "",
                                null,
                                List.of("테스트"),
                                null,
                                null,
                                project.id(),
                                List.of()));
        assertThrows(SeriesInUseException.class, () -> series.delete(project.id()));
        posts.delete(cover.id());
        assertThrows(SeriesInUseException.class, () -> series.delete(project.id()));
        assertEquals(project.id(), posts.adminMetadata(related.id()).relatedSeriesId());
        posts.delete(related.id());
        series.delete(project.id());
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM series WHERE id=?", Integer.class, project.id()));
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT COUNT(*) FROM post_tags WHERE post_id=?",
                        Integer.class,
                        related.id()));
    }

    /**
     * 일반 시리즈에도 동일한 글 참조 삭제 제약 적용
     */
    @Test
    void regularSeriesUsesTheSameDeletionConstraint() {
        var group =
                series.create(
                        new SeriesCreateRequest(
                                null,
                                SeriesKind.TECH,
                                new SeriesMetadataRequest(
                                        "시리즈", "", null, null, null, List.of(), null)));
        var post =
                posts.createMetadata(
                        new PostMetadataCreateRequest(
                                "소속 글",
                                null,
                                "",
                                null,
                                List.of(),
                                group.id(),
                                null,
                                null,
                                List.of()));
        posts.setPublished(post.id(), true);
        assertThrows(SeriesInUseException.class, () -> series.delete(group.id()));
        posts.delete(post.id());
        series.delete(group.id());
        assertFalse(series.list(true).stream().anyMatch(item -> item.id() == group.id()));
    }

    /**
     * 분류 이름 수정 시 주소·FK·본문 보존
     */
    @Test
    void renamingPreservesPathsAndPostAssignments() {
        var child = categories.create("Spring/Security");
        var parent =
                categories.tree().stream()
                        .filter(item -> item.path().equals("spring"))
                        .findFirst()
                        .orElseThrow();
        var post =
                posts.createMetadata(
                        new PostMetadataCreateRequest(
                                "보안 글",
                                null,
                                "",
                                child.id(),
                                List.of(),
                                null,
                                null,
                                null,
                                List.of()));
        var renamed = categories.rename(parent.id(), "  Backend  Notes  ");
        assertEquals("Backend Notes", renamed.name());
        assertEquals("spring", renamed.path());
        assertEquals("Authentication", categories.rename(child.id(), "Authentication").name());
        assertEquals("spring/security", posts.adminMetadata(post.id()).category().path());
        assertEquals(child.id(), posts.adminMetadata(post.id()).category().id());
        assertEquals(
                "",
                jdbc.queryForObject("SELECT body FROM posts WHERE id=?", String.class, post.id()));
    }

    /**
     * 초기화 전 JPA 프록시의 도메인 변경·변경 감지·재조회 검증
     */
    @Test
    void renamesThroughAnUninitializedProxy() {
        var category = categories.create("Proxy");
        entities.clear();
        var reference = entities.getReference(CategoryEntity.class, category.id());
        assertFalse(Hibernate.isInitialized(reference));
        reference.rename("Changed");
        assertTrue(Hibernate.isInitialized(reference));
        entities.flush();
        entities.clear();
        var reloaded = entities.find(CategoryEntity.class, category.id());
        assertEquals("Changed", reloaded.getName());
        assertEquals(category.path(), reloaded.getPath());
    }

    /**
     * 잘못된 이름과 형제 표시명 중복을 생성·수정 양쪽에서 거부
     */
    @Test
    void rejectsInvalidAndDuplicateDisplayNames() {
        var first = categories.create("First");
        var second = categories.create("Second");
        categories.rename(first.id(), "Renamed");
        assertThrows(
                CategoryConflictException.class, () -> categories.rename(second.id(), "renamed"));
        assertThrows(CategoryConflictException.class, () -> categories.create("Renamed"));
        for (String name : List.of("", "A/B", "A\nB", "x".repeat(61)))
            assertThrows(
                    InvalidCategoryRequestException.class,
                    () -> categories.rename(first.id(), name));
    }

    /**
     * 형제 전체 순서·루트 재정렬과 다른 부모·누락·중복 입력 거부
     */
    @Test
    void reordersOnlyTheCompleteSiblingSet() {
        var first = categories.create("Parent/First");
        var second = categories.create("Parent/Second");
        var other = categories.create("Other/Child");
        var roots = categories.tree();
        var parent =
                roots.stream()
                        .filter(item -> item.path().equals("parent"))
                        .findFirst()
                        .orElseThrow();
        categories.reorder(parent.id(), List.of(second.id(), first.id()));
        var children =
                categories.tree().stream()
                        .filter(item -> item.id() == parent.id())
                        .findFirst()
                        .orElseThrow()
                        .children();
        assertEquals(
                List.of(second.id(), first.id()),
                children.stream().map(item -> item.id()).toList());
        assertEquals(List.of(1, 2), children.stream().map(item -> item.sortOrder()).toList());
        assertThrows(
                CategoryConflictException.class,
                () -> categories.reorder(parent.id(), List.of(first.id(), other.id())));
        assertThrows(
                CategoryConflictException.class,
                () -> categories.reorder(parent.id(), List.of(first.id())));
        assertThrows(
                InvalidCategoryRequestException.class,
                () -> categories.reorder(parent.id(), List.of(first.id(), first.id())));
        assertEquals(
                children,
                categories.tree().stream()
                        .filter(item -> item.id() == parent.id())
                        .findFirst()
                        .orElseThrow()
                        .children());
        var reversed = roots.reversed().stream().map(item -> item.id()).toList();
        categories.reorder(null, reversed);
        assertEquals(reversed, categories.tree().stream().map(item -> item.id()).toList());
    }

    /**
     * 이름·순서 JSON의 타입 강제 변환·누락·알 수 없는 필드 거부
     */
    @Test
    void rejectsMalformedManagementInputs() {
        for (String json : List.of("{}", "{\"name\":42}", "{\"name\":\"Name\",\"path\":\"other\"}"))
            assertThrows(
                    InvalidCategoryRequestException.class,
                    () -> CategoryNameRequest.fromJson(mapper.readTree(json)));
        for (String json :
                List.of(
                        "{\"ids\":[1]}",
                        "{\"parentId\":null,\"ids\":[\"1\"]}",
                        "{\"parentId\":true,\"ids\":[1]}",
                        "{\"parentId\":null,\"ids\":[1],\"extra\":true}"))
            assertThrows(
                    InvalidCategoryRequestException.class,
                    () -> CategoryReorderRequest.fromJson(mapper.readTree(json)));
        assertEquals(
                List.of(2L, 1L),
                CategoryReorderRequest.fromJson(
                                mapper.readTree("{\"parentId\":null,\"ids\":[2,1]}"))
                        .ids());
    }
}
