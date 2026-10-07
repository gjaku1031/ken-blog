package io.github.gjaku1031.kenblog.stack.repository;

import io.github.gjaku1031.kenblog.stack.domain.StackBadgeEntity;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * {@code StackBadgeEntity}의 등록 목록·ID·대소문자 무시 키 조회
 */
public interface StackBadgeRepository extends JpaRepository<StackBadgeEntity, Long> {
    /**
     * 정규화된 이름과 일치하는 뱃지 또는 {@code null}.
     */
    StackBadgeEntity findByNameKey(String nameKey);
}
