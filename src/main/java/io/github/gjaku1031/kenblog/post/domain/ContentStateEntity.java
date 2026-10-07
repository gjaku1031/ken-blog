package io.github.gjaku1031.kenblog.post.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * 분류 트리 변경을 직렬화하는 기존 단일 DB 잠금 행
 */
@Entity
@Table(name = "content_state")
public class ContentStateEntity {
    /**
     * JPA 인스턴스 초기화
     */
    protected ContentStateEntity() {}

    /**
     * ID
     */
    @Id private byte id = 1;

    /**
     * id 조회
     */
    public byte getId() {
        return id;
    }

    /**
     * JPA 프록시의 id 변경
     */
    protected void setId(byte id) {
        this.id = id;
    }
}
