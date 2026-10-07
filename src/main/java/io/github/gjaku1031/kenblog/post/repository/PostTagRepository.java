package io.github.gjaku1031.kenblog.post.repository;

import io.github.gjaku1031.kenblog.post.domain.PostTagEntity;
import io.github.gjaku1031.kenblog.post.dto.PostTagRow;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

/**
 * 게시글 태그 저장·일괄 조회·전체 교체
 */
public interface PostTagRepository extends JpaRepository<PostTagEntity, Long> {
    /**
     * {@code PostTagEntity.displayName}의 입력 대소문자를 보존한 0 기반 순서 태그 이름
     */
    @Query(
            "select t.displayName from PostTagEntity t where t.postId = :postId order by t.position"
                + " asc")
    List<String> findNamesByPostId(@Param("postId") long postId);

    /**
     * 페이지 전체 글의 태그를 본문 없이 한 번에 조회한 {@code PostTagRow} 목록
     */
    @Query(
            "select new io.github.gjaku1031.kenblog.post.dto.PostTagRow(t.postId, t.position,"
                + " t.displayName) from PostTagEntity t where t.postId in :postIds order by"
                + " t.postId asc, t.position asc")
    List<PostTagRow> findRowsByPostIds(@Param("postIds") Collection<Long> postIds);

    /**
     * 잠근 글의 기존 태그를 전체 교체하기 위해 지운 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query("delete from PostTagEntity t where t.postId = :postId")
    int deleteByPostId(@Param("postId") long postId);
}
