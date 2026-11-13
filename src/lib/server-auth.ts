// ตรวจสอบผู้ใช้ฝั่งเซิร์ฟเวอร์จาก Supabase Access Token ที่หน้าเว็บส่งมา (Authorization: Bearer ...)
import { NextResponse } from "next/server";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AuthedContext {
  user: User;
  profile: { id: string; full_name: string; role: "admin" | "teacher"; teacher_id: string | null } | null;
  supabase: SupabaseClient; // client ที่ทำงานด้วยสิทธิ์ของผู้ใช้คนนั้น (RLS ยังคุมอยู่)
}

export async function requireUser(req: Request, opts: { admin?: boolean } = {}): Promise<AuthedContext> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new HttpError(500, "ยังไม่ได้ตั้งค่า Supabase บนเซิร์ฟเวอร์");

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "กรุณาเข้าสู่ระบบก่อนใช้งาน");

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, teacher_id")
    .eq("id", data.user.id)
    .single();

  if (opts.admin && profile?.role !== "admin") {
    throw new HttpError(403, "เฉพาะผู้บริหารสถานศึกษา (ผอ.) เท่านั้นที่ทำรายการนี้ได้");
  }

  return { user: data.user, profile: (profile as AuthedContext["profile"]) ?? null, supabase };
}

export function createAdminSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function errorResponse(err: unknown, fallback = "เกิดข้อผิดพลาดในเซิร์ฟเวอร์") {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = (err as { message?: string })?.message || fallback;
  console.error(err);
  return NextResponse.json({ error: message }, { status: 500 });
}
