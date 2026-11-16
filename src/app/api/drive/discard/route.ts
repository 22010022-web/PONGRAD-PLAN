// ย้ายไฟล์ที่ครูเพิ่งอัปโหลดแต่ยังไม่ทันกดส่งลงถังขยะ เมื่อครูกด "เปลี่ยนรายวิชา" เพื่ออัปโหลดใหม่ให้ตรงโฟลเดอร์วิชา
import { NextResponse } from "next/server";
import { requireUser, errorResponse, HttpError } from "@/lib/server-auth";
import { findSubfolder, getDrive, isInsideSchoolFolder } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { user, profile, supabase } = await requireUser(req);
    const body = await req.json();
    const fileId = String(body?.fileId || "").trim();

    if (!fileId || !/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
      throw new HttpError(400, "รหัสไฟล์ไม่ถูกต้อง");
    }

    // ตรวจสอบว่าไฟล์นี้ยังไม่ถูกบันทึกผูกไว้ในตาราง lesson_plans
    const { data: linkedPlans } = await supabase
      .from("lesson_plans")
      .select("id")
      .or(`plan_file_id.eq.${fileId},post_file_id.eq.${fileId}`)
      .limit(1);

    if (linkedPlans && linkedPlans.length > 0) {
      throw new HttpError(403, "ไฟล์นี้ถูกบันทึกส่งเข้าระบบแล้ว ไม่สามารถยกเลิกจากจุดนี้ได้");
    }

    const ownerName = profile?.full_name || user.email || "ไม่ระบุชื่อ";
    const isAdmin = profile?.role === "admin";
    const ancestorId = isAdmin
      ? undefined
      : (await findSubfolder(ownerName)) || "__MISSING__";

    if (ancestorId === "__MISSING__" || !(await isInsideSchoolFolder(fileId, ancestorId))) {
      throw new HttpError(403, "ไม่มีสิทธิ์ลบไฟล์นี้");
    }

    await getDrive().files.update({
      fileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err, "ไม่สามารถยกเลิกไฟล์เดิมได้");
  }
}
