import StatusPanel from "./status-panel";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** 정적 홈에 API 연결 결과와 현재·후속 구조의 아키텍처 도면 표시. */
export default function HomePage() {
  return (
    <main className="home">
      <h1>Ken Blog</h1>
      <p>프로젝트를 준비하고 있습니다.</p>
      <StatusPanel />
      <section className="architecture" aria-labelledby="architecture-title">
        <h2 id="architecture-title">서비스 구성</h2>
        <p>현재 프론트는 GitHub Pages의 정적 파일이며, Spring API와의 연결은 공개 HTTPS 주소가 준비되면 설정합니다.</p>
        <figure>
          <picture>
            <source media="(prefers-color-scheme: dark)" srcSet={`${basePath}/architecture/architecture.dark.svg`} />
            <img src={`${basePath}/architecture/architecture.svg`} alt="현재 GitHub Pages 프론트와 Spring API, 후속 데이터 저장소를 구분한 아키텍처 도면" />
          </picture>
          <figcaption>실선은 현재 구성, 후속 저장소는 계획 단계.</figcaption>
        </figure>
        <p className="architecture-links">
          <a href={`${basePath}/architecture/architecture.svg`}>라이트 도면 크게 보기</a>
          <a href={`${basePath}/architecture/architecture.dark.svg`}>다크 도면 크게 보기</a>
        </p>
      </section>
    </main>
  );
}
