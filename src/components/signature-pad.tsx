"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, PenTool } from "lucide-react";

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
  signerName?: string;
  signerTitle?: string;
  includeStampText?: boolean;
}

export function SignaturePad({
  onChange,
  signerName = "",
  signerTitle = "ผู้อำนวยการโรงเรียนวัดโป่งแรดฯ",
  includeStampText = true,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2.6;
    }
  }, []);

  const getPoint = (
    e: React.PointerEvent<HTMLCanvasElement>
  ): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const emitDataUrl = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!includeStampText || !signerName.trim()) {
      onChange(canvas.toDataURL("image/png"));
      return;
    }

    // Compose signature + Thai signer caption onto an offscreen canvas
    // so pdf-lib never fails on Thai Unicode fonts.
    const exportCanvas = document.createElement("canvas");
    const extraHeight = 52;
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height + extraHeight * (window.devicePixelRatio || 1);
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) {
      onChange(canvas.toDataURL("image/png"));
      return;
    }

    ctx.drawImage(canvas, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);

    const logicalW = canvas.width / dpr;
    const logicalH = canvas.height / dpr;

    ctx.fillStyle = "#0f172a";
    ctx.textAlign = "center";
    ctx.font = "600 13px sans-serif";
    ctx.fillText(`(${signerName.trim()})`, logicalW / 2, logicalH + 18);

    if (signerTitle.trim()) {
      ctx.fillStyle = "#334155";
      ctx.font = "500 11px sans-serif";
      ctx.fillText(signerTitle.trim(), logicalW / 2, logicalH + 36);
    }

    onChange(exportCanvas.toDataURL("image/png"));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    isDrawingRef.current = true;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPoint(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInkRef.current) {
      hasInkRef.current = true;
      setHasInk(true);
    }
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (hasInkRef.current) {
      emitDataUrl();
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
          <PenTool className="h-3.5 w-3.5 text-blue-600" />
          เซ็นชื่อด้วยเมาส์ ปากกา หรือนิ้วบนหน้าจอ
        </span>
        <button
          type="button"
          onClick={handleClear}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          <Eraser className="h-3.5 w-3.5" />
          ล้างลายเซ็น
        </button>
      </div>

      <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="h-36 w-full touch-none cursor-crosshair block"
        />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
            พื้นที่สำหรับลงลายมือชื่อ ผอ.
          </div>
        )}
      </div>

      {includeStampText && signerName.trim() && (
        <p className="text-[11px] text-slate-500 text-center">
          ระบบจะประทับชื่อ ({signerName.trim()}) {signerTitle ? `และตำแหน่ง ${signerTitle}` : ""} ใต้ลายเซ็นอัตโนมัติ
        </p>
      )}
    </div>
  );
}
