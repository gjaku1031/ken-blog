import { Suspense } from "react";
import { InvitationForm } from "@/components/invitation-form";

/** 일회용 초대의 비밀번호 설정 주소를 렌더한다. */
export default function InvitePage() { return <Suspense fallback={<main id="main-content" role="status">초대를 확인하고 있습니다…</main>}>
  <InvitationForm /></Suspense>; }
