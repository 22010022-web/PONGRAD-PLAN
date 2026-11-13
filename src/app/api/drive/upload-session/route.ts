// ขอ "ลิงก์อัปโหลด" (Resumable Upload Session) จาก Google Drive ด้วย Service Account
// หน้าเว็บจะอัปโหลดไฟล์ตรงไปที่ Google เลย จึงไม่ติดข้อจำกัดขนาด 4.5MB ของ Vercel
import { NextResponse } from "next/server";
import { requireUser, errorResponse, HttpError } from "@/lib/server-auth";
import {
  ensureSubfolder,
  getAccessToken,
  getDrive,
  isUsingOAuthDrive,
  sanitizeFileName,
  explainDriveError,
} from "@/lib/google-drive";

export const runtime = "nodejs";

const MAX_BYTES = 300 * 1024 * 1024; // 300 MB
const KIND_PREFIX: Record<string, string> = {
  plan: "แผน",
  post: "บันทึกหลังสอน",
  review: "ผอ.ตรวจ",
};

export async function POST(req: Request) {
  try {
    const { user, profile } = await requireUser(req);
    const body = await req.json();
    const fileName = String(body.fileName || "document.pdf");
    const fileSize = Number(body.fileSize || 0);
    const mimeType = String(body.mimeType || "application/pdf");
    const kind = KIND_PREFIX[body.kind] ? String(body.kind) : "plan";

    if (!fileSize || fileSize <= 0) throw new HttpError(400, "ไม่พบขนาดไฟล์");
    if (fileSize > MAX_BYTES) throw new HttpError(400, "ไฟล์ใหญ่เกิน 300MB กรุณาบีบอัดด้วย PDF Tools ก่อน");
    if (mimeType !== "application/pdf" && !fileName.toLowerCase().endsWith(".pdf")) {
      throw new HttpError(400, "รองรับเฉพาะไฟล์ PDF เท่านั้น");
    }

    const ownerName = profile?.full_name || user.email || "ไม่ระบุชื่อ";
    let folderId: string;
    try {
      folderId = await ensureSubfolder(ownerName);
      const folderMeta = await getDrive().files.get({
        fileId: folderId,
        fields: "id, driveId, capabilities(canAddChildren)",
        supportsAllDrives: true,
      });

      if (folderMeta.data.capabilities?.canAddChildren === false) {
        throw new HttpError(
          403,
          "บัญชี Google Drive ของระบบยังไม่มีสิทธิ์เพิ่มไฟล์ในโฟลเดอร์นี้ กรุณาให้สิทธิ์ 'ผู้จัดการเนื้อหา' (Shared Drive) หรือ 'ผู้แก้ไข'"
        );
      }

      if (!isUsingOAuthDrive() && !folderMeta.data.driveId) {
        throw new HttpError(
          403,
          "โฟลเดอร์ GOOGLE_DRIVE_FOLDER_ID อยู่ใน 'ไดรฟ์ของฉัน (My Drive)' ซึ่ง Google ไม่อนุญาตให้ Service Account อัปโหลดไฟล์ (0 GB Quota) — กรุณาใช้โฟลเดอร์ใน 'ไดรฟ์ที่แชร์ (Shared Drive)' และเพิ่ม Service Account เป็นสมาชิกสิทธิ์ 'ผู้จัดการเนื้อหา' หรือตั้งค่า Google OAuth2 (GOOGLE_OAUTH_REFRESH_TOKEN)"
        );
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, explainDriveError(err));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const targetName = sanitizeFileName(`[${KIND_PREFIX[kind]}]_${stamp}_${fileName}`);
    const accessToken = await getAccessToken();
    const forwardedHost = req.headers.get("x-forwarded-host");
    const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
    const origin =
      req.headers.get("origin") ||
      (forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(req.url).origin);

    const initRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "application/pdf",
          "X-Upload-Content-Length": String(fileSize),
          // ต้องส่ง Origin เพื่อให้เบราว์เซอร์อัปโหลดไปยังลิงก์นี้ได้ (CORS)
          Origin: origin,
        },
        body: JSON.stringify({ name: targetName, mimeType: "application/pdf", parents: [folderId] }),
      }
    );

    if (!initRes.ok) {
      const text = await initRes.text();
      throw new HttpError(502, explainDriveError({ message: text, code: initRes.status }));
    }

    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) throw new HttpError(502, "Google Drive ไม่ได้ส่งลิงก์อัปโหลดกลับมา");

    return NextResponse.json({ uploadUrl, fileName: targetName });
  } catch (err) {
    return errorResponse(err);
  }
}
