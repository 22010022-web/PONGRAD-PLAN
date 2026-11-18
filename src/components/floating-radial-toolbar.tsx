"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ArrowUpToLine,
  BoxSelect,
  Circle,
  Copy,
  Droplet,
  Eraser,
  GripHorizontal,
  Hand,
  Highlighter,
  Layers,
  Minus,
  MousePointer2,
  Move,
  Palette,
  Pencil,
  PenLine,
  RectangleHorizontal,
  Redo2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Square,
  Trash2,
  Triangle,
  Undo2,
  X,
} from "lucide-react";
import { PdfShapeItem, SHAPE_LABELS, ShapeKind } from "@/lib/pdf-shapes";

export type PdfWorkspaceToolMode =
  | "move-sig"
  | "select"
  | "pen"
  | "highlighter"
  | "pencil"
  | "eraser"
  | "object-eraser"
  | "lasso-delete"
  | "shape"
  | "pan";

export type ToolbarCategoryTab =
  | "draw"
  | "erase"
  | "shapes"
  | "manage"
  | "customize";

export const PEN_COLOR_PRESETS = [
  { color: "#dc2626", label: "แดง" },
  { color: "#1a2fa0", label: "น้ำเงิน" },
  { color: "#059669", label: "เขียว" },
  { color: "#7c3aed", label: "ม่วง" },
  { color: "#ea580c", label: "ส้ม" },
  { color: "#0f172a", label: "ดำ" },
];

export const HIGHLIGHTER_COLOR_PRESETS = [
  { color: "#facc15", label: "เหลือง" },
  { color: "#f472b6", label: "ชมพู" },
  { color: "#4ade80", label: "เขียว" },
  { color: "#38bdf8", label: "ฟ้า" },
  { color: "#fb923c", label: "ส้ม" },
];

export const SHAPE_FILL_PRESETS = [
  { color: "#fef08a", label: "เหลืองอ่อน" },
  { color: "#fecdd3", label: "ชมพูอ่อน" },
  { color: "#bbf7d0", label: "เขียวอ่อน" },
  { color: "#bae6fd", label: "ฟ้าอ่อน" },
  { color: "#e9d5ff", label: "ม่วงอ่อน" },
  { color: "#ffffff", label: "ขาว" },
];

interface FloatingRadialToolbarProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  toolMode: PdfWorkspaceToolMode;
  onToolModeChange: (mode: PdfWorkspaceToolMode) => void;
  activeShapeKind: ShapeKind;
  onActiveShapeKindChange: (kind: ShapeKind) => void;
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
  strokeOpacity: number;
  onStrokeOpacityChange: (opacity: number) => void;
  shapeFillColor: string;
  onShapeFillColorChange: (color: string) => void;
  shapeFillEnabled: boolean;
  onShapeFillEnabledChange: (enabled: boolean) => void;
  selectedShape: PdfShapeItem | null;
  onDuplicateSelectedShape: () => void;
  onDeleteSelectedShape: () => void;
  onRotateSelectedShape: (deltaDeg: number) => void;
  onLayerSelectedShape: (action: "front" | "forward" | "backward" | "back") => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  currentPageStrokeCount: number;
  onClearPageStrokes: () => void;
  ipadPencilOnly: boolean;
  onIpadPencilOnlyChange: (enabled: boolean) => void;
  collapseSignal?: number;
  onExpandedChange?: (expanded: boolean) => void;
}

const COLLAPSED_SIZE = 54;
const EXPANDED_DIAMETER = 212;
const EXPANDED_RADIUS = EXPANDED_DIAMETER / 2;
const ORBIT_RADIUS = 72;
const EDGE_MARGIN = 12;
const IDLE_COLLAPSE_MS = 6500;

function clamp(val: number, min: number, max: number) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, val));
}

