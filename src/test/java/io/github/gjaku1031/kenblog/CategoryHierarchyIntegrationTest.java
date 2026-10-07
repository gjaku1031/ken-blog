package io.github.gjaku1031.kenblog;

import static org.junit.jupiter.api.Assertions.*;

import io.github.gjaku1031.kenblog.category.domain.InvalidCategoryRequestException;
import io.github.gjaku1031.kenblog.category.service.CategoryService;
import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig;
import io.github.gjaku1031.kenblog.pages.PagesSnapshotService;
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest;
import io.github.gjaku1031.kenblog.post.service.PostService;
import io.github.gjaku1031.kenblog.post.service.PublicPostService;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/**
 * 대분류·소분류 생성과 소분류 내 공개 문서 탐색의 MySQL 계약
 */
@SpringBootTest
@Import(TestMysqlConfig.class)
@Transactional
final class CategoryHierarchyIntegrationTest {
    /**
     * 분류 저장소
     */
    @Autowired private CategoryService categories;

    /**
     * 시리즈 문서 목록
     */
    @Autowired private PostService posts;

    /**
     * 공개 글 메타데이터 서비스
     */
    @Autowired private PublicPostService publicPosts;

    /**
     * 공개 스냅샷과 분류 revision 조회
     */
    @Autowired private PagesSnapshotService pages;

    /**
     * JDBC 쿼리 실행기
     */
    @Autowired private JdbcTemplate jdbc;

    /**
     * 대분류 재사용과 소분류 생성·깊이 검증
     */
    @Test
    void createsTwoLevelsAndReusesTheirParent() {
        var first = categories.create(" Math / Linear Algebra ");
        var second = categories.create("Math/Probability");
        var root =
                categories.tree().stream()
                        .filter(item -> item.path().equals("math"))
                        .findFirst()
                        .orElseThrow();
        assertEquals(1, root.depth());
        assertEquals(
                List.of(first.id(), second.id()),
                root.children().stream().map(item -> item.id()).toList());
        assertEquals(
                List.of("math/linear-algebra", "math/probability"),
                root.children().stream().map(item -> item.path()).toList());
        assertTrue(
                root.children().stream()
                        .allMatch(item -> item.depth() == 2 && item.children().isEmpty()));
    }

    /**
     * 깊은 경로는 부모 생성 전 거부
     */
    @Test
    void rejectsDeeperPathsBeforeCreatingAnyParent() {
        var before = jdbc.queryForObject("SELECT COUNT(*) FROM categories", Integer.class);
        for (String path : List.of("New/Child/Leaf", "New/Child/Leaf/Fourth"))
            assertThrows(InvalidCategoryRequestException.class, () -> categories.create(path));
        assertEquals(before, jdbc.queryForObject("SELECT COUNT(*) FROM categories", Integer.class));
    }

    /**
     * 소분류 탐색 순서와 초안 제외, 트리에는 초안 건수 포함
     */
    @Test
    void secondLevelNavigationKeepsOrderAndExcludesDrafts() {
        var category = categories.create("Math/Linear Algebra");
        var second = posts.createMetadata(inCategory("두 번째", category.id(), 2));
        var first = posts.createMetadata(inCategory("첫 번째", category.id(), 1));
        posts.createMetadata(inCategory("초안", category.id(), 3));
        posts.setPublished(second.id(), true);
        posts.setPublished(first.id(), true);
        var detail = publicPosts.detailMetadata(second.slug());
        var navigation = Objects.requireNonNull(detail.series());
        assertEquals(2, detail.category().depth());
        assertEquals(category.id(), navigation.id());
        assertEquals(
                List.of(first.id(), second.id()),
                navigation.items().stream().map(item -> item.id()).toList());
        assertEquals(2, navigation.position());
        var root =
                categories.tree().stream()
                        .filter(item -> item.path().equals("math"))
                        .findFirst()
                        .orElseThrow();
        assertEquals(3L, root.totalCount());
        assertEquals(1, root.children().size());
        assertEquals(3L, root.children().getFirst().directCount());
    }

    /**
     * 대분류 글에는 자동 탐색 없음
     */
    @Test
    void topLevelDoesNotCreateAnAutomaticReadingSeries() {
        var root = categories.create("Math");
        var post = posts.createMetadata(inCategory("대분류 글", root.id(), null));
        posts.setPublished(post.id(), true);
        assertNull(publicPosts.detailMetadata(post.slug()).series());
    }

    /**
     * 공개 분류·부모의 이름·순서 보존과 빈 분류 제외·revision 변경
     */
    @Test
    void snapshotIncludesOnlyPublicCategoryPathsAndTracksParentOrder() {
        var child = categories.create("Z First/Child Name");
        categories.create("Private Empty");
        var post = posts.createMetadata(inCategory("분류 스냅샷", child.id(), null));
        posts.setPublished(post.id(), true);
        var snapshot = pages.snapshot();
        var visible = (List<?>) snapshot.get("categories");
        assertEquals(
                List.of("Z First", "Child Name"),
                visible.stream().map(item -> ((Map<?, ?>) item).get("name")).toList());
        assertTrue(visible.stream().allMatch(item -> ((Map<?, ?>) item).containsKey("sortOrder")));
        var parent =
                categories.tree().stream()
                        .filter(item -> item.path().equals("z-first"))
                        .findFirst()
                        .orElseThrow();
        categories.setOrder(parent.id(), 99);
        assertNotEquals(snapshot.get("revision"), pages.snapshot().get("revision"));
    }

    /**
     * 선택 분류·순서 외에는 기본값인 생성 요청
     */
    private PostMetadataCreateRequest inCategory(String title, long categoryId, Integer order) {
        return new PostMetadataCreateRequest(
                title, null, "", categoryId, List.of(), null, order, null, List.of(), List.of());
    }
}
