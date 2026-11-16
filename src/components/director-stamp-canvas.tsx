"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  FileDown,
  ImageUp,
  Loader2,
  Move,
  PenTool,
  RotateCcw,
  Sparkles,
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
const STORAGE_LAYOUT_KEY = "pongrad_director_layout_v2";

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

export const COMMENT_PRESETS: { label: string; text: string; choice: "allow" | "disallow" }[] = [
  {
    label: "อนุญาต (มาตรฐานตามตัวอย่าง)",
    choice: "allow",
    text: "แผนการจัดการเรียนรู้นี้ได้กำหนดวัตถุประสงค์การเรียนรู้ กิจกรรมการเรียนการสอน วัดผลประเมินผลสอดคล้องกัน เลือกใช้สื่อได้เหมาะสม ใช้สอนได้",
  },
  {
    label: "อนุญาต (ระดับปฐมวัย)",
    choice: "allow",
    text: "แผนการจัดประสบการณ์เรียนรู้มีความครบถ้วนสมบูรณ์ กิจกรรมเหมาะสมกับพัฒนาการของผู้เรียน อนุญาตให้นำไปใช้จัดกิจกรรมได้",
  },
  {
    label: "รับทราบบันทึกหลังสอน",
    choice: "allow",
    text: "ได้ตรวจบันทึกหลังการจัดการเรียนรู้แล้ว รับทราบผลการจัดการเรียนรู้และการนำสื่อมาพัฒนาผู้เรียนได้อย่างเหมาะสม",
  },
  {
    label: "ให้ปรับปรุงแก้ไข",
    choice: "disallow",
    text: "เห็นควรปรับปรุงแก้ไขรายละเอียดของแผนการจัดการเรียนรู้ตามข้อเสนอแนะก่อนนำไปใช้สอน",
  },
];

interface BoxPos {
  x: number; // mm (0..210)
  y: number; // mm (0..297)
  w: number; // mm
  h: number; // mm
}

interface StampLayoutState {
  tick: BoxPos;
  comment: BoxPos;
  sig: BoxPos;
  tickStyle: "tick-only" | "full-box";
  indentFirstLine: boolean;
  fontSizeMm: number;
  lineGapMm: number;
  sigWidthMm: number;
  showSignerCaption: boolean;
  useThaiNumeralDate: boolean;
}

const DEFAULT_LAYOUT: StampLayoutState = {
  // พิกัดเริ่มต้นตรงตามหน้าแรก "บันทึกข้อความ ขออนุญาตใช้แผนการจัดการเรียนรู้"
  tick: { x: 29.5, y: 187.5, w: 12, h: 10 },
  comment: { x: 29.5, y: 208.5, w: 152, h: 18 },
  sig: { x: 102, y: 223.5, w: 38, h: 16 },
  tickStyle: "tick-only",
  indentFirstLine: true,
  fontSizeMm: 4.1,
  lineGapMm: 7.8,
  sigWidthMm: 36,
  showSignerCaption: false,
  useThaiNumeralDate: true,
};

function wrapThaiLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
  firstLineIndentPx: number
): { line: string; indentPx: number }[] {
  const out: { line: string; indentPx: number }[] = [];
  const paragraphs = (text || "").split("\n");
  let isFirstOverall = true;

  for (const para of paragraphs) {
    let current = "";
    let currentIndent = isFirstOverall ? firstLineIndentPx : 0;
    let limit = Math.max(40, maxWidthPx - currentIndent);

    for (const ch of para) {
      if (ctx.measureText(current + ch).width > limit && current) {
        out.push({ line: current, indentPx: currentIndent });
        current = ch;
        isFirstOverall = false;
        currentIndent = 0;
        limit = Math.max(40, maxWidthPx);
      } else {
        current += ch;
      }
    }
    if (current || para === "") {
      out.push({ line: current, indentPx: currentIndent });
      isFirstOverall = false;
    }
  }
  return out;
}

