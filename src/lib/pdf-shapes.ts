export type ShapeKind =
  | "rect"
  | "rounded-rect"
  | "ellipse"
  | "triangle"
  | "line"
  | "arrow";

export interface PdfShapeItem {
  id: string;
  kind: ShapeKind;
  xMm: number; // จุดศูนย์กลาง X (mm, 0..210)
  yMm: number; // จุดศูนย์กลาง Y (mm)
  wMm: number; // ความกว้าง (mm, >= 2)
  hMm: number; // ความสูง (mm, >= 2)
  rotationRad: number; // มุมหมุน (เรเดียน)
  strokeColor: string;
  strokeEnabled?: boolean; // เปิด/ปิดเส้นขอบรูปทรง (ค่าเริ่มต้น true)
  fillColor: string;
  fillEnabled: boolean;
  strokeWidthMm: number;
  opacity: number; // 0.15 .. 1.0
  flipX?: boolean;
  flipY?: boolean;
}

export type ShapeHandleType =
  | "rotate"
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "move";

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: "สี่เหลี่ยม",
  "rounded-rect": "สี่เหลี่ยมมุมมน",
  ellipse: "วงกลม",
  triangle: "สามเหลี่ยม",
  line: "เส้นตรง",
  arrow: "ลูกศร",
};

/**
 * แปลงพิกัดหน้ากระดาษ (xMm, yMm) เข้าสู่พิกัด Local ของรูปทรง (เทียบกับจุดศูนย์กลางและมุมหมุน)
 */
