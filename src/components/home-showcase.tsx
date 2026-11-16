"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Images,
  Newspaper,
  Pin,
  X,
} from "lucide-react";
import { BannerItem, NewsItem } from "@/types/cms";

function formatThaiDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function BannerLinkAction({
  banner,
  children,
  className,
}: {
  banner: BannerItem;
  children: React.ReactNode;
  className?: string;
}) {
  const url = banner.link_url?.trim();
  if (!url) return <div className={className}>{children}</div>;

  const isInternal = url.startsWith("/");
  if (isInternal && !banner.open_in_new_tab) {
    return (
      <Link href={url} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <a
      href={url}
      target={banner.open_in_new_tab ? "_blank" : undefined}
      rel={banner.open_in_new_tab ? "noreferrer" : undefined}
      className={className}
    >
      {children}
    </a>
  );
}

export function HomeBannerCarousel({ banners }: { banners: BannerItem[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const safeIndex = banners.length > 0 ? activeIndex % banners.length : 0;

  useEffect(() => {
    if (banners.length <= 1 || isPaused) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % banners.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [banners.length, isPaused]);

  if (banners.length === 0) return null;

  const current = banners[safeIndex];
  const hasOverlayText = Boolean(current.title || current.subtitle || current.link_url);

  return (
    <section
      aria-label="แบนเนอร์ประชาสัมพันธ์"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="relative glass-card rounded-3xl overflow-hidden border border-white/80 shadow-lg group"
    >
      <div className="relative w-full h-48 sm:h-64 md:h-72 bg-slate-900/10 overflow-hidden">
        {current.link_url && !current.title && !current.subtitle ? (
          <BannerLinkAction banner={current} className="block w-full h-full">
            <img
              src={current.image_url}
              alt="แบนเนอร์ประชาสัมพันธ์"
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.015]"
            />
          </BannerLinkAction>
        ) : (
          <img
            src={current.image_url}
            alt={current.title || "แบนเนอร์ประชาสัมพันธ์"}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.015]"
          />
        )}

        {hasOverlayText && (current.title || current.subtitle || current.link_url) && (
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/25 to-transparent flex flex-col justify-end p-5 sm:p-7 pointer-events-none">
            <div className="max-w-3xl space-y-1.5 pointer-events-auto">
              {current.title && (
                <h2 className="font-display font-bold text-lg sm:text-2xl text-white drop-shadow-sm">
                  {current.title}
                </h2>
              )}
              {current.subtitle && (
                <p className="text-xs sm:text-sm text-white/90 line-clamp-2 drop-shadow-sm">
                  {current.subtitle}
                </p>
              )}
              {current.link_url && (
                <div className="pt-1.5">
                  <BannerLinkAction
                    banner={current}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/95 hover:bg-white text-pink-700 text-xs font-bold shadow-md transition-all"
                  >
                    <span>{current.link_label || "ดูรายละเอียด"}</span>
                    {current.open_in_new_tab ? (
                      <ExternalLink className="w-3.5 h-3.5" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5" />
                    )}
                  </BannerLinkAction>
                </div>
              )}
            </div>
          </div>
        )}

        {banners.length > 1 && (
          <>
            <button
              type="button"
              onClick={() =>
                setActiveIndex((prev) => (prev - 1 + banners.length) % banners.length)
              }
              aria-label="แบนเนอร์ก่อนหน้า"
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 hover:bg-white text-slate-800 shadow-md backdrop-blur-xs opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
            >
              <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveIndex((prev) => (prev + 1) % banners.length)}
              aria-label="แบนเนอร์ถัดไป"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 hover:bg-white text-slate-800 shadow-md backdrop-blur-xs opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
            >
              <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <div className="absolute bottom-3 right-4 flex items-center gap-1.5 z-10">
              {banners.map((b, idx) => (
                <button
                  key={b.id}
                  type="button"
                  aria-label={`ไปยังแบนเนอร์ ${idx + 1}`}
                  onClick={() => setActiveIndex(idx)}
                  className={`h-2 rounded-full transition-all ${
                    idx === safeIndex
                      ? "w-6 bg-white shadow"
                      : "w-2 bg-white/55 hover:bg-white/80"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export function HomeNewsSection({ news }: { news: NewsItem[] }) {
  const [selectedCategory, setSelectedCategory] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [activeNews, setActiveNews] = useState<NewsItem | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const availableCategories = useMemo(
    () => Array.from(new Set(news.map((n) => n.category).filter(Boolean))),
    [news]
  );

  const filteredNews = useMemo(
    () =>
      selectedCategory
        ? news.filter((n) => n.category === selectedCategory)
        : news,
    [news, selectedCategory]
  );

  if (news.length === 0) return null;

  const visibleNews = showAll ? filteredNews : filteredNews.slice(0, 6);

  const modalPhotos = activeNews
    ? [
        ...(activeNews.cover_image ? [activeNews.cover_image] : []),
        ...(activeNews.gallery_images || []),
      ]
    : [];

  return (
    <section aria-label="ข่าวประชาสัมพันธ์" className="glass-card rounded-3xl p-5 sm:p-6 border border-white/80 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="font-display font-bold text-base sm:text-lg text-slate-800 flex items-center gap-2">
          <span className="w-2.5 h-6 rounded-full bg-gradient-to-b from-amber-500 to-pink-600"></span>
          <span>ข่าวประชาสัมพันธ์และประกาศโรงเรียน</span>
        </h2>

        {availableCategories.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedCategory("")}
              className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                selectedCategory === ""
                  ? "bg-pink-600 text-white border-pink-600 shadow-xs"
                  : "bg-white/75 text-slate-600 border-slate-200 hover:bg-white"
              }`}
            >
              ทั้งหมด ({news.length})
            </button>
            {availableCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                  selectedCategory === cat
                    ? "bg-pink-600 text-white border-pink-600 shadow-xs"
                    : "bg-white/75 text-slate-600 border-slate-200 hover:bg-white"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleNews.map((item) => (
          <article
            key={item.id}
            onClick={() => {
              setActiveNews(item);
              setLightboxIndex(null);
            }}
            className={`group cursor-pointer rounded-2xl bg-white/85 hover:bg-white border transition-all duration-200 overflow-hidden shadow-xs hover:shadow-md flex flex-col ${
              item.is_pinned ? "border-amber-300 ring-1 ring-amber-200/70" : "border-slate-200/80"
            }`}
          >
            <div className="relative h-40 bg-gradient-to-br from-pink-50 via-purple-50 to-amber-50 overflow-hidden">
              {item.cover_image ? (
                <img
                  src={item.cover_image}
                  alt={item.title}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-pink-300">
                  <Newspaper className="w-12 h-12" />
                </div>
              )}

              <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5">
                {item.is_pinned && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold shadow">
                    <Pin className="w-3 h-3" />
                    ปักหมุด
                  </span>
                )}
                <span className="px-2.5 py-0.5 rounded-full bg-white/95 text-pink-700 text-[10px] font-bold shadow">
                  {item.category}
                </span>
              </div>

              {item.gallery_images?.length > 0 && (
                <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900/70 text-white text-[10px] font-semibold">
                  <Images className="w-3 h-3" />
                  +{item.gallery_images.length} รูป
                </span>
              )}
            </div>

            <div className="p-4 flex-1 flex flex-col justify-between space-y-2">
              <div className="space-y-1.5">
                <h3 className="font-bold text-slate-800 text-sm sm:text-base line-clamp-2 group-hover:text-pink-700 transition-colors">
                  {item.title}
                </h3>
                {item.content && (
                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    {item.content}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-pink-500" />
                  {formatThaiDate(item.publish_at || item.created_at)}
                </span>
                <span className="font-bold text-pink-600 group-hover:underline">อ่านเพิ่มเติม →</span>
              </div>
            </div>
          </article>
        ))}
      </div>

      {filteredNews.length > 6 && (
        <div className="text-center pt-1">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="px-4 py-2 rounded-xl bg-white/80 hover:bg-white border border-pink-200 text-pink-700 text-xs font-bold shadow-xs"
          >
            {showAll
              ? "ย่อรายการข่าว"
              : `ดูข่าวทั้งหมด (${filteredNews.length} ข่าว)`}
          </button>
        </div>
      )}

      {/* Modal อ่านข่าวประชาสัมพันธ์ + แกลเลอรีรูปภาพ */}
      {activeNews && (
        <div
          onClick={() => {
            setActiveNews(null);
            setLightboxIndex(null);
          }}
          className="fixed inset-0 !mt-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-900/55 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-3xl w-full bg-white rounded-3xl overflow-hidden shadow-2xl border border-white/80 max-h-[92vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 shrink-0">
              <div className="flex flex-wrap items-center gap-1.5">
                {activeNews.is_pinned && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-[11px] font-bold">
                    <Pin className="w-3 h-3" />
                    ปักหมุด
                  </span>
                )}
                <span className="px-2.5 py-0.5 rounded-full bg-pink-50 text-pink-700 border border-pink-200 text-[11px] font-bold">
                  {activeNews.category}
                </span>
                <span className="text-xs text-slate-500 ml-1">
                  เผยแพร่ {formatThaiDate(activeNews.publish_at || activeNews.created_at)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveNews(null);
                  setLightboxIndex(null);
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 overflow-y-auto space-y-4">
              {activeNews.cover_image && (
                <img
                  src={activeNews.cover_image}
                  alt={activeNews.title}
                  onClick={() => setLightboxIndex(0)}
                  className="w-full max-h-80 object-cover rounded-2xl border border-slate-200 cursor-zoom-in"
                />
              )}

              <h3 className="font-display font-bold text-lg sm:text-2xl text-slate-900">
                {activeNews.title}
              </h3>

              {activeNews.content && (
                <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                  {activeNews.content}
                </div>
              )}

              {activeNews.gallery_images?.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-slate-100">
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Images className="w-4 h-4 text-pink-600" />
                    <span>รูปภาพประกอบข่าว ({activeNews.gallery_images.length} รูป)</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {activeNews.gallery_images.map((url, idx) => {
                      const targetPhotoIndex = activeNews.cover_image ? idx + 1 : idx;
                      return (
                        <button
                          key={`${url}-${idx}`}
                          type="button"
                          onClick={() => setLightboxIndex(targetPhotoIndex)}
                          className="aspect-square rounded-xl overflow-hidden border border-slate-200 hover:ring-2 hover:ring-pink-500 transition-all"
                        >
                          <img
                            src={url}
                            alt={`ภาพประกอบ ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox ดูภาพขนาดใหญ่ */}
      {lightboxIndex !== null && modalPhotos[lightboxIndex] && (
        <div
          onClick={() => setLightboxIndex(null)}
          className="fixed inset-0 !mt-0 z-[70] bg-slate-950/85 flex items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/15 hover:bg-white/25 text-white"
          >
            <X className="w-6 h-6" />
          </button>

          {modalPhotos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((lightboxIndex - 1 + modalPhotos.length) % modalPhotos.length);
              }}
              className="absolute left-4 p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          <img
            src={modalPhotos[lightboxIndex]}
            alt="ภาพขยาย"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[88vh] object-contain rounded-2xl shadow-2xl"
          />

          {modalPhotos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((lightboxIndex + 1) % modalPhotos.length);
              }}
              className="absolute right-4 p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
