export type NewsStatus = "draft" | "published";

export const NEWS_CATEGORIES = [
  "ข่าวทั่วไป",
  "วิชาการ / แผนการสอน",
  "กิจกรรมโรงเรียน",
  "ประกาศเร่งด่วน",
  "งานบุคคล / ประชุม",
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number] | string;

export interface NewsItem {
  id: string;
  title: string;
  content: string;
  category: NewsCategory;
  cover_image: string | null;
  gallery_images: string[];
  status: NewsStatus;
  is_pinned: boolean;
  publish_at: string | null; // ISO UTC string
  expires_at: string | null; // ISO UTC string
  author_name?: string;
  created_at: string;
  updated_at: string;
}

export interface BannerItem {
  id: string;
  title: string;
  subtitle: string;
  image_url: string;
  link_url: string | null;
  link_label: string | null;
  open_in_new_tab: boolean;
  start_at: string | null; // ISO UTC string
  end_at: string | null; // ISO UTC string
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CmsPublicPayload {
  banners: BannerItem[];
  news: NewsItem[];
}

export type NewsScheduleState = "draft" | "scheduled" | "active" | "expired";
export type BannerScheduleState = "inactive" | "scheduled" | "active" | "expired";

function parseTimeMs(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function getNewsScheduleState(item: NewsItem, nowMs = Date.now()): NewsScheduleState {
  if (item.status !== "published") return "draft";
  const pubMs = parseTimeMs(item.publish_at);
  if (pubMs !== null && pubMs > nowMs) return "scheduled";
  const expMs = parseTimeMs(item.expires_at);
  if (expMs !== null && expMs <= nowMs) return "expired";
  return "active";
}

export function getBannerScheduleState(item: BannerItem, nowMs = Date.now()): BannerScheduleState {
  if (!item.is_active) return "inactive";
  const startMs = parseTimeMs(item.start_at);
  if (startMs !== null && startMs > nowMs) return "scheduled";
  const endMs = parseTimeMs(item.end_at);
  if (endMs !== null && endMs <= nowMs) return "expired";
  return "active";
}

export function getActivePublishedNews(items: NewsItem[], nowMs = Date.now()): NewsItem[] {
  return [...items]
    .filter((item) => getNewsScheduleState(item, nowMs) === "active")
    .sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      const aTime = parseTimeMs(a.publish_at) ?? parseTimeMs(a.created_at) ?? 0;
      const bTime = parseTimeMs(b.publish_at) ?? parseTimeMs(b.created_at) ?? 0;
      return bTime - aTime;
    });
}

export function getActiveBanners(items: BannerItem[], nowMs = Date.now()): BannerItem[] {
  return [...items]
    .filter((item) => item.image_url && getBannerScheduleState(item, nowMs) === "active")
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function sortAllNewsForAdmin(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    const aTime = parseTimeMs(a.updated_at) ?? parseTimeMs(a.created_at) ?? 0;
    const bTime = parseTimeMs(b.updated_at) ?? parseTimeMs(b.created_at) ?? 0;
    return bTime - aTime;
  });
}

export function sortAllBannersForAdmin(items: BannerItem[]): BannerItem[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order);
}
