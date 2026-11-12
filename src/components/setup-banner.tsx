"use client";

import { useState } from "react";
import { useAuth } from "@/context/auth-context";
import { SUPABASE_SCHEMA_SQL } from "@/lib/supabase/schema-sql";
import { getSupabaseProjectRef } from "@/lib/supabase/client";
import { AlertTriangle, Copy, Check, ExternalLink, RefreshCw } from "lucide-react";

export function SetupBanner() {
  const { isConfigured, isSchemaReady, checkSchema } = useAuth();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  const projectRef = getSupabaseProjectRef();
  const sqlEditorUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
    : "https://supabase.com/dashboard";

  if (isConfigured && isSchemaReady) return null;

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      const el = document.createElement("textarea");
      el.value = SUPABASE_SCHEMA_SQL;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleRefresh = async () => {
    setChecking(true);
    await checkSchema();
    setTimeout(() => setChecking(false), 600);
  };

  return (
    <div className="bg-amber-950 border-b border-amber-500/40 text-amber-100 px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            {!isConfigured ? (
              <span>
                <strong>ยังไม่ได้เชื่อมต่อ Supabase:</strong> กรุณาตั้งค่า <code>NEXT_PUBLIC_SUPABASE_URL</code> ใน <code>.env.local</code> หรือ Vercel
              </span>
            ) : (
              <span>
                <strong>ฐานข้อมูลยังไม่พร้อมใช้งาน:</strong> กดปุ่ม <strong>&quot;1. คัดลอกโค้ด SQL&quot;</strong> แล้วกดปุ่ม <strong>&quot;2. เปิด SQL Editor&quot;</strong> เพื่อวางและกด Run ได้ทันที
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={copySql}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold shadow-sm transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "คัดลอก SQL แล้ว!" : "1. คัดลอกโค้ด SQL"}</span>
          </button>

          <a
            href={sqlEditorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-sm transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>2. เปิด SQL Editor</span>
          </a>

          {isConfigured && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={checking}
              className="p-1.5 text-amber-300 hover:text-white rounded-lg hover:bg-amber-900/50"
            >
              <RefreshCw className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
