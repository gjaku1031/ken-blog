package io.github.gjaku1031.kenblog.stack.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.attachment.storage.LocalAssetStorage;
import io.github.gjaku1031.kenblog.global.error.BusinessException;
import io.github.gjaku1031.kenblog.global.text.Text;
import io.github.gjaku1031.kenblog.series.domain.SeriesKind;
import io.github.gjaku1031.kenblog.series.repository.SeriesRepository;
import io.github.gjaku1031.kenblog.stack.domain.*;
import io.github.gjaku1031.kenblog.stack.dto.StackBadgeResponse;
import io.github.gjaku1031.kenblog.stack.repository.*;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.util.*;
import java.util.stream.*;

/**
 * 로컬 아이콘 조회와 프로젝트 기술 선택 관리
 */
@Service
@RequiredArgsConstructor
public class StackBadgeService {
    /**
     * 기술 뱃지 저장소
     */
    private final StackBadgeRepository badges;

    /**
     * 시리즈·기술 연결 저장소
     */
    private final SeriesStackBadgeRepository links;

    /**
     * 시리즈 저장소
     */
    private final SeriesRepository projects;

    /**
     * 로컬 이미지 저장소
     */
    private final LocalAssetStorage storage;

    /**
     * 등록 ID 순서의 관리자 기술 목록
     */
    @Transactional(readOnly = true)
    public List<StackBadgeResponse> listAdmin() {
        return badges.findAll().stream()
                .sorted(
                        Comparator.comparing(
                                StackBadgeEntity::getId,
                                Comparator.nullsLast(Comparator.naturalOrder())))
                .map(this::response)
                .toList();
    }

    /**
     * 시리즈 선택 순서의 기술 목록
     */
    @Transactional(readOnly = true)
    public List<StackBadgeResponse> listForSeries(long seriesId) {
        return links.findByIdSeriesIdOrderBySortOrder(seriesId).stream()
                .map(link -> badges.findById(link.getId().getBadgeId()).orElse(null))
                .filter(Objects::nonNull)
                .map(this::response)
                .toList();
    }

    /**
     * 두 조회로 시리즈별 기술 선택 순서를 보존한 스냅샷 구성
     */
    public Map<Long, List<StackBadgeResponse>> batchForSeries() {
        var catalog =
                badges.findAll().stream()
                        .collect(
                                Collectors.toMap(
                                        entity ->
                                                Objects.requireNonNull(
                                                        entity.getId(),
                                                        "Persisted badge has no ID"),
                                        this::response));
        var result = new HashMap<Long, List<StackBadgeResponse>>();
        for (var link :
                links.findAll().stream()
                        .sorted(Comparator.comparingInt(SeriesStackBadgeEntity::getSortOrder))
                        .toList()) {
            var selected =
                    result.computeIfAbsent(link.getId().getSeriesId(), key -> new ArrayList<>());
            var badge = catalog.get(link.getId().getBadgeId());
            if (badge != null) selected.add(badge);
        }
        return result;
    }

    /**
     * 프로젝트 대문의 이름 배열을 등록된 ID 연결로 교체
     *
     * 1. 프로젝트 존재·종류·기술 수 상한 확인
     * 2. 이름별 등록 기술 조회 후 중복 검사
     * 3. 기존 선택 삭제 후 입력 순서로 연결 저장
     *
     * @throws BusinessException 없는 프로젝트나 등록되지 않은 이름·중복 입력일 때
     */
    @Transactional
    public void replaceSeriesStack(long seriesId, List<String> names) {
        var project = seriesId <= 0 ? null : projects.findById(seriesId).orElse(null);
        if (project == null || project.getKind() != SeriesKind.PROJECT || names.size() > 30)
            throw badInput();
        // 모든 기술을 검증한 뒤 기존 선택 삭제
        var selected = new ArrayList<StackBadgeEntity>();
        for (String name : names) {
            var badge = badges.findByNameKey(nameKey(name));
            if (badge == null) throw badInput();
            selected.add(badge);
        }
        if (selected.stream().map(StackBadgeEntity::getId).distinct().count() != selected.size())
            throw badInput();
        links.deleteByIdSeriesId(seriesId);
        links.flush();
        links.saveAllAndFlush(
                IntStream.range(0, selected.size())
                        .mapToObj(
                                index ->
                                        new SeriesStackBadgeEntity(
                                                seriesId,
                                                Objects.requireNonNull(
                                                        selected.get(index).getId(),
                                                        "Persisted badge has no ID"),
                                                index))
                        .toList());
    }

    /**
     * 등록 뱃지의 공개 PNG 스트림, 호출자가 닫아야 함
     */
    @Transactional(readOnly = true)
    public InputStream openImage(long id) {
        return storage.open(badge(id).getObjectKey());
    }

    /**
     * 내부 저장 키를 제외한 이름·공개 URL
     */
    private StackBadgeResponse response(StackBadgeEntity entity) {
        long id = Objects.requireNonNull(entity.getId(), "Persisted badge has no ID");
        return new StackBadgeResponse(
                id,
                entity.getName(),
                "/api/v1/stack-badges/" + id + "/image?v=" + entity.getUpdatedAt());
    }

    /**
     * 등록 기술 조회
     *
     * @return 등록된 기술 엔티티
     * @throws BusinessException 양수 ID가 아니거나 등록 기술이 없을 때 HTTP 404
     */
    private StackBadgeEntity badge(long id) {
        var result = id > 0 ? badges.findById(id).orElse(null) : null;
        if (result == null) throw new BusinessException(HttpStatus.NOT_FOUND, "기술 뱃지를 찾을 수 없습니다.");
        return result;
    }

    /**
     * 길이·제어 문자 검증 후 중복 비교용 ROOT 소문자 이름
     */
    private String nameKey(String value) {
        String name = Text.trim(value);
        if (Text.isBlank(name)
                || name.length() > 100
                || name.chars().anyMatch(Character::isISOControl)) throw badInput();
        return name.toLowerCase(Locale.ROOT);
    }

    /**
     * 기술 뱃지 입력 오류 객체 생성
     *
     * @return 기술 뱃지 입력이 규칙을 벗어났을 때 호출자가 던질 HTTP 400용 예외
     */
    private BusinessException badInput() {
        return new BusinessException(HttpStatus.BAD_REQUEST, "기술 뱃지 입력을 확인하세요.");
    }
}
