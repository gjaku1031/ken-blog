package io.github.gjaku1031.kenblog.post.dto;

import java.util.List;

/**
 * 관리자 부분 제목 검색과 동일 입력의 정확한 위키 해석
 */
public record WikiTitleSearchResponse(
        /**
         * 조회 결과 목록
         */
        List<WikiNavigationItem> items,

        /**
         * 제목 정확 일치 결과
         */
        WikiLinkResult exact) {}
