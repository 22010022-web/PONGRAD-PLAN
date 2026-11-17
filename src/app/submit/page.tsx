"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabase/client";
import { UploadCloud, CheckCircle2, FileText, AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { uploadPdfToGoogleDrive } from "@/lib/drive-upload-client";
import { PERMISSION_MEMO_PREFIX } from "@/lib/plan-ordering";

interface SelectOption {
  value: string;
  label: string;
}

const TERM_OPTIONS: SelectOption[] = [
  { value: "รายภาคเรียน (รวมเล่มเทอม 2/2569)", label: "ส่งรวมเล่ม รายภาคเรียนที่ 2/2569 (1 ครั้ง/วิชา/เทอม)" },
  { value: "รายภาคเรียน (รวมเล่มเทอม 1/2569)", label: "ส่งรวมเล่ม รายภาคเรียนที่ 1/2569 (1 ครั้ง/วิชา/เทอม)" },
  { value: "รายปีการศึกษา (รวมเล่มตลอดปี 2569)", label: "ส่งรวมเล่ม ตลอดปีการศึกษา 2569" },
];

const PERMISSION_OPTIONS: SelectOption[] = [
  {
    value: `${PERMISSION_MEMO_PREFIX} (บันทึกข้อความ) · เทอม 2/2569`,
    label: "บันทึกข้อความขออนุญาตใช้แผน (ภาคเรียนที่ 2/2569) — 1 ใบ/รายวิชา",
  },
  {
    value: `${PERMISSION_MEMO_PREFIX} (บันทึกข้อความ) · เทอม 1/2569`,
    label: "บันทึกข้อความขออนุญาตใช้แผน (ภาคเรียนที่ 1/2569) — 1 ใบ/รายวิชา",
  },
  {
    value: `${PERMISSION_MEMO_PREFIX} (บันทึกข้อความ) · ปีการศึกษา 2569`,
    label: "บันทึกข้อความขออนุญาตใช้แผน (ตลอดปีการศึกษา 2569) — 1 ใบ/รายวิชา",
  },
];

const WEEK_OPTIONS: SelectOption[] = [
  { value: "สัปดาห์ที่ 1 (พ.ย.)", label: "สัปดาห์ที่ 1 (พ.ย.)" },
  { value: "สัปดาห์ที่ 2 (พ.ย.)", label: "สัปดาห์ที่ 2 (พ.ย.)" },
  { value: "สัปดาห์ที่ 3 (พ.ย.)", label: "สัปดาห์ที่ 3 (พ.ย.)" },
  { value: "สัปดาห์ที่ 4 (พ.ย.)", label: "สัปดาห์ที่ 4 (พ.ย.)" },
  { value: "สัปดาห์ที่ 5 (ธ.ค.)", label: "สัปดาห์ที่ 5 (ธ.ค.)" },
  { value: "สัปดาห์ที่ 6 (ธ.ค.)", label: "สัปดาห์ที่ 6 (ธ.ค.)" },
  { value: "สัปดาห์ที่ 7 (ธ.ค.)", label: "สัปดาห์ที่ 7 (ธ.ค.)" },
  { value: "สัปดาห์ที่ 8 (ธ.ค.)", label: "สัปดาห์ที่ 8 (ธ.ค.)" },
  { value: "สัปดาห์ที่ 9 (ม.ค.)", label: "สัปดาห์ที่ 9 (ม.ค.)" },
  { value: "สัปดาห์ที่ 10 (ม.ค.)", label: "สัปดาห์ที่ 10 (ม.ค.)" },
  { value: "สัปดาห์ที่ 11 (ม.ค.)", label: "สัปดาห์ที่ 11 (ม.ค.)" },
  { value: "สัปดาห์ที่ 12 (ม.ค.)", label: "สัปดาห์ที่ 12 (ม.ค.)" },
  { value: "สัปดาห์ที่ 13 (ก.พ.)", label: "สัปดาห์ที่ 13 (ก.พ.)" },
  { value: "สัปดาห์ที่ 14 (ก.พ.)", label: "สัปดาห์ที่ 14 (ก.พ.)" },
  { value: "สัปดาห์ที่ 15 (ก.พ.)", label: "สัปดาห์ที่ 15 (ก.พ.)" },
  { value: "สัปดาห์ที่ 16 (ก.พ.)", label: "สัปดาห์ที่ 16 (ก.พ.)" },
  { value: "สัปดาห์ที่ 17 (มี.ค.)", label: "สัปดาห์ที่ 17 (มี.ค.)" },
  { value: "สัปดาห์ที่ 18 (มี.ค.)", label: "สัปดาห์ที่ 18 (มี.ค.)" },
  { value: "สัปดาห์ที่ 19 (มี.ค.)", label: "สัปดาห์ที่ 19 (มี.ค.)" },
  { value: "สัปดาห์ที่ 20 (มี.ค.)", label: "สัปดาห์ที่ 20 (มี.ค.)" },
];

const EARLY_SUBJECTS: SelectOption[] = [
  { value: "แผนการจัดประสบการณ์เรียนรู้ปฐมวัย", label: "แผนการจัดประสบการณ์เรียนรู้ปฐมวัย" },
];

const ELEM_SUBJECTS: SelectOption[] = [
  { value: "ภาษาไทย", label: "ภาษาไทย" },
  { value: "คณิตศาสตร์", label: "คณิตศาสตร์" },
  { value: "วิทยาศาสตร์และเทคโนโลยี", label: "วิทยาศาสตร์และเทคโนโลยี" },
  { value: "คอมพิวเตอร์ (วิทยาการคำนวณ)", label: "คอมพิวเตอร์ (วิทยาการคำนวณ)" },
  { value: "ภาษาอังกฤษพื้นฐาน", label: "ภาษาอังกฤษพื้นฐาน" },
  { value: "ภาษาอังกฤษเพิ่มเติม", label: "ภาษาอังกฤษเพิ่มเติม" },
  { value: "สุขศึกษาและพลศึกษา", label: "สุขศึกษาและพลศึกษา" },
  { value: "สังคมศึกษา ศาสนา และวัฒนธรรม", label: "สังคมศึกษา ศาสนา และวัฒนธรรม" },
  { value: "ประวัติศาสตร์", label: "ประวัติศาสตร์" },
  { value: "ศิลปะ", label: "ศิลปะ (ทัศนศิลป์ / ดนตรี / นาฏศิลป์)" },
  { value: "การงานอาชีพ", label: "การงานอาชีพ" },
  { value: "หน้าที่พลเมือง / ต้านทุจริตศึกษา", label: "หน้าที่พลเมือง / ต้านทุจริตศึกษา" },
  { value: "กิจกรรมพัฒนาผู้เรียน", label: "กิจกรรมพัฒนาผู้เรียน (แนะแนว / ลูกเสือ / ชุมนุม)" },
];

const EARLY_CLASSES: SelectOption[] = [
  { value: "ปฐมวัย", label: "ปฐมวัย (รวม)" },
  { value: "อ.1", label: "อนุบาล 1 (อ.1)" },
  { value: "อ.2", label: "อนุบาล 2 (อ.2)" },
  { value: "อ.3", label: "อนุบาล 3 (อ.3)" },
];

const ELEM_CLASSES: SelectOption[] = [
  { value: "ป.1", label: "ประถมศึกษาปีที่ 1 (ป.1)" },
  { value: "ป.2", label: "ประถมศึกษาปีที่ 2 (ป.2)" },
  { value: "ป.3", label: "ประถมศึกษาปีที่ 3 (ป.3)" },
  { value: "ป.4", label: "ประถมศึกษาปีที่ 4 (ป.4)" },
  { value: "ป.5", label: "ประถมศึกษาปีที่ 5 (ป.5)" },
  { value: "ป.6", label: "ประถมศึกษาปีที่ 6 (ป.6)" },
];

function extractDefaultClass(gradeLevel?: string): string {
  const match = /(ป\.[1-6]|อ\.[1-3]|ปฐมวัย)/.exec(gradeLevel || "");
  return match?.[1] || "ป.1";
}

export default function SubmitPlanPage() {
  const { user, profile, teacher, isAdmin } = useAuth();
  const router = useRouter();

  const teacherProfileConfig = useMemo(() => {
    const name = profile?.full_name || teacher?.name || "";
    const isEarly =
      teacher?.category === "early_childhood" ||
      name.includes("ธารารัตน์") ||
      name.includes("นภาวรรณ");
    const isP1Only = name.includes("ณิชนันทน์");

    if (isEarly) {
      return {
        mode: "early" as const,
        defaultSubject: "แผนการจัดประสบการณ์เรียนรู้ปฐมวัย",
        defaultClass: "ปฐมวัย",
        subjectHint: "(เฉพาะระดับปฐมวัย)",
        classHint: "(เฉพาะระดับปฐมวัย)",
        allowWeek: false,
      };
    }

    if (isP1Only) {
      return {
        mode: "p1" as const,
        defaultSubject: "ภาษาไทย",
        defaultClass: "ป.1",
        subjectHint: "(ระดับประถมศึกษา)",
        classHint: "(เฉพาะชั้น ป.1 เท่านั้น)",
        allowWeek: true,
      };
    }

    if (isAdmin) {
      return {
        mode: "admin" as const,
        defaultSubject: "ภาษาไทย",
        defaultClass: "ป.1",
        subjectHint: "(ทุกหมวดวิชา)",
        classHint: "(ทุกระดับชั้น)",
        allowWeek: true,
      };
    }

    const fallbackSubject = ELEM_SUBJECTS.some((s) => s.value === teacher?.default_subject)
      ? (teacher?.default_subject as string)
      : "ภาษาไทย";

    return {
      mode: "elem" as const,
      defaultSubject: fallbackSubject,
      defaultClass: extractDefaultClass(teacher?.grade_level),
      subjectHint: "(ระดับประถมศึกษา)",
      classHint: "(ระดับประถมศึกษา ป.1–ป.6)",
      allowWeek: true,
    };
  }, [profile?.full_name, teacher?.name, teacher?.category, teacher?.default_subject, teacher?.grade_level, isAdmin]);

  const [scopeType, setScopeType] = useState<"week" | "unit" | "term" | "permission">("week");
  const [scopeValue, setScopeValue] = useState(WEEK_OPTIONS[0].value);
  const [unitTitle, setUnitTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [customSubject, setCustomSubject] = useState("");
  const [classLevel, setClassLevel] = useState("ป.1");
  const [fileUrl, setFileUrl] = useState("");
  const [fileId, setFileId] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedForSubject, setUploadedForSubject] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isResettingUpload, setIsResettingUpload] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [existingPermissionPlans, setExistingPermissionPlans] = useState<
    { id: string; subject: string; class_level: string; scope_value: string; status: string }[]
  >([]);

  const resolvedSubject = subject === "__CUSTOM__" ? customSubject.trim() : subject.trim();
  const isSubjectSelected = Boolean(resolvedSubject);
  const isSubjectLocked = Boolean(uploadedForSubject && fileId);

  useEffect(() => {
    setClassLevel(teacherProfileConfig.defaultClass);
    if (!teacherProfileConfig.allowWeek) {
      setScopeType((prev) => (prev === "week" ? "unit" : prev));
    }
  }, [teacherProfileConfig]);

  useEffect(() => {
    if (scopeType === "week") {
      setScopeValue(WEEK_OPTIONS[0].value);
    } else if (scopeType === "unit") {
      setScopeValue("หน่วยการเรียนรู้ที่ 1");
    } else if (scopeType === "permission") {
      setScopeValue(PERMISSION_OPTIONS[0].value);
    } else {
      setScopeValue(TERM_OPTIONS[0].value);
    }
  }, [scopeType]);

  useEffect(() => {
    if (!user?.id) {
      setExistingPermissionPlans([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("lesson_plans")
      .select("id, subject, class_level, scope_value, status")
      .eq("created_by", user.id)
      .like("scope_value", `${PERMISSION_MEMO_PREFIX}%`)
      .then(({ data }) => {
        if (!cancelled && Array.isArray(data)) {
          setExistingPermissionPlans(data);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const duplicatePermissionPlan = useMemo(() => {
    if (scopeType !== "permission" || !resolvedSubject) return null;
    return (
      existingPermissionPlans.find(
        (p) =>
          p.subject === resolvedSubject &&
          p.class_level === classLevel &&
          p.scope_value === scopeValue
      ) || null
    );
  }, [scopeType, resolvedSubject, classLevel, scopeValue, existingPermissionPlans]);

  const discardUnsubmittedDriveFile = async (targetFileId: string | null) => {
    if (!targetFileId) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch("/api/drive/discard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ fileId: targetFileId }),
    }).catch(() => {});
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!resolvedSubject) {
      e.target.value = "";
      setErrorMsg("กรุณาเลือกรายวิชาในข้อ 3 ให้เรียบร้อยก่อนอัปโหลดไฟล์ PDF");
      return;
    }

    const previousUnsubmittedId = fileId;
    setErrorMsg("");
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const teacherName = profile?.full_name || teacher?.name || user?.email || "ครูผู้สอน";
      const result = await uploadPdfToGoogleDrive(
        file,
        teacherName,
        (pct) => setUploadProgress(pct),
        {
          kind: scopeType === "permission" ? "permission" : "plan",
          subject: resolvedSubject,
          classLevel,
          scopeValue,
        }
      );
      setFileId(result.fileId);
      setFileUrl(result.viewUrl);
      setUploadedFileName(result.fileName);
      setUploadedForSubject(resolvedSubject);
      if (previousUnsubmittedId && previousUnsubmittedId !== result.fileId) {
        await discardUnsubmittedDriveFile(previousUnsubmittedId);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "อัปโหลดไฟล์ขึ้น Google Drive ไม่สำเร็จ");
      setUploadProgress(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleUnlockSubjectAndClearFile = async () => {
    const oldId = fileId;
    setIsResettingUpload(true);
    setErrorMsg("");
    try {
      await discardUnsubmittedDriveFile(oldId);
    } finally {
      setFileId(null);
      setFileUrl("");
      setUploadedFileName(null);
      setUploadedForSubject(null);
      setUploadProgress(null);
      setIsResettingUpload(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setErrorMsg("กรุณาเข้าสู่ระบบก่อนส่งแผนการสอน");
      return;
    }
    if (!resolvedSubject) {
      setErrorMsg("กรุณาเลือกรายวิชาก่อนส่งเอกสาร");
      return;
    }
    if (duplicatePermissionPlan) {
      setErrorMsg(
        `วิชา ${resolvedSubject} (${classLevel}) ได้ส่งใบขออนุญาตใช้แผนสำหรับ ${scopeValue} ไปแล้ว (ระบบกำหนด 1 ใบต่อ 1 รายวิชา) — หากต้องการแก้ไขไฟล์ ไปที่หน้า "แผนของฉัน"`
      );
      return;
    }
    if (fileId && uploadedForSubject && resolvedSubject !== uploadedForSubject) {
      setErrorMsg(
        `รายวิชาที่เลือก (${resolvedSubject}) ไม่ตรงกับโฟลเดอร์ที่อัปโหลดไฟล์ (${uploadedForSubject}) กรุณากดเปลี่ยนวิชาเพื่ออัปโหลดใหม่`
      );
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
        subject: resolvedSubject,
        class_level: classLevel,
        scope_type: scopeType === "permission" ? "term" : scopeType,
        scope_value: scopeValue,
        unit_title: unitTitle.trim() || null,
        plan_file_url: fileUrl.trim(),
        plan_file_id: fileId,
        status: "รอตรวจแผน",
        created_by: user.id,
      };

      const { error: insertErr } = await supabase.from("lesson_plans").insert([newPlan]);

      if (insertErr) throw insertErr;

      // ส่งแจ้งเตือนเข้า LINE กลุ่มโรงเรียน
      let lineWarning = "";
      try {
        const lineRes = await fetch("/api/line-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: "plan_submitted",
            planData: {
              ...newPlan,
              version: 1,
              teacher_email: user.email || undefined,
            },
          }),
        });
        const lineJson = await lineRes.json().catch(() => ({}));
        if (!lineRes.ok || lineJson?.success === false) {
          lineWarning = ` (แต่แจ้งเตือน LINE ไม่สำเร็จ: ${lineJson?.error || lineJson?.reason || "ตรวจสอบการตั้งค่า LINE บน Vercel"})`;
        }
      } catch (lineErr) {
        console.warn("LINE Notify failed:", lineErr);
      }

      setSuccessMsg(
        scopeType === "permission"
          ? `ส่งใบขออนุญาตใช้แผนการสอน (1 ใบต่อ 1 รายวิชา) เรียบร้อยแล้ว!${lineWarning || " แจ้งเตือน ผอ. ในกลุ่ม LINE เพื่อรอลงนามแล้วครับ"}`
          : `ส่งแผนการจัดการเรียนรู้เรียบร้อยแล้ว!${lineWarning || " ข้อมูลแจ้งเตือนเข้า LINE กลุ่มโรงเรียนแล้วครับ"}`
      );
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
            ส่งได้ทั้งแบบ รายสัปดาห์ (1–20), รายหน่วย (1–36), รวมเล่มรายภาคเรียน และ ใบขออนุญาตใช้แผน (บันทึกข้อความ 1 ใบ/วิชา)
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
        {/* เลือกรูปแบบการส่ง: รายสัปดาห์ -> รายหน่วย -> รวมเล่ม -> ใบขออนุญาตใช้แผน */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-2">
            1. เลือกรูปแบบการส่งเอกสาร (เลือกได้ตามความพร้อม)
          </label>
          <div
            className={`grid gap-2 ${
              teacherProfileConfig.allowWeek ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"
            }`}
          >
            {teacherProfileConfig.allowWeek && (
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
            )}
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
              onClick={() => setScopeType("permission")}
              className={`p-3 rounded-2xl text-xs sm:text-sm font-bold border transition-all ${
                scopeType === "permission"
                  ? "bg-teal-600 text-white border-teal-700 shadow-md"
                  : "bg-white/80 text-teal-800 border-teal-200 hover:bg-teal-50/60"
              }`}
            >
              📝 ใบขออนุญาตใช้แผน
            </button>
          </div>
        </div>

        {scopeType === "permission" && (
          <div className="p-3.5 rounded-2xl bg-teal-50 border border-teal-200 text-xs text-teal-900 space-y-1">
            <div className="font-bold">
              📌 ใบขออนุญาตใช้แผนการจัดการเรียนรู้ (บันทึกข้อความ 1 ใบ ต่อ 1 รายวิชา)
            </div>
            <p className="text-[11px] text-teal-800 leading-relaxed">
              ให้คุณครูส่งเป็นไฟล์ <b>PDF บันทึกข้อความ</b> (ลงชื่อครูผู้สอนเรียบร้อย) และเว้นพื้นที่ด้านล่างสำหรับ ผอ. ติ๊ก <b>☑ อนุญาต / ☐ ไม่อนุญาต</b>, เขียนเหตุผล และลงลายเซ็นผ่านระบบได้เลยครับ
            </p>
          </div>
        )}

        {/* Dropdown ประเภทย่อย */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            2. ระบุ
            {scopeType === "permission"
              ? "ภาคเรียนของใบขออนุญาตใช้แผน"
              : `${teacherProfileConfig.allowWeek ? "สัปดาห์ / " : ""}หน่วย / ภาคเรียน`}
          </label>
          {scopeType === "week" && teacherProfileConfig.allowWeek && (
            <select
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800"
            >
              {WEEK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
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

          {scopeType === "term" && (
            <select
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800"
            >
              {TERM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}

          {scopeType === "permission" && (
            <select
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800"
            >
              {PERMISSION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {scopeType !== "term" && (
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              {scopeType === "permission"
                ? "รหัสวิชา / เวลาเรียน / เลขที่บันทึกข้อความ (ถ้ามี)"
                : "ชื่อหน่วยการเรียนรู้ / เรื่อง (ถ้ามี)"}
            </label>
            <input
              type="text"
              value={unitTitle}
              onChange={(e) => setUnitTitle(e.target.value)}
              placeholder={
                scopeType === "permission"
                  ? "เช่น รหัสวิชา ท ๒๑๑๐๑ · เวลาเรียน ๑๐๐ ชั่วโมง"
                  : "เช่น การบวกเลขสองหลัก, ตัวเรา, ปฐมนิเทศ"
              }
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800"
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              3. รายวิชา / แผนการจัดการเรียนรู้ <span className="text-red-500">*</span>{" "}
              <span className="font-normal text-pink-700">{teacherProfileConfig.subjectHint}</span>
            </label>
            <select
              required
              value={subject}
              disabled={isSubjectLocked || isUploading || isResettingUpload}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800 font-medium disabled:opacity-65 disabled:bg-slate-100 disabled:cursor-not-allowed"
            >
              <option value="">-- กรุณาเลือกรายวิชาก่อนอัปโหลดไฟล์ --</option>
              {teacherProfileConfig.mode === "early" &&
                EARLY_SUBJECTS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}

              {(teacherProfileConfig.mode === "elem" || teacherProfileConfig.mode === "p1") &&
                ELEM_SUBJECTS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}

              {teacherProfileConfig.mode === "admin" && (
                <>
                  <optgroup label="ระดับปฐมวัย">
                    {EARLY_SUBJECTS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="ระดับประถมศึกษา">
                    {ELEM_SUBJECTS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </optgroup>
                </>
              )}

              <option value="__CUSTOM__">อื่นๆ (พิมพ์ระบุชื่อวิชาเอง)...</option>
            </select>

            {subject === "__CUSTOM__" && (
              <input
                type="text"
                required
                value={customSubject}
                disabled={isSubjectLocked || isUploading || isResettingUpload}
                onChange={(e) => setCustomSubject(e.target.value)}
                placeholder="พิมพ์ชื่อรายวิชาเพิ่มเติม..."
                className="mt-2 w-full px-4 py-2 rounded-xl text-sm glass-input text-slate-800 disabled:opacity-65 disabled:bg-slate-100 disabled:cursor-not-allowed"
              />
            )}

            {isSubjectLocked && (
              <div className="mt-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex flex-wrap items-center justify-between gap-2">
                <span>
                  🔒 ล็อกรายวิชาตามโฟลเดอร์ที่อัปโหลดแล้ว (<b>{uploadedForSubject}</b>)
                </span>
                <button
                  type="button"
                  disabled={isResettingUpload || isSubmitting}
                  onClick={handleUnlockSubjectAndClearFile}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 font-bold transition-colors disabled:opacity-50"
                >
                  {isResettingUpload ? "กำลังล้างไฟล์..." : "เปลี่ยนวิชา (อัปโหลดใหม่)"}
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              4. ระดับชั้น{" "}
              <span className="font-normal text-pink-700">{teacherProfileConfig.classHint}</span>
            </label>
            <select
              value={classLevel}
              onChange={(e) => setClassLevel(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-sm glass-input text-slate-800 font-medium"
            >
              {teacherProfileConfig.mode === "early" &&
                EARLY_CLASSES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}

              {teacherProfileConfig.mode === "p1" && (
                <option value="ป.1">ประถมศึกษาปีที่ 1 (ป.1) - เฉพาะชั้น ป.1</option>
              )}

              {teacherProfileConfig.mode === "elem" &&
                ELEM_CLASSES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}

              {teacherProfileConfig.mode === "admin" && (
                <>
                  <optgroup label="ระดับปฐมวัย">
                    {EARLY_CLASSES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="ระดับประถมศึกษา">
                    {ELEM_CLASSES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </optgroup>
                </>
              )}
            </select>
          </div>
        </div>

        {/* แจ้งเตือนกรณีส่งใบขออนุญาตใช้แผนวิชานี้ไปแล้ว (1 ใบต่อ 1 รายวิชา) */}
        {duplicatePermissionPlan && (
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-bold">
                ⚠️ วิชา {resolvedSubject} ({classLevel}) ส่งใบขออนุญาตใช้แผนสำหรับ{" "}
                {scopeValue} แล้ว (สถานะ: {duplicatePermissionPlan.status})
              </div>
              <div className="text-[11px] text-amber-800 mt-0.5">
                ตามข้อตกลงใช้บันทึกข้อความ 1 ใบต่อ 1 รายวิชา — หากต้องการเปลี่ยนหรืออัปโหลดไฟล์แก้ไข กรุณาจัดการที่หน้า &quot;แผนของฉัน&quot;
              </div>
            </div>
            <Link
              href="/my-plans"
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs"
            >
              ไปหน้าแผนของฉัน →
            </Link>
          </div>
        )}

        {/* อัปโหลดไฟล์ PDF เข้า Google Drive อัตโนมัติ หรือวางลิงก์ */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {scopeType === "permission"
                ? "อัปโหลดไฟล์ PDF บันทึกข้อความขออนุญาตใช้แผน (เก็บเข้า Google Drive อัตโนมัติ)"
                : "อัปโหลดไฟล์ PDF แผนการสอน (เก็บเข้า Google Drive โรงเรียนอัตโนมัติ)"}
            </label>
            <p className="text-[11px] text-slate-500 mb-2">
              {isSubjectSelected ? (
                <>
                  ระบบจะบันทึกเข้าโฟลเดอร์:{" "}
                  <span className="font-semibold text-pink-700">
                    {profile?.full_name || teacher?.name || "ชื่อครู"} / {resolvedSubject}
                  </span>{" "}
                  และตั้งชื่อไฟล์เรียงลำดับตามวันเวลาที่ส่ง
                </>
              ) : (
                <span className="text-amber-700 font-semibold">
                  ⚠️ กรุณาเลือกรายวิชาในข้อ 3 ด้านบนก่อน จึงจะสามารถอัปโหลดไฟล์ PDF ได้
                </span>
              )}
            </p>
            <label
              className={`flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl border-2 border-dashed transition-colors text-xs font-semibold ${
                !isSubjectSelected || isUploading || isResettingUpload || Boolean(duplicatePermissionPlan)
                  ? "border-slate-300 bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "border-pink-300 bg-white hover:bg-pink-50/40 cursor-pointer text-pink-700"
              }`}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>กำลังอัปโหลดเข้า Google Drive... {uploadProgress ?? 0}%</span>
                </>
              ) : duplicatePermissionPlan ? (
                <>
                  <AlertCircle className="w-4 h-4" />
                  <span>วิชานี้ส่งใบขออนุญาตใช้แผนแล้ว (1 ใบต่อ 1 รายวิชา)</span>
                </>
              ) : !isSubjectSelected ? (
                <>
                  <AlertCircle className="w-4 h-4" />
                  <span>กรุณาเลือกรายวิชาในข้อ 3 ก่อนเลือกไฟล์ PDF</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>{uploadedFileName ? `อัปโหลดใหม่แทนไฟล์ (${uploadedFileName})` : "เลือกไฟล์ PDF จากเครื่อง"}</span>
                </>
              )}
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChange}
                disabled={
                  !isSubjectSelected ||
                  isUploading ||
                  isResettingUpload ||
                  Boolean(duplicatePermissionPlan)
                }
                className="hidden"
              />
            </label>

            {uploadProgress !== null && (
              <div className="mt-2 w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-pink-500 to-amber-500 transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}

            {uploadedFileName && fileId && !isUploading && (
              <p className="mt-1.5 text-xs text-emerald-700 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                อัปโหลดเข้า Google Drive สำเร็จ: <span className="font-semibold">{uploadedFileName}</span>
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-slate-200">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              ลิงก์ไฟล์ Google Drive (กรอกอัตโนมัติหลังอัปโหลด หรือวางลิงก์เอง)
            </label>
            <div className="relative">
              <UploadCloud className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="url"
                required
                value={fileUrl}
                onChange={(e) => {
                  setFileUrl(e.target.value);
                  setFileId(null);
                  setUploadedFileName(null);
                }}
                placeholder="https://drive.google.com/file/d/..."
                className="w-full pl-10 pr-4 py-2 rounded-xl text-xs bg-white border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || isUploading || Boolean(duplicatePermissionPlan)}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-pink-600 via-purple-600 to-amber-500 text-white font-bold text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-50"
        >
          {isSubmitting
            ? "กำลังส่งเอกสารและแจ้งเตือน LINE..."
            : scopeType === "permission"
            ? "✔ ยืนยันส่งใบขออนุญาตใช้แผน (บันทึกข้อความ)"
            : "✔ ยืนยันการส่งแผนการสอน"}
        </button>
      </form>
    </div>
  );
}
