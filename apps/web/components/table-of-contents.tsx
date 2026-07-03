"use client";

import { useEffect, useState } from "react";
import type { TocItem } from "@/lib/table-of-contents";

/** 실제 최상위 제목만 관찰해 현재 위치와 키보드 이동을 표시한다. */
export function TableOfContents({ items }: { items: readonly TocItem[] }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  useEffect(() => {
    setActive(items[0]?.id ?? null);
    if (!items.length) return;
    const headings = items.map((item) => document.getElementById(item.id)).filter((node): node is HTMLElement => !!node);
    if (!headings.length) return;
    const observer = new IntersectionObserver(() => {
      const passed = headings.filter((node) => node.getBoundingClientRect().top <= 150);
      setActive((passed.at(-1) ?? headings[0]).id);
    }, { rootMargin: "-120px 0px -70% 0px", threshold: 0 });
    headings.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [items]);
  if (!items.length) return null;
  return <nav className="post-toc" aria-label="이 글의 목차"><h2>이 글의 목차</h2><ol>
    {items.map((item) => <li key={item.id} className={item.depth === 3 ? "toc-depth-three" : undefined}>
      <a href={`#${encodeURIComponent(item.id)}`} aria-current={active === item.id ? "location" : undefined}
        onClick={(event) => {
          const target = document.getElementById(item.id);
          if (!target) return;
          event.preventDefault();
          history.replaceState(null, "", `#${encodeURIComponent(item.id)}`);
          target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start" });
          target.focus({ preventScroll: true });
          setActive(item.id);
        }}>{item.label}</a></li>)}
  </ol></nav>;
}
