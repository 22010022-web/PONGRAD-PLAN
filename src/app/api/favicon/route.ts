import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/server-auth";
import { createPublicSupabase, readPortalSettings } from "@/lib/cms-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="bg" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#db2777"/>
      <stop offset="55%" stop-color="#9333ea"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#bg)"/>
  <path d="M18 19c0-1.7 1.3-3 3-3h9.5c2.2 0 4.2 1 5.5 2.7 1.3-1.7 3.3-2.7 5.5-2.7H51c1.7 0 3 1.3 3 3v24c0 1.7-1.3 3-3 3h-9.5c-2.2 0-4.2 1-5.5 2.7-1.3-1.7-3.3-2.7-5.5-2.7H21c-1.7 0-3-1.3-3-3V19z" fill="none" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" transform="translate(-4, 0)"/>
  <line x1="32" y1="19" x2="32" y2="48" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
</svg>`;

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+)(?:;(?:charset=[^;,]+|base64))?,([\s\S]*)$/i.exec(
    dataUrl.trim()
  );
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const isBase64 = /;base64,/i.test(dataUrl.slice(0, dataUrl.indexOf(",") + 1));
  const payload = match[2];
  try {
    const buffer = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const client = createAdminSupabase() || createPublicSupabase();
    if (client) {
      const [portalSettings, schoolRes] = await Promise.all([
        readPortalSettings(client),
        client
          .from("school_settings")
          .select("logo_url")
          .eq("id", "default")
          .maybeSingle(),
      ]);

      const sourceUrl =
        portalSettings.faviconUrl ||
        (typeof schoolRes.data?.logo_url === "string" ? schoolRes.data.logo_url.trim() : "") ||
        null;

      if (sourceUrl) {
        if (sourceUrl.startsWith("data:")) {
          const decoded = decodeDataUrl(sourceUrl);
          if (decoded) {
            return new NextResponse(new Uint8Array(decoded.buffer), {
              headers: {
                "Content-Type": decoded.mimeType,
                "Cache-Control": "public, max-age=120, must-revalidate",
              },
            });
          }
        } else if (/^https?:\/\//i.test(sourceUrl)) {
          const upstream = await fetch(sourceUrl, { cache: "no-store" });
          if (upstream.ok) {
            const contentType = upstream.headers.get("content-type") || "image/png";
            const arr = await upstream.arrayBuffer();
            return new NextResponse(arr, {
              headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=120, must-revalidate",
              },
            });
          }
        }
      }
    }
  } catch {
    // Fallback cleanly to branded vector emblem
  }

  return new NextResponse(FALLBACK_SVG, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=120, must-revalidate",
    },
  });
}
