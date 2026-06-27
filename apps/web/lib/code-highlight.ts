import type { HighlighterCore, ThemedToken } from "shiki/core";

/** 렌더러에 필요한 텍스트와 고정 테마 스타일만 복사한 토큰. */
export type CodeToken = { content: string; color?: string; fontStyle?: number };

/** 고정 코드 테마의 토큰과 원문의 정확한 줄 구분자를 보관한다. */
export type HighlightedCode = { tokens: CodeToken[][]; breaks: string[] };

const languages = {
  kotlin: () => import("@shikijs/langs/kotlin"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  typescript: () => import("@shikijs/langs/typescript"),
  json: () => import("@shikijs/langs/json"),
  sql: () => import("@shikijs/langs/sql"),
  bash: () => import("@shikijs/langs/bash"),
  yaml: () => import("@shikijs/langs/yaml"),
  python: () => import("@shikijs/langs/python"),
  css: () => import("@shikijs/langs/css"),
  html: () => import("@shikijs/langs/html"),
  markdown: () => import("@shikijs/langs/markdown"),
} as const;

export type HighlightLanguage = keyof typeof languages;

const aliases: Record<string, HighlightLanguage> = {
  kotlin: "kotlin", kt: "kotlin", kts: "kotlin", java: "java",
  javascript: "javascript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  typescript: "typescript", ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  json: "json", jsonc: "json", sql: "sql",
  bash: "bash", sh: "bash", shell: "bash", zsh: "bash",
  yaml: "yaml", yml: "yaml", python: "python", py: "python", css: "css",
  html: "html", htm: "html", markdown: "markdown", md: "markdown",
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Map<HighlightLanguage, Promise<void>>();

/** 사용자 값은 고정 별칭 표에서만 선택해 임의 모듈 경로로 사용하지 않는다. */
export function resolveHighlightLanguage(language?: string): HighlightLanguage | null {
  const key = language?.toLowerCase() ?? "";
  return Object.hasOwn(aliases, key) ? aliases[key] : null;
}

/** 공통 core와 고정 다크 테마를 처음 필요할 때만 만들고 실패하면 명시적 재시도를 허용한다. */
async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import("shiki/core"), import("shiki/engine/javascript"),
      import("@shikijs/themes/dark-plus"),
    ]).then(([core, engine, theme]) => core.createHighlighterCore({
      themes: [theme.default], langs: [], engine: engine.createJavaScriptRegexEngine(),
    })).catch((error: unknown) => { highlighterPromise = null; throw error; });
  }
  return highlighterPromise;
}

/** 허용된 언어 모듈 하나만 읽고 같은 언어의 동시 로딩을 공유한다. */
async function ensureLanguage(highlighter: HighlighterCore, language: HighlightLanguage): Promise<void> {
  if (highlighter.getLoadedLanguages().includes(language)) return;
  let pending = loadedLanguages.get(language);
  if (!pending) {
    pending = languages[language]().then((module) => highlighter.loadLanguage(...module.default))
      .catch((error: unknown) => { loadedLanguages.delete(language); throw error; });
    loadedLanguages.set(language, pending);
  }
  await pending;
}

/** 줄과 개행을 분리해 Shiki의 LF 정규화가 원본 CRLF 표시를 바꾸지 않게 한다. */
function sourceLines(code: string): { lines: string[]; breaks: string[] } {
  const parts = code.split(/(\r\n|\n|\r)/);
  return { lines: parts.filter((_, index) => index % 2 === 0), breaks: parts.filter((_, index) => index % 2 === 1) };
}

/** 토큰이 원문 줄과 정확히 같을 때만 React에 필요한 값으로 좁힌다. */
function copyTokens(lines: ThemedToken[][], source: string[]): CodeToken[][] {
  if (lines.length !== source.length) throw new Error("구문 강조 줄 수 불일치");
  return lines.map((line, index) => {
    if (line.map((token) => token.content).join("") !== source[index]) throw new Error("구문 강조 원문 불일치");
    return line.map(({ content, color, fontStyle }) => ({ content, color, fontStyle }));
  });
}

/** 지원 언어의 실제 Shiki 문법 토큰을 계산하며 본문 자체는 전역 캐시에 넣지 않는다. */
export async function highlightCode(code: string, language: HighlightLanguage): Promise<HighlightedCode> {
  const highlighter = await getHighlighter();
  await ensureLanguage(highlighter, language);
  const source = sourceLines(code);
  return {
    tokens: copyTokens(highlighter.codeToTokensBase(code, { lang: language, theme: "dark-plus" }), source.lines),
    breaks: source.breaks,
  };
}
