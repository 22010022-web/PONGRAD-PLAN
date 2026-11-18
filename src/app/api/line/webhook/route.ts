import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isPermissionMemoPlan } from "@/lib/plan-ordering";

export const runtime = "nodejs";

function cleanEnv(raw?: string): string {
  return (raw || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

function getAppUrl(): string {
  return (
    cleanEnv(process.env.NEXT_PUBLIC_APP_URL) || "https://pongrad-plan.vercel.app"
  ).replace(/\/$/, "");
}

function getSupabaseAdminClient() {
  const supabaseUrl = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseKey =
    cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!supabaseUrl || !supabaseKey) return null;

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function buildQuickReply() {
  const items = [
    { label: "ส่งงาน (ครู)", text: "ส่งงาน" },
    { label: "ตรวจงาน (ผอ.)", text: "ตรวจงาน" },
    { label: "งานแก้ไข", text: "งานแก้ไข" },
    { label: "ผ่านแล้ว", text: "ผ่านแล้ว" },
    { label: "ขออนุญาต", text: "ขออนุญาต" },
    { label: "สรุปภาพรวม", text: "สรุป" },
    { label: "เมนูคำสั่ง", text: "เมนู" },
  ];

  return {
    items: items.map((item) => ({
      type: "action",
      action: {
        type: "message",
        label: item.label.slice(0, 20),
        text: item.text,
      },
    })),
  };
}

async function replyToLine(replyToken: string, messages: any[]) {
  const token = cleanEnv(process.env.LINE_CHANNEL_ACCESS_TOKEN);
  if (!token || !replyToken || !Array.isArray(messages) || messages.length === 0) {
    return;
  }

  const quickReply = buildQuickReply();
  const payloadMessages = messages.map((msg, idx) =>
    idx === messages.length - 1 && !msg.quickReply
      ? { ...msg, quickReply }
      : msg
  );

  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: payloadMessages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("LINE Reply Error:", res.status, errText);
  }
}

function parseCommandWithOptionalQuery(
  cleanedText: string,
  keywords: string[]
): { matched: boolean; query: string } {
  const lower = cleanedText.toLowerCase();
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (lower === kwLower) {
      return { matched: true, query: "" };
    }
    if (lower.startsWith(`${kwLower} `)) {
      const arg = cleanedText.slice(kw.length).trim();
      // กันการตอบทับประโยคสนทนาทั่วไปในกลุ่ม เช่น "ส่งงาน แล้วค่ะ ผอ."
      if (
        arg.length > 0 &&
        arg.length <= 30 &&
        !/(แล้ว|ครับ|ค่ะ|นะคะ|นะ|จ้า|จ้ะ|ไหม|มั้ย|หรือยัง|รึยัง)/.test(arg)
      ) {
        return { matched: true, query: arg };
      }
    }
  }
  return { matched: false, query: "" };
}

function getStatusColor(status: string, isPermission: boolean): string {
  if (status === "แผนต้องแก้ไข" || status === "บันทึกต้องแก้ไข") return "#dc2626";
  if (status === "เสร็จสมบูรณ์" || status === "แผนผ่าน (รอส่งบันทึก)") return "#059669";
  if (status === "รอตรวจบันทึก") return "#7c3aed";
  if (isPermission) return "#0d9488";
  return "#1e3a8a";
}

function formatThaiShortDate(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "2-digit",
    month: "short",
    day: "numeric",
  });
}

function safeUriButton(label: string, uri: string, style: "primary" | "secondary", color?: string) {
  const cleanUrl = String(uri || "").trim();
  if (!cleanUrl.startsWith("https://")) return null;
  const btn: Record<string, any> = {
    type: "button",
    style,
    height: "sm",
    action: {
      type: "uri",
      label: label.slice(0, 20),
      uri: cleanUrl,
    },
  };
  if (style === "primary" && color) {
    btn.color = color;
  }
  return btn;
}

