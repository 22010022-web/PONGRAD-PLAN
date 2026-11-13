import { supabase } from "@/lib/supabase/client";

export interface DriveUploadResult {
  fileId: string;
  previewUrl: string;
  viewUrl: string;
  fileName: string;
}

export interface DriveUploadOptions {
  kind?: "plan" | "post" | "review";
  replaceFileId?: string | null;
  planId?: string;
}

export async function uploadPdfToGoogleDrive(
  file: File,
  teacherName: string,
  onProgress?: (percent: number) => void,
  options?: DriveUploadOptions
): Promise<DriveUploadResult> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("กรุณาเลือกไฟล์ PDF (.pdf) เท่านั้น");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };

  onProgress?.(5);

  // 1. Request Resumable Upload URL from backend (Service Account)
  const sessionRes = await fetch("/api/drive/upload-session", {
    method: "POST",
    headers,
    body: JSON.stringify({
      fileName: file.name,
      mimeType: "application/pdf",
      teacherName,
      fileSize: file.size,
      kind: options?.kind || "plan",
    }),
  });

  const sessionData = await sessionRes.json();
  if (!sessionRes.ok || !sessionData.uploadUrl) {
    throw new Error(sessionData.error || "ไม่สามารถเริ่มอัปโหลดไปยัง Google Drive ได้");
  }

  // 2. Upload file directly from browser to Google Drive (bypasses Vercel 4.5MB limit)
  const uploadedFileId = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionData.uploadUrl, true);
    xhr.setRequestHeader("Content-Type", "application/pdf");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const pct = Math.min(92, Math.round((event.loaded / event.total) * 85) + 7);
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (parsed.id) {
            resolve(parsed.id as string);
            return;
          }
        } catch {
          // ignore parse error
        }
        reject(new Error("อัปโหลดเสร็จแล้ว แต่ไม่ได้รับ File ID จาก Google Drive"));
      } else {
        reject(
          new Error(
            `อัปโหลดไปยัง Google Drive ไม่สำเร็จ (HTTP ${xhr.status})`
          )
        );
      }
    };

    xhr.onerror = () => {
      reject(new Error("เกิดข้อผิดพลาดเครือข่ายระหว่างอัปโหลดไฟล์ไป Google Drive"));
    };

    xhr.send(file);
  });

  onProgress?.(95);

  // 3. Finalize permissions (anyone with link can view)
  const finalizeRes = await fetch("/api/drive/finalize", {
    method: "POST",
    headers,
    body: JSON.stringify({
      fileId: uploadedFileId,
      replaceFileId: options?.replaceFileId || undefined,
      planId: options?.planId || undefined,
    }),
  });

  const finalizeData = await finalizeRes.json();
  if (!finalizeRes.ok) {
    throw new Error(finalizeData.error || "ตั้งค่าสิทธิ์ไฟล์ใน Google Drive ไม่สำเร็จ");
  }

  onProgress?.(100);

  return {
    fileId: uploadedFileId,
    previewUrl: finalizeData.previewUrl,
    viewUrl: finalizeData.viewUrl,
    fileName: file.name,
  };
}
