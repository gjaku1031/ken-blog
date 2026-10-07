package io.github.gjaku1031.kenblog.pages;

/**
 * 관리자 화면에 표시할 Pages 워크플로 실행 상태
 *
 * @param runId GitHub Actions 실행 ID
 * @param status GitHub 실행 상태; {@code queued}·{@code in_progress}·{@code completed} 등 원문 유지
 * @param conclusion 완료 결과; 완료 전에는 {@code null}
 * @param htmlUrl GitHub 실행 화면 주소
 * @param startedAt 실제 실행 시작 시각(ISO-8601); 시작 전에는 {@code null}
 * @param completedSteps 완료한 job 단계 수
 * @param totalSteps 현재까지 알려진 job 단계 수; 시작 전 job의 단계는 포함하지 않음
 * @param currentStep 진행 중인 {@code job · 단계} 이름; 없으면 {@code null}
 * @param estimatedSeconds 최근 성공 실행의 소요 시간(초); 기록이 없으면 기본 추정값
 */
public record PagesDeploymentResponse(
        long runId,
        String status,
        String conclusion,
        String htmlUrl,
        String startedAt,
        int completedSteps,
        int totalSteps,
        String currentStep,
        long estimatedSeconds) {}
