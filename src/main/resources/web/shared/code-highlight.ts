import type { HighlighterCore, ThemedToken } from "shiki/core";

/**
 * 렌더러에 필요한 텍스트와 고정 테마 스타일만 복사한 토큰
 */
export type CodeToken = {
  /**
   * 본문 내용
   */
  content: string;
  /**
   * 토큰 색상
   */
  color?: string;
  /**
   * 토큰 글꼴 스타일
   */
  fontStyle?: number
};

/**
 * 고정 코드 테마의 토큰과 원문의 정확한 줄 구분자를 보관함
 */
export type HighlightedCode = {
  /**
   * 줄별 강조 토큰
   */
  tokens: CodeToken[][];
  /**
   * 원문의 줄 구분자
   */
  breaks: string[]
};

/**
 * 지원 언어별 문법 로더
 */
const languages = {
  /**
   * kotlin 문법 지연 로딩
   */
  kotlin: () => import("@shikijs/langs/kotlin"),
  /**
   * java 문법 지연 로딩
   */
  java: () => import("@shikijs/langs/java"),
  /**
   * javascript 문법 지연 로딩
   */
  javascript: () => import("@shikijs/langs/javascript"),
  /**
   * typescript 문법 지연 로딩
   */
  typescript: () => import("@shikijs/langs/typescript"),
  /**
   * json 문법 지연 로딩
   */
  json: () => import("@shikijs/langs/json"),
  /**
   * sql 문법 지연 로딩
   */
  sql: () => import("@shikijs/langs/sql"),
  /**
   * bash 문법 지연 로딩
   */
  bash: () => import("@shikijs/langs/bash"),
  /**
   * yaml 문법 지연 로딩
   */
  yaml: () => import("@shikijs/langs/yaml"),
  /**
   * python 문법 지연 로딩
   */
  python: () => import("@shikijs/langs/python"),
  /**
   * css 문법 지연 로딩
   */
  css: () => import("@shikijs/langs/css"),
  /**
   * html 문법 지연 로딩
   */
  html: () => import("@shikijs/langs/html"),
  /**
   * markdown 문법 지연 로딩
   */
  markdown: () => import("@shikijs/langs/markdown"),
} as const;

/**
 * 지원 코드 언어
 */
export type HighlightLanguage = keyof typeof languages;

/**
 * 언어 이름·확장자 별칭
 */
const aliases: Record<string, HighlightLanguage> = {
  kotlin: "kotlin", kt: "kotlin", kts: "kotlin", java: "java",
  javascript: "javascript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  typescript: "typescript", ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  json: "json", jsonc: "json", sql: "sql",
  bash: "bash", sh: "bash", shell: "bash", zsh: "bash",
  yaml: "yaml", yml: "yaml", python: "python", py: "python", css: "css",
  html: "html", htm: "html", markdown: "markdown", md: "markdown",
};

/**
 * 공유 코드 강조기 초기화 작업
 */
let highlighterPromise: Promise<HighlighterCore> | null = null;
/**
 * 언어별 문법 로딩 작업
 */
const loadedLanguages = new Map<HighlightLanguage, Promise<void>>();

/**
 * 사용자 값은 고정 별칭 표에서만 선택해 임의 모듈 경로로 사용하지 않음
 */
export function resolveHighlightLanguage(language?: string): HighlightLanguage | null {
  const key = language?.toLowerCase() ?? "";
  return Object.hasOwn(aliases, key) ? aliases[key] : null;
}

/**
 * 공통 core와 고정 다크 테마를 처음 필요할 때만 만들고 실패하면 명시적 재시도를 허용함
 *
 * 1. 최초 요청만 공통 코어·테마 로딩, 동시 요청은 Promise 공유
 * 2. 실패 시 캐시가 해제되어 다음 호출에서 재시도 가능
 */
async function getHighlighter(): Promise<HighlighterCore> {
  // 최초 요청만 공통 코어·테마 로딩, 동시 요청은 Promise 공유
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import("shiki/core"), import("shiki/engine/javascript"),
      import("@shikijs/themes/dark-plus"),
    ]).then(([core, engine, theme]) => core.createHighlighterCore({
      themes: [theme.default], langs: [], engine: engine.createJavaScriptRegexEngine(),
    })).catch((error: unknown) => { highlighterPromise = null; throw error; });
  }
  // 실패 시 캐시가 해제되어 다음 호출에서 재시도 가능
  return highlighterPromise;
}

/**
 * 허용된 언어 모듈 하나만 읽고 같은 언어의 동시 로딩을 공유함
 *
 * 1. 이미 로드한 언어는 즉시 종료
 * 2. 언어별 로딩 Promise 공유, 실패하면 해당 캐시 해제
 */
async function ensureLanguage(highlighter: HighlighterCore, language: HighlightLanguage): Promise<void> {
  // 이미 로드한 언어는 즉시 종료
  if (highlighter.getLoadedLanguages().includes(language)) return;
  let pending = loadedLanguages.get(language);
  // 언어별 로딩 Promise 공유, 실패하면 해당 캐시 해제
  if (!pending) {
    pending = languages[language]().then((module) => highlighter.loadLanguage(...module.default))
      .catch((error: unknown) => { loadedLanguages.delete(language); throw error; });
    loadedLanguages.set(language, pending);
  }
  await pending;
}

/**
 * 줄과 개행을 분리해 Shiki의 LF 정규화가 원본 CRLF 표시를 바꾸지 않게 함
 */
function sourceLines(code: string): {
  /**
   * 원문의 각 줄
   */
  lines: string[];
  /**
   * 원문의 줄 구분자
   */
  breaks: string[]
} {
  const parts = code.split(/(\r\n|\n|\r)/);
  return { lines: parts.filter((_, index) => index % 2 === 0), breaks: parts.filter((_, index) => index % 2 === 1) };
}

/**
 * 토큰이 원문 줄과 정확히 같을 때만 렌더러에 필요한 값으로 좁힘
 */
function copyTokens(lines: ThemedToken[][], source: string[]): CodeToken[][] {
  if (lines.length !== source.length) throw new Error("구문 강조 줄 수 불일치");
  return lines.map((line, index) => {
    if (line.map((token) => token.content).join("") !== source[index]) throw new Error("구문 강조 원문 불일치");
    return line.map(({ content, color, fontStyle }) => ({ content, color, fontStyle }));
  });
}

/**
 * 지원 언어의 실제 Shiki 문법 토큰을 계산하며 본문 자체는 전역 캐시에 넣지 않음
 */
export async function highlightCode(code: string, language: HighlightLanguage): Promise<HighlightedCode> {
  const highlighter = await getHighlighter();
  await ensureLanguage(highlighter, language);
  const source = sourceLines(code);
  return {
    tokens: copyTokens(highlighter.codeToTokensBase(code, { lang: language, theme: "dark-plus" }), source.lines),
    breaks: source.breaks,
  };
}
