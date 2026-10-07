package io.github.gjaku1031.kenblog.category.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.category.domain.*;
import io.github.gjaku1031.kenblog.category.dto.*;
import io.github.gjaku1031.kenblog.category.repository.CategoryRepository;
import io.github.gjaku1031.kenblog.global.text.Text;
import io.github.gjaku1031.kenblog.post.repository.*;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 분류 경로 생성·순서 변경·삭제와 관리자 트리 집계
 */
@Service
@RequiredArgsConstructor
public class CategoryService {
    /**
     * 분류 저장소
     */
    private final CategoryRepository categories;

    /**
     * 게시글 저장소
     */
    private final PostRepository posts;

    /**
     * 콘텐츠 집합 잠금 저장소
     */
    private final ContentStateRepository state;

    /**
     * 게시글 메타데이터 조회기
     */
    private final PostQueries queries;

    /**
     * 분류 표시 이름 패턴
     */
    private static final Pattern DISPLAY_PATTERN =
            Pattern.compile("[\\p{L}\\p{N}]+(?:[ -][\\p{L}\\p{N}]+)*");

    /**
     * 분류 주소 패턴
     */
    private static final Pattern SLUG_PATTERN =
            Pattern.compile("[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*");

    /**
     * 경로의 기존 중간 폴더를 잠가 재사용하고 없는 단계를 한 트랜잭션에서 생성
     *
     * 1. 경로 깊이·이름 정규화
     * 2. 트리 잠금으로 형제 집합 변경 직렬화
     * 3. 기존 중간 분류 재사용, 없는 단계는 형제의 마지막 순서로 생성
     *
     * @param path 슬래시 구분 1~2단계 입력
     * @return 새 마지막 폴더의 {@link CategoryRefResponse}
     * @throws InvalidCategoryRequestException 깊이·이름·기호가 잘못되었을 때
     * @throws CategoryConflictException 마지막 경로 중복 또는 동시 FK·잠금 충돌일 때
     */
    @Transactional
    public CategoryRefResponse create(String path) {
        var segments = normalizePath(path);
        try {
            lockTree();
            CategoryEntity parent = null;
            String currentPath = "";
            // 기존 중간 단계 재사용, 없는 단계는 형제의 마지막 순서로 생성
            for (int index = 0; index < segments.size(); index++) {
                var segment = segments.get(index);
                currentPath = index == 0 ? segment.slug() : currentPath + "/" + segment.slug();
                var existing = categories.findLockedByPath(currentPath);
                if (existing != null) {
                    if (index == segments.size() - 1) throw new CategoryConflictException();
                    parent = existing;
                } else {
                    var siblings = categories.findSiblings(parent == null ? null : parent.getId());
                    if (siblings.stream()
                            .anyMatch(item -> item.getName().equalsIgnoreCase(segment.name())))
                        throw new CategoryConflictException();
                    int last =
                            siblings.stream()
                                    .mapToInt(CategoryEntity::getSortOrder)
                                    .max()
                                    .orElse(0);
                    if (last == Integer.MAX_VALUE) throw new CategoryConflictException();
                    parent =
                            categories.saveAndFlush(
                                    new CategoryEntity(
                                            parent == null ? null : parent.getId(),
                                            currentPath,
                                            segment.name(),
                                            index + 1,
                                            last + 1));
                }
            }
            return CategoryRefResponse.from(Objects.requireNonNull(parent));
        } catch (DataIntegrityViolationException | PessimisticLockingFailureException exception) {
            throw new CategoryConflictException();
        }
    }

    /**
     * 분류 자체와 자손을 잠근 뒤 소속 글을 대상의 부모로 옮기고 자손부터 삭제
     *
     * 글 본문·해시·출간 상태를 변경하지 않으며 실패하면 이동과 삭제가 함께 롤백됨
     *
     * 1. 양수 ID 검사
     * 2. 트리와 삭제할 하위 분류 잠금
     * 3. 소속 글을 삭제 대상의 부모로 이동
     * 4. FK 순서를 지키도록 깊은 자손부터 삭제, 실패 시 함께 롤백
     *
     * @param id 삭제할 양수 분류 ID
     * @throws InvalidCategoryRequestException ID가 양수가 아닐 때
     * @throws CategoryNotFoundException 해당 분류가 없을 때
     * @throws CategoryConflictException 새 자손·참조의 FK 또는 잠금 경합일 때
     */
    @Transactional
    public void delete(long id) {
        if (id <= 0) throw new InvalidCategoryRequestException();
        try {
            lockTree();
            var target = categories.findLockedById(id);
            if (target == null) throw new CategoryNotFoundException();
            var subtree = categories.findSubtreeLocked(target.getPath(), target.getPath() + "/%");
            // 글 이동을 먼저 반영한 뒤 FK 순서에 따라 자손부터 삭제
            posts.moveCategories(
                    subtree.stream().map(CategoryEntity::getId).filter(Objects::nonNull).toList(),
                    target.getParentId());
            categories.flush();
            for (var item :
                    subtree.stream()
                            .sorted(
                                    Comparator.comparingInt(CategoryEntity::getDepth)
                                            .reversed()
                                            .thenComparing(
                                                    CategoryEntity::getId,
                                                    Comparator.reverseOrder()))
                            .toList()) {
                categories.delete(item);
                categories.flush();
            }
        } catch (DataIntegrityViolationException | PessimisticLockingFailureException exception) {
            throw new CategoryConflictException();
        }
    }

