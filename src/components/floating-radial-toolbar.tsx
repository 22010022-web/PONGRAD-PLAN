"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Eraser,
  GripHorizontal,
  Hand,
  Highlighter,
  Move,
  Palette,
  PenLine,
  Redo2,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

export type PdfWorkspaceToolMode =
  | "move-sig"
  | "pen"
  | "highlighter"
  | "eraser"
  | "pan";

export const PEN_COLOR_PRESETS = [
  { color: "#dc2626", label: "แดง" },
  { color: "#1a2fa0", label: "น้ำเงิน" },
  { color: "#059669", label: "เขียว" },
  { color: "#7c3aed", label: "ม่วง" },
  { color: "#0f172a", label: "ดำ" },
];

export const HIGHLIGHTER_COLOR_PRESETS = [
  { color: "#facc15", label: "เหลือง" },
  { color: "#f472b6", label: "ชมพู" },
  { color: "#4ade80", label: "เขียว" },
  { color: "#38bdf8", label: "ฟ้า" },
  { color: "#fb923c", label: "ส้ม" },
];

interface FloatingRadialToolbarProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  toolMode: PdfWorkspaceToolMode;
  onToolModeChange: (mode: PdfWorkspaceToolMode) => void;
  penColor: string;
  onPenColorChange: (color: string) => void;
  penWidthMm: number;
  onPenWidthChange: (mm: number) => void;
  highlighterColor: string;
  onHighlighterColorChange: (color: string) => void;
  highlighterWidthMm: number;
  onHighlighterWidthChange: (mm: number) => void;
  eraserRadiusMm: number;
  onEraserRadiusChange: (mm: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  currentPageStrokeCount: number;
  onClearPageStrokes: () => void;
  ipadPencilOnly: boolean;
  onIpadPencilOnlyChange: (enabled: boolean) => void;
  collapseSignal?: number;
}

const COLLAPSED_SIZE = 52;
const EXPANDED_DIAMETER = 204;
const EXPANDED_RADIUS = EXPANDED_DIAMETER / 2;
const ORBIT_RADIUS = 68;
const EDGE_MARGIN = 12;
const IDLE_COLLAPSE_MS = 5500;

function clamp(val: number, min: number, max: number) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, val));
}

