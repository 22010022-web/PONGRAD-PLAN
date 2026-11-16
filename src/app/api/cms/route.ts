import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/server-auth";
import { createPublicSupabase, readAllBanners, readAllNews } from "@/lib/cms-storage";
import { getActiveBanners, getActivePublishedNews } from "@/types/cms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = createAdminSupabase() || createPublicSupabase();
    if (!client) {
      return NextResponse.json(
        { banners: [], news: [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const [allBanners, allNews] = await Promise.all([
      readAllBanners(client),
      readAllNews(client),
    ]);

    const nowMs = Date.now();
    return NextResponse.json(
      {
        banners: getActiveBanners(allBanners, nowMs),
        news: getActivePublishedNews(allNews, nowMs),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/cms error:", err);
    return NextResponse.json(
      { banners: [], news: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
