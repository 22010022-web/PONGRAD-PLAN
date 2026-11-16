interface SendLineNotifyParams {
  title: string;
  subtitle: string;
  headerColor?: string;
  fields: { label: string; value: string }[];
  buttons?: { label: string; url: string; primary?: boolean; color?: string }[];
  altTextMessage?: string;
}

function cleanEnvValue(raw?: string): string {
  return (raw || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

export function getLineConfigStatus() {
  const token = cleanEnvValue(process.env.LINE_CHANNEL_ACCESS_TOKEN);
  const groupId = cleanEnvValue(process.env.LINE_GROUP_ID);
  return {
    configured: Boolean(token && groupId),
    hasToken: Boolean(token),
    hasGroupId: Boolean(groupId),
    token,
    groupId,
  };
}

export async function sendLineFlexNotification({
  title,
  subtitle,
  headerColor = "#1e3a8a",
  fields,
  buttons = [],
  altTextMessage,
}: SendLineNotifyParams) {
  const { token, groupId, hasToken, hasGroupId } = getLineConfigStatus();

  if (!hasToken || !hasGroupId) {
    const missing = [
      !hasToken ? "LINE_CHANNEL_ACCESS_TOKEN" : null,
      !hasGroupId ? "LINE_GROUP_ID" : null,
    ]
      .filter(Boolean)
      .join(", ");
    const reason = `ยังไม่ได้ตั้งค่า ${missing} ใน Vercel Environment Variables (หรือยังไม่ได้กด Redeploy)`;
    console.warn("LINE Notify:", reason);
    return { success: false, reason, error: reason };
  }

  const safeFields = (fields || []).filter((f) => f && f.label);
  const bodyContents = (
    safeFields.length > 0 ? safeFields : [{ label: "สถานะ", value: "อัปเดตข้อมูล" }]
  ).map((f, i) => ({
    type: "box",
    layout: "baseline",
    spacing: "sm",
    margin: i === 0 ? "none" : "md",
    contents: [
      {
        type: "text",
        text: String(f.label || "-").slice(0, 40),
        color: "#64748b",
        size: "sm",
        flex: 3,
      },
      {
        type: "text",
        text: String(f.value ?? "-").trim().slice(0, 300) || "-",
        wrap: true,
        color: "#0f172a",
        size: "sm",
        weight: "bold",
        flex: 7,
      },
    ],
  }));

  // LINE Messaging API จำกัดความยาว label ของปุ่ม URI ไม่เกิน 20 ตัวอักษร
  const footerContents = buttons
    .filter((b) => b && typeof b.url === "string" && b.url.trim().startsWith("https://"))
    .map((b) => ({
      type: "button",
      style: b.primary ? "primary" : "secondary",
      color: b.color || (b.primary ? "#2563eb" : undefined),
      height: "sm",
      action: {
        type: "uri",
        label: (String(b.label || "เปิดดู").trim() || "เปิดดู").slice(0, 20),
        uri: b.url.trim(),
      },
    }));

  const safeTitle = String(title || "แจ้งเตือนระบบส่งแผนการสอน").trim().slice(0, 100);
  const safeSubtitle = String(subtitle || "โรงเรียนวัดโป่งแรด (ปคุณวิทยาคาร)").trim().slice(0, 120);

  const bubble: Record<string, any> = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: headerColor,
      paddingAll: "16px",
      contents: [
        { type: "text", text: safeTitle, color: "#ffffff", weight: "bold", size: "md", wrap: true },
        { type: "text", text: safeSubtitle, color: "#e2e8f0", size: "xs", margin: "xs", wrap: true },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      contents: bodyContents,
    },
  };

  if (footerContents.length > 0) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "14px",
      contents: footerContents,
    };
  }

  const messageText = (
    altTextMessage || `[โรงเรียนวัดโป่งแรด] ${safeTitle} - ${safeSubtitle}`
  ).slice(0, 390);

  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [
          {
            type: "flex",
            altText: messageText,
            contents: bubble,
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("LINE Flex API Push Error:", res.status, errText);
      let friendly = `LINE API ปฏิเสธการส่ง (HTTP ${res.status}): ${errText}`;
      if (res.status === 401) {
        friendly =
          "LINE_CHANNEL_ACCESS_TOKEN ไม่ถูกต้องหรือถูกยกเลิกไปแล้ว กรุณากด Reissue ใน LINE Developers แล้วนำค่าใหม่ไปใส่ใน Vercel และกด Redeploy";
      } else if (res.status === 400 && /to/i.test(errText)) {
        friendly =
          "LINE_GROUP_ID ไม่ถูกต้อง หรือบอทยังไม่ได้อยู่ในกลุ่ม LINE นี้";
      }
      return { success: false, error: friendly, rawError: errText, status: res.status };
    }

    return { success: true };
  } catch (error: any) {
    console.error("LINE Notification Network Error:", error);
    return {
      success: false,
      error: error?.message || "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ LINE ได้",
    };
  }
}
