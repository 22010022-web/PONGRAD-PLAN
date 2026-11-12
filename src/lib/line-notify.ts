interface SendLineNotifyParams {
  title: string;
  subtitle: string;
  headerColor?: string;
  fields: { label: string; value: string }[];
  buttons?: { label: string; url: string; primary?: boolean; color?: string }[];
  altTextMessage?: string;
}

export async function sendLineFlexNotification({
  title,
  subtitle,
  headerColor = "#1e3a8a",
  fields,
  buttons = [],
  altTextMessage,
}: SendLineNotifyParams) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;

  if (!token || !groupId) {
    console.warn("LINE Notify: Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_GROUP_ID");
    return { success: false, reason: "Configuration missing" };
  }

  const bodyContents = fields.map((f, i) => ({
    type: "box",
    layout: "baseline",
    spacing: "sm",
    margin: i === 0 ? "none" : "md",
    contents: [
      { type: "text", text: f.label, color: "#64748b", size: "sm", flex: 3 },
      { type: "text", text: f.value || "-", wrap: true, color: "#0f172a", size: "sm", weight: "bold", flex: 7 },
    ],
  }));

  const footerContents = buttons
    .filter((b) => b.url && b.url.startsWith("https://"))
    .map((b) => ({
      type: "button",
      style: b.primary ? "primary" : "secondary",
      color: b.color || (b.primary ? "#2563eb" : undefined),
      height: "sm",
      action: {
        type: "uri",
        label: b.label,
        uri: b.url,
      },
    }));

  const bubble: any = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: headerColor,
      paddingAll: "16px",
      contents: [
        { type: "text", text: title, color: "#ffffff", weight: "bold", size: "md" },
        { type: "text", text: subtitle, color: "#e2e8f0", size: "xs", margin: "xs" },
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

  const messageText = altTextMessage || `[โรงเรียนวัดโป่งแรด] ${title} - ${subtitle}`;

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
      console.error("LINE Flex API Push Error:", errText);
      return { success: false, error: errText };
    }

    return { success: true };
  } catch (error) {
    console.error("LINE Notification Network Error:", error);
    return { success: false, error };
  }
}
