import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/server-auth";
import {
  createPublicSupabase,
  readAllBanners,
  readAllNews,
  readBannerSettings,
  readPortalSettings,
} from "@/lib/cms-storage";
import {
  DEFAULT_BANNER_SETTINGS,
  DEFAULT_PORTAL_SETTINGS,
  getActiveBanners,
  getActivePublishedNews,
} from "@/types/cms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = createAdminSupabase() || createPublicSupabase();
    if (!client) {
      return NextResponse.json(
        {
          banners: [],
          news: [],
          bannerSettings: DEFAULT_BANNER_SETTINGS,
          portalSettings: DEFAULT_PORTAL_SETTINGS,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const [allBanners, allNews, bannerSettings, portalSettings] = await Promise.all([
      readAllBanners(client),
      readAllNews(client),
      readBannerSettings(client),
      readPortalSettings(client),
    ]);

    const nowMs = Date.now();
    return NextResponse.json(
      {
        banners: getActiveBanners(allBanners, nowMs),
        news: getActivePublishedNews(allNews, nowMs),
        bannerSettings,
        portalSettings,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/cms error:", err);
    return NextResponse.json(
      {
        banners: [],
        news: [],
        bannerSettings: DEFAULT_BANNER_SETTINGS,
        portalSettings: DEFAULT_PORTAL_SETTINGS,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
