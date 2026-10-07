package io.github.gjaku1031.kenblog.fixture;

import io.github.gjaku1031.kenblog.global.text.Text;

import org.jooq.*;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * JPA 통계와 분리된 jOOQ SELECT 횟수
 */
public final class SelectCounter implements ExecuteListener {
    /**
     * 실행한 SELECT 수
     */
    private final AtomicInteger count = new AtomicInteger();

    /**
     * 초기화·조회용 계수
     */
    public AtomicInteger getCount() {
        return count;
    }

    /**
     * 실제 DB에 전달하는 조회문만 집계
     */
    @Override
    public void executeStart(ExecuteContext context) {
        String sql = context.sql();
        if (sql != null && Text.trim(sql).regionMatches(true, 0, "select", 0, 6))
            count.incrementAndGet();
    }
}
