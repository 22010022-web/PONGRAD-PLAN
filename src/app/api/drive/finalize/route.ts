// หลังอัปโหลดเสร็จ: ตรวจว่าไฟล์อยู่ในโฟลเดอร์โรงเรียน แล้วเปิดสิทธิ์ดูผ่านลิงก์ เพื่อแสดงผลบนหน้าเว็บ
import { NextResponse } from "next/server";
import { requireUser, errorResponse, HttpError } from "@/lib/server-auth";
import {
  getDrive,
  isInsideSchoolFolder,
  allowAnyoneWithLinkToView,
  drivePreviewUrl,
  driveViewUrl,
  explainDriveError,
} from "@/lib/google-drive";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { user, profile, supabase } = await requireUser(req);
    const { fileId, replaceFileId, planId } = await req.json();
    if (!fileId || typeof fileId !== "string") throw new HttpError(400, "ไม่พบรหัสไฟล์");

    try {
      if (!(await isInsideSchoolFolder(fileId))) {
        throw new HttpError(403, "ไฟล์นี้ไม่ได้อยู่ในโฟลเดอร์ของโรงเรียน");
      }
      const meta = await getDrive().files.get({
        fileId,
        fields: "id, name, size, mimeType",
        supportsAllDrives: true,
      });
      const shared = await allowAnyoneWithLinkToView(fileId);

      // หากเป็นการส่งไฟล์ใหม่แทนไฟล์เดิม ให้ย้ายไฟล์เดิมลงถังขยะแบบ best-effort
      if (
        replaceFileId &&
        typeof replaceFileId === "string" &&
        replaceFileId !== fileId &&
        planId &&
        typeof planId === "string"
      ) {
        try {
          const { data: planRow } = await supabase
            .from("lesson_plans")
            .select("id, created_by, plan_file_id, post_file_id")
            .eq("id", planId)
            .single();

          const canReplace =
            planRow &&
            (profile?.role === "admin" || planRow.created_by === user.id) &&
            (planRow.plan_file_id === replaceFileId || planRow.post_file_id === replaceFileId);

          if (canReplace && (await isInsideSchoolFolder(replaceFileId))) {
            await getDrive().files.update({
              fileId: replaceFileId,
              requestBody: { trashed: true },
              supportsAllDrives: true,
            });
          }
        } catch (trashErr) {
          console.warn("Could not trash replaced file:", trashErr);
        }
      }

      return NextResponse.json({
        fileId,
        name: meta.data.name,
        size: Number(meta.data.size || 0),
        previewUrl: drivePreviewUrl(fileId),
        viewUrl: driveViewUrl(fileId),
        sharedByLink: shared,
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, explainDriveError(err));
    }
  } catch (err) {
    return errorResponse(err);
  }
}
