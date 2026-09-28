"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ApiFailure, apiFailureMessage } from "@/lib/api";
import { positiveId } from "@/lib/editor-drafts";
import { validProjectSlug } from "@/lib/projects";
import { useAuth } from "./auth-provider";
import "./auth-design.css";

/** URL의 다음 경로를 사이트 내부 정적 경로로만 제한한다. */
function returnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[%\\\u0000-\u001f\u007f]/.test(value)) return "/tech/";
  try {
    const url = new URL(value, "https://ken-blog.invalid");
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
    const rawPath = basePath && url.pathname.startsWith(`${basePath}/`) ? url.pathname.slice(basePath.length) : url.pathname;
    const pathname = rawPath === "/" ? "/" : rawPath.endsWith("/") ? rawPath : `${rawPath}/`;
    const known = new Set(["/", "/tech/", "/post/", "/projects/", "/project/", "/notes/", "/course/",
      "/write/", "/admin/", "/admin/posts/", "/admin/drafts/", "/admin/categories/",
      "/admin/profile/"]);
    if (url.origin !== "https://ken-blog.invalid" || !known.has(pathname) || url.hash) return "/tech/";
    if (pathname === "/post/") {
      const entries = [...url.searchParams.entries()];
      if (entries.length !== 1 || entries[0][0] !== "slug" || !validProjectSlug(entries[0][1])) return "/tech/";
    } else if (pathname === "/project/" || pathname === "/course/") {
      const entries = [...url.searchParams.entries()];
      const childKey = pathname === "/project/" ? "doc" : "chapter";
      if (entries.length < 1 || entries.length > 2 || entries[0][0] !== "slug" || !validProjectSlug(entries[0][1]) ||
        (entries.length === 2 && (entries[1][0] !== childKey || !validProjectSlug(entries[1][1])))) return "/tech/";
    }
    if (pathname === "/write/") {
      const entries = [...url.searchParams.entries()];
      if (entries.length > 2 || entries.some(([key, entry]) => !new Set(["postId", "draftId", "projectId", "courseId", "section", "title"])
        .has(key) || !entry || entry.length > 160 || key.endsWith("Id") && positiveId(entry) === null)) return "/tech/";
    } else if (pathname === "/admin/drafts/") {
      const entries = [...url.searchParams.entries()];
      if (entries.length > 1 || (entries.length === 1 && (entries[0][0] !== "page" ||
        !/^(0|[1-9]\d*)$/.test(entries[0][1]) || !Number.isSafeInteger(Number(entries[0][1]))))) return "/tech/";
    } else if (pathname !== "/post/" && pathname !== "/project/" && pathname !== "/course/" && pathname !== "/tech/" && url.search)
      return "/tech/";
    return `${pathname}${url.search}`;
  } catch { return "/tech/"; }
}

/** {@link useAuth}의 비밀번호·일회용 코드 검증이 모두 끝난 뒤에만 이동하는 폼. */
export function LoginForm() {
  const router = useRouter();
  const auth = useAuth();
  const destination = returnPath(useSearchParams().get("returnTo"));
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const codeInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");

  /** 인증값을 브라우저 저장소에 남기지 않고 로그인 기억 선택을 서버에 보내며 세션 성립 때만 이동한다. */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const code = verificationCode.trim();
    if (!password || !code || !useRecoveryCode && !/^\d{6}$/.test(code)) {
      setError(useRecoveryCode ? "비밀번호·복구 코드를 확인해 주세요." : "비밀번호·인증 앱의 6자리 코드를 확인해 주세요.");
      return;
    }
    pending.current = true;
    setError("");
    setBusy(true);
    try {
      await auth.login(password, code, rememberMe);
      router.replace(destination);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 401) setError("로그인 정보를 확인해 주세요.");
      else if (failure instanceof ApiFailure && failure.status === 429) setError("로그인 시도가 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.");
      else setError(apiFailureMessage(failure));
    } finally { setPassword(""); setVerificationCode(""); pending.current = false; setBusy(false); }
  }

  /** 코드 종류를 바꿀 때 이전 일회용 값을 폐기하고 새 입력으로 초점을 옮긴다. */
  function switchCodeMode() {
    if (pending.current) return;
    setUseRecoveryCode((current) => !current);
    setVerificationCode(""); setError("");
    requestAnimationFrame(() => codeInput.current?.focus());
  }

  return <main id="main-content" className="login-page">
    <section className="login-card card" aria-labelledby="login-title">
      <h1 id="login-title">관리자 로그인</h1>
      {auth.status === "authenticated" ? <div className="login-done"><p>{auth.user?.username} 계정으로 로그인되어 있습니다.</p>
        <Link href={destination} className="primary-button">글 보러 가기</Link></div> :
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="password">비밀번호</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required placeholder="비밀번호"
            value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
          <label htmlFor="verification-code">{useRecoveryCode ? "복구 코드" : "인증 앱 코드"}</label>
          <input key={useRecoveryCode ? "recovery" : "totp"} id="verification-code" ref={codeInput}
            name="verificationCode" type="text" required autoComplete={useRecoveryCode ? "off" : "one-time-code"}
            inputMode={useRecoveryCode ? "text" : "numeric"} pattern={useRecoveryCode ? undefined : "[0-9]{6}"}
            maxLength={useRecoveryCode ? 64 : 6} spellCheck={false} autoCapitalize="off"
            placeholder={useRecoveryCode ? "복구 코드" : "6자리 코드"} value={verificationCode}
            onChange={(event) => setVerificationCode(useRecoveryCode ? event.target.value : event.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={busy} aria-describedby={useRecoveryCode ? "verification-help" : undefined} />
          {useRecoveryCode && <p id="verification-help" className="login-code-help">보관한 일회용 복구 코드를 입력하세요.</p>}
          <button type="button" className="login-code-switch" onClick={switchCodeMode} disabled={busy}
            aria-controls="verification-code">{useRecoveryCode ? "인증 앱 코드 사용" : "복구 코드 사용"}</button>
          <label className="login-remember">
            <input type="checkbox" name="rememberMe" checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)} disabled={busy} />
            <span>로그인 기억하기</span><span className="login-remember-duration">(30일)</span>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
        </form>}
    </section>
  </main>;
}