    /**
     * 경로·글 연결을 유지하며 같은 부모의 표시 이름 중복을 검사하여 이름 변경
     */
    @Transactional
    public CategoryRefResponse rename(long id, String name) {
        if (id <= 0 || name.contains("/")) throw new InvalidCategoryRequestException();
        String normalized = normalizePath(name).getFirst().name();
        lockTree();
        var category = categories.findLockedById(id);
        if (category == null) throw new CategoryNotFoundException();
        if (categories.findSiblings(category.getParentId()).stream()
                .anyMatch(
                        item ->
                                !Objects.equals(item.getId(), id)
                                        && item.getName().equalsIgnoreCase(normalized)))
            throw new CategoryConflictException();
        category.rename(normalized);
        return CategoryRefResponse.from(categories.saveAndFlush(category));
    }

    /**
     * 트리 잠금 안에서 전체 형제 집합을 대조하고 입력 순서대로 연속 번호 저장
     */
    @Transactional
    public List<CategoryRefResponse> reorder(Long parentId, List<Long> ids) {
        if (parentId != null && parentId <= 0
                || ids.size() > 10_000
                || ids.stream().anyMatch(id -> id <= 0)
                || new HashSet<>(ids).size() != ids.size())
            throw new InvalidCategoryRequestException();
        lockTree();
        if (parentId != null && categories.findLockedById(parentId) == null)
            throw new CategoryNotFoundException();
        var siblings =
                categories.findSiblings(parentId).stream()
                        .collect(Collectors.toMap(CategoryEntity::getId, item -> item));
        if (!siblings.keySet().equals(new HashSet<>(ids))) throw new CategoryConflictException();
        // 부모·소속을 보존하고 형제 순서 전체를 함께 저장
        var ordered = new ArrayList<CategoryEntity>();
        for (int index = 0; index < ids.size(); index++) {
            var item = siblings.get(ids.get(index));
            item.reorder(index + 1);
            ordered.add(item);
        }
        categories.saveAllAndFlush(ordered);
        return ordered.stream().map(CategoryRefResponse::from).toList();
    }

    /**
     * 모든 빈 분류를 보존하고 초안을 포함한 글을 직접/하위 건수에 반영
     *
     * 1. 빈 분류까지 조회하고 직접 글 수 집계
     * 2. 부모별 분류 묶음 구성
     * 3. 최상위부터 자손 건수를 누적한 트리 반환
     *
     * @return 대분류부터 이어지는 {@link CategoryTreeResponse} 목록
     */
    @Transactional(readOnly = true)
    public List<CategoryTreeResponse> tree() {
        var all = categories.findAllByOrderByDepthAscSortOrderAscIdAsc();
        var direct =
                queries.categoryCounts().stream()
                        .collect(
                                Collectors.toMap(
                                        CategoryPostCountRow::categoryId,
                                        CategoryPostCountRow::count));
        // null 부모인 루트도 보존하는 분류 묶음 구성
        var children = new HashMap<Long, List<CategoryEntity>>();
        for (var category : all)
            children.computeIfAbsent(category.getParentId(), key -> new ArrayList<>())
                    .add(category);
        return children.getOrDefault(null, List.of()).stream()
                .map(category -> node(category, children, direct))
                .toList();
    }

    /**
     * 직접 글 수와 자손 글 수를 합산한 분류 노드
     */
    private CategoryTreeResponse node(
            CategoryEntity category,
            Map<Long, List<CategoryEntity>> children,
            Map<Long, Long> direct) {
        var descendants =
                children.getOrDefault(category.getId(), List.of()).stream()
                        .map(child -> node(child, children, direct))
                        .toList();
        long own = direct.getOrDefault(category.getId(), 0L);
        return new CategoryTreeResponse(
                Objects.requireNonNull(category.getId(), "Persisted category has no ID"),
                category.getPath(),
                category.getName(),
                category.getDepth(),
                category.getSortOrder(),
                own,
                own + descendants.stream().mapToLong(CategoryTreeResponse::totalCount).sum(),
                descendants);
    }

    /**
     * 단계별 표시명과 대소문자 비민감 경로 조각을 분리하고 잘못된 기호·제어 문자를 거부
     *
     * 1. 대분류·소분류 1~2단계 입력만 허용
     * 2. 단계별 문자·길이·이름 정규화 후 경로 검사
     *
     * @param rawPath 사용자가 입력한 슬래시 경로
     * @return 순서대로 검증된 1~2단계 조각
     * @throws InvalidCategoryRequestException 단계·길이·문자 계약 위반
     */
    private List<PathSegment> normalizePath(String rawPath) {
        String[] raw = rawPath.split("/", -1);
        if (raw.length < 1 || raw.length > 2) throw new InvalidCategoryRequestException();
        var result = new ArrayList<PathSegment>();
        for (String segment : raw) {
            if (segment.chars().anyMatch(Character::isISOControl))
                throw new InvalidCategoryRequestException();
            String name = Text.trim(segment).replaceAll(" +", " ");
            int count = name.codePointCount(0, name.length());
            if (count < 1 || count > 60 || !DISPLAY_PATTERN.matcher(name).matches())
                throw new InvalidCategoryRequestException();
            String slug = name.toLowerCase(Locale.ROOT).replace(' ', '-');
            if (!SLUG_PATTERN.matcher(slug).matches()) throw new InvalidCategoryRequestException();
            result.add(new PathSegment(name, slug));
        }
        return result;
    }

    /**
     * 표시명과 정규화 경로 조각
     */
    private record PathSegment(
            /**
             * 표시 이름
             */
            String name,

            /**
             * 경로 조각
             */
            String slug) {}

    /**
     * 형제 집합 검증에 사용할 전역 잠금 행을 먼저 취득
     */
    private void lockTree() {
        if (state.lockCategoryTree() == null)
            throw new IllegalStateException("Missing content state row");
    }
}
