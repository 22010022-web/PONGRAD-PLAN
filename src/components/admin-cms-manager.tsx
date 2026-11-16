"use client";

import React, { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Images,
  Link as LinkIcon,
  Loader2,
  Newspaper,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  BannerItem,
  getBannerScheduleState,
  getNewsScheduleState,
  NEWS_CATEGORIES,
  NewsItem,
  NewsStatus,
} from "@/types/cms";

interface NotifyPayload {
  type: "success" | "error";
  text: string;
}

function toLocalDateTimeInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function localInputToIso(val: string): string | null {
  const trimmed = val.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatThaiDateTimeShort(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function compressImageForCms(
  file: File,
  maxDim: number,
  quality: number
): Promise<{ file: File; dataUrl: string }> {
  if (file.type === "image/svg+xml") {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("อ่านไฟล์ SVG ไม่สำเร็จ"));
      reader.readAsDataURL(file);
    });
    return { file, dataUrl };
  }

  return await new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height, 1));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("ไม่สามารถประมวลผลรูปภาพได้"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const outMime = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(outMime, quality);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("บีบอัดรูปภาพไม่สำเร็จ"));
              return;
            }
            const ext = outMime === "image/png" ? "png" : "jpg";
            const compressedFile = new File([blob], `upload.${ext}`, { type: outMime });
            resolve({ file: compressedFile, dataUrl });
          },
          outMime,
          quality
        );
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("ไฟล์รูปภาพไม่ถูกต้อง"));
    };
    img.src = objectUrl;
  });
}

async function getAccessTokenOrThrow(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
  }
  return session.access_token;
}

async function uploadCmsImage(
  file: File,
  folder: "banners" | "news",
  maxDim = 1400
): Promise<string> {
  const token = await getAccessTokenOrThrow();
  const { file: compressedFile, dataUrl } = await compressImageForCms(file, maxDim, 0.84);

  try {
    const formData = new FormData();
    formData.append("file", compressedFile);
    formData.append("folder", folder);

    const res = await fetch("/api/admin/cms/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.url) {
      return String(data.url);
    }
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      throw new Error(data?.error || "อัปโหลดรูปภาพไม่สำเร็จ");
    }
  } catch (err: any) {
    if (err?.message?.includes("สิทธิ์") || err?.message?.includes("ขนาดไฟล์")) {
      throw err;
    }
  }

  // Fallback กรณีไม่ได้ตั้งค่า Service Role Storage Bucket: บีบอัดขนาดเล็กลงเป็น Data URL แทน
  const compact = await compressImageForCms(file, Math.min(maxDim, 900), 0.72);
  return compact.dataUrl || dataUrl;
}

async function postAdminCms(body: Record<string, unknown>) {
  const token = await getAccessTokenOrThrow();
  const res = await fetch("/api/admin/cms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || "ดำเนินการไม่สำเร็จ");
  }
  return data;
}

/* =========================================================================
 * 1. News Management (CRUD ข่าว, ปก+แกลเลอรี, หมวดหมู่, ร่าง/เผยแพร่, ตั้งเวลา, ปักหมุด)
 * ========================================================================= */
