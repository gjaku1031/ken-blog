"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiFailure, apiFailureMessage, apiRequest, fetchCsrf } from "@/lib/api";

/** 링크 fragment의 일회용 토큰을 주소에서 지운 뒤 계정 이름을 확인한다. */
export function InvitationForm() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "done" | "error">("loading");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const initialToken = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (initialToken.current === undefined) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const values = params.getAll("token");
      const accepted = [...params.keys()].every((key) => key === "token") && values.length === 1 &&
        /^[A-Za-z0-9_-]{43}$/.test(values[0]);
      initialToken.current = accepted ? values[0] : null;
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    setToken(initialToken.current);
    setTokenChecked(true);
  }, []);

  useEffect(() => {
    if (!tokenChecked) return;
    if (!token) { setState("error"); setError("초대 주소를 확인해 주세요."); return; }
    const controller = new AbortController();
    void (async () => {
      try {
        const csrf = await fetchCsrf(controller.signal);
        const result = await apiRequest("/api/v1/auth/invitations/inspect", "include", {
          method: "POST", body: { token }, csrf, signal: controller.signal });
        if (!result || typeof result !== "object" || !("username" in result) || typeof result.username !== "string" ||
          !("displayName" in result) || typeof result.displayName !== "string") throw new ApiFailure("response");
        if (!controller.signal.aborted) { setUsername(result.username); setDisplayName(result.displayName); setState("ready"); }
      } catch (failure) { if (!controller.signal.aborted) { setError(failure instanceof ApiFailure && failure.status === 410 ?
        "만료됐거나 이미 사용한 초대입니다. 관리자에게 새 초대를 요청해 주세요." : apiFailureMessage(failure)); setState("error"); } }
    })();
    return () => controller.abort();
  }, [token, tokenChecked]);

  /** 서버가 일회용 토큰을 수락한 뒤에만 비밀번호 설정 완료를 표시한다. */
  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || password !== confirm || password.length < 12) { setError("비밀번호를 12자 이상 입력하고 확인 값을 맞춰 주세요."); return; }
    setBusy(true); setError("");
    try { const csrf = await fetchCsrf(); await apiRequest("/api/v1/auth/invitations/complete", "include", {
      method: "POST", body: { token, password }, csrf }); setState("done"); setPassword(""); setConfirm(""); }
    catch (failure) { setError(failure instanceof ApiFailure && failure.status === 410 ?
      "만료됐거나 이미 사용한 초대입니다. 관리자에게 새 초대를 요청해 주세요." : apiFailureMessage(failure)); }
    finally { setBusy(false); }
  }

  return <main id="main-content" className="login-page"><div className="login-card card"><h1>비밀번호 설정</h1>
    {state === "loading" && <p role="status">초대를 확인하고 있습니다…</p>}
    {state === "error" && <p role="alert">{error}</p>}
    {state === "ready" && <form onSubmit={(event) => void complete(event)}><p>{displayName} · {username}</p>
      <label htmlFor="invite-password">새 비밀번호</label><input id="invite-password" type="password" autoComplete="new-password"
        value={password} onChange={(event) => setPassword(event.target.value)} required />
      <label htmlFor="invite-confirm">비밀번호 확인</label><input id="invite-confirm" type="password" autoComplete="new-password"
        value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy}>설정</button></form>}
    {state === "done" && <><p>비밀번호를 설정했습니다.</p><Link href="/login/" className="primary-button">로그인</Link></>}
  </div></main>;
}
