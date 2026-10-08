package io.github.gjaku1031.kenblog.post.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.post.domain.*;
import io.github.gjaku1031.kenblog.post.dto.*;
import io.github.gjaku1031.kenblog.post.repository.*;
import io.github.gjaku1031.kenblog.series.domain.SeriesKind;

import org.springframework.stereotype.Service;

import java.time.*;
import java.util.*;
import java.util.stream.IntStream;

/**
 * Pages용 공개 글 메타데이터와 시리즈·분류 내 문서 탐색
 */
@Service
@RequiredArgsConstructor
public class PublicPostService {
    /**
     * 분류·태그 조회기
     */
    private final PostTaxonomyMetadata taxonomy;

    /**
     * 같은 읽기 트랜잭션의 전체 행에서 분류·태그·문서 탐색 일괄 구성
     */
    public List<PublicPostDetailResponse> batch(List<PostRow> rows) {
        var metadata =
                taxonomy.batch(
                        rows.stream().map(PostRow::id).toList(),
                        rows.stream().map(PostRow::categoryId).toList());
        var ordered =
                rows.stream()
                        .sorted(
                                Comparator.comparing(
                                                PostRow::seriesOrder,
                                                Comparator.nullsLast(Comparator.naturalOrder()))
                                        .thenComparing(
                                                PostRow::publishedAt,
                                                Comparator.nullsLast(Comparator.naturalOrder()))
                                        .thenComparingLong(PostRow::id))
                        .toList();
        var seriesGroups = new HashMap<Long, List<PostRow>>();
        var categoryGroups = new HashMap<Long, List<PostRow>>();
        for (var row : ordered) {
            if (row.series() != null)
                seriesGroups.computeIfAbsent(row.series().id(), key -> new ArrayList<>()).add(row);
            if (row.series() == null || row.series().kind() == SeriesKind.TECH)
                categoryGroups.computeIfAbsent(row.categoryId(), key -> new ArrayList<>()).add(row);
        }
        // 탐색 목록과 위치를 그룹마다 한 번씩 계산하여 이차 크기 증가 방지
        var seriesItems = new HashMap<Long, List<PostSeriesItem>>();
        var categoryItems = new HashMap<Long, List<PostSeriesItem>>();
        var positions = new HashMap<Long, Integer>();
        var categoryPositions = new HashMap<Long, Integer>();
        seriesGroups.forEach((id, siblings) -> seriesItems.put(id, items(siblings)));
        categoryGroups.forEach((id, siblings) -> categoryItems.put(id, items(siblings)));
        seriesItems
                .values()
                .forEach(group -> group.forEach(item -> positions.put(item.id(), item.order())));
        categoryItems
                .values()
                .forEach(
                        group ->
                                group.forEach(
                                        item -> categoryPositions.put(item.id(), item.order())));
        return rows.stream()
                .map(
                        row -> {
                            var view = metadata.get(row.id());
                            var category = view.category();
                            PostSeriesResponse navigation = null;
                            if (row.series() != null) {
                                var ref = row.series();
                                navigation =
                                        new PostSeriesResponse(
                                                ref.id(),
                                                ref.slug(),
                                                ref.name(),
                                                ref.kind(),
                                                seriesItems.get(ref.id()),
                                                positions.get(row.id()));
                            } else if (category != null && category.depth() == 2) {
                                navigation =
                                        new PostSeriesResponse(
                                                category.id(),
                                                category.path(),
                                                category.name(),
                                                SeriesKind.TECH,
                                                categoryItems.get(category.id()),
                                                categoryPositions.get(row.id()));
                            }
                            var siblings =
                                    row.relatedSeriesId() == null
                                            ? null
                                            : seriesGroups.get(row.relatedSeriesId());
                            var related =
                                    siblings == null || siblings.isEmpty()
                                            ? null
                                            : siblings.getFirst().series();
                            if (related != null && related.kind() != SeriesKind.PROJECT)
                                related = null;
                            return response(row, view, navigation, related);
                        })
                .toList();
    }

    /**
     * 1 기반 표시 순서로 이동 정보 구성
     */
    private List<PostSeriesItem> items(List<PostRow> rows) {
        return IntStream.range(0, rows.size())
                .mapToObj(
                        index -> {
                            var row = rows.get(index);
                            return new PostSeriesItem(row.id(), row.slug(), row.title(), index + 1);
                        })
                .toList();
    }

    /**
     * UTC 출간 시각의 한국 날짜와 공개 메타데이터 응답 조립
     */
    private PublicPostDetailResponse response(
            PostRow row, PostTaxonomyView view, PostSeriesResponse navigation, SeriesRef related) {
        var date =
                Objects.requireNonNull(row.publishedAt())
                        .atZone(ZoneOffset.UTC)
                        .withZoneSameInstant(ZoneId.of("Asia/Seoul"))
                        .toLocalDate();
        return new PublicPostDetailResponse(
                row.id(),
                row.title(),
                row.slug(),
                row.summary(),
                date,
                row.series() == null ? SeriesKind.TECH : row.series().kind(),
                view.category(),
                view.tags(),
                navigation,
                related,
                row.legacyPath(),
                row.publishedAt());
    }
}
