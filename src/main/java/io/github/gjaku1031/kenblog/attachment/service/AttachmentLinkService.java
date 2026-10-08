package io.github.gjaku1031.kenblog.attachment.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.attachment.domain.*;
import io.github.gjaku1031.kenblog.attachment.repository.PostAttachmentRepository;
import io.github.gjaku1031.kenblog.post.repository.PostQueries;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 부모 글 잠금 뒤 첨부를 ID 순서로 잠가 이미지 권한 선언 교체
 */
@Service
@RequiredArgsConstructor
public class AttachmentLinkService {
    /**
     * 게시글 메타데이터 조회기
     */
    private final PostQueries queries;

    /**
     * 게시글·첨부 연결 저장소
     */
    private final PostAttachmentRepository posts;

    /**
     * 글에 선언된 첨부 ID 오름차순 목록
     */
    @Transactional(readOnly = true)
    public List<Long> postIds(long postId) {
        return posts.findIdsByPostId(postId);
    }

    /**
     * 잠근 글의 연결을 전부 교체
     * 빈 목록은 해제이며 실패 시 원본 글 변경까지 롤백됨
     *
     * @throws AttachmentFailure 없는 ID면 404
     */
    @Transactional
    public void replacePost(long postId, List<Long> ids) {
        // 중복 제거·정렬로 잠금 순서 고정; 검증 완료 전 기존 연결 보존
        var normalized = ids.stream().distinct().sorted().toList();
        for (long id : normalized) {
            if (!queries.lockAttachment(id))
                throw new AttachmentFailure(HttpStatus.NOT_FOUND, "첨부를 찾을 수 없습니다.");
        }
        // 빈 목록은 기존 연결 해제만 수행
        posts.deleteByPostId(postId);
        if (!normalized.isEmpty())
            posts.saveAllAndFlush(
                    normalized.stream().map(id -> new PostAttachmentEntity(postId, id)).toList());
    }
}
