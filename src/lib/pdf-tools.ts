import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

export type ToolKey = "home" | "merge" | "split" | "compress" | "pdf2jpg" | "jpg2pdf";
export type SplitMode = "each" | "range" | "every";
export type CompressLevel = "low" | "medium" | "high" | "extreme";
export type ImagePageSize = "a4" | "fit";
export type ImageOrientation = "auto" | "portrait" | "landscape";

export interface CompressPreset {
  key: CompressLevel;
  label: string;
  badge: string;
  description: string;
  scale: number;
  quality: number;
}

export const COMPRESS_PRESETS: Record<CompressLevel, CompressPreset> = {
  low: {
    key: "low",
    label: "ระดับต่ำ (คมชัดมาก)",
    badge: "ความละเอียดสูง",
    description: "เหมาะสำหรับเอกสารที่มีรายละเอียดหรือภาพประกอบต้องการความคมชัด",
    scale: 1.5,
    quality: 0.85,
  },
  medium: {
    key: "medium",
    label: "ระดับกลาง",
    badge: "แนะนำ",
    description: "สมดุลระหว่างความคมชัดและขนาดไฟล์ เหมาะกับการส่งแผนการสอนทั่วไป",
    scale: 1.2,
    quality: 0.7,
  },
  high: {
    key: "high",
    label: "ระดับสูง (ไฟล์เล็ก)",
    badge: "ประหยัดพื้นที่",
    description: "ลดขนาดไฟล์ลงมาก เหมาะกับการแนบไฟล์ที่มีข้อจำกัดขนาด",
    scale: 1.0,
    quality: 0.5,
  },
  extreme: {
    key: "extreme",
    label: "ระดับสูงสุด (เล็กมาก)",
    badge: "ขนาดเล็กสุด",
    description: "บีบอัดขนาดไฟล์ให้เล็กที่สุด ความคมชัดจะลดลงตามระดับ",
    scale: 0.8,
    quality: 0.35,
  },
};

let pdfjsWorkerConfigured = false;

async function getPdfJs() {
  const pdfjsLib = await import("pdfjs-dist");
  if (!pdfjsWorkerConfigured && typeof window !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    pdfjsWorkerConfigured = true;
  }
  return pdfjsLib;
}

type LoadedPdfDoc = Awaited<ReturnType<Awaited<ReturnType<typeof getPdfJs>>["getDocument"]>["promise"]>;

async function withPdfDocument<T>(bytes: Uint8Array, fn: (pdfDoc: LoadedPdfDoc) => Promise<T>): Promise<T> {
  const pdfjsLib = await getPdfJs();
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const pdfDoc = await loadingTask.promise;
  try {
    return await fn(pdfDoc);
  } finally {
    await loadingTask.destroy();
  }
}

