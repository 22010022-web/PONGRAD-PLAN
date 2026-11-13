"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabase/client";
import { Teacher } from "@/types/database";
import {
  Lock,
  Mail,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { user, signIn, signUp, isConfigured, schoolSettings } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signupTeacherId, setSignupTeacherId] = useState("");
  const [forgotTeacherId, setForgotTeacherId] = useState("");

  const [teachersList, setTeachersList] = useState<Teacher[]>([]);
  const [registeredTeacherIds, setRegisteredTeacherIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const availableTeachers = teachersList.filter((t) => !registeredTeacherIds.includes(t.id));

  useEffect(() => {
    if (user) {
      router.push("/");
    }
  }, [user, router]);

  const loadTeachersAndRegistrations = async () => {
    if (!isConfigured) return;
    const [{ data: teachersData }, { data: profilesData }] = await Promise.all([
      supabase
        .from("teachers")
        .select("*")
        .eq("is_active", true)
        .order("display_order", { ascending: true }),
      supabase
        .from("profiles")
        .select("teacher_id")
        .not("teacher_id", "is", null),
    ]);

    if (teachersData) {
      setTeachersList(teachersData as Teacher[]);
      if (teachersData.length > 0) {
        setForgotTeacherId((prev) => prev || teachersData[0].id);
      }
    }

    if (profilesData) {
      const boundIds = profilesData
        .map((p: { teacher_id: string | null }) => p.teacher_id)
        .filter((id): id is string => Boolean(id));
      setRegisteredTeacherIds(boundIds);
      setSignupTeacherId((prev) => (prev && boundIds.includes(prev) ? "" : prev));
    }
  };

  useEffect(() => {
    loadTeachersAndRegistrations();
  }, [isConfigured]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    const { error } = await signIn(email, password);
    setLoading(false);

    if (error) {
      setErrorMsg(error.message);
    } else {
      router.push("/");
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    if (!signupTeacherId) {
      setErrorMsg("กรุณาเลือกชื่อครูของท่านในระบบ");
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setErrorMsg("รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
      setLoading(false);
      return;
    }

    const matchedTeacher = availableTeachers.find((t) => t.id === signupTeacherId);
    if (!matchedTeacher) {
      setErrorMsg("รายชื่อครูท่านนี้มีผู้ลงทะเบียนรับสิทธิ์ไปแล้ว หรือถูกปิดใช้งาน");
      await loadTeachersAndRegistrations();
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/register-teacher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          teacherId: signupTeacherId,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "ไม่สามารถลงทะเบียนได้");
        await loadTeachersAndRegistrations();
        setLoading(false);
        return;
      }

      if (data.fallbackClientSignUp) {
        const { error } = await signUp(
          email,
          password,
          matchedTeacher.name,
          "teacher",
          signupTeacherId,
          matchedTeacher.name
        );
        if (error) {
          setErrorMsg(error.message);
          setLoading(false);
          return;
        }
      } else {
        const { error: signInErr } = await signIn(email.trim().toLowerCase(), password);
        if (signInErr) {
          setSuccessMsg("ลงทะเบียนบัญชีเรียบร้อยแล้ว! กรุณาเข้าสู่ระบบด้วยอีเมลและรหัสผ่านที่ตั้งไว้");
          setMode("signin");
          await loadTeachersAndRegistrations();
          setLoading(false);
          return;
        }
      }

      setSuccessMsg("ลงทะเบียนสำเร็จและเข้าสู่ระบบเรียบร้อยแล้ว กำลังนำท่านเข้าสู่ระบบ...");
      setTimeout(() => {
        router.push("/");
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err?.message || "เกิดข้อผิดพลาดในการลงทะเบียน");
    } finally {
      setLoading(false);
    }
  };

  const handleInstantResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    if (password !== confirmPassword) {
      setErrorMsg("รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setErrorMsg("รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
      setLoading(false);
      return;
    }

    if (!forgotTeacherId) {
      setErrorMsg("กรุณาเลือกชื่อครูของท่าน");
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc("reset_teacher_password", {
        p_email: email.trim().toLowerCase(),
        p_teacher_id: forgotTeacherId,
        p_new_password: password,
      });

      if (error) throw error;

      if (data === true) {
        setSuccessMsg("เปลี่ยนรหัสผ่านใหม่สำเร็จแล้ว! กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่ได้ทันที");
        setTimeout(() => {
          setMode("signin");
          setSuccessMsg("");
        }, 2000);
      } else {
        setErrorMsg("ไม่พบข้อมูลบัญชีที่ตรงกับอีเมลและชื่อครูที่เลือก กรุณาตรวจสอบอีเมลอีกครั้ง");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "เกิดข้อผิดพลาดในการรีเซ็ตรหัสผ่าน");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-8 p-6 sm:p-8 glass-panel rounded-3xl border border-white/80 shadow-xl">
      <div className="text-center mb-6">
        {schoolSettings.logo_url ? (
          <img
            src={schoolSettings.logo_url}
            alt="โลโก้โรงเรียน"
            className="w-16 h-16 mx-auto rounded-2xl object-contain bg-white p-1 shadow-lg mb-3 border border-white/80"
          />
        ) : (
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-pink-600 to-amber-500 flex items-center justify-center text-white font-bold text-2xl shadow-lg mb-3">
            PR
          </div>
        )}
        <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-800 text-balance">
          {schoolSettings.system_title}
        </h1>
        <p className="text-xs text-slate-500 mt-1">{schoolSettings.school_name}</p>
      </div>

      {/* Tabs Switcher */}
      <div className="grid grid-cols-2 p-1 bg-slate-100/80 rounded-2xl mb-6">
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setErrorMsg("");
            setSuccessMsg("");
          }}
          className={`py-2 text-xs font-bold rounded-xl transition-all ${
            mode === "signin"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          เข้าสู่ระบบ
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("signup");
            setErrorMsg("");
            setSuccessMsg("");
            loadTeachersAndRegistrations();
          }}
          className={`py-2 text-xs font-bold rounded-xl transition-all ${
            mode === "signup"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          ลงทะเบียนผู้ใช้ใหม่
        </button>
      </div>

      {errorMsg && (
        <div className="mb-4 p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="mb-4 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {mode === "signin" && (
        <form onSubmit={handleSignIn} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">อีเมล</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="director@pongrad.ac.th หรือ teacher@..."
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs glass-input"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-bold text-slate-700">รหัสผ่าน</label>
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setErrorMsg("");
                  setSuccessMsg("");
                }}
                className="text-[11px] font-semibold text-pink-700 hover:underline"
              >
                ลืมรหัสผ่าน?
              </button>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs glass-input"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold text-xs sm:text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      )}

      {mode === "signup" && (
        <form onSubmit={handleSignUp} className="space-y-4">
          <div className="p-3 rounded-2xl bg-pink-50 border border-pink-200 text-[11px] text-pink-800 font-medium leading-relaxed">
            จำกัดสิทธิ์ <span className="font-bold">1 อีเมล ต่อ 1 ชื่อครู</span> — รายชื่อที่ลงทะเบียนแล้วจะถูกซ่อนอัตโนมัติ (หากมีครูใหม่ ผอ./แอดมิน สามารถเพิ่มรายชื่อได้ในหน้าจัดการระบบ)
          </div>

          {availableTeachers.length === 0 ? (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
              <p className="font-bold">รายชื่อครูทั้งหมดมีบัญชีลงทะเบียนครบแล้ว</p>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                หากลืมรหัสผ่าน กรุณากดแท็บ &quot;เข้าสู่ระบบ&quot; แล้วเลือก &quot;ลืมรหัสผ่าน?&quot; หรือหากมีครูมาใหม่ ให้ ผอ./ผู้ดูแลระบบเพิ่มรายชื่อในหน้าจัดการระบบ แล้วรายชื่อจะแสดงที่นี่เพื่อลงทะเบียนรับสิทธิ์ครับ
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  เลือกชื่อครูในระบบ (ว่างสำหรับรับสิทธิ์ {availableTeachers.length} ท่าน)
                </label>
                <select
                  required
                  value={signupTeacherId}
                  onChange={(e) => setSignupTeacherId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-xs glass-input font-medium"
                >
                  <option value="">-- กรุณาเลือกชื่อครูของท่าน --</option>
                  {availableTeachers.some((t) => t.category === "early_childhood") && (
                    <optgroup label="กลุ่มที่ 1 ครูระดับปฐมวัย">
                      {availableTeachers
                        .filter((t) => t.category === "early_childhood")
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.grade_level})
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {availableTeachers.some((t) => t.category === "primary") && (
                    <optgroup label="กลุ่มที่ 2 ครูระดับประถมศึกษา">
                      {availableTeachers
                        .filter((t) => t.category === "primary")
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.grade_level})
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">อีเมลสำหรับล็อกอิน</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your-name@pongrad.ac.th หรือ gmail..."
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs glass-input"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ตั้งรหัสผ่าน (อย่างน้อย 6 ตัว)</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs glass-input"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ยืนยันรหัสผ่านอีกครั้ง</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl text-xs glass-input"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !signupTeacherId}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-xs sm:text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                {loading ? "กำลังลงทะเบียน..." : "✔ ยืนยันการลงทะเบียน"}
              </button>
            </>
          )}
        </form>
      )}

      {mode === "forgot" && (
        <form onSubmit={handleInstantResetPassword} className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setErrorMsg("");
                setSuccessMsg("");
              }}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-slate-800">ตั้งรหัสผ่านใหม่ (สำหรับคุณครู)</span>
          </div>

          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
            💡 ระบบรีเซ็ตรหัสผ่านด่วน: เลือกชื่อครูของท่าน ระบุอีเมลที่เคยลงทะเบียน และตั้งรหัสผ่านใหม่ได้ทันที ไม่ต้องรอกดลิงก์ในอีเมล
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">เลือกชื่อครู</label>
            <select
              value={forgotTeacherId}
              onChange={(e) => setForgotTeacherId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-xs glass-input font-medium"
            >
              {teachersList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.grade_level})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">อีเมลที่เคยลงทะเบียนไว้</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@pongrad.ac.th"
              className="w-full px-3 py-2.5 rounded-xl text-xs glass-input"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-xl text-xs glass-input"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">ยืนยันรหัสผ่านใหม่อีกครั้ง</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-xl text-xs glass-input"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold text-xs sm:text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-50"
          >
            {loading ? "กำลังบันทึกรหัสผ่านใหม่..." : "✔ เปลี่ยนรหัสผ่านและเข้าใช้งาน"}
          </button>
        </form>
      )}
    </div>
  );
}
