import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { requireUser, errorResponse } from "@/lib/server-auth";
import {
  allowAnyoneWithLinkToView,
  drivePreviewUrl,
  driveViewUrl,
  ensureSubfolder,
  explainDriveError,
  extractDriveFileId,
  getDrive,
} from "@/lib/google-drive";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SignRequestBody {
  fileId?: string;
  fileUrl?: string;
  signatureDataUrl: string;
  pageChoice?: "first" | "last";
  position?: "bottom-right" | "bottom-center" | "bottom-left";
  teacherName?: string;
  taskCode?: string;
  signDateText?: string;
}

function parsePngDataUrl(dataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) {
    throw new Error("รูปแบบลายเซ็นไม่ถูกต้อง (ต้องเป็น PNG Data URL)");
  }
  return Uint8Array.from(Buffer.from(match[1], "base64"));
}

export async function POST(req: Request) {
  try {
    await requireUser(req, { admin: true });
    const body = (await req.json()) as SignRequestBody;

    const sourceFileId = body.fileId?.trim() || extractDriveFileId(body.fileUrl);
    if (!sourceFileId) {
      return NextResponse.json(
        { error: "ไม่พบ Google Drive File ID ของเอกสารต้นฉบับ" },
        { status: 400 }
      );
    }

    if (!body.signatureDataUrl) {
      return NextResponse.json(
        { error: "กรุณาวาดลายเซ็นก่อนบันทึก" },
        { status: 400 }
      );
    }

    const pngBytes = parsePngDataUrl(body.signatureDataUrl);
    const drive = getDrive();

    // 1. Fetch source file metadata
    const metaRes = await drive.files.get({
      fileId: sourceFileId,
      fields: "id, name, mimeType, parents",
      supportsAllDrives: true,
    });

    const sourceName = metaRes.data.name || "document.pdf";
    const mimeType = metaRes.data.mimeType || "";
    if (mimeType && mimeType !== "application/pdf") {
      return NextResponse.json(
        {
          error: `ไฟล์ต้นฉบับไม่ใช่ PDF (${mimeType}) จึงไม่สามารถฝังลายเซ็นลงในไฟล์ได้โดยตรง`,
        },
        { status: 400 }
      );
    }

    // 2. Download PDF bytes directly from Google Drive (bypasses Vercel 4.5MB limit)
    const fileRes = await drive.files.get(
      { fileId: sourceFileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    const pdfBytes = new Uint8Array(fileRes.data as ArrayBuffer);

    // 3. Embed signature image into PDF
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    if (pages.length === 0) {
      return NextResponse.json({ error: "ไฟล์ PDF ไม่มีหน้าเอกสาร" }, { status: 400 });
    }

    const targetPage =
      body.pageChoice === "first" ? pages[0] : pages[pages.length - 1];
    const { width: pageWidth } = targetPage.getSize();

    const sigImage = await pdfDoc.embedPng(pngBytes);
    const sigWidth = Math.min(180, pageWidth * 0.32);
    const sigHeight = (sigImage.height / sigImage.width) * sigWidth;

    const marginX = 42;
    const marginY = 48;
    let x = pageWidth - sigWidth - marginX;
    if (body.position === "bottom-center") {
      x = (pageWidth - sigWidth) / 2;
    } else if (body.position === "bottom-left") {
      x = marginX;
    }
    const y = marginY;

    targetPage.drawImage(sigImage, {
      x,
      y,
      width: sigWidth,
      height: sigHeight,
    });

    // Draw ASCII-safe date stamp under signature if provided
    const asciiDate = (body.signDateText || "")
      .replace(/[^\x20-\x7E]/g, "")
      .trim();
    if (asciiDate) {
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontSize = 9;
      const textWidth = font.widthOfTextAtSize(asciiDate, fontSize);
      targetPage.drawText(asciiDate, {
        x: x + Math.max(0, (sigWidth - textWidth) / 2),
        y: Math.max(18, y - 12),
        size: fontSize,
        font,
        color: rgb(0.2, 0.25, 0.35),
      });
    }

    const signedPdfBytes = Buffer.from(await pdfDoc.save());

    // 4. Upload signed PDF into teacher's subfolder in Google Drive
    const folderName = body.teacherName?.trim() || "เอกสารลงนามแล้ว";
    const targetFolderId = await ensureSubfolder(folderName);
    const cleanSourceName = sourceName.replace(/^\[ผอ\.ลงนาม\]_/, "");
    const prefix = body.taskCode ? `[ผอ.ลงนาม]_${body.taskCode}_` : "[ผอ.ลงนาม]_";
    const signedFileName = cleanSourceName.startsWith(prefix)
      ? cleanSourceName
      : `${prefix}${cleanSourceName}`;

    const uploadRes = await drive.files.create({
      requestBody: {
        name: signedFileName,
        parents: [targetFolderId],
        mimeType: "application/pdf",
      },
      media: {
        mimeType: "application/pdf",
        body: Readable.from(signedPdfBytes),
      },
      fields: "id, name",
      supportsAllDrives: true,
    });

    const newFileId = uploadRes.data.id;
    if (!newFileId) {
      throw new Error("อัปโหลดไฟล์ที่ลงนามแล้วไม่สำเร็จ (ไม่ได้รับ File ID)");
    }

    await allowAnyoneWithLinkToView(newFileId);

    return NextResponse.json({
      fileId: newFileId,
      fileName: uploadRes.data.name || signedFileName,
      previewUrl: drivePreviewUrl(newFileId),
      viewUrl: driveViewUrl(newFileId),
    });
  } catch (err) {
    const message = explainDriveError(err);
    return errorResponse(new Error(message), "เกิดข้อผิดพลาดระหว่างลงนามเอกสาร");
  }
}
