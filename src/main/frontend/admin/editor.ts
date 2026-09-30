import { EditorState, Text } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { defaultHighlightStyle, LanguageDescription, LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { renderMarkdown } from '../shared/markdown';
import { enhanceMarkdown } from '../shared/enhance';

type Anchor = { line: number; top: number };
type WikiResolver = (titles: readonly string[], signal: AbortSignal) => Promise<Map<string, string | null>>;

/** CodeMirror 인스턴스를 유지하면서 왼쪽 입력만 오른쪽 미리보기 스크롤을 구동한다. */
export class MarkdownEditor {
  readonly view: EditorView;
  private readonly initialSource: string;
  private readonly initialDocument: Text;
  private timer = 0;
  private renderId = 0;
  private documentRevision = 0;
  private mappedRevision = -1;
  private enhancementAbort: AbortController | null = null;
  private wikiAbort: AbortController | null = null;
  private enhancedTheme: 'light' | 'dark' | null = null;
  private composing = false;
  private scrollFrame = 0;
  private resizeObserver: ResizeObserver;
  private mutationObserver: MutationObserver;
  private anchors: Anchor[] = [];
  private observedBlocks = new Set<HTMLElement>();
  private readonly scrollListener = () => this.scheduleScroll();
  private readonly compositionStart = () => {
    this.composing = true; this.renderId++; this.mappedRevision = -1; window.clearTimeout(this.timer);
    this.wikiAbort?.abort();
  };
  private readonly compositionEnd = () => { this.composing = false; this.scheduleRender(); };
  private readonly resizeListener = () => { this.view.requestMeasure(); this.collectAnchors(); this.scheduleScroll(); };

  constructor(host: HTMLElement, private readonly preview: HTMLElement, source: string,
    private readonly onChange: () => void, private readonly onSave: () => void,
    private readonly resolveWiki?: WikiResolver) {
    this.initialSource = source;
    const firstBreak = source.match(/\r\n|\r|\n/)?.[0];
    this.view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        extensions: [
          history(), lineNumbers(), EditorState.lineSeparator.of(firstBreak ?? '\n'),
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown 원문' }),
          markdown({ codeLanguages: [LanguageDescription.of({ name: 'javascript',
            alias: ['js', 'jsx', 'ts', 'tsx', 'typescript'], support: new LanguageSupport(javascriptLanguage) })] }),
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          keymap.of([{ key: 'Mod-s', run: () => { this.onSave(); return true; } }, ...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            this.documentRevision++;
            this.mappedRevision = -1;
            this.onChange();
            this.scheduleRender();
          }),
        ],
      }),
    });
    this.initialDocument = this.view.state.doc;
    this.view.scrollDOM.addEventListener('scroll', this.scrollListener, { passive: true });
    this.view.contentDOM.addEventListener('compositionstart', this.compositionStart);
    this.view.contentDOM.addEventListener('compositionend', this.compositionEnd);
    this.resizeObserver = new ResizeObserver(() => this.scheduleScroll());
    this.resizeObserver.observe(this.preview);
    this.mutationObserver = new MutationObserver(() => { this.collectAnchors(); this.scheduleScroll(); });
    this.mutationObserver.observe(this.preview, { childList: true, subtree: true });
    this.preview.addEventListener('load', this.scrollListener, true);
    window.addEventListener('resize', this.resizeListener);
    void document.fonts.ready.then(() => { if (this.view.dom.isConnected) this.resizeListener(); });
    this.scheduleRender(0);
  }

  get value(): string { return this.view.state.doc.eq(this.initialDocument) ? this.initialSource : this.view.state.sliceDoc(); }

  refreshTheme(): void { this.view.requestMeasure(); this.scheduleRender(0); }

  refreshLayout(): void { this.view.requestMeasure(); this.collectAnchors(); this.scheduleScroll(); }

  insert(text: string): void {
    const selection = this.view.state.selection.main;
    this.view.dispatch({ changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length } });
    this.view.focus();
  }

  destroy(): void {
    this.renderId++;
    this.wikiAbort?.abort();
    window.clearTimeout(this.timer);
    window.cancelAnimationFrame(this.scrollFrame);
    this.enhancementAbort?.abort();
    this.resizeObserver.disconnect();
    this.observedBlocks.clear();
    this.mutationObserver.disconnect();
    this.preview.removeEventListener('load', this.scrollListener, true);
    window.removeEventListener('resize', this.resizeListener);
    this.view.scrollDOM.removeEventListener('scroll', this.scrollListener);
    this.view.contentDOM.removeEventListener('compositionstart', this.compositionStart);
    this.view.contentDOM.removeEventListener('compositionend', this.compositionEnd);
    this.view.destroy();
  }

  private scheduleRender(delay = 260): void {
    window.clearTimeout(this.timer);
    this.wikiAbort?.abort();
    const generation = ++this.renderId;
    if (this.composing) return;
    this.timer = window.setTimeout(() => { void this.render(generation); }, delay);
  }

  private async render(generation: number): Promise<void> {
    const revision = this.documentRevision;
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const source = this.value;
    try {
      const result = await renderMarkdown(source, {
        sourceMap: true,
        attachmentUrl: (id) => Number.isSafeInteger(id) && id > 0 ? `/api/v1/admin/attachments/${id}/content` : null,
        wikiUrl: () => null,
      });
      if (generation !== this.renderId || revision !== this.documentRevision) return;
      const fragment = document.createRange().createContextualFragment(result.html);
      this.reuseUnchangedMedia(fragment);
      if (this.enhancedTheme !== theme) this.enhancementAbort?.abort();
      const controller = new AbortController();
      this.enhancementAbort = controller;
      this.enhancedTheme = theme;
      // 공용 렌더러가 정화한 HTML만 이 경계에서 삽입한다. API 문자열은 DOM textContent로만 취급한다.
      this.preview.replaceChildren(fragment);
      this.mappedRevision = revision;
      this.collectAnchors();
      this.scheduleScroll();
      void this.resolveWikiLinks(result.wikiTargets, generation);
      await enhanceMarkdown(this.preview, { theme, signal: controller.signal });
      if (generation !== this.renderId || controller.signal.aborted || revision !== this.documentRevision) return;
      this.collectAnchors();
      this.scheduleScroll();
    } catch {
      if (generation !== this.renderId || revision !== this.documentRevision) return;
      this.preview.replaceChildren();
      const message = document.createElement('p');
      message.className = 'notice';
      message.textContent = '미리보기를 표시할 수 없습니다. 원문 입력은 유지됩니다.';
      this.preview.append(message);
    }
  }

  /** 위키 대상만 비동기로 연결하며 입력 원문·도식 DOM은 다시 만들지 않음. */
  private async resolveWikiLinks(titles: readonly string[], generation: number): Promise<void> {
    if (!this.resolveWiki || !titles.length) return;
    const controller = new AbortController();
    this.wikiAbort = controller;
    try {
      const targets = await this.resolveWiki(titles, controller.signal);
      if (controller.signal.aborted || generation !== this.renderId) return;
      for (const node of this.preview.querySelectorAll<HTMLElement>('[data-wiki-title]')) {
        const title = node.dataset.wikiTitle ?? '';
        const url = targets.get(title);
        if (!url) { node.title = '아직 출간된 대상을 찾지 못했습니다.'; continue; }
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.className = 'ken-wiki-link'; link.dataset.wikiTitle = title;
        link.title = '공개 글을 새 탭에서 열기 · 최신 변경은 Pages 배포 후 반영';
        link.append(...Array.from(node.childNodes));
        node.replaceWith(link);
      }
    } catch {
      if (controller.signal.aborted || generation !== this.renderId) return;
      for (const node of this.preview.querySelectorAll<HTMLElement>('[data-wiki-title]'))
        node.title = '대상 확인에 실패했습니다. 다음 미리보기 갱신 때 다시 확인합니다.';
    } finally {
      if (this.wikiAbort === controller) this.wikiAbort = null;
    }
  }

  /** 렌더 결과가 같은 도식과 이미지를 이동해 입력 때 크기가 0으로 돌아가는 현상을 막는다. */
  private reuseUnchangedMedia(fragment: DocumentFragment): void {
    const available = new Map<string, HTMLElement[]>();
    for (const block of this.preview.querySelectorAll<HTMLElement>('.ken-mermaid')) {
      const source = block.dataset.mermaidSource;
      if (!source) continue;
      const list = available.get(source) ?? [];
      list.push(block); available.set(source, list);
    }
    for (const block of fragment.querySelectorAll<HTMLElement>('.ken-mermaid')) {
      const old = available.get(block.dataset.mermaidSource ?? '')?.shift();
      if (!old) continue;
      if (block.dataset.sourceLine) old.dataset.sourceLine = block.dataset.sourceLine;
      else delete old.dataset.sourceLine;
      block.replaceWith(old);
    }
    const imageKey = (image: HTMLImageElement): string => {
      const light = image.dataset.lightSrc ?? image.getAttribute('src') ?? '';
      const dark = image.dataset.darkSrc ?? '';
      return JSON.stringify([new URL(light, document.baseURI).href,
        dark ? new URL(dark, document.baseURI).href : '', image.alt]);
    };
    const images = new Map<string, HTMLImageElement[]>();
    for (const image of this.preview.querySelectorAll<HTMLImageElement>('img.ken-attachment')) {
      const key = imageKey(image); const list = images.get(key) ?? [];
      list.push(image); images.set(key, list);
    }
    for (const image of fragment.querySelectorAll<HTMLImageElement>('img.ken-attachment')) {
      const old = images.get(imageKey(image))?.shift();
      if (old) image.replaceWith(old);
    }
  }

  private collectAnchors(): void {
    const rootTop = this.preview.getBoundingClientRect().top;
    const scrollTop = this.preview.scrollTop;
    const blocks = Array.from(this.preview.querySelectorAll<HTMLElement>('[data-source-line]'));
    for (const old of this.observedBlocks) {
      if (!blocks.includes(old)) { this.resizeObserver.unobserve(old); this.observedBlocks.delete(old); }
    }
    for (const block of blocks) {
      if (!this.observedBlocks.has(block)) { this.resizeObserver.observe(block); this.observedBlocks.add(block); }
    }
    const mapped = blocks
      .map((node) => ({ line: Number(node.dataset.sourceLine), top: node.getBoundingClientRect().top - rootTop + scrollTop }))
      .filter((entry) => Number.isInteger(entry.line) && entry.line >= 1)
      .sort((a, b) => a.line - b.line || a.top - b.top);
    this.anchors = [{ line: 1, top: 0 }, ...mapped];
  }

  private scheduleScroll(): void {
    if (this.scrollFrame) return;
    this.scrollFrame = window.requestAnimationFrame(() => { this.scrollFrame = 0; this.syncScroll(); });
  }

  private syncScroll(): void {
    if (this.mappedRevision !== this.documentRevision || this.composing || !this.view.dom.isConnected) return;
    const source = this.view.scrollDOM;
    const sourceMax = Math.max(0, source.scrollHeight - source.clientHeight);
    const targetMax = Math.max(0, this.preview.scrollHeight - this.preview.clientHeight);
    if (sourceMax === 0 || targetMax === 0) { this.preview.scrollTop = 0; return; }
    if (source.scrollTop <= 3) { this.preview.scrollTop = 0; return; }
    if (source.scrollTop >= sourceMax - 3) { this.preview.scrollTop = targetMax; return; }
    const screenTop = source.getBoundingClientRect().top + source.clientHeight * 0.15;
    const lineBlock = this.view.lineBlockAtHeight((screenTop - this.view.documentTop) / this.view.scaleY);
    const line = this.view.state.doc.lineAt(lineBlock.from).number;
    const anchors = this.anchors;
    let lower = anchors[0];
    let upper: Anchor | null = null;
    for (let index = 1; index < anchors.length; index++) {
      if (anchors[index].line > line) { upper = anchors[index]; break; }
      lower = anchors[index];
    }
    const fraction = upper ? (line - lower.line) / Math.max(1, upper.line - lower.line) :
      (line - lower.line) / Math.max(1, this.view.state.doc.lines - lower.line);
    const upperTop = upper?.top ?? this.preview.scrollHeight;
    const targetTop = lower.top + fraction * (upperTop - lower.top) - this.preview.clientHeight * 0.15;
    this.preview.scrollTop = Math.min(targetMax, Math.max(0, targetTop));
  }
}
