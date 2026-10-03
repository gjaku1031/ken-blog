/**
 * 정적 빌더가 이스케이프한 카드와 정규화된 검색 정보
 */
type SearchEntry = {
  /**
   * 자동 이스케이프한 카드 HTML
   */
  html: string;

  /**
   * 제목·분류·태그·본문 검색 문자열
   */
  text: string;

  /**
   * 분류 경로
   */
  category: string;

  /**
   * 태그 이름 배열
   */
  tags: string[];
};

/**
 * 검색 전용 정적 색인을 한 번 읽고 조건에 맞는 전체 결과 표시
 *
 * 1. 공개 색인 조회, 실패 시 재시도 가능한 안내 표시
 * 2. 최신 검색어·태그·분류만 적용
 * 3. 전체 결과와 건수 안내, 원고 HTML은 서버 템플릿 출력만 사용
 */
export function connectSearch(input: HTMLInputElement) {
  const list = document.querySelector<HTMLElement>('.post-list')!;
  const status = document.querySelector<HTMLElement>('#search-filter')!;
  const empty = document.querySelector<HTMLElement>('#filter-empty')!;
  let index: Promise<SearchEntry[]> | undefined;
  let generation = 0;

  /**
   * 현재 필터에 맞는 결과를 갱신, 오래된 비동기 결과는 폐기
   */
  async function update() {
    const current = ++generation;
    const params = new URLSearchParams(location.search);
    const term = input.value.trim().toLocaleLowerCase('und');
    const tag = params.get('tag')?.toLocaleLowerCase('und');
    const category = params.get('category')?.toLocaleLowerCase('und');
    if (!index) status.textContent = '검색 자료를 불러오는 중입니다.';
    try {
      index ??= fetch(document.body.dataset.searchIndex!, { credentials: 'omit' }).then(async response => {
        if (!response.ok) throw new Error('검색 자료를 불러오지 못했습니다.');
        return await response.json() as SearchEntry[];
      }).catch(error => { index = undefined; throw error; });
      const entries = await index;
      if (current !== generation) return;
      const matches = entries.filter(entry => (!term || entry.text.includes(term)) && (!tag || entry.tags.includes(tag)) &&
        (!category || entry.category === category || entry.category.startsWith(category + '/')));
      // 원고·입력 문자열은 HTML로 조립하지 않고 빌더의 이스케이프된 카드만 사용
      list.innerHTML = matches.map(entry => entry.html).join('');
      status.textContent = `검색: ${input.value.trim()} · ${matches.length}편`;
      empty.hidden = matches.length > 0;
    } catch (error) {
      if (current !== generation) return;
      list.replaceChildren(); empty.hidden = true;
      status.textContent = error instanceof Error ? error.message : '검색에 실패했습니다.';
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'write-button'; retry.textContent = '다시 시도';
      retry.addEventListener('click', () => { void update(); }); status.append(' ', retry);
    }
  }
  return update;
}