export function AdminNewsManager({
  news,
  loading,
  onUpdate,
  onNotify,
}: {
  news: NewsItem[];
  loading: boolean;
  onUpdate: (items: NewsItem[]) => void;
  onNotify: (msg: NotifyPayload) => void;
}) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterState, setFilterState] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<NewsItem | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(NEWS_CATEGORIES[0]);
  const [content, setContent] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [status, setStatus] = useState<NewsStatus>("published");
  const [isPinned, setIsPinned] = useState(false);
  const [publishAtInput, setPublishAtInput] = useState("");
  const [expiresAtInput, setExpiresAtInput] = useState("");
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [saving, setSaving] = useState(false);

  const openCreateModal = () => {
    setEditing(null);
    setTitle("");
    setCategory(NEWS_CATEGORIES[0]);
    setContent("");
    setCoverImage("");
    setGalleryImages([]);
    setStatus("published");
    setIsPinned(false);
    setPublishAtInput("");
    setExpiresAtInput("");
    setModalOpen(true);
  };

  const openEditModal = (item: NewsItem) => {
    setEditing(item);
    setTitle(item.title);
    setCategory(item.category || NEWS_CATEGORIES[0]);
    setContent(item.content || "");
    setCoverImage(item.cover_image || "");
    setGalleryImages(Array.isArray(item.gallery_images) ? item.gallery_images : []);
    setStatus(item.status);
    setIsPinned(Boolean(item.is_pinned));
    setPublishAtInput(toLocalDateTimeInput(item.publish_at));
    setExpiresAtInput(toLocalDateTimeInput(item.expires_at));
    setModalOpen(true);
  };

  const handleCoverPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingCover(true);
    try {
      const url = await uploadCmsImage(file, "news", 1400);
      setCoverImage(url);
    } catch (err: any) {
      onNotify({ type: "error", text: err?.message || "อัปโหลดภาพหน้าปกไม่สำเร็จ" });
    } finally {
      setUploadingCover(false);
    }
  };

  const handleGalleryPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploadingGallery(true);
    try {
      const uploaded: string[] = [];
      for (const file of files.slice(0, 10)) {
        const url = await uploadCmsImage(file, "news", 1100);
        uploaded.push(url);
      }
      setGalleryImages((prev) => [...prev, ...uploaded]);
    } catch (err: any) {
      onNotify({ type: "error", text: err?.message || "อัปโหลดรูปภาพประกอบไม่สำเร็จ" });
    } finally {
      setUploadingGallery(false);
    }
  };

  const handleSaveNews = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      onNotify({ type: "error", text: "กรุณาระบุหัวข้อข่าวประชาสัมพันธ์" });
      return;
    }

    const pubIso = localInputToIso(publishAtInput);
    const expIso = localInputToIso(expiresAtInput);
    if (pubIso && expIso && Date.parse(expIso) <= Date.parse(pubIso)) {
      onNotify({ type: "error", text: "วันหมดอายุต้องอยู่หลังเวลาเผยแพร่" });
      return;
    }

    setSaving(true);
    try {
      const data = await postAdminCms({
        action: "save-news",
        item: {
          id: editing?.id,
          title: title.trim(),
          category,
          content: content.trim(),
          cover_image: coverImage.trim() || null,
          gallery_images: galleryImages,
          status,
          is_pinned: isPinned,
          publish_at: pubIso,
          expires_at: expIso,
        },
      });
      if (data.news) onUpdate(data.news);
      setModalOpen(false);
      onNotify({
        type: "success",
        text: editing ? "อัปเดตข่าวประชาสัมพันธ์เรียบร้อยแล้ว" : "เพิ่มข่าวประชาสัมพันธ์เรียบร้อยแล้ว",
      });
    } catch (err: any) {
      onNotify({ type: "error", text: err?.message || "บันทึกข่าวไม่สำเร็จ" });
    } finally {
      setSaving(false);
    }
  };

  const handleQuickAction = async (
    action: "toggle-news-pin" | "toggle-news-status" | "delete-news",
    item: NewsItem
  ) => {
    if (action === "delete-news") {
      if (!window.confirm(`ยืนยันลบข่าว "${item.title}" หรือไม่?`)) return;
    }
    setBusyId(item.id);
    try {
      const data = await postAdminCms({ action, id: item.id });
      if (data.news) onUpdate(data.news);
      if (action === "delete-news") {
        onNotify({ type: "success", text: `ลบข่าว "${item.title}" แล้ว` });
      }
    } catch (err: any) {
      onNotify({ type: "error", text: err?.message || "ดำเนินการไม่สำเร็จ" });
    } finally {
      setBusyId(null);
    }
  };

  const filteredNews = useMemo(() => {
    const q = search.trim().toLowerCase();
    return news.filter((n) => {
      if (filterCat && n.category !== filterCat) return false;
      if (filterState && getNewsScheduleState(n) !== filterState) return false;
      if (q && !`${n.title} ${n.content} ${n.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [news, search, filterCat, filterState]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3 glass-card rounded-2xl p-4 border border-white/80">
        <div>
          <h3 className="font-bold text-slate-800 text-sm sm:text-base flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-pink-600" />
            <span>จัดการข่าวประชาสัมพันธ์หน้าแรก ({news.length} ข่าว)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            รองรับภาพปก, ภาพแกลเลอรี, หมวดหมู่, ฉบับร่าง/เผยแพร่, ตั้งเวลาเผยแพร่-หมดอายุ และปักหมุด
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white text-xs sm:text-sm font-bold shadow hover:shadow-md flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>เพิ่มข่าวใหม่</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาหัวข้อหรือเนื้อหาข่าว..."
            className="w-full pl-9 pr-3 py-2 rounded-xl glass-input text-xs sm:text-sm text-slate-800"
          />
        </div>
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="px-3 py-2 rounded-xl glass-input text-xs font-semibold text-slate-700"
        >
          <option value="">ทุกหมวดหมู่</option>
          {NEWS_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filterState}
          onChange={(e) => setFilterState(e.target.value)}
          className="px-3 py-2 rounded-xl glass-input text-xs font-semibold text-slate-700"
        >
          <option value="">ทุกสถานะ</option>
          <option value="active">กำลังเผยแพร่</option>
          <option value="scheduled">รอถึงเวลาเผยแพร่</option>
          <option value="draft">ฉบับร่าง</option>
          <option value="expired">หมดอายุแล้ว</option>
        </select>
      </div>

      {loading ? (
        <div className="glass-card rounded-2xl p-10 text-center text-xs text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin text-pink-600 mx-auto mb-2" />
          กำลังโหลดข่าวประชาสัมพันธ์...
        </div>
      ) : filteredNews.length === 0 ? (
        <div className="glass-card rounded-2xl p-10 text-center text-slate-400 text-sm border border-white/80">
          ยังไม่มีข่าวประชาสัมพันธ์ กด &quot;+ เพิ่มข่าวใหม่&quot; เพื่อสร้างข่าวแรกบนหน้าเว็บ
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNews.map((item) => {
            const schedState = getNewsScheduleState(item);
            return (
              <div
                key={item.id}
                className={`glass-card rounded-2xl p-4 border transition-all flex flex-col sm:flex-row gap-4 items-start ${
                  item.is_pinned ? "border-amber-300 bg-amber-50/30" : "border-white/80"
                }`}
              >
                <div className="w-full sm:w-36 h-24 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                  {item.cover_image ? (
                    <img
                      src={item.cover_image}
                      alt={item.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Newspaper className="w-8 h-8 text-slate-300" />
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.is_pinned && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold">
                        <Pin className="w-3 h-3" />
                        ปักหมุด
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-pink-50 text-pink-700 border border-pink-200 text-[10px] font-bold">
                      {item.category}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        schedState === "active"
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : schedState === "scheduled"
                            ? "bg-sky-100 text-sky-800 border-sky-200"
                            : schedState === "expired"
                              ? "bg-rose-100 text-rose-700 border-rose-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                    >
                      {schedState === "active"
                        ? "กำลังเผยแพร่"
                        : schedState === "scheduled"
                          ? "รอถึงเวลาเผยแพร่"
                          : schedState === "expired"
                            ? "หมดอายุแล้ว"
                            : "ฉบับร่าง"}
                    </span>
                    {item.gallery_images?.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-semibold">
                        <Images className="w-3 h-3" />
                        {item.gallery_images.length} รูปประกอบ
                      </span>
                    )}
                  </div>

                  <h4 className="font-bold text-slate-800 text-sm sm:text-base line-clamp-1">
                    {item.title}
                  </h4>
                  {item.content && (
                    <p className="text-xs text-slate-600 line-clamp-2">{item.content}</p>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-0.5">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      เริ่มเผยแพร่:{" "}
                      {item.publish_at ? formatThaiDateTimeShort(item.publish_at) : "ทันที"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      หมดอายุ: {item.expires_at ? formatThaiDateTimeShort(item.expires_at) : "ไม่มี"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap sm:flex-col gap-1.5 shrink-0 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => handleQuickAction("toggle-news-pin", item)}
                    className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border inline-flex items-center gap-1 ${
                      item.is_pinned
                        ? "bg-amber-100 text-amber-800 border-amber-300"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-amber-50"
                    }`}
                  >
                    {item.is_pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    <span>{item.is_pinned ? "ถอนหมุด" : "ปักหมุด"}</span>
                  </button>

                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => handleQuickAction("toggle-news-status", item)}
                    className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border inline-flex items-center gap-1 ${
                      item.status === "published"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-emerald-50"
                    }`}
                  >
                    {item.status === "published" ? (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        <span>เผยแพร่อยู่</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>ร่าง (คลิกเผยแพร่)</span>
                      </>
                    )}
                  </button>

                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditModal(item)}
                      className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 inline-flex items-center gap-1"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>แก้ไข</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleQuickAction("delete-news", item)}
                      className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>ลบ</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit News Modal */}
      {modalOpen && (
        <div className="fixed inset-0 !mt-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="max-w-2xl w-full bg-white rounded-3xl p-5 sm:p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-display font-bold text-base sm:text-lg text-slate-800">
                {editing ? "แก้ไขข่าวประชาสัมพันธ์" : "เพิ่มข่าวประชาสัมพันธ์ใหม่"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNews} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  หัวข้อข่าวประชาสัมพันธ์ *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="เช่น กำหนดการส่งแผนการจัดการเรียนรู้ ภาคเรียนที่ 2/2569"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    หมวดหมู่ข่าว
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 bg-white"
                  >
                    {NEWS_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    สถานะและปักหมุด
                  </label>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setStatus("published")}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border ${
                        status === "published"
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-slate-50 text-slate-600 border-slate-200"
                      }`}
                    >
                      เผยแพร่
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus("draft")}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border ${
                        status === "draft"
                          ? "bg-slate-700 text-white border-slate-700"
                          : "bg-slate-50 text-slate-600 border-slate-200"
                      }`}
                    >
                      ฉบับร่าง
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPinned((v) => !v)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border inline-flex items-center gap-1 ${
                        isPinned
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-slate-50 text-slate-600 border-slate-200"
                      }`}
                      title="ปักหมุดข่าวสำคัญ"
                    >
                      <Pin className="w-3.5 h-3.5" />
                      <span>ปักหมุด</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    ตั้งเวลาเริ่มเผยแพร่ (ว่างไว้ = เผยแพร่ทันที)
                  </label>
                  <input
                    type="datetime-local"
                    value={publishAtInput}
                    onChange={(e) => setPublishAtInput(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    วันเวลาหมดอายุ (ว่างไว้ = ไม่หมดอายุ)
                  </label>
                  <input
                    type="datetime-local"
                    value={expiresAtInput}
                    onChange={(e) => setExpiresAtInput(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
                  />
                </div>
              </div>

              {/* Cover image */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">
                  ภาพหน้าปกข่าว (Cover Image)
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-200 text-xs font-bold cursor-pointer">
                    {uploadingCover ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    <span>{uploadingCover ? "กำลังอัปโหลด..." : "อัปโหลดภาพหน้าปก"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={handleCoverPick}
                      className="hidden"
                    />
                  </label>
                  <input
                    type="url"
                    value={coverImage}
                    onChange={(e) => setCoverImage(e.target.value)}
                    placeholder="หรือวางลิงก์รูปภาพ (https://...)"
                    className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                  {coverImage && (
                    <button
                      type="button"
                      onClick={() => setCoverImage("")}
                      className="px-2.5 py-2 rounded-xl text-xs font-semibold text-red-600 bg-red-50 border border-red-200"
                    >
                      ลบรูปปก
                    </button>
                  )}
                </div>
                {coverImage && (
                  <img
                    src={coverImage}
                    alt="พรีวิวภาพหน้าปก"
                    className="w-full max-h-48 object-cover rounded-2xl border border-slate-200"
                  />
                )}
              </div>

              {/* Gallery Images */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700">
                    รูปภาพประกอบข่าว ({galleryImages.length} รูป)
                  </label>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold cursor-pointer">
                    {uploadingGallery ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Images className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {uploadingGallery ? "กำลังอัปโหลด..." : "อัปโหลดหลายรูปภาพ"}
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      multiple
                      onChange={handleGalleryPick}
                      className="hidden"
                    />
                  </label>
                </div>

                {galleryImages.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {galleryImages.map((imgUrl, idx) => (
                      <div key={`${imgUrl}-${idx}`} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-200">
                        <img
                          src={imgUrl}
                          alt={`รูปประกอบ ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setGalleryImages((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="absolute top-1 right-1 p-1 rounded-full bg-red-600 text-white shadow hover:bg-red-700"
                          title="ลบรูปนี้"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  เนื้อหา / รายละเอียดข่าว
                </label>
                <textarea
                  rows={5}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="พิมพ์รายละเอียดข่าวประชาสัมพันธ์ กำหนดการ หรือคำชี้แจงเพิ่มเติม..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving || uploadingCover || uploadingGallery}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white text-xs sm:text-sm font-bold shadow disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{saving ? "กำลังบันทึก..." : "บันทึกข่าวประชาสัมพันธ์"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
 * 2. Banner Management (เพิ่ม/แก้ไข/ลบ, อัปโหลดภาพ, ข้อความ+ลิงก์, วันแสดงผล, เปิด/ปิด, จัดลำดับ)
 * ========================================================================= */
export function AdminBannerManager({
  banners,
  loading,
  onUpdate,
  onNotify,
}: {
  banners: BannerItem[];
  loading: boolean;
  onUpdate: (items: BannerItem[]) => void;
  onNotify: (msg: NotifyPayload) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BannerItem | null>(null);

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("ดูรายละเอียด");
  const [openInNewTab, setOpenInNewTab] = useState(true);
  const [startAtInput, setStartAtInput] = useState("");
  const [endAtInput, setEndAtInput] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState(1);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);

  const openCreateModal = () => {
    setEditing(null);
    setTitle("");
    setSubtitle("");
    setImageUrl("");
    setLinkUrl("");
    setLinkLabel("ดูรายละเอียด");
    setOpenInNewTab(true);
    setStartAtInput("");
    setEndAtInput("");
    setIsActive(true);
    setSortOrder(banners.length + 1);
    setModalOpen(true);
  };

  const openEditModal = (item: BannerItem) => {
    setEditing(item);
    setTitle(item.title || "");
    setSubtitle(item.subtitle || "");
    setImageUrl(item.image_url || "");
    setLinkUrl(item.link_url || "");
    setLinkLabel(item.link_label || "ดูรายละเอียด");
    setOpenInNewTab(item.open_in_new_tab !== false);
    setStartAtInput(toLocalDateTimeInput(item.start_at));
    setEndAtInput(toLocalDateTimeInput(item.end_at));
    setIsActive(item.is_active !== false);
    setSortOrder(item.sort_order || 1);
    setModalOpen(true);
  };

  const handleBannerPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingImage(true);
    try {
      const url = await uploadCmsImage(file, "banners", 1600);
      setImageUrl(url);
    } catch (err: any) {
      onNotify({ type: "error", text: err?.message || "อัปโหลดภาพแบนเนอร์ไม่สำเร็จ" });
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrl.trim()) {
      onNotify({ type: "error", text: "กรุณาอัปโหลดภาพแบนเนอร์หรือวาง URL รูปภาพ" });
      return;
    }

    const startIso = localInputToIso(startAtInput);
    const endIso = localInputToIso(endAtInput);
    if (startIso && endIso && Date.parse(endIso) <= Date.parse(startIso)) {
      onNotify({ type: "error", text: "วันสิ้นสุดการแสดงผลต้องอยู่หลังวันเริ่มต้น" });
      return;
    }

    setSaving(true);
    try {
      const data = await postAdminCms({
        action: "save-banner",
        item: {
          id: editing?.id,
          title: title.trim(),
          subtitle: subtitle.trim(),
          image_url: imageUrl.trim(),
          link_url: linkUrl.trim() || null,
          link_label: linkLabel.trim() || null,
          open_in_new_tab: openInNewTab,
          start_at: startIso,
          end_at: endIso,
          is_active: isActive,
          sort_order: sortOrder,
        },
      });
      if (data.banners) onUpdate(data.banners);
      setModalOpen(false);
      onNotify({
        type: "success",
        text: editing ? "อัปเดตแบนเนอร์เรียบร้อยแล้ว" : "เพิ่มแบนเนอร์หน้าแรกเรียบร้อยแล้ว",
      });
    } catch (err: any) {
      onNotify({ type: "error", text: err?.message || "บันทึกแบนเนอร์ไม่สำเร็จ" });
    } finally {
      setSaving(false);
    }
  };

  const handleBannerAction = async (
    action: "toggle-banner" | "delete-banner" | "move-banner",
    item: BannerItem,
    direction?: "up" | "down"
  ) => {
    if (action === "delete-banner") {
      if (!window.confirm(`ยืนยันลบแบนเนอร์ "${item.title || `#${item.sort_order}`}" หรือไม่?`)) {
        return;
      }
    }
    setBusyId(item.id);
    try {
      const data = await postAdminCms({ action, id: item.id, direction });
      if (data.banners) onUpdate(data.banners);
      if (action === "delete-banner") {
        onNotify({ type: "success", text: "ลบแบนเนอร์เรียบร้อยแล้ว" });
      }
    } catch (err: any) {
      onNotify({ type: "error", text: err?.message || "ดำเนินการไม่สำเร็จ" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3 glass-card rounded-2xl p-4 border border-white/80">
        <div>
          <h3 className="font-bold text-slate-800 text-sm sm:text-base flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-indigo-600" />
            <span>จัดการแบนเนอร์สไลด์หน้าแรก ({banners.length} แบนเนอร์)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            อัปโหลดภาพ, ใส่ข้อความและลิงก์, ตั้งวันแสดงผล, เปิด/ปิด และจัดลำดับแบนเนอร์ได้ทันที
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs sm:text-sm font-bold shadow hover:shadow-md flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>เพิ่มแบนเนอร์ใหม่</span>
        </button>
      </div>

      {loading ? (
        <div className="glass-card rounded-2xl p-10 text-center text-xs text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto mb-2" />
          กำลังโหลดรายการแบนเนอร์...
        </div>
      ) : banners.length === 0 ? (
        <div className="glass-card rounded-2xl p-10 text-center text-slate-400 text-sm border border-white/80">
          ยังไม่มีแบนเนอร์หน้าแรก กด &quot;+ เพิ่มแบนเนอร์ใหม่&quot; เพื่อสร้างสไลด์ประชาสัมพันธ์
        </div>
      ) : (
        <div className="space-y-3">
          {banners.map((item, idx) => {
            const sched = getBannerScheduleState(item);
            return (
              <div
                key={item.id}
                className={`glass-card rounded-2xl p-4 border flex flex-col md:flex-row gap-4 items-center ${
                  item.is_active ? "border-white/80" : "border-slate-200 opacity-75"
                }`}
              >
                <div className="flex items-center gap-2 shrink-0 w-full md:w-auto">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      disabled={idx === 0 || busyId === item.id}
                      onClick={() => handleBannerAction("move-banner", item, "up")}
                      className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-30"
                      title="เลื่อนขึ้น"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === banners.length - 1 || busyId === item.id}
                      onClick={() => handleBannerAction("move-banner", item, "down")}
                      className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-30"
                      title="เลื่อนลง"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="w-full md:w-52 aspect-[16/6] rounded-xl overflow-hidden bg-slate-100 border border-slate-200 relative">
                    <img
                      src={item.image_url}
                      alt={item.title || `แบนเนอร์ ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-full bg-slate-900/75 text-white text-[10px] font-bold">
                      #{idx + 1}
                    </span>
                  </div>
                </div>

                <div className="flex-1 min-w-0 w-full space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        sched === "active"
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : sched === "scheduled"
                            ? "bg-sky-100 text-sky-800 border-sky-200"
                            : sched === "expired"
                              ? "bg-rose-100 text-rose-700 border-rose-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                    >
                      {sched === "active"
                        ? "กำลังแสดงผล"
                        : sched === "scheduled"
                          ? "รอถึงวันแสดงผล"
                          : sched === "expired"
                            ? "ครบกำหนดสิ้นสุดแล้ว"
                            : "ปิดการแสดงผล"}
                    </span>
                    {item.link_url && (
                      <a
                        href={item.link_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-semibold hover:underline max-w-[240px] truncate"
                      >
                        <LinkIcon className="w-3 h-3 shrink-0" />
                        <span className="truncate">{item.link_url}</span>
                      </a>
                    )}
                  </div>

                  <h4 className="font-bold text-slate-800 text-sm sm:text-base line-clamp-1">
                    {item.title || "(แบนเนอร์ภาพไม่มีข้อความพาดหัว)"}
                  </h4>
                  {item.subtitle && (
                    <p className="text-xs text-slate-600 line-clamp-1">{item.subtitle}</p>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-0.5">
                    <span>
                      เริ่มแสดง: {item.start_at ? formatThaiDateTimeShort(item.start_at) : "ทันที"}
                    </span>
                    <span>
                      สิ้นสุด: {item.end_at ? formatThaiDateTimeShort(item.end_at) : "ไม่จำกัด"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap md:flex-col gap-1.5 shrink-0 w-full md:w-auto justify-end">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => handleBannerAction("toggle-banner", item)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border inline-flex items-center justify-center gap-1 ${
                      item.is_active
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-emerald-50"
                    }`}
                  >
                    {item.is_active ? (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        <span>เปิดแสดงอยู่</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>ปิดอยู่ (คลิกเปิด)</span>
                      </>
                    )}
                  </button>

                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditModal(item)}
                      className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 inline-flex items-center gap-1"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>แก้ไข</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => handleBannerAction("delete-banner", item)}
                      className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>ลบ</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Banner Modal */}
      {modalOpen && (
        <div className="fixed inset-0 !mt-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="max-w-xl w-full bg-white rounded-3xl p-5 sm:p-6 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-display font-bold text-base sm:text-lg text-slate-800">
                {editing ? "แก้ไขแบนเนอร์หน้าแรก" : "เพิ่มแบนเนอร์หน้าแรกใหม่"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBanner} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">
                  ภาพแบนเนอร์ * (แนะนำภาพแนวนอนอัตราส่วนกว้าง เช่น 16:5 หรือ 1200×400 px)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold cursor-pointer">
                    {uploadingImage ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    <span>{uploadingImage ? "กำลังอัปโหลด..." : "อัปโหลดภาพแบนเนอร์"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={handleBannerPick}
                      className="hidden"
                    />
                  </label>
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="หรือวาง URL รูปภาพ (https://...)"
                    className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
                {imageUrl && (
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200 aspect-[16/6] bg-slate-100">
                    <img src={imageUrl} alt="พรีวิวแบนเนอร์" className="w-full h-full object-cover" />
                    {(title || subtitle) && (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/80 via-slate-900/40 to-transparent p-3 text-white">
                        {title && <div className="font-bold text-sm">{title}</div>}
                        {subtitle && <div className="text-xs text-white/90">{subtitle}</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ข้อความพาดหัวบนแบนเนอร์ (ไม่บังคับ)
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="เช่น ยินดีต้อนรับสู่ภาคเรียนที่ 2/2569"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ข้อความรอง / คำอธิบายสั้น
                  </label>
                  <input
                    type="text"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    placeholder="เช่น กดส่งแผนรายสัปดาห์ได้ที่นี่"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ลิงก์ปลายทางเมื่อคลิก (ถ้ามี)
                  </label>
                  <input
                    type="text"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="เช่น /submit หรือ https://..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ข้อความปุ่มลิงก์
                  </label>
                  <input
                    type="text"
                    value={linkLabel}
                    onChange={(e) => setLinkLabel(e.target.value)}
                    placeholder="เช่น อ่านเพิ่มเติม"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    วันเริ่มแสดงผล (ว่าง = แสดงทันที)
                  </label>
                  <input
                    type="datetime-local"
                    value={startAtInput}
                    onChange={(e) => setStartAtInput(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    วันสิ้นสุดแสดงผล (ว่าง = แสดงตลอด)
                  </label>
                  <input
                    type="datetime-local"
                    value={endAtInput}
                    onChange={(e) => setEndAtInput(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="accent-indigo-600 w-4 h-4"
                    />
                    <span>เปิดใช้งานแบนเนอร์นี้</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={openInNewTab}
                      onChange={(e) => setOpenInNewTab(e.target.checked)}
                      className="accent-indigo-600 w-4 h-4"
                    />
                    <span className="inline-flex items-center gap-1">
                      เปิดลิงก์ในแท็บใหม่ <ExternalLink className="w-3 h-3" />
                    </span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-700">ลำดับ:</label>
                  <input
                    type="number"
                    min={1}
                    value={sortOrder}
                    onChange={(e) => setSortOrder(Math.max(1, Number(e.target.value) || 1))}
                    className="w-16 px-2.5 py-1 rounded-xl border border-slate-300 text-xs text-center font-bold"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving || uploadingImage}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs sm:text-sm font-bold shadow disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{saving ? "กำลังบันทึก..." : "บันทึกแบนเนอร์"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
