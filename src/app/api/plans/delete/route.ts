import { NextResponse } from "next/server";
import { requireUser, errorResponse, HttpError } from "@/lib/server-auth";
import { getDrive, isInsideSchoolFolder } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { user, profile, supabase } = await requireUser(req);
    const { planId } = await req.json();

    if (!planId || typeof planId !== "string") {
      throw new HttpError(400, "ไม่พบรหัสแผนการสอนที่ต้องการลบ");
    }

    // ตรวจสอบข้อมูลเดิมก่อนลบเพื่อให้ข้อความแจ้งเตือนชัดเจน
    const { data: existing, error: fetchErr } = await supabase
      .from("lesson_plans")
      .select("id, status, created_by, plan_file_id, post_file_id")
      .eq("id", planId)
      .single();

    if (fetchErr || !existing) {
      throw new HttpError(404, "ไม่พบแผนการสอนนี้ในระบบ");
    }

    const isAdmin = profile?.role === "admin";
    const isOwner = existing.created_by === user.id;

    if (!isAdmin) {
      if (!isOwner) {
        throw new HttpError(403, "คุณไม่มีสิทธิ์ลบแผนของผู้อื่น");
      }
      if (existing.status !== "รอตรวจแผน") {
        throw new HttpError(
          403,
          "ลบได้เฉพาะแผนที่เพิ่งส่งในครั้งแรก (สถานะ 'รอตรวจแผน') เท่านั้น หากผ่านหรือเสร็จสมบูรณ์แล้วเฉพาะ ผอ./แอดมิน ลบได้"
        );
      }
    }

    // ลบจาก Supabase (RLS จะตรวจสอบสิทธิ์ซ้ำอีกครั้งฝั่งฐานข้อมูล)
    const { data: deletedRows, error: delErr } = await supabase
      .from("lesson_plans")
      .delete()
      .eq("id", planId)
      .select("id");

    if (delErr) {
      throw new HttpError(403, delErr.message || "ไม่สามารถลบแผนการสอนได้");
    }

    if (!deletedRows || deletedRows.length === 0) {
      throw new HttpError(
        403,
        "ไม่สามารถลบแผนนี้ได้ (กรุณาตรวจสอบสิทธิ์ หรือเฉพาะ ผอ./แอดมิน เท่านั้นที่ลบได้)"
      );
    }

    // ย้ายไฟล์ใน Google Drive ลงถังขยะแบบ best-effort (เฉพาะไฟล์ในโฟลเดอร์โรงเรียน)
    const fileIds = [existing.plan_file_id, existing.post_file_id].filter(
      (id): id is string => Boolean(id && typeof id === "string")
    );

    if (fileIds.length > 0) {
      const drive = getDrive();
      await Promise.all(
        fileIds.map(async (fid) => {
          try {
            if (await isInsideSchoolFolder(fid)) {
              await drive.files.update({
                fileId: fid,
                requestBody: { trashed: true },
                supportsAllDrives: true,
              });
            }
          } catch (driveErr) {
            console.warn("Best-effort trash failed for file:", fid, driveErr);
          }
        })
      );
    }

    return NextResponse.json({ success: true, deletedId: planId });
  } catch (err) {
    return errorResponse(err, "เกิดข้อผิดพลาดในการลบแผนการสอน");
  }
}
