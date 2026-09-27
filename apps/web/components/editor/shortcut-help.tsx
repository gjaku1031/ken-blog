"use client";

const blocks = [
  ["# · ## · ###", "제목 1 · 2 · 3", "공백"], ["-", "글머리 목록", "공백"],
  ["1.", "번호 목록", "공백"], ["[]", "할 일 체크박스", "공백"],
  [">", "접기 (제목에서 Enter로 안쪽 내용, 빈 줄에서 Enter로 나가기)", "공백"],
  ["|", "인용", "공백"], ["/표", "표 (3×3)", "Enter"],
  ["| 이름 | 값 |", "첫 줄이 머리글인 표", "Enter"],
  ["```java", "코드 블록 (언어 지정)", "Enter"], ["```mermaid", "다이어그램", "Enter"],
  ["$$", "수식 블록 (KaTeX)", "Enter"], ["$x^2$", "문장 안 수식", "—"],
  ["[[글 제목]]", "다른 글 링크 · [[제목|보이는 글자]]", "—"],
  ["---", "구분선", "Enter"], ["[* 내용]", "주석 · 번호 자동 (문장 중간 어디서나)", "—"],
  ["[*A 내용] · [*A]", "이름 붙은 주석 · 같은 주석 다시 달기", "—"],
  ["이미지", "파일을 끌어다 놓기 · 붙여넣기 · 하단 이미지 버튼", "—"],
];
const keys = [
  ["Enter", "다음 블록 · 빈 목록에서 목록 나가기"],
  ["Backspace", "빈 블록이면 일반 문단으로, 또 누르면 위 블록과 합치기"],
  ["Esc", "코드 · 다이어그램 · 수식 블록 닫고 렌더"],
  ["⌘/Ctrl + Enter", "코드 블록 안에서 다음 블록 만들기"],
  ["↑ ↓", "블록 사이 이동"], ["Tab · Shift+Tab", "접기 안으로 넣기 · 밖으로 빼기"],
  ["⋮⋮ 드래그", "블록 왼쪽 손잡이를 끌어 순서 바꾸기"],
];

/** 원본 34번 상태의 블록·키보드 도움말을 하단 아이콘 위 팝오버로 표시한다. */
export function ShortcutHelp() {
  return <div id="write-help" className="write-help-popover" role="region" aria-label="마크다운 단축키">
    <div className="editor-help-title"><strong>마크다운 단축키</strong><span>줄 맨 앞에 입력</span></div>
    <table><thead><tr><th>입력</th><th>블록</th><th>마무리</th></tr></thead><tbody>
      {blocks.map(([input, description, ending]) => <tr key={input}><td>{input}</td><td>{description}</td><td>{ending}</td></tr>)}
    </tbody></table>
    <table><thead><tr><th>키</th><th>동작</th></tr></thead><tbody>
      {keys.map(([key, action]) => <tr key={key}><td>{key}</td><td>{action}</td></tr>)}
    </tbody></table>
  </div>;
}
