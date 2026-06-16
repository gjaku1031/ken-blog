import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

/** 서버 세션 로그인 폼을 정적 경로에서 클라이언트에 표시한다. */
export default function LoginPage() {
  return <Suspense fallback={<main id="main-content" className="login-page" role="status">로그인 화면을 준비하고 있습니다…</main>}><LoginForm /></Suspense>;
}
