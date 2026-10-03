/**
 * 원문과 마커 치환문 사이의 한 구간
 */
type OffsetRange = {
  /**
   * 원문 시작 오프셋
   */
  start: number;

  /**
   * 원문 끝 오프셋
   */
  end: number;

  /**
   * 치환문 시작 오프셋
   */
  transformedStart: number;

  /**
   * 치환문 끝 오프셋
   */
  transformedEnd: number;
};

/**
 * 앞선 역슬래시 수로 문법 구분자의 이스케이프 여부 판별
 */
export function escaped(source: string, position: number): boolean {
  let count = 0;
  for (let index = position - 1; index >= 0 && source[index] === '\\'; index--) count++;
  return count % 2 === 1;
}

/**
 * 정렬된 치환 구간을 이분 탐색하여 원문 오프셋 복원
 * 마커 내부는 시작·끝 경계, 이후는 누적 길이 차이 적용
 *
 * 1. 해당 오프셋 이전의 마지막 치환 구간 검색
 * 2. 구간 내부 경계 또는 이후의 누적 길이 차이로 원문 위치 반환
 */
export function originalOffset(offset: number, ranges: readonly OffsetRange[], endBoundary: boolean): number {
  // 정렬된 구간에서 원문 위치 보정에 사용할 마지막 항목 검색
  let left = 0, right = ranges.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (ranges[middle].transformedStart <= offset) left = middle + 1;
    else right = middle;
  }
  // 마커 시작·내부·이후를 구분하여 경계 포함 규칙 적용
  const range = ranges[left - 1];
  if (!range) return offset;
  if (offset === range.transformedStart) return range.start;
  if (offset < range.transformedEnd) return endBoundary ? range.end : range.start;
  return offset + range.end - range.transformedEnd;
}

/**
 * LF·CRLF·CR을 각각 한 줄로 세어 줄 시작 오프셋 수집
 */
export function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\r') {
      if (source[index + 1] === '\n') index++;
      starts.push(index + 1);
    } else if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

/**
 * 줄 시작점의 이분 탐색으로 1부터 시작하는 행·열과 원문 오프셋 반환
 */
export function sourcePoint(starts: readonly number[], offset: number) {
  let left = 0, right = starts.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (starts[middle] <= offset) left = middle + 1;
    else right = middle;
  }
  return { line: left, column: offset - starts[left - 1] + 1, offset };
}