async function renderPageToCanvas(
  page: Awaited<ReturnType<LoadedPdfDoc["getPage"]>>,
  scale: number
): Promise<HTMLCanvasElement> {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  await page.render({ canvas, viewport: vp, background: "#ffffff" }).promise;
  return canvas;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${idx === 0 ? Math.round(value) : value.toFixed(2)} ${units[idx]}`;
}

export function stripExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, "");
}

export function toPdfBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes);
  return new Blob([copy.buffer], { type: "application/pdf" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function inspectPdfFile(file: File): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  return { bytes, pageCount: doc.getPageCount() };
}

export interface PdfThumb {
  pageNumber: number;
  dataUrl: string;
}

export async function renderPdfThumbnails(
  bytes: Uint8Array,
  maxPages = 24,
  targetWidth = 140
): Promise<{ totalPages: number; thumbnails: PdfThumb[] }> {
  return withPdfDocument(bytes, async (pdfDoc) => {
    const totalPages = pdfDoc.numPages;
    const count = Math.min(totalPages, maxPages);
    const thumbnails: PdfThumb[] = [];

    for (let i = 1; i <= count; i++) {
      const page = await pdfDoc.getPage(i);
      const baseVp = page.getViewport({ scale: 1 });
      const scale = targetWidth / Math.max(baseVp.width, 1);
      const canvas = await renderPageToCanvas(page, scale);
      thumbnails.push({
        pageNumber: i,
        dataUrl: canvas.toDataURL("image/jpeg", 0.72),
      });
    }

    return { totalPages, thumbnails };
  });
}

export async function mergePdfFiles(
  items: { name: string; bytes: Uint8Array }[],
  onProgress?: (pct: number, message: string) => void
): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();
  for (let i = 0; i < items.length; i++) {
    onProgress?.(Math.round(((i + 1) / items.length) * 90), `กำลังรวมไฟล์ที่ ${i + 1}/${items.length}: ${items[i].name}`);
    const srcPdf = await PDFDocument.load(items[i].bytes);
    const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
    copiedPages.forEach((p) => mergedPdf.addPage(p));
  }
  onProgress?.(96, "กำลังสร้างไฟล์ PDF สุดท้าย...");
  const saved = await mergedPdf.save();
  onProgress?.(100, "รวมไฟล์เสร็จสมบูรณ์");
  return saved;
}

export function parseSplitRanges(input: string, totalPages: number): number[][] {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error("กรุณาระบุช่วงหน้าที่ต้องการแยก เช่น 1-3, 5, 7-10");
  }

  const chunks: number[][] = [];
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      const pageNum = Number(part);
      if (pageNum < 1 || pageNum > totalPages) {
        throw new Error(`เลขหน้า ${pageNum} อยู่นอกขอบเขต (เอกสารมี ${totalPages} หน้า)`);
      }
      chunks.push([pageNum]);
    } else if (/^\d+\s*-\s*\d+$/.test(part)) {
      const [startStr, endStr] = part.split("-").map((s) => s.trim());
      const start = Number(startStr);
      const end = Number(endStr);
      if (start < 1 || end > totalPages || start > end) {
        throw new Error(`ช่วงหน้า "${part}" ไม่ถูกต้อง (เอกสารมี 1-${totalPages} หน้า)`);
      }
      const range: number[] = [];
      for (let p = start; p <= end; p++) {
        range.push(p);
      }
      chunks.push(range);
    } else {
      throw new Error(`รูปแบบช่วงหน้า "${part}" ไม่ถูกต้อง กรุณาใช้รูปแบบเช่น 1-3, 5, 7-10`);
    }
  }

  return chunks;
}

export function buildSplitChunks(
  mode: SplitMode,
  totalPages: number,
  rangeInput: string,
  everyN: number
): number[][] {
  if (mode === "each") {
    return Array.from({ length: totalPages }, (_, i) => [i + 1]);
  }
  if (mode === "every") {
    const step = Math.max(1, Math.floor(everyN));
    const chunks: number[][] = [];
    for (let start = 1; start <= totalPages; start += step) {
      const end = Math.min(start + step - 1, totalPages);
      const group: number[] = [];
      for (let p = start; p <= end; p++) {
        group.push(p);
      }
      chunks.push(group);
    }
    return chunks;
  }
  return parseSplitRanges(rangeInput, totalPages);
}

export async function splitPdfFile(
  bytes: Uint8Array,
  chunks: number[][],
  baseName: string,
  mode: SplitMode,
  onProgress?: (pct: number, message: string) => void
): Promise<{ blob: Blob; filename: string; outputCount: number; isZip: boolean }> {
  const srcPdf = await PDFDocument.load(bytes);

  if (chunks.length === 1) {
    onProgress?.(60, "กำลังสร้างไฟล์ PDF ที่แยก...");
    const outPdf = await PDFDocument.create();
    const copied = await outPdf.copyPages(
      srcPdf,
      chunks[0].map((p) => p - 1)
    );
    copied.forEach((p) => outPdf.addPage(p));
    const saved = await outPdf.save();
    onProgress?.(100, "แยกไฟล์เสร็จสมบูรณ์");
    return {
      blob: toPdfBlob(saved),
      filename: `${baseName}.pdf`,
      outputCount: 1,
      isZip: false,
    };
  }

  const zip = new JSZip();
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(Math.round(((i + 1) / chunks.length) * 85), `กำลังแยกไฟล์ชุดที่ ${i + 1}/${chunks.length}...`);
    const outPdf = await PDFDocument.create();
    const copied = await outPdf.copyPages(
      srcPdf,
      chunks[i].map((p) => p - 1)
    );
    copied.forEach((p) => outPdf.addPage(p));
    const saved = await outPdf.save();
    const suffix = mode === "each" ? `page_${chunks[i][0]}` : `part_${i + 1}`;
    zip.file(`${baseName}_${suffix}.pdf`, saved);
  }

  onProgress?.(94, "กำลังบีบอัดเป็นไฟล์ ZIP...");
  const zipBlob = await zip.generateAsync({ type: "blob" });
  onProgress?.(100, "แยกไฟล์เสร็จสมบูรณ์");
  return {
    blob: zipBlob,
    filename: `${baseName}.zip`,
    outputCount: chunks.length,
    isZip: true,
  };
}

export async function compressPdfFile(
  bytes: Uint8Array,
  level: CompressLevel,
  onProgress?: (pct: number, message: string) => void
): Promise<Uint8Array> {
  const preset = COMPRESS_PRESETS[level];
  const outPdf = await PDFDocument.create();

  return withPdfDocument(bytes, async (pdfDoc) => {
    const total = pdfDoc.numPages;
    for (let i = 1; i <= total; i++) {
      onProgress?.(Math.round((i / total) * 92), `กำลังบีบอัดหน้า ${i}/${total}...`);
      const page = await pdfDoc.getPage(i);
      const origVp = page.getViewport({ scale: 1 });
      const canvas = await renderPageToCanvas(page, preset.scale);

      const jpgDataUrl = canvas.toDataURL("image/jpeg", preset.quality);
      const jpgBytes = await dataUrlToBytes(jpgDataUrl);
      const embedded = await outPdf.embedJpg(jpgBytes);

      const outPage = outPdf.addPage([origVp.width, origVp.height]);
      outPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: origVp.width,
        height: origVp.height,
      });
    }

    onProgress?.(96, "กำลังบันทึกไฟล์ PDF ที่บีบอัดแล้ว...");
    const saved = await outPdf.save();
    onProgress?.(100, "บีบอัดเสร็จสมบูรณ์");
    return saved;
  });
}

export interface RenderedPageImage {
  pageNumber: number;
  filename: string;
  dataUrl: string;
  sizeBytes: number;
}

export async function convertPdfToImages(
  bytes: Uint8Array,
  baseName: string,
  scale: number,
  quality: number,
  onProgress?: (pct: number, message: string) => void
): Promise<{ pages: RenderedPageImage[]; zipBlob: Blob; zipFilename: string }> {
  const zip = new JSZip();
  const pages: RenderedPageImage[] = [];

  return withPdfDocument(bytes, async (pdfDoc) => {
    const total = pdfDoc.numPages;
    const padLen = Math.max(2, String(total).length);

    for (let i = 1; i <= total; i++) {
      onProgress?.(Math.round((i / total) * 88), `กำลังแปลงหน้า ${i}/${total}...`);
      const page = await pdfDoc.getPage(i);
      const canvas = await renderPageToCanvas(page, scale);

      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const jpgBytes = await dataUrlToBytes(dataUrl);
      const filename = `${baseName}_page_${String(i).padStart(padLen, "0")}.jpg`;

      zip.file(filename, jpgBytes);
      pages.push({
        pageNumber: i,
        filename,
        dataUrl,
        sizeBytes: jpgBytes.byteLength,
      });
    }

    onProgress?.(95, "กำลังสร้างไฟล์ ZIP...");
    const zipBlob = await zip.generateAsync({ type: "blob" });
    onProgress?.(100, "แปลงรูปภาพเสร็จสมบูรณ์");
    return {
      pages,
      zipBlob,
      zipFilename: `${baseName}_images.zip`,
    };
  });
}

function loadImageDimensions(url: string): Promise<{ img: HTMLImageElement; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => reject(new Error("ไม่สามารถอ่านไฟล์รูปภาพได้"));
    img.src = url;
  });
}

async function encodeImageForPdf(
  pdfDoc: PDFDocument,
  file: File,
  previewUrl: string
): Promise<{ embedded: Awaited<ReturnType<PDFDocument["embedJpg"]>>; width: number; height: number }> {
  const mime = file.type.toLowerCase();
  try {
    if (mime === "image/jpeg" || mime === "image/jpg") {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const embedded = await pdfDoc.embedJpg(bytes);
      return { embedded, width: embedded.width, height: embedded.height };
    }
    if (mime === "image/png") {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const embedded = await pdfDoc.embedPng(bytes);
      return { embedded, width: embedded.width, height: embedded.height };
    }
  } catch {
    // Fall back to canvas normalization if direct embed fails on non-standard encoding
  }

  // Fallback for WebP / GIF / BMP: rasterize onto white canvas as JPEG
  const { img, width, height } = await loadImageDimensions(previewUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("เบราว์เซอร์ไม่รองรับ Canvas 2D");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpgBytes = await dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92));
  const embedded = await pdfDoc.embedJpg(jpgBytes);
  return { embedded, width: embedded.width, height: embedded.height };
}

const MM_TO_PT = 72 / 25.4;
const PX_TO_PT = 72 / 96;
const A4_SHORT_PT = 210 * MM_TO_PT;
const A4_LONG_PT = 297 * MM_TO_PT;

export async function imagesToPdf(
  items: { file: File; previewUrl: string }[],
  options: {
    pageSize: ImagePageSize;
    orientation: ImageOrientation;
    marginMm: number;
  },
  onProgress?: (pct: number, message: string) => void
): Promise<Uint8Array> {
  const outPdf = await PDFDocument.create();
  const marginPt = Math.max(0, options.marginMm) * MM_TO_PT;

  for (let i = 0; i < items.length; i++) {
    onProgress?.(Math.round(((i + 1) / items.length) * 92), `กำลังเพิ่มรูปภาพที่ ${i + 1}/${items.length}...`);
    const { embedded, width: imgW, height: imgH } = await encodeImageForPdf(outPdf, items[i].file, items[i].previewUrl);

    let pageW: number;
    let pageH: number;

    if (options.pageSize === "fit") {
      pageW = imgW * PX_TO_PT + marginPt * 2;
      pageH = imgH * PX_TO_PT + marginPt * 2;
    } else {
      const useLandscape =
        options.orientation === "landscape" ||
        (options.orientation === "auto" && imgW > imgH);
      pageW = useLandscape ? A4_LONG_PT : A4_SHORT_PT;
      pageH = useLandscape ? A4_SHORT_PT : A4_LONG_PT;
    }

    const page = outPdf.addPage([pageW, pageH]);
    const availW = Math.max(10, pageW - marginPt * 2);
    const availH = Math.max(10, pageH - marginPt * 2);
    const ratio = Math.min(availW / Math.max(imgW, 1), availH / Math.max(imgH, 1));
    const drawW = imgW * ratio;
    const drawH = imgH * ratio;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;

    page.drawImage(embedded, { x, y, width: drawW, height: drawH });
  }

  onProgress?.(96, "กำลังบันทึกไฟล์ PDF...");
  const saved = await outPdf.save();
  onProgress?.(100, "สร้างไฟล์ PDF เสร็จสมบูรณ์");
  return saved;
}
