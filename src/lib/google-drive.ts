// ==============================================================================
// Google Drive API (Service Account) — ใช้เฉพาะฝั่งเซิร์ฟเวอร์ (API Routes) เท่านั้น
// กุญแจอ่านจาก Environment Variables บน Vercel ห้ามใส่ในโค้ดหรืออัปขึ้น GitHub
// ==============================================================================
import { drive as driveApi, auth as gauth } from "@googleapis/drive";

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];
export const FOLDER_MIME = "application/vnd.google-apps.folder";

function normalizePrivateKey(key: string): string {
  return key.replace(/\\n/g, "\n").trim();
}

function extractServiceAccountFromRaw(
  raw: string
): { client_email: string; private_key: string } | null {
  let trimmed = raw.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  const text = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8").trim();

  try {
    const parsed = JSON.parse(text);
    if (parsed?.client_email && parsed?.private_key) {
      return {
        client_email: String(parsed.client_email).trim(),
        private_key: normalizePrivateKey(String(parsed.private_key)),
      };
    }
  } catch {
    // Fall back to repairing unquoted URLs / extracting required fields
  }

  try {
    const repaired = text.replace(
      /:\s*(https?:\/\/[^,\s}"']+)"?/g,
      (_m, url) => `: "${url}"`
    );
    const parsed = JSON.parse(repaired);
    if (parsed?.client_email && parsed?.private_key) {
      return {
        client_email: String(parsed.client_email).trim(),
        private_key: normalizePrivateKey(String(parsed.private_key)),
      };
    }
  } catch {
    // Fall back to direct PEM/email extraction
  }

  const emailMatch =
    /"client_email"\s*:\s*"?([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)"?/.exec(
      text
    );
  const keyMatch =
    /"private_key"\s*:\s*"?(-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----(?:\\n|\s)*)"?/.exec(
      text
    );
  if (emailMatch?.[1] && keyMatch?.[1]) {
    return {
      client_email: emailMatch[1].trim(),
      private_key: normalizePrivateKey(keyMatch[1]),
    };
  }

  return null;
}

function getCredentials(): { client_email: string; private_key: string } {
  // แบบที่ 1: วางเนื้อหา credentials.json ทั้งไฟล์ (หรือ base64) ไว้ใน GOOGLE_SERVICE_ACCOUNT_JSON
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (rawJson && rawJson.trim()) {
    const extracted = extractServiceAccountFromRaw(rawJson);
    if (extracted) return extracted;
  }

  // แบบที่ 2: แยกเป็น 2 ตัวแปร
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (email && key) {
    return { client_email: email.trim(), private_key: normalizePrivateKey(key) };
  }

  if (rawJson && rawJson.trim()) {
    throw new Error(
      "รูปแบบ JSON ใน GOOGLE_SERVICE_ACCOUNT_JSON ไม่ถูกต้อง (แนะนำให้ใส่เฉพาะ JSON ต้นฉบับ หรือแยกใช้ GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY)"
    );
  }

  throw new Error(
    "ยังไม่ได้ตั้งค่า Google Service Account บนเซิร์ฟเวอร์ (GOOGLE_SERVICE_ACCOUNT_JSON หรือ GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY)"
  );
}

export function isUsingOAuthDrive(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim()
  );
}

let cachedAuth: InstanceType<typeof gauth.GoogleAuth> | null = null;
let cachedOAuthKey = "";
let cachedOAuthClient: InstanceType<typeof gauth.OAuth2> | null = null;

function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!.trim();
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN!.trim();
  const key = `${clientId}:${refreshToken.slice(-8)}`;
  if (!cachedOAuthClient || cachedOAuthKey !== key) {
    cachedOAuthClient = new gauth.OAuth2(clientId, clientSecret);
    cachedOAuthClient.setCredentials({ refresh_token: refreshToken });
    cachedOAuthKey = key;
  }
  return cachedOAuthClient;
}

export function getGoogleAuth() {
  if (!cachedAuth) {
    cachedAuth = new gauth.GoogleAuth({ credentials: getCredentials(), scopes: DRIVE_SCOPES });
  }
  return cachedAuth;
}

