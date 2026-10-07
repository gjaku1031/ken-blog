import { el } from '../shared/dom';
import { setMessage, field, submit } from '../shared/forms';

/**
 * Pages 워크플로 실행 정보 중 진행 표시에 쓰는 필드
 */
type WorkflowRun = {
  /**
   * 실행 ID
   */
  id: number;

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
  html_url: string;

  /**
   * 생성 시각
   */
  created_at: string;

  /**
   * 실제 실행 시작 시각
   */
  run_started_at?: string;

  /**
   * 마지막 상태 변경 시각
   */
  updated_at: string
};

/**
 * 실행에 속한 job의 단계 상태
 */
type WorkflowJob = {
  /**
   * job 이름
   */
  name: string;

  /**
   * job 상태
   */
  status: string;

  /**
   * job 단계 목록; 시작 전 job은 비어 있음
   */
  steps?: Array<{
    /**
     * 단계 이름
     */
    name: string;

    /**
     * 단계 상태
     */
    status: string
  }>
};

/**
 * 관리자 화면과 공유하는 대화상자·후속 갱신 연결
 */
type PagesDeployOptions = {
  /**
   * 관리자 공용 대화상자 열기
   */
  openDialog(title: string, content: HTMLElement): void;

  /**
   * 관리자 공용 대화상자 닫기
   */
  closeDialog(): void;

  /**
   * 배포 성공 후 배포 대기 표시 재조회
   */
  onDeployed(): void
};

/**
 * 배포 대상 저장소
 */
const REPOSITORY = 'gjaku1031/ken-blog';

/**
 * 공개 사이트를 생성·배포하는 워크플로 파일
 */
const WORKFLOW = 'pages.yml';

/**
 * 수동 실행 기준 브랜치
 */
const REF = 'main';

/**
 * GitHub REST API 기준 주소
 */
const API = `https://api.github.com/repos/${REPOSITORY}/actions`;

/**
 * 토큰을 보관하는 이 브라우저의 저장 키
 */
const TOKEN_KEY = 'ken-blog.pages-deploy-token';

/**
 * 상태 조회 간격(ms); 토큰 요청 한도 시간당 5,000회 안에서 실행당 2회 조회
 */
const POLL_MS = 4_000;

/**
 * 성공 기록이 없을 때 쓰는 예상 소요 시간(초)
 */
const DEFAULT_ESTIMATE = 90;

/**
 * 진행 중 막대의 상한; 완료 응답 전에는 가득 채우지 않음
 */
const ACTIVE_CAP = 0.95;

/**
 * GitHub 응답 상태를 보존하는 요청 오류
 */
class GitHubError extends Error {
  /**
   * HTTP 상태와 표시 문구 설정
   */
  constructor(
    /**
     * HTTP 상태
     */
    readonly status: number, message: string) { super(message); }
}

/**
 * 저장한 토큰 조회; 저장소 접근이 막힌 브라우저는 미설정으로 처리
 */
function storedToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

/**
 * 토큰 저장 또는 삭제; 저장 실패는 호출자에게 전달
 */
function storeToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/**
 * 토큰을 붙인 GitHub API 요청과 상태별 오류 문구 변환
 */
