import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function cleanEnv(raw?: string): string {
  return (raw || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

async function replyToLine(replyToken: string, messages: any[]) {
  const token = cleanEnv(process.env.LINE_CHANNEL_ACCESS_TOKEN);
  if (!token || !replyToken) return;

  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("LINE Reply Error:", res.status, errText);
  }
}

async function handleLineWebhookEvents(events: any[]) {
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL || "https://pongrad-plan.vercel.app"
  ).replace(/\/$/, "");

  for (const event of events) {
    if (!event || event.type !== "message" || event.message?.type !== "text") {
      continue;
    }

    const replyToken = event.replyToken;
    if (!replyToken) continue;

    const text = String(event.message.text || "").trim();

    // คำสั่งขอ Group ID / Room ID / User ID
    if (text === "ขอไอดี") {
      const source = event.source || {};
      const sourceId = source.groupId || source.roomId || source.userId || "ไม่พบ ID";
      await replyToLine(replyToken, [
        { type: "text", text: `ID ของกลุ่มนี้คือ:\n${sourceId}` },
      ]);
      continue;
    }

    // คำสั่ง "เช็คแผน" หรือ "รอตรวจ" (ใช้ Reply Token ฟรี 0 โควตา)
    if (text === "เช็คแผน" || text === "รอตรวจ") {
      const supabaseUrl = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
      const supabaseKey =
        cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
        cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

      if (!supabaseUrl || !supabaseKey) {
        await replyToLine(replyToken, [
          {
            type: "text",
            text: "⚠️ ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล Supabase บนเซิร์ฟเวอร์",
          },
        ]);
        continue;
      }

      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: pendingPlans, error } = await supabase
        .from("lesson_plans")
        .select("*")
        .in("status", ["รอตรวจแผน", "รอตรวจบันทึก", "รอตรวจ"])
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) {
        console.error("Supabase query error in LINE webhook:", error);
        await replyToLine(replyToken, [
          { type: "text", text: "เกิดข้อผิดพลาดในการดึงข้อมูลแผนการสอน" },
        ]);
        continue;
      }

      if (!pendingPlans || pendingPlans.length === 0) {
        await replyToLine(replyToken, [
          {
            type: "text",
            text: "✅ ขณะนี้ไม่มีแผนการสอนหรือบันทึกหลังสอนที่ค้างตรวจครับ",
          },
        ]);
        continue;
      }

      // ดึงอีเมลของครูจากตาราง profiles เพื่อแสดงใน Flex Message
      const userIds = Array.from(
        new Set(pendingPlans.map((p: any) => p.created_by).filter(Boolean))
      );
      const emailByUserId: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds);
        if (profiles) {
          for (const prof of profiles as { id: string; email: string }[]) {
            if (prof.id && prof.email) emailByUserId[prof.id] = prof.email;
          }
        }
      }

      const bubbles = pendingPlans.map((plan: any, idx: number) => {
        const isPost = plan.status === "รอตรวจบันทึก";
        const headerColor = isPost ? "#7c3aed" : "#1e3a8a";
        const teacherEmail = plan.created_by ? emailByUserId[plan.created_by] : null;
        const submittedDate = plan.created_at
          ? new Date(plan.created_at).toLocaleDateString("th-TH", {
              timeZone: "Asia/Bangkok",
            })
          : "-";
        const fileUrl = plan.post_file_url || plan.plan_file_url || "";
        const reviewLink = `${appUrl}/review/${plan.id}`;

        const rows: { label: string; value: string }[] = [
          { label: "ผู้สอน", value: String(plan.teacher_name || "-") },
          ...(teacherEmail ? [{ label: "อีเมลครู", value: teacherEmail }] : []),
          {
            label: "รายวิชา",
            value: `${plan.subject || "-"} (${plan.class_level || "-"})`,
          },
          {
            label: "รูปแบบ",
            value: `${plan.scope_value || "-"} (v${plan.version || 1})`,
          },
          ...(plan.unit_title
            ? [{ label: "เรื่อง", value: String(plan.unit_title) }]
            : []),
          { label: "วันที่ส่ง", value: submittedDate },
        ];

        const footerButtons: any[] = [
          {
            type: "button",
            style: "primary",
            color: isPost ? "#7c3aed" : "#2563eb",
            height: "sm",
            action: {
              type: "uri",
              label: "ตรวจและลงนาม",
              uri: reviewLink,
            },
          },
        ];

        if (fileUrl.startsWith("https://")) {
          footerButtons.push({
            type: "button",
            style: "secondary",
            height: "sm",
            action: {
              type: "uri",
              label: "เปิดดูไฟล์ PDF",
              uri: fileUrl,
            },
          });
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
                text: `${idx + 1}. ${plan.status || "รอตรวจแผน"}`,
                color: "#ffffff",
                weight: "bold",
                size: "md",
                wrap: true,
              },
              {
                type: "text",
                text: `รายการค้างตรวจล่าสุด (${pendingPlans.length} รายการ)`,
                color: "#e2e8f0",
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
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            paddingAll: "12px",
            contents: footerButtons,
          },
        };
      });

      const flexContents =
        bubbles.length === 1
          ? bubbles[0]
          : {
              type: "carousel",
              contents: bubbles,
            };

      await replyToLine(replyToken, [
        {
          type: "flex",
          altText: `พบงานค้างตรวจล่าสุด ${pendingPlans.length} รายการ`,
          contents: flexContents,
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
