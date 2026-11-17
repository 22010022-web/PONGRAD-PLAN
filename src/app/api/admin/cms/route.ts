import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminSupabase, errorResponse, HttpError, requireUser } from "@/lib/server-auth";
import {
  readAllBanners,
  readAllNews,
  readBannerSettings,
  writeAllBanners,
  writeAllNews,
  writeBannerSettings,
} from "@/lib/cms-storage";
import {
  BannerItem,
  NewsItem,
  NewsStatus,
  sortAllBannersForAdmin,
  sortAllNewsForAdmin,
} from "@/types/cms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanIsoOrNull(raw: unknown): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeBannerOrder(items: BannerItem[]): BannerItem[] {
  return sortAllBannersForAdmin(items).map((item, idx) => ({
    ...item,
    sort_order: idx + 1,
  }));
}

export async function GET(req: Request) {
  try {
    const authed = await requireUser(req, { admin: true });
    const client = createAdminSupabase() || authed.supabase;
    const [banners, news, bannerSettings] = await Promise.all([
      readAllBanners(client),
      readAllNews(client),
      readBannerSettings(client),
    ]);

    return NextResponse.json(
      {
        banners: sortAllBannersForAdmin(banners),
        news: sortAllNewsForAdmin(news),
        bannerSettings,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return errorResponse(err, "ไม่สามารถโหลดข้อมูลข่าวสารและแบนเนอร์ได้");
  }
}

export async function POST(req: Request) {
  try {
    const authed = await requireUser(req, { admin: true });
    const client = createAdminSupabase() || authed.supabase;
    const body = await req.json();
    const action = String(body?.action || "");
    const nowIso = new Date().toISOString();

    if (
      action === "save-news" ||
      action === "delete-news" ||
      action === "toggle-news-pin" ||
      action === "toggle-news-status"
    ) {
      let currentNews = await readAllNews(client);

      if (action === "save-news") {
        const input = body?.item || {};
        const title = String(input.title || "").trim();
        if (!title) throw new HttpError(400, "กรุณาระบุหัวข้อข่าวประชาสัมพันธ์");

        const existingIdx = input.id
          ? currentNews.findIndex((n) => n.id === String(input.id))
          : -1;
        const existing = existingIdx >= 0 ? currentNews[existingIdx] : null;
        const status: NewsStatus = input.status === "published" ? "published" : "draft";

        const galleryImages: string[] = Array.isArray(input.gallery_images)
          ? input.gallery_images
              .map((u: unknown) => String(u || "").trim())
              .filter(Boolean)
          : [];

        const savedItem: NewsItem = {
          id: existing?.id || randomUUID(),
          title,
          content: String(input.content || "").trim(),
          category: String(input.category || "ข่าวทั่วไป").trim() || "ข่าวทั่วไป",
          cover_image: input.cover_image ? String(input.cover_image).trim() : null,
          gallery_images: galleryImages,
          status,
          is_pinned: Boolean(input.is_pinned),
          publish_at: cleanIsoOrNull(input.publish_at),
          expires_at: cleanIsoOrNull(input.expires_at),
          author_name: existing?.author_name || authed.profile?.full_name || "ผู้บริหารสถานศึกษา",
          created_at: existing?.created_at || nowIso,
          updated_at: nowIso,
        };

        if (existingIdx >= 0) {
          currentNews[existingIdx] = savedItem;
        } else {
          currentNews = [savedItem, ...currentNews];
        }
      } else if (action === "delete-news") {
        const id = String(body?.id || "");
        currentNews = currentNews.filter((n) => n.id !== id);
      } else if (action === "toggle-news-pin") {
        const id = String(body?.id || "");
        currentNews = currentNews.map((n) =>
          n.id === id ? { ...n, is_pinned: !n.is_pinned, updated_at: nowIso } : n
        );
      } else if (action === "toggle-news-status") {
        const id = String(body?.id || "");
        currentNews = currentNews.map((n) =>
          n.id === id
            ? {
                ...n,
                status: n.status === "published" ? "draft" : "published",
                updated_at: nowIso,
              }
            : n
        );
      }

      const sortedNews = sortAllNewsForAdmin(currentNews);
      await writeAllNews(client, sortedNews);
      return NextResponse.json({ success: true, news: sortedNews });
    }

    if (
      action === "save-banner" ||
      action === "delete-banner" ||
      action === "toggle-banner" ||
      action === "move-banner"
    ) {
      let currentBanners = normalizeBannerOrder(await readAllBanners(client));

      if (action === "save-banner") {
        const input = body?.item || {};
        const imageUrl = String(input.image_url || "").trim();
        if (!imageUrl) throw new HttpError(400, "กรุณาอัปโหลดหรือระบุรูปภาพแบนเนอร์");

        const existingIdx = input.id
          ? currentBanners.findIndex((b) => b.id === String(input.id))
          : -1;
        const existing = existingIdx >= 0 ? currentBanners[existingIdx] : null;
        const requestedOrder = Number(input.sort_order);

        const savedBanner: BannerItem = {
          id: existing?.id || randomUUID(),
          title: String(input.title || "").trim(),
          subtitle: String(input.subtitle || "").trim(),
          image_url: imageUrl,
          link_url: input.link_url ? String(input.link_url).trim() : null,
          link_label: input.link_label ? String(input.link_label).trim() : null,
          open_in_new_tab: input.open_in_new_tab !== false,
          start_at: cleanIsoOrNull(input.start_at),
          end_at: cleanIsoOrNull(input.end_at),
          is_active: input.is_active !== false,
          sort_order:
            Number.isFinite(requestedOrder) && requestedOrder > 0
              ? Math.round(requestedOrder)
              : existing?.sort_order ?? currentBanners.length + 1,
          created_at: existing?.created_at || nowIso,
          updated_at: nowIso,
        };

        if (existingIdx >= 0) {
          currentBanners[existingIdx] = savedBanner;
        } else {
          currentBanners = [...currentBanners, savedBanner];
        }
      } else if (action === "delete-banner") {
        const id = String(body?.id || "");
        currentBanners = currentBanners.filter((b) => b.id !== id);
      } else if (action === "toggle-banner") {
        const id = String(body?.id || "");
        currentBanners = currentBanners.map((b) =>
          b.id === id ? { ...b, is_active: !b.is_active, updated_at: nowIso } : b
        );
      } else if (action === "move-banner") {
        const id = String(body?.id || "");
        const dir = body?.direction === "up" ? -1 : 1;
        const idx = currentBanners.findIndex((b) => b.id === id);
        const targetIdx = idx + dir;
        if (idx >= 0 && targetIdx >= 0 && targetIdx < currentBanners.length) {
          const copy = [...currentBanners];
          const [moved] = copy.splice(idx, 1);
          copy.splice(targetIdx, 0, { ...moved, updated_at: nowIso });
          currentBanners = copy.map((b, i) => ({ ...b, sort_order: i + 1 }));
        }
      }

      const normalized = normalizeBannerOrder(currentBanners);
      await writeAllBanners(client, normalized);
      return NextResponse.json({ success: true, banners: normalized });
    }

    if (action === "save-banner-settings") {
      const savedSettings = await writeBannerSettings(client, body?.settings || {});
      return NextResponse.json({ success: true, bannerSettings: savedSettings });
    }

    throw new HttpError(400, "ไม่พบคำสั่งจัดการข้อมูลที่รองรับ");
  } catch (err) {
    return errorResponse(err, "บันทึกข้อมูลข่าวสาร/แบนเนอร์ไม่สำเร็จ");
  }
}
