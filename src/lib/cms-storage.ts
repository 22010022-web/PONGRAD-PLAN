import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { BannerItem, NewsItem } from "@/types/cms";

const CMS_NEWS_ROW_ID = "cms_news_v1";
const CMS_BANNERS_ROW_ID = "cms_banners_v1";
export const CMS_MEDIA_BUCKET = "cms-media";

export function createPublicSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readCollection<T>(
  client: SupabaseClient | null,
  rowId: string
): Promise<T[]> {
  if (!client) return [];
  const { data, error } = await client
    .from("school_settings")
    .select("logo_url")
    .eq("id", rowId)
    .maybeSingle();

  if (error || !data?.logo_url) return [];
  try {
    const parsed = JSON.parse(data.logo_url);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeCollection<T>(
  client: SupabaseClient,
  rowId: string,
  items: T[]
): Promise<void> {
  const { error } = await client.from("school_settings").upsert(
    {
      id: rowId,
      school_name: "CMS_DATA_STORE",
      system_title: rowId,
      logo_url: JSON.stringify(items),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) {
    throw new Error(error.message || `บันทึกข้อมูล ${rowId} ไม่สำเร็จ`);
  }
}

export async function readAllNews(client: SupabaseClient | null): Promise<NewsItem[]> {
  return readCollection<NewsItem>(client, CMS_NEWS_ROW_ID);
}

export async function writeAllNews(client: SupabaseClient, items: NewsItem[]): Promise<void> {
  await writeCollection(client, CMS_NEWS_ROW_ID, items);
}

export async function readAllBanners(client: SupabaseClient | null): Promise<BannerItem[]> {
  return readCollection<BannerItem>(client, CMS_BANNERS_ROW_ID);
}

export async function writeAllBanners(client: SupabaseClient, items: BannerItem[]): Promise<void> {
  await writeCollection(client, CMS_BANNERS_ROW_ID, items);
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
