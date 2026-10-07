package io.github.gjaku1031.kenblog.series.domain;

/**
 * 프로젝트 시리즈에만 지정하는 진행 상태
 */
public enum ProjectStatus {
    /**
     * 계획
     */
    PLAN,

    /**
     * 개발 중
     */
    DEV,

    /**
     * 유지보수
     */
    MAINT,

    /**
     * 완료
     */
    DONE
}
