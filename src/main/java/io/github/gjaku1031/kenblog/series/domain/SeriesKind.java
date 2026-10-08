package io.github.gjaku1031.kenblog.series.domain;

/**
 * 글 묶음의 탐색 구획
 * 기술 글 묶음은 TECH, 프로젝트 문서 묶음은 PROJECT
 */
public enum SeriesKind {
    /**
     * 일반 기술·학습 시리즈
     */
    TECH,

    /**
     * 프로젝트 시리즈
     */
    PROJECT
}
