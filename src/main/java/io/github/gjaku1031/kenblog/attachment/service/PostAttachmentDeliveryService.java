package io.github.gjaku1031.kenblog.attachment.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.attachment.domain.*;
import io.github.gjaku1031.kenblog.attachment.storage.LocalAssetStorage;
import io.github.gjaku1031.kenblog.post.repository.PostQueries;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 공개 권한·연결 확인 뒤 DB 트랜잭션 밖에서 파일 열기
 */
@Service
@RequiredArgsConstructor
public final class PostAttachmentDeliveryService {
    /**
     * 게시글 메타데이터 조회기
     */
    private final PostQueries queries;

    /**
     * 로컬 이미지 저장소
     */
    private final LocalAssetStorage storage;

    /**
     * 권한·행 부재는 같은 404, 저장소 실패는 503; 이미 시작한 전송은 소급 취소하지 않음
     */
    public PostAttachmentContent open(long postId, long attachmentId) {
        if (postId <= 0 || attachmentId <= 0) throw notFound();
        var row = queries.readableAttachment(postId, attachmentId);
        if (row == null) throw notFound();
        if (!List.of("image/png", "image/jpeg").contains(row.contentType())
                || row.byteSize() < 1
                || row.byteSize() > 10L * 1024 * 1024)
            throw new AttachmentFailure(HttpStatus.SERVICE_UNAVAILABLE, "첨부 정보를 확인할 수 없습니다.");
        storage.requireConfigured();
        return new PostAttachmentContent(
                row.contentType(), row.byteSize(), storage.open(row.objectKey(), row.byteSize()));
    }

    /**
     * 첨부 미존재 오류 객체 생성
     *
     * @return 글·연결·첨부의 부재를 구분하지 않는 HTTP 404용 예외
     */
    private AttachmentFailure notFound() {
        return new AttachmentFailure(HttpStatus.NOT_FOUND, "이미지를 찾을 수 없습니다.");
    }
}