export function worldToShapeLocal(
  xMm: number,
  yMm: number,
  shape: PdfShapeItem
): [number, number] {
  const dx = xMm - shape.xMm;
  const dy = yMm - shape.yMm;
  const cos = Math.cos(-(shape.rotationRad || 0));
  const sin = Math.sin(-(shape.rotationRad || 0));
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

/**
 * แปลงพิกัด Local ของรูปทรงกลับเป็นพิกัดหน้ากระดาษ (xMm, yMm)
 */
export function shapeLocalToWorld(
  lxMm: number,
  lyMm: number,
  shape: PdfShapeItem
): [number, number] {
  const cos = Math.cos(shape.rotationRad || 0);
  const sin = Math.sin(shape.rotationRad || 0);
  return [
    shape.xMm + (lxMm * cos - lyMm * sin),
    shape.yMm + (lxMm * sin + lyMm * cos),
  ];
}

export function getShapeHandleLocalPositions(shape: PdfShapeItem): {
  type: Exclude<ShapeHandleType, "move">;
  lx: number;
  ly: number;
}[] {
  const hw = Math.max(1.5, shape.wMm / 2);
  const hh = Math.max(1.5, shape.hMm / 2);
  const rotOffset = Math.max(5.5, hh + 5.5);

  return [
    { type: "rotate", lx: 0, ly: -rotOffset },
    { type: "nw", lx: -hw, ly: -hh },
    { type: "n", lx: 0, ly: -hh },
    { type: "ne", lx: hw, ly: -hh },
    { type: "e", lx: hw, ly: 0 },
    { type: "se", lx: hw, ly: hh },
    { type: "s", lx: 0, ly: hh },
    { type: "sw", lx: -hw, ly: hh },
    { type: "w", lx: -hw, ly: 0 },
  ];
}

/**
 * ตรวจสอบว่าพิกัด (xMm, yMm) แตะโดนจุดจับปรับขนาด/หมุน หรือตัวรูปทรงหรือไม่
 */
export function hitTestShape(
  xMm: number,
  yMm: number,
  shape: PdfShapeItem,
  includeHandles: boolean
): ShapeHandleType | null {
  const [lx, ly] = worldToShapeLocal(xMm, yMm, shape);
  const hw = Math.max(1.5, shape.wMm / 2);
  const hh = Math.max(1.5, shape.hMm / 2);

  if (includeHandles) {
    const handles = getShapeHandleLocalPositions(shape);
    const hitRadius = 3.6; // รองรับทั้งปลาย Apple Pencil และนิ้วสัมผัสบน iPad
    for (const h of handles) {
      if (Math.hypot(lx - h.lx, ly - h.ly) <= hitRadius) {
        return h.type;
      }
    }
  }

  const pad = Math.max(2.5, shape.strokeWidthMm * 0.8 + 1.8);
  if (shape.kind === "line" || shape.kind === "arrow") {
    const sx = shape.flipX ? hw : -hw;
    const sy = shape.flipY ? hh : -hh;
    const ex = -sx;
    const ey = -sy;
    const dx = ex - sx;
    const dy = ey - sy;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((lx - sx) * dx + (ly - sy) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const projX = sx + t * dx;
    const projY = sy + t * dy;
    if (Math.hypot(lx - projX, ly - projY) <= pad + 1.5) {
      return "move";
    }
    return null;
  }

  if (Math.abs(lx) <= hw + pad && Math.abs(ly) <= hh + pad) {
    return "move";
  }

  return null;
}

/**
 * ตรวจสอบว่ารูปทรงอยู่ในหรือตัดกับกรอบสี่เหลี่ยมเลือกเพื่อลบ (Marquee Box) หรือไม่
 */
export function doesBoxIntersectShape(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  shape: PdfShapeItem
): boolean {
  const hw = shape.wMm / 2;
  const hh = shape.hMm / 2;
  const samplePoints: [number, number][] = [
    [0, 0],
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
    [0, -hh],
    [hw, 0],
    [0, hh],
    [-hw, 0],
  ];

  for (const [lx, ly] of samplePoints) {
    const [wx, wy] = shapeLocalToWorld(lx, ly, shape);
    if (wx >= box.minX && wx <= box.maxX && wy >= box.minY && wy <= box.maxY) {
      return true;
    }
  }
  return false;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * วาดรูปทรงลงบน Canvas พร้อมจุดจับ (Handles) เมื่อถูกเลือก
 */
export function renderPdfShape(
  ctx: CanvasRenderingContext2D,
  shape: PdfShapeItem,
  mmToPx: number,
  isSelected: boolean,
  showHandles: boolean
) {
  ctx.save();
  ctx.translate(shape.xMm * mmToPx, shape.yMm * mmToPx);
  ctx.rotate(shape.rotationRad || 0);

  const hw = Math.max(1, (shape.wMm * mmToPx) / 2);
  const hh = Math.max(1, (shape.hMm * mmToPx) / 2);
  const strokePx = Math.max(1.2, shape.strokeWidthMm * mmToPx);

  ctx.save();
  ctx.globalAlpha = Math.max(0.1, Math.min(1, shape.opacity ?? 1));
  ctx.strokeStyle = shape.strokeColor;
  ctx.fillStyle = shape.fillColor || "transparent";
  ctx.lineWidth = strokePx;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const hasFill =
    shape.fillEnabled &&
    Boolean(shape.fillColor) &&
    shape.fillColor !== "transparent";
  const hasStroke =
    ((shape.strokeEnabled ?? true) &&
      Boolean(shape.strokeColor) &&
      shape.strokeColor !== "transparent") ||
    !hasFill;

  switch (shape.kind) {
    case "rect": {
      ctx.beginPath();
      ctx.rect(-hw, -hh, hw * 2, hh * 2);
      if (hasFill) ctx.fill();
      if (hasStroke) ctx.stroke();
      break;
    }
    case "rounded-rect": {
      const r = Math.min(hw, hh) * 0.35;
      drawRoundedRectPath(ctx, -hw, -hh, hw * 2, hh * 2, r);
      if (hasFill) ctx.fill();
      if (hasStroke) ctx.stroke();
      break;
    }
    case "ellipse": {
      ctx.beginPath();
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      if (hasFill) ctx.fill();
      if (hasStroke) ctx.stroke();
      break;
    }
    case "triangle": {
      ctx.beginPath();
      ctx.moveTo(0, -hh);
      ctx.lineTo(hw, hh);
      ctx.lineTo(-hw, hh);
      ctx.closePath();
      if (hasFill) ctx.fill();
      if (hasStroke) ctx.stroke();
      break;
    }
    case "line": {
      const sx = shape.flipX ? hw : -hw;
      const sy = shape.flipY ? hh : -hh;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(-sx, -sy);
      ctx.stroke();
      break;
    }
    case "arrow": {
      const sx = shape.flipX ? hw : -hw;
      const sy = shape.flipY ? hh : -hh;
      const ex = -sx;
      const ey = -sy;
      const angle = Math.atan2(ey - sy, ex - sx);
      const headLen = Math.max(strokePx * 3.4, Math.min(44, Math.hypot(ex - sx, ey - sy) * 0.38));
      const wingAngle = Math.PI / 6.2;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      const x1 = ex - headLen * Math.cos(angle - wingAngle);
      const y1 = ey - headLen * Math.sin(angle - wingAngle);
      const x2 = ex - headLen * Math.cos(angle + wingAngle);
      const y2 = ey - headLen * Math.sin(angle + wingAngle);

      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fillStyle = hasFill ? shape.fillColor : shape.strokeColor;
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
  ctx.restore();

  if (isSelected && showHandles) {
    ctx.save();
    ctx.strokeStyle = "rgba(37, 99, 235, 0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(-hw - 3, -hh - 3, hw * 2 + 6, hh * 2 + 6);
    ctx.setLineDash([]);

    const handles = getShapeHandleLocalPositions(shape);
    const rotHandle = handles.find((h) => h.type === "rotate");
    if (rotHandle) {
      ctx.beginPath();
      ctx.moveTo(0, -hh - 3);
      ctx.lineTo(rotHandle.lx * mmToPx, rotHandle.ly * mmToPx);
      ctx.strokeStyle = "rgba(37, 99, 235, 0.85)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    for (const h of handles) {
      const hx = h.lx * mmToPx;
      const hy = h.ly * mmToPx;
      ctx.beginPath();
      if (h.type === "rotate") {
        ctx.arc(hx, hy, 8.5, 0, Math.PI * 2);
        ctx.fillStyle = "#10b981";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.2;
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.arc(hx, hy, 7, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 2.2;
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  ctx.restore();
}
