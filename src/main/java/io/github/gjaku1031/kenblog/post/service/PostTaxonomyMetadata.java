package io.github.gjaku1031.kenblog.post.service;

import io.github.gjaku1031.kenblog.category.dto.*;
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository;
import io.github.gjaku1031.kenblog.post.dto.*;
import io.github.gjaku1031.kenblog.post.repository.*;

import org.springframework.stereotype.Component;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 본문 없는 페이지에 분류·태그를 고정된 두 SQL로 결합
 */
@Component
public final class PostTaxonomyMetadata {
    /**
     * 분류 저장소
     */
    private final CategoryRepository categories;

    /**
     * 게시글 태그 저장소
     */
    private final PostTagRepository tags;

    /**
     * 의존성 초기화
     */
    public PostTaxonomyMetadata(CategoryRepository categories, PostTagRepository tags) {
        this.categories = categories;
        this.tags = tags;
    }

    /**
     * 같은 인덱스의 글 ID·분류 ID를 일괄 조회하고 태그 순서 유지
     *
     * 1. 입력 길이 대조, 빈 페이지는 조회 없이 종료
     * 2. 분류·태그 일괄 조회
     * 3. 글 ID별 메타데이터 조립
     *
     * @param postIds 페이지 게시글 ID
     * @param categoryIds 각 글에 연결된 nullable 분류 ID
     * @return 게시글 ID별 분류 참조와 태그 이름
     */
    public Map<Long, PostTaxonomyView> batch(List<Long> postIds, List<Long> categoryIds) {
        if (postIds.size() != categoryIds.size())
            throw new IllegalStateException("Post taxonomy page IDs must align");
        if (postIds.isEmpty()) return Map.of();
        // 분류와 태그를 페이지 단위로 각각 일괄 조회
        var categoryMap =
                categories
                        .findAllById(
                                categoryIds.stream().filter(Objects::nonNull).distinct().toList())
                        .stream()
                        .collect(
                                Collectors.toMap(
                                        entity ->
                                                Objects.requireNonNull(
                                                        entity.getId(),
                                                        "Persisted category has no ID"),
                                        CategoryRefResponse::from));
        var tagMap =
                tags.findRowsByPostIds(postIds).stream()
                        .collect(
                                Collectors.groupingBy(
                                        PostTagRow::postId,
                                        Collectors.mapping(PostTagRow::name, Collectors.toList())));
        // nullable 분류 ID를 포함하여 같은 인덱스의 입력끼리 결합
        var result = new LinkedHashMap<Long, PostTaxonomyView>();
        for (int index = 0; index < postIds.size(); index++) {
            long id = postIds.get(index);
            result.put(
                    id,
                    new PostTaxonomyView(
                            categoryMap.get(categoryIds.get(index)),
                            tagMap.getOrDefault(id, List.of())));
        }
        return result;
    }

    /**
     * 단일 글도 같은 일괄 조회 계약 적용
     */
    public PostTaxonomyView one(long postId, Long categoryId) {
        return batch(List.of(postId), Collections.singletonList(categoryId)).get(postId);
    }
}
