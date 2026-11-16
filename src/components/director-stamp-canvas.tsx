"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  ImageUp,
  Loader2,
  Move,
  PenLine,
  PenTool,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";

function extractDriveFileId(url?: string | null): string | null {
  if (!url) return null;
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m2) return m2[1];
  return null;
}

const CANVAS_W = 1240;
const MM_TO_PX = CANVAS_W / 210; // A4 width = 210mm
const BLUE_INK = "#1a2fa0";

const STORAGE_SIG_KEY = "pongrad_director_sig_v2";
const STORAGE_SIG_LAYOUT_KEY = "pongrad_director_sig_layout_v3";

const THAI_MONTHS_FULL = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

function toThaiDigits(input: string): string {
  return String(input).replace(/\d/g, (d) => THAI_DIGITS[Number(d)]);
}

function formatThaiFullDate(isoDate: string, useThaiDigits: boolean): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  const be = y + 543;
  const text = `${d} ${THAI_MONTHS_FULL[m - 1]} ${be}`;
  return useThaiDigits ? toThaiDigits(text) : text;
}

interface SigLayoutState {
  x: number; // mm (0..210)
  y: number; // mm
  w: number; // mm
  h: number; // mm
  sigWidthMm: number;
  showSignerCaption: boolean;
  useThaiNumeralDate: boolean;
  showSignatureOnDoc: boolean;
}

const DEFAULT_SIG_LAYOUT: SigLayoutState = {
  x: 118,
  y: 232,
  w: 45,
  h: 24,
  sigWidthMm: 42,
  showSignerCaption: true,
  useThaiNumeralDate: true,
  showSignatureOnDoc: true,
};

interface PenStroke {
  color: string;
  widthPx: number;
  points: { xMm: number; yMm: number }[];
}

async function normalizeSignatureToBlueTransparentDataUrl(srcUrl: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = srcUrl;
  await img.decode();

  const maxDim = 600;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height, 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (!ctx) return srcUrl;

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const a = d[i + 3];
    if (a < 15) {
      d[i + 3] = 0;
      continue;
    }
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 232) {
      d[i + 3] = 0;
    } else {
      const darkness = Math.min(1, Math.max(0, (232 - lum) / 140));
      d[i] = 26;
      d[i + 1] = 47;
      d[i + 2] = 160;
      d[i + 3] = Math.round(darkness * a);
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return cv.toDataURL("image/png");
}

let pdfWorkerReady = false;
async function loadPdfJsClient() {
  const pdfjsLib = await import("pdfjs-dist");
  if (!pdfWorkerReady && typeof window !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    pdfWorkerReady = true;
  }
  return pdfjsLib;
}

export interface DirectorOverlayExport {
  overlays: { pageNumber: number; overlayPngDataUrl: string }[];
  pageNumber: number;
}

interface DirectorStampCanvasProps {
  fileId?: string | null;
  fileUrl?: string | null;
  signerName: string;
  signerTitle: string;
  commentText: string;
  onCommentChange: (val: string) => void;
  onBindExporter: (fn: (() => DirectorOverlayExport | null) | null) => void;
}

