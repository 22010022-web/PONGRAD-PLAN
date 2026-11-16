"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Hand,
  ImageUp,
  Loader2,
  Maximize2,
  Minimize2,
  Move,
  PenLine,
  PenTool,
  RotateCcw,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
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

const CANVAS_W = 1654; // ความละเอียดสูง (A4 ~200 DPI) เพื่อเวลาซูม 200-300% ตัวหนังสือและเส้นปากกายังคมชัด
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

interface StrokePoint {
  xMm: number;
  yMm: number;
  p: number; // น้ำหนักกดปากกา (0.25 .. 1.65)
  t?: number;
}

interface PenStroke {
  color: string;
  baseWidthMm: number; // ความหนาพื้นฐานในหน่วย mm
  points: StrokePoint[];
}

/**
 * คำนวณน้ำหนักเส้นปากกาจากแรงกดจริงของ Apple Pencil (e.pressure)
 * หรือความเร็วการลากกรณีใช้เมาส์/นิ้วที่ไม่ส่งค่าแรงกดหลายระดับ
 */
function computePointPressure(
  pointerType: string,
  rawPressure: number,
  prevPoint?: StrokePoint,
  xMm?: number,
  yMm?: number,
  nowMs?: number
): number {
  if (pointerType === "pen" && rawPressure > 0 && rawPressure !== 0.5) {
    // Apple Pencil / Stylus: ขยายช่วงแรงกดให้เห็นเส้นหนัก-เบาชัดเจนเหมือนปากกาหมึกซึม
    return Math.max(0.28, Math.min(1.65, 0.3 + Math.pow(rawPressure, 0.85) * 1.35));
  }

  // กรณีเมาส์หรือนิ้ว: ปรับน้ำหนักเส้นตามความเร็วการตวัดปากกาอย่างเป็นธรรมชาติ + เฉลี่ยให้สมูท
  if (prevPoint && xMm !== undefined && yMm !== undefined && nowMs && prevPoint.t) {
    const dt = Math.max(4, nowMs - prevPoint.t);
    const distMm = Math.hypot(xMm - prevPoint.xMm, yMm - prevPoint.yMm);
    const speed = distMm / dt; // mm per ms
    const targetP = Math.max(0.45, Math.min(1.25, 1.18 - speed * 0.45));
    return prevPoint.p * 0.65 + targetP * 0.35;
  }

  return 0.95;
}

/**
 * วาดเส้นปากกาแบบมีน้ำหนักหนัก-เบาตามแรงกด (Variable-Width Smooth Curve)
 */
