import { NextResponse } from "next/server";
import { createAdminSupabase, errorResponse, HttpError, requireUser } from "@/lib/server-auth";
import { uploadCmsMediaFile } from "@/lib/cms-storage";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await requireUser(req, { admin: true });
    const adminClient = createAdminSupabase();
    if (!adminClient) {
      return NextResponse.json({ fallback: true, reason: "no_service_role_key" });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const folderRaw = String(formData.get("folder") || "news");
    const folder = folderRaw === "banners" ? "banners" : "news";

    if (!(file instanceof File)) {
      throw new HttpError(400, "ไม่พบไฟล์รูปภาพที่อัปโหลด");
    }

    const publicUrl = await uploadCmsMediaFile(adminClient, file, folder);
    return NextResponse.json({ success: true, url: publicUrl });
  } catch (err) {
    return errorResponse(err, "อัปโหลดรูปภาพไม่สำเร็จ");
  }
}
