package io.github.gjaku1031.kenblog.post.repository;

import io.github.gjaku1031.kenblog.post.domain.PostBodyEntity;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;

/**
 * 공개하지 않은 글의 DB 본문 조회
 */
public interface PostBodyRepository extends JpaRepository<PostBodyEntity, Long> {
    /**
     * 본문을 읽지 않고 수정 시각만 조회, 행이 없으면 null
     */
    @Query("select b.updatedAt from PostBodyEntity b where b.postId = :postId")
    LocalDateTime findUpdatedAtByPostId(@Param("postId") long postId);
}
