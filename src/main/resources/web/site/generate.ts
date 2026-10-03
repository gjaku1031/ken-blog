import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import nunjucks from "nunjucks";
import { deploymentManifest } from "../shared/deployment-status.ts";

/**
 * 문서 이동 정보
 */
interface Navigation {
  /**
   * ID
   */
  id: number;

  /**
   * 공개 주소 식별자
   */
  slug: string;

  /**
   * 제목
   */
  title: string;

  /**
   * 표시 순서
   */
  order: number }

/**
 * 시리즈 참조
 */
interface SeriesRef {
  /**
   * ID
   */
  id: number;

  /**
   * 공개 주소 식별자
   */
  slug: string;

  /**
   * 이름
   */
  name: string;

  /**
   * 시리즈 종류
   */
  kind: "TECH" | "PROJECT" }

/**
 * 게시글 메타데이터
 */
interface Post {
  /**
   * ID
   */
  id: number;

  /**
   * 공개 주소 식별자
   */
  slug: string;

  /**
   * 제목
   */
  title: string;

  /**
   * 요약
   */
  summary: string;

  /**
   * 탐색 구획
   */
  section: "TECH" | "PROJECT";

  /**
   * 최초 출간 시각
   */
  publishedAt: string;

  /**
   * 한국 시간 기준 출간 날짜
   */
  publishedDate: string;

  /**
   * 태그 목록
   */
  tags: string[];

  /**
   * 이전 공개 경로
   */
  legacyPath: string | null;

  /**
   * 분류
   */
  category: {
    /**
     * 분류 경로
     */
    path: string
  } | null;

  /**
   * 시리즈
   */
  series: (SeriesRef & {
    /**
     * 조회 결과 목록
     */
    items: Navigation[];

    /**
     * 문서 내 위치
     */
    position: number
  }) | null;

  /**
   * 관련 프로젝트 시리즈
   */
  relatedSeries: SeriesRef | null;

  /**
   * 본문 렌더 결과
   */
  rendered: {
    /**
     * 렌더된 HTML
     */
    html: string;

    /**
     * 목차 항목
     */
    headings: {
      /**
       * ID
       */
      id: string;

      /**
       * 표시 문구
       */
      label: string;

      /**
       * 분류 깊이
       */
      depth: number
    }[];

    /**
     * 위키 대상 제목 목록
     */
    wikiTargets: string[]
  };

  /**
   * 검색용 본문 텍스트
   */
  searchBody?: string;
}

/**
 * 시리즈 속성과 기술 목록
 */
interface Series extends SeriesRef {
  /**
   * 정렬 순서
   */
  sortOrder: number;

  /**
   * 첫 출간 문서, 없으면 null
   */
  cover: Navigation;

  /**
   * 설명
   */
  description: string;

  /**
   * 문서 수
   */
  postCount: number;

  /**
   * 프로젝트 진행 상태
   */
  projectStatus: string | null;

  /**
   * 시작 연월
   */
  startPeriod: string | null;

  /**
   * 종료 연월
   */
  endPeriod: string | null;

  /**
   * 선택 순서의 기술 뱃지 목록
   */
  stackBadges: {
    /**
     * ID
     */
    id: number;

    /**
     * 이름
     */
    name: string;

    /**
     * 공개 이미지 URL
     */
    imageUrl: string
  }[];
}

/**
 * 정적 사이트 생성 입력
 */
interface Input {
  /**
   * 공개 메타데이터 스냅샷
   */
  snapshot: {
    /**
     * 스냅샷 계약 버전
     */
    version: number;

    /**
     * 게시글 목록
     */
    posts: Post[];

    /**
     * 시리즈
     */
    series: Series[]
  };

  /**
   * 공개 화면 자산 경로
   */
  assets: {
    /**
     * CSS 자산 경로
     */
    css: string;

    /**
     * JavaScript 자산 경로
     */
    js: string
  };

  /**
   * 관리자 화면 주소
   */
  adminHref: string;

  /**
   * 관리자 화면 연결·자산 정보
   */
  admin: {
    /**
     * API 기준 URL
     */
    apiBase: string;

    /**
     * CSS 자산 경로
     */
    css: string;

    /**
     * JavaScript 자산 경로
     */
    js: string
  };
}

/**
 * 사이트 기준 경로
 */
const BASE = "/ken-blog/";

/**
 * 공개 사이트 출처
 */
const ORIGIN = "https://gjaku1031.github.io";

