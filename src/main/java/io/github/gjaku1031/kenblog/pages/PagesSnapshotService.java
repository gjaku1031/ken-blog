package io.github.gjaku1031.kenblog.pages;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.category.repository.CategoryRepository;
import io.github.gjaku1031.kenblog.post.repository.PostQueries;
import io.github.gjaku1031.kenblog.post.service.PublicPostService;
import io.github.gjaku1031.kenblog.series.service.SeriesService;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

/**
 * 동일 MySQL 일관 읽기의 공개 메타데이터와 첨부 revision 생성
 */
@Service
@RequiredArgsConstructor
public class PagesSnapshotService {
    /**
     * 공개 글 메타데이터 서비스
     */
    private final PublicPostService posts;

    /**
     * 시리즈 서비스
     */
    private final SeriesService series;

    /**
     * 게시글 메타데이터 조회기
     */
    private final PostQueries queries;

    /**
     * 공개 분류 표시 이름·순서 조회
     */
    private final CategoryRepository categories;

    /**
     * JSON 직렬화기
     */
    private final ObjectMapper mapper;

    /**
     * 전체 공개 행·분류·태그·탐색 일괄 구성 후 메타데이터·첨부 상태 revision 계산
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<String, Object> snapshot() {
        var source = queries.snapshotRows(true);
        var rows = posts.batch(source);
        // 공개 글에서 사용한 분류와 부모만 포함
        var paths = new HashSet<String>();
        for (var row : rows)
            if (row.category() != null) {
                String path = row.category().path();
                paths.add(path);
                paths.add(path.split("/", 2)[0]);
            }
        var publicCategories =
                categories.findAllByOrderByDepthAscSortOrderAscIdAsc().stream()
                        .filter(entity -> paths.contains(entity.getPath()))
                        .map(
                                entity ->
                                        orderedMap(
                                                "id",
                                                entity.getId(),
                                                "path",
                                                entity.getPath(),
                                                "name",
                                                entity.getName(),
                                                "depth",
                                                entity.getDepth(),
                                                "sortOrder",
                                                entity.getSortOrder()))
                        .toList();
        // 탐색 목록을 그룹마다 한 번만 직렬화하여 이차 크기 증가 방지
        var navigation = new LinkedHashMap<String, Object>();
        var compact = new ArrayList<Map<String, Object>>();
        for (var row : rows) {
            Map<String, Object> group = null;
            var ref = row.series();
            if (ref != null) {
                navigation.putIfAbsent(ref.slug(), ref.items());
                group =
                        orderedMap(
                                "id",
                                ref.id(),
                                "slug",
                                ref.slug(),
                                "name",
                                ref.name(),
                                "kind",
                                ref.kind(),
                                "position",
                                ref.position(),
                                "navigationKey",
                                ref.slug());
            }
            compact.add(
                    orderedMap(
                            "id",
                            row.id(),
                            "title",
                            row.title(),
                            "slug",
                            row.slug(),
                            "summary",
                            row.summary(),
                            "publishedDate",
                            row.publishedDate(),
                            "section",
                            row.section(),
                            "category",
                            row.category(),
                            "tags",
                            row.tags(),
                            "series",
                            group,
                            "relatedSeries",
                            row.relatedSeries(),
                            "legacyPath",
                            row.legacyPath(),
                            "publishedAt",
                            row.publishedAt()));
        }
        var payload =
                orderedMap(
                        "version",
                        3,
                        "posts",
                        compact,
                        "navigation",
                        navigation,
                        "series",
                        series.publicSnapshot(source),
                        "categories",
                        publicCategories);
        // Git 원고를 제외한 메타데이터와 첨부 상태만 해시
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = mapper.writeValueAsBytes(payload);
            if (bytes.length > 7_999_800)
                throw new IllegalStateException("Public snapshot exceeds capture limit");
            digest.update(bytes);
            digest.update((byte) 0);
            for (String revision : queries.attachmentRevisions()) {
                digest.update(revision.getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
            }
            payload.put("revision", HexFormat.of().formatHex(digest.digest()));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", exception);
        }
        return payload;
    }

    /**
     * null 값을 보존하고 지정한 키 순서대로 응답 맵 구성
     */
    private Map<String, Object> orderedMap(Object... pairs) {
        var result = new LinkedHashMap<String, Object>();
        for (int index = 0; index < pairs.length; index += 2)
            result.put((String) pairs[index], pairs[index + 1]);
        return result;
    }
}
