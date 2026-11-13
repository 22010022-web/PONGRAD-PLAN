import { NextResponse } from "next/server";
import { createAdminSupabase, errorResponse, HttpError, requireUser } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await requireUser(req, { admin: true });
    const body = await req.json();
    const teacherId = String(body?.teacherId || "").trim();

    if (!teacherId) {
      throw new HttpError(400, "ไม่พบรหัสครูที่ต้องการปลดล็อกสิทธิ์");
    }

    const adminClient = createAdminSupabase();
    if (!adminClient) {
      throw new HttpError(
        500,
        "ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY บนเซิร์ฟเวอร์ จึงยังไม่สามารถปลดล็อกบัญชีจากหน้านี้ได้"
      );
    }

    const { data: boundProfiles, error: findErr } = await adminClient
      .from("profiles")
      .select("id, email, role")
      .eq("teacher_id", teacherId);

    if (findErr) {
      throw new HttpError(500, findErr.message || "ตรวจสอบบัญชีที่ผูกอยู่ไม่สำเร็จ");
    }

    if (!boundProfiles || boundProfiles.length === 0) {
      return NextResponse.json({ success: true, released: 0 });
    }

    let released = 0;
    for (const bound of boundProfiles) {
      if (bound.role === "admin") {
        const { error: updErr } = await adminClient
          .from("profiles")
          .update({ teacher_id: null, updated_at: new Date().toISOString() })
          .eq("id", bound.id);
        if (updErr) throw new HttpError(500, updErr.message || "ปลดล็อกสิทธิ์ไม่สำเร็จ");
      } else {
        const { error: delErr } = await adminClient.auth.admin.deleteUser(bound.id);
        if (delErr) throw new HttpError(500, delErr.message || "ยกเลิกบัญชีเดิมไม่สำเร็จ");
      }
      released += 1;
    }

    return NextResponse.json({ success: true, released });
  } catch (err) {
    return errorResponse(err, "เกิดข้อผิดพลาดในการปลดล็อกสิทธิ์ครู");
  }
}
