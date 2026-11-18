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
  Type,
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
  shapeStrokeEnabled: boolean;
  onShapeStrokeEnabledChange: (enabled: boolean) => void;
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
  onAddTextBox?: () => void;
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
  shapeStrokeEnabled,
  onShapeStrokeEnabledChange,
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
  onAddTextBox,
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
        <div
          style={{ backgroundColor: "#0f172a" }}
          className="pointer-events-auto absolute top-2.5 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-slate-900 text-white border-2 border-slate-700 shadow-2xl text-[11px]"
        >
          <span className="font-extrabold text-amber-300 px-1.5 py-0.5 rounded-md bg-slate-800 border border-slate-600">
            {SHAPE_LABELS[selectedShape.kind]}
          </span>
          <button
            type="button"
            onClick={onDuplicateSelectedShape}
            title="ทำสำเนารูปทรง (คัดลอก)"
            className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold inline-flex items-center gap-1 shadow-xs"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>ทำสำเนา</span>
          </button>
          <button
            type="button"
            onClick={() => onRotateSelectedShape(-15)}
            title="หมุนซ้าย 15°"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-600"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onRotateSelectedShape(15)}
            title="หมุนขวา 15°"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-600"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onLayerSelectedShape("front")}
            title="นำไปข้างหน้าสุด"
            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 font-bold inline-flex items-center gap-1"
          >
            <ArrowUpToLine className="w-3.5 h-3.5 text-sky-300" />
            <span>หน้าสุด</span>
          </button>
          <button
            type="button"
            onClick={() => onLayerSelectedShape("back")}
            title="ส่งไปข้างหลังสุด"
            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 font-bold inline-flex items-center gap-1"
          >
            <ArrowDownToLine className="w-3.5 h-3.5 text-amber-300" />
            <span>หลังสุด</span>
          </button>
          <button
            type="button"
            onClick={onDeleteSelectedShape}
            title="ลบรูปทรงนี้"
            className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold inline-flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>ลบ</span>
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
            backgroundColor: "#0f172a",
          }}
          className={`pointer-events-auto absolute rounded-full bg-slate-900 hover:bg-slate-800 text-white border-2 border-slate-600 shadow-2xl flex items-center justify-center touch-none select-none transition-transform duration-150 ${
            isDragging ? "scale-110 cursor-grabbing ring-4 ring-indigo-400/50" : "hover:scale-105 cursor-pointer"
          }`}
        >
          {renderActiveToolIcon("w-5 h-5")}
          <span
            className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 shadow-xs"
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
          <div
            style={{ backgroundColor: "#0f172a" }}
            className="relative w-full h-full rounded-full bg-slate-900 border-2 border-slate-600 shadow-2xl"
          >
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
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[52px] h-[52px] rounded-full bg-indigo-600 hover:bg-indigo-500 text-white border-2 border-white/80 shadow-md flex flex-col items-center justify-center gap-0.5 transition-transform ${
                isDragging ? "cursor-grabbing scale-95 ring-4 ring-indigo-300" : "cursor-grab"
              }`}
            >
              <div className="flex items-center gap-1">
                {renderActiveToolIcon("w-4 h-4")}
              </div>
              <GripHorizontal className="w-3.5 h-3.5 text-indigo-100" />
              <span
                className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900"
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
                  className={`absolute w-10 h-10 rounded-full flex items-center justify-center transition-all border ${
                    item.disabled
                      ? "text-slate-500 bg-slate-800 border-slate-700 cursor-not-allowed opacity-45"
                      : item.active
                      ? "bg-amber-400 text-slate-950 border-white font-bold shadow-lg scale-110"
                      : "bg-slate-800 hover:bg-slate-700 text-white border-slate-600 hover:scale-105"
                  }`}
                >
                  {item.icon}
                </button>
              );
            })}

            <div
              style={{ backgroundColor: "#0f172a" }}
              className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-900 text-[11px] font-bold text-white whitespace-nowrap shadow-lg border border-slate-600"
            >
              {activeToolLabel} · แตะตรงกลางเพื่อยุบ
            </div>
          </div>

          {/* แผงเครื่องมือย่อยแบ่งตาม 5 หมวด (พื้นขาว ตัวอักษรเข้มคมชัด อ่านง่าย 100%) */}
          {subPanel !== null && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                backgroundColor: "#ffffff",
                ...(openPopoverLeft ? { right: "calc(100% + 12px)" } : { left: "calc(100% + 12px)" }),
                ...(openPopoverAbove ? { bottom: "0px" } : { top: "0px" }),
              }}
              className="absolute w-80 rounded-2xl bg-white text-slate-900 border-2 border-slate-300 p-3.5 shadow-2xl space-y-3 z-40"
            >
              {/* แถบสลับ 5 หมวดเครื่องมือ */}
              <div className="flex items-center justify-between gap-1 border-b border-slate-200 pb-2">
                <div className="grid grid-cols-5 gap-1 flex-1">
                  {categoryTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSubPanel(tab.id)}
                      className={`py-1.5 px-1 rounded-lg text-[10px] font-extrabold whitespace-nowrap transition-colors border ${
                        subPanel === tab.id
                          ? "bg-indigo-600 text-white border-indigo-700 shadow-xs"
                          : "bg-slate-100 text-slate-800 border-slate-200 hover:bg-indigo-50 hover:text-indigo-700"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setSubPanel(null)}
                  className="p-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 shrink-0"
                  title="ปิดหน้าต่างย่อย"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* หมวดที่ 1: เขียน (ปากกา, ปากกาเน้นข้อความ, ดินสอ) */}
              {subPanel === "draw" && (
                <div className="space-y-2.5">
                  <div className="text-xs font-extrabold text-slate-900">
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
                    ].map((item) => {
                      const isActive = toolMode === item.mode;
                      return (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => onToolModeChange(item.mode)}
                          className={`p-2 rounded-xl border-2 text-left flex flex-col items-center gap-1 transition-all ${
                            isActive
                              ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                              : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-indigo-50 hover:border-indigo-300"
                          }`}
                        >
                          {item.icon}
                          <span className="text-[11px] font-extrabold">{item.label}</span>
                          <span
                            className={`text-[9px] text-center leading-tight font-medium ${
                              isActive ? "text-indigo-100" : "text-slate-600"
                            }`}
                          >
                            {item.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* เลือกสีด่วนในหมวดเขียน */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-200">
                    <div className="text-[11px] font-bold text-slate-800">
                      {toolMode === "highlighter" ? "สีปากกาเน้นข้อความ:" : "สีหมึกปากกา / ดินสอ:"}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
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
                                ? "border-slate-900 scale-110 ring-2 ring-offset-1 ring-indigo-600"
                                : "border-slate-300 hover:scale-105"
                            }`}
                            style={{ backgroundColor: c.color }}
                            title={c.label}
                          />
                        );
                      })}
                    </div>
                  </div>

                  <label className="flex items-start gap-2 text-[11px] font-semibold leading-snug text-indigo-950 bg-indigo-50 p-2.5 rounded-xl border border-indigo-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ipadPencilOnly}
                      onChange={(e) => onIpadPencilOnlyChange(e.target.checked)}
                      className="accent-indigo-600 mt-0.5 shrink-0"
                    />
                    <span>โหมดปากกา iPad (ใช้ Apple Pencil เขียน / ใช้นิ้วเลื่อนหน้า)</span>
                  </label>
                </div>
              )}

              {/* หมวดที่ 2: ลบ (ยางลบ, ลบวัตถุ, เลือกเพื่อลบ) */}
              {subPanel === "erase" && (
                <div className="space-y-2.5">
                  <div className="text-xs font-extrabold text-slate-900">
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
                    ].map((item) => {
                      const isActive = toolMode === item.mode;
                      return (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => onToolModeChange(item.mode)}
                          className={`p-2 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${
                            isActive
                              ? "border-rose-600 bg-rose-600 text-white shadow-sm"
                              : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-rose-50 hover:border-rose-300"
                          }`}
                        >
                          {item.icon}
                          <span className="text-[11px] font-extrabold">{item.label}</span>
                          <span
                            className={`text-[9px] text-center leading-tight font-medium ${
                              isActive ? "text-rose-100" : "text-slate-600"
                            }`}
                          >
                            {item.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {toolMode !== "lasso-delete" && (
                    <div className="space-y-1 pt-2 border-t border-slate-200">
                      <div className="flex justify-between items-center text-[11px] font-bold text-slate-800">
                        <span>ขนาดหัวลบ</span>
                        <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                          {eraserRadiusMm.toFixed(1)} มม.
                        </span>
                      </div>
                      <input
                        type="range"
                        min={3}
                        max={15}
                        step={0.5}
                        value={eraserRadiusMm}
                        onChange={(e) => onEraserRadiusChange(Number(e.target.value))}
                        className="w-full accent-rose-600"
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
                    className="w-full py-2 px-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 disabled:bg-slate-200 disabled:text-slate-500 shadow-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>ล้างลายเส้นและรูปทรงหน้านี้ ({currentPageStrokeCount})</span>
                  </button>
                </div>
              )}

              {/* หมวดที่ 3: รูปทรง (สี่เหลี่ยม, วงกลม, เส้นตรง, สามเหลี่ยม, ลูกศร, สี่เหลี่ยมมุมมน) */}
              {subPanel === "shapes" && (
                <div className="space-y-2.5">
                  <div className="text-xs font-extrabold text-slate-900">
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
                    ).map((s) => {
                      const isActive = toolMode === "shape" && activeShapeKind === s.kind;
                      return (
                        <button
                          key={s.kind}
                          type="button"
                          onClick={() => {
                            onActiveShapeKindChange(s.kind);
                            onToolModeChange("shape");
                          }}
                          className={`p-2 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${
                            isActive
                              ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                              : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-indigo-50 hover:border-indigo-300"
                          }`}
                        >
                          {renderShapeIcon(s.kind, "w-4 h-4")}
                          <span className="text-[10px] font-extrabold text-center leading-tight">
                            {s.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* สีเส้นและสีพื้นสำหรับรูปทรง */}
                  <div className="space-y-2 pt-2 border-t border-slate-200">
                    <div className="flex items-center justify-between gap-1.5">
                      <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-800 cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={shapeStrokeEnabled}
                          onChange={(e) => onShapeStrokeEnabledChange(e.target.checked)}
                          className="accent-indigo-600 w-3.5 h-3.5"
                        />
                        <span>สีเส้นรูปทรง:</span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onShapeStrokeEnabledChange(false)}
                          className={`relative w-5 h-5 rounded-full border-2 bg-white overflow-hidden flex items-center justify-center ${
                            !shapeStrokeEnabled
                              ? "border-rose-600 scale-110 ring-2 ring-offset-1 ring-rose-500"
                              : "border-slate-300 hover:border-rose-400"
                          }`}
                          title="ไม่เอาสีเส้น (ไม่มีเส้นขอบ)"
                        >
                          <span className="block w-6 h-0.5 bg-rose-600 -rotate-45" />
                        </button>
                        {PEN_COLOR_PRESETS.map((c) => (
                          <button
                            key={c.color}
                            type="button"
                            onClick={() => {
                              onShapeStrokeEnabledChange(true);
                              onPenColorChange(c.color);
                            }}
                            className={`w-5 h-5 rounded-full border-2 ${
                              shapeStrokeEnabled && penColor === c.color
                                ? "border-slate-900 scale-110 ring-2 ring-offset-1 ring-indigo-600"
                                : "border-slate-300"
                            } ${!shapeStrokeEnabled ? "opacity-55" : ""}`}
                            style={{ backgroundColor: c.color }}
                            title={c.label}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-1.5 pt-1">
                      <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-800 cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={shapeFillEnabled}
                          onChange={(e) => onShapeFillEnabledChange(e.target.checked)}
                          className="accent-indigo-600 w-3.5 h-3.5"
                        />
                        <span>เติมสีพื้นรูปทรง</span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onShapeFillEnabledChange(false)}
                          className={`relative w-5 h-5 rounded-full border-2 bg-white overflow-hidden flex items-center justify-center ${
                            !shapeFillEnabled
                              ? "border-rose-600 scale-110 ring-2 ring-offset-1 ring-rose-500"
                              : "border-slate-300 hover:border-rose-400"
                          }`}
                          title="ไม่เอาสีพื้น (โปร่งใส)"
                        >
                          <span className="block w-6 h-0.5 bg-rose-600 -rotate-45" />
                        </button>
                        {SHAPE_FILL_PRESETS.map((c) => (
                          <button
                            key={c.color}
                            type="button"
                            onClick={() => onShapeFillColorChange(c.color)}
                            className={`w-5 h-5 rounded-full border-2 ${
                              shapeFillEnabled && shapeFillColor === c.color
                                ? "border-slate-900 scale-110 ring-2 ring-offset-1 ring-indigo-600"
                                : "border-slate-400"
                            } ${!shapeFillEnabled ? "opacity-55" : ""}`}
                            style={{ backgroundColor: c.color }}
                            title={c.label}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* หมวดที่ 4: จัดการ (เลือก, ย้าย, ปรับขนาด, หมุน, คัดลอก, จัดลำดับชั้น) */}
              {subPanel === "manage" && (
                <div className="space-y-2.5">
                  <div className="text-xs font-extrabold text-slate-900">
                    หมวด 4 · จัดการวัตถุและรูปทรง
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onToolModeChange("select")}
                      className={`p-2 rounded-xl border-2 flex flex-col items-center gap-1 text-[10px] font-extrabold ${
                        toolMode === "select"
                          ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                          : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-indigo-50"
                      }`}
                    >
                      <MousePointer2 className="w-4 h-4" />
                      <span>เลือก/ย้ายรูปทรง</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToolModeChange("move-sig")}
                      className={`p-2 rounded-xl border-2 flex flex-col items-center gap-1 text-[10px] font-extrabold ${
                        toolMode === "move-sig"
                          ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                          : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-indigo-50"
                      }`}
                    >
                      <Move className="w-4 h-4" />
                      <span>ย้ายลายเซ็น/ข้อความ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToolModeChange("pan")}
                      className={`p-2 rounded-xl border-2 flex flex-col items-center gap-1 text-[10px] font-extrabold ${
                        toolMode === "pan"
                          ? "border-amber-600 bg-amber-600 text-white shadow-sm"
                          : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-amber-50"
                      }`}
                    >
                      <Hand className="w-4 h-4" />
                      <span>เลื่อนหน้า</span>
                    </button>
                  </div>

                  {onAddTextBox && (
                    <button
                      type="button"
                      onClick={onAddTextBox}
                      className="w-full py-1.5 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold flex items-center justify-center gap-1.5 shadow-xs"
                    >
                      <Type className="w-3.5 h-3.5" />
                      <span>+ วางกล่องข้อความความเห็นบนหน้านี้</span>
                    </button>
                  )}

                  {selectedShape ? (
                    <div className="space-y-2 pt-2 border-t border-slate-200">
                      <div className="flex items-center justify-between text-[11px] text-indigo-800 bg-indigo-50 px-2.5 py-1.5 rounded-lg border border-indigo-200 font-bold">
                        <span>กำลังเลือก: {SHAPE_LABELS[selectedShape.kind]}</span>
                        <span className="text-[10px] text-indigo-600">ดึงจุดรอบรูปเพื่อย่อ/หมุน</span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={onDuplicateSelectedShape}
                          className="py-1.5 px-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold flex items-center justify-center gap-1 shadow-xs"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>ทำสำเนา (คัดลอก)</span>
                        </button>
                        <button
                          type="button"
                          onClick={onDeleteSelectedShape}
                          className="py-1.5 px-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold flex items-center justify-center gap-1 shadow-xs"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>ลบรูปทรงนี้</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => onRotateSelectedShape(-45)}
                          className="py-1.5 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-[11px] font-bold flex items-center justify-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>หมุนซ้าย 45°</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRotateSelectedShape(45)}
                          className="py-1.5 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-[11px] font-bold flex items-center justify-center gap-1"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                          <span>หมุนขวา 45°</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => onLayerSelectedShape("front")}
                          className="py-1.5 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-[11px] font-bold flex items-center justify-center gap-1"
                        >
                          <ArrowUpToLine className="w-3.5 h-3.5 text-indigo-600" />
                          <span>นำไปข้างหน้า</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onLayerSelectedShape("back")}
                          className="py-1.5 px-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 text-[11px] font-bold flex items-center justify-center gap-1"
                        >
                          <ArrowDownToLine className="w-3.5 h-3.5 text-amber-600" />
                          <span>ส่งไปข้างหลัง</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] font-medium text-slate-700 bg-slate-100 p-2.5 rounded-xl border border-slate-200 leading-relaxed">
                      💡 แตะที่รูปทรงบนหน้า PDF เพื่อเลือก จากนั้นลากย้าย ดึงจุดสีขาว 8 ทิศเพื่อปรับขนาด ดึงจุดสีเขียวด้านบนเพื่อหมุน หรือกดทำสำเนาและจัดลำดับชั้นได้ทันที
                    </div>
                  )}
                </div>
              )}

              {/* หมวดที่ 5: ปรับแต่ง (สี, ความหนา, ความโปร่งใส, Undo / Redo) */}
              {subPanel === "customize" && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-slate-900">
                      หมวด 5 · สี ความหนา ความโปร่งใส
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!canUndo}
                        onClick={onUndo}
                        title="ย้อนกลับ (Undo)"
                        className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-800 hover:text-indigo-700 border border-slate-300 disabled:opacity-40 text-[10px] font-extrabold inline-flex items-center gap-1"
                      >
                        <Undo2 className="w-3 h-3" />
                        <span>Undo</span>
                      </button>
                      <button
                        type="button"
                        disabled={!canRedo}
                        onClick={onRedo}
                        title="ทำซ้ำ (Redo)"
                        className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-800 hover:text-indigo-700 border border-slate-300 disabled:opacity-40 text-[10px] font-extrabold inline-flex items-center gap-1"
                      >
                        <Redo2 className="w-3 h-3" />
                        <span>Redo</span>
                      </button>
                    </div>
                  </div>

                  {/* สีเส้น (ปากกา / ดินสอ / รูปทรง) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={shapeStrokeEnabled}
                          onChange={(e) => onShapeStrokeEnabledChange(e.target.checked)}
                          className="accent-indigo-600 w-3.5 h-3.5"
                        />
                        <span>สีเส้น (ปากกา / ดินสอ / ขอบรูปทรง)</span>
                      </label>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          shapeStrokeEnabled
                            ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                            : "bg-rose-50 text-rose-700 border border-rose-200"
                        }`}
                      >
                        {shapeStrokeEnabled ? "มีเส้นขอบ" : "ไม่เอาสีเส้น"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => onShapeStrokeEnabledChange(false)}
                        className={`relative w-6 h-6 rounded-full border-2 bg-white overflow-hidden flex items-center justify-center transition-transform ${
                          !shapeStrokeEnabled
                            ? "border-rose-600 scale-110 ring-2 ring-offset-1 ring-rose-500"
                            : "border-slate-300 hover:scale-105 hover:border-rose-400"
                        }`}
                        title="ไม่เอาสีเส้น (ไม่มีเส้นขอบรูปทรง)"
                      >
                        <span className="block w-7 h-0.5 bg-rose-600 -rotate-45" />
                      </button>
                      {PEN_COLOR_PRESETS.map((c) => (
                        <button
                          key={c.color}
                          type="button"
                          onClick={() => {
                            onShapeStrokeEnabledChange(true);
                            onPenColorChange(c.color);
                          }}
                          className={`w-6 h-6 rounded-full border-2 transition-transform ${
                            shapeStrokeEnabled && penColor === c.color
                              ? "border-slate-900 scale-110 ring-2 ring-offset-1 ring-indigo-600"
                              : "border-slate-300 hover:scale-105"
                          } ${!shapeStrokeEnabled ? "opacity-55" : ""}`}
                          style={{ backgroundColor: c.color }}
                          title={c.label}
                        />
                      ))}
                      <label
                        title="เลือกสีเส้นเอง"
                        className="w-6 h-6 rounded-full border-2 border-slate-400 overflow-hidden cursor-pointer flex items-center justify-center bg-gradient-to-tr from-rose-500 via-amber-400 to-cyan-400"
                      >
                        <input
                          type="color"
                          value={penColor}
                          onChange={(e) => {
                            onShapeStrokeEnabledChange(true);
                            onPenColorChange(e.target.value);
                          }}
                          className="opacity-0 w-full h-full cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>

                  {/* สีพื้นรูปทรง */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-200">
                    <div className="flex items-center justify-between">
                      <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={shapeFillEnabled}
                          onChange={(e) => onShapeFillEnabledChange(e.target.checked)}
                          className="accent-indigo-600 w-3.5 h-3.5"
                        />
                        <span>สีพื้นรูปทรง (Fill)</span>
                      </label>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          shapeFillEnabled
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-slate-100 text-slate-600 border border-slate-200"
                        }`}
                      >
                        {shapeFillEnabled ? "เปิดสีพื้น" : "ไม่มีสีพื้น"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => onShapeFillEnabledChange(false)}
                        className={`relative w-6 h-6 rounded-full border-2 bg-white overflow-hidden flex items-center justify-center transition-transform ${
                          !shapeFillEnabled
                            ? "border-rose-600 scale-110 ring-2 ring-offset-1 ring-rose-500"
                            : "border-slate-300 hover:scale-105 hover:border-rose-400"
                        }`}
                        title="ไม่เอาสีพื้น (โปร่งใส)"
                      >
                        <span className="block w-7 h-0.5 bg-rose-600 -rotate-45" />
                      </button>
                      {SHAPE_FILL_PRESETS.map((c) => (
                        <button
                          key={c.color}
                          type="button"
                          onClick={() => onShapeFillColorChange(c.color)}
                          className={`w-6 h-6 rounded-full border-2 transition-transform ${
                            shapeFillEnabled && shapeFillColor === c.color
                              ? "border-slate-900 scale-110 ring-2 ring-offset-1 ring-indigo-600"
                              : "border-slate-400 hover:scale-105"
                          } ${!shapeFillEnabled ? "opacity-55" : ""}`}
                          style={{ backgroundColor: c.color }}
                          title={c.label}
                        />
                      ))}
                      <label
                        title="เลือกสีพื้นเอง"
                        className="w-6 h-6 rounded-full border-2 border-slate-400 overflow-hidden cursor-pointer flex items-center justify-center bg-gradient-to-tr from-yellow-300 via-pink-400 to-emerald-400"
                      >
                        <input
                          type="color"
                          value={shapeFillColor}
                          onChange={(e) => onShapeFillColorChange(e.target.value)}
                          className="opacity-0 w-full h-full cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>

                  {/* ความหนาของเส้น */}
                  <div className="space-y-1 pt-2 border-t border-slate-200">
                    <div className="flex justify-between items-center text-[11px] font-bold text-slate-800">
                      <span className="inline-flex items-center gap-1">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" />
                        <span>ความหนาเส้น</span>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
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
                        className="w-full accent-amber-500"
                      />
                    ) : (
                      <input
                        type="range"
                        min={0.3}
                        max={2.4}
                        step={0.05}
                        value={penWidthMm}
                        onChange={(e) => onPenWidthChange(Number(e.target.value))}
                        className="w-full accent-indigo-600"
                      />
                    )}
                  </div>

                  {/* ความโปร่งใส (Opacity) */}
                  <div className="space-y-1 pt-2 border-t border-slate-200">
                    <div className="flex justify-between items-center text-[11px] font-bold text-slate-800">
                      <span className="inline-flex items-center gap-1">
                        <Droplet className="w-3.5 h-3.5 text-sky-600" />
                        <span>ความโปร่งใส (ความทึบแสง)</span>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                        {Math.round(strokeOpacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={1}
                      step={0.05}
                      value={strokeOpacity}
                      onChange={(e) => onStrokeOpacityChange(Number(e.target.value))}
                      className="w-full accent-sky-600"
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