export function getDrive() {
  if (isUsingOAuthDrive()) {
    return driveApi({ version: "v3", auth: getOAuthClient() });
  }
  return driveApi({ version: "v3", auth: getGoogleAuth() });
}

export async function getAccessToken(): Promise<string> {
  const client = isUsingOAuthDrive() ? getOAuthClient() : await getGoogleAuth().getClient();
  const res = await client.getAccessToken();
  const token = typeof res === "string" ? res : res?.token;
  if (!token) throw new Error("ไม่สามารถขอ Access Token จาก Google ได้");
  return token;
}

export function getRootFolderId(): string {
  const raw = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!raw) throw new Error("ยังไม่ได้ตั้งค่า GOOGLE_DRIVE_FOLDER_ID");
  const folderMatch = /\/folders\/([a-zA-Z0-9_-]+)/.exec(raw);
  if (folderMatch?.[1]) return folderMatch[1];
  const idMatch = /[?&]id=([a-zA-Z0-9_-]+)/.exec(raw);
  if (idMatch?.[1]) return idMatch[1];
  return raw;
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

export async function findSubfolder(
  folderName: string,
  parentFolderId?: string
): Promise<string | null> {
  const drive = getDrive();
  const parentId = parentFolderId || getRootFolderId();
  const name = sanitizeFileName(folderName || "ไม่ระบุชื่อ");

  const found = await drive.files.list({
    q: `name = '${escapeQuery(name)}' and mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  return found.data.files?.[0]?.id || null;
}

// หา (หรือสร้าง) โฟลเดอร์ย่อยภายใต้ parentFolderId (ค่าเริ่มต้นคือโฟลเดอร์หลักของโรงเรียน)
export async function ensureSubfolder(
  folderName: string,
  parentFolderId?: string
): Promise<string> {
  const existing = await findSubfolder(folderName, parentFolderId);
  if (existing) return existing;

  const drive = getDrive();
  const parentId = parentFolderId || getRootFolderId();
  const name = sanitizeFileName(folderName || "ไม่ระบุชื่อ");

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error("สร้างโฟลเดอร์ใน Google Drive ไม่สำเร็จ");
  return created.data.id;
}

// สร้างโครงสร้างโฟลเดอร์: โฟลเดอร์โรงเรียน -> ชื่อครู -> รายวิชา (หากระบุวิชา)
export async function ensureTeacherSubjectFolder(
  teacherName: string,
  subjectName?: string
): Promise<string> {
  const teacherFolderId = await ensureSubfolder(teacherName || "ไม่ระบุชื่อ");
  const cleanSubject = (subjectName || "").trim();
  if (!cleanSubject) {
    return teacherFolderId;
  }
  return ensureSubfolder(cleanSubject, teacherFolderId);
}

// หาลำดับไฟล์ถัดไปในโฟลเดอร์ (เช่น 001, 002, 003...) เพื่อจัดเรียงก่อน-หลังได้แม่นยำ
export async function getNextSubmissionSequence(folderId: string): Promise<number> {
  const drive = getDrive();
  const listRes = await drive.files.list({
    q: `'${folderId}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });

  const files = listRes.data.files || [];
  let maxSeq = 0;
  for (const f of files) {
    const fname = f.name || "";
    const match = /^(\d{1,4})_/.exec(fname);
    if (match?.[1]) {
      maxSeq = Math.max(maxSeq, Number(match[1]));
    }
  }
  return Math.max(files.length, maxSeq) + 1;
}

// ตรวจว่าไฟล์อยู่ในโฟลเดอร์ของโรงเรียนหรือโฟลเดอร์เป้าหมาย (รองรับทั้งโฟลเดอร์ครูและโฟลเดอร์แยกวิชา)
export async function isInsideSchoolFolder(
  fileId: string,
  ancestorFolderId?: string
): Promise<boolean> {
  const drive = getDrive();
  const targetId = ancestorFolderId || getRootFolderId();
  const visited = new Set<string>();
  let frontier: string[] = [fileId];

  for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    for (const currentId of frontier) {
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const item = await drive.files.get({
        fileId: currentId,
        fields: "parents",
        supportsAllDrives: true,
      });
      const parents = item.data.parents || [];
      if (parents.includes(targetId)) return true;
      nextFrontier.push(...parents);
    }
    frontier = nextFrontier;
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
