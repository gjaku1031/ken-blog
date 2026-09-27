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
    <div className="profile-links">{github && <a href={github} target="_blank" rel="noreferrer noopener">GitHub</a>}
      {profile.phone && <a href={`tel:${profile.phone}`}>{profile.phone}</a>}</div>
  </section>;
}
