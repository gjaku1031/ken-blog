package io.github.gjaku1031.kenblog.post.repository;

import io.github.gjaku1031.kenblog.post.domain.PostWikiLinkEntity;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

/**
 * 잠근 게시글의 명시적 제목 참조를 읽고 전체 교체하는 JPA 저장소
 */
public interface PostWikiLinkRepository extends JpaRepository<PostWikiLinkEntity, Long> {
    /**
     * 본문을 읽지 않은 선언 순서의 대상 제목
     */
    @Query(
            "select w.targetTitle from PostWikiLinkEntity w where w.postId = :postId order by"
                + " w.position")
    List<String> findTitles(@Param("postId") long postId);

    /**
     * 글에 속했던 선언을 교체하기 위해 제거한 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query("delete from PostWikiLinkEntity w where w.postId = :postId")
    int deleteByPostId(@Param("postId") long postId);
}
