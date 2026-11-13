"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Download,
  FilePlus2,
  FileText,
  Home,
  Image as ImageIcon,
  Images,
  Loader2,
  Minimize2,
  Scissors,
  ShieldCheck,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import {
  COMPRESS_PRESETS,
  CompressLevel,
  ImageOrientation,
  ImagePageSize,
  PdfThumb,
  RenderedPageImage,
  SplitMode,
  ToolKey,
  buildSplitChunks,
  compressPdfFile,
  convertPdfToImages,
  downloadBlob,
  downloadDataUrl,
  formatBytes,
  imagesToPdf,
  inspectPdfFile,
  mergePdfFiles,
  renderPdfThumbnails,
  splitPdfFile,
  stripExtension,
  toPdfBlob,
} from "@/lib/pdf-tools";

interface MergeItem {
  id: string;
  name: string;
  size: number;
  pageCount: number;
  bytes: Uint8Array;
}

interface ImageItem {
  id: string;
  file: File;
  name: string;
  size: number;
  previewUrl: string;
}

interface BannerState {
  type: "error" | "success" | "info";
  text: string;
}

interface ProgressState {
  active: boolean;
  percent: number;
  message: string;
}

const TOOL_CARDS: {
  key: Exclude<ToolKey, "home">;
  title: string;
  subtitle: string;
  accent: string;
  badgeClass: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    key: "merge",
    title: "รวมไฟล์ PDF",
    subtitle: "นำไฟล์ PDF หลายไฟล์มารวมเป็นไฟล์เดียว พร้อมจัดเรียงลำดับได้ตามต้องการ",
    accent: "from-rose-500 to-pink-600",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
    icon: FilePlus2,
  },
  {
    key: "split",
    title: "แยกไฟล์ PDF",
    subtitle: "แยกเฉพาะหน้าที่ต้องการ แยกทุกหน้า หรือแยกทีละช่วงหน้าพร้อมพรีวิว",
    accent: "from-sky-500 to-indigo-600",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    icon: Scissors,
  },
  {
    key: "compress",
    title: "บีบอัดลดขนาด PDF",
    subtitle: "ย่อขนาดไฟล์ PDF ให้เล็กลง เลือกระดับความคมชัดได้ 4 ระดับ",
    accent: "from-emerald-500 to-teal-600",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: Minimize2,
  },
  {
    key: "pdf2jpg",
    title: "แปลง PDF เป็นรูปภาพ",
    subtitle: "แปลงทุกหน้าของ PDF เป็นรูปภาพ JPG ความคมชัดสูง โหลดแยกรูปหรือทั้งชุด ZIP",
    accent: "from-amber-500 to-orange-600",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
    icon: ImageIcon,
  },
  {
    key: "jpg2pdf",
    title: "รวมรูปภาพเป็น PDF",
    subtitle: "รวมไฟล์รูป JPG, PNG, WebP เป็นเอกสาร PDF ตั้งค่ากระดาษ A4 และขอบได้",
    accent: "from-purple-500 to-fuchsia-600",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
    icon: Images,
  },
];

