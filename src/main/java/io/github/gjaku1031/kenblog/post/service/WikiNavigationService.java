package io.github.gjaku1031.kenblog.post.service;

import lombok.RequiredArgsConstructor;

import io.github.gjaku1031.kenblog.global.text.Text;
import io.github.gjaku1031.kenblog.post.domain.*;
import io.github.gjaku1031.kenblog.post.dto.*;
import io.github.gjaku1031.kenblog.post.repository.*;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 본문 없는 공개 제목 대표 검색을 수행하는 관리자 서비스
 */
@Service
@RequiredArgsConstructor
public class WikiNavigationService {
    /**
     * 게시글 메타데이터 조회기
     */
    private final PostQueries posts;

    /**
     * ADMIN 입력의 실제 부분 문자열 후보와 동일 제목 정확 해석을 본문 없이 반환
     *
     * 1. 제목 길이와 코드 포인트 검사
     * 2. 정확 일치의 대표 공개 글 또는 미존재 결과 구성
     * 3. 부분 제목 후보와 정확 일치 결과를 함께 반환
     *
     * @throws InvalidWikiLinkRequestException 길이·제어 문자가 잘못됐을 때
     */
    @Transactional(readOnly = true)
    public WikiTitleSearchResponse titleSearch(String raw) {
        if (raw == null) throw new InvalidWikiLinkRequestException();
        String query = Text.trim(raw);
        int count = query.codePointCount(0, query.length());
        if (count < 1 || count > 200) throw new InvalidWikiLinkRequestException();
        for (int offset = 0; offset < query.length(); ) {
            int point = query.codePointAt(offset);
            if (Character.isISOControl(point)
                    || point == 0x2028
                    || point == 0x2029
                    || point >= 0xD800 && point <= 0xDFFF)
                throw new InvalidWikiLinkRequestException();
            offset += Character.charCount(point);
        }
        // 정확 일치 대표와 부분 제목 후보를 같은 읽기 트랜잭션에서 조회
        var row = posts.wikiTarget(query);
        WikiLinkResult exact =
                row == null
                        ? new WikiLinkMissing(query)
                        : new WikiLinkReadable(
                                query,
                                row.id(),
                                row.title(),
                                row.slug(),
                                row.series() == null ? "TECH" : row.series().kind().name(),
                                row.series() == null ? null : row.series().slug());
        return new WikiTitleSearchResponse(
                posts.titleSearch(query).stream().map(PostRow::navigationItem).toList(), exact);
    }
}