/**
 * แปลงรูปลายเซ็นที่ถ่ายจากกระดาษขาว (JPG/PNG) ให้พื้นหลังขาวกลายเป็นโปร่งใส
 * และปรับเส้นปากกาให้เป็นสีน้ำเงินหมึกซึม (#1a2fa0)
 */
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
      // ย้อมเป็นสีน้ำเงินปากกาหมึกซึม (#1a2fa0 -> R:26, G:47, B:160)
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
  overlayPngDataUrl: string;
  pageNumber: number;
}

interface DirectorStampCanvasProps {
  fileId?: string | null;
  fileUrl?: string | null;
  signerName: string;
  signerTitle: string;
  commentText: string;
  onCommentChange: (val: string) => void;
  approvalChoice: "allow" | "disallow";
  onApprovalChoiceChange: (choice: "allow" | "disallow") => void;
  onBindExporter: (fn: (() => DirectorOverlayExport | null) | null) => void;
}

export function DirectorStampCanvas({
  fileId,
  fileUrl,
  signerName,
  signerTitle,
  commentText,
  onCommentChange,
  approvalChoice,
  onApprovalChoiceChange,
  onBindExporter,
}: DirectorStampCanvasProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawPadRef = useRef<HTMLCanvasElement | null>(null);
  const basePageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigImageRef = useRef<HTMLImageElement | null>(null);

  const [canvasHeight, setCanvasHeight] = useState(1754);
  const [pdfDocProxy, setPdfDocProxy] = useState<any>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [showDrawModal, setShowDrawModal] = useState(false);
  const isDrawingSigRef = useRef(false);

  const [signDateIso, setSignDateIso] = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });

  const [layout, setLayout] = useState<StampLayoutState>(DEFAULT_LAYOUT);
  const layoutRef = useRef<StampLayoutState>(DEFAULT_LAYOUT);
  const dragTargetRef = useRef<{
    key: "tick" | "comment" | "sig";
    dx: number;
    dy: number;
  } | null>(null);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // โหลดลายเซ็นและพิกัดที่เคยบันทึกไว้ในเครื่อง
  useEffect(() => {
    try {
      const savedSig = localStorage.getItem(STORAGE_SIG_KEY);
      if (savedSig) setSigDataUrl(savedSig);
      const savedLayout = localStorage.getItem(STORAGE_LAYOUT_KEY);
      if (savedLayout) {
        const parsed = JSON.parse(savedLayout);
        setLayout((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  // แปลง sigDataUrl เป็น HTMLImageElement สำหรับวาดบน Canvas
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

  // โหลดฟอนต์ Sarabun เพื่อให้ Canvas วาดภาษาไทยได้สวยงามตั้งแต่ครั้งแรก
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
        setPageNumber(1); // เริ่มที่หน้าแรก (บันทึกข้อความ) เสมอตามรูปแบบของโรงเรียน
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

  // เรนเดอร์หน้า PDF ที่เลือกเป็นพื้นหลัง
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

  const drawOverlayElements = useCallback(
    (ctx: CanvasRenderingContext2D, showGuides: boolean) => {
      const k = MM_TO_PX;
      const cur = layoutRef.current;

      ctx.save();
      ctx.fillStyle = BLUE_INK;
      ctx.strokeStyle = BLUE_INK;
      ctx.textBaseline = "top";

      // --- 1. วาดเครื่องหมายถูก ✓ (อนุญาต / ไม่อนุญาต) ---
      const tickX = cur.tick.x * k;
      const tickY =
        (cur.tick.y + (approvalChoice === "disallow" && cur.tickStyle === "tick-only" ? 8.2 : 0)) *
        k;

      if (cur.tickStyle === "tick-only") {
        const size = 5.4 * k;
        ctx.lineWidth = 3.6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(tickX + size * 0.1, tickY + size * 0.52);
        ctx.lineTo(tickX + size * 0.42, tickY + size * 0.86);
        ctx.lineTo(tickX + size * 1.15, tickY - size * 0.12);
        ctx.stroke();

        cur.tick.w = 8;
        cur.tick.h = 8;
        if (showGuides) {
          ctx.save();
          ctx.strokeStyle = "rgba(37, 99, 235, 0.45)";
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(tickX - 4, tickY - 4, size * 1.3 + 8, size + 8);
          ctx.restore();
        }
      } else {
        const pt = cur.fontSizeMm * k;
        ctx.font = `600 ${pt}px 'TH Sarabun New', Sarabun, sans-serif`;
        const opts = [
          { key: "allow", label: "อนุญาต" },
          { key: "disallow", label: "ไม่อนุญาต" },
        ];
        const boxS = pt * 0.78;
        const rowGap = pt * 1.45;
        opts.forEach((o, idx) => {
          const ry = cur.tick.y * k + idx * rowGap;
          ctx.lineWidth = 2;
          ctx.strokeRect(tickX, ry + 2, boxS, boxS);
          if (o.key === approvalChoice) {
            ctx.lineWidth = 3.2;
            ctx.beginPath();
            ctx.moveTo(tickX + boxS * 0.15, ry + 2 + boxS * 0.55);
            ctx.lineTo(tickX + boxS * 0.42, ry + 2 + boxS * 0.85);
            ctx.lineTo(tickX + boxS * 1.15, ry + 2 - boxS * 0.15);
            ctx.stroke();
          }
          ctx.fillText(o.label, tickX + boxS + 10, ry);
        });
        cur.tick.w = 34;
        cur.tick.h = (rowGap * 2) / k;
        if (showGuides) {
          ctx.save();
          ctx.strokeStyle = "rgba(37, 99, 235, 0.45)";
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(tickX - 4, cur.tick.y * k - 4, cur.tick.w * k, cur.tick.h * k + 6);
          ctx.restore();
        }
      }

      // --- 2. วาดข้อความความเห็นหลังคำว่า "เพราะ..." ---
      if (commentText.trim()) {
        const pt = cur.fontSizeMm * k;
        const lineGapPx = cur.lineGapMm * k;
        ctx.font = `600 ${pt}px 'TH Sarabun New', Sarabun, sans-serif`;
        ctx.textAlign = "left";

        const cx = cur.comment.x * k;
        const cy = cur.comment.y * k;
        const maxW = cur.comment.w * k;
        const firstIndent = cur.indentFirstLine ? 13 * k : 0;

        const wrapped = wrapThaiLines(ctx, commentText.trim(), maxW, firstIndent);
        wrapped.forEach((item, i) => {
          ctx.fillText(item.line, cx + item.indentPx, cy + i * lineGapPx);
        });

        cur.comment.h = Math.max(10, (wrapped.length * lineGapPx) / k + 2);

        if (showGuides) {
          ctx.save();
          ctx.strokeStyle = "rgba(37, 99, 235, 0.45)";
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(cx - 4, cy - 3, maxW + 8, cur.comment.h * k);
          ctx.restore();
        }
      }

      // --- 3. วาดลายเซ็น ผอ. (+ ชื่อ/ตำแหน่ง/วันที่ หากเปิดใช้งาน) ---
      const sx = cur.sig.x * k;
      const sy = cur.sig.y * k;
      const sw = cur.sigWidthMm * k;
      let currentY = sy;

      if (sigImageRef.current) {
        const img = sigImageRef.current;
        const sh = (img.height / Math.max(1, img.width)) * sw;
        ctx.drawImage(img, sx, currentY, sw, sh);
        currentY += sh + 2;
        cur.sig.w = cur.sigWidthMm;
        cur.sig.h = sh / k + (cur.showSignerCaption ? 18 : 2);
      } else {
        cur.sig.w = cur.sigWidthMm;
        cur.sig.h = cur.showSignerCaption ? 24 : 12;
      }

      if (cur.showSignerCaption) {
        const pt = cur.fontSizeMm * k;
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
        ctx.strokeStyle = "rgba(219, 39, 119, 0.55)";
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx - 4, sy - 4, cur.sig.w * k + 8, cur.sig.h * k + 8);
        if (!sigImageRef.current) {
          ctx.fillStyle = "rgba(219, 39, 119, 0.8)";
          ctx.font = `600 18px Sarabun, sans-serif`;
          ctx.fillText("ตำแหน่งวางลายเซ็น ผอ.", sx + 6, sy + 10);
        }
        ctx.restore();
      }

      ctx.restore();
    },
    [approvalChoice, commentText, signDateIso, signerName, signerTitle]
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

      drawOverlayElements(ctx, true);
    },
    [canvasHeight, drawOverlayElements]
  );

  useEffect(() => {
    renderPreview();
  }, [layout, approvalChoice, commentText, signDateIso, renderPreview]);

  // ผูกฟังก์ชันส่งออกเฉพาะเลเยอร์หมึกสีน้ำเงินพื้นหลังโปร่งใส (ไม่มีเส้นประ) ให้หน้าตรวจแผน
  useEffect(() => {
    const exporter = (): DirectorOverlayExport | null => {
      const off = document.createElement("canvas");
      off.width = CANVAS_W;
      off.height = canvasHeight;
      const ctx = off.getContext("2d");
      if (!ctx) return null;
      ctx.clearRect(0, 0, CANVAS_W, canvasHeight);
      drawOverlayElements(ctx, false);
      return {
        overlayPngDataUrl: off.toDataURL("image/png"),
        pageNumber,
      };
    };
    onBindExporter(exporter);
    return () => onBindExporter(null);
  }, [canvasHeight, drawOverlayElements, onBindExporter, pageNumber]);

  const saveLayoutToStorage = (next: StampLayoutState) => {
    try {
      localStorage.setItem(STORAGE_LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  // ระบบลากวาง (Pointer Drag & Drop) เหมือนใน HTML ต้นแบบ
  const pointerToMm = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const cv = previewCanvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const xMm = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 210;
    const yMm = ((e.clientY - rect.top) / Math.max(1, rect.height)) * (canvasHeight / MM_TO_PX);
    return [xMm, yMm];
  };

  const isHit = (box: BoxPos, x: number, y: number, extraY = 0) => {
    const by = box.y + extraY;
    return x >= box.x - 2 && x <= box.x + box.w + 2 && y >= by - 2 && y <= by + box.h + 2;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = pointerToMm(e);
    const cur = layoutRef.current;
    const tickExtraY =
      approvalChoice === "disallow" && cur.tickStyle === "tick-only" ? 8.2 : 0;

    let hitKey: "sig" | "comment" | "tick" | null = null;
    if (isHit(cur.sig, x, y)) hitKey = "sig";
    else if (isHit(cur.comment, x, y)) hitKey = "comment";
    else if (isHit(cur.tick, x, y, tickExtraY)) hitKey = "tick";

    if (hitKey) {
      dragTargetRef.current = {
        key: hitKey,
        dx: x - cur[hitKey].x,
        dy: y - cur[hitKey].y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragTargetRef.current) return;
    const [x, y] = pointerToMm(e);
    const { key, dx, dy } = dragTargetRef.current;
    const nextX = Math.max(2, Math.min(198, x - dx));
    const nextY = Math.max(2, Math.min(290, y - dy));

    setLayout((prev) => {
      const updated = {
        ...prev,
        [key]: {
          ...prev[key],
          x: nextX,
          y: nextY,
        },
      };
      layoutRef.current = updated;
      return updated;
    });
  };

  const handlePointerUp = () => {
    if (dragTargetRef.current) {
      dragTargetRef.current = null;
      saveLayoutToStorage(layoutRef.current);
    }
  };

  // อัปโหลดไฟล์รูปลายเซ็นจริง (PNG/JPG) แล้วตัดพื้นขาวเป็นใส + หมึกน้ำเงิน
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

  // วาดลายเซ็นสดบน Modal
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      {/* ฝั่งซ้าย: ตั้งค่ากล่องความเห็นผู้บริหารและลายเซ็น */}
      <div className="lg:col-span-5 space-y-3 bg-slate-50/90 p-4 rounded-2xl border border-slate-200">
        <div className="flex items-center justify-between">
          <h4 className="text-xs sm:text-sm font-bold text-indigo-900 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            กล่องความเห็นและลายเซ็น ผอ. (ลากวางบนกระดาษได้)
          </h4>
          <button
            type="button"
            onClick={() => {
              setLayout(DEFAULT_LAYOUT);
              saveLayoutToStorage(DEFAULT_LAYOUT);
            }}
            className="text-[11px] font-semibold text-slate-600 hover:text-indigo-700 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200"
            title="รีเซ็ตตำแหน่งกลับจุดมาตรฐาน"
          >
            <RotateCcw className="w-3 h-3" />
            รีเซ็ตตำแหน่ง
          </button>
        </div>

        {/* 1. เลือกผลการอนุญาต + รูปแบบเครื่องหมายถูก */}
        <div className="p-3 rounded-xl bg-white border border-slate-200/80 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700">1. เครื่องหมายพิจารณา (สีน้ำเงิน):</span>
            <select
              value={layout.tickStyle}
              onChange={(e) => {
                const next = {
                  ...layout,
                  tickStyle: e.target.value as "tick-only" | "full-box",
                };
                setLayout(next);
                saveLayoutToStorage(next);
              }}
              className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-700 bg-slate-50"
            >
              <option value="tick-only">เฉพาะเครื่องหมาย ✓ (วางทับช่องของครู)</option>
              <option value="full-box">วาดทั้งกล่อง ☑ อนุญาต / ☐ ไม่อนุญาต</option>
            </select>
          </div>

          <div className="flex items-center gap-4 pt-1">
            <label className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 cursor-pointer">
              <input
                type="radio"
                checked={approvalChoice === "allow"}
                onChange={() => onApprovalChoiceChange("allow")}
                className="accent-indigo-700"
              />
              <span>☑ อนุญาต</span>
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-700 cursor-pointer">
              <input
                type="radio"
                checked={approvalChoice === "disallow"}
                onChange={() => onApprovalChoiceChange("disallow")}
                className="accent-rose-600"
              />
              <span>☑ ไม่อนุญาต (ให้แก้ไข)</span>
            </label>
          </div>
        </div>

        {/* 2. ข้อความความเห็นหลังคำว่า "เพราะ..." */}
        <div className="p-3 rounded-xl bg-white border border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700">
              2. ข้อความความเห็น ผอ. (ตรงบรรทัด &quot;เพราะ...&quot;)
            </label>
            <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={layout.indentFirstLine}
                onChange={(e) => {
                  const next = { ...layout, indentFirstLine: e.target.checked };
                  setLayout(next);
                  saveLayoutToStorage(next);
                }}
                className="accent-indigo-700"
              />
              <span>ย่อหน้าบรรทัดแรกหลบคำว่า &quot;เพราะ&quot;</span>
            </label>
          </div>

          {/* ปุ่มข้อความสำเร็จรูป */}
          <div className="flex flex-wrap gap-1">
            {COMMENT_PRESETS.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  onCommentChange(p.text);
                  onApprovalChoiceChange(p.choice);
                }}
                className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-200/80 transition-colors"
              >
                + {p.label}
              </button>
            ))}
          </div>

          <textarea
            value={commentText}
            onChange={(e) => onCommentChange(e.target.value)}
            rows={3}
            placeholder="พิมพ์ความเห็นของผู้บริหารที่จะแสดงบนเส้นประ..."
            className="w-full p-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />

          <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
            <div>
              <label className="block text-slate-500 mb-0.5">ขนาดอักษร</label>
              <input
                type="range"
                min={3.2}
                max={5.5}
                step={0.1}
                value={layout.fontSizeMm}
                onChange={(e) => {
                  const next = { ...layout, fontSizeMm: Number(e.target.value) };
                  setLayout(next);
                  saveLayoutToStorage(next);
                }}
                className="w-full accent-indigo-600"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-0.5">ระยะบรรทัด</label>
              <input
                type="range"
                min={5.5}
                max={12}
                step={0.2}
                value={layout.lineGapMm}
                onChange={(e) => {
                  const next = { ...layout, lineGapMm: Number(e.target.value) };
                  setLayout(next);
                  saveLayoutToStorage(next);
                }}
                className="w-full accent-indigo-600"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-0.5">ความกว้างข้อความ</label>
              <input
                type="range"
                min={80}
                max={175}
                step={2}
                value={layout.comment.w}
                onChange={(e) => {
                  const next = {
                    ...layout,
                    comment: { ...layout.comment, w: Number(e.target.value) },
                  };
                  setLayout(next);
                  saveLayoutToStorage(next);
                }}
                className="w-full accent-indigo-600"
              />
            </div>
          </div>
        </div>

        {/* 3. ลายเซ็นจริงของ ผอ. */}
        <div className="p-3 rounded-xl bg-white border border-slate-200/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">3. ลายเซ็น ผอ. (จำไว้ใช้อัตโนมัติ)</span>
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
                max={65}
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
                <span>ใช้เลขไทย (๒ พ.ย. ๒๕๖๙)</span>
              </label>
            </div>
          )}
        </div>

        <div className="p-2.5 rounded-xl bg-indigo-50/70 border border-indigo-200/70 text-[11px] text-indigo-900 flex items-start gap-2">
          <Move className="w-4 h-4 shrink-0 text-indigo-600 mt-0.5" />
          <span>
            <b>วิธีจัดตำแหน่ง:</b> ใช้เมาส์หรือนิ้วลาก <b>เครื่องหมาย ✓</b>, <b>ข้อความความเห็น</b> และ{" "}
            <b>ลายเซ็น</b> บนกระดาษด้านขวาไปวางตรงช่องของครูได้เลย ระบบจะจำตำแหน่งไว้ใช้กับแผนถัดไปให้อัตโนมัติครับ
          </span>
        </div>
      </div>

      {/* ฝั่งขวา: ตัวอย่างหน้ากระดาษจริง (ลากวางได้เหมือน HTML ต้นแบบ) */}
      <div className="lg:col-span-7 flex flex-col items-center space-y-2 bg-slate-200/70 p-3 sm:p-4 rounded-2xl border border-slate-300">
        {/* แถบเลือกหน้า */}
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
              {pageNumber === 1 ? " (หน้าแรก - บันทึกข้อความ)" : ""}
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
            ลากวางองค์ประกอบสีน้ำเงินบนกระดาษได้โดยตรง
          </span>
        </div>

        {loadingPdf && (
          <div className="py-16 flex flex-col items-center justify-center text-slate-600 text-xs gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            <span>กำลังโหลดหน้าเอกสาร PDF จริงจาก Google Drive...</span>
          </div>
        )}

        {pdfError && (
          <div className="w-full p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            ⚠️ {pdfError} (ยังสามารถวางลากบนกระดาษตัวอย่างหรือบันทึกผลการตรวจได้ตามปกติ)
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
            className="w-full max-w-[540px] h-auto bg-white shadow-lg rounded-lg border border-slate-300 cursor-grab active:cursor-grabbing touch-none select-none"
          />
        </div>
      </div>

      {/* Modal สำหรับวาดลายเซ็นด้วยปากกา/เมาส์ */}
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
