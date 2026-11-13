import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminSupabase, errorResponse, HttpError } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const cleanEmail = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const teacherId = String(body?.teacherId || "").trim();

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new HttpError(400, "กรุณากรอกรูปแบบอีเมลให้ถูกต้อง");
    }
    if (password.length < 6) {
      throw new HttpError(400, "รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
    }
    if (!teacherId) {
      throw new HttpError(400, "กรุณาเลือกชื่อครูในระบบ");
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new HttpError(500, "ยังไม่ได้ตั้งค่า Supabase บนเซิร์ฟเวอร์");
    }

    const adminClient = createAdminSupabase();
    const reader =
      adminClient ||
      createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1. Verify teacher exists and is active
    const { data: teacherRow, error: teacherErr } = await reader
      .from("teachers")
      .select("id, name, is_active")
      .eq("id", teacherId)
      .maybeSingle();

    if (teacherErr) {
      throw new HttpError(500, teacherErr.message || "ตรวจสอบรายชื่อครูไม่สำเร็จ");
    }
    if (!teacherRow) {
      throw new HttpError(404, "ไม่พบรายชื่อครูท่านนี้ในระบบ");
    }
    if (!teacherRow.is_active) {
      throw new HttpError(403, "รายชื่อครูท่านนี้ถูกปิดการแสดงผลในระบบแล้ว");
    }

    // 2. Enforce 1 email per 1 teacher
    const { data: existingBound, error: boundErr } = await reader
      .from("profiles")
      .select("id")
      .eq("teacher_id", teacherId)
      .limit(1);

    if (boundErr) {
      throw new HttpError(500, boundErr.message || "ตรวจสอบสิทธิ์การลงทะเบียนไม่สำเร็จ");
    }
    if (existingBound && existingBound.length > 0) {
      throw new HttpError(
        409,
        `รายชื่อ "${teacherRow.name}" มีอีเมลลงทะเบียนใช้งานแล้ว (จำกัด 1 อีเมล ต่อ 1 ชื่อ) หากลืมรหัสผ่านกรุณาใช้เมนู 'ลืมรหัสผ่าน?' หรือติดต่อ ผอ./ผู้ดูแลระบบ`
      );
    }

    // 3. Enforce 1 account per email
    const { data: existingEmail } = await reader
      .from("profiles")
      .select("id")
      .ilike("email", cleanEmail)
      .limit(1);

    if (existingEmail && existingEmail.length > 0) {
      throw new HttpError(
        409,
        `อีเมล "${cleanEmail}" ถูกลงทะเบียนไว้ในระบบแล้ว กรุณาเข้าสู่ระบบหรือกด 'ลืมรหัสผ่าน?'`
      );
    }

    // Fallback when SUPABASE_SERVICE_ROLE_KEY is absent locally
    if (!adminClient) {
      return NextResponse.json({ fallbackClientSignUp: true, teacherName: teacherRow.name });
    }

    // 4. Create confirmed teacher user atomically via admin client
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: teacherRow.name,
        role: "teacher",
        teacher_id: teacherRow.id,
        teacher_name: teacherRow.name,
      },
    });

    if (createErr || !created.user) {
      const msg = (createErr?.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered")) {
        throw new HttpError(
          409,
          `อีเมล "${cleanEmail}" ได้ลงทะเบียนไว้แล้ว กรุณาเข้าสู่ระบบหรือใช้ 'ลืมรหัสผ่าน?'`
        );
      }
      throw new HttpError(400, createErr?.message || "ลงทะเบียนผู้ใช้ไม่สำเร็จ");
    }

    // 5. Ensure profile binding is saved explicitly
    const { error: upsertErr } = await adminClient.from("profiles").upsert(
      {
        id: created.user.id,
        email: cleanEmail,
        full_name: teacherRow.name,
        role: "teacher",
        teacher_id: teacherRow.id,
      },
      { onConflict: "id" }
    );

    if (upsertErr) {
      await adminClient.auth.admin.deleteUser(created.user.id).catch(() => {});
      throw new HttpError(500, upsertErr.message || "ผูกบัญชีกับรายชื่อครูไม่สำเร็จ");
    }

    return NextResponse.json({
      success: true,
      teacherName: teacherRow.name,
    });
  } catch (err) {
    return errorResponse(err, "เกิดข้อผิดพลาดในการลงทะเบียน");
  }
}
