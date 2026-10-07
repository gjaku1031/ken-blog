package io.github.gjaku1031.kenblog.post.repository;

import io.github.gjaku1031.kenblog.post.domain.ContentStateEntity;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

/**
 * 분류 트리 변경을 직렬화하는 기존 단일 상태 행
 */
public interface ContentStateRepository extends JpaRepository<ContentStateEntity, Byte> {
    /**
     * 형제 재정렬과 루트 생성·삭제의 집합 검증을 직렬화할 ID 1의 잠금 행
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from ContentStateEntity s where s.id = 1")
    ContentStateEntity lockCategoryTree();
}