async function applyTeacherFilter(supabase: any, queryStr: string, dbQuery: any) {
  const q = queryStr.trim();
  if (!q) return dbQuery;

  const { data: matchedTeachers } = await supabase
    .from("teachers")
    .select("id")
    .or(`name.ilike.%${q}%,short_name.ilike.%${q}%`)
    .limit(10);

  const ids = (matchedTeachers || []).map((t: any) => t.id).filter(Boolean);
  if (ids.length > 0) {
    return dbQuery.in("teacher_id", ids);
  }
  return dbQuery.ilike("teacher_name", `%${q}%`);
}

async function fetchLatestReviewsMap(supabase: any, planIds: string[]) {
  const map: Record<string, { note?: string; reviewed_file_url?: string; reviewed_at?: string }> = {};
  if (!planIds.length) return map;

  const { data: reviews } = await supabase
    .from("plan_reviews")
    .select("plan_id, note, reviewed_file_url, reviewed_at")
    .in("plan_id", planIds)
    .order("reviewed_at", { ascending: false });

  if (reviews) {
    for (const r of reviews as any[]) {
      if (r.plan_id && !map[r.plan_id]) {
        map[r.plan_id] = r;
      }
    }
  }
  return map;
}

function buildPlanFlexBubble(params: {
  plan: any;
  index: number;
  subtitleText: string;
  mode: "teacher" | "director";
  appUrl: string;
  reviewInfo?: { note?: string; reviewed_file_url?: string };
}) {
  const { plan, index, subtitleText, mode, appUrl, reviewInfo } = params;
  const isPermission = isPermissionMemoPlan(plan);
  const status = String(plan.status || "รอตรวจแผน");
  const headerColor = getStatusColor(status, isPermission);
  const docTypeLabel = isPermission
    ? "ใบขออนุญาตใช้แผน"
    : status === "รอตรวจบันทึก" || status === "บันทึกต้องแก้ไข"
    ? "บันทึกหลังสอน"
    : "แผนการสอน";

  const rows: { label: string; value: string }[] = [
    { label: "ผู้สอน", value: String(plan.teacher_name || "-") },
    {
      label: "รายวิชา",
      value: `${plan.subject || "-"} (${plan.class_level || "-"})`,
    },
    { label: "ประเภท", value: `${docTypeLabel} · ${plan.scope_value || "-"}` },
    { label: "วันที่ส่ง", value: formatThaiShortDate(plan.post_submitted_at || plan.created_at) },
  ];

  if (plan.unit_title) {
    rows.push({
      label: isPermission ? "หนังสือ/ชม." : "เรื่อง",
      value: String(plan.unit_title),
    });
  }

  if (reviewInfo?.note && reviewInfo.note !== "-") {
    rows.push({ label: "หมายเหตุ ผอ.", value: String(reviewInfo.note) });
  }

  const fileUrl =
    reviewInfo?.reviewed_file_url || plan.post_file_url || plan.plan_file_url || "";
  const footerButtons: any[] = [];

  if (mode === "director") {
    const reviewBtn = safeUriButton(
      "ตรวจและลงนาม",
      `${appUrl}/review/${plan.id}`,
      "primary",
      headerColor
    );
    if (reviewBtn) footerButtons.push(reviewBtn);

    const fileBtn = safeUriButton("เปิดดูไฟล์ PDF", fileUrl, "secondary");
    if (fileBtn) footerButtons.push(fileBtn);
  } else {
    const fileLabel = reviewInfo?.reviewed_file_url
      ? "เปิดไฟล์ที่ ผอ. เซ็น"
      : "เปิดดูไฟล์ PDF";
    const fileBtn = safeUriButton(fileLabel, fileUrl, "primary", headerColor);
    if (fileBtn) footerButtons.push(fileBtn);

    const myPlansBtn = safeUriButton(
      status.includes("แก้ไข") ? "อัปโหลดฉบับแก้ไข" : "จัดการงานของฉัน",
      `${appUrl}/my-plans`,
      fileBtn ? "secondary" : "primary",
      fileBtn ? undefined : headerColor
    );
    if (myPlansBtn) footerButtons.push(myPlansBtn);
  }

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: headerColor,
      paddingAll: "14px",
      contents: [
        {
          type: "text",
          text: `${index + 1}. ${status}`,
          color: "#ffffff",
          weight: "bold",
          size: "md",
          wrap: true,
        },
        {
          type: "text",
          text: subtitleText,
          color: "#e2e8f0",
          size: "xs",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "14px",
      spacing: "sm",
      contents: rows.map((r) => ({
        type: "box",
        layout: "baseline",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: r.label,
            color: "#64748b",
            size: "xs",
            flex: 3,
          },
          {
            type: "text",
            text: String(r.value || "-").slice(0, 200),
            color: "#0f172a",
            size: "xs",
            weight: "bold",
            wrap: true,
            flex: 7,
          },
        ],
      })),
    },
    ...(footerButtons.length > 0
      ? {
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            paddingAll: "12px",
            contents: footerButtons,
          },
        }
      : {}),
  };
}

