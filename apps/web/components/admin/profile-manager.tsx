"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ApiFailure, apiFailureMessage, apiJson } from "@/lib/api";
import { parseProfile, publicImageUrl, type HomeProfile } from "@/lib/profile";
import { useAuth } from "../auth-provider";
import { ProfileCard } from "../profile-card";

/** {@link ProfileCard}의 로컬 미리보기와 공개 프로필 저장본을 사진까지 분리해 관리한다. */
export function ProfileManager() {
  const auth = useAuth();
  const [saved, setSaved] = useState<HomeProfile | null>(null);
  const [form, setForm] = useState<HomeProfile | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [photoMode, setPhotoMode] = useState<"keep" | "upload" | "remove">("keep");
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const profile = parseProfile(await apiJson<unknown>("/api/v1/profile", "omit", controller.signal));
        if (!controller.signal.aborted) { setSaved(profile); setForm(profile); setStatus(""); }
      } catch (failure) { if (!controller.signal.aborted) setStatus(apiFailureMessage(failure)); }
    })();
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /** 선택한 파일은 {@link ProfileCard}의 브라우저 미리보기에만 적용한다. */
  function choosePhoto(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith("image/") || next.size === 0 || next.size > 10 * 1024 * 1024) {
      setStatus("10MiB 이하 이미지 파일을 선택해 주세요."); return;
    }
    setFile(next); setPhotoMode("upload"); setStatus("");
  }

  /** {@link parseProfile}로 단일 저장 응답을 확인하고 그때만 홈 공개본을 갱신한다. */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!form) return;
    setBusy(true); setStatus("");
    try {
      const fields = new FormData();
      fields.set("profile", new Blob([JSON.stringify({ name: form.name, tagline: form.tagline, intro: form.intro,
        github: form.github, phone: form.phone })], { type: "application/json" }));
      if (photoMode === "upload" && file) fields.set("file", file);
      fields.set("removePhoto", String(photoMode === "remove"));
      const result = parseProfile(await auth.adminForm("POST", "/api/v1/admin/profile/save", fields));
      setSaved(result); setForm(result); setFile(null); setPreview(null); setPhotoMode("keep"); setStatus("저장했습니다.");
    } catch (failure) { setStatus(failure instanceof ApiFailure && failure.status === 415 ?
      "지원하지 않는 사진 형식입니다. PNG, JPEG 또는 WebP 이미지를 선택해 주세요." : apiFailureMessage(failure)); }
    finally { setBusy(false); }
  }

  /** saved의 마지막 확정 값으로 입력·사진 선택을 되돌린다. */
  function reset() { setForm(saved); setFile(null); setPreview(null); setPhotoMode("keep"); setStatus(""); }
  const photo = photoMode === "remove" ? null : photoMode === "upload" ? preview : publicImageUrl(form?.photoUrl ?? null);
  if (!form) return <div className="message-card card" role={status ? "alert" : "status"}>{status || "홈 소개를 불러오고 있습니다…"}
    {status && <button type="button" className="small-button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button>}</div>;

  return <div className="profile-manager"><form className="admin-form card" onSubmit={(event) => void save(event)}><fieldset disabled={busy}>
    <div className="profile-photo-control"><span className="profile-edit-avatar" aria-label="현재 프로필 사진">
      {photo ? <Image src={photo} alt="" width={64} height={64} unoptimized /> : form.name.trim().slice(0, 1) || "?"}</span>
      <div><label className="small-button profile-upload-button">사진 올리기<input type="file" accept="image/*"
        onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)} /></label>
        {(photo || form.photoUrl) && <button type="button" className="small-button" onClick={() => {
          setFile(null); setPreview(null); setPhotoMode("remove"); }}>사진 빼기</button>}</div></div>
    {(["name", "tagline", "intro", "github", "phone"] as const).map((key) => <label key={key}>
      {{ name: "이름", tagline: "한 줄 소개", intro: "소개", github: "GitHub", phone: "연락처" }[key]}
      {key === "intro" ? <textarea rows={5} value={form[key]} onChange={(event) => setForm((current) => current &&
        ({ ...current, [key]: event.target.value }))} placeholder="두세 줄 정도" /> : <input value={form[key]}
          type={key === "github" ? "url" : key === "phone" ? "tel" : "text"}
          placeholder={{ name: "표시될 이름", tagline: "이름 옆에 붙는 한 줄", github: "https://github.com/아이디",
            phone: "비워 두면 홈에 안 보입니다" }[key]}
          onChange={(event) => setForm((current) => current && ({ ...current, [key]: event.target.value }))} />}</label>)}
    <div className="admin-form-actions"><button type="button" className="small-button" onClick={reset}>되돌리기</button>
      <button type="submit" className="primary-button" disabled={busy}>{busy ? "저장 중…" : "저장"}</button></div>
    {status && <p role="status">{status}</p>}</fieldset>
  </form><div className="profile-preview"><div className="profile-preview-heading"><h2>미리보기</h2>
    <Link href="/" className="small-button">홈에서 보기</Link></div><ProfileCard profile={form} previewPhoto={photo} /></div></div>;
}
