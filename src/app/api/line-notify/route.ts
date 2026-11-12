import { NextResponse } from "next/server";
import { sendLineFlexNotification } from "@/lib/line-notify";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { eventType, planData, reviewData } = body;

    let title = "";
    let subtitle = "";
    let headerColor = "#1e3a8a"; // Blue default
    let fields: { label: string; value: string }[] = [];
    let buttons: { label: string; url: string; primary?: boolean; color?: string }[] = [];

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://pongrad-plan.vercel.app";

    if (eventType === "plan_submitted") {
      title = "ส่งแผนการจัดการเรียนรู้";
      subtitle = "สถานะ: รอตรวจแผน | รร.วัดโป่งแรด";
      headerColor = "#1e3a8a"; // Navy
      fields = [
        { label: "ผู้สอน", value: planData.teacher_name },
        { label: "รายวิชา", value: `${planData.subject} (${planData.class_level})` },
        { label: "รูปแบบ", value: `${planData.scope_value} (v${planData.version})` },
      ];
      if (planData.unit_title) {
        fields.push({ label: "ชื่อหน่วย/เรื่อง", value: planData.unit_title });
      }
      buttons = [
        { label: "เปิดดูไฟล์แผน (PDF)", url: planData.plan_file_url, primary: true, color: "#2563eb" },
        { label: "เข้าสู่ระบบตรวจแผน", url: `${appUrl}/review`, primary: false },
      ];
    } else if (eventType === "post_submitted") {
      title = "ส่งบันทึกหลังการสอน";
      subtitle = "สถานะ: รอตรวจบันทึก | รร.วัดโป่งแรด";
      headerColor = "#7c3aed"; // Purple
      fields = [
        { label: "ผู้สอน", value: planData.teacher_name },
        { label: "รายวิชา", value: `${planData.subject} (${planData.class_level})` },
        { label: "รูปแบบ", value: `${planData.scope_value}` },
        { label: "ประเภทไฟล์", value: planData.use_existing_file ? "ใช้ไฟล์แผนเดิม" : "อัปโหลดไฟล์บันทึกใหม่" },
      ];
      buttons = [
        { label: "เปิดดูไฟล์บันทึก (PDF)", url: planData.post_file_url || planData.plan_file_url, primary: true, color: "#7c3aed" },
        { label: "เข้าสู่ระบบตรวจบันทึก", url: `${appUrl}/review`, primary: false },
      ];
    } else if (eventType === "plan_reviewed") {
      const isApproved = reviewData.status_assigned === "แผนผ่าน (รอส่งบันทึก)" || reviewData.status_assigned === "เสร็จสมบูรณ์";
      const isFix = reviewData.status_assigned === "แผนต้องแก้ไข" || reviewData.status_assigned === "บันทึกต้องแก้ไข";

      if (isApproved) {
        title = reviewData.status_assigned === "เสร็จสมบูรณ์" ? "อนุมัติเสร็จสมบูรณ์" : "ผลการตรวจ: แผนผ่าน";
        subtitle = `ผู้ตรวจ: ${reviewData.reviewer_name} (${reviewData.reviewer_role})`;
        headerColor = "#059669"; // Emerald Green
      } else if (isFix) {
        title = "แจ้งเตือน: งานต้องแก้ไข";
        subtitle = `ผู้ตรวจ: ${reviewData.reviewer_name} (${reviewData.reviewer_role})`;
        headerColor = "#dc2626"; // Red
      } else {
        title = "ผลการตรวจแผนการสอน";
        subtitle = `สถานะ: ${reviewData.status_assigned}`;
        headerColor = "#d97706"; // Amber
      }

      fields = [
        { label: "ผู้สอน", value: planData.teacher_name },
        { label: "รายวิชา", value: `${planData.subject} (${planData.class_level})` },
        { label: "สถานะใหม่", value: reviewData.status_assigned },
      ];

      if (reviewData.note && reviewData.note !== "-") {
        fields.push({ label: "หมายเหตุ ผอ.", value: reviewData.note });
      }

      if (reviewData.reviewed_file_url) {
        buttons.push({
          label: "ดูไฟล์ที่ ผอ. ขีดตรวจ",
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
    }

    const res = await sendLineFlexNotification({
      title,
      subtitle,
      headerColor,
      fields,
      buttons,
    });

    return NextResponse.json(res);
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