function buildTeacherQuickPortalBubble(
  appUrl: string,
  subtitle = "เมนูลัดสำหรับครูผู้สอน (ใช้งานฟรีไม่หักเครดิต LINE)"
) {
  const buttons = [
    safeUriButton("ส่งแผน / ใบขออนุญาต", `${appUrl}/submit`, "primary", "#db2777"),
    safeUriButton("งานของฉัน / ส่งบันทึก", `${appUrl}/my-plans`, "secondary"),
    safeUriButton("เปิดหน้าแดชบอร์ด", `${appUrl}`, "secondary"),
  ].filter(Boolean);

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#be185d",
      paddingAll: "14px",
      contents: [
        {
          type: "text",
          text: "เมนูลัดงานครูผู้สอน",
          color: "#ffffff",
          weight: "bold",
          size: "md",
        },
        {
          type: "text",
          text: subtitle,
          color: "#fce7f3",
          size: "xs",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "14px",
      spacing: "sm",
      contents: [
        {
          type: "text",
          text: "คำสั่งดูงานเฉพาะบุคคล:",
          size: "xs",
          weight: "bold",
          color: "#334155",
        },
        {
          type: "text",
          text: "• พิมพ์ \"ส่งงาน ชื่อเล่น/ชื่อครู\" เช่น ส่งงาน กชกร\n• พิมพ์ \"งานแก้ไข\" เพื่อดูจุดที่ ผอ. แจ้งแก้\n• พิมพ์ \"ผ่านแล้ว\" เพื่อเปิดไฟล์ที่ ผอ. เซ็นแล้ว",
          size: "xs",
          color: "#475569",
          wrap: true,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "12px",
      contents: buttons,
    },
  };
}

function buildHelpMenuBubble(appUrl: string) {
  const buttons = [
    safeUriButton("หน้าส่งแผน (ครู)", `${appUrl}/submit`, "primary", "#2563eb"),
    safeUriButton("หน้าตรวจลงนาม (ผอ.)", `${appUrl}/review`, "secondary"),
    safeUriButton("เปิดหน้าแรกโรงเรียน", `${appUrl}`, "secondary"),
  ].filter(Boolean);

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#0f172a",
      paddingAll: "16px",
      contents: [
        {
          type: "text",
          text: "คำสั่ง LINE ฟรี (0 เครดิต)",
          color: "#ffffff",
          weight: "bold",
          size: "md",
        },
        {
          type: "text",
          text: "ใช้งานได้ตลอดแม้โควตา Push รายเดือนจะหมดแล้ว",
          color: "#cbd5e1",
          size: "xs",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "14px",
      spacing: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            {
              type: "text",
              text: "สำหรับครูผู้สอน",
              size: "xs",
              weight: "bold",
              color: "#be185d",
            },
            {
              type: "text",
              text: "• ส่งงาน / ส่งงาน ชื่อครู : ดูงานล่าสุด + ลิงก์ส่งงาน\n• งานแก้ไข : ดูงานที่ ผอ. ให้แก้ + หมายเหตุ\n• ผ่านแล้ว : ดูงานอนุมัติ + โหลดไฟล์มีลายเซ็น\n• ขออนุญาต : ดูสถานะบันทึกข้อความขอใช้แผน",
              size: "xs",
              color: "#334155",
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            {
              type: "text",
              text: "สำหรับ ผอ. / ผู้บริหาร",
              size: "xs",
              weight: "bold",
              color: "#1e3a8a",
            },
            {
              type: "text",
              text: "• ตรวจงาน / เช็คแผน : ดูคิวรอตรวจ + กดลงนามทันที\n• สรุป : สรุปยอดภาพรวมทั้งโรงเรียน & รายชื่อค้างส่ง\n• ขอไอดี : แสดง Group ID สำหรับตั้งค่าระบบ",
              size: "xs",
              color: "#334155",
              wrap: true,
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "12px",
      contents: buttons,
    },
  };
}

async function handleLineWebhookEvents(events: any[]) {
  const appUrl = getAppUrl();

  for (const event of events) {
    if (!event || event.type !== "message" || event.message?.type !== "text") {
      continue;
    }

    const replyToken = event.replyToken;
    if (!replyToken) continue;

    const rawText = String(event.message.text || "").trim();
    const cleaned = rawText.replace(/^\/+/, "").replace(/\s+/g, " ").trim();
    if (!cleaned) continue;

    // 1. คำสั่งขอ Group ID / Room ID / User ID
    if (cleaned === "ขอไอดี" || cleaned.toLowerCase() === "id") {
      const source = event.source || {};
      const sourceId = source.groupId || source.roomId || source.userId || "ไม่พบ ID";
      await replyToLine(replyToken, [
        { type: "text", text: `ID ของห้องแชทนี้คือ:\n${sourceId}` },
      ]);
      continue;
    }

    // 2. เมนูคำสั่งและวิธีใช้งานฟรี (0 เครดิต)
    if (
      ["เมนู", "คำสั่ง", "คำสั่งบอท", "วิธีใช้", "ช่วยด้วย", "ช่วยเหลือ", "help", "?"].includes(
        cleaned.toLowerCase()
      )
    ) {
      await replyToLine(replyToken, [
        {
          type: "flex",
          altText: "เมนูคำสั่ง LINE บอทโรงเรียนวัดโป่งแรด (ใช้ฟรี 0 เครดิต)",
          contents: buildHelpMenuBubble(appUrl),
        },
      ]);
      continue;
    }

    // 3. ลิงก์ทางเข้าเว็บอย่างเร็ว
    if (["ลิงก์ส่งงาน", "ลิงก์เว็บ", "เข้าเว็บ", "ส่งงานด่วน"].includes(cleaned)) {
      await replyToLine(replyToken, [
        {
          type: "flex",
          altText: "ลิงก์เข้าใช้งานระบบส่งแผนการสอนออนไลน์",
          contents: buildTeacherQuickPortalBubble(appUrl),
        },
      ]);
      continue;
    }

    const teacherJobsCmd = parseCommandWithOptionalQuery(cleaned, [
      "ส่งงาน",
      "งานครู",
      "ส่งแผน",
      "รายการส่งงาน",
      "งานล่าสุด",
      "เช็คงาน",
      "งานฉัน",
      "งานของฉัน",
    ]);
    const directorPendingCmd = parseCommandWithOptionalQuery(cleaned, [
      "ตรวจงาน",
      "งาน ผอ.",
      "งาน ผอ",
      "งานผอ",
      "รอตรวจ",
      "เช็คแผน",
      "รอลงนาม",
      "ค้างตรวจ",
    ]);
    const revisionCmd = parseCommandWithOptionalQuery(cleaned, [
      "งานแก้ไข",
      "ต้องแก้ไข",
      "แผนแก้ไข",
      "แก้ไขงาน",
      "ส่งคืน",
      "แก้แผน",
      "แก้ไข",
    ]);
    const approvedCmd = parseCommandWithOptionalQuery(cleaned, [
      "ผ่านแล้ว",
      "อนุมัติแล้ว",
      "ลงนามแล้ว",
      "เซ็นแล้ว",
      "โหลดไฟล์",
      "ตรวจแล้ว",
    ]);
    const permissionCmd = parseCommandWithOptionalQuery(cleaned, [
      "ขออนุญาต",
      "ใบขออนุญาต",
      "บันทึกข้อความ",
    ]);
    const summaryCmd = parseCommandWithOptionalQuery(cleaned, [
      "สรุป",
      "สรุปงาน",
      "สรุปภาพรวม",
      "ภาพรวม",
      "สถิติ",
      "แดชบอร์ด",
      "ยังไม่ส่ง",
      "ครบหรือยัง",
    ]);

    if (
      !teacherJobsCmd.matched &&
      !directorPendingCmd.matched &&
      !revisionCmd.matched &&
      !approvedCmd.matched &&
      !permissionCmd.matched &&
      !summaryCmd.matched
    ) {
      // ไม่รบกวนการพิมพ์สนทนาปกติในกลุ่ม LINE
      continue;
    }

    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      await replyToLine(replyToken, [
        {
          type: "text",
          text: "⚠️ ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล Supabase บนเซิร์ฟเวอร์",
        },
      ]);
      continue;
    }

    // 4. สรุปภาพรวมทั้งโรงเรียน (แดชบอร์ดย่อใน LINE)
    if (summaryCmd.matched) {
      const [{ data: plans, error: planErr }, { data: teachers }] = await Promise.all([
        supabase
          .from("lesson_plans")
          .select("id, teacher_id, teacher_name, status, scope_value"),
        supabase
          .from("teachers")
          .select("id, name, short_name")
          .eq("is_active", true)
          .order("display_order", { ascending: true }),
      ]);

      if (planErr) {
        await replyToLine(replyToken, [
          { type: "text", text: "เกิดข้อผิดพลาดในการดึงข้อมูลสรุปจากระบบ" },
        ]);
        continue;
      }

      const list = (plans || []) as any[];
      const pendingList = list.filter((p) =>
        ["รอตรวจแผน", "รอตรวจบันทึก", "รอตรวจ"].includes(p.status)
      );
      const fixList = list.filter((p) =>
        ["แผนต้องแก้ไข", "บันทึกต้องแก้ไข"].includes(p.status)
      );
      const approvedList = list.filter((p) =>
        ["แผนผ่าน (รอส่งบันทึก)", "เสร็จสมบูรณ์"].includes(p.status)
      );

      const submittedTeacherIds = new Set(list.map((p) => p.teacher_id).filter(Boolean));
      const pendingTeacherNames = ((teachers || []) as any[])
        .filter((t) => !submittedTeacherIds.has(t.id))
        .map((t) => t.short_name || t.name);

      const summaryBubble = {
        type: "bubble",
        size: "mega",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#0f766e",
          paddingAll: "14px",
          contents: [
            {
              type: "text",
              text: "สรุปภาพรวมการส่งแผนและตรวจงาน",
              color: "#ffffff",
              weight: "bold",
              size: "md",
            },
            {
              type: "text",
              text: `ข้อมูลล่าสุด ณ ${formatThaiShortDate(new Date().toISOString())}`,
              color: "#ccfbf1",
              size: "xs",
              margin: "xs",
            },
          ],
        },
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "14px",
          spacing: "sm",
          contents: [
            { label: "ส่งเข้ามาทั้งหมด", value: `${list.length} รายการ` },
            { label: "รอ ผอ. ตรวจ/ลงนาม", value: `${pendingList.length} รายการ` },
            { label: "ต้องแก้ไข", value: `${fixList.length} รายการ` },
            { label: "ผ่าน/เสร็จสมบูรณ์", value: `${approvedList.length} รายการ` },
            {
              label: "ครูที่ยังไม่ส่งในระบบ",
              value:
                pendingTeacherNames.length > 0
                  ? `${pendingTeacherNames.length} ท่าน (${pendingTeacherNames.slice(0, 6).join(", ")}${pendingTeacherNames.length > 6 ? "..." : ""})`
                  : "ส่งครบทุกท่านแล้ว",
            },
          ].map((r) => ({
            type: "box",
            layout: "baseline",
            spacing: "sm",
            contents: [
              { type: "text", text: r.label, color: "#64748b", size: "xs", flex: 5 },
              {
                type: "text",
                text: r.value,
                color: "#0f172a",
                size: "xs",
                weight: "bold",
                wrap: true,
                flex: 5,
              },
            ],
          })),
        },
        footer: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          paddingAll: "12px",
          contents: [
            safeUriButton("เปิดดูแดชบอร์ดเต็ม", `${appUrl}`, "primary", "#0f766e"),
            safeUriButton("เข้าหน้าตรวจงาน (ผอ.)", `${appUrl}/review`, "secondary"),
          ].filter(Boolean),
        },
      };

      await replyToLine(replyToken, [
        {
          type: "flex",
          altText: `สรุปภาพรวม: ทั้งหมด ${list.length} | รอตรวจ ${pendingList.length} | แก้ไข ${fixList.length}`,
          contents: summaryBubble,
        },
      ]);
      continue;
    }

    // 5. ส่วน ผอ.: ตรวจงาน / รอตรวจ / เช็คแผน (รองรับ filter ชื่อครูได้)
    if (directorPendingCmd.matched) {
      let query = supabase
        .from("lesson_plans")
        .select("*")
        .in("status", ["รอตรวจแผน", "รอตรวจบันทึก", "รอตรวจ"])
        .order("created_at", { ascending: false });

      if (directorPendingCmd.query) {
        query = await applyTeacherFilter(supabase, directorPendingCmd.query, query);
      }

      const { data: pendingAll, error } = await query.limit(50);
      if (error) {
        await replyToLine(replyToken, [
          { type: "text", text: "เกิดข้อผิดพลาดในการดึงรายการรอตรวจ" },
        ]);
        continue;
      }

      const list = (pendingAll || []) as any[];
      if (list.length === 0) {
        await replyToLine(replyToken, [
          {
            type: "text",
            text: directorPendingCmd.query
              ? `✅ ไม่พบงานค้างตรวจของคุณ "${directorPendingCmd.query}" ในขณะนี้`
              : "✅ ขณะนี้ไม่มีแผนการสอน บันทึกหลังสอน หรือใบขออนุญาตที่ค้างตรวจครับ",
          },
        ]);
        continue;
      }

      const slice = list.slice(0, 6);
      const countPerm = list.filter((p) => isPermissionMemoPlan(p)).length;
      const countPost = list.filter((p) => p.status === "รอตรวจบันทึก").length;
      const countPlan = list.length - countPerm - countPost;

      const summaryNote = `รอตรวจรวม ${list.length} (แผน ${countPlan} · ขออนุญาต ${countPerm} · บันทึก ${countPost})`;
      const bubbles = slice.map((plan, idx) =>
        buildPlanFlexBubble({
          plan,
          index: idx,
          subtitleText: idx === 0 ? summaryNote : `รายการรอตรวจ (แสดง ${slice.length}/${list.length})`,
          mode: "director",
          appUrl,
        })
      );

      await replyToLine(replyToken, [
        {
          type: "flex",
          altText: summaryNote,
          contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
        },
      ]);
      continue;
    }

    // 6. ส่วนครู & ผอ.: งานที่ต้องแก้ไข (พร้อมหมายเหตุ ผอ.)
    if (revisionCmd.matched) {
      let query = supabase
        .from("lesson_plans")
        .select("*")
        .in("status", ["แผนต้องแก้ไข", "บันทึกต้องแก้ไข"])
        .order("updated_at", { ascending: false });

      if (revisionCmd.query) {
        query = await applyTeacherFilter(supabase, revisionCmd.query, query);
      }

      const { data: fixPlans, error } = await query.limit(6);
      if (error) {
        await replyToLine(replyToken, [
          { type: "text", text: "เกิดข้อผิดพลาดในการดึงรายการแก้ไข" },
        ]);
        continue;
      }

      const list = (fixPlans || []) as any[];
      if (list.length === 0) {
        await replyToLine(replyToken, [
          {
            type: "text",
            text: revisionCmd.query
              ? `✅ ไม่พบรายการต้องแก้ไขของคุณ "${revisionCmd.query}"`
              : "✅ ไม่มีแผนการสอนหรือบันทึกที่ค้างแก้ไขในระบบขณะนี้ครับ",
          },
        ]);
        continue;
      }

      const reviewsMap = await fetchLatestReviewsMap(
        supabase,
        list.map((p) => p.id)
      );
      const bubbles = list.map((plan, idx) =>
        buildPlanFlexBubble({
          plan,
          index: idx,
          subtitleText: `งานต้องปรับแก้ไข (${list.length} รายการ)`,
          mode: "teacher",
          appUrl,
          reviewInfo: reviewsMap[plan.id],
        })
      );

      await replyToLine(replyToken, [
        {
          type: "flex",
          altText: `พบงานต้องแก้ไข ${list.length} รายการ`,
          contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
        },
      ]);
      continue;
    }

    // 7. ส่วนครู: งานที่ผ่าน/อนุมัติแล้ว + ลิงก์เปิดไฟล์ที่ ผอ. เซ็นแล้ว
    if (approvedCmd.matched) {
      let query = supabase
        .from("lesson_plans")
        .select("*")
        .in("status", ["แผนผ่าน (รอส่งบันทึก)", "เสร็จสมบูรณ์"])
        .order("updated_at", { ascending: false });

      if (approvedCmd.query) {
        query = await applyTeacherFilter(supabase, approvedCmd.query, query);
      }

      const { data: approvedPlans, error } = await query.limit(6);
      if (error) {
        await replyToLine(replyToken, [
          { type: "text", text: "เกิดข้อผิดพลาดในการดึงรายการที่อนุมัติแล้ว" },
        ]);
        continue;
      }

      const list = (approvedPlans || []) as any[];
      if (list.length === 0) {
        await replyToLine(replyToken, [
          {
            type: "text",
            text: approvedCmd.query
              ? `ยังไม่พบรายการที่ผ่านแล้วของคุณ "${approvedCmd.query}"`
              : "ยังไม่พบรายการที่ตรวจผ่านหรือเสร็จสมบูรณ์ในระบบ",
          },
        ]);
        continue;
      }

      const reviewsMap = await fetchLatestReviewsMap(
        supabase,
        list.map((p) => p.id)
      );
      const bubbles = list.map((plan, idx) =>
        buildPlanFlexBubble({
          plan,
          index: idx,
          subtitleText: `ผ่านการพิจารณาแล้ว (ล่าสุด ${list.length} รายการ)`,
          mode: "teacher",
          appUrl,
          reviewInfo: reviewsMap[plan.id],
        })
      );

      await replyToLine(replyToken, [
        {
          type: "flex",
          altText: `รายการผ่านการอนุมัติแล้วล่าสุด ${list.length} รายการ`,
          contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
        },
      ]);
      continue;
    }

    // 8. ใบขออนุญาตใช้แผน (บันทึกข้อความ)
    if (permissionCmd.matched) {
      let query = supabase
        .from("lesson_plans")
        .select("*")
        .ilike("scope_value", "ใบขออนุญาตใช้แผน%")
        .order("created_at", { ascending: false });

      if (permissionCmd.query) {
        query = await applyTeacherFilter(supabase, permissionCmd.query, query);
      }

      const { data: permPlans, error } = await query.limit(6);
      if (error) {
        await replyToLine(replyToken, [
          { type: "text", text: "เกิดข้อผิดพลาดในการดึงข้อมูลใบขออนุญาตใช้แผน" },
        ]);
        continue;
      }

      const list = (permPlans || []) as any[];
      if (list.length === 0) {
        await replyToLine(replyToken, [
          {
            type: "flex",
            altText: "ยังไม่มีรายการใบขออนุญาตใช้แผนในระบบ",
            contents: buildTeacherQuickPortalBubble(
              appUrl,
              "ยังไม่มีใบขออนุญาตใช้แผนในระบบ สามารถกดปุ่มด้านล่างเพื่อส่งได้"
            ),
          },
        ]);
        continue;
      }

      const reviewsMap = await fetchLatestReviewsMap(
        supabase,
        list.map((p) => p.id)
      );
      const pendingCount = list.filter((p) => p.status === "รอตรวจแผน").length;
      const bubbles = list.map((plan, idx) =>
        buildPlanFlexBubble({
          plan,
          index: idx,
          subtitleText:
            idx === 0
              ? `ใบขออนุญาตใช้แผนล่าสุด (รอลงนาม ${pendingCount} ใบ)`
              : "ใบขออนุญาตใช้แผนการสอน",
          mode: plan.status === "รอตรวจแผน" ? "director" : "teacher",
          appUrl,
          reviewInfo: reviewsMap[plan.id],
        })
      );

      await replyToLine(replyToken, [
        {
          type: "flex",
          altText: `ใบขออนุญาตใช้แผนล่าสุด ${list.length} รายการ (รอลงนาม ${pendingCount})`,
          contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
        },
      ]);
      continue;
    }

    // 9. ส่วนครู: ส่งงาน / งานครู (แสดงเมนูลัดส่งงาน + สถานะงานล่าสุดของครู)
    if (teacherJobsCmd.matched) {
      let query = supabase
        .from("lesson_plans")
        .select("*")
        .order("created_at", { ascending: false });

      if (teacherJobsCmd.query) {
        query = await applyTeacherFilter(supabase, teacherJobsCmd.query, query);
      }

      const { data: recentPlans, error } = await query.limit(5);
      if (error) {
        await replyToLine(replyToken, [
          { type: "text", text: "เกิดข้อผิดพลาดในการดึงข้อมูลงานครู" },
        ]);
        continue;
      }

      const list = (recentPlans || []) as any[];
      const reviewsMap = await fetchLatestReviewsMap(
        supabase,
        list.map((p) => p.id)
      );

      const portalBubble = buildTeacherQuickPortalBubble(
        appUrl,
        teacherJobsCmd.query
          ? `งานของ "${teacherJobsCmd.query}" พบ ${list.length} รายการล่าสุด`
          : `พบการส่งงานล่าสุด ${list.length} รายการ`
      );

      const planBubbles = list.map((plan, idx) =>
        buildPlanFlexBubble({
          plan,
          index: idx,
          subtitleText: teacherJobsCmd.query
            ? `งานของคุณ ${teacherJobsCmd.query}`
            : "ความเคลื่อนไหวงานครูล่าสุด",
          mode: "teacher",
          appUrl,
          reviewInfo: reviewsMap[plan.id],
        })
      );

      const allBubbles = [portalBubble, ...planBubbles];
      await replyToLine(replyToken, [
        {
          type: "flex",
          altText: teacherJobsCmd.query
            ? `รายการส่งงานของ ${teacherJobsCmd.query} (${list.length} รายการ)`
            : `เมนูลัดส่งงานครูและงานล่าสุด (${list.length} รายการ)`,
          contents: { type: "carousel", contents: allBubbles },
        },
      ]);
    }
  }
}

export async function GET() {
  return NextResponse.json(
    { status: "ok", message: "LINE Webhook endpoint (/api/line/webhook) is active" },
    { status: 200 }
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (Array.isArray(body?.events) && body.events.length > 0) {
      await handleLineWebhookEvents(body.events);
    }
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (err) {
    console.error("LINE Webhook POST Error:", err);
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }
}
