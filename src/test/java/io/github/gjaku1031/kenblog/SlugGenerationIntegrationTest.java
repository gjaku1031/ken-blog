package io.github.gjaku1031.kenblog;

import static org.junit.jupiter.api.Assertions.*;

import io.github.gjaku1031.kenblog.fixture.TestMysqlConfig;
import io.github.gjaku1031.kenblog.post.domain.InvalidPostRequestException;
import io.github.gjaku1031.kenblog.post.dto.PostMetadataCreateRequest;
import io.github.gjaku1031.kenblog.post.service.PostService;
import io.github.gjaku1031.kenblog.series.domain.InvalidSeriesRequestException;
import io.github.gjaku1031.kenblog.series.dto.SeriesRequests;
import io.github.gjaku1031.kenblog.series.service.SeriesService;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.ObjectMapper;

import java.util.*;
import java.util.UUID;

/**
 * 브라우저의 주소 없는 생성 요청과 기존 에이전트의 명시 주소를 실제 MySQL에서 검증
 */
@SpringBootTest
@Import(TestMysqlConfig.class)
@Transactional
final class SlugGenerationIntegrationTest {
    /**
     * 시리즈 문서 목록
     */
    @Autowired private PostService posts;

    /**
     * 시리즈 저장소
     */
    @Autowired private SeriesService series;

    /**
     * JSON 직렬화기
     */
    @Autowired private ObjectMapper mapper;

    /**
     * 생략한 글 주소의 고유성·재조회 안정성
     */
    @Test
    void postsWithoutSlugReceiveDistinctStableAddresses() {
        var request = PostMetadataCreateRequest.fromJson(mapper.readTree("{\"title\":\"같은 제목\"}"));
        var first = posts.createMetadata(request);
        var second = posts.createMetadata(request);
        assertGenerated(first.slug(), "post");
        assertGenerated(second.slug(), "post");
        assertNotEquals(first.slug(), second.slug());
        assertEquals(first.slug(), posts.adminMetadata(first.id()).slug());
        assertEquals(second.slug(), posts.adminMetadata(second.id()).slug());
    }

    /**
     * 일반 시리즈·프로젝트의 자동 주소 고유성과 문서 연결
     */
    @Test
    void bothSeriesKindsReceiveUniqueAddressesWhenOmitted() {
        String[][] cases = {
            {"TECH", "series", "{\"name\":\"같은 시리즈\"}"},
            {
                "PROJECT",
                "project",
                "{\"name\":\"같은 프로젝트\",\"projectStatus\":\"PLAN\",\"startPeriod\":\"2026.10\"}"
            }
        };
        for (String[] entry : cases) {
            var request =
                    SeriesRequests.create(
                            mapper.readTree(
                                    "{\"kind\":\""
                                            + entry[0]
                                            + "\",\"metadata\":"
                                            + entry[2]
                                            + "}"));
            var first = series.create(request);
            var second = series.create(request);
            assertGenerated(first.slug(), entry[1]);
            assertGenerated(second.slug(), entry[1]);
            assertNotEquals(first.slug(), second.slug());
            assertEquals(first.slug(), series.detail(first.id()).series().slug());
            var post =
                    posts.createMetadata(
                            new PostMetadataCreateRequest(
                                    "첫 문서",
                                    null,
                                    "",
                                    null,
                                    List.of(),
                                    first.id(),
                                    1,
                                    null,
                                    List.of(),
                                    List.of()));
            assertEquals(first.id(), post.series().id());
            assertEquals(1, series.detail(first.id()).posts().size());
            assertEquals(post.id(), series.detail(first.id()).posts().getFirst().id());
        }
    }

    /**
     * 명시 주소 정규화·보존
     */
    @Test
    void explicitAddressesRemainSupportedAndNormalized() {
        var post =
                posts.createMetadata(
                        PostMetadataCreateRequest.fromJson(
                                mapper.readTree(
                                        "{\"title\":\"기존 방식\",\"slug\":\"  LEGACY-POST  \"}")));
        var group =
                series.create(
                        SeriesRequests.create(
                                mapper.readTree(
                                        "{\"slug\":\"  LEGACY-SERIES "
                                            + " \",\"kind\":\"TECH\",\"metadata\":{\"name\":\"기존"
                                            + " 방식\"}}")));
        assertEquals("legacy-post", post.slug());
        assertEquals("legacy-series", group.slug());
    }

    /**
     * 잘못된 명시 주소와 알 수 없는 입력 거부
     */
    @Test
    void suppliedInvalidAddressesAndUnknownFieldsAreStillRejected() {
        for (String slug : List.of("42", "true", "[]", "{}", "\"\"", "\"invalid slug\"")) {
            assertThrows(
                    InvalidPostRequestException.class,
                    () ->
                            posts.createMetadata(
                                    PostMetadataCreateRequest.fromJson(
                                            mapper.readTree(
                                                    "{\"title\":\"잘못된 주소\",\"slug\":"
                                                            + slug
                                                            + "}"))));
            assertThrows(
                    InvalidSeriesRequestException.class,
                    () ->
                            series.create(
                                    SeriesRequests.create(
                                            mapper.readTree(
                                                    "{\"kind\":\"TECH\",\"metadata\":{\"name\":\"잘못된"
                                                        + " 주소\"},\"slug\":"
                                                            + slug
                                                            + "}"))));
        }
        assertThrows(
                InvalidSeriesRequestException.class,
                () ->
                        SeriesRequests.create(
                                mapper.readTree(
                                        "{\"kind\":\"TECH\",\"metadata\":{\"name\":\"제목\"},\"unknown\":true}")));
    }

    /**
     * 자동 주소의 접두사·UUID 형식 검증
     */
    private void assertGenerated(String slug, String prefix) {
        assertTrue(slug.startsWith(prefix + "-"));
        String suffix = slug.substring(prefix.length() + 1);
        assertEquals(suffix, UUID.fromString(suffix).toString());
    }
}