export function FloatingRadialToolbar({
  containerRef,
  toolMode,
  onToolModeChange,
  activeShapeKind,
  onActiveShapeKindChange,
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
  strokeOpacity,
  onStrokeOpacityChange,
  shapeFillColor,
  onShapeFillColorChange,
  shapeFillEnabled,
  onShapeFillEnabledChange,
  selectedShape,
  onDuplicateSelectedShape,
  onDeleteSelectedShape,
  onRotateSelectedShape,
  onLayerSelectedShape,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  currentPageStrokeCount,
  onClearPageStrokes,
  ipadPencilOnly,
  onIpadPencilOnlyChange,
  collapseSignal = 0,
  onExpandedChange,
}: FloatingRadialToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const [subPanel, setSubPanel] = useState<ToolbarCategoryTab | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 760, height: 560 });

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

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
  }, [
    scheduleIdleCollapse,
    toolMode,
    activeShapeKind,
    penColor,
    highlighterColor,
    penWidthMm,
    highlighterWidthMm,
    eraserRadiusMm,
    strokeOpacity,
  ]);

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
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore pointer capture error on iOS Safari
    }
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

  const renderShapeIcon = (kind: ShapeKind, sizeClass = "w-4 h-4") => {
    switch (kind) {
      case "rect":
        return <Square className={sizeClass} />;
      case "rounded-rect":
        return <RectangleHorizontal className={sizeClass} />;
      case "ellipse":
        return <Circle className={sizeClass} />;
      case "triangle":
        return <Triangle className={sizeClass} />;
      case "line":
        return <Minus className={sizeClass} />;
      case "arrow":
        return <ArrowUpRight className={sizeClass} />;
    }
  };

  const activeColor =
    toolMode === "highlighter"
      ? highlighterColor
      : toolMode === "pen" || toolMode === "pencil" || toolMode === "shape"
      ? penColor
      : toolMode === "eraser" || toolMode === "object-eraser" || toolMode === "lasso-delete"
      ? "#f43f5e"
      : "#6366f1";

  const renderActiveToolIcon = (sizeClass = "w-5 h-5") => {
    switch (toolMode) {
      case "pen":
        return <PenLine className={sizeClass} />;
      case "highlighter":
        return <Highlighter className={sizeClass} />;
      case "pencil":
        return <Pencil className={sizeClass} />;
      case "eraser":
      case "object-eraser":
        return <Eraser className={sizeClass} />;
      case "lasso-delete":
        return <BoxSelect className={sizeClass} />;
      case "shape":
        return renderShapeIcon(activeShapeKind, sizeClass);
      case "select":
        return <MousePointer2 className={sizeClass} />;
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
      ? "เน้นข้อความ"
      : toolMode === "pencil"
      ? "ดินสอ"
      : toolMode === "eraser"
      ? "ยางลบ"
      : toolMode === "object-eraser"
      ? "ลบวัตถุ"
      : toolMode === "lasso-delete"
      ? "เลือกเพื่อลบ"
      : toolMode === "shape"
      ? `รูปทรง (${SHAPE_LABELS[activeShapeKind]})`
      : toolMode === "select"
      ? "เลือก/ย้ายรูปทรง"
      : toolMode === "pan"
      ? "เลื่อนหน้า"
      : "ย้ายลายเซ็น";

  const isDrawGroupActive =
    toolMode === "pen" || toolMode === "highlighter" || toolMode === "pencil";
  const isEraseGroupActive =
    toolMode === "eraser" ||
    toolMode === "object-eraser" ||
    toolMode === "lasso-delete";
  const isShapeGroupActive = toolMode === "shape";
  const isManageGroupActive = toolMode === "select" || toolMode === "move-sig";

  // 8 ปุ่มรอบวงกลม แบ่งตาม 5 หมวดเครื่องมือหลัก + Undo/Redo + เลื่อนหน้า
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
      id: "cat-draw",
      angleDeg: -90,
      label: "1. เขียน (ปากกา / เน้นข้อความ / ดินสอ)",
      active: isDrawGroupActive || subPanel === "draw",
      accentColor: toolMode === "highlighter" ? highlighterColor : penColor,
      icon:
        toolMode === "highlighter" ? (
          <Highlighter className="w-4 h-4" />
        ) : toolMode === "pencil" ? (
          <Pencil className="w-4 h-4" />
        ) : (
          <PenLine className="w-4 h-4" />
        ),
      onClick: () => {
        if (!isDrawGroupActive) {
          onToolModeChange("pen");
        }
        setSubPanel((cur) => (cur === "draw" ? null : "draw"));
      },
    },
    {
      id: "cat-erase",
      angleDeg: -45,
      label: "2. ลบ (ยางลบ / ลบวัตถุ / เลือกเพื่อลบ)",
      active: isEraseGroupActive || subPanel === "erase",
      accentColor: "#f43f5e",
      icon:
        toolMode === "lasso-delete" ? (
          <BoxSelect className="w-4 h-4" />
        ) : (
          <Eraser className="w-4 h-4" />
        ),
      onClick: () => {
        if (!isEraseGroupActive) {
          onToolModeChange("eraser");
        }
        setSubPanel((cur) => (cur === "erase" ? null : "erase"));
      },
    },
    {
      id: "cat-shapes",
      angleDeg: 0,
      label: "3. รูปทรง (สี่เหลี่ยม / วงกลม / เส้น / ลูกศร / สามเหลี่ยม / มุมมน)",
      active: isShapeGroupActive || subPanel === "shapes",
      accentColor: penColor,
      icon: renderShapeIcon(activeShapeKind, "w-4 h-4"),
      onClick: () => {
        onToolModeChange("shape");
        setSubPanel((cur) => (cur === "shapes" ? null : "shapes"));
      },
    },
    {
      id: "cat-manage",
      angleDeg: 45,
      label: "4. จัดการ (เลือก / ย้าย / ปรับขนาด / หมุน / คัดลอก / ลำดับชั้น)",
      active: isManageGroupActive || subPanel === "manage",
      accentColor: "#3b82f6",
      icon: <MousePointer2 className="w-4 h-4" />,
      onClick: () => {
        if (toolMode !== "select" && toolMode !== "move-sig") {
          onToolModeChange("select");
        }
        setSubPanel((cur) => (cur === "manage" ? null : "manage"));
      },
    },
    {
      id: "cat-customize",
      angleDeg: 90,
      label: "5. ปรับแต่ง (สี / ความหนา / ความโปร่งใส / Undo-Redo)",
      active: subPanel === "customize",
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
        setSubPanel((cur) => (cur === "customize" ? null : "customize"));
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
      id: "pan-sig",
      angleDeg: -135,
      label: toolMode === "pan" ? "สลับเป็นย้ายลายเซ็น" : "เลื่อนกระดาษ / ย้ายลายเซ็น",
      active: toolMode === "pan",
      accentColor: "#f59e0b",
      icon: toolMode === "pan" ? <Hand className="w-4 h-4" /> : <Move className="w-4 h-4" />,
      onClick: () => {
        onToolModeChange(toolMode === "pan" ? "move-sig" : "pan");
        setSubPanel(null);
      },
    },
  ];

  const openPopoverLeft = activeCenterX > containerSize.width * 0.5;
  const openPopoverAbove = activeCenterY > containerSize.height * 0.54;

  const categoryTabs: { id: ToolbarCategoryTab; label: string }[] = [
    { id: "draw", label: "1.เขียน" },
    { id: "erase", label: "2.ลบ" },
    { id: "shapes", label: "3.รูปทรง" },
    { id: "manage", label: "4.จัดการ" },
    { id: "customize", label: "5.ปรับแต่ง" },
  ];

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 overflow-visible"
      aria-label="แถบเครื่องมือปากกาและรูปทรงลอยแบบวงกลม"
    >
      {/* แถบคำสั่งด่วนเมื่อมีรูปทรงถูกเลือกอยู่บนหน้ากระดาษ */}
      {selectedShape && (
        <div className="pointer-events-auto absolute top-2.5 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center gap-1 px-2.5 py-1.5 rounded-2xl bg-slate-900/92 text-white border border-white/20 shadow-xl backdrop-blur-md text-[11px]">
          <span className="font-bold text-sky-300 px-1">
            {SHAPE_LABELS[selectedShape.kind]}
          </span>
          <button
            type="button"
            onClick={onDuplicateSelectedShape}
            title="ทำสำเนารูปทรง (คัดลอก)"
            className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 font-semibold inline-flex items-center gap-1"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>ทำสำเนา</span>
          </button>
          <button
            type="button"
            onClick={() => onRotateSelectedShape(-15)}
            title="หมุนซ้าย 15°"
            className="p-1 rounded-lg bg-white/10 hover:bg-white/20"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onRotateSelectedShape(15)}
            title="หมุนขวา 15°"
            className="p-1 rounded-lg bg-white/10 hover:bg-white/20"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onLayerSelectedShape("front")}
            title="นำไปข้างหน้าสุด"
            className="px-1.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 inline-flex items-center gap-0.5"
          >
            <ArrowUpToLine className="w-3.5 h-3.5" />
            <span>หน้าสุด</span>
          </button>
          <button
            type="button"
            onClick={() => onLayerSelectedShape("back")}
            title="ส่งไปข้างหลังสุด"
            className="px-1.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 inline-flex items-center gap-0.5"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            <span>หลังสุด</span>
          </button>
          <button
            type="button"
            onClick={onDeleteSelectedShape}
            title="ลบรูปทรงนี้"
            className="p-1 rounded-lg bg-rose-500/30 hover:bg-rose-500/50 text-rose-200"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* โหมดยุบเมื่อไม่ได้ใช้งาน: ปุ่มวงกลมเล็ก ๆ ที่ขอบจอ */}
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
          title={`เครื่องมือ (${activeToolLabel}) · แตะเพื่อกางวงกลม หรือลากย้ายตำแหน่ง`}
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
          <span className="sr-only">เปิดเครื่องมือปากกาและรูปทรง</span>
        </button>
      )}

      {/* โหมดขณะใช้งาน: Radial Tool Palette */}
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
          <div className="relative w-full h-full rounded-full bg-slate-800/94 backdrop-blur-xl border border-white/20 shadow-[0_20px_50px_rgba(15,23,42,0.48)] ring-1 ring-slate-950/30">
            {/* ปุ่มศูนย์กลาง: ลากย้ายวงกลม หรือแตะเพื่อยุบ */}
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
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[52px] h-[52px] rounded-full bg-slate-700/95 hover:bg-slate-600 text-white border border-white/25 shadow-inner flex flex-col items-center justify-center gap-0.5 transition-transform ${
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

            <div className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-slate-900/85 text-[10px] font-bold text-slate-100 whitespace-nowrap shadow-xs border border-white/15">
              {activeToolLabel} · แตะตรงกลางเพื่อยุบ
            </div>
          </div>

          {/* แผงเครื่องมือย่อยแบ่งตาม 5 หมวด (เขียน / ลบ / รูปทรง / จัดการ / ปรับแต่ง) */}
          {subPanel !== null && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                ...(openPopoverLeft ? { right: "calc(100% + 10px)" } : { left: "calc(100% + 10px)" }),
                ...(openPopoverAbove ? { bottom: "0px" } : { top: "0px" }),
              }}
              className="absolute w-72 rounded-2xl bg-slate-900/96 backdrop-blur-xl text-white border border-white/20 p-3 shadow-2xl space-y-2.5 z-40"
            >
              {/* แถบสลับ 5 หมวดเครื่องมือ */}
              <div className="flex items-center justify-between gap-1 border-b border-white/10 pb-2">
                <div className="grid grid-cols-5 gap-1 flex-1">
                  {categoryTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSubPanel(tab.id)}
                      className={`py-1 px-1 rounded-lg text-[10px] font-bold transition-colors ${
                        subPanel === tab.id
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "bg-white/5 text-slate-300 hover:bg-white/15"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setSubPanel(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* หมวดที่ 1: เขียน (ปากกา, ปากกาเน้นข้อความ, ดินสอ) */}
              {subPanel === "draw" && (
                <div className="space-y-2.5">
                  <div className="text-[11px] font-bold text-slate-200">
                    หมวด 1 · เครื่องมือเขียน
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      {
                        mode: "pen" as const,
                        label: "ปากกา",
                        desc: "เส้นคมชัดตามแรงกด",
                        icon: <PenLine className="w-4 h-4" />,
                      },
                      {
                        mode: "highlighter" as const,
                        label: "เน้นข้อความ",
                        desc: "ไฮไลต์โปร่งแสง",
                        icon: <Highlighter className="w-4 h-4" />,
                      },
                      {
                        mode: "pencil" as const,
                        label: "ดินสอ",
                        desc: "เส้นร่างนุ่มนวล",
                        icon: <Pencil className="w-4 h-4" />,
                      },
                    ].map((item) => (
                      <button
                        key={item.mode}
                        type="button"
                        onClick={() => onToolModeChange(item.mode)}
                        className={`p-2 rounded-xl border text-left flex flex-col items-center gap-1 transition-all ${
                          toolMode === item.mode
                            ? "border-indigo-400 bg-indigo-500/25 text-white shadow-xs"
                            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        {item.icon}
                        <span className="text-[11px] font-bold">{item.label}</span>
                        <span className="text-[9px] text-slate-400 text-center leading-tight">
                          {item.desc}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* เลือกสีด่วนในหมวดเขียน */}
                  <div className="space-y-1 pt-1 border-t border-white/10">
                    <div className="text-[10px] font-semibold text-slate-400">
                      {toolMode === "highlighter" ? "สีปากกาเน้นข้อความ:" : "สีหมึกปากกา / ดินสอ:"}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(toolMode === "highlighter"
                        ? HIGHLIGHTER_COLOR_PRESETS
                        : PEN_COLOR_PRESETS
                      ).map((c) => {
                        const curColor =
                          toolMode === "highlighter" ? highlighterColor : penColor;
                        return (
                          <button
                            key={c.color}
                            type="button"
                            onClick={() => {
                              if (toolMode === "highlighter") {
                                onHighlighterColorChange(c.color);
                              } else {
                                onPenColorChange(c.color);
                              }
                            }}
                            className={`w-6 h-6 rounded-full border-2 transition-transform ${
                              curColor === c.color
                                ? "border-white scale-115 ring-2 ring-indigo-400"
                                : "border-white/30 hover:scale-105"
                            }`}
                            style={{ backgroundColor: c.color }}
                            title={c.label}
                          />
                        );
                      })}
                    </div>
                  </div>

                  <label className="flex items-start gap-2 text-[10px] leading-snug text-slate-200 bg-white/5 p-2 rounded-xl border border-white/10 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ipadPencilOnly}
                      onChange={(e) => onIpadPencilOnlyChange(e.target.checked)}
                      className="accent-indigo-400 mt-0.5 shrink-0"
                    />
                    <span>โหมดปากกา iPad (ใช้ Apple Pencil เขียน / ใช้นิ้วเลื่อนหน้า)</span>
                  </label>
                </div>
              )}

              {/* หมวดที่ 2: ลบ (ยางลบ, ลบวัตถุ, เลือกเพื่อลบ) */}
              {subPanel === "erase" && (
                <div className="space-y-2.5">
                  <div className="text-[11px] font-bold text-slate-200">
                    หมวด 2 · เครื่องมือลบ
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      {
                        mode: "eraser" as const,
                        label: "ยางลบ",
                        desc: "ถูผ่านเพื่อลบเส้น",
                        icon: <Eraser className="w-4 h-4" />,
                      },
                      {
                        mode: "object-eraser" as const,
                        label: "ลบวัตถุ",
                        desc: "แตะลบเส้น/รูปทรง",
                        icon: <Layers className="w-4 h-4" />,
                      },
                      {
                        mode: "lasso-delete" as const,
                        label: "เลือกเพื่อลบ",
                        desc: "ลากกรอบคลุมลบ",
                        icon: <BoxSelect className="w-4 h-4" />,
                      },
                    ].map((item) => (
                      <button
                        key={item.mode}
                        type="button"
                        onClick={() => onToolModeChange(item.mode)}
                        className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                          toolMode === item.mode
                            ? "border-rose-400 bg-rose-500/25 text-white shadow-xs"
                            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        {item.icon}
                        <span className="text-[11px] font-bold">{item.label}</span>
                        <span className="text-[9px] text-slate-400 text-center leading-tight">
                          {item.desc}
                        </span>
                      </button>
                    ))}
                  </div>

                  {toolMode !== "lasso-delete" && (
                    <div className="space-y-1 pt-1 border-t border-white/10">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>ขนาดหัวลบ</span>
                        <span>{eraserRadiusMm.toFixed(1)} มม.</span>
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
                  )}

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
                    <span>ล้างลายเส้นและรูปทรงหน้านี้ ({currentPageStrokeCount})</span>
                  </button>
                </div>
              )}

              {/* หมวดที่ 3: รูปทรง (สี่เหลี่ยม, วงกลม, เส้นตรง, สามเหลี่ยม, ลูกศร, สี่เหลี่ยมมุมมน) */}
              {subPanel === "shapes" && (
                <div className="space-y-2.5">
                  <div className="text-[11px] font-bold text-slate-200">
                    หมวด 3 · วาดรูปทรง (ลากบนหน้า PDF เพื่อสร้าง)
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { kind: "rect", label: "สี่เหลี่ยม" },
                        { kind: "ellipse", label: "วงกลม" },
                        { kind: "line", label: "เส้นตรง" },
                        { kind: "triangle", label: "สามเหลี่ยม" },
                        { kind: "arrow", label: "ลูกศร" },
                        { kind: "rounded-rect", label: "สี่เหลี่ยมมุมมน" },
                      ] as { kind: ShapeKind; label: string }[]
                    ).map((s) => (
                      <button
                        key={s.kind}
                        type="button"
                        onClick={() => {
                          onActiveShapeKindChange(s.kind);
                          onToolModeChange("shape");
                        }}
                        className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                          toolMode === "shape" && activeShapeKind === s.kind
                            ? "border-amber-400 bg-amber-500/25 text-white shadow-xs"
                            : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        {renderShapeIcon(s.kind, "w-4 h-4")}
                        <span className="text-[10px] font-bold text-center leading-tight">
                          {s.label}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* สีเส้นและสีพื้นสำหรับรูปทรง */}
                  <div className="space-y-1.5 pt-1 border-t border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-slate-400">
                        สีเส้นรูปทรง:
                      </span>
                      <div className="flex items-center gap-1">
                        {PEN_COLOR_PRESETS.map((c) => (
                          <button
                            key={c.color}
                            type="button"
                            onClick={() => onPenColorChange(c.color)}
                            className={`w-5 h-5 rounded-full border ${
                              penColor === c.color
                                ? "border-white scale-110 ring-2 ring-amber-400"
                                : "border-white/30"
                            }`}
                            style={{ backgroundColor: c.color }}
                            title={c.label}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <label className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={shapeFillEnabled}
                          onChange={(e) => onShapeFillEnabledChange(e.target.checked)}
                          className="accent-amber-400"
                        />
                        <span>เติมสีพื้นรูปทรง</span>
                      </label>
                      {shapeFillEnabled && (
                        <div className="flex items-center gap-1">
                          {SHAPE_FILL_PRESETS.map((c) => (
                            <button
                              key={c.color}
                              type="button"
                              onClick={() => onShapeFillColorChange(c.color)}
                              className={`w-5 h-5 rounded-full border ${
                                shapeFillColor === c.color
                                  ? "border-white scale-110 ring-2 ring-amber-400"
                                  : "border-white/30"
                              }`}
                              style={{ backgroundColor: c.color }}
                              title={c.label}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* หมวดที่ 4: จัดการ (เลือก, ย้าย, ปรับขนาด, หมุน, คัดลอก, จัดลำดับชั้น) */}
              {subPanel === "manage" && (
                <div className="space-y-2.5">
                  <div className="text-[11px] font-bold text-slate-200">
                    หมวด 4 · จัดการวัตถุและรูปทรง
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onToolModeChange("select")}
                      className={`p-2 rounded-xl border flex flex-col items-center gap-1 text-[10px] font-bold ${
                        toolMode === "select"
                          ? "border-sky-400 bg-sky-500/25 text-white"
                          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      <MousePointer2 className="w-4 h-4" />
                      <span>เลือก/ย้ายรูปทรง</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToolModeChange("move-sig")}
                      className={`p-2 rounded-xl border flex flex-col items-center gap-1 text-[10px] font-bold ${
                        toolMode === "move-sig"
                          ? "border-indigo-400 bg-indigo-500/25 text-white"
                          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      <Move className="w-4 h-4" />
                      <span>ย้ายลายเซ็น</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToolModeChange("pan")}
                      className={`p-2 rounded-xl border flex flex-col items-center gap-1 text-[10px] font-bold ${
                        toolMode === "pan"
                          ? "border-amber-400 bg-amber-500/25 text-white"
                          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      <Hand className="w-4 h-4" />
                      <span>เลื่อนหน้า</span>
                    </button>
                  </div>

                  {selectedShape ? (
                    <div className="space-y-2 pt-1.5 border-t border-white/10">
                      <div className="flex items-center justify-between text-[10px] text-sky-300 font-bold">
                        <span>กำลังเลือก: {SHAPE_LABELS[selectedShape.kind]}</span>
                        <span>หมุน/ย่อขยายที่จุดรอบรูปได้</span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={onDuplicateSelectedShape}
                          className="py-1.5 px-2 rounded-xl bg-white/10 hover:bg-white/20 text-[11px] font-bold flex items-center justify-center gap-1"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>ทำสำเนา (คัดลอก)</span>
                        </button>
                        <button
                          type="button"
                          onClick={onDeleteSelectedShape}
                          className="py-1.5 px-2 rounded-xl bg-rose-500/25 hover:bg-rose-500/40 text-rose-200 text-[11px] font-bold flex items-center justify-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>ลบรูปทรงนี้</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => onRotateSelectedShape(-45)}
                          className="py-1.5 px-2 rounded-xl bg-white/5 hover:bg-white/15 text-[10px] font-semibold flex items-center justify-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>หมุนซ้าย 45°</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRotateSelectedShape(45)}
                          className="py-1.5 px-2 rounded-xl bg-white/5 hover:bg-white/15 text-[10px] font-semibold flex items-center justify-center gap-1"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                          <span>หมุนขวา 45°</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => onLayerSelectedShape("front")}
                          className="py-1.5 px-2 rounded-xl bg-white/5 hover:bg-white/15 text-[10px] font-semibold flex items-center justify-center gap-1"
                        >
                          <ArrowUpToLine className="w-3.5 h-3.5" />
                          <span>นำไปข้างหน้า</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onLayerSelectedShape("back")}
                          className="py-1.5 px-2 rounded-xl bg-white/5 hover:bg-white/15 text-[10px] font-semibold flex items-center justify-center gap-1"
                        >
                          <ArrowDownToLine className="w-3.5 h-3.5" />
                          <span>ส่งไปข้างหลัง</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] text-slate-400 bg-white/5 p-2 rounded-xl border border-white/10 leading-relaxed">
                      💡 แตะที่รูปทรงบนหน้า PDF เพื่อเลือก จากนั้นลากย้าย ดึงจุดสีขาว 8 ทิศเพื่อปรับขนาด ดึงจุดสีเขียวด้านบนเพื่อหมุน หรือกดทำสำเนาและจัดลำดับชั้นได้ทันที
                    </div>
                  )}
                </div>
              )}

              {/* หมวดที่ 5: ปรับแต่ง (สี, ความหนา, ความโปร่งใส, Undo / Redo) */}
              {subPanel === "customize" && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-200">
                      หมวด 5 · สี ความหนา ความโปร่งใส
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!canUndo}
                        onClick={onUndo}
                        title="ย้อนกลับ (Undo)"
                        className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-35 text-[10px] font-bold inline-flex items-center gap-1"
                      >
                        <Undo2 className="w-3 h-3" />
                        <span>Undo</span>
                      </button>
                      <button
                        type="button"
                        disabled={!canRedo}
                        onClick={onRedo}
                        title="ทำซ้ำ (Redo)"
                        className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-35 text-[10px] font-bold inline-flex items-center gap-1"
                      >
                        <Redo2 className="w-3 h-3" />
                        <span>Redo</span>
                      </button>
                    </div>
                  </div>

                  {/* สีเส้น (ปากกา / ดินสอ / รูปทรง) */}
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold text-slate-400">
                      สีเส้น (ปากกา / ดินสอ / ขอบรูปทรง)
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {PEN_COLOR_PRESETS.map((c) => (
                        <button
                          key={c.color}
                          type="button"
                          onClick={() => onPenColorChange(c.color)}
                          className={`w-6 h-6 rounded-full border-2 transition-transform ${
                            penColor === c.color
                              ? "border-white scale-110 ring-2 ring-indigo-400"
                              : "border-white/30 hover:scale-105"
                          }`}
                          style={{ backgroundColor: c.color }}
                          title={c.label}
                        />
                      ))}
                      <label
                        title="เลือกสีเส้นเอง"
                        className="w-6 h-6 rounded-full border border-white/40 overflow-hidden cursor-pointer flex items-center justify-center bg-gradient-to-tr from-rose-500 via-amber-400 to-cyan-400"
                      >
                        <input
                          type="color"
                          value={penColor}
                          onChange={(e) => onPenColorChange(e.target.value)}
                          className="opacity-0 w-full h-full cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>

                  {/* สีพื้นรูปทรง */}
                  <div className="space-y-1 pt-1 border-t border-white/10">
                    <div className="flex items-center justify-between">
                      <label className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={shapeFillEnabled}
                          onChange={(e) => onShapeFillEnabledChange(e.target.checked)}
                          className="accent-indigo-400"
                        />
                        <span>สีพื้นรูปทรง (Fill)</span>
                      </label>
                      <span className="text-[9px] text-slate-400">
                        {shapeFillEnabled ? "เปิดสีพื้น" : "โปร่งใส (ไม่มีสีพื้น)"}
                      </span>
                    </div>
                    {shapeFillEnabled && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {SHAPE_FILL_PRESETS.map((c) => (
                          <button
                            key={c.color}
                            type="button"
                            onClick={() => onShapeFillColorChange(c.color)}
                            className={`w-5 h-5 rounded-full border-2 ${
                              shapeFillColor === c.color
                                ? "border-white scale-110 ring-2 ring-amber-400"
                                : "border-white/30"
                            }`}
                            style={{ backgroundColor: c.color }}
                            title={c.label}
                          />
                        ))}
                        <label
                          title="เลือกสีพื้นเอง"
                          className="w-5 h-5 rounded-full border border-white/40 overflow-hidden cursor-pointer flex items-center justify-center bg-gradient-to-tr from-yellow-300 via-pink-400 to-emerald-400"
                        >
                          <input
                            type="color"
                            value={shapeFillColor}
                            onChange={(e) => onShapeFillColorChange(e.target.value)}
                            className="opacity-0 w-full h-full cursor-pointer"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  {/* ความหนาของเส้น */}
                  <div className="space-y-1 pt-1 border-t border-white/10">
                    <div className="flex justify-between text-[10px] text-slate-300">
                      <span className="inline-flex items-center gap-1">
                        <SlidersHorizontal className="w-3 h-3" />
                        <span>ความหนาเส้น</span>
                      </span>
                      <span>
                        {toolMode === "highlighter"
                          ? `${highlighterWidthMm.toFixed(1)} มม.`
                          : `${penWidthMm.toFixed(2)} มม.`}
                      </span>
                    </div>
                    {toolMode === "highlighter" ? (
                      <input
                        type="range"
                        min={3}
                        max={13}
                        step={0.5}
                        value={highlighterWidthMm}
                        onChange={(e) => onHighlighterWidthChange(Number(e.target.value))}
                        className="w-full accent-amber-400"
                      />
                    ) : (
                      <input
                        type="range"
                        min={0.3}
                        max={2.4}
                        step={0.05}
                        value={penWidthMm}
                        onChange={(e) => onPenWidthChange(Number(e.target.value))}
                        className="w-full accent-indigo-400"
                      />
                    )}
                  </div>

                  {/* ความโปร่งใส (Opacity) */}
                  <div className="space-y-1 pt-1 border-t border-white/10">
                    <div className="flex justify-between text-[10px] text-slate-300">
                      <span className="inline-flex items-center gap-1">
                        <Droplet className="w-3 h-3" />
                        <span>ความโปร่งใส (ความทึบแสง)</span>
                      </span>
                      <span>{Math.round(strokeOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={1}
                      step={0.05}
                      value={strokeOpacity}
                      onChange={(e) => onStrokeOpacityChange(Number(e.target.value))}
                      className="w-full accent-sky-400"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
