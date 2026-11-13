"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabase/client";
import { LessonPlan, PlanStatus, Teacher } from "@/types/database";
import {
  Settings,
  ShieldAlert,
  Image as ImageIcon,
  Users,
  FileText,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";

const STATUS_OPTIONS: PlanStatus[] = [
  "รอตรวจแผน",
  "แผนต้องแก้ไข",
  "แผนผ่าน (รอส่งบันทึก)",
  "รอตรวจบันทึก",
  "บันทึกต้องแก้ไข",
  "เสร็จสมบูรณ์",
];

async function resizeImageToDataUrl(file: File, maxSize = 256): Promise<string> {
  if (file.type === "image/svg+xml") {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("อ่านไฟล์ SVG ไม่สำเร็จ"));
      reader.readAsDataURL(file);
    });
  }

  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("ไม่สามารถประมวลผลรูปภาพได้"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("ไฟล์รูปภาพไม่ถูกต้อง"));
    };
    img.src = url;
  });
}

export default function AdminPage() {
  const { user, isAdmin, schoolSettings, refreshSchoolSettings } = useAuth();
  const [activeTab, setActiveTab] = useState<"school" | "teachers" | "plans">("school");
  const [alert, setAlert] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 1. School settings states
  const [schoolName, setSchoolName] = useState(schoolSettings.school_name);
  const [systemTitle, setSystemTitle] = useState(schoolSettings.system_title);
  const [logoUrl, setLogoUrl] = useState(schoolSettings.logo_url || "");
  const [savingSettings, setSavingSettings] = useState(false);

  // 2. Teachers management states
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [teacherModalOpen, setTeacherModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [tName, setTName] = useState("");
  const [tShortName, setTShortName] = useState("");
  const [tCategory, setTCategory] = useState<"early_childhood" | "primary">("primary");
  const [tGradeLevel, setTGradeLevel] = useState("ประจำชั้น ป.1");
  const [tDefaultSubject, setTDefaultSubject] = useState("ภาษาไทย");
  const [tDisplayOrder, setTDisplayOrder] = useState<number>(10);
  const [savingTeacher, setSavingTeacher] = useState(false);

  // 3. Plans management states
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [planSearch, setPlanSearch] = useState("");
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);

  useEffect(() => {
    setSchoolName(schoolSettings.school_name);
    setSystemTitle(schoolSettings.system_title);
    setLogoUrl(schoolSettings.logo_url || "");
  }, [schoolSettings]);

  const loadTeachers = async () => {
    setLoadingTeachers(true);
    try {
      const { data } = await supabase
        .from("teachers")
        .select("*")
        .order("display_order", { ascending: true });
      if (data) setTeachers(data as Teacher[]);
    } finally {
      setLoadingTeachers(false);
    }
  };

  const loadPlans = async () => {
    setLoadingPlans(true);
    try {
      const { data } = await supabase
        .from("lesson_plans")
        .select("*")
        .order("created_at", { ascending: false });
      if (data) setPlans(data as LessonPlan[]);
    } finally {
      setLoadingPlans(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadTeachers();
      loadPlans();
    }
  }, [isAdmin]);

  // --- Handlers: School Logo & Info ---
  const handleLogoFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAlert(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 256);
      setLogoUrl(dataUrl);
    } catch (err: any) {
      setAlert({ type: "error", text: err?.message || "อัปโหลดโลโก้ไม่สำเร็จ" });
    }
  };

  const handleSaveSchoolSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setAlert(null);
    try {
      const { error } = await supabase.from("school_settings").upsert(
        {
          id: "default",
          school_name: schoolName.trim() || "โรงเรียนวัดโป่งแรด (ปคุณวิทยาคาร)",
          system_title:
            systemTitle.trim() || "ระบบติดตามแผนการสอนและบันทึกหลังสอน",
          logo_url: logoUrl.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
      if (error) throw error;
      await refreshSchoolSettings();
      setAlert({ type: "success", text: "บันทึกโลโก้และข้อมูลโรงเรียนเรียบร้อยแล้ว!" });
    } catch (err: any) {
      setAlert({
        type: "error",
        text: err?.message || "บันทึกไม่สำเร็จ (กรุณาตรวจสอบว่าได้รัน SQL สร้างตาราง school_settings แล้ว)",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  // --- Handlers: Teachers CRUD ---
  const openAddTeacher = () => {
    setEditingTeacher(null);
    setTName("");
    setTShortName("");
    setTCategory("primary");
    setTGradeLevel("ประจำชั้น ป.1");
    setTDefaultSubject("ภาษาไทย");
    setTDisplayOrder(teachers.length + 1);
    setTeacherModalOpen(true);
  };

  const openEditTeacher = (t: Teacher) => {
    setEditingTeacher(t);
    setTName(t.name);
    setTShortName(t.short_name);
    setTCategory(t.category);
    setTGradeLevel(t.grade_level);
    setTDefaultSubject(t.default_subject || "");
    setTDisplayOrder(t.display_order || 1);
    setTeacherModalOpen(true);
  };

  const handleSaveTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tName.trim() || !tShortName.trim()) {
      setAlert({ type: "error", text: "กรุณากรอกชื่อ-นามสกุล และชื่อย่อของครู" });
      return;
    }
    setSavingTeacher(true);
    setAlert(null);
    try {
      const payload = {
        name: tName.trim(),
        short_name: tShortName.trim(),
        category: tCategory,
        grade_level: tGradeLevel.trim() || "ครูผู้สอน",
        default_subject: tDefaultSubject.trim() || null,
        display_order: Number(tDisplayOrder) || 0,
      };

      if (editingTeacher) {
        const { error } = await supabase
          .from("teachers")
          .update(payload)
          .eq("id", editingTeacher.id);
        if (error) throw error;
        setAlert({ type: "success", text: `แก้ไขข้อมูล "${payload.name}" เรียบร้อยแล้ว` });
      } else {
        const { error } = await supabase
          .from("teachers")
          .insert([{ ...payload, is_active: true }]);
        if (error) throw error;
        setAlert({ type: "success", text: `เพิ่มรายชื่อครู "${payload.name}" เรียบร้อยแล้ว` });
      }

      setTeacherModalOpen(false);
      await loadTeachers();
    } catch (err: any) {
      setAlert({ type: "error", text: err?.message || "บันทึกรายชื่อครูไม่สำเร็จ" });
    } finally {
      setSavingTeacher(false);
    }
  };

  const handleToggleTeacherActive = async (t: Teacher) => {
    setAlert(null);
    try {
      const { error } = await supabase
        .from("teachers")
        .update({ is_active: !t.is_active })
        .eq("id", t.id);
      if (error) throw error;
      setAlert({
        type: "success",
        text: !t.is_active
          ? `เปิดแสดงผล "${t.name}" ในตารางแล้ว`
          : `ซ่อน "${t.name}" จากตารางแดชบอร์ดแล้ว (ประวัติแผนเดิมยังอยู่ครบ)`,
      });
      await loadTeachers();
    } catch (err: any) {
      setAlert({ type: "error", text: err?.message || "เปลี่ยนสถานะครูไม่สำเร็จ" });
    }
  };

  const handleDeleteTeacher = async (t: Teacher) => {
    const confirmed = window.confirm(
      `⚠️ ยืนยันการลบรายชื่อครู "${t.name}" ออกจากระบบถาวร?\n\nคำเตือน: แผนการสอนทั้งหมดที่ผูกกับครูท่านนี้จะถูกลบตามไปด้วย (หากต้องการแค่ซ่อนจากหน้าหลัก แนะนำให้กดปุ่ม "ซ่อน" แทน)`
    );
    if (!confirmed) return;

    setAlert(null);
    try {
      const { error } = await supabase.from("teachers").delete().eq("id", t.id);
      if (error) throw error;
      setAlert({ type: "success", text: `ลบรายชื่อ "${t.name}" เรียบร้อยแล้ว` });
      await loadTeachers();
      await loadPlans();
    } catch (err: any) {
      setAlert({ type: "error", text: err?.message || "ลบรายชื่อครูไม่สำเร็จ" });
    }
  };

  // --- Handlers: Admin Plans Management ---
  const handleAdminDeletePlan = async (p: LessonPlan) => {
    if (
      !window.confirm(
        `ยืนยันการลบแผน "${p.subject} (${p.class_level})" ของ ${p.teacher_name} [สถานะ: ${p.status}] หรือไม่?`
      )
    ) {
      return;
    }

    setBusyPlanId(p.id);
    setAlert(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");

      const res = await fetch("/api/plans/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ planId: p.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ลบแผนไม่สำเร็จ");

      setAlert({ type: "success", text: `ลบแผน "${p.subject}" ของ ${p.teacher_name} เรียบร้อยแล้ว` });
      await loadPlans();
    } catch (err: any) {
      setAlert({ type: "error", text: err?.message || "ลบแผนไม่สำเร็จ" });
    } finally {
      setBusyPlanId(null);
    }
  };

  const handleAdminStatusChange = async (p: LessonPlan, newStatus: PlanStatus) => {
    setBusyPlanId(p.id);
    setAlert(null);
    try {
      const { error } = await supabase
        .from("lesson_plans")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", p.id);
      if (error) throw error;
      setAlert({ type: "success", text: `อัปเดตสถานะ "${p.subject}" เป็น "${newStatus}" แล้ว` });
      await loadPlans();
    } catch (err: any) {
      setAlert({ type: "error", text: err?.message || "เปลี่ยนสถานะไม่สำเร็จ" });
    } finally {
      setBusyPlanId(null);
    }
  };

  if (!user || !isAdmin) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 text-center glass-panel rounded-3xl">
        <ShieldAlert className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-800">ไม่มีสิทธิ์เข้าถึงหน้านี้</h2>
        <p className="text-xs text-slate-500 mt-1">
          เฉพาะผู้บริหารสถานศึกษา (ผอ.) และผู้ดูแลระบบเท่านั้นที่จัดการการตั้งค่าได้
        </p>
      </div>
    );
  }

  const filteredPlans = plans.filter((p) => {
    const q = planSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      p.teacher_name.toLowerCase().includes(q) ||
      p.subject.toLowerCase().includes(q) ||
      p.class_level.toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-800 flex items-center gap-2">
            <Settings className="w-6 h-6 text-purple-600" />
            จัดการระบบและสิทธิ์ผู้บริหาร (ผอ. / แอดมิน)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            เปลี่ยนโลโก้โรงเรียน จัดการรายชื่อครู เพิ่ม/แก้ไข/ลบ และควบคุมรายการแผนทั้งหมด
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-3 gap-2 p-1.5 glass-panel rounded-2xl border border-white/80 max-w-2xl">
        <button
          type="button"
          onClick={() => {
            setActiveTab("school");
            setAlert(null);
          }}
          className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${
            activeTab === "school"
              ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow"
              : "text-slate-600 hover:bg-white/60"
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          <span>โลโก้ &amp; โรงเรียน</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("teachers");
            setAlert(null);
          }}
          className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${
            activeTab === "teachers"
              ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow"
              : "text-slate-600 hover:bg-white/60"
          }`}
        >
          <Users className="w-4 h-4" />
          <span>จัดการครู ({teachers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("plans");
            setAlert(null);
          }}
          className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${
            activeTab === "plans"
              ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow"
              : "text-slate-600 hover:bg-white/60"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>จัดการแผน ({plans.length})</span>
        </button>
      </div>

      {alert && (
        <div
          className={`p-4 rounded-2xl text-xs sm:text-sm flex items-center gap-2 border ${
            alert.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {alert.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-red-600" />
          )}
          <span>{alert.text}</span>
        </div>
      )}

      {/* Tab 1: โลโก้และข้อมูลโรงเรียน */}
      {activeTab === "school" && (
        <form
          onSubmit={handleSaveSchoolSettings}
          className="glass-card rounded-3xl p-6 border border-white/80 space-y-5 max-w-2xl"
        >
          <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="พรีวิวโลโก้โรงเรียน"
                className="w-20 h-20 rounded-2xl object-contain bg-white p-1 shadow border border-slate-200 shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-pink-600 to-amber-500 flex items-center justify-center text-white font-bold text-2xl shadow shrink-0">
                PR
              </div>
            )}
            <div className="space-y-2 flex-1">
              <div className="text-xs font-bold text-slate-700">โลโก้โรงเรียนปัจจุบัน</div>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-xs font-bold cursor-pointer shadow-sm">
                  <Upload className="w-3.5 h-3.5" />
                  <span>อัปโหลดรูปโลโก้จากเครื่อง</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoFilePick}
                    className="hidden"
                  />
                </label>
                {logoUrl && (
                  <button
                    type="button"
                    onClick={() => setLogoUrl("")}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    ใช้ไอคอน PR เดิม
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                รองรับไฟล์ PNG, JPG, WebP, SVG (แนะนำรูปสี่เหลี่ยมจัตุรัส พื้นหลังโปร่งใส)
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              หรือวางลิงก์รูปภาพโลโก้ (URL)
            </label>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://... หรือปล่อยว่างเพื่อใช้ PR"
              className="w-full px-3 py-2.5 rounded-xl text-xs glass-input text-slate-800"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">ชื่อโรงเรียน</label>
            <input
              type="text"
              required
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm glass-input text-slate-800 font-semibold"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">ชื่อระบบ / คำโปรยส่วนหัว</label>
            <input
              type="text"
              required
              value={systemTitle}
              onChange={(e) => setSystemTitle(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm glass-input text-slate-800"
            />
          </div>

          <button
            type="submit"
            disabled={savingSettings}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white text-xs sm:text-sm font-bold shadow hover:shadow-md disabled:opacity-50"
          >
            {savingSettings ? "กำลังบันทึก..." : "✔ บันทึกการตั้งค่าโรงเรียน"}
          </button>
        </form>
      )}

      {/* Tab 2: จัดการรายชื่อครู */}
      {activeTab === "teachers" && (
        <div className="glass-card rounded-3xl p-6 border border-white/80 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display font-bold text-base text-slate-800">
                รายชื่อครูผู้สอนในระบบ
              </h2>
              <p className="text-xs text-slate-500">
                เพิ่ม แก้ไข ย้ายลำดับ ซ่อนครูที่ย้ายออก หรือลบรายชื่อ
              </p>
            </div>
            <button
              type="button"
              onClick={openAddTeacher}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold shadow flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              เพิ่มครูใหม่
            </button>
          </div>

          {loadingTeachers ? (
            <div className="py-8 text-center text-xs text-slate-500">กำลังโหลดรายชื่อครู...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm text-slate-700">
                <thead className="bg-slate-50/80 text-xs font-bold text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">ลำดับ</th>
                    <th className="py-2.5 px-3">ชื่อ - นามสกุล</th>
                    <th className="py-2.5 px-3">ชื่อย่อ</th>
                    <th className="py-2.5 px-3">ระดับชั้น</th>
                    <th className="py-2.5 px-3">วิชาหลัก</th>
                    <th className="py-2.5 px-3 text-center">สถานะ</th>
                    <th className="py-2.5 px-3 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teachers.map((t) => (
                    <tr key={t.id} className={!t.is_active ? "opacity-55 bg-slate-50/60" : ""}>
                      <td className="py-2.5 px-3 font-semibold">{t.display_order}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">{t.name}</td>
                      <td className="py-2.5 px-3">{t.short_name}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-medium">
                          {t.grade_level}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs">{t.default_subject || "-"}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            t.is_active
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {t.is_active ? "แสดงผล" : "ซ่อนอยู่"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditTeacher(t)}
                            title="แก้ไขข้อมูล"
                            className="p-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleTeacherActive(t)}
                            title={t.is_active ? "ซ่อนจากหน้าหลัก" : "เปิดแสดงผล"}
                            className="p-1.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100"
                          >
                            {t.is_active ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTeacher(t)}
                            title="ลบรายชื่อครู"
                            className="p-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: จัดการแผนการสอนทั้งหมด (ลบแผนได้ทุกสถานะ) */}
      {activeTab === "plans" && (
        <div className="glass-card rounded-3xl p-6 border border-white/80 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-display font-bold text-base text-slate-800">
                รายการแผนการสอนทั้งหมด (สิทธิ์ ผอ./แอดมิน)
              </h2>
              <p className="text-xs text-slate-500">
                สามารถปรับสถานะหรือลบแผนที่ส่งเข้ามาได้ทุกสถานะ รวมถึงแผนที่เสร็จสมบูรณ์แล้ว
              </p>
            </div>
            <input
              type="text"
              value={planSearch}
              onChange={(e) => setPlanSearch(e.target.value)}
              placeholder="ค้นหาชื่อครู, รายวิชา, ระดับชั้น..."
              className="px-3 py-2 rounded-xl text-xs glass-input w-full sm:w-64"
            />
          </div>

          {loadingPlans ? (
            <div className="py-8 text-center text-xs text-slate-500">กำลังโหลดข้อมูลแผน...</div>
          ) : filteredPlans.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">ไม่พบรายการแผนการสอน</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50/80 font-bold text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">วันที่ส่ง</th>
                    <th className="py-2.5 px-3">ครูผู้สอน</th>
                    <th className="py-2.5 px-3">รายวิชา (ชั้น)</th>
                    <th className="py-2.5 px-3">รูปแบบ</th>
                    <th className="py-2.5 px-3">ปรับสถานะ</th>
                    <th className="py-2.5 px-3 text-right">ลบแผน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPlans.map((p) => (
                    <tr key={p.id} className="hover:bg-white/60">
                      <td className="py-2.5 px-3 text-slate-500">
                        {new Date(p.created_at).toLocaleDateString("th-TH")}
                        <span className="block text-[10px]">v{p.version}</span>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">{p.teacher_name}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold">{p.subject}</div>
                        <div className="text-[11px] text-slate-500">{p.class_level}</div>
                      </td>
                      <td className="py-2.5 px-3">{p.scope_value}</td>
                      <td className="py-2.5 px-3">
                        <select
                          disabled={busyPlanId === p.id}
                          value={p.status}
                          onChange={(e) =>
                            handleAdminStatusChange(p, e.target.value as PlanStatus)
                          }
                          className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                        >
                          {STATUS_OPTIONS.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          disabled={busyPlanId === p.id}
                          onClick={() => handleAdminDeletePlan(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 font-semibold disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          ลบ
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal Add/Edit Teacher */}
      {teacherModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="max-w-md w-full glass-panel rounded-3xl p-6 border border-white/80 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-display font-bold text-lg text-slate-800">
                {editingTeacher ? "แก้ไขข้อมูลครูผู้สอน" : "เพิ่มรายชื่อครูใหม่"}
              </h3>
              <button
                type="button"
                onClick={() => setTeacherModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTeacher} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ชื่อ - นามสกุลเต็ม
                </label>
                <input
                  type="text"
                  required
                  value={tName}
                  onChange={(e) => setTName(e.target.value)}
                  placeholder="เช่น นางสาวสมใจ ใจดี"
                  className="w-full px-3 py-2 rounded-xl text-xs glass-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ชื่อย่อ</label>
                  <input
                    type="text"
                    required
                    value={tShortName}
                    onChange={(e) => setTShortName(e.target.value)}
                    placeholder="เช่น ครูสมใจ"
                    className="w-full px-3 py-2 rounded-xl text-xs glass-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ลำดับแสดงผล</label>
                  <input
                    type="number"
                    required
                    value={tDisplayOrder}
                    onChange={(e) => setTDisplayOrder(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl text-xs glass-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">หมวดระดับ</label>
                  <select
                    value={tCategory}
                    onChange={(e) =>
                      setTCategory(e.target.value as "early_childhood" | "primary")
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs glass-input"
                  >
                    <option value="early_childhood">ระดับปฐมวัย</option>
                    <option value="primary">ระดับประถมศึกษา</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ระดับชั้น / บทบาท</label>
                  <input
                    type="text"
                    required
                    value={tGradeLevel}
                    onChange={(e) => setTGradeLevel(e.target.value)}
                    placeholder="เช่น ประจำชั้น ป.1"
                    className="w-full px-3 py-2 rounded-xl text-xs glass-input"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  วิชาหลักเริ่มต้น
                </label>
                <input
                  type="text"
                  value={tDefaultSubject}
                  onChange={(e) => setTDefaultSubject(e.target.value)}
                  placeholder="เช่น ภาษาไทย"
                  className="w-full px-3 py-2 rounded-xl text-xs glass-input"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTeacherModalOpen(false)}
                  className="w-1/2 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingTeacher}
                  className="w-1/2 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white text-xs font-bold shadow disabled:opacity-50"
                >
                  {savingTeacher ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
