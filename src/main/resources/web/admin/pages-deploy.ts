import { request, mutate, HttpError } from '../shared/admin-api';

/**
 * 관리자 API가 요약한 Pages 워크플로 실행 상태
 */
type Deployment = {
  /**
   * GitHub Actions 실행 ID
   */
  runId: number;

  /**
   * 실행 상태; queued·in_progress·completed 등
   */
  status: string;

  /**
   * 완료 결과; 완료 전에는 null
   */
  conclusion: string | null;

  /**
   * GitHub 실행 화면 주소
   */
  htmlUrl: string | null;

  /**
   * 실제 실행 시작 시각; 시작 전에는 null
   */
  startedAt: string | null;

  /**
   * 완료한 job 단계 수
   */
  completedSteps: number;

  /**
   * 현재까지 알려진 job 단계 수
   */
  totalSteps: number;

  /**
   * 진행 중인 job · 단계 이름
   */
  currentStep: string | null;

  /**
   * 최근 성공 실행의 소요 시간(초)
   */
  estimatedSeconds: number
};

/**
 * 관리자 화면과 공유하는 후속 처리 연결
 */
type PagesDeployOptions = {
  /**
   * 배포 성공 후 배포 대기 표시 재조회
   */
  onDeployed(): void;

  /**
   * 관리자 세션 만료 처리
   */
  onUnauthorized(message: string): void
};

/**
 * 상태 조회 간격(ms); 서버가 조회마다 GitHub API를 2회 호출하므로 토큰 한도 안에서 여유 있게 설정
 */
const POLL_MS = 4_000;

/**
 * 진행 중 막대의 상한; 완료 응답 전에는 가득 채우지 않음
 */
const ACTIVE_CAP = 0.95;

/**
 * 조회 반복을 멈추는 응답 상태; 세션 만료·권한 거부·GitHub 토큰 오류
 */
const FATAL_STATUS = new Set([401, 403, 502]);

/**
 * 관리자 사이드바의 Pages 배포 버튼·진행 막대 연결
 *
 * 1. 버튼 클릭 시 진행 중 실행이 있으면 그 실행을 추적하고, 없으면 확인 후 새로 실행
 * 2. 실행 ID로 상태·단계를 주기 조회해 예상 소요 시간 기준 막대 갱신
 * 3. 완료 시 결과를 표시하고 성공이면 배포 대기 표시 재조회
 */
export function connectPagesDeploy(options: PagesDeployOptions) {
  const button = document.getElementById('pages-deploy-run') as HTMLButtonElement | null;
  const progress = document.getElementById('pages-deploy-progress');
  const bar = document.getElementById('pages-deploy-bar');
  const status = document.getElementById('pages-deploy-status');
  const link = document.getElementById('pages-deploy-link') as HTMLAnchorElement | null;
  if (!button || !progress || !bar || !status || !link) return { resume() {}, stop() {} };
  const fill = bar.firstElementChild as HTMLElement;

  /**
   * 추적 중인 실행 세대; 로그아웃·새 추적 시 이전 조회 결과 무시
   */
  let generation = 0;

  /**
   * 다음 상태 조회 타이머; 추적 중이 아니면 undefined
   */
  let timer: number | undefined;

  /**
   * 막대 비율·상태 문구·결과 색상 표시
   */
  const show = (ratio: number, text: string, state: 'active' | 'success' | 'failure' | 'queued') => {
    progress.hidden = false;
    progress.dataset.state = state;
    const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
    fill.style.width = `${percent}%`;
    bar.setAttribute('aria-valuenow', String(percent));
    status.textContent = text;
  };

  /**
   * 추적 종료와 버튼 복구
   */
  const finish = () => { window.clearTimeout(timer); timer = undefined; button.disabled = false; };

  /**
   * 오류 표시; 세션 만료는 로그인 화면으로 전환
   */
  const fail = (error: unknown) => {
    finish();
    if (error instanceof HttpError && error.status === 401) { options.onUnauthorized(error.message); return; }
    show(1, error instanceof Error ? error.message : '배포 상태를 확인하지 못했습니다.', 'failure');
  };

  /**
   * 실행 상태를 막대·문구로 표시하고 완료 여부 반환
   */
  const render = (run: Deployment) => {
    if (run.htmlUrl) link.href = run.htmlUrl;
    // 완료 결과는 막대를 채우고 성공 시 배포 대기 비교를 다시 읽음
    if (run.status === 'completed') {
      finish();
      if (run.conclusion === 'success') { show(1, '배포 완료', 'success'); options.onDeployed(); }
      else show(1, `배포 ${run.conclusion === 'cancelled' ? '취소' : '실패'} (${run.conclusion ?? '결과 없음'})`, 'failure');
      return true;
    }
    // 시작 전에는 대기 표시, 시작 후에는 예상 소요 시간 대비 경과 비율 사용
    if (!run.startedAt || run.status !== 'in_progress') show(0.03, '대기 중', 'queued');
    else {
      const elapsed = (Date.now() - Date.parse(run.startedAt)) / 1000;
      show(Math.min(ACTIVE_CAP, elapsed / Math.max(1, run.estimatedSeconds)),
        `${run.currentStep ?? '진행 중'} (${run.completedSteps}/${run.totalSteps}단계)`, 'active');
    }
    return false;
  };

  /**
   * 다음 상태 조회 예약
   */
  const schedule = (runId: number, current: number) => {
    timer = window.setTimeout(() => { void poll(runId, current); }, POLL_MS);
  };

  /**
   * 실행 상태 조회; 일시 오류와 생성 직후 404는 다음 주기에 재시도
   */
  const poll = async (runId: number, current: number) => {
    try {
      const run = await request<Deployment>(`/admin/pages/deployments/${runId}`);
      if (current !== generation || render(run)) return;
    } catch (error) {
      if (current !== generation) return;
      if (error instanceof HttpError && FATAL_STATUS.has(error.status)) { fail(error); return; }
    }
    schedule(runId, current);
  };

  /**
   * 받은 실행 상태부터 추적 시작
   */
  const track = (run: Deployment) => {
    const current = ++generation;
    window.clearTimeout(timer);
    button.disabled = true;
    if (!render(run)) schedule(run.runId, current);
  };

  // 실행 요청: 진행 중 실행이 있으면 확인 없이 그 실행을 추적
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const latest = await request<Deployment | undefined>('/admin/pages/deployments/latest');
      if (latest && latest.status !== 'completed') { track(latest); return; }
      if (!window.confirm('현재 DB 메타데이터와 main의 원고로 공개 사이트를 다시 만들까요?')) { button.disabled = false; return; }
      show(0.03, '실행 요청 중', 'queued');
      track(await mutate<Deployment>('/admin/pages/deployments', 'POST'));
    } catch (error) { fail(error); }
  });

  return {
    /**
     * 관리자 화면 진입 시 진행 중인 실행이 있으면 이어서 표시
     */
    async resume() {
      if (timer !== undefined) return;
      try {
        const latest = await request<Deployment | undefined>('/admin/pages/deployments/latest');
        if (latest && latest.status !== 'completed' && timer === undefined) track(latest);
      } catch { /* 이어 보기 실패는 버튼 동작에 영향 없음 */ }
    },

    /**
     * 로그아웃 시 조회 중단과 표시 초기화
     */
    stop() { generation++; finish(); progress.hidden = true; },
  };
}