export function DirectorStampCanvas({
  fileId,
  fileUrl,
  signerName,
  signerTitle,
  commentText,
  onCommentChange,
  onBindExporter,
}: DirectorStampCanvasProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawPadRef = useRef<HTMLCanvasElement | null>(null);
  const basePageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigImageRef = useRef<HTMLImageElement | null>(null);

  const [canvasHeight, setCanvasHeight] = useState(1754);
  const pageHeightsRef = useRef<Record<number, number>>({});
  const [pdfDocProxy, setPdfDocProxy] = useState<any>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);
  const [sigPageNumber, setSigPageNumber] = useState(1);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // โหมดการใช้งานบนกระดาษ: "move-sig" = ย้ายลายเซ็น, "pen" = เขียนข้อความแก้ไขด้วยลายมือบนกระดาษ
  const [toolMode, setToolMode] = useState<"move-sig" | "pen">("move-sig");
  const [penColor, setPenColor] = useState("#dc2626"); // สีแดงเริ่มต้นสำหรับเขียนจุดที่ต้องแก้ไข
  const [penWidth, setPenWidth] = useState(3.8);
  const [strokesByPage, setStrokesByPage] = useState<Record<number, PenStroke[]>>({});
  const strokesByPageRef = useRef<Record<number, PenStroke[]>>({});
  const activeStrokeRef = useRef<PenStroke | null>(null);

  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [showDrawModal, setShowDrawModal] = useState(false);
  const isDrawingSigRef = useRef(false);

  const [signDateIso, setSignDateIso] = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });

  const [layout, setLayout] = useState<SigLayoutState>(DEFAULT_SIG_LAYOUT);
  const layoutRef = useRef<SigLayoutState>(DEFAULT_SIG_LAYOUT);
  const dragSigRef = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    strokesByPageRef.current = strokesByPage;
  }, [strokesByPage]);

  // โหลดลายเซ็นและพิกัดที่เคยบันทึกไว้ในเครื่อง
  useEffect(() => {
    try {
      const savedSig = localStorage.getItem(STORAGE_SIG_KEY);
      if (savedSig) setSigDataUrl(savedSig);
      const savedLayout = localStorage.getItem(STORAGE_SIG_LAYOUT_KEY);
      if (savedLayout) {
        const parsed = JSON.parse(savedLayout);
        setLayout((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (!sigDataUrl) {
      sigImageRef.current = null;
      renderPreview();
      return;
    }
    const img = new Image();
    img.onload = () => {
      sigImageRef.current = img;
      renderPreview();
    };
    img.src = sigDataUrl;
  }, [sigDataUrl]);

  useEffect(() => {
    if (typeof document !== "undefined" && document.fonts) {
      Promise.all([
        document.fonts.load("400 22px Sarabun", "กขค"),
        document.fonts.load("600 22px Sarabun", "กขค"),
      ])
        .then(() => renderPreview())
        .catch(() => {});
    }
  }, []);

  // โหลดไฟล์ PDF จาก Google Drive ผ่าน API
  useEffect(() => {
    let cancelled = false;
    let loadedTask: any = null;

    async function loadPdf() {
      const resolvedId = fileId?.trim() || extractDriveFileId(fileUrl);
      if (!resolvedId) {
        setPdfError("ไม่พบรหัสไฟล์บน Google Drive");
        return;
      }

      setLoadingPdf(true);
      setPdfError(null);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("เซสชันหมดอายุ");

        const res = await fetch(`/api/drive/file/${resolvedId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `โหลดไฟล์ PDF ไม่สำเร็จ (HTTP ${res.status})`);
        }

        const buf = await res.arrayBuffer();
        const pdfjsLib = await loadPdfJsClient();
        loadedTask = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
        const pdf = await loadedTask.promise;
        if (cancelled) return;

        setPdfDocProxy(pdf);
        setTotalPages(pdf.numPages);
        setPageNumber(1);
        setSigPageNumber(pdf.numPages); // ค่าเริ่มต้นวางลายเซ็นหน้าสุดท้าย หรือกดย้ายมาหน้าปัจจุบันได้ทันที
      } catch (err: any) {
        if (!cancelled) {
          setPdfError(err?.message || "ไม่สามารถโหลดตัวอย่างหน้ากระดาษ PDF ได้");
        }
      } finally {
        if (!cancelled) setLoadingPdf(false);
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
      if (loadedTask?.destroy) {
        loadedTask.destroy().catch(() => {});
      }
    };
  }, [fileId, fileUrl]);

  useEffect(() => {
    let cancelled = false;
    async function renderPdfPage() {
      if (!pdfDocProxy) return;
      try {
        const page = await pdfDocProxy.getPage(pageNumber);
        const vp0 = page.getViewport({ scale: 1 });
        const scale = CANVAS_W / Math.max(1, vp0.width);
        const vp = page.getViewport({ scale });
        const h = Math.round(vp.height);
        pageHeightsRef.current[pageNumber] = h;

        const off = document.createElement("canvas");
        off.width = CANVAS_W;
        off.height = h;
        await page.render({ canvas: off, viewport: vp, background: "#ffffff" }).promise;
        if (cancelled) return;

        basePageCanvasRef.current = off;
        setCanvasHeight(h);
        renderPreview(h);
      } catch (err) {
        console.warn("Render PDF page error:", err);
      }
    }
    renderPdfPage();
    return () => {
      cancelled = true;
    };
  }, [pdfDocProxy, pageNumber]);

  const drawPageOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, targetPage: number, showGuides: boolean) => {
      const k = MM_TO_PX;
      const cur = layoutRef.current;

      // 1. วาดเส้นลายมือเขียนแก้ไขของ ผอ. ในหน้านี้
      const pageStrokes = strokesByPageRef.current[targetPage] || [];
      const allStrokes =
        targetPage === pageNumber && activeStrokeRef.current
          ? [...pageStrokes, activeStrokeRef.current]
          : pageStrokes;

      for (const stroke of allStrokes) {
        if (!stroke.points || stroke.points.length === 0) continue;
        ctx.save();
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = stroke.widthPx;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        if (stroke.points.length === 1) {
          ctx.beginPath();
          ctx.arc(
            stroke.points[0].xMm * k,
            stroke.points[0].yMm * k,
            stroke.widthPx / 2,
            0,
            Math.PI * 2
          );
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].xMm * k, stroke.points[0].yMm * k);
          for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].xMm * k, stroke.points[i].yMm * k);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // 2. วาดลายเซ็น ผอ. (เฉพาะหน้าที่กำหนดให้วางลายเซ็น และเปิดแสดงลายเซ็นอยู่)
      if (!cur.showSignatureOnDoc || targetPage !== sigPageNumber) {
        return;
      }

      ctx.save();
      ctx.fillStyle = BLUE_INK;
      ctx.strokeStyle = BLUE_INK;
      ctx.textBaseline = "top";

      const sx = cur.x * k;
      const sy = cur.y * k;
      const sw = cur.sigWidthMm * k;
      let currentY = sy;

      if (sigImageRef.current) {
        const img = sigImageRef.current;
        const sh = (img.height / Math.max(1, img.width)) * sw;
        ctx.drawImage(img, sx, currentY, sw, sh);
        currentY += sh + 4;
        cur.w = cur.sigWidthMm;
        cur.h = sh / k + (cur.showSignerCaption ? 20 : 2);
      } else {
        cur.w = cur.sigWidthMm;
        cur.h = cur.showSignerCaption ? 24 : 14;
      }

      if (cur.showSignerCaption) {
        const pt = 4.1 * k;
        const lh = pt * 1.38;
        ctx.font = `600 ${pt}px 'TH Sarabun New', Sarabun, sans-serif`;
        ctx.textAlign = "center";
        const centerX = sx + sw / 2;

        if (signerName.trim()) {
          ctx.fillText(`(${signerName.trim()})`, centerX, currentY);
          currentY += lh;
        }
        if (signerTitle.trim()) {
          ctx.fillText(signerTitle.trim(), centerX, currentY);
          currentY += lh;
        }
        const dateStr = formatThaiFullDate(signDateIso, cur.useThaiNumeralDate);
        if (dateStr) {
          ctx.fillText(dateStr, centerX, currentY);
        }
        ctx.textAlign = "left";
      }

      if (showGuides) {
        ctx.save();
        ctx.strokeStyle =
          toolMode === "move-sig" ? "rgba(219, 39, 119, 0.75)" : "rgba(148, 163, 184, 0.5)";
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.8;
        ctx.strokeRect(sx - 4, sy - 4, cur.w * k + 8, cur.h * k + 8);
        if (!sigImageRef.current) {
          ctx.fillStyle = "rgba(219, 39, 119, 0.85)";
          ctx.font = `600 18px Sarabun, sans-serif`;
          ctx.fillText("กรอบลายเซ็น ผอ. (ลากย้ายได้)", sx + 6, sy + 10);
        }
        ctx.restore();
      }

      ctx.restore();
    },
    [pageNumber, sigPageNumber, signDateIso, signerName, signerTitle, toolMode]
  );

  const renderPreview = useCallback(
    (overrideH?: number) => {
      const cv = previewCanvasRef.current;
      if (!cv) return;
      const h = overrideH || canvasHeight;
      if (cv.height !== h) cv.height = h;
      const ctx = cv.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_W, h);

      if (basePageCanvasRef.current) {
        ctx.drawImage(basePageCanvasRef.current, 0, 0, CANVAS_W, h);
      }

      drawPageOverlay(ctx, pageNumber, true);
    },
    [canvasHeight, drawPageOverlay, pageNumber]
  );

  useEffect(() => {
    renderPreview();
  }, [layout, strokesByPage, sigPageNumber, signDateIso, toolMode, renderPreview]);

  // ส่งออกเฉพาะหน้าที่มีลายมือเขียนแก้ไข หรือมีลายเซ็น ผอ.
  useEffect(() => {
    const exporter = (): DirectorOverlayExport | null => {
      const cur = layoutRef.current;
      const pagesToExport = new Set<number>();

      for (const [pStr, list] of Object.entries(strokesByPageRef.current)) {
        if (list && list.length > 0) {
          pagesToExport.add(Number(pStr));
        }
      }

      if (cur.showSignatureOnDoc && (sigImageRef.current || cur.showSignerCaption)) {
        pagesToExport.add(sigPageNumber);
      }

      if (pagesToExport.size === 0) return null;

      const overlays: { pageNumber: number; overlayPngDataUrl: string }[] = [];
      for (const pNum of Array.from(pagesToExport).sort((a, b) => a - b)) {
        const h = pageHeightsRef.current[pNum] || canvasHeight;
        const off = document.createElement("canvas");
        off.width = CANVAS_W;
        off.height = h;
        const ctx = off.getContext("2d");
        if (!ctx) continue;
        ctx.clearRect(0, 0, CANVAS_W, h);
        drawPageOverlay(ctx, pNum, false);
        overlays.push({
          pageNumber: pNum,
          overlayPngDataUrl: off.toDataURL("image/png"),
        });
      }

      return {
        overlays,
        pageNumber: sigPageNumber,
      };
    };

    onBindExporter(exporter);
    return () => onBindExporter(null);
  }, [canvasHeight, drawPageOverlay, onBindExporter, sigPageNumber]);

  const saveLayoutToStorage = (next: SigLayoutState) => {
    try {
      localStorage.setItem(STORAGE_SIG_LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const pointerToMm = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const cv = previewCanvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const xMm = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 210;
    const yMm = ((e.clientY - rect.top) / Math.max(1, rect.height)) * (canvasHeight / MM_TO_PX);
    return [xMm, yMm];
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = pointerToMm(e);

    if (toolMode === "pen") {
      e.currentTarget.setPointerCapture(e.pointerId);
      activeStrokeRef.current = {
        color: penColor,
        widthPx: penWidth,
        points: [{ xMm: x, yMm: y }],
      };
      renderPreview();
      return;
    }

    const cur = layoutRef.current;
    if (!cur.showSignatureOnDoc) return;

    // หากคลิกในโหมดย้ายลายเซ็นบนหน้าอื่น หรือคลิกที่กรอบลายเซ็น
    const inSigBox =
      pageNumber === sigPageNumber &&
      x >= cur.x - 4 &&
      x <= cur.x + cur.w + 4 &&
      y >= cur.y - 4 &&
      y <= cur.y + cur.h + 4;

    if (inSigBox) {
      dragSigRef.current = { dx: x - cur.x, dy: y - cur.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (pageNumber !== sigPageNumber) {
      // ถ้าย้ายมาหน้าอื่นแล้วแตะวางในโหมดย้ายลายเซ็น ให้ดึงลายเซ็นมาหน้านี้ทันที
      setSigPageNumber(pageNumber);
      const next = {
        ...cur,
        x: Math.max(5, Math.min(180, x - cur.w / 2)),
        y: Math.max(5, Math.min(275, y - 5)),
      };
      setLayout(next);
      layoutRef.current = next;
      dragSigRef.current = { dx: cur.w / 2, dy: 5 };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = pointerToMm(e);

    if (toolMode === "pen") {
      if (!activeStrokeRef.current) return;
      activeStrokeRef.current.points.push({ xMm: x, yMm: y });
      renderPreview();
      return;
    }

    if (!dragSigRef.current) return;
    const { dx, dy } = dragSigRef.current;
    const nextX = Math.max(2, Math.min(195, x - dx));
    const nextY = Math.max(2, Math.min(285, y - dy));

    setLayout((prev) => {
      const updated = { ...prev, x: nextX, y: nextY };
      layoutRef.current = updated;
      return updated;
    });
  };

  const handlePointerUp = () => {
    if (toolMode === "pen" && activeStrokeRef.current) {
      const finished = activeStrokeRef.current;
      activeStrokeRef.current = null;
      setStrokesByPage((prev) => {
        const list = prev[pageNumber] || [];
        const next = { ...prev, [pageNumber]: [...list, finished] };
        strokesByPageRef.current = next;
        return next;
      });
      return;
    }

    if (dragSigRef.current) {
      dragSigRef.current = null;
      saveLayoutToStorage(layoutRef.current);
    }
  };

  const handleUndoStroke = () => {
    setStrokesByPage((prev) => {
      const list = prev[pageNumber] || [];
      if (list.length === 0) return prev;
      const next = { ...prev, [pageNumber]: list.slice(0, -1) };
      strokesByPageRef.current = next;
      return next;
    });
  };

  const handleClearPageStrokes = () => {
    setStrokesByPage((prev) => {
      const next = { ...prev, [pageNumber]: [] };
      strokesByPageRef.current = next;
      return next;
    });
  };

  const handleUploadSigFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const objectUrl = URL.createObjectURL(file);
    try {
      const cleanDataUrl = await normalizeSignatureToBlueTransparentDataUrl(objectUrl);
      setSigDataUrl(cleanDataUrl);
      localStorage.setItem(STORAGE_SIG_KEY, cleanDataUrl);
    } catch {
      // ignore
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const startDrawSig = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = drawPadRef.current;
    if (!cv) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = cv.getBoundingClientRect();
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = BLUE_INK;
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    isDrawingSigRef.current = true;
  };

  const moveDrawSig = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingSigRef.current) return;
    const cv = drawPadRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const endDrawSig = () => {
    isDrawingSigRef.current = false;
  };

  const saveDrawnSig = () => {
    const cv = drawPadRef.current;
    if (!cv) return;
    const url = cv.toDataURL("image/png");
    setSigDataUrl(url);
    try {
      localStorage.setItem(STORAGE_SIG_KEY, url);
    } catch {
      // ignore
    }
    setShowDrawModal(false);
  };

  const clearDrawnPad = () => {
    const cv = drawPadRef.current;
    const ctx = cv?.getContext("2d");
    if (cv && ctx) ctx.clearRect(0, 0, cv.width, cv.height);
  };

  const currentPageStrokeCount = (strokesByPage[pageNumber] || []).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      {/* ฝั่งซ้าย: โหมดเขียนแก้ไขด้วยลายมือ & ลายเซ็น ผอ. */}
      <div className="lg:col-span-5 space-y-3 bg-slate-50/90 p-4 rounded-2xl border border-slate-200">
        {/* สลับโหมดการทำงานบนกระดาษ */}
        <div className="p-3 rounded-xl bg-white border border-slate-200/80 space-y-2.5">
          <div className="text-xs font-bold text-slate-700">
            เลือกโหมดใช้งานบนหน้ากระดาษ PDF:
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setToolMode("move-sig")}
              className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                toolMode === "move-sig"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
              }`}
            >
              <Move className="w-3.5 h-3.5" />
              <span>ย้ายตำแหน่งลายเซ็น</span>
            </button>
            <button
              type="button"
              onClick={() => setToolMode("pen")}
              className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                toolMode === "pen"
                  ? "bg-rose-600 text-white border-rose-600 shadow-xs"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
              }`}
            >
              <PenLine className="w-3.5 h-3.5" />
              <span>เขียนแก้ไขบนกระดาษ</span>
            </button>
          </div>

          {/* เครื่องมือปากกาเขียนแก้ไขบนกระดาษ */}
          {toolMode === "pen" && (
            <div className="pt-2 border-t border-slate-100 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-600">สีปากกาเขียนแก้ไข:</span>
                <div className="flex items-center gap-1.5">
                  {[
                    { color: "#dc2626", label: "แดง (แก้ไข)" },
                    { color: "#1a2fa0", label: "น้ำเงิน" },
                    { color: "#059669", label: "เขียว" },
                  ].map((c) => (
                    <button
                      key={c.color}
                      type="button"
                      onClick={() => setPenColor(c.color)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border flex items-center gap-1 ${
                        penColor === c.color
                          ? "border-slate-800 bg-slate-100 text-slate-900"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{ backgroundColor: c.color }}
                      />
                      <span>{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <label className="block text-[11px] text-slate-500 mb-0.5">
                    ความหนาเส้นปากกา
                  </label>
                  <input
                    type="range"
                    min={2}
                    max={9}
                    step={0.5}
                    value={penWidth}
                    onChange={(e) => setPenWidth(Number(e.target.value))}
                    className="w-full accent-rose-600"
                  />
                </div>
                <div className="flex items-center gap-1.5 pt-3">
                  <button
                    type="button"
                    disabled={currentPageStrokeCount === 0}
                    onClick={handleUndoStroke}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 disabled:opacity-40 inline-flex items-center gap-1"
                    title="ย้อนกลับเส้นล่าสุด"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>ย้อนกลับ</span>
                  </button>
                  <button
                    type="button"
                    disabled={currentPageStrokeCount === 0}
                    onClick={handleClearPageStrokes}
                    className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-700 disabled:opacity-40 inline-flex items-center gap-1"
                    title="ลบเส้นที่เขียนในหน้านี้ทั้งหมด"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>ล้างหน้านี้</span>
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-rose-700 bg-rose-50/80 p-2 rounded-lg">
                ✏️ ใช้ปากกา iPad, นิ้ว หรือเมาส์ ขีดวงกลมหรือเขียนข้อความแก้ไขลงบนหน้ากระดาษด้านขวาได้โดยตรงทุกหน้าครับ
              </p>
            </div>
          )}
        </div>

        {/* ลายเซ็น ผอ. (รูปแบบเดิมที่ติ๊กถูกไว้) */}
        <div className="p-3.5 rounded-xl bg-white border border-slate-200/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={layout.showSignatureOnDoc}
                onChange={(e) => {
                  const next = { ...layout, showSignatureOnDoc: e.target.checked };
                  setLayout(next);
                  saveLayoutToStorage(next);
                }}
                className="accent-indigo-600 w-3.5 h-3.5"
              />
              <span>ลายเซ็น ผอ. (จำไว้ใช้อัตโนมัติ)</span>
            </label>
            <div className="flex items-center gap-2">
              {pageNumber !== sigPageNumber && layout.showSignatureOnDoc && (
                <button
                  type="button"
                  onClick={() => setSigPageNumber(pageNumber)}
                  className="text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-lg border border-indigo-200"
                >
                  ย้ายลายเซ็นมาหน้า {pageNumber}
                </button>
              )}
              {sigDataUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setSigDataUrl(null);
                    localStorage.removeItem(STORAGE_SIG_KEY);
                  }}
                  className="text-[11px] text-rose-600 hover:underline inline-flex items-center gap-1"
                >
                  <Eraser className="w-3 h-3" />
                  ลบลายเซ็น
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <label className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-bold cursor-pointer">
              <ImageUp className="w-3.5 h-3.5" />
              <span>อัปโหลดรูปลายเซ็น (PNG/JPG)</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={handleUploadSigFile}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowDrawModal(true)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-pink-50 hover:bg-pink-100 text-pink-800 border border-pink-200 text-xs font-bold"
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>วาดลายเซ็น</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 items-center pt-1">
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">ขนาดลายเซ็น</label>
              <input
                type="range"
                min={20}
                max={75}
                step={1}
                value={layout.sigWidthMm}
                onChange={(e) => {
                  const next = { ...layout, sigWidthMm: Number(e.target.value) };
                  setLayout(next);
                  saveLayoutToStorage(next);
                }}
                className="w-full accent-pink-600"
              />
            </div>
            <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer mt-3">
              <input
                type="checkbox"
                checked={layout.showSignerCaption}
                onChange={(e) => {
                  const next = { ...layout, showSignerCaption: e.target.checked };
                  setLayout(next);
                  saveLayoutToStorage(next);
                }}
                className="accent-indigo-700"
              />
              <span>พิมพ์ชื่อ-ตำแหน่ง-วันที่ใต้ลายเซ็น</span>
            </label>
          </div>

          {layout.showSignerCaption && (
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">วันที่ลงนาม</label>
                <input
                  type="date"
                  value={signDateIso}
                  onChange={(e) => setSignDateIso(e.target.value)}
                  className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs"
                />
              </div>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer mt-4">
                <input
                  type="checkbox"
                  checked={layout.useThaiNumeralDate}
                  onChange={(e) => {
                    const next = { ...layout, useThaiNumeralDate: e.target.checked };
                    setLayout(next);
                    saveLayoutToStorage(next);
                  }}
                  className="accent-indigo-700"
                />
                <span>ใช้เลขไทย (๑๖ พ.ย. ๒๕๖๙)</span>
              </label>
            </div>
          )}

          <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
            <span>
              หน้าที่มีลายเซ็น: <b>หน้า {sigPageNumber}</b> / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => {
                setLayout(DEFAULT_SIG_LAYOUT);
                saveLayoutToStorage(DEFAULT_SIG_LAYOUT);
              }}
              className="text-slate-600 hover:text-indigo-700 inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              รีเซ็ตตำแหน่งลายเซ็น
            </button>
          </div>
        </div>

        {/* ช่องพิมพ์หมายเหตุแจ้งครูในระบบและ LINE */}
        <div className="p-3 rounded-xl bg-white border border-slate-200/80 space-y-1.5">
          <label className="block text-xs font-bold text-slate-700">
            หมายเหตุ / ข้อความแจ้งครูใน LINE (ถ้ามี):
          </label>
          <textarea
            value={commentText}
            onChange={(e) => onCommentChange(e.target.value)}
            rows={2}
            placeholder="พิมพ์ข้อเสนอแนะหรือจุดที่ให้แก้ไข (จะส่งแจ้งเตือนใน LINE ให้ครูทราบ)..."
            className="w-full p-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* ฝั่งขวา: ตัวอย่างหน้ากระดาษ PDF จริง */}
      <div className="lg:col-span-7 flex flex-col items-center space-y-2 bg-slate-200/70 p-3 sm:p-4 rounded-2xl border border-slate-300">
        {/* แถบเลือกหน้า (เอาคำว่า บันทึกข้อความ ออกตามที่แจ้ง) */}
        <div className="w-full flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 rounded-xl shadow-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={pageNumber <= 1 || loadingPdf}
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              className="p-1 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-slate-700 px-2">
              หน้า {pageNumber} / {totalPages}
            </span>
            <button
              type="button"
              disabled={pageNumber >= totalPages || loadingPdf}
              onClick={() => setPageNumber((p) => Math.min(totalPages, p + 1))}
              className="p-1 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <span className="text-[11px] font-semibold text-indigo-700">
            {toolMode === "pen"
              ? "✏️ โหมดปากกา: เขียนข้อความแก้ไขลงบนกระดาษได้เลย"
              : "✋ โหมดย้ายลายเซ็น: แตะลากลายเซ็นไปวางจุดที่ต้องการ"}
          </span>
        </div>

        {loadingPdf && (
          <div className="py-16 flex flex-col items-center justify-center text-slate-600 text-xs gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            <span>กำลังโหลดหน้าเอกสาร PDF จาก Google Drive...</span>
          </div>
        )}

        {pdfError && (
          <div className="w-full p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            ⚠️ {pdfError}
          </div>
        )}

        <div className="w-full flex justify-center overflow-auto max-h-[70vh]">
          <canvas
            ref={previewCanvasRef}
            width={CANVAS_W}
            height={canvasHeight}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={`w-full max-w-[540px] h-auto bg-white shadow-lg rounded-lg border border-slate-300 touch-none select-none ${
              toolMode === "pen"
                ? "cursor-crosshair"
                : "cursor-grab active:cursor-grabbing"
            }`}
          />
        </div>
      </div>

      {/* Modal สำหรับวาดลายเซ็น ผอ. */}
      {showDrawModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-3 border border-slate-200">
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-bold text-slate-800">วาดลายเซ็น ผอ. (หมึกสีน้ำเงิน)</h5>
              <button
                type="button"
                onClick={clearDrawnPad}
                className="text-xs text-slate-600 hover:text-slate-900 px-2.5 py-1 rounded-lg border border-slate-200"
              >
                ล้างกระดาน
              </button>
            </div>
            <canvas
              ref={drawPadRef}
              width={420}
              height={170}
              onPointerDown={startDrawSig}
              onPointerMove={moveDrawSig}
              onPointerUp={endDrawSig}
              className="w-full h-[170px] rounded-xl border-2 border-dashed border-indigo-200 bg-slate-50/50 cursor-crosshair touch-none"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDrawModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={saveDrawnSig}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
              >
                บันทึกลายเซ็นนี้ไว้ใช้งาน
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
