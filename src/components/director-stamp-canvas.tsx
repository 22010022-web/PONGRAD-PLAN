"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eraser,
  FileText,
  Hand,
  Highlighter,
  ImageUp,
  Loader2,
  LocateFixed,
  Maximize2,
  Minimize2,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  PenTool,
  Redo2,
  RotateCcw,
  ScrollText,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  FloatingRadialToolbar,
  PdfWorkspaceToolMode,
} from "@/components/floating-radial-toolbar";
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
  tool?: "pen" | "highlighter";
  opacity?: number;
}

interface StrokeHistoryEntry {
  page: number;
  prev: PenStroke[];
  next: PenStroke[];
}

function isPointNearStroke(
  xMm: number,
  yMm: number,
  stroke: PenStroke,
  eraseRadiusMm: number
): boolean {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return false;
  const threshold = eraseRadiusMm + stroke.baseWidthMm * 0.45;
  if (pts.length === 1) {
    return Math.hypot(xMm - pts[0].xMm, yMm - pts[0].yMm) <= threshold;
  }

  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const dx = p1.xMm - p0.xMm;
    const dy = p1.yMm - p0.yMm;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((xMm - p0.xMm) * dx + (yMm - p0.yMm) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const projX = p0.xMm + t * dx;
    const projY = p0.yMm + t * dy;
    if (Math.hypot(xMm - projX, yMm - projY) <= threshold) {
      return true;
    }
  }
  return false;
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
 * วาดเส้นปากกาแบบมีน้ำหนักหนัก-เบาตามแรงกด หรือหัวไฮไลต์โปร่งแสงความสม่ำเสมอสูง
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

  if (stroke.tool === "highlighter") {
    ctx.globalAlpha = stroke.opacity ?? 0.34;
    ctx.lineWidth = Math.max(4, basePx);
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].xMm * mmToPx, pts[0].yMm * mmToPx, Math.max(2, basePx / 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].xMm * mmToPx, pts[0].yMm * mmToPx);
    if (pts.length === 2) {
      ctx.lineTo(pts[1].xMm * mmToPx, pts[1].yMm * mmToPx);
    } else {
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const endX =
          i === pts.length - 1 ? p1.xMm * mmToPx : ((p0.xMm + p1.xMm) / 2) * mmToPx;
        const endY =
          i === pts.length - 1 ? p1.yMm * mmToPx : ((p0.yMm + p1.yMm) / 2) * mmToPx;
        ctx.quadraticCurveTo(p0.xMm * mmToPx, p0.yMm * mmToPx, endX, endY);
      }
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

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
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pdfWorkspaceBoxRef = useRef<HTMLDivElement | null>(null);
  const drawPadRef = useRef<HTMLCanvasElement | null>(null);
  const sigImageRef = useRef<HTMLImageElement | null>(null);

  const defaultPageHeightRef = useRef<number>(Math.round(CANVAS_W * 1.4142));
  const pageHeightsRef = useRef<Record<number, number>>({});
  const [pageDimsVersion, setPageDimsVersion] = useState(0);

  const baseCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderingPagesRef = useRef<Set<number>>(new Set());
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const pageSlotRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pdfLoadGenRef = useRef(0);

  const [pdfDocProxy, setPdfDocProxy] = useState<any>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);
  const pageNumberRef = useRef(1);
  const [pageInput, setPageInput] = useState("1");
  const isEditingPageInputRef = useRef(false);

  const [sigPageNumber, setSigPageNumber] = useState(1);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // โหมดแสดงผล: "continuous" = เลื่อนเมาส์/นิ้วอ่านต่อเนื่องทุกหน้า, "single" = ทีละหน้า
  const [viewMode, setViewMode] = useState<"continuous" | "single">("continuous");
  const programmaticJumpUntilRef = useRef(0);
  const pendingScrollPageRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  // ระบบซูมหน้ากระดาษ (+ / -) และขยายเต็มจอสำหรับเขียนบน iPad / จอเล็ก
  const [zoomPercent, setZoomPercent] = useState(100);
  const [isFullscreenWorkspace, setIsFullscreenWorkspace] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [ipadPencilOnly, setIpadPencilOnly] = useState(false);
  const [toolbarCollapseSignal, setToolbarCollapseSignal] = useState(0);

  // โหมดการใช้งานบนกระดาษ: "move-sig" = ย้ายลายเซ็น, "pen" = ปากกา, "highlighter" = ไฮไลต์, "eraser" = ยางลบ, "pan" = เลื่อนกระดาษ
  const [toolMode, setToolMode] = useState<PdfWorkspaceToolMode>("move-sig");
  const [penColor, setPenColor] = useState("#dc2626");
  const [penBaseWidthMm, setPenBaseWidthMm] = useState(0.65);
  const [highlighterColor, setHighlighterColor] = useState("#facc15");
  const [highlighterWidthMm, setHighlighterWidthMm] = useState(6);
  const [eraserRadiusMm, setEraserRadiusMm] = useState(5.5);

  const [strokesByPage, setStrokesByPage] = useState<Record<number, PenStroke[]>>({});
  const strokesByPageRef = useRef<Record<number, PenStroke[]>>({});
  const [strokeHistory, setStrokeHistory] = useState<{
    past: StrokeHistoryEntry[];
    future: StrokeHistoryEntry[];
  }>({ past: [], future: [] });

  const activeStrokeRef = useRef<PenStroke | null>(null);
  const activeStrokePageRef = useRef<number>(1);
  const eraseSessionRef = useRef<{
    page: number;
    initialStrokes: PenStroke[];
    changed: boolean;
  } | null>(null);
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
  const dragSigRef = useRef<{ page: number; dx: number; dy: number } | null>(null);

  const getPageHeightPx = useCallback((pNum: number) => {
    return pageHeightsRef.current[pNum] || defaultPageHeightRef.current;
  }, []);

  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);

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

  const drawPageOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, targetPage: number, showGuides: boolean) => {
      const k = MM_TO_PX;
      const cur = layoutRef.current;

      // 1. วาดไฮไลต์โปร่งแสงไว้ด้านล่าง แล้วทับด้วยเส้นปากกาคมชัดตามน้ำหนักกด
      const pageStrokes = strokesByPageRef.current[targetPage] || [];
      const allStrokes =
        targetPage === activeStrokePageRef.current && activeStrokeRef.current
          ? [...pageStrokes, activeStrokeRef.current]
          : pageStrokes;

      for (const stroke of allStrokes) {
        if (stroke.tool === "highlighter") {
          renderPressureStroke(ctx, stroke, k);
        }
      }
      for (const stroke of allStrokes) {
        if (stroke.tool !== "highlighter") {
          renderPressureStroke(ctx, stroke, k);
        }
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
    [sigPageNumber, signDateIso, signerName, signerTitle, toolMode]
  );

  const redrawPageCanvas = useCallback(
    (pNum: number) => {
      const cv = canvasRefs.current[pNum];
      if (!cv) return;
      const h = getPageHeightPx(pNum);
      if (cv.width !== CANVAS_W) cv.width = CANVAS_W;
      if (cv.height !== h) cv.height = h;
      const ctx = cv.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_W, h);

      const baseCv = baseCanvasesRef.current.get(pNum);
      if (baseCv) {
        baseCanvasesRef.current.delete(pNum);
        baseCanvasesRef.current.set(pNum, baseCv);
        ctx.drawImage(baseCv, 0, 0, CANVAS_W, h);
      }

      drawPageOverlay(ctx, pNum, true);
    },
    [drawPageOverlay, getPageHeightPx]
  );

  const redrawAllVisibleCanvases = useCallback(() => {
    for (const key of Object.keys(canvasRefs.current)) {
      const pNum = Number(key);
      if (canvasRefs.current[pNum]) {
        redrawPageCanvas(pNum);
      }
    }
  }, [redrawPageCanvas]);

  useEffect(() => {
    if (!sigDataUrl) {
      sigImageRef.current = null;
      redrawAllVisibleCanvases();
      return;
    }
    const img = new Image();
    img.onload = () => {
      sigImageRef.current = img;
      redrawAllVisibleCanvases();
    };
    img.src = sigDataUrl;
  }, [sigDataUrl, redrawAllVisibleCanvases]);

  useEffect(() => {
    if (typeof document !== "undefined" && document.fonts) {
      Promise.all([
        document.fonts.load("400 22px Sarabun", "กขค"),
        document.fonts.load("600 22px Sarabun", "กขค"),
      ])
        .then(() => redrawAllVisibleCanvases())
        .catch(() => {});
    }
  }, [redrawAllVisibleCanvases]);

  useEffect(() => {
    let cancelled = false;
    let loadedTask: any = null;
    const gen = ++pdfLoadGenRef.current;

    const clearCachedCanvases = () => {
      baseCanvasesRef.current.forEach((cv) => {
        cv.width = 0;
        cv.height = 0;
      });
      baseCanvasesRef.current.clear();
      renderingPagesRef.current.clear();
    };

    async function loadPdf() {
      const resolvedId = fileId?.trim() || extractDriveFileId(fileUrl);
      if (!resolvedId) {
        setPdfError("ไม่พบรหัสไฟล์บน Google Drive");
        return;
      }

      clearCachedCanvases();
      pageHeightsRef.current = {};
      canvasRefs.current = {};
      pageSlotRefs.current = {};
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
        if (cancelled || gen !== pdfLoadGenRef.current) return;

        // วัดอัตราส่วนหน้าแรกและหน้าสุดท้ายล่วงหน้า เพื่อให้โครงหน้าต่อเนื่องและขนาด export แม่นยำทันที
        try {
          const p1 = await pdf.getPage(1);
          const vp1 = p1.getViewport({ scale: 1 });
          const h1 = Math.round(vp1.height * (CANVAS_W / Math.max(1, vp1.width)));
          defaultPageHeightRef.current = h1;
          pageHeightsRef.current[1] = h1;

          if (pdf.numPages > 1) {
            const pLast = await pdf.getPage(pdf.numPages);
            const vpLast = pLast.getViewport({ scale: 1 });
            pageHeightsRef.current[pdf.numPages] = Math.round(
              vpLast.height * (CANVAS_W / Math.max(1, vpLast.width))
            );
          }
        } catch {
          // fallback to default A4 aspect ratio
        }

        if (cancelled || gen !== pdfLoadGenRef.current) return;
        setPdfDocProxy(pdf);
        setTotalPages(pdf.numPages);
        setPageNumber(1);
        pageNumberRef.current = 1;
        setPageInput("1");
        setSigPageNumber(pdf.numPages);
        setPageDimsVersion((v) => v + 1);
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
      pdfLoadGenRef.current += 1;
      clearCachedCanvases();
      if (loadedTask?.destroy) {
        loadedTask.destroy().catch(() => {});
      }
    };
  }, [fileId, fileUrl]);

  const ensurePageBaseRendered = useCallback(
    async (pNum: number) => {
      if (!pdfDocProxy || pNum < 1 || pNum > totalPages) return;
      if (baseCanvasesRef.current.has(pNum)) {
        redrawPageCanvas(pNum);
        return;
      }
      if (renderingPagesRef.current.has(pNum)) return;

      renderingPagesRef.current.add(pNum);
      const gen = pdfLoadGenRef.current;
      try {
        const page = await pdfDocProxy.getPage(pNum);
        if (gen !== pdfLoadGenRef.current) return;

        const vp0 = page.getViewport({ scale: 1 });
        const scale = CANVAS_W / Math.max(1, vp0.width);
        const vp = page.getViewport({ scale });
        const h = Math.round(vp.height);

        if (pageHeightsRef.current[pNum] !== h) {
          pageHeightsRef.current[pNum] = h;
          setPageDimsVersion((v) => v + 1);
        }

        const off = document.createElement("canvas");
        off.width = CANVAS_W;
        off.height = h;
        await page.render({ canvas: off, viewport: vp, background: "#ffffff" }).promise;
        if (gen !== pdfLoadGenRef.current) {
          off.width = 0;
          off.height = 0;
          return;
        }

        // จำกัดแคชหน้า PDF ล่าสุดไว้ไม่เกิน 12 หน้า เพื่อป้องกันหน่วยความจำเต็มบน iPad เมื่อเปิดแผนหลายสิบหน้า
        baseCanvasesRef.current.set(pNum, off);
        while (baseCanvasesRef.current.size > 12) {
          const oldestKey = baseCanvasesRef.current.keys().next().value;
          if (oldestKey === undefined) break;
          const oldestCanvas = baseCanvasesRef.current.get(oldestKey);
          baseCanvasesRef.current.delete(oldestKey);
          if (oldestCanvas) {
            oldestCanvas.width = 0;
            oldestCanvas.height = 0;
          }
        }

        redrawPageCanvas(pNum);
      } catch (err) {
        console.warn(`Render PDF page ${pNum} error:`, err);
      } finally {
        renderingPagesRef.current.delete(pNum);
      }
    },
    [pdfDocProxy, redrawPageCanvas, totalPages]
  );

  useEffect(() => {
    if (!pdfDocProxy || loadingPdf) return;
    let cancelled = false;

    const targetPages: number[] =
      viewMode === "single"
        ? [pageNumber]
        : [
            pageNumber,
            pageNumber + 1,
            pageNumber - 1,
            pageNumber + 2,
            pageNumber - 2,
            pageNumber + 3,
            pageNumber - 3,
          ].filter((p) => p >= 1 && p <= totalPages);

    async function renderWindow() {
      for (const p of targetPages) {
        if (cancelled) return;
        await ensurePageBaseRendered(p);
      }
    }

    renderWindow();
    return () => {
      cancelled = true;
    };
  }, [pdfDocProxy, pageNumber, viewMode, totalPages, loadingPdf, ensurePageBaseRendered]);

  useEffect(() => {
    redrawAllVisibleCanvases();
  }, [
    layout,
    strokesByPage,
    sigPageNumber,
    signDateIso,
    toolMode,
    viewMode,
    pageDimsVersion,
    redrawAllVisibleCanvases,
  ]);

  const scrollSlotIntoView = useCallback((targetPage: number) => {
    const container = scrollContainerRef.current;
    const slot = pageSlotRefs.current[targetPage];
    if (!container || !slot) return;
    const containerRect = container.getBoundingClientRect();
    const slotRect = slot.getBoundingClientRect();
    container.scrollTop += slotRect.top - containerRect.top - 8;
  }, []);

  const goToPage = useCallback(
    (rawTarget: number) => {
      if (loadingPdf) return;
      const numeric = Number(rawTarget);
      const clamped = Math.max(
        1,
        Math.min(totalPages, Number.isFinite(numeric) ? Math.round(numeric) : 1)
      );
      programmaticJumpUntilRef.current = Date.now() + 450;
      setPageNumber(clamped);
      pageNumberRef.current = clamped;
      setPageInput(String(clamped));
      if (viewMode === "continuous") {
        requestAnimationFrame(() => scrollSlotIntoView(clamped));
      } else if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    },
    [loadingPdf, scrollSlotIntoView, totalPages, viewMode]
  );

  const commitPageInput = useCallback(() => {
    const parsed = parseInt(pageInput, 10);
    if (Number.isNaN(parsed)) {
      setPageInput(String(pageNumberRef.current));
      return;
    }
    goToPage(parsed);
  }, [goToPage, pageInput]);

  const handleContainerScroll = useCallback(() => {
    if (viewMode !== "continuous" || loadingPdf || totalPages <= 1) return;
    if (Date.now() < programmaticJumpUntilRef.current) return;
    if (scrollRafRef.current !== null) return;

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = scrollContainerRef.current;
      if (!container) return;

      let detectedPage = pageNumberRef.current;
      if (container.scrollTop <= 12) {
        detectedPage = 1;
      } else if (
        container.scrollTop + container.clientHeight >= container.scrollHeight - 12 &&
        container.scrollTop > 20
      ) {
        detectedPage = totalPages;
      } else {
        const containerRect = container.getBoundingClientRect();
        const focusY = containerRect.top + containerRect.height * 0.35;
        let bestDist = Infinity;

        for (let p = 1; p <= totalPages; p++) {
          const el = pageSlotRefs.current[p];
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.top <= focusY && r.bottom >= focusY) {
            detectedPage = p;
            bestDist = 0;
            break;
          }
          const dist = focusY < r.top ? r.top - focusY : focusY - r.bottom;
          if (dist < bestDist) {
            bestDist = dist;
            detectedPage = p;
          }
        }
      }

      if (detectedPage !== pageNumberRef.current) {
        setPageNumber(detectedPage);
        pageNumberRef.current = detectedPage;
        if (!isEditingPageInputRef.current) {
          setPageInput(String(detectedPage));
        }
      }
    });
  }, [loadingPdf, totalPages, viewMode]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (viewMode !== "continuous") return;
    const target = pendingScrollPageRef.current;
    if (!target) return;
    pendingScrollPageRef.current = null;
    programmaticJumpUntilRef.current = Date.now() + 450;
    requestAnimationFrame(() => scrollSlotIntoView(target));
  }, [zoomPercent, viewMode, isFullscreenWorkspace, sidebarCollapsed, scrollSlotIntoView]);

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
        const h = getPageHeightPx(pNum);
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
  }, [drawPageOverlay, getPageHeightPx, onBindExporter, sigPageNumber]);

  const saveLayoutToStorage = (next: SigLayoutState) => {
    try {
      localStorage.setItem(STORAGE_SIG_LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const clientCoordsToMm = (
    clientX: number,
    clientY: number,
    targetPage: number
  ): [number, number] => {
    const cv = canvasRefs.current[targetPage];
    if (!cv) return [0, 0];
    const rect = cv.getBoundingClientRect();
    const pageH = getPageHeightPx(targetPage);
    const xMm = ((clientX - rect.left) / Math.max(1, rect.width)) * 210;
    const yMm = ((clientY - rect.top) / Math.max(1, rect.height)) * (pageH / MM_TO_PX);
    return [xMm, yMm];
  };

  const strokeHistoryRef = useRef<{
    past: StrokeHistoryEntry[];
    future: StrokeHistoryEntry[];
  }>({ past: [], future: [] });

  const commitHistoryEntry = useCallback((entry: StrokeHistoryEntry) => {
    const nextHistory = {
      past: [...strokeHistoryRef.current.past.slice(-59), entry],
      future: [],
    };
    strokeHistoryRef.current = nextHistory;
    setStrokeHistory(nextHistory);
  }, []);

  const eraseStrokesAtPoint = (xMm: number, yMm: number, targetPage: number) => {
    const curList = strokesByPageRef.current[targetPage] || [];
    if (curList.length === 0) return;
    const remaining = curList.filter(
      (stroke) => !isPointNearStroke(xMm, yMm, stroke, eraserRadiusMm)
    );
    if (remaining.length !== curList.length) {
      const nextMap = { ...strokesByPageRef.current, [targetPage]: remaining };
      strokesByPageRef.current = nextMap;
      setStrokesByPage(nextMap);
      if (eraseSessionRef.current) {
        eraseSessionRef.current.changed = true;
      }
      redrawPageCanvas(targetPage);
    }
  };

  const handlePointerDown = (
    e: React.PointerEvent<HTMLCanvasElement>,
    targetPage: number
  ) => {
    const isStylus = e.pointerType === "pen";
    const isFingerTouch = e.pointerType === "touch";
    const isDrawOrEraseTool =
      toolMode === "pen" || toolMode === "highlighter" || toolMode === "eraser";

    // กรณีอยู่ในโหมดเลื่อนกระดาษ (pan) หรือเปิดโหมด iPad (ใช้นิ้วเลื่อน / ใช้ปากกาเขียน) แล้วแตะด้วยนิ้ว
    if (toolMode === "pan" || (isDrawOrEraseTool && ipadPencilOnly && isFingerTouch)) {
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

    const [x, y] = clientCoordsToMm(e.clientX, e.clientY, targetPage);

    // โหมดยางลบ (ลบทั้งลายเส้นเมื่อแตะหรือลากผ่าน)
    if (toolMode === "eraser") {
      setToolbarCollapseSignal((n) => n + 1);
      e.currentTarget.setPointerCapture(e.pointerId);
      eraseSessionRef.current = {
        page: targetPage,
        initialStrokes: [...(strokesByPageRef.current[targetPage] || [])],
        changed: false,
      };
      eraseStrokesAtPoint(x, y, targetPage);
      return;
    }

    // โหมดปากกา / ไฮไลต์ (หรือแตะด้วย Apple Pencil แล้วเปลี่ยนเป็นเขียนอัตโนมัติ)
    if (toolMode === "pen" || toolMode === "highlighter" || isStylus) {
      setToolbarCollapseSignal((n) => n + 1);
      const activeTool: "pen" | "highlighter" =
        toolMode === "highlighter" ? "highlighter" : "pen";
      if (isStylus && toolMode !== "pen" && toolMode !== "highlighter") {
        setToolMode("pen");
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      activeStrokePageRef.current = targetPage;
      const now = performance.now();
      const p =
        activeTool === "highlighter"
          ? 1
          : computePointPressure(e.pointerType, e.pressure, undefined, x, y, now);
      activeStrokeRef.current = {
        color: activeTool === "highlighter" ? highlighterColor : penColor,
        baseWidthMm: activeTool === "highlighter" ? highlighterWidthMm : penBaseWidthMm,
        points: [{ xMm: x, yMm: y, p, t: now }],
        tool: activeTool,
        opacity: activeTool === "highlighter" ? 0.34 : undefined,
      };
      redrawPageCanvas(targetPage);
      return;
    }

    const cur = layoutRef.current;
    const inSigBox =
      cur.showSignatureOnDoc &&
      targetPage === sigPageNumber &&
      x >= cur.x - 6 &&
      x <= cur.x + cur.w + 6 &&
      y >= cur.y - 6 &&
      y <= cur.y + cur.h + 6;

    if (inSigBox) {
      dragSigRef.current = { page: targetPage, dx: x - cur.x, dy: y - cur.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // นอกกรอบลายเซ็น: ให้ลาก/แตะเลื่อนกระดาษได้โดยไม่เผลอย้ายลายเซ็นข้ามหน้าโดยไม่ตั้งใจ
    const container = scrollContainerRef.current;
    if (!container) return;
    panStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
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

    if (eraseSessionRef.current) {
      const targetPage = eraseSessionRef.current.page;
      const coalesced: PointerEvent[] =
        typeof (e.nativeEvent as any).getCoalescedEvents === "function"
          ? (e.nativeEvent as any).getCoalescedEvents()
          : [e.nativeEvent];
      for (const ev of coalesced) {
        const [cx, cy] = clientCoordsToMm(ev.clientX, ev.clientY, targetPage);
        eraseStrokesAtPoint(cx, cy, targetPage);
      }
      return;
    }

    if (activeStrokeRef.current) {
      const targetPage = activeStrokePageRef.current;
      const stroke = activeStrokeRef.current;
      const coalesced: PointerEvent[] =
        typeof (e.nativeEvent as any).getCoalescedEvents === "function"
          ? (e.nativeEvent as any).getCoalescedEvents()
          : [e.nativeEvent];

      for (const ev of coalesced) {
        const [cx, cy] = clientCoordsToMm(ev.clientX, ev.clientY, targetPage);
        const lastPt = stroke.points[stroke.points.length - 1];
        if (lastPt && Math.hypot(cx - lastPt.xMm, cy - lastPt.yMm) < 0.08) {
          continue;
        }
        const now = performance.now();
        const p =
          stroke.tool === "highlighter"
            ? 1
            : computePointPressure(
                ev.pointerType || e.pointerType,
                ev.pressure ?? e.pressure,
                lastPt,
                cx,
                cy,
                now
              );
        stroke.points.push({ xMm: cx, yMm: cy, p, t: now });
      }

      redrawPageCanvas(targetPage);
      return;
    }

    if (!dragSigRef.current) return;
    const { page: sigTargetPage, dx, dy } = dragSigRef.current;
    const [x, y] = clientCoordsToMm(e.clientX, e.clientY, sigTargetPage);
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

    if (eraseSessionRef.current) {
      const sess = eraseSessionRef.current;
      eraseSessionRef.current = null;
      if (sess.changed) {
        const afterList = strokesByPageRef.current[sess.page] || [];
        commitHistoryEntry({
          page: sess.page,
          prev: sess.initialStrokes,
          next: afterList,
        });
      }
      return;
    }

    if (activeStrokeRef.current) {
      const finished = activeStrokeRef.current;
      const targetPage = activeStrokePageRef.current;
      activeStrokeRef.current = null;
      const prevList = strokesByPageRef.current[targetPage] || [];
      const nextList = [...prevList, finished];
      const nextMap = { ...strokesByPageRef.current, [targetPage]: nextList };
      strokesByPageRef.current = nextMap;
      setStrokesByPage(nextMap);
      commitHistoryEntry({ page: targetPage, prev: prevList, next: nextList });
      redrawPageCanvas(targetPage);

      if (targetPage !== pageNumberRef.current) {
        setPageNumber(targetPage);
        pageNumberRef.current = targetPage;
        if (!isEditingPageInputRef.current) {
          setPageInput(String(targetPage));
        }
      }
      return;
    }

    if (dragSigRef.current) {
      dragSigRef.current = null;
      saveLayoutToStorage(layoutRef.current);
    }
  };

  const handleUndoStroke = () => {
    const past = strokeHistoryRef.current.past;
    if (past.length === 0) return;
    const entry = past[past.length - 1];
    const nextHistory = {
      past: past.slice(0, -1),
      future: [entry, ...strokeHistoryRef.current.future.slice(0, 59)],
    };
    strokeHistoryRef.current = nextHistory;
    setStrokeHistory(nextHistory);

    const nextMap = { ...strokesByPageRef.current, [entry.page]: entry.prev };
    strokesByPageRef.current = nextMap;
    setStrokesByPage(nextMap);
    redrawPageCanvas(entry.page);
    if (entry.page !== pageNumberRef.current) {
      goToPage(entry.page);
    }
  };

  const handleRedoStroke = () => {
    const future = strokeHistoryRef.current.future;
    if (future.length === 0) return;
    const entry = future[0];
    const nextHistory = {
      past: [...strokeHistoryRef.current.past.slice(-59), entry],
      future: future.slice(1),
    };
    strokeHistoryRef.current = nextHistory;
    setStrokeHistory(nextHistory);

    const nextMap = { ...strokesByPageRef.current, [entry.page]: entry.next };
    strokesByPageRef.current = nextMap;
    setStrokesByPage(nextMap);
    redrawPageCanvas(entry.page);
    if (entry.page !== pageNumberRef.current) {
      goToPage(entry.page);
    }
  };

  const handleClearPageStrokes = () => {
    const curList = strokesByPageRef.current[pageNumber] || [];
    if (curList.length === 0) return;
    const nextMap = { ...strokesByPageRef.current, [pageNumber]: [] };
    strokesByPageRef.current = nextMap;
    setStrokesByPage(nextMap);
    commitHistoryEntry({ page: pageNumber, prev: curList, next: [] });
    redrawPageCanvas(pageNumber);
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
  const canUndo = strokeHistory.past.length > 0;
  const canRedo = strokeHistory.future.length > 0;
  const baseDisplayWidth = isFullscreenWorkspace
    ? 980
    : sidebarCollapsed
    ? 920
    : 820;
  const zoomedWidthPx = Math.round((baseDisplayWidth * zoomPercent) / 100);

  const toggleSidebarCollapsed = () => {
    pendingScrollPageRef.current = pageNumberRef.current;
    setSidebarCollapsed((v) => !v);
  };

  const changeZoom = (computeNext: (cur: number) => number) => {
    pendingScrollPageRef.current = pageNumberRef.current;
    setZoomPercent((cur) => Math.max(100, Math.min(325, computeNext(cur))));
  };

  const switchViewMode = (nextMode: "continuous" | "single") => {
    if (nextMode === viewMode) return;
    pendingScrollPageRef.current = pageNumberRef.current;
    setViewMode(nextMode);
  };

  const toggleFullscreen = () => {
    pendingScrollPageRef.current = pageNumberRef.current;
    setIsFullscreenWorkspace((v) => !v);
  };

  const pageListToRender =
    viewMode === "single"
      ? [pageNumber]
      : Array.from({ length: totalPages }, (_, idx) => idx + 1);

  const renderPageSlot = (pNum: number) => {
    const pageH = getPageHeightPx(pNum);
    const shouldMountCanvas =
      viewMode === "single"
        ? pNum === pageNumber
        : Math.abs(pNum - pageNumber) <= 3;

    return (
      <div
        key={pNum}
        ref={(el) => {
          pageSlotRefs.current[pNum] = el;
        }}
        data-page-number={pNum}
        className="flex flex-col items-center max-w-full"
        style={{
          width: `${zoomedWidthPx}px`,
          maxWidth: zoomPercent === 100 ? "100%" : "none",
        }}
      >
        {viewMode === "continuous" && totalPages > 1 && (
          <div className="w-full flex items-center justify-between px-1.5 pb-1 text-[11px] font-semibold text-slate-600">
            <span>
              หน้า {pNum} / {totalPages}
            </span>
            {layout.showSignatureOnDoc && pNum === sigPageNumber && (
              <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                หน้าลายเซ็น ผอ.
              </span>
            )}
          </div>
        )}

        <div
          className="w-full bg-white shadow-lg rounded-lg border border-slate-300 overflow-hidden"
          style={{ aspectRatio: `${CANVAS_W} / ${pageH}` }}
        >
          {shouldMountCanvas ? (
            <canvas
              ref={(el) => {
                canvasRefs.current[pNum] = el;
              }}
              width={CANVAS_W}
              height={pageH}
              onPointerDown={(e) => handlePointerDown(e, pNum)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className={`w-full h-full block touch-none select-none ${
                toolMode === "pen" || toolMode === "highlighter" || toolMode === "eraser"
                  ? "cursor-crosshair"
                  : "cursor-grab active:cursor-grabbing"
              }`}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-white/95 text-slate-400 text-xs font-medium select-none">
              หน้า {pNum} / {totalPages}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className={
        isFullscreenWorkspace
          ? "fixed inset-2 z-[55] bg-slate-100 rounded-3xl p-2.5 sm:p-3.5 shadow-2xl border border-slate-300 grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch overflow-y-auto lg:overflow-hidden"
          : "grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch lg:flex-1 lg:min-h-0"
      }
    >
      {/* ฝั่งซ้าย: แถบตั้งค่าลายเซ็น & หมายเหตุ (พับเก็บได้เพื่อขยายจอ PDF ให้ใหญ่เต็มตา) */}
      {!sidebarCollapsed && (
        <div className="lg:col-span-4 xl:col-span-3 space-y-2.5 bg-slate-50/90 p-2.5 sm:p-3 rounded-2xl border border-slate-200 lg:h-full lg:overflow-y-auto">
          {/* สลับโหมดด่วนบนหน้ากระดาษ + ลิงก์เครื่องมือลอย */}
          <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700">โหมดบนหน้ากระดาษ</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!canUndo}
                  onClick={handleUndoStroke}
                  title="ย้อนกลับ (Undo)"
                  className="p-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 disabled:opacity-35"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={!canRedo}
                  onClick={handleRedoStroke}
                  title="ทำซ้ำ (Redo)"
                  className="p-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 disabled:opacity-35"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => setToolMode("move-sig")}
                className={`py-1.5 px-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 border transition-all ${
                  toolMode === "move-sig"
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <Move className="w-3 h-3 shrink-0" />
                <span>ลายเซ็น</span>
              </button>
              <button
                type="button"
                onClick={() => setToolMode("pen")}
                className={`py-1.5 px-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 border transition-all ${
                  toolMode === "pen"
                    ? "bg-rose-600 text-white border-rose-600 shadow-xs"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <PenLine className="w-3 h-3 shrink-0" />
                <span>ปากกา</span>
              </button>
              <button
                type="button"
                onClick={() => setToolMode("highlighter")}
                className={`py-1.5 px-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 border transition-all ${
                  toolMode === "highlighter"
                    ? "bg-amber-500 text-slate-950 border-amber-500 shadow-xs"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <Highlighter className="w-3 h-3 shrink-0" />
                <span>ไฮไลต์</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setToolMode("eraser")}
                className={`py-1.5 px-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 border transition-all ${
                  toolMode === "eraser"
                    ? "bg-rose-500 text-white border-rose-500 shadow-xs"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <Eraser className="w-3 h-3 shrink-0" />
                <span>ยางลบ</span>
              </button>
              <button
                type="button"
                onClick={() => setToolMode("pan")}
                className={`py-1.5 px-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 border transition-all ${
                  toolMode === "pan"
                    ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <Hand className="w-3 h-3 shrink-0" />
                <span>เลื่อนหน้า</span>
              </button>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-500 bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-100">
              💡 แตะปุ่มวงกลมลอยมุมขวาของหน้า PDF เพื่อกางเครื่องมือปากกา ไฮไลต์ ยางลบ สี ขนาด และ Undo/Redo แบบ iPad (ลากย้ายได้)
            </p>
          </div>

        {/* ลายเซ็น ผอ. */}
        <div className="p-3 rounded-xl bg-white border border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
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
            <label className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-bold cursor-pointer">
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
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-pink-50 hover:bg-pink-100 text-pink-800 border border-pink-200 text-xs font-bold"
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
            className="w-full p-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        </div>
      )}

      {/* ฝั่งขวา: ตัวอย่างหน้ากระดาษ PDF ขนาดใหญ่เต็มตา พร้อม Floating Radial Toolbar สไตล์ iPad */}
      <div
        className={`${
          sidebarCollapsed ? "lg:col-span-12" : "lg:col-span-8 xl:col-span-9"
        } flex flex-col items-center space-y-2 bg-slate-200/80 p-2 sm:p-2.5 rounded-2xl border border-slate-300 lg:h-full lg:min-h-0`}
      >
        {/* แถบเครื่องมือด้านบน: ซ่อน/แสดงแถบซ้าย + พิมพ์เลขหน้า + โหมดอ่านต่อเนื่อง/ทีละหน้า + ซูม */}
        <div className="shrink-0 w-full bg-white px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl shadow-xs space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* ควบคุมหน้าและพิมพ์เลขหน้ากระโดดทันที */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                title={
                  sidebarCollapsed
                    ? "แสดงแถบลายเซ็นและหมายเหตุ"
                    : "ซ่อนแถบซ้ายเพื่อดูหน้ากระดาษ PDF ใหญ่ขึ้น"
                }
                className={`hidden lg:inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[11px] font-bold mr-1 transition-colors ${
                  sidebarCollapsed
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                {sidebarCollapsed ? (
                  <>
                    <PanelLeftOpen className="w-3.5 h-3.5" />
                    <span>แสดงแถบซ้าย</span>
                  </>
                ) : (
                  <>
                    <PanelLeftClose className="w-3.5 h-3.5" />
                    <span>ขยายจอ PDF</span>
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={pageNumber <= 1 || loadingPdf}
                onClick={() => goToPage(1)}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
                title="หน้าแรก (1)"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={pageNumber <= 1 || loadingPdf}
                onClick={() => goToPage(pageNumber - 1)}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
                title="หน้าก่อนหน้า"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  isEditingPageInputRef.current = false;
                  commitPageInput();
                  (document.activeElement as HTMLElement | null)?.blur?.();
                }}
                className="flex items-center gap-1 text-xs font-bold text-slate-700 px-1"
              >
                <span>หน้า</span>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="พิมพ์เลขหน้าเพื่อไปยังหน้านั้น"
                  value={pageInput}
                  onFocus={(e) => {
                    isEditingPageInputRef.current = true;
                    e.currentTarget.select();
                  }}
                  onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ""))}
                  onBlur={() => {
                    isEditingPageInputRef.current = false;
                    commitPageInput();
                  }}
                  disabled={loadingPdf || totalPages <= 1}
                  title="พิมพ์เลขหน้าแล้วกด Enter เพื่อข้ามไปหน้านั้นทันที"
                  className="w-11 px-1 py-0.5 text-center rounded-md border border-indigo-200 bg-indigo-50/40 text-indigo-700 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100 disabled:border-slate-200 disabled:text-slate-500"
                />
                <span className="text-slate-500">/ {totalPages}</span>
              </form>

              <button
                type="button"
                disabled={pageNumber >= totalPages || loadingPdf}
                onClick={() => goToPage(pageNumber + 1)}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
                title="หน้าถัดไป"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={pageNumber >= totalPages || loadingPdf}
                onClick={() => goToPage(totalPages)}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
                title={`หน้าสุดท้าย (${totalPages})`}
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* สลับมุมมอง + ปุ่มซูม - / + */}
            <div className="flex flex-wrap items-center gap-1">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 mr-1">
                <button
                  type="button"
                  onClick={() => switchViewMode("continuous")}
                  className={`px-2 py-1 rounded-md text-[11px] font-bold inline-flex items-center gap-1 transition-colors ${
                    viewMode === "continuous"
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                  title="เลื่อนลูกกลิ้งเมาส์หรือปัดนิ้วอ่านต่อเนื่องทุกหน้า"
                >
                  <ScrollText className="w-3 h-3" />
                  <span>ต่อเนื่อง</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchViewMode("single")}
                  className={`px-2 py-1 rounded-md text-[11px] font-bold inline-flex items-center gap-1 transition-colors ${
                    viewMode === "single"
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                  title="แสดงทีละ 1 หน้า (เหมาะสำหรับซูมเขียนเฉพาะหน้า)"
                >
                  <FileText className="w-3 h-3" />
                  <span>ทีละหน้า</span>
                </button>
              </div>

              <button
                type="button"
                disabled={zoomPercent <= 100}
                onClick={() => changeZoom((z) => z - 25)}
                className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 disabled:opacity-40"
                title="ซูมออก (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              {[100, 150, 200, 250].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => changeZoom(() => preset)}
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
                onClick={() => changeZoom((z) => z + 25)}
                className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 disabled:opacity-40"
                title="ซูมเข้า (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className={`ml-0.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border inline-flex items-center gap-1 ${
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

          {/* แถบเลื่อนข้ามหน้าด่วน & ปุ่มกระโดดไปหน้าลายเซ็น */}
          {(totalPages > 1 || (layout.showSignatureOnDoc && pageNumber !== sigPageNumber)) && (
            <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-slate-100">
              {totalPages > 1 && (
                <div className="flex-1 min-w-[160px] flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-slate-400">1</span>
                  <input
                    type="range"
                    min={1}
                    max={totalPages}
                    value={pageNumber}
                    disabled={loadingPdf}
                    onChange={(e) => goToPage(Number(e.target.value))}
                    aria-label="เลื่อนเลือกหน้าเอกสาร"
                    className="w-full h-1.5 accent-indigo-600 cursor-pointer"
                  />
                  <span className="text-[10px] font-semibold text-slate-400">{totalPages}</span>
                </div>
              )}

              {layout.showSignatureOnDoc && pageNumber !== sigPageNumber && (
                <button
                  type="button"
                  onClick={() => goToPage(sigPageNumber)}
                  className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <LocateFixed className="w-3 h-3" />
                  <span>ไปหน้าลายเซ็น (หน้า {sigPageNumber})</span>
                </button>
              )}
            </div>
          )}
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

        {!loadingPdf && !pdfError && pdfDocProxy && (
          <div
            ref={pdfWorkspaceBoxRef}
            className={`relative w-full flex flex-col min-h-0 ${
              isFullscreenWorkspace
                ? "flex-1"
                : "h-[68vh] lg:h-auto lg:flex-1 lg:min-h-[340px]"
            }`}
          >
            <div
              ref={scrollContainerRef}
              onScroll={handleContainerScroll}
              className="w-full h-full overflow-auto rounded-xl border border-slate-300 bg-slate-300/60 p-2 sm:p-3"
            >
              <div className="min-w-full w-fit mx-auto flex flex-col items-center gap-3">
                {pageListToRender.map((pNum) => renderPageSlot(pNum))}
              </div>
            </div>

            <FloatingRadialToolbar
              containerRef={pdfWorkspaceBoxRef}
              toolMode={toolMode}
              onToolModeChange={setToolMode}
              penColor={penColor}
              onPenColorChange={setPenColor}
              penWidthMm={penBaseWidthMm}
              onPenWidthChange={setPenBaseWidthMm}
              highlighterColor={highlighterColor}
              onHighlighterColorChange={setHighlighterColor}
              highlighterWidthMm={highlighterWidthMm}
              onHighlighterWidthChange={setHighlighterWidthMm}
              eraserRadiusMm={eraserRadiusMm}
              onEraserRadiusChange={setEraserRadiusMm}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={handleUndoStroke}
              onRedo={handleRedoStroke}
              currentPageStrokeCount={currentPageStrokeCount}
              onClearPageStrokes={handleClearPageStrokes}
              ipadPencilOnly={ipadPencilOnly}
              onIpadPencilOnlyChange={setIpadPencilOnly}
              collapseSignal={toolbarCollapseSignal}
            />
          </div>
        )}
      </div>

      {/* Modal สำหรับวาดลายเซ็น ผอ. (รองรับน้ำหนักกดปากกา iPad เช่นกัน) */}
      {showDrawModal && (
        <div className="fixed inset-0 !mt-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
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
