package io.github.gjaku1031.kenblog.post.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.post.domain.*;
import io.github.gjaku1031.kenblog.post.dto.*;
import io.github.gjaku1031.kenblog.post.repository.*;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.IntStream;

/**
 * 관리자 선언 위키 대상 제목을 트랜잭션에서 관리
 */
@Service
@RequiredArgsConstructor
public class WikiLinkMetadata {
    /**
     * 위키 선언 저장소
     */
    private final PostWikiLinkRepository posts;

    /**
     * 저장 순서의 대상 제목
     */
    @Transactional(readOnly = true)
    public List<String> postTitles(long postId) {
        return posts.findTitles(postId);
    }

    /**
     * 부모 글을 잠근 트랜잭션에서 검증 후 기존 선언 전체 교체
     */
    @Transactional
    public void replacePost(long postId, List<String> titles) {
        var normalized = WikiDeclarations.normalized(titles);
        posts.deleteByPostId(postId);
        if (!normalized.isEmpty())
            posts.saveAllAndFlush(
                    IntStream.range(0, normalized.size())
                            .mapToObj(
                                    index ->
                                            new PostWikiLinkEntity(
                                                    postId, index, normalized.get(index)))
                            .toList());
    }
}