/**
 * 사이트 기준 경로 결합
 */
const route = (path = "") => BASE + path;

/**
 * 공개 주소 식별자 형식 검사
 */
function slug(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error("공개 slug 형식 오류");
  return value;
}

/**
 * 검증된 글 주소 생성
 */
const postPath = (post: {
  /**
   * 공개 주소 식별자
   */
  slug: string
}) => route(`post/${slug(post.slug)}/`);

/**
 * 날짜 표시 형식 변환
 */
const date = (value: string) => value.slice(0, 10).replaceAll("-", ".");

/**
 * 탐색 구획 표시명
 */
const label = (section: string) => section === "PROJECT" ? "Projects" : "Posts";

/**
 * 빈 값과 중복을 제거하고 정렬
 */
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();

/**
 * 출간 시각·ID 오름차순 비교
 */
const chronological = (a: Post, b: Post) => a.publishedAt.localeCompare(b.publishedAt) || a.id - b.id;

/**
 * 위키 제목의 대소문자 비교 키 생성
 */
const wikiKey = (title: string) => title.toLocaleLowerCase("und");

/**
 * 렌더된 본문에서 검색용 텍스트 추출
 */
function searchText(html: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html.replace(/<[^>]*>/g, " ").replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi, (entity, code: string) => {
    code = code.toLowerCase();
    if (!code.startsWith("#")) return named[code] ?? entity;
    const number = code.startsWith("#x") ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return number >= 32 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : " ";
  }).replace(/\s+/g, " ").trim();
}

/**
 * 프로젝트 시작·종료 연월 표시
 */
function period(project: Series): string {
  const start = project.startPeriod ?? "", end = project.endPeriod ?? "";
  if (!start) return end;
  if (!end) return project.projectStatus === "DONE" ? start : `${start} – 현재`;
  return start === end ? start : `${start} – ${end}`;
}

/**
 * 분류 경로를 누적 경로·표시 이름으로 분리
 */
function categoryTrail(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }));
}

/**
 * 공개 글 수를 집계한 대분류·소분류 탐색 트리 생성
 */
