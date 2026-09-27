"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiFailure, apiFailureMessage, apiRequest, fetchCsrf } from "@/lib/api";

/** 메일의 일회용 토큰만 읽어 계정 이름과 만료 시각을 확인한다. */
export function InvitationForm() {
  const params = useSearchParams();
  const values = params.getAll("token");
  const token = values.length === 1 && values[0].length > 10 && values[0].length < 1024 ? values[0] : null;
  const [state, setState] = useState<"loading" | "ready" | "done" | "error">("loading");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setState("error"); setError("초대 주소를 확인해 주세요."); return; }
    const controller = new AbortController();
    void (async () => {
      try {
        const csrf = await fetchCsrf(controller.signal);
        const result = await apiRequest("/api/v1/auth/invitations/inspect", "include", {
          method: "POST", body: { token }, csrf, signal: controller.signal });
        if (!result || typeof result !== "object" || !("email" in result) || typeof result.email !== "string" ||
          !("name" in result) || typeof result.name !== "string") throw new ApiFailure("response");
        if (!controller.signal.aborted) { setEmail(result.email); setName(result.name); setState("ready"); }
      } catch (failure) { if (!controller.signal.aborted) { setError(failure instanceof ApiFailure && failure.status === 410 ?
        "만료됐거나 이미 사용한 초대입니다. 관리자에게 새 초대를 요청해 주세요." : apiFailureMessage(failure)); setState("error"); } }
    })();
    return () => controller.abort();
  }, [token]);

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
    {state === "ready" && <form onSubmit={(event) => void complete(event)}><p>{name} · {email}</p>
      <label htmlFor="invite-password">새 비밀번호</label><input id="invite-password" type="password" autoComplete="new-password"
        value={password} onChange={(event) => setPassword(event.target.value)} required />
      <label htmlFor="invite-confirm">비밀번호 확인</label><input id="invite-confirm" type="password" autoComplete="new-password"
        value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
      {error && <p role="alert" className="inline-error">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy}>설정</button></form>}
    {state === "done" && <><p>비밀번호를 설정했습니다.</p><Link href="/login/" className="primary-button">로그인</Link></>}
  </div></main>;
}
