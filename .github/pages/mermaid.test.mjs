import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { mermaidSourceError, mermaidThemeSource } from "../../src/main/resources/web/shared/mermaid-render.ts";

/**
 * ERD 검증용 원문
 */
const diagram = "erDiagram\n  posts ||--o{ post_tags : post_id\n";

test("ERD role colors allow hex fills, borders and text with a bounded line width", () => {
  assert.equal(mermaidSourceError(diagram +
    "  classDef content fill:#eff6ff,stroke:#2563eb,color:#172554,stroke-width:2px;\n" +
    "  class posts,post_tags content\n"), null);
});

test("color support keeps arbitrary CSS, references and settings blocked", () => {
  for (const declaration of [
    "classDef content fill:url(#paint)",
    "classDef content fill:url(https://example.com/image)",
    "classDef content fill:var(--background)",
    "classDef content fill:#eff6ff,background:#ffffff",
    "classDef content fill:#eff6ff,stroke-width:999px",
    "classDef content fill:#eff6ff;style posts fill:red",
    "classDef content fill:#eff6ff;\nstyle posts fill:red",
    "classDef content fill:#eff6ff,color:#000000!important",
    "classDef content fill:#eff6ff\\3b stroke:#000000",
    "classDef content fill:#eff6ff\n%%{init: {securityLevel: 'loose'}}%%",
    "classDef content fill:#eff6ff\nclick posts callback",
    "classDef content fill:#eff6ff\n@import 'extra.css'",
  ]) assert.notEqual(mermaidSourceError(diagram + declaration), null, declaration);
});

test("all ERD article diagrams fit the public renderer limits", async () => {
  const body = await readFile(new URL("../../content/posts/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9.md", import.meta.url), "utf8");
  const diagrams = [...body.matchAll(/```mermaid\n([\s\S]*?)\n```/g)];
  assert.equal(diagrams.length, 4);
  for (const [, source] of diagrams) {
    assert.equal(mermaidSourceError(source), null);
    assert.equal(mermaidSourceError(mermaidThemeSource(source, "dark")), null);
  }
});

test("role text remains readable on dark fills and Mermaid alternating rows", () => {
  /**
   * sRGB 색상의 상대 휘도 계산
   */
  const luminance = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  /**
   * 두 색상의 명암 대비 계산
   */
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  for (const stroke of ["#2563eb", "#0d9488", "#7c3aed", "#ea580c", "#e11d48", "#64748b"]) {
    const source = `${diagram}classDef role fill:#eff6ff,stroke:${stroke},color:#172554,stroke-width:2px`;
    assert.equal(mermaidThemeSource(source, "light"), source);
    const dark = mermaidThemeSource(source, "dark");
    const fill = dark.match(/fill:(#[0-9a-f]{6})/)[1];
    const color = dark.match(/color:(#[0-9a-f]{6})/)[1];
    for (const background of [fill, "#2b2b2b"]) assert.ok(contrast(color, background) >= 4.5, stroke);
    assert.match(dark, /stroke-width:2px/);
  }
  const unsafe = `${diagram}classDef role fill:url(https://example.com/image)`;
  assert.equal(mermaidThemeSource(unsafe, "dark"), unsafe);
  assert.notEqual(mermaidSourceError(unsafe), null);
});