function renderPressureStroke(
  ctx: CanvasRenderingContext2D,
  stroke: PenStroke,
  mmToPx: number
) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;

  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const basePx = Math.max(1.2, stroke.baseWidthMm * mmToPx);

  if (pts.length === 1) {
    const r = (basePx * (pts[0].p || 1)) / 2;
    ctx.beginPath();
    ctx.arc(pts[0].xMm * mmToPx, pts[0].yMm * mmToPx, Math.max(0.8, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (pts.length === 2) {
    const pAvg = ((pts[0].p || 1) + (pts[1].p || 1)) / 2;
    ctx.lineWidth = Math.max(1, basePx * pAvg);
    ctx.beginPath();
    ctx.moveTo(pts[0].xMm * mmToPx, pts[0].yMm * mmToPx);
    ctx.lineTo(pts[1].xMm * mmToPx, pts[1].yMm * mmToPx);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // วาดเส้นโค้ง Quadratic Bezier ทีละช่วงเพื่อให้เปลี่ยนความหนาตามน้ำหนักกดปากกาได้อย่างนุ่มนวล
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const pPrev = i >= 2 ? pts[i - 2] : p0;

    const startX = ((pPrev.xMm + p0.xMm) / 2) * mmToPx;
    const startY = ((pPrev.yMm + p0.yMm) / 2) * mmToPx;
    const ctrlX = p0.xMm * mmToPx;
    const ctrlY = p0.yMm * mmToPx;
    const endX =
      i === pts.length - 1 ? p1.xMm * mmToPx : ((p0.xMm + p1.xMm) / 2) * mmToPx;
    const endY =
      i === pts.length - 1 ? p1.yMm * mmToPx : ((p0.yMm + p1.yMm) / 2) * mmToPx;

    const pressure = ((p0.p || 1) + (p1.p || 1)) / 2;
    ctx.lineWidth = Math.max(0.9, basePx * pressure);

    ctx.beginPath();
    if (i === 1) {
      ctx.moveTo(p0.xMm * mmToPx, p0.yMm * mmToPx);
    } else {
      ctx.moveTo(startX, startY);
    }
    ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
    ctx.stroke();
  }

  ctx.restore();
}

async function normalizeSignatureToBlueTransparentDataUrl(srcUrl: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = srcUrl;
  await img.decode();

  const maxDim = 700;
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
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const drawPadRef = useRef<HTMLCanvasElement | null>(null);
  const basePageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigImageRef = useRef<HTMLImageElement | null>(null);

  const [canvasHeight, setCanvasHeight] = useState(Math.round(CANVAS_W * 1.4142));
  const pageHeightsRef = useRef<Record<number, number>>({});
  const [pdfDocProxy, setPdfDocProxy] = useState<any>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);
  const [sigPageNumber, setSigPageNumber] = useState(1);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // ระบบซูมหน้ากระดาษ (+ / -) และขยายเต็มจอสำหรับเขียนบน iPad / จอเล็ก
  const [zoomPercent, setZoomPercent] = useState(100);
  const [isFullscreenWorkspace, setIsFullscreenWorkspace] = useState(false);
  const [ipadPencilOnly, setIpadPencilOnly] = useState(false);

  // โหมดการใช้งานบนกระดาษ: "move-sig" = ย้ายลายเซ็น, "pen" = เขียนด้วยปากกา, "pan" = เลื่อนกระดาษที่ซูม
  const [toolMode, setToolMode] = useState<"move-sig" | "pen" | "pan">("move-sig");
  const [penColor, setPenColor] = useState("#dc2626");
  const [penBaseWidthMm, setPenBaseWidthMm] = useState(0.65);
  const [strokesByPage, setStrokesByPage] = useState<Record<number, PenStroke[]>>({});
  const strokesByPageRef = useRef<Record<number, PenStroke[]>>({});
  const activeStrokeRef = useRef<PenStroke | null>(null);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [showDrawModal, setShowDrawModal] = useState(false);
  const sigPadStrokesRef = useRef<PenStroke[]>([]);
  const activeSigPadStrokeRef = useRef<PenStroke | null>(null);

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
        setSigPageNumber(pdf.numPages);
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

      // 1. วาดเส้นปากกาตามน้ำหนักกด (Pressure-Sensitive Handwriting)
      const pageStrokes = strokesByPageRef.current[targetPage] || [];
      const allStrokes =
        targetPage === pageNumber && activeStrokeRef.current
          ? [...pageStrokes, activeStrokeRef.current]
          : pageStrokes;

      for (const stroke of allStrokes) {
        renderPressureStroke(ctx, stroke, k);
      }

      // 2. วาดลายเซ็น ผอ.
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
          toolMode === "move-sig" ? "rgba(219, 39, 119, 0.78)" : "rgba(148, 163, 184, 0.5)";
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 2;
        ctx.strokeRect(sx - 5, sy - 5, cur.w * k + 10, cur.h * k + 10);
        if (!sigImageRef.current) {
          ctx.fillStyle = "rgba(219, 39, 119, 0.85)";
          ctx.font = `600 22px Sarabun, sans-serif`;
          ctx.fillText("กรอบลายเซ็น ผอ. (ลากย้ายได้)", sx + 8, sy + 12);
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

  const clientCoordsToMm = (clientX: number, clientY: number): [number, number] => {
    const cv = previewCanvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const xMm = ((clientX - rect.left) / Math.max(1, rect.width)) * 210;
    const yMm =
      ((clientY - rect.top) / Math.max(1, rect.height)) * (canvasHeight / MM_TO_PX);
    return [xMm, yMm];
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // หากใช้ Apple Pencil แตะหน้าจอ ให้ตรวจจับและเปิดโหมดแยกนิ้วเลื่อนให้อัตโนมัติได้ หรือสลับมาเขียนได้ทันที
    const isStylus = e.pointerType === "pen";
    const isFingerTouch = e.pointerType === "touch";

    // กรณีอยู่ในโหมดเลื่อนกระดาษ (pan) หรือเปิดโหมด iPad (ใช้นิ้วเลื่อน / ใช้ปากกาเขียน) แล้วแตะด้วยนิ้ว
    if (toolMode === "pan" || (toolMode === "pen" && ipadPencilOnly && isFingerTouch)) {
      const container = scrollContainerRef.current;
      if (!container) return;
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const [x, y] = clientCoordsToMm(e.clientX, e.clientY);

    if (toolMode === "pen" || isStylus) {
      if (isStylus && toolMode !== "pen") {
        setToolMode("pen");
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      const now = performance.now();
      const p = computePointPressure(e.pointerType, e.pressure, undefined, x, y, now);
      activeStrokeRef.current = {
        color: penColor,
        baseWidthMm: penBaseWidthMm,
        points: [{ xMm: x, yMm: y, p, t: now }],
      };
      renderPreview();
      return;
    }

    const cur = layoutRef.current;
    if (!cur.showSignatureOnDoc) return;

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
    if (panStartRef.current) {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollLeft =
          panStartRef.current.scrollLeft - (e.clientX - panStartRef.current.clientX);
        container.scrollTop =
          panStartRef.current.scrollTop - (e.clientY - panStartRef.current.clientY);
      }
      return;
    }

    if (activeStrokeRef.current) {
      const stroke = activeStrokeRef.current;
      const coalesced: PointerEvent[] =
        typeof (e.nativeEvent as any).getCoalescedEvents === "function"
          ? (e.nativeEvent as any).getCoalescedEvents()
          : [e.nativeEvent];

      for (const ev of coalesced) {
        const [cx, cy] = clientCoordsToMm(ev.clientX, ev.clientY);
        const lastPt = stroke.points[stroke.points.length - 1];
        if (lastPt && Math.hypot(cx - lastPt.xMm, cy - lastPt.yMm) < 0.08) {
          continue;
        }
        const now = performance.now();
        const p = computePointPressure(
          ev.pointerType || e.pointerType,
          ev.pressure ?? e.pressure,
          lastPt,
          cx,
          cy,
          now
        );
        stroke.points.push({ xMm: cx, yMm: cy, p, t: now });
      }

      renderPreview();
      return;
    }

    if (!dragSigRef.current) return;
    const [x, y] = clientCoordsToMm(e.clientX, e.clientY);
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
    if (panStartRef.current) {
      panStartRef.current = null;
      return;
    }

    if (activeStrokeRef.current) {
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

  // --- กระดานวาดลายเซ็น ผอ. แบบรองรับแรงกดปากกา iPad ---
  const renderSigPadCanvas = () => {
    const cv = drawPadRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const all = activeSigPadStrokeRef.current
      ? [...sigPadStrokesRef.current, activeSigPadStrokeRef.current]
      : sigPadStrokesRef.current;
    for (const s of all) {
      renderPressureStroke(ctx, s, 4);
    }
  };

  const startDrawSig = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = drawPadRef.current;
    if (!cv) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = cv.getBoundingClientRect();
    const xMm = ((e.clientX - rect.left) / Math.max(1, rect.width)) * (cv.width / 4);
    const yMm = ((e.clientY - rect.top) / Math.max(1, rect.height)) * (cv.height / 4);
    const now = performance.now();
    const p = computePointPressure(e.pointerType, e.pressure, undefined, xMm, yMm, now);
    activeSigPadStrokeRef.current = {
      color: BLUE_INK,
      baseWidthMm: 0.9,
      points: [{ xMm, yMm, p, t: now }],
    };
    renderSigPadCanvas();
  };

  const moveDrawSig = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = drawPadRef.current;
    const stroke = activeSigPadStrokeRef.current;
    if (!cv || !stroke) return;
    const rect = cv.getBoundingClientRect();
    const xMm = ((e.clientX - rect.left) / Math.max(1, rect.width)) * (cv.width / 4);
    const yMm = ((e.clientY - rect.top) / Math.max(1, rect.height)) * (cv.height / 4);
    const lastPt = stroke.points[stroke.points.length - 1];
    const now = performance.now();
    const p = computePointPressure(e.pointerType, e.pressure, lastPt, xMm, yMm, now);
    stroke.points.push({ xMm, yMm, p, t: now });
    renderSigPadCanvas();
  };

  const endDrawSig = () => {
    if (activeSigPadStrokeRef.current) {
      sigPadStrokesRef.current = [
        ...sigPadStrokesRef.current,
        activeSigPadStrokeRef.current,
      ];
      activeSigPadStrokeRef.current = null;
      renderSigPadCanvas();
    }
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
    sigPadStrokesRef.current = [];
    activeSigPadStrokeRef.current = null;
    renderSigPadCanvas();
  };

  const currentPageStrokeCount = (strokesByPage[pageNumber] || []).length;
  const baseDisplayWidth = isFullscreenWorkspace ? 760 : 540;
  const zoomedWidthPx = Math.round((baseDisplayWidth * zoomPercent) / 100);

  return (
    <div
      className={
        isFullscreenWorkspace
          ? "fixed inset-2 z-[55] bg-slate-100 rounded-3xl p-4 shadow-2xl border border-slate-300 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-4 items-start"
          : "grid grid-cols-1 lg:grid-cols-12 gap-4 items-start"
      }
    >
      {/* ฝั่งซ้าย: โหมดเขียนแก้ไขด้วยปากกา iPad & ลายเซ็น ผอ. */}
      <div className="lg:col-span-5 space-y-3 bg-slate-50/90 p-4 rounded-2xl border border-slate-200">
        {/* สลับโหมดการทำงานบนกระดาษ */}
        <div className="p-3 rounded-xl bg-white border border-slate-200/80 space-y-2.5">
          <div className="text-xs font-bold text-slate-700">
            เลือกโหมดใช้งานบนหน้ากระดาษ PDF:
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => setToolMode("move-sig")}
              className={`py-2.5 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 border transition-all ${
                toolMode === "move-sig"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
              }`}
            >
              <Move className="w-3.5 h-3.5 shrink-0" />
              <span>ย้ายลายเซ็น</span>
            </button>
            <button
              type="button"
              onClick={() => setToolMode("pen")}
              className={`py-2.5 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 border transition-all ${
                toolMode === "pen"
                  ? "bg-rose-600 text-white border-rose-600 shadow-xs"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
              }`}
            >
              <PenLine className="w-3.5 h-3.5 shrink-0" />
              <span>ปากกาเขียนแก้</span>
            </button>
            <button
              type="button"
              onClick={() => setToolMode("pan")}
              className={`py-2.5 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 border transition-all ${
                toolMode === "pan"
                  ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
              }`}
            >
              <Hand className="w-3.5 h-3.5 shrink-0" />
              <span>เลื่อนกระดาษ</span>
            </button>
          </div>

          {/* เครื่องมือปากกาเขียนแก้ไขตามน้ำหนักกด */}
          {toolMode === "pen" && (
            <div className="pt-2 border-t border-slate-100 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-600">สีหมึกปากกา:</span>
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
                    ขนาดหัวปากกา (แปรผันตามน้ำหนักกดปากกา iPad อัตโนมัติ)
                  </label>
                  <input
                    type="range"
                    min={0.35}
                    max={1.4}
                    step={0.05}
                    value={penBaseWidthMm}
                    onChange={(e) => setPenBaseWidthMm(Number(e.target.value))}
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

              <label className="flex items-center gap-2 text-[11px] font-semibold text-indigo-900 bg-indigo-50/70 p-2 rounded-lg border border-indigo-200/70 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ipadPencilOnly}
                  onChange={(e) => setIpadPencilOnly(e.target.checked)}
                  className="accent-indigo-600 w-3.5 h-3.5"
                />
                <span>
                  โหมดปากกา iPad (ใช้ปากกาเขียนตามแรงกด / ใช้นิ้วแตะเลื่อนกระดาษที่ซูม)
                </span>
              </label>
            </div>
          )}
        </div>

        {/* ลายเซ็น ผอ. */}
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
              onClick={() => {
                sigPadStrokesRef.current = [];
                activeSigPadStrokeRef.current = null;
                setShowDrawModal(true);
              }}
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

      {/* ฝั่งขวา: ตัวอย่างหน้ากระดาษ PDF จริง พร้อมระบบซูม +/- และขยายเต็มจอ */}
      <div className="lg:col-span-7 flex flex-col items-center space-y-2 bg-slate-200/80 p-3 sm:p-4 rounded-2xl border border-slate-300">
        {/* แถบเลือกหน้า + แถบซูมกระดาษ (+/-) */}
        <div className="w-full flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 rounded-xl shadow-xs">
          {/* เลือกหน้า */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={pageNumber <= 1 || loadingPdf}
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
              title="หน้าก่อนหน้า"
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
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
              title="หน้าถัดไป"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* ปุ่มซูม - / + และขนาดด่วน */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={zoomPercent <= 100}
              onClick={() => setZoomPercent((z) => Math.max(100, z - 25))}
              className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 disabled:opacity-40"
              title="ซูมออก (-)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            {[100, 150, 200, 250].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setZoomPercent(preset)}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                  zoomPercent === preset
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                }`}
              >
                {preset}%
              </button>
            ))}
            <button
              type="button"
              disabled={zoomPercent >= 325}
              onClick={() => setZoomPercent((z) => Math.min(325, z + 25))}
              className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 disabled:opacity-40"
              title="ซูมเข้า (+)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsFullscreenWorkspace((v) => !v)}
              className={`ml-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border inline-flex items-center gap-1 ${
                isFullscreenWorkspace
                  ? "bg-amber-600 text-white border-amber-600"
                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
              }`}
              title="ขยายพื้นที่เขียนให้ใหญ่เต็มจอ"
            >
              {isFullscreenWorkspace ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>ย่อกลับ</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>ขยายจอ</span>
                </>
              )}
            </button>
          </div>
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

        <div
          ref={scrollContainerRef}
          className={`w-full overflow-auto rounded-xl border border-slate-300 bg-slate-300/60 p-2 ${
            isFullscreenWorkspace ? "max-h-[82vh]" : "max-h-[70vh]"
          }`}
        >
          <div className="min-w-full flex justify-center">
            <canvas
              ref={previewCanvasRef}
              width={CANVAS_W}
              height={canvasHeight}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                width: `${zoomedWidthPx}px`,
                maxWidth: zoomPercent === 100 ? "100%" : "none",
              }}
              className={`h-auto bg-white shadow-lg rounded-lg border border-slate-300 touch-none select-none ${
                toolMode === "pen"
                  ? "cursor-crosshair"
                  : "cursor-grab active:cursor-grabbing"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Modal สำหรับวาดลายเซ็น ผอ. (รองรับน้ำหนักกดปากกา iPad เช่นกัน) */}
      {showDrawModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-3 border border-slate-200">
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-bold text-slate-800">
                วาดลายเซ็น ผอ. (รองรับน้ำหนักกดปากกา iPad)
              </h5>
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
              width={560}
              height={220}
              onPointerDown={startDrawSig}
              onPointerMove={moveDrawSig}
              onPointerUp={endDrawSig}
              onPointerCancel={endDrawSig}
              className="w-full h-[180px] rounded-xl border-2 border-dashed border-indigo-200 bg-slate-50/50 cursor-crosshair touch-none"
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
