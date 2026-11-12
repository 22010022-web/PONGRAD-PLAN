"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabase/client";
import { UploadCloud, CheckCircle2, FileText, AlertCircle, ArrowLeft } from "lucide-react";

export default function SubmitPlanPage() {
  const { user, profile, teacher } = useAuth();
  const router = useRouter();

  const [scopeType, setScopeType] = useState<"term" | "unit" | "week">("term");
  const [scopeValue, setScopeValue] = useState("รายภาคเรียน (รวมเล่มเทอม 2/2569)");
  const [unitTitle, setUnitTitle] = useState("");
  const [subject, setSubject] = useState(teacher?.default_subject || "ภาษาไทย");
  const [classLevel, setClassLevel] = useState(teacher?.grade_level || "ป.1");
  const [fileUrl, setFileUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (scopeType === "term") {
      setScopeValue("รายภาคเรียน (รวมเล่มเทอม 2/2569)");
    } else if (scopeType === "unit") {
      setScopeValue("หน่วยการเรียนรู้ที่ 1");
    } else {
      setScopeValue("สัปดาห์ที่ 1 (พ.ย.)");
    }
  }, [scopeType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setErrorMsg("กรุณาเข้าสู่ระบบก่อนส่งแผนการสอน");
      return;
    }
    if (!fileUrl.trim().startsWith("http")) {
      setErrorMsg("กรุณาระบุลิงก์ไฟล์ PDF จาก Google Drive ที่ถูกต้อง");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const taskCode = "T" + new Date().getTime();
      const teacherName = profile?.full_name || teacher?.name || user.email || "ครูผู้สอน";
      const teacherId = profile?.teacher_id || teacher?.id || "00000000-0000-0000-0001-000000000001";

      const newPlan = {
        task_code: taskCode,
        teacher_id: teacherId,
        teacher_name: teacherName,
        subject,
        class_level: classLevel,
        scope_type: scopeType,
        scope_value: scopeValue,
        unit_title: unitTitle.trim() || null,
        plan_file_url: fileUrl.trim(),
        status: "รอตรวจแผน",
        created_by: user.id,
      };

      const { error: insertErr } = await supabase.from("lesson_plans").insert([newPlan]);

      if (insertErr) throw insertErr;

      // ส่งแจ้งเตือนเข้า LINE กลุ่มโรงเรียน
      try {
        await fetch("/api/line-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: "plan_submitted",
            planData: {
              ...newPlan,
              version: 1,
            },
          }),
        });
      } catch (lineErr) {
        console.warn("LINE Notify failed:", lineErr);
      }

      setSuccessMsg("ส่งแผนการจัดการเรียนรู้เรียบร้อยแล้ว! ข้อมูลแจ้งเตือนเข้า LINE กลุ่มโรงเรียนแล้วครับ");
      setTimeout(() => {
        router.push("/my-plans");
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto my-6 p-6 sm:p-8 glass-panel rounded-3xl border border-white/80 shadow-xl">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200/60">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-white/60 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-800">
            แบบฟอร์มส่งแผนการจัดการเรียนรู้
          </h1>
          <p className="text-xs text-slate-500">
            ส่งได้ทั้งแบบ รวมเล่มรายภาคเรียน, รายหน่วยการเรียนรู้ (1–36) และ รายสัปดาห์ (1–20)
          </p>
        </div>
      </div>

      {successMsg && (
        <div className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* เลือกรอยต่อรูปแบบการส่ง */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-2">
            1. เลือกรูปแบบการส่งแผนการสอน (เลือกได้ตามความพร้อม)
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setScopeType("term")}
              className={`p-3 rounded-2xl text-xs sm:text-sm font-bold border transition-all ${
                scopeType === "term"
                  ? "bg-amber-500 text-white border-amber-600 shadow-md"
                  : "bg-white/80 text-slate-600 border-slate-200 hover:bg-white"
              }`}
            >
              📚 รวมเล่มรายภาคเรียน
            </button>
            <button
              type="button"
              onClick={() => setScopeType("unit")}
              className={`p-3 rounded-2xl text-xs sm:text-sm font-bold border transition-all ${
                scopeType === "unit"
                  ? "bg-pink-600 text-white border-pink-700 shadow-md"
                  : "bg-white/80 text-slate-600 border-slate-200 hover:bg-white"
              }`}
            >
              📑 รายหน่วยการเรียนรู้
            </button>
            <button
              type="button"
              onClick={() => setScopeType("week")}
              className={`p-3 rounded-2xl text-xs sm:text-sm font-bold border transition-all ${
                scopeType === "week"
                  ? "bg-sky-600 text-white border-sky-700 shadow-md"
                  : "bg-white/80 text-slate-600 border-slate-200 hover:bg-white"
              }`}
            >
              📅 รายสัปดาห์
            </button>
          </div>
        </div>

        {/* Dropdown ประเภทย่อย */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            2. ระบุหน่วย / ภาคเรียน / สัปดาห์
          </label>
          {scopeType === "term" && (
            <select
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800"
            >
              <option value="รายภาคเรียน (รวมเล่มเทอม 2/2569)">ส่งรวมเล่ม รายภาคเรียนที่ 2/2569 (1 ครั้ง/วิชา/เทอม)</option>
              <option value="รายภาคเรียน (รวมเล่มเทอม 1/2569)">ส่งรวมเล่ม รายภาคเรียนที่ 1/2569 (1 ครั้ง/วิชา/เทอม)</option>
              <option value="รายปีการศึกษา (รวมเล่มตลอดปี 2569)">ส่งรวมเล่ม ตลอดปีการศึกษา 2569</option>
            </select>
          )}

          {scopeType === "unit" && (
            <select
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800"
            >
              {Array.from({ length: 36 }, (_, i) => (
                <option key={i + 1} value={`หน่วยการเรียนรู้ที่ ${i + 1}`}>
                  หน่วยการเรียนรู้ที่ {i + 1}
                </option>
              ))}
            </select>
          )}

          {scopeType === "week" && (
            <select
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800"
            >
              {Array.from({ length: 20 }, (_, i) => (
                <option key={i + 1} value={`สัปดาห์ที่ ${i + 1}`}>
                  สัปดาห์ที่ {i + 1}
                </option>
              ))}
            </select>
          )}
        </div>

        {scopeType !== "term" && (
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              ชื่อหน่วยการเรียนรู้ / เรื่อง (ถ้ามี)
            </label>
            <input
              type="text"
              value={unitTitle}
              onChange={(e) => setUnitTitle(e.target.value)}
              placeholder="เช่น การบวกเลขสองหลัก, ตัวเรา, ปฐมนิเทศ"
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800"
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">รายวิชา</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800 font-medium"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">ระดับชั้น</label>
            <input
              type="text"
              value={classLevel}
              onChange={(e) => setClassLevel(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800 font-medium"
            />
          </div>
        </div>

        {/* ลิงก์ไฟล์ PDF Google Drive */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
          <label className="block text-xs font-bold text-slate-700 mb-1">
            ลิงก์ไฟล์ PDF แผนการสอน (จาก Google Drive)
          </label>
          <p className="text-[11px] text-slate-500 mb-2">
            อัปโหลดไฟล์ PDF ขึ้น Google Drive แล้วกด &quot;คัดลอกลิงก์ (แชร์แบบทุกคนที่มีลิงก์ดูได้)&quot; นำมาวางที่นี่
          </p>
          <div className="relative">
            <UploadCloud className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type="url"
              required
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm bg-white border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-pink-600 via-purple-600 to-amber-500 text-white font-bold text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-50"
        >
          {isSubmitting ? "กำลังส่งแผนและแจ้งเตือน LINE..." : "✔ ยืนยันการส่งแผนการสอน"}
        </button>
      </form>
    </div>
  );
}
