// ==============================================================================
// Google Drive API (Service Account) — ใช้เฉพาะฝั่งเซิร์ฟเวอร์ (API Routes) เท่านั้น
// กุญแจอ่านจาก Environment Variables บน Vercel ห้ามใส่ในโค้ดหรืออัปขึ้น GitHub
// ==============================================================================
import { drive as driveApi, auth as gauth } from "@googleapis/drive";

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];
export const FOLDER_MIME = "application/vnd.google-apps.folder";

function getCredentials(): { client_email: string; private_key: string } {
  // แบบที่ 1: วางเนื้อหา credentials.json ทั้งไฟล์ (หรือ base64) ไว้ใน GOOGLE_SERVICE_ACCOUNT_JSON
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (rawJson && rawJson.trim()) {
    const text = rawJson.trim().startsWith("{")
      ? rawJson
      : Buffer.from(rawJson.trim(), "base64").toString("utf8");
    const parsed = JSON.parse(text);
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  }

  // แบบที่ 2: แยกเป็น 2 ตัวแปร
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(
      "ยังไม่ได้ตั้งค่า Google Service Account บนเซิร์ฟเวอร์ (GOOGLE_SERVICE_ACCOUNT_JSON หรือ GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY)"
    );
  }
  return { client_email: email, private_key: key.replace(/\\n/g, "\n") };
}

let cachedAuth: InstanceType<typeof gauth.GoogleAuth> | null = null;

export function getGoogleAuth() {
  if (!cachedAuth) {
    cachedAuth = new gauth.GoogleAuth({ credentials: getCredentials(), scopes: DRIVE_SCOPES });
  }
  return cachedAuth;
}

export function getDrive() {
  return driveApi({ version: "v3", auth: getGoogleAuth() });
}

export async function getAccessToken(): Promise<string> {
  const client = await getGoogleAuth().getClient();
  const res = await client.getAccessToken();
  const token = typeof res === "string" ? res : res?.token;
  if (!token) throw new Error("ไม่สามารถขอ Access Token จาก Google ได้");
  return token;
}

export function getRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id) throw new Error("ยังไม่ได้ตั้งค่า GOOGLE_DRIVE_FOLDER_ID");
  return id;
}

export function extractDriveFileId(url?: string | null): string | null {
  if (!url) return null;
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m2) return m2[1];
  return null;
}

export const drivePreviewUrl = (id: string) => `https://drive.google.com/file/d/${id}/preview`;
export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

function escapeQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function sanitizeFileName(name: string) {
  return (name || "document.pdf").replace(/[\\/:*?"<>|#%]+/g, "_").slice(0, 150);
}

// หา (หรือสร้าง) โฟลเดอร์ย่อยของครูแต่ละคนภายใต้โฟลเดอร์หลักของโรงเรียน
export async function ensureSubfolder(folderName: string): Promise<string> {
  const drive = getDrive();
  const rootId = getRootFolderId();
  const name = sanitizeFileName(folderName || "ไม่ระบุชื่อ");

  const found = await drive.files.list({
    q: `name = '${escapeQuery(name)}' and mimeType = '${FOLDER_MIME}' and '${rootId}' in parents and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  const existing = found.data.files?.[0]?.id;
  if (existing) return existing;

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [rootId] },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error("สร้างโฟลเดอร์ใน Google Drive ไม่สำเร็จ");
  return created.data.id;
}

// ตรวจว่าไฟล์อยู่ในโฟลเดอร์ของโรงเรียน (โฟลเดอร์หลัก หรือโฟลเดอร์ย่อยชั้นเดียว)
export async function isInsideSchoolFolder(fileId: string): Promise<boolean> {
  const drive = getDrive();
  const rootId = getRootFolderId();
  const file = await drive.files.get({ fileId, fields: "parents", supportsAllDrives: true });
  const parents = file.data.parents || [];
  if (parents.includes(rootId)) return true;
  for (const parentId of parents) {
    const parent = await drive.files.get({ fileId: parentId, fields: "parents", supportsAllDrives: true });
    if ((parent.data.parents || []).includes(rootId)) return true;
  }
  return false;
}

// เปิดสิทธิ์ "ทุกคนที่มีลิงก์ดูได้" เพื่อให้แสดงผลใน iframe และกดเปิดจาก LINE ได้
export async function allowAnyoneWithLinkToView(fileId: string): Promise<boolean> {
  try {
    await getDrive().permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    });
    return true;
  } catch (err) {
    // บาง Shared Drive ผู้ดูแลอาจปิดการแชร์ภายนอก — ไม่ถือว่าล้มเหลวทั้งกระบวนการ
    console.warn("Cannot set anyone-with-link permission:", err);
    return false;
  }
}

export function explainDriveError(err: unknown): string {
  const anyErr = err as { message?: string; errors?: { reason?: string }[]; code?: number };
  const msg = anyErr?.message || String(err);
  const reason = anyErr?.errors?.[0]?.reason || "";
  if (reason === "storageQuotaExceeded" || /storage quota/i.test(msg)) {
    return "Service Account ไม่มีพื้นที่เก็บไฟล์ของตัวเอง — ต้องใช้โฟลเดอร์ใน Shared Drive (ไดรฟ์ที่แชร์) ของโรงเรียน แล้วเพิ่ม Service Account เป็นสมาชิกสิทธิ์ 'ผู้จัดการเนื้อหา'";
  }
  if (anyErr?.code === 404 || /File not found/i.test(msg)) {
    return "Service Account มองไม่เห็นไฟล์นี้ — ไฟล์อาจไม่ได้อยู่ในโฟลเดอร์ของโรงเรียน หรือยังไม่ได้แชร์ให้ Service Account";
  }
  if (anyErr?.code === 403) {
    return "Service Account ไม่มีสิทธิ์ในไฟล์/โฟลเดอร์นี้ — กรุณาแชร์โฟลเดอร์ให้อีเมล Service Account เป็น 'ผู้แก้ไข' หรือ 'ผู้จัดการเนื้อหา'";
  }
  return msg;
}
