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
    await requireUser(req);
    const { fileId } = await req.json();
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