function categoryTree(posts: Post[]) {
  const roots = new Map<string, {
    /**
     * 이름
     */
    name: string;

    /**
     * 분류 경로
     */
    path: string;

    /**
     * 분류의 직접 글과 하위 글 수 합산
     */
    count: number;

    /**
     * 하위 분류 목록
     */
    children: {
      /**
       * 이름
       */
      name: string;

      /**
       * 분류 경로
       */
      path: string;

      /**
       * 분류의 직접 글과 하위 글 수 합산
       */
      count: number
    }[]
  }>();
  for (const post of posts) {
    const [parent, child] = categoryTrail(post.category?.path ?? '');
    if (!parent) continue;
    let root = roots.get(parent.path);
    if (!root) { root = { ...parent, count: 0, children: [] }; roots.set(parent.path, root); }
    root.count++;
    if (child) {
      let item = root.children.find(item => item.path === child.path);
      if (!item) { item = { ...child, count: 0 }; root.children.push(item); }
      item.count++;
    }
  }
  const sorted = [...roots.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  for (const root of sorted) root.children.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return sorted;
}

/**
 * 공개 글을 목록 카드 데이터로 변환
 */
function card(post: Post) {
  const categoryPath = post.category?.path ?? "", context = post.series && post.series.slug !== categoryPath ? post.series.name : "";
  const tags = post.section === "PROJECT" ? [] : post.tags;
  return { ...post, tags, href: postPath(post), categoryPath, categoryTrail: categoryTrail(categoryPath), context, tagText: tags.join("|"), label: label(post.section),
    searchText: `${post.title} ${post.summary} ${categoryPath} ${tags.join(" ")} ${context} ${post.searchBody ?? ""}`,
    displayDate: date(post.publishedDate) };
}

/**
 * 검증·렌더링된 공개 데이터만 받아 완성 문서를 생성
 * DB·Spring 실행 의존성 없음
 *
 * 1. 스냅샷 검증과 프로필 자산·공통 템플릿 준비
 * 2. 관리·작성 전용 페이지 생성
 * 3. 위키 대표 대상과 역링크 구성
 * 4. 공개 목록·검색·프로젝트·글 상세 생성
 * 5. 과거 주소 이동과 사이트맵·경로 목록 생성
 */
export async function generateSite(payload: Input, output: string) {
  // 스냅샷 검증과 프로필 자산·공통 템플릿 준비
  const { snapshot, assets, admin } = payload;
  if (snapshot.version !== 2) throw new Error("공개 스냅샷 버전 오류");
  await mkdir(join(output, "assets"), { recursive: true });
  await copyFile(join(import.meta.dirname, "../public/profile-placeholder.svg"), join(output, "assets/profile-placeholder.svg"));
  const engine = new nunjucks.Environment(new nunjucks.FileSystemLoader(join(import.meta.dirname, "templates")), {
    autoescape: true, throwOnUndefined: true,
  });
  engine.addFilter("query", (value: string) => encodeURIComponent(value));
  const pages: string[] = [];

  /**
   * 출력 경로의 디렉터리 준비 후 파일 기록
   */
  const write = async (path: string, content: string) => {
    const file = join(output, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  };

  /**
   * 화면 종류에 맞는 공통 헤더 데이터 구성
   */
  const header = (section: string) => ({
    base: BASE, section, adminHref: payload.adminHref,
    nav: [["posts/", "Posts"], ["projects/", "Projects"]].map(([href, label]) => ({ href: route(href), label, active: label === section })),
  });
  // 배포가 성공한 산출물에만 노출되는 공개 메타데이터 지문 기록
  await write("deployment.json", JSON.stringify(await deploymentManifest(snapshot)));
  // 관리자 데이터는 포함하지 않고 로그인 화면과 API·자산 주소만 전달
  // 관리·작성 전용 페이지 생성
  await write("manage/index.html", engine.render("manage.njk", { apiBase: admin.apiBase, adminCss: admin.css, adminJs: admin.js, editor: "", ...header("Manage") }));
  for (const [path, editor] of [["posts", "post"], ["projects", "project"]])
    await write(`${path}/new/index.html`, engine.render("manage.njk", { apiBase: admin.apiBase, adminCss: admin.css, adminJs: admin.js, editor, ...header(editor === "project" ? "Projects" : "Posts") }));

  /**
   * 공통 레이아웃과 화면 템플릿으로 HTML 생성
   */
  async function page(path: string, view: string, section: string, title: string, description: string,
    data: Record<string, unknown> = {}, sitemap = true) {
    const canonical = ORIGIN + route(path === "404.html" ? path : path ? `${path}/` : "");
    const documentTitle = section === "Search" ? "ken.blog" : `${title} | ken.blog`;
    const summary = section === "Search" ? "일반 글과 프로젝트 기록을 읽는 ken.blog" : description;
    const article = ["Post", "Project"].includes(section) && !!path;
    const active = ({ Post: "Posts", Project: "Projects" } as Record<string, string>)[section] ?? section;
    const nav = header(active).nav;
    await write(path === "404.html" ? path : join(path, "index.html"), engine.render("page.njk", {
      view, section, documentTitle, socialTitle: article ? title : documentTitle, summary, canonical,
      ogType: article ? "article" : "website", base: BASE, assetsCss: route(`assets/${assets.css}`), assetsJs: route(`assets/${assets.js}`),
      adminHref: payload.adminHref, apiBase: admin.apiBase, nav, year: new Date().getUTCFullYear(), github: "https://github.com/gjaku1031/ken-blog", ...data,
    }));
    if (sitemap) pages.push(path);
  }

  /**
   * 글 목록 페이지 생성
   */
  async function listing(path: string, section: string, title: string, rows: Post[]) {
    const cards = rows.map(card);
    await page(path, "listing", section, title, `${title} 공개 글 목록`, {
      heading: section === "Search" ? "최근 글" : title, cards,
      categories: categoryTree(rows), tags: unique(cards.flatMap(c => c.tags)),
      sidebarSeries: snapshot.series.filter(s => s.kind === "TECH")
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
        .map(s => ({ name: s.name, count: s.postCount, href: postPath(s.cover) })),
      searching: section === "Search",
    });
  }
  // 위키 대표 대상과 역링크 구성
  const allPosts = snapshot.posts;
  const targets = new Map<string, Post>();
  for (const post of [...allPosts].sort(chronological)) if (!targets.has(wikiKey(post.title))) targets.set(wikiKey(post.title), post);
  const backlinks = new Map<string, {
    /**
     * 이동 주소
     */
    href: string;

    /**
     * 제목
     */
    title: string;

    /**
     * 탐색 구획
     */
    section: string
  }[]>();
  for (const source of allPosts) for (const title of source.rendered.wikiTargets) {
    const target = targets.get(wikiKey(title));
    if (!target || target.id === source.id) continue;
    const refs = backlinks.get(postPath(target)) ?? [];
    refs.push({ href: postPath(source), title: source.title, section: label(source.section) });
    backlinks.set(postPath(target), refs);
  }
  // 공개 목록·검색·프로젝트·글 상세 생성
  const feed = [...allPosts].sort((a, b) => chronological(b, a));
  await listing("posts", "Posts", "Posts", feed.filter(p => p.section === "TECH"));
  const status: Record<string, string> = { PLAN: "기획 중", DEV: "개발 중", MAINT: "유지보수 중", DONE: "완료" };
  const projects = snapshot.series.filter(s => s.kind === "PROJECT").sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map(p => ({ ...p, href: postPath(p.cover), statusLabel: status[p.projectStatus ?? ""] ?? p.projectStatus ?? "",
      statusClass: (p.projectStatus ?? "").toLowerCase(), period: period(p) }));
  await page("projects", "projects", "Projects", "Projects", "공개 프로젝트 목록", { projects });
  await listing("search", "Search", "Search", feed.map(p => ({ ...p, searchBody: searchText(p.rendered.html) })));
  for (const post of allPosts) {
    const navigation = post.series;
    const series = (navigation?.items ?? []).map(item => ({ ...item, href: postPath(item), current: item.id === post.id }));
    const currentIndex = series.findIndex(item => item.current);
    const previousPost = currentIndex > 0 ? series[currentIndex - 1] : null;
    const nextPost = currentIndex >= 0 ? series[currentIndex + 1] ?? null : null;
    const project = projects.find(p => p.id === navigation?.id && p.slug === navigation?.slug) ?? null;
    const relatedProject = projects.find(p => p.id === post.relatedSeries?.id) ?? null;
    await page(`post/${slug(post.slug)}`, "post", post.section === "PROJECT" ? "Project" : "Post", post.title, post.summary, {
      post: { ...post, categoryTrail: categoryTrail(post.category?.path ?? ""), displayDate: date(post.publishedDate), relatedProject }, project, html: post.rendered.html,
      toc: post.rendered.headings.filter(h => h.depth === 2 || h.depth === 3), backlinks: backlinks.get(postPath(post)) ?? [],
      series, previousPost, nextPost, seriesName: navigation?.name ?? "", seriesPosition: navigation?.position ?? 0,
    });
  }
  // 공개 대상에 한해 옛 주소를 생성하고 프로젝트 루트는 현재 첫 글로 연결
  // 과거 주소 이동과 사이트맵·경로 목록 생성
  const aliases = new Map([["", route("posts/")], ["tech", route("posts/")], ["post", route("posts/")], ["project", route("projects/")],
    ["notes", route("posts/")], ["course", route("posts/")]]);
  for (const group of snapshot.series) {
    const target = postPath(group.cover);
    aliases.set(`series/${slug(group.slug)}`, target);
    aliases.set(`${group.kind === "PROJECT" ? "project" : "course"}/${slug(group.slug)}`, target);
  }
  for (const post of allPosts) {
    const old = post.legacyPath?.replace(/^\/+|\/+$/g, "");
    if (!old) continue;
    if (!/^(?:project\/[a-z0-9-]+(?:\/docs\/[a-z0-9-]+)?|course\/[a-z0-9-]+\/chapters\/[a-z0-9-]+)$/.test(old))
      throw new Error("이전 공개 경로 형식 오류");
    if (!aliases.has(old)) aliases.set(old, postPath(post));
  }
  for (const [path, target] of aliases) {
    if (!/^\/ken-blog\/(?:posts|projects|post\/[a-z0-9-]+)\/$/.test(target)) throw new Error("이동 대상 경로 오류");
    await write(join(path, "index.html"), engine.render("redirect.njk", { target, canonical: ORIGIN + target, preserveQuery: path === "" }));
  }
  await page("404.html", "missing", "", "페이지 없음", "페이지를 찾을 수 없습니다.", {}, false);
  await write("robots.txt", `User-agent: *\nAllow: /ken-blog/\nSitemap: ${ORIGIN}${route("sitemap.xml")}\n`);
  await write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
    pages.map(path => `<url><loc>${ORIGIN}${route(path ? `${path}/` : "")}</loc></url>`).join("")}</urlset>`);
  await write("routes.json", JSON.stringify(pages.map(path => path ? `${path}/` : "")));
}
