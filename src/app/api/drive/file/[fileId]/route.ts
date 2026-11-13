import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/server-auth";
import { explainDriveError, getDrive, isInsideSchoolFolder } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    await requireUser(req);
    const { fileId } = await params;

    if (!fileId || !/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
      return NextResponse.json({ error: "รหัสไฟล์ไม่ถูกต้อง" }, { status: 400 });
    }

    const inside = await isInsideSchoolFolder(fileId);
    if (!inside) {
      return NextResponse.json(
        { error: "ไม่อนุญาตให้เข้าถึงไฟล์นอกโฟลเดอร์โรงเรียน" },
        { status: 403 }
      );
    }

    const drive = getDrive();
    const meta = await drive.files.get({
      fileId,
      fields: "name, mimeType",
      supportsAllDrives: true,
    });

    const mediaRes = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );

    const fileName = encodeURIComponent(meta.data.name || "document.pdf");
    const mimeType = meta.data.mimeType || "application/pdf";

    return new NextResponse(Buffer.from(mediaRes.data as ArrayBuffer), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${fileName}`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    const message = explainDriveError(err);
    return errorResponse(new Error(message), "ไม่สามารถดึงไฟล์จาก Google Drive ได้");
  }
}
