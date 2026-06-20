"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ApiFailure, apiFailureMessage } from "@/lib/api";
import { positiveId } from "@/lib/editor-drafts";
import { useAuth } from "./auth-provider";

/** URL의 다음 경로를 사이트 내부 정적 경로로만 제한한다. */
function returnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[%\\\u0000-\u001f\u007f]/.test(value)) return "/tech/";
  try {
    const url = new URL(value, "https://ken-blog.invalid");
    const known = new Set(["/", "/tech/", "/post/", "/projects/", "/notes/", "/write/", "/admin/drafts/"]);
    if (url.origin !== "https://ken-blog.invalid" || !known.has(url.pathname) || url.hash) return "/tech/";
    if (url.pathname === "/post/" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.searchParams.get("slug") ?? "")) return "/tech/";
    if (url.pathname === "/write/") {
      const entries = [...url.searchParams.entries()];
      if (entries.length > 1 || (entries.length === 1 &&
        (!new Set(["postId", "draftId"]).has(entries[0][0]) || positiveId(entries[0][1]) === null))) return "/tech/";
    } else if (url.pathname === "/admin/drafts/") {
      const entries = [...url.searchParams.entries()];
      if (entries.length > 1 || (entries.length === 1 && (entries[0][0] !== "page" ||
        !/^(0|[1-9]\d*)$/.test(entries[0][1]) || !Number.isSafeInteger(Number(entries[0][1]))))) return "/tech/";
    } else if (url.pathname !== "/post/" && url.pathname !== "/tech/" && url.search) return "/tech/";
    return `${url.pathname}${url.search}`;
  } catch { return "/tech/"; }
}

/** 계정명·비밀번호와 CSRF 세션 로그인 결과만 다루는 읽기 단계 로그인 폼. */
export function LoginForm() {
  const router = useRouter();
  const auth = useAuth();
  const destination = returnPath(useSearchParams().get("returnTo"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");

  /** 비밀번호를 보관·기록하지 않고 현재 서버 세션이 성립할 때만 이동한다. */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setError("");
    setBusy(true);
    try {
      await auth.login(username, password);
      setPassword("");
      router.replace(destination);
    } catch (failure) {
      setPassword("");
      if (failure instanceof ApiFailure && failure.status === 401) setError("계정명 또는 비밀번호를 확인해 주세요.");
      else setError(apiFailureMessage(failure));
    } finally { pending.current = false; setBusy(false); }
  }

  return <main id="main-content" className="login-page">
    <section className="login-card card" aria-labelledby="login-title">
      <h1 id="login-title">로그인</h1>
      {auth.status === "authenticated" ? <div className="login-done"><p>{auth.user?.username} 계정으로 로그인되어 있습니다.</p>
        <Link href={destination} className="primary-button">글 보러 가기</Link></div> :
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="username">계정명</label>
          <input id="username" name="username" type="text" autoComplete="username" required maxLength={120}
            value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} />
          <label htmlFor="password">비밀번호</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required
            value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
        </form>}
    </section>
  </main>;
}
