import { Suspense } from "react";
import { PostFeed } from "@/components/post-feed";
import StatusPanel from "./status-panel";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** 실제 Tech 피드를 앞에 두고 배포 구성 도면은 펼쳐 볼 수 있게 보존하는 홈. */
export default function HomePage() {
  return <main id="main-content" className="page-container home-page">
    <h1 className="home-title">ken.blog</h1>
    <Suspense fallback={<div className="message-card card" role="status">글을 준비하고 있습니다…</div>}><PostFeed mode="home" /></Suspense>
    <details className="technical-details card"><summary>서비스 연결과 아키텍처 도면 보기</summary>
      <div className="technical-content"><p>이 화면은 GitHub Pages의 정적 파일입니다. 글·분류·태그와 로그인은 Spring API가 제공합니다. 공개 HTTPS API 주소가 설정되어야 실제 데이터를 볼 수 있습니다.</p>
        <StatusPanel />
        <figure>
          <img className="diagram-light" src={`${basePath}/architecture/architecture.svg`} alt="정적 프론트와 Spring API 및 저장소를 구분한 아키텍처 도면" />
          <img className="diagram-dark" src={`${basePath}/architecture/architecture.dark.svg`} alt="정적 프론트와 Spring API 및 저장소를 구분한 아키텍처 도면" />
          <figcaption>새 프로젝트 구성과 별도 운영 배포의 경계를 도면에서 확인할 수 있습니다.</figcaption></figure>
        <div className="architecture-links"><a href={`${basePath}/architecture/architecture.svg`}>라이트 도면 크게 보기</a>
          <a href={`${basePath}/architecture/architecture.dark.svg`}>다크 도면 크게 보기</a></div>
      </div>
    </details>
  </main>;
}