function makeId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function DropZone({
  accept,
  multiple = false,
  title,
  hint,
  disabled = false,
  onFiles,
}: {
  accept: string;
  multiple?: boolean;
  title: string;
  hint: string;
  disabled?: boolean;
  onFiles: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer select-none ${
        dragging
          ? "border-purple-500 bg-purple-50/70 scale-[1.01]"
          : "border-slate-300/80 bg-white/50 hover:border-pink-400 hover:bg-white/75"
      } ${disabled ? "opacity-60 pointer-events-none" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-100 to-purple-100 border border-pink-200/70 flex items-center justify-center mx-auto mb-3 text-purple-600 shadow-sm">
        <Upload className="w-6 h-6" />
      </div>
      <p className="text-sm sm:text-base font-bold text-slate-800">{title}</p>
      <p className="text-xs text-slate-500 mt-1">{hint}</p>
    </div>
  );
}

function ProgressBar({ progress }: { progress: ProgressState }) {
  if (!progress.active) return null;
  return (
    <div className="glass-card rounded-2xl p-4 border border-purple-200/70 space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
        <span className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
          {progress.message}
        </span>
        <span className="text-purple-700">{progress.percent}%</span>
      </div>
      <div className="w-full h-2.5 bg-slate-200/80 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-pink-500 to-purple-600 transition-all duration-200 rounded-full"
          style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
        />
      </div>
    </div>
  );
}

export default function PdfToolsPage() {
  const [activeTool, setActiveTool] = useState<ToolKey>("home");
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [progress, setProgress] = useState<ProgressState>({ active: false, percent: 0, message: "" });
  const [busy, setBusy] = useState(false);

  // 1. Merge state
  const [mergeItems, setMergeItems] = useState<MergeItem[]>([]);
  const [mergeFilename, setMergeFilename] = useState("merged_document");

  // 2. Split state
  const [splitFile, setSplitFile] = useState<{ name: string; size: number; pageCount: number; bytes: Uint8Array } | null>(null);
  const [splitThumbs, setSplitThumbs] = useState<PdfThumb[]>([]);
  const [splitMode, setSplitMode] = useState<SplitMode>("each");
  const [splitRange, setSplitRange] = useState("1-3, 5");
  const [splitEveryN, setSplitEveryN] = useState(2);
  const [splitBaseName, setSplitBaseName] = useState("");
  const [loadingThumbs, setLoadingThumbs] = useState(false);

  // 3. Compress state
  const [compressFile, setCompressFile] = useState<{ name: string; size: number; pageCount: number; bytes: Uint8Array } | null>(null);
  const [compressLevel, setCompressLevel] = useState<CompressLevel>("medium");
  const [compressResult, setCompressResult] = useState<{
    originalSize: number;
    compressedSize: number;
    savedPct: number;
    blob: Blob;
    filename: string;
  } | null>(null);

  // 4. PDF to JPG state
  const [pdf2JpgFile, setPdf2JpgFile] = useState<{ name: string; size: number; pageCount: number; bytes: Uint8Array } | null>(null);
  const [pdf2JpgScale, setPdf2JpgScale] = useState(2);
  const [pdf2JpgQuality, setPdf2JpgQuality] = useState(0.92);
  const [pdf2JpgOutput, setPdf2JpgOutput] = useState<{
    pages: RenderedPageImage[];
    zipBlob: Blob;
    zipFilename: string;
  } | null>(null);

  // 5. JPG to PDF state
  const [imageItems, setImageItems] = useState<ImageItem[]>([]);
  const imageItemsRef = useRef<ImageItem[]>([]);
  const [imgPageSize, setImgPageSize] = useState<ImagePageSize>("a4");
  const [imgOrientation, setImgOrientation] = useState<ImageOrientation>("auto");
  const [imgMarginMm, setImgMarginMm] = useState(10);
  const [imgOutputName, setImgOutputName] = useState("images_to_pdf");

  useEffect(() => {
    imageItemsRef.current = imageItems;
  }, [imageItems]);

  useEffect(() => {
    const paramTool = new URLSearchParams(window.location.search).get("tool");
    if (paramTool && ["merge", "split", "compress", "pdf2jpg", "jpg2pdf"].includes(paramTool)) {
      setActiveTool(paramTool as ToolKey);
    }
    return () => {
      imageItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  const switchTool = (nextTool: ToolKey) => {
    if (busy) return;
    setActiveTool(nextTool);
    setBanner(null);
  };

  const resetProgress = () => {
    window.setTimeout(() => {
      setProgress({ active: false, percent: 0, message: "" });
    }, 600);
  };

  // --- Tool 1 Handlers: Merge ---
  const handleAddMergeFiles = async (fileList: FileList) => {
    setBanner(null);
    const pdfs = Array.from(fileList).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length === 0) {
      setBanner({ type: "error", text: "กรุณาเลือกไฟล์ PDF (.pdf) เท่านั้น" });
      return;
    }

    setBusy(true);
    try {
      const loaded: MergeItem[] = [];
      for (const file of pdfs) {
        const { bytes, pageCount } = await inspectPdfFile(file);
        loaded.push({
          id: makeId(),
          name: file.name,
          size: file.size,
          pageCount,
          bytes,
        });
      }
      setMergeItems((prev) => [...prev, ...loaded]);
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? `ไม่สามารถอ่านไฟล์ PDF บางไฟล์ได้: ${err.message}` : "ไฟล์ PDF ไม่ถูกต้องหรือถูกเข้ารหัส",
      });
    } finally {
      setBusy(false);
    }
  };

  const moveMergeItem = (index: number, delta: -1 | 1) => {
    setMergeItems((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const handleRunMerge = async () => {
    if (mergeItems.length < 2) {
      setBanner({ type: "error", text: "กรุณาเพิ่มไฟล์ PDF อย่างน้อย 2 ไฟล์เพื่อรวม" });
      return;
    }
    setBanner(null);
    setBusy(true);
    setProgress({ active: true, percent: 5, message: "กำลังเริ่มต้นรวมไฟล์ PDF..." });
    try {
      const bytes = await mergePdfFiles(mergeItems, (percent, message) => {
        setProgress({ active: true, percent, message });
      });
      const safeName = (mergeFilename.trim() || "merged_document").replace(/\.pdf$/i, "");
      downloadBlob(toPdfBlob(bytes), `${safeName}.pdf`);
      setBanner({
        type: "success",
        text: `รวมไฟล์ PDF ทั้ง ${mergeItems.length} ไฟล์ (${mergeItems.reduce((a, b) => a + b.pageCount, 0)} หน้า) เรียบร้อยแล้ว`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? `เกิดข้อผิดพลาด: ${err.message}` : "ไม่สามารถรวมไฟล์ PDF ได้",
      });
    } finally {
      setBusy(false);
      resetProgress();
    }
  };

  // --- Tool 2 Handlers: Split ---
  const handleSelectSplitFile = async (fileList: FileList) => {
    const file = fileList[0];
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setBanner({ type: "error", text: "กรุณาเลือกไฟล์ PDF (.pdf) เท่านั้น" });
      return;
    }
    setBanner(null);
    setBusy(true);
    setLoadingThumbs(true);
    setSplitThumbs([]);
    try {
      const { bytes, pageCount } = await inspectPdfFile(file);
      setSplitFile({ name: file.name, size: file.size, pageCount, bytes });
      setSplitBaseName(`${stripExtension(file.name)}_split`);
      const { thumbnails } = await renderPdfThumbnails(bytes, 24, 130);
      setSplitThumbs(thumbnails);
    } catch (err) {
      setSplitFile(null);
      setBanner({
        type: "error",
        text: err instanceof Error ? `ไม่สามารถเปิดไฟล์ PDF ได้: ${err.message}` : "ไม่สามารถเปิดไฟล์ PDF ได้",
      });
    } finally {
      setLoadingThumbs(false);
      setBusy(false);
    }
  };

  const handleRunSplit = async () => {
    if (!splitFile) return;
    setBanner(null);
    setBusy(true);
    setProgress({ active: true, percent: 5, message: "กำลังตรวจสอบช่วงหน้า..." });
    try {
      const chunks = buildSplitChunks(splitMode, splitFile.pageCount, splitRange, splitEveryN);
      const safeBase = (splitBaseName.trim() || `${stripExtension(splitFile.name)}_split`).replace(/\.(pdf|zip)$/i, "");
      const res = await splitPdfFile(splitFile.bytes, chunks, safeBase, splitMode, (percent, message) => {
        setProgress({ active: true, percent, message });
      });
      downloadBlob(res.blob, res.filename);
      setBanner({
        type: "success",
        text: res.isZip
          ? `แยกเอกสารออกเป็น ${res.outputCount} ไฟล์ และดาวน์โหลดเป็น "${res.filename}" เรียบร้อยแล้ว`
          : `แยกเอกสารสำเร็จ และดาวน์โหลดเป็น "${res.filename}" เรียบร้อยแล้ว`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "ไม่สามารถแยกไฟล์ PDF ได้",
      });
    } finally {
      setBusy(false);
      resetProgress();
    }
  };

  // --- Tool 3 Handlers: Compress ---
  const handleSelectCompressFile = async (fileList: FileList) => {
    const file = fileList[0];
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setBanner({ type: "error", text: "กรุณาเลือกไฟล์ PDF (.pdf) เท่านั้น" });
      return;
    }
    setBanner(null);
    setCompressResult(null);
    setBusy(true);
    try {
      const { bytes, pageCount } = await inspectPdfFile(file);
      setCompressFile({ name: file.name, size: file.size, pageCount, bytes });
    } catch (err) {
      setCompressFile(null);
      setBanner({
        type: "error",
        text: err instanceof Error ? `ไม่สามารถเปิดไฟล์ PDF ได้: ${err.message}` : "ไม่สามารถเปิดไฟล์ PDF ได้",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRunCompress = async () => {
    if (!compressFile) return;
    setBanner(null);
    setBusy(true);
    setProgress({ active: true, percent: 5, message: "กำลังเริ่มต้นบีบอัด PDF..." });
    try {
      const outBytes = await compressPdfFile(compressFile.bytes, compressLevel, (percent, message) => {
        setProgress({ active: true, percent, message });
      });
      const blob = toPdfBlob(outBytes);
      const filename = `${stripExtension(compressFile.name)}_compressed.pdf`;
      const savedPct = compressFile.size > 0
        ? Math.round(((compressFile.size - outBytes.byteLength) / compressFile.size) * 1000) / 10
        : 0;
      setCompressResult({
        originalSize: compressFile.size,
        compressedSize: outBytes.byteLength,
        savedPct,
        blob,
        filename,
      });
      downloadBlob(blob, filename);
      setBanner({
        type: savedPct > 0 ? "success" : "info",
        text:
          savedPct > 0
            ? `บีบอัดไฟล์สำเร็จ! ลดขนาดจาก ${formatBytes(compressFile.size)} เหลือ ${formatBytes(outBytes.byteLength)} (ประหยัด ${savedPct}%)`
            : `สร้างไฟล์ "${filename}" สำเร็จ (ไฟล์ต้นฉบับมีขนาดเล็กมากอยู่แล้ว ขนาดใหม่อยู่ที่ ${formatBytes(outBytes.byteLength)})`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? `เกิดข้อผิดพลาดในการบีบอัด: ${err.message}` : "ไม่สามารถบีบอัด PDF ได้",
      });
    } finally {
      setBusy(false);
      resetProgress();
    }
  };

  // --- Tool 4 Handlers: PDF to JPG ---
  const handleSelectPdf2JpgFile = async (fileList: FileList) => {
    const file = fileList[0];
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setBanner({ type: "error", text: "กรุณาเลือกไฟล์ PDF (.pdf) เท่านั้น" });
      return;
    }
    setBanner(null);
    setPdf2JpgOutput(null);
    setBusy(true);
    try {
      const { bytes, pageCount } = await inspectPdfFile(file);
      setPdf2JpgFile({ name: file.name, size: file.size, pageCount, bytes });
    } catch (err) {
      setPdf2JpgFile(null);
      setBanner({
        type: "error",
        text: err instanceof Error ? `ไม่สามารถเปิดไฟล์ PDF ได้: ${err.message}` : "ไม่สามารถเปิดไฟล์ PDF ได้",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRunPdf2Jpg = async () => {
    if (!pdf2JpgFile) return;
    setBanner(null);
    setBusy(true);
    setProgress({ active: true, percent: 5, message: "กำลังเริ่มต้นแปลงหน้า PDF..." });
    try {
      const result = await convertPdfToImages(
        pdf2JpgFile.bytes,
        stripExtension(pdf2JpgFile.name),
        pdf2JpgScale,
        pdf2JpgQuality,
        (percent, message) => setProgress({ active: true, percent, message })
      );
      setPdf2JpgOutput(result);
      setBanner({
        type: "success",
        text: `แปลงครบทั้ง ${result.pages.length} หน้าเรียบร้อยแล้ว สามารถดาวน์โหลดแยกรูปหรือทั้งชุด ZIP ได้ด้านล่าง`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? `ไม่สามารถแปลงไฟล์ได้: ${err.message}` : "ไม่สามารถแปลงไฟล์ PDF ได้",
      });
    } finally {
      setBusy(false);
      resetProgress();
    }
  };

  // --- Tool 5 Handlers: JPG to PDF ---
  const handleAddImages = (fileList: FileList) => {
    setBanner(null);
    const valid = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (valid.length === 0) {
      setBanner({ type: "error", text: "กรุณาเลือกไฟล์รูปภาพ (JPG, PNG, WebP)" });
      return;
    }
    const additions: ImageItem[] = valid.map((file) => ({
      id: makeId(),
      file,
      name: file.name,
      size: file.size,
      previewUrl: URL.createObjectURL(file),
    }));
    setImageItems((prev) => [...prev, ...additions]);
  };

  const moveImageItem = (index: number, delta: -1 | 1) => {
    setImageItems((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const removeImageItem = (id: string) => {
    setImageItems((prev) => {
      const found = prev.find((x) => x.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  };

  const clearImageItems = () => {
    imageItems.forEach((x) => URL.revokeObjectURL(x.previewUrl));
    setImageItems([]);
  };

  const handleRunJpgToPdf = async () => {
    if (imageItems.length === 0) {
      setBanner({ type: "error", text: "กรุณาเพิ่มรูปภาพอย่างน้อย 1 รูป" });
      return;
    }
    setBanner(null);
    setBusy(true);
    setProgress({ active: true, percent: 5, message: "กำลังเริ่มต้นสร้างไฟล์ PDF จากรูปภาพ..." });
    try {
      const bytes = await imagesToPdf(
        imageItems,
        { pageSize: imgPageSize, orientation: imgOrientation, marginMm: imgMarginMm },
        (percent, message) => setProgress({ active: true, percent, message })
      );
      const safeName = (imgOutputName.trim() || "images_to_pdf").replace(/\.pdf$/i, "");
      downloadBlob(toPdfBlob(bytes), `${safeName}.pdf`);
      setBanner({
        type: "success",
        text: `รวมรูปภาพทั้งหมด ${imageItems.length} รูปเป็นไฟล์ "${safeName}.pdf" เรียบร้อยแล้ว`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? `เกิดข้อผิดพลาด: ${err.message}` : "ไม่สามารถสร้างไฟล์ PDF ได้",
      });
    } finally {
      setBusy(false);
      resetProgress();
    }
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-pink-500/10 to-purple-500/10 border border-pink-200/70 text-xs font-semibold text-purple-700">
            <Wrench className="w-3.5 h-3.5" />
            <span>PDF Tools</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-800 tracking-tight">
            ชุดเครื่องมือจัดการไฟล์ PDF
          </h1>
          <p className="text-sm text-slate-500">
            รวม แยก บีบอัด และแปลงไฟล์ PDF ได้ทันทีในเบราว์เซอร์ เพื่อเตรียมเอกสารก่อนส่งแผนการสอนและบันทึกหลังสอน
          </p>
        </div>

        <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-50/90 border border-emerald-200/80 text-emerald-700 text-xs font-semibold shrink-0">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span>ประมวลผลในเครื่อง 100% ไม่ส่งไฟล์ออกเซิร์ฟเวอร์</span>
        </div>
      </div>

      {/* Tool Navigation Pills */}
      <div className="glass-panel rounded-2xl p-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => switchTool("home")}
          disabled={busy}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeTool === "home"
              ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
          }`}
        >
          <Home className="w-4 h-4" />
          <span>รวมเครื่องมือ</span>
        </button>
        {TOOL_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => switchTool(card.key)}
              disabled={busy}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activeTool === card.key
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{card.title}</span>
            </button>
          );
        })}
      </div>

      {/* Status Banner */}
      {banner && (
        <div
          className={`rounded-2xl px-4 py-3.5 border flex items-start justify-between gap-3 text-sm font-medium ${
            banner.type === "error"
              ? "bg-rose-50/90 border-rose-200 text-rose-800"
              : banner.type === "success"
              ? "bg-emerald-50/90 border-emerald-200 text-emerald-800"
              : "bg-sky-50/90 border-sky-200 text-sky-800"
          }`}
        >
          <div className="flex items-start gap-2.5">
            {banner.type === "error" ? (
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
            ) : (
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="p-1 rounded-lg hover:bg-black/5 text-current"
            aria-label="ปิดการแจ้งเตือน"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Progress Bar */}
      <ProgressBar progress={progress} />

      {/* HOME OVERVIEW */}
      {activeTool === "home" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {TOOL_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => switchTool(card.key)}
                className="glass-card rounded-3xl p-6 text-left hover:scale-[1.01] hover:shadow-lg transition-all group border border-white/80 flex flex-col justify-between gap-5"
              >
                <div className="space-y-3">
                  <div
                    className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${card.accent} text-white flex items-center justify-center shadow-md group-hover:scale-105 transition-transform`}
                  >
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">{card.title}</h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1 leading-relaxed">{card.subtitle}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-200/60">
                  <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${card.badgeClass}`}>
                    ประมวลผลออฟไลน์
                  </span>
                  <span className="text-xs font-bold text-purple-600 group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                    เปิดใช้งาน <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* TOOL 1: MERGE PDF */}
      {activeTool === "merge" && (
        <div className="glass-panel rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/70 pb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <FilePlus2 className="w-5 h-5 text-rose-600" />
                รวมไฟล์ PDF (Merge PDF)
              </h2>
              <p className="text-xs text-slate-500 mt-1">เลือกได้หลายไฟล์พร้อมกัน แล้วจัดเรียงลำดับก่อนกดรวมไฟล์</p>
            </div>
            {mergeItems.length > 0 && (
              <button
                type="button"
                onClick={() => setMergeItems([])}
                disabled={busy}
                className="text-xs font-semibold text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-200 self-start"
              >
                ล้างรายการทั้งหมด
              </button>
            )}
          </div>

          <DropZone
            accept=".pdf,application/pdf"
            multiple
            disabled={busy}
            title="คลิกหรือลากไฟล์ PDF มาวางที่นี่ (เลือกได้หลายไฟล์)"
            hint="รองรับเฉพาะไฟล์ .pdf — เพิ่มไฟล์เพิ่มเติมได้เรื่อยๆ"
            onFiles={handleAddMergeFiles}
          />

          {mergeItems.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="glass-card rounded-2xl p-3 text-center">
                  <div className="text-lg font-extrabold text-slate-800">{mergeItems.length}</div>
                  <div className="text-[11px] font-medium text-slate-500">จำนวนไฟล์</div>
                </div>
                <div className="glass-card rounded-2xl p-3 text-center">
                  <div className="text-lg font-extrabold text-purple-700">
                    {mergeItems.reduce((sum, item) => sum + item.pageCount, 0)}
                  </div>
                  <div className="text-[11px] font-medium text-slate-500">จำนวนหน้ารวม</div>
                </div>
                <div className="glass-card rounded-2xl p-3 text-center">
                  <div className="text-lg font-extrabold text-slate-800">
                    {formatBytes(mergeItems.reduce((sum, item) => sum + item.size, 0))}
                  </div>
                  <div className="text-[11px] font-medium text-slate-500">ขนาดไฟล์รวม</div>
                </div>
              </div>

              <div className="space-y-2.5">
                {mergeItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="glass-card rounded-2xl p-3.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-7 h-7 rounded-xl bg-rose-100 text-rose-700 text-xs font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <FileText className="w-5 h-5 text-rose-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{item.name}</p>
                        <p className="text-xs text-slate-500">
                          {item.pageCount} หน้า · {formatBytes(item.size)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <button
                        type="button"
                        onClick={() => moveMergeItem(idx, -1)}
                        disabled={busy || idx === 0}
                        title="เลื่อนขึ้น"
                        className="p-2 rounded-xl border border-slate-200 bg-white/80 text-slate-600 hover:text-slate-900 disabled:opacity-40"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveMergeItem(idx, 1)}
                        disabled={busy || idx === mergeItems.length - 1}
                        title="เลื่อนลง"
                        className="p-2 rounded-xl border border-slate-200 bg-white/80 text-slate-600 hover:text-slate-900 disabled:opacity-40"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setMergeItems((prev) => prev.filter((x) => x.id !== item.id))}
                        disabled={busy}
                        title="ลบไฟล์"
                        className="p-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-3 sm:items-end justify-between">
                <div className="flex-1 max-w-md space-y-1">
                  <label className="text-xs font-semibold text-slate-600">ชื่อไฟล์ผลลัพธ์ (.pdf)</label>
                  <input
                    type="text"
                    value={mergeFilename}
                    onChange={(e) => setMergeFilename(e.target.value)}
                    disabled={busy}
                    placeholder="merged_document"
                    className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleRunMerge}
                  disabled={busy || mergeItems.length < 2}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-rose-500 to-pink-600 hover:opacity-95 shadow-md disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>รวมไฟล์ PDF และดาวน์โหลด</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* TOOL 2: SPLIT PDF */}
      {activeTool === "split" && (
        <div className="glass-panel rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-200/70 pb-4">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Scissors className="w-5 h-5 text-sky-600" />
              แยกไฟล์ PDF (Split PDF)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              แยกเป็นรายหน้า แยกตามช่วงหน้าที่ระบุ หรือแยกทุกๆ N หน้า (หากได้หลายไฟล์ระบบจะรวมเป็น ZIP ให้อัตโนมัติ)
            </p>
          </div>

          <DropZone
            accept=".pdf,application/pdf"
            disabled={busy}
            title={splitFile ? `เลือกไฟล์ใหม่แทน "${splitFile.name}"` : "คลิกหรือลากไฟล์ PDF 1 ไฟล์มาวางที่นี่"}
            hint="รองรับไฟล์ .pdf พร้อมแสดงตัวอย่างหน้ากระดาษ"
            onFiles={handleSelectSplitFile}
          />

          {splitFile && (
            <div className="space-y-6">
              <div className="glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-sky-600" />
                  <div>
                    <p className="text-sm font-bold text-slate-800">{splitFile.name}</p>
                    <p className="text-xs text-slate-500">
                      ทั้งหมด {splitFile.pageCount} หน้า · {formatBytes(splitFile.size)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSplitFile(null);
                    setSplitThumbs([]);
                  }}
                  disabled={busy}
                  className="text-xs font-semibold text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-200"
                >
                  เอาไฟล์ออก
                </button>
              </div>

              {/* Preview thumbnails */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>ตัวอย่างหน้าเอกสาร</span>
                  {splitFile.pageCount > 24 && (
                    <span className="text-slate-400">แสดงตัวอย่าง 24 หน้าแรก จากทั้งหมด {splitFile.pageCount} หน้า</span>
                  )}
                </div>
                {loadingThumbs ? (
                  <div className="glass-card rounded-2xl p-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
                    กำลังสร้างภาพตัวอย่างหน้ากระดาษ...
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-8 gap-3 max-h-80 overflow-y-auto p-1">
                    {splitThumbs.map((thumb) => (
                      <div
                        key={thumb.pageNumber}
                        className="glass-card rounded-xl p-1.5 flex flex-col items-center gap-1 border border-white/80"
                      >
                        <img
                          src={thumb.dataUrl}
                          alt={`หน้า ${thumb.pageNumber}`}
                          className="w-full h-auto rounded-lg border border-slate-200 object-contain bg-white"
                        />
                        <span className="text-[11px] font-bold text-slate-600">หน้า {thumb.pageNumber}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Split options */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { key: "each" as SplitMode, label: "แยกทุกหน้า", desc: "1 หน้า ต่อ 1 ไฟล์ PDF" },
                  { key: "range" as SplitMode, label: "ระบุช่วงหน้าเอง", desc: "เช่น 1-3, 5, 7-10" },
                  { key: "every" as SplitMode, label: "แยกทุกๆ N หน้า", desc: "แบ่งเป็นชุดละเท่าๆ กัน" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSplitMode(opt.key)}
                    disabled={busy}
                    className={`rounded-2xl p-4 text-left border transition-all ${
                      splitMode === opt.key
                        ? "border-sky-500 bg-sky-50/90 shadow-sm"
                        : "border-slate-200/80 bg-white/60 hover:bg-white/90"
                    }`}
                  >
                    <p className="text-sm font-bold text-slate-800">{opt.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>

              {splitMode === "range" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    ช่วงหน้าที่ต้องการแยก (คั่นด้วยเครื่องหมายจุลภาค , จะแยกแต่ละช่วงออกเป็น 1 ไฟล์)
                  </label>
                  <input
                    type="text"
                    value={splitRange}
                    onChange={(e) => setSplitRange(e.target.value)}
                    disabled={busy}
                    placeholder="เช่น 1-3, 5, 7-10"
                    className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
              )}

              {splitMode === "every" && (
                <div className="max-w-xs space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">จำนวนหน้าต่อ 1 ไฟล์</label>
                  <input
                    type="number"
                    min={1}
                    max={splitFile.pageCount}
                    value={splitEveryN}
                    onChange={(e) => setSplitEveryN(Math.max(1, Number(e.target.value) || 1))}
                    disabled={busy}
                    className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 sm:items-end justify-between pt-2">
                <div className="flex-1 max-w-md space-y-1">
                  <label className="text-xs font-semibold text-slate-600">ชื่อไฟล์หลักที่แยกแล้ว</label>
                  <input
                    type="text"
                    value={splitBaseName}
                    onChange={(e) => setSplitBaseName(e.target.value)}
                    disabled={busy}
                    className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleRunSplit}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-sky-500 to-indigo-600 hover:opacity-95 shadow-md disabled:opacity-50"
                >
                  <Scissors className="w-4 h-4" />
                  <span>แยกไฟล์ PDF และดาวน์โหลด</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TOOL 3: COMPRESS PDF */}
      {activeTool === "compress" && (
        <div className="glass-panel rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-200/70 pb-4">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Minimize2 className="w-5 h-5 text-emerald-600" />
              บีบอัดลดขนาด PDF (Compress PDF)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              เหมาะอย่างยิ่งสำหรับไฟล์ PDF ที่มีรูปภาพหรือไฟล์สแกนขนาดใหญ่ เพื่อลดขนาดก่อนอัปโหลดส่งงาน
            </p>
          </div>

          <DropZone
            accept=".pdf,application/pdf"
            disabled={busy}
            title={compressFile ? `เลือกไฟล์ใหม่แทน "${compressFile.name}"` : "คลิกหรือลากไฟล์ PDF ที่ต้องการลดขนาดมาวางที่นี่"}
            hint="รองรับไฟล์ .pdf และคงขนาดหน้ากระดาษเดิมทุกหน้า"
            onFiles={handleSelectCompressFile}
          />

          {compressFile && (
            <div className="space-y-6">
              <div className="glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-bold text-slate-800">{compressFile.name}</p>
                    <p className="text-xs text-slate-500">
                      {compressFile.pageCount} หน้า · ขนาดต้นฉบับ {formatBytes(compressFile.size)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCompressFile(null);
                    setCompressResult(null);
                  }}
                  disabled={busy}
                  className="text-xs font-semibold text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-200"
                >
                  เอาไฟล์ออก
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700">เลือกระดับการบีบอัด</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(Object.values(COMPRESS_PRESETS) as typeof COMPRESS_PRESETS[CompressLevel][]).map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => setCompressLevel(preset.key)}
                      disabled={busy}
                      className={`rounded-2xl p-4 text-left border transition-all ${
                        compressLevel === preset.key
                          ? "border-emerald-500 bg-emerald-50/90 shadow-sm"
                          : "border-slate-200/80 bg-white/60 hover:bg-white/90"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-800">{preset.label}</span>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          {preset.badge}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{preset.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleRunCompress}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:opacity-95 shadow-md disabled:opacity-50"
                >
                  <Minimize2 className="w-4 h-4" />
                  <span>บีบอัดไฟล์ PDF ทันที</span>
                </button>
              </div>

              {compressResult && (
                <div className="glass-card rounded-2xl p-5 border border-emerald-200 bg-emerald-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="grid grid-cols-3 gap-4 flex-1">
                    <div>
                      <p className="text-[11px] text-slate-500">ขนาดเดิม</p>
                      <p className="text-base font-bold text-slate-700">{formatBytes(compressResult.originalSize)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">ขนาดใหม่</p>
                      <p className="text-base font-extrabold text-emerald-700">{formatBytes(compressResult.compressedSize)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">ผลต่าง</p>
                      <p className="text-base font-extrabold text-emerald-700">
                        {compressResult.savedPct > 0 ? `-${compressResult.savedPct}%` : `+${Math.abs(compressResult.savedPct)}%`}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadBlob(compressResult.blob, compressResult.filename)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs text-emerald-700 bg-white border border-emerald-300 hover:bg-emerald-50 shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    <span>ดาวน์โหลดอีกครั้ง</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TOOL 4: PDF TO JPG */}
      {activeTool === "pdf2jpg" && (
        <div className="glass-panel rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-200/70 pb-4">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-amber-600" />
              แปลง PDF เป็นรูปภาพ (PDF to JPG)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              แปลงทุกหน้าในเอกสาร PDF ให้เป็นไฟล์รูปภาพ JPG พร้อมตัวอย่างและปุ่มโหลดทั้งแบบแยกรูปหรือทั้งชุด ZIP
            </p>
          </div>

          <DropZone
            accept=".pdf,application/pdf"
            disabled={busy}
            title={pdf2JpgFile ? `เลือกไฟล์ใหม่แทน "${pdf2JpgFile.name}"` : "คลิกหรือลากไฟล์ PDF ที่ต้องการแปลงเป็นรูปภาพมาวางที่นี่"}
            hint="รองรับไฟล์ .pdf"
            onFiles={handleSelectPdf2JpgFile}
          />

          {pdf2JpgFile && (
            <div className="space-y-6">
              <div className="glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-amber-600" />
                  <div>
                    <p className="text-sm font-bold text-slate-800">{pdf2JpgFile.name}</p>
                    <p className="text-xs text-slate-500">
                      {pdf2JpgFile.pageCount} หน้า · {formatBytes(pdf2JpgFile.size)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPdf2JpgFile(null);
                    setPdf2JpgOutput(null);
                  }}
                  disabled={busy}
                  className="text-xs font-semibold text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-200"
                >
                  เอาไฟล์ออก
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">ความละเอียดภาพ (Scale)</label>
                  <select
                    value={pdf2JpgScale}
                    onChange={(e) => setPdf2JpgScale(Number(e.target.value))}
                    disabled={busy}
                    className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value={1}>1x (มาตรฐาน - รวดเร็ว)</option>
                    <option value={2}>2x (คมชัด - แนะนำ)</option>
                    <option value={3}>3x (ความละเอียดสูงมาก)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">คุณภาพไฟล์ JPG</label>
                  <select
                    value={pdf2JpgQuality}
                    onChange={(e) => setPdf2JpgQuality(Number(e.target.value))}
                    disabled={busy}
                    className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value={0.8}>80% (ไฟล์เล็ก)</option>
                    <option value={0.92}>92% (สมดุล - แนะนำ)</option>
                    <option value={1}>100% (คุณภาพสูงสุด)</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleRunPdf2Jpg}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-95 shadow-md disabled:opacity-50"
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>แปลง PDF เป็นรูปภาพ</span>
                </button>
              </div>

              {pdf2JpgOutput && (
                <div className="space-y-4 pt-2 border-t border-slate-200/70">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-slate-800">
                      ผลลัพธ์ทั้งหมด {pdf2JpgOutput.pages.length} รูป
                    </h3>
                    <button
                      type="button"
                      onClick={() => downloadBlob(pdf2JpgOutput.zipBlob, pdf2JpgOutput.zipFilename)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-r from-amber-500 to-orange-600 shadow-sm hover:opacity-95"
                    >
                      <Archive className="w-4 h-4" />
                      <span>ดาวน์โหลดทั้งหมด (.zip)</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {pdf2JpgOutput.pages.map((p) => (
                      <div key={p.pageNumber} className="glass-card rounded-2xl p-2.5 space-y-2 flex flex-col justify-between">
                        <img
                          src={p.dataUrl}
                          alt={`หน้า ${p.pageNumber}`}
                          className="w-full h-44 object-contain rounded-xl border border-slate-200 bg-white"
                        />
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-700">หน้า {p.pageNumber}</p>
                            <p className="text-[11px] text-slate-400">{formatBytes(p.sizeBytes)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => downloadDataUrl(p.dataUrl, p.filename)}
                            className="p-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                            title="ดาวน์โหลดรูปนี้"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TOOL 5: JPG TO PDF */}
      {activeTool === "jpg2pdf" && (
        <div className="glass-panel rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/70 pb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Images className="w-5 h-5 text-purple-600" />
                รวมรูปภาพเป็น PDF (JPG / PNG to PDF)
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                รองรับ JPG, PNG, WebP พร้อมจัดเรียงซ้าย/ขวา และกำหนดขนาดหน้ากระดาษ A4 หรือพอดีรูปภาพได้
              </p>
            </div>
            {imageItems.length > 0 && (
              <button
                type="button"
                onClick={clearImageItems}
                disabled={busy}
                className="text-xs font-semibold text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-200 self-start"
              >
                ล้างรูปทั้งหมด
              </button>
            )}
          </div>

          <DropZone
            accept="image/jpeg,image/png,image/webp,image/*"
            multiple
            disabled={busy}
            title="คลิกหรือลากไฟล์รูปภาพมาวางที่นี่ (เลือกได้หลายรูป)"
            hint="รองรับไฟล์ภาพ JPG, PNG, WebP — เรียงลำดับก่อนแปลงได้"
            onFiles={handleAddImages}
          />

          {imageItems.length > 0 && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {imageItems.map((img, idx) => (
                  <div key={img.id} className="glass-card rounded-2xl p-2.5 space-y-2 flex flex-col justify-between">
                    <div className="relative">
                      <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-lg bg-slate-900/75 text-white text-[10px] font-bold">
                        #{idx + 1}
                      </span>
                      <img
                        src={img.previewUrl}
                        alt={img.name}
                        className="w-full h-36 object-cover rounded-xl border border-slate-200 bg-white"
                      />
                    </div>
                    <p className="text-xs font-semibold text-slate-700 truncate" title={img.name}>
                      {img.name}
                    </p>
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveImageItem(idx, -1)}
                          disabled={busy || idx === 0}
                          title="ย้ายไปซ้าย"
                          className="p-1.5 rounded-lg border border-slate-200 bg-white/80 text-slate-600 hover:text-slate-900 disabled:opacity-40"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveImageItem(idx, 1)}
                          disabled={busy || idx === imageItems.length - 1}
                          title="ย้ายไปขวา"
                          className="p-1.5 rounded-lg border border-slate-200 bg-white/80 text-slate-600 hover:text-slate-900 disabled:opacity-40"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeImageItem(img.id)}
                        disabled={busy}
                        title="ลบรูป"
                        className="p-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">ขนาดหน้ากระดาษ</label>
                  <select
                    value={imgPageSize}
                    onChange={(e) => setImgPageSize(e.target.value as ImagePageSize)}
                    disabled={busy}
                    className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  >
                    <option value="a4">A4 (มาตรฐาน)</option>
                    <option value="fit">พอดีกับขนาดภาพ</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">แนวการจัดวาง</label>
                  <select
                    value={imgOrientation}
                    onChange={(e) => setImgOrientation(e.target.value as ImageOrientation)}
                    disabled={busy || imgPageSize === "fit"}
                    className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-400 disabled:opacity-50"
                  >
                    <option value="auto">อัตโนมัติ (ตามรูปภาพ)</option>
                    <option value="portrait">แนวตั้ง (Portrait)</option>
                    <option value="landscape">แนวนอน (Landscape)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">ขอบกระดาษ</label>
                  <select
                    value={imgMarginMm}
                    onChange={(e) => setImgMarginMm(Number(e.target.value))}
                    disabled={busy}
                    className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  >
                    <option value={0}>ไม่มีขอบ (0 มม.)</option>
                    <option value={10}>ขอบปานกลาง (10 มม.)</option>
                    <option value={20}>ขอบกว้าง (20 มม.)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">ชื่อไฟล์ PDF (.pdf)</label>
                  <input
                    type="text"
                    value={imgOutputName}
                    onChange={(e) => setImgOutputName(e.target.value)}
                    disabled={busy}
                    placeholder="images_to_pdf"
                    className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleRunJpgToPdf}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-purple-500 to-fuchsia-600 hover:opacity-95 shadow-md disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>รวมรูปภาพเป็น PDF และดาวน์โหลด</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
