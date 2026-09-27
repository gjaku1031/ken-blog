"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "./auth-provider";

const measurementId = "G-JDYNG61J70";
type AnalyticsWindow = Window & { dataLayer?: unknown[][]; gtag?: (...args: unknown[]) => void };

/** {@link PublicAnalytics}의 공개 이벤트를 비공개 경로 이동 전에 차단한다. */
export function disablePublicAnalytics() {
  if (typeof window !== "undefined")
    (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = true;
}

/** 명시 설정된 배포에서 익명 공개 경로의 수동 page_view만 전송한다. */
export function PublicAnalytics({ virtualPath }: { virtualPath?: string }) {
  const path = usePathname();
  const auth = useAuth();
  const [ready, setReady] = useState(false);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const route = (path.startsWith(basePath) ? path.slice(basePath.length) : path) || "/";
  const publicIndex = route === "/" || route === "/tech/" || route === "/projects/" || route === "/notes/";
  const target = virtualPath ?? (publicIndex ? route : null);
  const enabled = process.env.NEXT_PUBLIC_GA_ENABLED === "true" &&
    process.env.NEXT_PUBLIC_API_BASE_URL?.startsWith("https://") &&
    typeof window !== "undefined" && window.location.protocol === "https:" &&
    !["localhost", "127.0.0.1"].includes(window.location.hostname) &&
    auth.status === "guest" && target !== null && /^\/[a-z0-9/-]*$/.test(target);

  useEffect(() => {
    if (!enabled || !ready || !target) return;
    const analytics = window as AnalyticsWindow;
    if (!analytics.gtag) return;
    (analytics as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = false;
    analytics.gtag("event", "page_view", { page_path: target,
      page_location: `${window.location.protocol}//${window.location.host}${target}` });
    return disablePublicAnalytics;
  }, [enabled, ready, target]);

  if (!enabled) return null;
  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive"
    onReady={() => setReady(true)} />;
}
