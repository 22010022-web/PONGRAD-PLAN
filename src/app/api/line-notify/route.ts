import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getLineConfigStatus,
  getLineQuotaReport,
  sendLineFlexNotification,
} from "@/lib/line-notify";

async function resolveTeacherEmail(planData: any): Promise<string | null> {
  if (
    planData?.teacher_email &&
    typeof planData.teacher_email === "string" &&
    planData.teacher_email.trim()
  ) {
    return planData.teacher_email.trim();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (planData?.created_by) {
      const { data } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", planData.created_by)
        .maybeSingle();
      if (data?.email) return data.email;
    }

    if (planData?.teacher_id) {
      const { data } = await supabase
        .from("profiles")
        .select("email")
        .eq("teacher_id", planData.teacher_id)
        .limit(1)
        .maybeSingle();
      if (data?.email) return data.email;
    }
  } catch (err) {
    console.warn("Could not resolve teacher email for LINE notify:", err);
  }

  return null;
}

export async function GET() {
  const report = await getLineQuotaReport();
  return NextResponse.json({
    status: "ok",
    ...report,
    message: "LINE Webhook & Notify endpoint is ready",
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    // รองรับ LINE Webhook (เมื่อกด Verify ใน LINE Developers หรือพิมพ์ "ขอไอดี" ในกลุ่มเหมือนเว็บเก่า)
    if (Array.isArray(body?.events)) {
      const event = body.events[0];
      if (
        event &&
        event.type === "message" &&
        event.message?.type === "text" &&
        String(event.message.text || "").trim() === "ขอไอดี" &&
        event.replyToken
      ) {
        const source = event.source || {};
        const sourceId = source.groupId || source.roomId || source.userId || "ไม่พบ ID";
        const { token } = getLineConfigStatus();
        if (token) {
          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              replyToken: event.replyToken,
              messages: [{ type: "text", text: `ID ของกลุ่มนี้คือ:\n${sourceId}` }],
            }),
          }).catch(() => {});
        }
      }
      return NextResponse.json({ status: "ok" });
    }

    const { eventType, planData, reviewData } = body;
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://pongrad-plan.vercel.app";

    // โหมดทดสอบการแจ้งเตือน LINE จากหน้าจัดการระบบ (/admin)
    if (eventType === "test_notify") {
      const testRes = await sendLineFlexNotification({
        title: "ทดสอบระบบแจ้งเตือน LINE",
        subtitle: "ระบบส่งแผนการสอนออนไลน์ | รร.วัดโป่งแรด",
        headerColor: "#059669",
        fields: [
          { label: "สถานะ", value: "เชื่อมต่อ LINE Messaging API สำเร็จ" },
          {
            label: "เวลาทดสอบ",
            value: new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
          },
        ],
        buttons: [{ label: "เปิดหน้าเว็บระบบ", url: appUrl, primary: true, color: "#059669" }],
      });
      return NextResponse.json(testRes, { status: testRes.success ? 200 : 400 });
    }

    if (!eventType || !planData) {
      return NextResponse.json({ status: "ignored" });
    }

    let title = "";
    let subtitle = "";
    let headerColor = "#1e3a8a";
    let fields: { label: string; value: string }[] = [];
    let buttons: { label: string; url: string; primary?: boolean; color?: string }[] = [];

    const teacherEmail = await resolveTeacherEmail(planData);
    const emailField = teacherEmail ? [{ label: "อีเมลครู", value: teacherEmail }] : [];

    if (eventType === "plan_submitted") {
      title = "ส่งแผนการจัดการเรียนรู้";
      subtitle = "สถานะ: รอตรวจแผน | รร.วัดโป่งแรด";
      headerColor = "#1e3a8a";
      fields = [
        { label: "ผู้สอน", value: planData.teacher_name },
        ...emailField,
        { label: "รายวิชา", value: `${planData.subject} (${planData.class_level})` },
        { label: "รูปแบบ", value: `${planData.scope_value} (v${planData.version})` },
      ];
      if (planData.unit_title) {
        fields.push({ label: "ชื่อหน่วย/เรื่อง", value: planData.unit_title });
      }
      buttons = [
        { label: "เปิดดูไฟล์แผน", url: planData.plan_file_url, primary: true, color: "#2563eb" },
        { label: "เข้าหน้าตรวจแผน", url: `${appUrl}/review`, primary: false },
      ];
    } else if (eventType === "post_submitted") {
      title = "ส่งบันทึกหลังการสอน";
      subtitle = "สถานะ: รอตรวจบันทึก | รร.วัดโป่งแรด";
      headerColor = "#7c3aed";
      fields = [
        { label: "ผู้สอน", value: planData.teacher_name },
        ...emailField,
        { label: "รายวิชา", value: `${planData.subject} (${planData.class_level})` },
        { label: "รูปแบบ", value: `${planData.scope_value}` },
        {
          label: "ประเภทไฟล์",
          value: planData.use_existing_file ? "ใช้ไฟล์แผนเดิม" : "อัปโหลดไฟล์บันทึกใหม่",
        },
      ];
      buttons = [
        {
          label: "เปิดดูไฟล์บันทึก",
          url: planData.post_file_url || planData.plan_file_url,
          primary: true,
          color: "#7c3aed",
        },
        { label: "เข้าหน้าตรวจงาน", url: `${appUrl}/review`, primary: false },
      ];
    } else if (eventType === "plan_reviewed") {
      const isApproved =
        reviewData?.status_assigned === "แผนผ่าน (รอส่งบันทึก)" ||
        reviewData?.status_assigned === "เสร็จสมบูรณ์";
      const isFix =
        reviewData?.status_assigned === "แผนต้องแก้ไข" ||
        reviewData?.status_assigned === "บันทึกต้องแก้ไข";

      if (isApproved) {
        title =
          reviewData.status_assigned === "เสร็จสมบูรณ์"
            ? "อนุมัติเสร็จสมบูรณ์"
            : "ผลการตรวจ: แผนผ่าน";
        subtitle = `ผู้ตรวจ: ${reviewData.reviewer_name} (${reviewData.reviewer_role})`;
        headerColor = "#059669";
      } else if (isFix) {
        title = "แจ้งเตือน: งานต้องแก้ไข";
        subtitle = `ผู้ตรวจ: ${reviewData.reviewer_name} (${reviewData.reviewer_role})`;
        headerColor = "#dc2626";
      } else {
        title = "ผลการตรวจแผนการสอน";
        subtitle = `สถานะ: ${reviewData?.status_assigned || "-"}`;
        headerColor = "#d97706";
      }

      fields = [
        { label: "ผู้สอน", value: planData.teacher_name },
        ...emailField,
        { label: "รายวิชา", value: `${planData.subject} (${planData.class_level})` },
        { label: "สถานะใหม่", value: reviewData?.status_assigned || "-" },
      ];

      if (reviewData?.note && reviewData.note !== "-") {
        fields.push({ label: "หมายเหตุ ผอ.", value: reviewData.note });
      }

      if (reviewData?.reviewed_file_url) {
        buttons.push({
          label: "เปิดดูไฟล์ที่ตรวจ",
          url: reviewData.reviewed_file_url,
          primary: true,
          color: isFix ? "#dc2626" : "#059669",
        });
      }

      buttons.push({
        label: "เข้าสู่ระบบ",
        url: `${appUrl}/my-plans`,
        primary: false,
      });
    } else if (eventType === "plan_revised" || eventType === "post_revised") {
      const isPost = eventType === "post_revised";
      title = isPost ? "ส่งบันทึกหลังสอนฉบับแก้ไขแล้ว" : "ส่งแผนฉบับแก้ไข (แทนไฟล์เดิม)";
      subtitle = isPost
        ? "สถานะ: เสร็จสมบูรณ์ (ผอ. ไม่ต้องตรวจซ้ำ)"
        : "สถานะ: แผนผ่าน (รอส่งบันทึก) | ผอ. ไม่ต้องตรวจซ้ำ";
      headerColor = "#0d9488";
      fields = [
        { label: "ผู้สอน", value: planData.teacher_name },
        ...emailField,
        { label: "รายวิชา", value: `${planData.subject} (${planData.class_level})` },
        { label: "รูปแบบ", value: `${planData.scope_value} (v${planData.version})` },
      ];
      buttons = [
        {
          label: "ดูไฟล์ฉบับแก้ไข",
          url: isPost ? planData.post_file_url : planData.plan_file_url,
          primary: true,
          color: "#0d9488",
        },
        { label: "เปิดดูแดชบอร์ด", url: `${appUrl}`, primary: false },
      ];
    }

    const res = await sendLineFlexNotification({
      title,
      subtitle,
      headerColor,
      fields,
      buttons,
    });

    return NextResponse.json(res, { status: res.success ? 200 : 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
