"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiFailure, apiJson, apiRequest, fetchCsrf, parseCurrentUser, type CurrentUser } from "@/lib/api";
import { uploadAttachment, type UploadedAttachment } from "@/lib/attachments";

type Session = { status: "checking" | "guest" | "authenticated" | "error"; user: CurrentUser | null; epoch: number };
type AuthContextValue = Session & {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  expire: () => void;
  readCredentials: (signal?: AbortSignal) => Promise<RequestCredentials>;
  adminRead: (path: string, signal?: AbortSignal) => Promise<unknown>;
  adminWrite: (method: "POST" | "PUT" | "DELETE", path: string, body?: unknown, signal?: AbortSignal) => Promise<unknown>;
  adminUpload: (file: File, signal?: AbortSignal) => Promise<UploadedAttachment>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** 세션 변화 세대를 추적하고 CSRF 원문을 메모리에만 보관하는 인증 경계. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "checking", user: null, epoch: 0 });
  const current = useRef(session);
  const sequence = useRef(0);
  const csrf = useRef<{ headerName: string; token: string } | null>(null);

  /** 기존 데이터 렌더를 즉시 무효화할 새 세션 상태를 적용한다. */
  const commit = useCallback((status: Session["status"], user: CurrentUser | null) => {
    sequence.current += 1;
    const next = { status, user, epoch: sequence.current };
    current.current = next;
    setSession(next);
  }, []);

  /** 인증 실패가 확인되면 CSRF와 이전 권한 화면을 즉시 제거한다. */
  const expire = useCallback(() => {
    csrf.current = null;
    if (current.current.status !== "guest") commit("guest", null);
  }, [commit]);

  /** 저장된 쿠키의 서버 계정을 확인하며 401만 정상적인 익명 상태로 해석한다. */
  const refresh = useCallback(async () => {
    const ticket = sequence.current;
    try {
      const user = parseCurrentUser(await apiJson<unknown>("/api/v1/auth/me", "include"));
      if (ticket !== sequence.current) return;
      const previous = current.current.user;
      if (current.current.status !== "authenticated" || previous?.username !== user.username || previous?.role !== user.role) {
        commit("authenticated", user);
      }
    } catch (error) {
      if (ticket !== sequence.current) return;
      if (error instanceof ApiFailure && error.status === 401) expire();
      else if (current.current.status === "checking") commit("error", null);
    }
  }, [commit, expire]);

  useEffect(() => {
    void refresh();
    const onFocus = () => { if (current.current.status === "authenticated") void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible" && current.current.status === "authenticated") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  /** 로그인 전 CSRF와 로그인 후 회전된 CSRF를 순서대로 받아 서버 세션을 확정한다. */
  const login = useCallback(async (username: string, password: string) => {
    const ticket = ++sequence.current;
    csrf.current = null;
    commit("guest", null);
    try {
      const before = await fetchCsrf();
      const response = await apiRequest("/api/v1/auth/login", "include", {
        method: "POST", body: { username, password }, csrf: before,
      });
      const user = parseCurrentUser(response);
      const after = await fetchCsrf();
      if (ticket + 1 !== sequence.current) throw new ApiFailure("response");
      csrf.current = after;
      commit("authenticated", user);
    } catch (error) {
      csrf.current = null;
      if (ticket + 1 === sequence.current) commit("guest", null);
      throw error;
    }
  }, [commit]);

  /** 화면의 개인 데이터를 먼저 비우고 CSRF 보호를 거쳐 서버 세션을 삭제한다. */
  const logout = useCallback(async () => {
    const token = csrf.current;
    csrf.current = null;
    commit("guest", null);
    const usable = token ?? await fetchCsrf();
    await apiRequest("/api/v1/auth/logout", "include", { method: "POST", csrf: usable });
  }, [commit]);

  /** 인증된 조회마다 `/me`를 먼저 확인해 만료된 세션의 PRIVATE 데이터를 다시 받지 않는다. */
  const readCredentials = useCallback(async (signal?: AbortSignal): Promise<RequestCredentials> => {
    if (current.current.status !== "authenticated") return "omit";
    const ticket = sequence.current;
    try {
      parseCurrentUser(await apiJson<unknown>("/api/v1/auth/me", "include", signal));
      if (ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      return "include";
    } catch (error) {
      if (signal?.aborted || ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      if (error instanceof ApiFailure && error.status === 401) expire();
      throw error;
    }
  }, [expire]);

  /** ADMIN 세대와 서버 세션을 확인하고 관리자 원문만 credential 요청으로 읽는다. */
  const adminRead = useCallback(async (path: string, signal?: AbortSignal): Promise<unknown> => {
    if (current.current.status !== "authenticated" || current.current.user?.role !== "ADMIN") throw new ApiFailure("http", 403);
    const ticket = sequence.current;
    try {
      if (await readCredentials(signal) !== "include" || ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      const value = await apiJson<unknown>(path, "include", signal);
      if (ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      return value;
    } catch (error) {
      if (signal?.aborted || ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      if (error instanceof ApiFailure && error.status === 401) expire();
      else if (error instanceof ApiFailure && error.status === 403) await refresh();
      throw error;
    }
  }, [readCredentials, expire, refresh]);

  /** CSRF 원문을 화면에 노출하지 않고 ADMIN 쓰기를 실행하며 세대 변경 응답을 폐기한다. */
  const adminWrite = useCallback(async (method: "POST" | "PUT" | "DELETE", path: string, body?: unknown,
    signal?: AbortSignal): Promise<unknown> => {
    if (current.current.status !== "authenticated" || current.current.user?.role !== "ADMIN") throw new ApiFailure("http", 403);
    const ticket = sequence.current;
    try {
      if (await readCredentials(signal) !== "include" || ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      const token = csrf.current ?? await fetchCsrf(signal);
      if (ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      csrf.current = token;
      const value = await apiRequest(path, "include", { method, body, csrf: token, signal });
      if (ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      return value;
    } catch (error) {
      if (signal?.aborted || ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      if (error instanceof ApiFailure && error.status === 401) expire();
      else if (error instanceof ApiFailure && error.status === 403) {
        csrf.current = null;
        await refresh();
      }
      throw error;
    }
  }, [readCredentials, expire, refresh]);

  /** 현재 ADMIN 세션과 CSRF로 이미지 한 파일을 올리고 변경된 세대의 응답을 버린다. */
  const adminUpload = useCallback(async (file: File, signal?: AbortSignal): Promise<UploadedAttachment> => {
    if (current.current.status !== "authenticated" || current.current.user?.role !== "ADMIN") throw new ApiFailure("http", 403);
    const ticket = sequence.current;
    try {
      if (await readCredentials(signal) !== "include" || ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      const token = csrf.current ?? await fetchCsrf(signal);
      if (ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      csrf.current = token;
      const value = await uploadAttachment(file, token, signal);
      if (ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      return value;
    } catch (error) {
      if (signal?.aborted || ticket !== sequence.current) throw new DOMException("Session changed", "AbortError");
      if (error instanceof ApiFailure && error.status === 401) expire();
      else if (error instanceof ApiFailure && error.status === 403) { csrf.current = null; await refresh(); }
      throw error;
    }
  }, [readCredentials, expire, refresh]);

  return <AuthContext.Provider value={{ ...session, login, logout, refresh, expire, readCredentials, adminRead, adminWrite, adminUpload }}>{children}</AuthContext.Provider>;
}

/** 페이지와 공통 셸에서 동일한 현재 서버 세션 상태를 읽는다. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