export function FloatingRadialToolbar({
  containerRef,
  toolMode,
  onToolModeChange,
  penColor,
  onPenColorChange,
  penWidthMm,
  onPenWidthChange,
  highlighterColor,
  onHighlighterColorChange,
  highlighterWidthMm,
  onHighlighterWidthChange,
  eraserRadiusMm,
  onEraserRadiusChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  currentPageStrokeCount,
  onClearPageStrokes,
  ipadPencilOnly,
  onIpadPencilOnlyChange,
  collapseSignal = 0,
}: FloatingRadialToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const [subPanel, setSubPanel] = useState<"color" | "size" | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 760, height: 560 });

  // ตำแหน่งศูนย์กลางของปุ่มแบบสัมพันธ์กับพื้นที่ PDF (ขอบขวาเป็นค่าเริ่มต้น)
  const [normPos, setNormPos] = useState<{
    x: number | null;
    y: number | null;
    dockSide: "left" | "right";
  }>({
    x: null,
    y: null,
    dockSide: "right",
  });

  const [isDragging, setIsDragging] = useState(false);
  const isPointerHoveringRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ติดตามขนาดพื้นที่ PDF เพื่อให้วงกลมไม่ล้นขอบจอเมื่อย่อ/ขยายหน้าต่าง
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateBounds = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };
    updateBounds();

    const ro = new ResizeObserver(updateBounds);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // เมื่อผู้ใช้เริ่มเขียน/วาดลงบนหน้ากระดาษ PDF ให้ยุบวงกลมหลบขอบจออัตโนมัติ (ถ้าไม่ได้เปิดแผงย่อยค้างไว้)
  const prevCollapseSignalRef = useRef(collapseSignal);
  useEffect(() => {
    if (collapseSignal !== prevCollapseSignalRef.current) {
      prevCollapseSignalRef.current = collapseSignal;
      if (expanded && !isDragging) {
        setExpanded(false);
        setSubPanel(null);
      }
    }
  }, [collapseSignal, expanded, isDragging]);

  const scheduleIdleCollapse = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (!expanded || isDragging || isPointerHoveringRef.current || subPanel !== null) {
      return;
    }
    idleTimerRef.current = setTimeout(() => {
      setExpanded(false);
      setSubPanel(null);
    }, IDLE_COLLAPSE_MS);
  }, [expanded, isDragging, subPanel]);

  useEffect(() => {
    scheduleIdleCollapse();
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [scheduleIdleCollapse, toolMode, penColor, highlighterColor, penWidthMm, highlighterWidthMm, eraserRadiusMm]);

  // คำนวณพิกัดจุดศูนย์กลางจริงสำหรับสถานะ "ยุบที่ขอบ" และ "เปิดกางเต็มวง"
  const collapsedRadius = COLLAPSED_SIZE / 2;
  const rawCollapsedX =
    normPos.x !== null
      ? normPos.x
      : normPos.dockSide === "left"
      ? EDGE_MARGIN + collapsedRadius
      : containerSize.width - EDGE_MARGIN - collapsedRadius;
  const rawCollapsedY =
    normPos.y !== null ? normPos.y : Math.max(88, containerSize.height * 0.52);

  const collapsedX = clamp(
    rawCollapsedX,
    EDGE_MARGIN + collapsedRadius,
    containerSize.width - EDGE_MARGIN - collapsedRadius
  );
  const collapsedY = clamp(
    rawCollapsedY,
    EDGE_MARGIN + collapsedRadius,
    containerSize.height - EDGE_MARGIN - collapsedRadius
  );

  const expandedX = clamp(
    collapsedX,
    EDGE_MARGIN + EXPANDED_RADIUS,
    containerSize.width - EDGE_MARGIN - EXPANDED_RADIUS
  );
  const expandedY = clamp(
    collapsedY,
    EDGE_MARGIN + EXPANDED_RADIUS,
    containerSize.height - EDGE_MARGIN - EXPANDED_RADIUS
  );

  const activeCenterX = expanded ? expandedX : collapsedX;
  const activeCenterY = expanded ? expandedY : collapsedY;

  const beginDrag = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: activeCenterX,
      originY: activeCenterY,
      moved: false,
    };
    setIsDragging(true);
  };

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) > 6) {
      drag.moved = true;
    }
    if (!drag.moved) return;

    const r = expanded ? EXPANDED_RADIUS : collapsedRadius;
    const nextX = clamp(drag.originX + dx, EDGE_MARGIN + r, containerSize.width - EDGE_MARGIN - r);
    const nextY = clamp(drag.originY + dy, EDGE_MARGIN + r, containerSize.height - EDGE_MARGIN - r);
    setNormPos({
      x: nextX,
      y: nextY,
      dockSide: nextX < containerSize.width / 2 ? "left" : "right",
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>, onTapAction?: () => void) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const wasTap = !drag.moved;
    dragStateRef.current = null;
    setIsDragging(false);

    if (!wasTap && !expanded) {
      // เมื่อลากปุ่มแบบยุบแล้วปล่อย ให้ดูดเข้าขอบซ้ายหรือขวาที่ใกล้กว่าแบบปุ่มลอยบน iPad
      const snapLeft = activeCenterX < containerSize.width / 2;
      setNormPos((prev) => ({
        x: snapLeft
          ? EDGE_MARGIN + collapsedRadius
          : containerSize.width - EDGE_MARGIN - collapsedRadius,
        y: prev.y ?? activeCenterY,
        dockSide: snapLeft ? "left" : "right",
      }));
    } else if (!wasTap && expanded) {
      setNormPos((prev) => ({
        ...prev,
        dockSide: activeCenterX < containerSize.width / 2 ? "left" : "right",
      }));
    }

    if (wasTap && onTapAction) {
      onTapAction();
    }
    scheduleIdleCollapse();
  };

  const activeColor =
    toolMode === "highlighter"
      ? highlighterColor
      : toolMode === "pen"
      ? penColor
      : toolMode === "eraser"
      ? "#f8fafc"
      : "#818cf8";

  const renderActiveToolIcon = (sizeClass = "w-5 h-5") => {
    switch (toolMode) {
      case "pen":
        return <PenLine className={sizeClass} />;
      case "highlighter":
        return <Highlighter className={sizeClass} />;
      case "eraser":
        return <Eraser className={sizeClass} />;
      case "pan":
        return <Hand className={sizeClass} />;
      default:
        return <Move className={sizeClass} />;
    }
  };

  const activeToolLabel =
    toolMode === "pen"
      ? "ปากกา"
      : toolMode === "highlighter"
      ? "ไฮไลต์"
      : toolMode === "eraser"
      ? "ยางลบ"
      : toolMode === "pan"
      ? "เลื่อนหน้า"
      : "ย้ายลายเซ็น";

  // 8 ปุ่มรอบวงกลม (มุมเริ่มจากด้านบนไล่ตามเข็มนาฬิกา)
  const orbitItems: {
    id: string;
    angleDeg: number;
    label: string;
    active?: boolean;
    disabled?: boolean;
    accentColor?: string;
    icon: React.ReactNode;
    onClick: () => void;
  }[] = [
    {
      id: "pen",
      angleDeg: -90,
      label: "ปากกา (เขียน/วาด)",
      active: toolMode === "pen",
      accentColor: penColor,
      icon: <PenLine className="w-4 h-4" />,
      onClick: () => {
        onToolModeChange("pen");
        setSubPanel(null);
      },
    },
    {
      id: "highlighter",
      angleDeg: -45,
      label: "ไฮไลต์ (เน้นข้อความ)",
      active: toolMode === "highlighter",
      accentColor: highlighterColor,
      icon: <Highlighter className="w-4 h-4" />,
      onClick: () => {
        onToolModeChange("highlighter");
        setSubPanel(null);
      },
    },
    {
      id: "eraser",
      angleDeg: 0,
      label: "ยางลบ (ลบลายเส้น)",
      active: toolMode === "eraser",
      accentColor: "#f43f5e",
      icon: <Eraser className="w-4 h-4" />,
      onClick: () => {
        onToolModeChange("eraser");
        setSubPanel(null);
      },
    },
    {
      id: "color",
      angleDeg: 45,
      label: "เลือกสี",
      active: subPanel === "color",
      icon: (
        <span className="relative inline-flex items-center justify-center">
          <Palette className="w-4 h-4" />
          <span
            className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border border-slate-900"
            style={{ backgroundColor: toolMode === "highlighter" ? highlighterColor : penColor }}
          />
        </span>
      ),
      onClick: () => {
        setSubPanel((cur) => (cur === "color" ? null : "color"));
      },
    },
    {
      id: "size",
      angleDeg: 90,
      label: "ปรับความหนา / ล้างหน้า",
      active: subPanel === "size",
      icon: <SlidersHorizontal className="w-4 h-4" />,
      onClick: () => {
        setSubPanel((cur) => (cur === "size" ? null : "size"));
      },
    },
    {
      id: "redo",
      angleDeg: 135,
      label: "ทำซ้ำ (Redo)",
      disabled: !canRedo,
      icon: <Redo2 className="w-4 h-4" />,
      onClick: () => {
        if (canRedo) onRedo();
      },
    },
    {
      id: "undo",
      angleDeg: 180,
      label: "ย้อนกลับ (Undo)",
      disabled: !canUndo,
      icon: <Undo2 className="w-4 h-4" />,
      onClick: () => {
        if (canUndo) onUndo();
      },
    },
    {
      id: "sig-pan",
      angleDeg: -135,
      label: toolMode === "move-sig" ? "สลับเป็นเลื่อนหน้า" : "ย้ายลายเซ็น / เลื่อนหน้า",
      active: toolMode === "move-sig" || toolMode === "pan",
      accentColor: toolMode === "pan" ? "#f59e0b" : "#6366f1",
      icon: toolMode === "pan" ? <Hand className="w-4 h-4" /> : <Move className="w-4 h-4" />,
      onClick: () => {
        onToolModeChange(toolMode === "move-sig" ? "pan" : "move-sig");
        setSubPanel(null);
      },
    },
  ];

  // ทิศทางการเปิด popover (ซ้าย/ขวา และ บน/ล่าง) เพื่อไม่ให้ล้นพื้นที่ PDF
  const openPopoverLeft = activeCenterX > containerSize.width * 0.5;
  const openPopoverAbove = activeCenterY > containerSize.height * 0.55;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 overflow-visible"
      aria-label="แถบเครื่องมือปากกาลอยแบบวงกลม"
    >
      {/* โหมดยุบเมื่อไม่ได้ใช้งาน: ปุ่มวงกลมเล็ก ๆ ที่ขอบจอ (ลากย้ายตำแหน่งได้) */}
      {!expanded && (
        <button
          type="button"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={(e) =>
            endDrag(e, () => {
              setExpanded(true);
            })
          }
          onPointerCancel={(e) => endDrag(e)}
          title={`เครื่องมือปากกา (${activeToolLabel}) · แตะเพื่อกางวงกลม หรือลากย้ายตำแหน่ง`}
          style={{
            width: `${COLLAPSED_SIZE}px`,
            height: `${COLLAPSED_SIZE}px`,
            left: `${collapsedX - collapsedRadius}px`,
            top: `${collapsedY - collapsedRadius}px`,
          }}
          className={`pointer-events-auto absolute rounded-full bg-slate-800/92 hover:bg-slate-800 text-white border border-white/25 shadow-[0_10px_28px_rgba(15,23,42,0.38)] backdrop-blur-md flex items-center justify-center touch-none select-none transition-transform duration-150 ${
            isDragging ? "scale-110 cursor-grabbing ring-4 ring-indigo-400/35" : "hover:scale-105 cursor-pointer"
          }`}
        >
          {renderActiveToolIcon("w-5 h-5")}
          <span
            className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-800 shadow-xs"
            style={{ backgroundColor: activeColor }}
          />
          <span className="sr-only">เปิดเครื่องมือปากกา Markup</span>
        </button>
      )}

      {/* โหมดขณะใช้งาน: Radial Tool Palette วงกลมลอยครบเครื่อง */}
      {expanded && (
        <div
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") {
              isPointerHoveringRef.current = true;
              if (idleTimerRef.current) {
                clearTimeout(idleTimerRef.current);
                idleTimerRef.current = null;
              }
            }
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") {
              isPointerHoveringRef.current = false;
              scheduleIdleCollapse();
            }
          }}
          style={{
            width: `${EXPANDED_DIAMETER}px`,
            height: `${EXPANDED_DIAMETER}px`,
            left: `${expandedX - EXPANDED_RADIUS}px`,
            top: `${expandedY - EXPANDED_RADIUS}px`,
          }}
          className="pointer-events-auto absolute select-none touch-none"
        >
          {/* วงกลมพื้นหลังสไตล์ iPad Dark Glass */}
          <div className="relative w-full h-full rounded-full bg-slate-800/92 backdrop-blur-xl border border-white/20 shadow-[0_20px_50px_rgba(15,23,42,0.48)] ring-1 ring-slate-950/30">
            {/* ปุ่มศูนย์กลาง: จับลากย้ายทั้งวงกลม หรือแตะเพื่อยุบกลับขอบจอ */}
            <button
              type="button"
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={(e) =>
                endDrag(e, () => {
                  setExpanded(false);
                  setSubPanel(null);
                })
              }
              onPointerCancel={(e) => endDrag(e)}
              title="ลากเพื่อย้ายตำแหน่งวงกลม · แตะเพื่อยุบเป็นปุ่มเล็ก"
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[50px] h-[50px] rounded-full bg-slate-700/95 hover:bg-slate-600 text-white border border-white/25 shadow-inner flex flex-col items-center justify-center gap-0.5 transition-transform ${
                isDragging ? "cursor-grabbing scale-95 ring-4 ring-indigo-400/40" : "cursor-grab"
              }`}
            >
              <div className="flex items-center gap-1">
                {renderActiveToolIcon("w-4 h-4")}
              </div>
              <GripHorizontal className="w-3.5 h-3.5 text-slate-300/80" />
              <span
                className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-800"
                style={{ backgroundColor: activeColor }}
              />
            </button>

            {/* ปุ่มรอบวงกลมทั้ง 8 ช่อง */}
            {orbitItems.map((item) => {
              const rad = (item.angleDeg * Math.PI) / 180;
              const bx = EXPANDED_RADIUS + Math.cos(rad) * ORBIT_RADIUS;
              const by = EXPANDED_RADIUS + Math.sin(rad) * ORBIT_RADIUS;

              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    item.onClick();
                    scheduleIdleCollapse();
                  }}
                  title={item.label}
                  style={{
                    left: `${bx}px`,
                    top: `${by}px`,
                    transform: "translate(-50%, -50%)",
                    ...(item.active && item.accentColor
                      ? {
                          boxShadow: `0 0 0 2px ${item.accentColor}`,
                        }
                      : {}),
                  }}
                  className={`absolute w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                    item.disabled
                      ? "text-slate-500 bg-slate-700/35 cursor-not-allowed opacity-50"
                      : item.active
                      ? "bg-white text-slate-900 shadow-md scale-110"
                      : "bg-slate-700/75 hover:bg-slate-600 text-slate-100 hover:scale-105"
                  }`}
                >
                  {item.icon}
                </button>
              );
            })}

            {/* ป้ายบอกสถานะโหมดที่ใช้งานอยู่ใต้ศูนย์กลาง (หรือยุบเมื่อลาก) */}
            <div className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-slate-900/85 text-[10px] font-bold text-slate-100 whitespace-nowrap shadow-xs border border-white/15">
              {activeToolLabel} · แตะตรงกลางเพื่อยุบ
            </div>
          </div>

          {/* Popover ย่อย: เลือกสีปากกาและสีไฮไลต์ */}
          {subPanel === "color" && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                ...(openPopoverLeft ? { right: "calc(100% + 10px)" } : { left: "calc(100% + 10px)" }),
                ...(openPopoverAbove ? { bottom: "4px" } : { top: "4px" }),
              }}
              className="absolute w-56 rounded-2xl bg-slate-900/95 backdrop-blur-xl text-white border border-white/20 p-3 shadow-2xl space-y-2.5 z-40"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                <span className="text-[11px] font-bold text-slate-200">เลือกสีหมึก & ไฮไลต์</span>
                <button
                  type="button"
                  onClick={() => setSubPanel(null)}
                  className="p-0.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold text-slate-400">สีปากกา (เขียน/วาด)</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {PEN_COLOR_PRESETS.map((c) => (
                    <button
                      key={c.color}
                      type="button"
                      title={`ปากกาสี${c.label}`}
                      onClick={() => {
                        onPenColorChange(c.color);
                        onToolModeChange("pen");
                      }}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        toolMode === "pen" && penColor === c.color
                          ? "border-white scale-115 ring-2 ring-indigo-400"
                          : "border-white/30 hover:scale-105"
                      }`}
                      style={{ backgroundColor: c.color }}
                    />
                  ))}
                  <label
                    title="เลือกสีปากกาเอง"
                    className="w-6 h-6 rounded-full border border-white/40 overflow-hidden cursor-pointer flex items-center justify-center bg-gradient-to-tr from-rose-500 via-amber-400 to-cyan-400"
                  >
                    <input
                      type="color"
                      value={penColor}
                      onChange={(e) => {
                        onPenColorChange(e.target.value);
                        onToolModeChange("pen");
                      }}
                      className="opacity-0 w-full h-full cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-1.5 pt-1 border-t border-white/10">
                <div className="text-[10px] font-semibold text-slate-400">สีไฮไลต์ (เน้นข้อความโปร่งแสง)</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {HIGHLIGHTER_COLOR_PRESETS.map((c) => (
                    <button
                      key={c.color}
                      type="button"
                      title={`ไฮไลต์สี${c.label}`}
                      onClick={() => {
                        onHighlighterColorChange(c.color);
                        onToolModeChange("highlighter");
                      }}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        toolMode === "highlighter" && highlighterColor === c.color
                          ? "border-white scale-115 ring-2 ring-amber-300"
                          : "border-white/30 hover:scale-105"
                      }`}
                      style={{ backgroundColor: c.color }}
                    />
                  ))}
                  <label
                    title="เลือกสีไฮไลต์เอง"
                    className="w-6 h-6 rounded-full border border-white/40 overflow-hidden cursor-pointer flex items-center justify-center bg-gradient-to-tr from-yellow-300 via-pink-400 to-emerald-400"
                  >
                    <input
                      type="color"
                      value={highlighterColor}
                      onChange={(e) => {
                        onHighlighterColorChange(e.target.value);
                        onToolModeChange("highlighter");
                      }}
                      className="opacity-0 w-full h-full cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Popover ย่อย: ปรับขนาดความหนา + ล้างลายเส้น + โหมด Apple Pencil */}
          {subPanel === "size" && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                ...(openPopoverLeft ? { right: "calc(100% + 10px)" } : { left: "calc(100% + 10px)" }),
                ...(openPopoverAbove ? { bottom: "4px" } : { top: "4px" }),
              }}
              className="absolute w-60 rounded-2xl bg-slate-900/95 backdrop-blur-xl text-white border border-white/20 p-3 shadow-2xl space-y-2.5 z-40"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                <span className="text-[11px] font-bold text-slate-200">
                  {toolMode === "highlighter"
                    ? "ความหนาหัวไฮไลต์"
                    : toolMode === "eraser"
                    ? "ขนาดหัวลบ"
                    : "ความหนาหัวปากกา"}
                </span>
                <button
                  type="button"
                  onClick={() => setSubPanel(null)}
                  className="p-0.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {toolMode === "highlighter" ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-1.5">
                    {[4, 6, 8.5, 11].map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => onHighlighterWidthChange(w)}
                        className={`h-8 rounded-lg border flex items-center justify-center ${
                          Math.abs(highlighterWidthMm - w) < 0.4
                            ? "border-amber-300 bg-white/15"
                            : "border-white/15 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <span
                          className="rounded-full inline-block"
                          style={{
                            width: `${Math.min(22, w * 1.9)}px`,
                            height: `${Math.min(14, Math.max(5, w * 1.1))}px`,
                            backgroundColor: highlighterColor,
                            opacity: 0.75,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={13}
                    step={0.5}
                    value={highlighterWidthMm}
                    onChange={(e) => onHighlighterWidthChange(Number(e.target.value))}
                    className="w-full accent-amber-400"
                  />
                </div>
              ) : toolMode === "eraser" ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-1.5">
                    {[3.5, 5.5, 8.5, 12].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => onEraserRadiusChange(r)}
                        className={`h-8 rounded-lg border flex items-center justify-center ${
                          Math.abs(eraserRadiusMm - r) < 0.5
                            ? "border-rose-400 bg-white/15"
                            : "border-white/15 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <span
                          className="rounded-full bg-rose-200 border border-rose-400 inline-block"
                          style={{
                            width: `${Math.min(20, r * 1.6)}px`,
                            height: `${Math.min(20, r * 1.6)}px`,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={15}
                    step={0.5}
                    value={eraserRadiusMm}
                    onChange={(e) => onEraserRadiusChange(Number(e.target.value))}
                    className="w-full accent-rose-400"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-1.5">
                    {[0.4, 0.65, 1.0, 1.45].map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => {
                          onPenWidthChange(w);
                          if (toolMode !== "pen") onToolModeChange("pen");
                        }}
                        className={`h-8 rounded-lg border flex items-center justify-center ${
                          Math.abs(penWidthMm - w) < 0.08
                            ? "border-indigo-400 bg-white/15"
                            : "border-white/15 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <span
                          className="rounded-full inline-block"
                          style={{
                            width: `${Math.max(4, Math.min(18, w * 10))}px`,
                            height: `${Math.max(4, Math.min(18, w * 10))}px`,
                            backgroundColor: penColor,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0.3}
                    max={1.8}
                    step={0.05}
                    value={penWidthMm}
                    onChange={(e) => {
                      onPenWidthChange(Number(e.target.value));
                      if (toolMode !== "pen") onToolModeChange("pen");
                    }}
                    className="w-full accent-indigo-400"
                  />
                </div>
              )}

              <label className="flex items-start gap-2 text-[10px] leading-snug text-slate-200 bg-white/5 p-2 rounded-xl border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ipadPencilOnly}
                  onChange={(e) => onIpadPencilOnlyChange(e.target.checked)}
                  className="accent-indigo-400 mt-0.5 shrink-0"
                />
                <span>โหมด iPad Apple Pencil (ปากกาเขียน / นิ้วเลื่อนกระดาษ)</span>
              </label>

              <button
                type="button"
                disabled={currentPageStrokeCount === 0}
                onClick={() => {
                  onClearPageStrokes();
                  setSubPanel(null);
                }}
                className="w-full py-1.5 px-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 border border-rose-400/30 text-[11px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>ล้างลายเส้นหน้านี้ทั้งหมด ({currentPageStrokeCount})</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
