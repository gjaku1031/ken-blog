import { ensureBlockBoundaries, type MarkdownDocument } from "./editor-markdown";

/** 비동기 첨부 완료까지 블록 ID 양쪽의 삽입 경계를 기억한다. {@link captureBlockInsertion} */
export type BlockInsertion = { beforeId: string | null; afterId: string | null; fallbackIndex: number;
  preferred: "before" | "after" };

/** 현재 {@link MarkdownDocument}의 경계를 이웃 블록 ID로 고정한다. */
export function captureBlockInsertion(document: MarkdownDocument, index: number, preferred: "before" | "after"): BlockInsertion {
  const position = Math.max(0, Math.min(index, document.blocks.length));
  return { beforeId: document.blocks[position]?.id ?? null, afterId: document.blocks[position - 1]?.id ?? null,
    fallbackIndex: position, preferred };
}

/** 편집 중 삽입 위치가 바뀌어도 살아 있는 ID에 붙여 {@link BlockInsertion} 위치를 복원한다. */
export function resolveBlockInsertion(document: MarkdownDocument, anchor: BlockInsertion): number {
  const before = anchor.beforeId ? document.blocks.findIndex((block) => block.id === anchor.beforeId) : -1;
  const after = anchor.afterId ? document.blocks.findIndex((block) => block.id === anchor.afterId) : -1;
  if (anchor.preferred === "before") {
    if (before >= 0) return before;
    if (after >= 0) return after + 1;
  } else {
    if (after >= 0) return after + 1;
    if (before >= 0) return before;
  }
  return Math.max(0, Math.min(anchor.fallbackIndex, document.blocks.length));
}

/** 선택 블록을 원래 상대 순서로 묶어 경계에 놓고 구분자는 문서 위치에 보존한다. {@link MarkdownDocument} */
export function moveEditorBlocks(document: MarkdownDocument, ids: readonly string[], boundaryIndex: number): MarkdownDocument | null {
  const selected = new Set(ids);
  const blocks = document.blocks;
  const moving = blocks.filter((block) => selected.has(block.id));
  if (!moving.length) return null;
  const boundary = Math.max(0, Math.min(boundaryIndex, blocks.length));
  const preceding = blocks.slice(0, boundary).filter((block) => selected.has(block.id)).length;
  const destination = boundary - preceding;
  const remaining = blocks.filter((block) => !selected.has(block.id));
  const ordered = [...remaining.slice(0, destination), ...moving, ...remaining.slice(destination)];
  if (ordered.every((block, index) => block.id === blocks[index].id)) return null;
  const separators = blocks.map((block) => block.after);
  return ensureBlockBoundaries({ ...document, blocks: ordered.map((block, index) => ({ ...block, after: separators[index] })) });
}
