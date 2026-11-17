import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import {
  BannerDisplaySettings,
  BannerItem,
  DEFAULT_BANNER_SETTINGS,
  DEFAULT_PORTAL_SETTINGS,
  NewsItem,
  normalizeBannerSettings,
  normalizePortalSettings,
  PortalDisplaySettings,
} from "@/types/cms";

const CMS_NEWS_ROW_ID = "cms_news_v1";
const CMS_BANNERS_ROW_ID = "cms_banners_v1";
const CMS_BANNER_SETTINGS_ROW_ID = "cms_banner_settings_v1";
const CMS_PORTAL_SETTINGS_ROW_ID = "cms_portal_settings_v1";
export const CMS_MEDIA_BUCKET = "cms-media";

export function createPublicSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readStoredJson<T>(
  client: SupabaseClient | null,
  rowId: string,
  fallback: T
): Promise<T> {
  if (!client) return fallback;
  const { data, error } = await client
    .from("school_settings")
    .select("logo_url")
    .eq("id", rowId)
    .maybeSingle();

  if (error || !data?.logo_url) return fallback;
  try {
    return JSON.parse(data.logo_url) as T;
  } catch {
    return fallback;
  }
}

async function writeStoredJson<T>(
  client: SupabaseClient,
  rowId: string,
  payload: T
): Promise<void> {
  const { error } = await client.from("school_settings").upsert(
    {
      id: rowId,
      school_name: "CMS_DATA_STORE",
      system_title: rowId,
      logo_url: JSON.stringify(payload),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) {
    throw new Error(error.message || `บันทึกข้อมูล ${rowId} ไม่สำเร็จ`);
  }
}

export async function readAllNews(client: SupabaseClient | null): Promise<NewsItem[]> {
  const res = await readStoredJson<unknown>(client, CMS_NEWS_ROW_ID, []);
  return Array.isArray(res) ? (res as NewsItem[]) : [];
}

export async function writeAllNews(client: SupabaseClient, items: NewsItem[]): Promise<void> {
  await writeStoredJson(client, CMS_NEWS_ROW_ID, items);
}

export async function readAllBanners(client: SupabaseClient | null): Promise<BannerItem[]> {
  const res = await readStoredJson<unknown>(client, CMS_BANNERS_ROW_ID, []);
  return Array.isArray(res) ? (res as BannerItem[]) : [];
}

export async function writeAllBanners(client: SupabaseClient, items: BannerItem[]): Promise<void> {
  await writeStoredJson(client, CMS_BANNERS_ROW_ID, items);
}

export async function readBannerSettings(
  client: SupabaseClient | null
): Promise<BannerDisplaySettings> {
  const raw = await readStoredJson<Partial<BannerDisplaySettings> | null>(
    client,
    CMS_BANNER_SETTINGS_ROW_ID,
    DEFAULT_BANNER_SETTINGS
  );
  return normalizeBannerSettings(raw);
}

export async function writeBannerSettings(
  client: SupabaseClient,
  settings: Partial<BannerDisplaySettings>
): Promise<BannerDisplaySettings> {
  const normalized = normalizeBannerSettings(settings);
  await writeStoredJson(client, CMS_BANNER_SETTINGS_ROW_ID, normalized);
  return normalized;
}

export async function readPortalSettings(
  client: SupabaseClient | null
): Promise<PortalDisplaySettings> {
  const raw = await readStoredJson<Partial<PortalDisplaySettings> | null>(
    client,
    CMS_PORTAL_SETTINGS_ROW_ID,
    DEFAULT_PORTAL_SETTINGS
  );
  return normalizePortalSettings(raw);
}

export async function writePortalSettings(
  client: SupabaseClient,
  settings: Partial<PortalDisplaySettings>
): Promise<PortalDisplaySettings> {
  const normalized = normalizePortalSettings(settings);
  await writeStoredJson(client, CMS_PORTAL_SETTINGS_ROW_ID, normalized);
  return normalized;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export async function uploadCmsMediaFile(
  adminClient: SupabaseClient,
  file: File,
  folder: "banners" | "news"
): Promise<string> {
  const mimeType = file.type || "image/jpeg";
  const ext = MIME_TO_EXT[mimeType.toLowerCase()];
  if (!ext) {
    throw new Error("รองรับเฉพาะไฟล์รูปภาพ JPG, PNG, WebP, GIF หรือ SVG");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("ขนาดไฟล์รูปภาพต้องไม่เกิน 5 MB");
  }

  const { error: bucketErr } = await adminClient.storage.getBucket(CMS_MEDIA_BUCKET);
  if (bucketErr) {
    const { error: createErr } = await adminClient.storage.createBucket(CMS_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
    });
    if (createErr && !String(createErr.message || "").toLowerCase().includes("already")) {
      throw new Error(createErr.message || "สร้างพื้นที่เก็บรูปภาพไม่สำเร็จ");
    }
  }

  const filePath = `${folder}/${Date.now()}-${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await adminClient.storage
    .from(CMS_MEDIA_BUCKET)
    .upload(filePath, buffer, {
      contentType: mimeType,
      cacheControl: "31536000",
      upsert: false,
    });

  if (uploadErr) {
    throw new Error(uploadErr.message || "อัปโหลดรูปภาพไปยัง Storage ไม่สำเร็จ");
  }

  const { data } = adminClient.storage.from(CMS_MEDIA_BUCKET).getPublicUrl(filePath);
  if (!data?.publicUrl) {
    throw new Error("ไม่พบลิงก์สาธารณะของรูปภาพ");
  }
  return data.publicUrl;
}
