import Image from "next/image";
import { publicImageUrl, type HomeProfile } from "@/lib/profile";

/** {@link HomeProfile}의 현재 저장본 또는 로컬 미리보기를 카드로 표시한다. */
export function ProfileCard({ profile, previewPhoto }: { profile: HomeProfile; previewPhoto?: string | null }) {
  const imageUrl = previewPhoto === undefined ? publicImageUrl(profile.photoUrl) : previewPhoto;
  const github = profile.github.startsWith("https://github.com/") ? profile.github : null;
  return <section className="profile-card card" aria-label="블로그 소개">
    <div className="profile-head"><div className="profile-avatar">{imageUrl ? <Image src={imageUrl} alt="" width={64} height={64} unoptimized /> :
      <span aria-hidden="true">{profile.name.trim().slice(0, 1) || "K"}</span>}</div>
      <div><h2>{profile.name || "ken.blog"}</h2>{profile.tagline && <p>{profile.tagline}</p>}</div></div>
    {profile.intro && <p className="profile-intro">{profile.intro}</p>}
    <div className="profile-links">{github && <a href={github} target="_blank" rel="noreferrer noopener">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.54v-2.14c-3.09.67-3.74-1.31-3.74-1.31-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15.99 1.7 2.59 1.21 3.22.92.1-.72.39-1.21.71-1.49-2.47-.28-5.07-1.23-5.07-5.49 0-1.21.43-2.2 1.14-2.98-.11-.28-.49-1.41.11-2.94 0 0 .93-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.12-1.44 3.04-1.14 3.04-1.14.61 1.53.23 2.66.12 2.94.71.78 1.14 1.77 1.14 2.98 0 4.27-2.61 5.21-5.09 5.48.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z" /></svg>
      GitHub</a>}
      {profile.phone && <a href={`tel:${profile.phone}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 2.8a2 2 0 0 1-.6 1.8L7.1 10a16 16 0 0 0 6.9 6.9l1.7-1.9a2 2 0 0 1 1.8-.6l2.8.5a2 2 0 0 1 1.7 2Z" /></svg>
        {profile.phone}</a>}</div>
  </section>;
}
