import 'katex/dist/katex.min.css';
import './article.css';
import { enhanceMarkdown } from '../shared/enhance';
import { connectTableOfContents } from './toc';

/**
 * 현재 문서의 본문 상호작용과 테마별 도식 갱신
 */
function enhance() {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  document.querySelectorAll<HTMLElement>('.markdown-body').forEach(root => { void enhanceMarkdown(root, { theme }); });
}

// 정적 상세 페이지에서만 본문·목차 초기화
enhance();
connectTableOfContents();
document.addEventListener('site-theme', enhance);