async function github<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path.startsWith('https://') ? path : API + path, {
      ...init, cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch { throw new GitHubError(0, 'GitHub에 연결하지 못했습니다.'); }
  if (response.status === 401) throw new GitHubError(401, 'GitHub 토큰이 만료되었거나 올바르지 않습니다. 토큰을 다시 설정하세요.');
  if (response.status === 403 || response.status === 404) throw new GitHubError(response.status, 'GitHub 토큰에 ken-blog 저장소의 Actions 읽기·쓰기 권한이 없습니다.');
  if (!response.ok) throw new GitHubError(response.status, `GitHub 요청에 실패했습니다. HTTP ${response.status}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

/**
 * 최근 성공 실행의 소요 시간(초); 수동 실행 기록을 우선하고 없으면 전체 성공 기록 사용
 */
async function estimateSeconds(token: string): Promise<number> {
  for (const filter of ['&event=workflow_dispatch', '']) {
    const { workflow_runs: runs } = await github<{
      /**
       * 최근 실행 목록
       */
      workflow_runs: WorkflowRun[]
    }>(`/workflows/${WORKFLOW}/runs?status=success&per_page=1${filter}`, token);
    const run = runs[0];
    if (run) return Math.max(10, (Date.parse(run.updated_at) - Date.parse(run.run_started_at ?? run.created_at)) / 1000);
  }
  return DEFAULT_ESTIMATE;
}

/**
 * 관리자 사이드바의 Pages 배포 버튼·진행 막대·토큰 설정 연결
 *
 * 1. 버튼 클릭 시 토큰이 없으면 설정 대화상자를 열고, 있으면 진행 중 실행 확인 후 수동 실행
 * 2. 실행 ID로 상태·단계를 주기 조회해 예상 소요 시간 기준 막대 갱신
 * 3. 완료 시 결과를 표시하고 성공이면 배포 대기 표시 재조회
 */
export function connectPagesDeploy(options: PagesDeployOptions) {
  const button = document.getElementById('pages-deploy-run') as HTMLButtonElement | null;
  const progress = document.getElementById('pages-deploy-progress');
  const bar = document.getElementById('pages-deploy-bar');
  const status = document.getElementById('pages-deploy-status');
  const link = document.getElementById('pages-deploy-link') as HTMLAnchorElement | null;
  const settings = document.getElementById('pages-deploy-token');
  if (!button || !progress || !bar || !status || !link || !settings) return { resume() {}, stop() {} };
  const fill = bar.firstElementChild as HTMLElement;

  /**
   * 추적 중인 실행 세대; 로그아웃·새 실행 시 이전 조회 결과 무시
   */
  let generation = 0;

  /**
   * 다음 상태 조회 타이머
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
   * 실행 상태·단계를 조회해 진행 표시 갱신, 완료 전이면 다음 조회 예약
   */
  const poll = async (runId: number, estimate: number, current: number) => {
    const token = storedToken();
    if (current !== generation || !token) return;
    try {
      const [run, { jobs }] = await Promise.all([
        github<WorkflowRun>(`/runs/${runId}`, token),
        github<{
          /**
           * 실행의 job 목록
           */
          jobs: WorkflowJob[]
        }>(`/runs/${runId}/jobs`, token),
      ]);
      if (current !== generation) return;
      link.href = run.html_url;
      const steps = jobs.flatMap(job => (job.steps ?? []).map(step => ({ job: job.name, ...step })));
      const done = steps.filter(step => step.status === 'completed').length;
      const running = steps.find(step => step.status === 'in_progress');
      // 완료 결과는 막대를 채우고 성공 시 배포 대기 비교를 다시 읽음
      if (run.status === 'completed') {
        finish();
        if (run.conclusion === 'success') { show(1, '배포 완료', 'success'); options.onDeployed(); }
        else show(1, `배포 ${run.conclusion === 'cancelled' ? '취소' : '실패'} (${run.conclusion ?? '결과 없음'})`, 'failure');
        return;
      }
      // 시작 전에는 대기 표시, 시작 후에는 예상 소요 시간 대비 경과 비율 사용
      if (!run.run_started_at || run.status === 'queued' || run.status === 'pending' || run.status === 'waiting') show(0.03, '대기 중', 'queued');
      else {
        const elapsed = (Date.now() - Date.parse(run.run_started_at)) / 1000;
        const label = running ? `${running.job} · ${running.name}` : '진행 중';
        show(Math.min(ACTIVE_CAP, elapsed / estimate), `${label} (${done}/${steps.length}단계)`, 'active');
      }
    } catch (error) {
      if (current !== generation) return;
      // 실행 직후 조회 지연이나 일시 오류는 다음 주기에 재시도하고 인증 오류만 중단
      if (error instanceof GitHubError && error.status === 401) { finish(); show(1, error.message, 'failure'); return; }
    }
    timer = window.setTimeout(() => { void poll(runId, estimate, current); }, POLL_MS);
  };

  /**
   * 지정 실행 추적 시작
   */
  const track = async (run: Pick<WorkflowRun, 'id' | 'html_url'>, token: string) => {
    const current = ++generation;
    window.clearTimeout(timer);
    button.disabled = true;
    link.href = run.html_url;
    show(0.03, '대기 중', 'queued');
    const estimate = await estimateSeconds(token).catch(() => DEFAULT_ESTIMATE);
    if (current === generation) await poll(run.id, estimate, current);
  };

  /**
   * 가장 최근 실행이 진행 중이면 반환
   */
  const activeRun = async (token: string) => {
    const { workflow_runs: runs } = await github<{
      /**
       * 최근 실행 목록
       */
      workflow_runs: WorkflowRun[]
    }>(`/workflows/${WORKFLOW}/runs?per_page=1`, token);
    return runs[0] && runs[0].status !== 'completed' ? runs[0] : null;
  };

  /**
   * 토큰 입력·검증·삭제 대화상자 열기
   */
  const openSettings = () => {
    const form = el('form', 'field-grid');
    form.append(el('p', 'muted wide', 'ken-blog 저장소의 Actions 읽기·쓰기 권한만 가진 fine-grained token을 입력하세요. 토큰은 이 브라우저에만 저장됩니다.'));
    const input = field(form, 'GitHub 토큰', 'token', '', { required: !storedToken(), type: 'password', wide: true, placeholder: storedToken() ? '저장됨 · 바꾸려면 새 토큰 입력' : 'github_pat_…' });
    input.autocomplete = 'off';
    const message = el('p', 'notice wide'); message.hidden = true; form.append(message);
    submit(form, '저장');
    if (storedToken()) {
      const remove = el('button', 'button ghost', '토큰 삭제'); remove.type = 'button';
      remove.addEventListener('click', () => {
        try { storeToken(''); } catch { /* 저장소 접근 불가 시 이미 미설정 상태 */ }
        options.closeDialog();
      });
      form.querySelector('.form-actions')?.append(remove);
    }
    // 워크플로 조회로 권한을 확인한 뒤에만 저장
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const token = input.value.trim();
      if (!token) { options.closeDialog(); return; }
      const save = form.querySelector<HTMLButtonElement>('button[type=submit]');
      if (save) save.disabled = true;
      try {
        await github(`/workflows/${WORKFLOW}`, token);
        storeToken(token);
        options.closeDialog();
      } catch (error) {
        setMessage(message, error instanceof Error ? error.message : '토큰을 저장하지 못했습니다.', true);
      } finally { if (save) save.disabled = false; }
    });
    options.openDialog('GitHub 배포 토큰', form);
  };

  // 실행 요청: 진행 중 실행이 있으면 새로 만들지 않고 그 실행을 추적
  button.addEventListener('click', async () => {
    const token = storedToken();
    if (!token) { openSettings(); return; }
    button.disabled = true;
    try {
      const active = await activeRun(token);
      if (active) { await track(active, token); return; }
      if (!window.confirm('현재 DB 메타데이터와 main의 원고로 공개 사이트를 다시 만들까요?')) { button.disabled = false; return; }
      const dispatched = await github<{
        /**
         * 생성된 실행 ID
         */
        workflow_run_id: number;

        /**
         * 실행 화면 주소
         */
        html_url: string
      }>(`/workflows/${WORKFLOW}/dispatches`, token, { method: 'POST', body: JSON.stringify({ ref: REF, return_run_details: true }) });
      await track({ id: dispatched.workflow_run_id, html_url: dispatched.html_url }, token);
    } catch (error) {
      finish();
      show(1, error instanceof Error ? error.message : '배포를 시작하지 못했습니다.', 'failure');
    }
  });
  settings.addEventListener('click', openSettings);

  return {
    /**
     * 관리자 화면 진입 시 진행 중인 실행이 있으면 이어서 표시
     */
    async resume() {
      const token = storedToken();
      if (!token || timer !== undefined) return;
      try {
        const active = await activeRun(token);
        if (active) await track(active, token);
      } catch { /* 이어 보기 실패는 버튼 동작에 영향 없음 */ }
    },

    /**
     * 로그아웃 시 조회 중단과 표시 초기화
     */
    stop() { generation++; finish(); progress.hidden = true; },
  };
}
