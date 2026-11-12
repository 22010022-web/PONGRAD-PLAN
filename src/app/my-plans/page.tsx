"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabase/client";
import { LessonPlan } from "@/types/database";
import { BookOpen, AlertCircle, CheckCircle2, Clock, Upload, Link as LinkIcon } from "lucide-react";

export default function MyPlansPage() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPlanForPost, setSelectedPlanForPost] = useState<LessonPlan | null>(null);
  const [useExistingFile, setUseExistingFile] = useState(true);
  const [postFileUrl, setPostFileUrl] = useState("");
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [postSuccess, setPostSuccess] = useState("");
  const [postError, setPostError] = useState("");

  const loadMyPlans = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("lesson_plans")
        .select("*, reviews:plan_reviews(*)")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false });

      if (data) setPlans(data as LessonPlan[]);
    } catch (err) {
      console.error("Error loading my plans:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMyPlans();
  }, [user]);

  const handlePostSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanForPost) return;

    setIsSubmittingPost(true);
    setPostError("");
    setPostSuccess("");

    try {
      const finalPostUrl = useExistingFile ? selectedPlanForPost.plan_file_url : postFileUrl.trim();

      const { error: updateErr } = await supabase
        .from("lesson_plans")
        .update({
          status: "รอตรวจบันทึก",
          post_file_url: finalPostUrl,
          use_existing_file: useExistingFile,
          post_submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedPlanForPost.id);

      if (updateErr) throw updateErr;

      // แจ้งเตือน LINE
      try {
        await fetch("/api/line-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: "post_submitted",
            planData: {
              ...selectedPlanForPost,
              post_file_url: finalPostUrl,
              use_existing_file: useExistingFile,
            },
          }),
        });
      } catch (lineErr) {
        console.warn("LINE Notify failed:", lineErr);
      }

      setPostSuccess("ส่งบันทึกหลังการสอนเรียบร้อยแล้ว! สถานะเปลี่ยนเป็น 'รอตรวจบันทึก'");
      setTimeout(() => {
        setSelectedPlanForPost(null);
        setPostSuccess("");
        loadMyPlans();
      }, 1500);
    } catch (err: any) {
      setPostError(err.message || "เกิดข้อผิดพลาดในการส่งบันทึก");
    } finally {
      setIsSubmittingPost(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 text-center glass-panel rounded-3xl">
        <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-800">กรุณาเข้าสู่ระบบ</h2>
        <p className="text-xs text-slate-500 mt-1">เพื่อดูและจัดการแผนการจัดการเรียนรู้ของท่าน</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-800 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-pink-600" />
            แผนการจัดการเรียนรู้ของฉัน
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ติดตามสถานะการตรวจของ ผอ. และส่งบันทึกหลังการสอน
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {plans.length === 0 ? (
          <div className="glass-card rounded-3xl p-12 text-center text-slate-500">
            ยังไม่มีแผนการสอนที่ส่งในระบบ
          </div>
        ) : (
          plans.map((p) => {
            const latestReview = p.reviews && p.reviews.length > 0 ? p.reviews[p.reviews.length - 1] : null;

            return (
              <div
                key={p.id}
                className="glass-card rounded-2xl p-5 border border-white/80 space-y-3 transition-all hover:shadow-md"
              >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 text-base">{p.subject}</span>
                      <span className="text-xs text-slate-500">({p.class_level})</span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-semibold">
                        {p.scope_value}
                      </span>
                      <span className="text-[11px] text-slate-400">v{p.version}</span>
                    </div>
                    {p.unit_title && (
                      <div className="text-xs text-pink-700 font-medium mt-0.5">
                        เรื่อง: {p.unit_title}
                      </div>
                    )}
                  </div>

                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      p.status === "เสร็จสมบูรณ์"
                        ? "bg-emerald-100 text-emerald-800"
                        : p.status === "รอตรวจแผน"
                        ? "bg-amber-100 text-amber-800"
                        : p.status === "แผนผ่าน (รอส่งบันทึก)"
                        ? "bg-blue-100 text-blue-800"
                        : p.status === "รอตรวจบันทึก"
                        ? "bg-purple-100 text-purple-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>

                {/* กล่องคอมเมนต์ ผอ. ถ้ามี */}
                {latestReview && latestReview.note && latestReview.note !== "-" && (
                  <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/60 text-xs text-amber-900">
                    <span className="font-bold">หมายเหตุ ผอ. ({latestReview.reviewer_name}): </span>
                    {latestReview.note}
                    {latestReview.reviewed_file_url && (
                      <div className="mt-1">
                        <a
                          href={latestReview.reviewed_file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-bold text-pink-700 underline"
                        >
                          เปิดดูไฟล์ PDF ที่ ผอ. ขีดตรวจแก้ไข ↗
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* ปุ่มการทำงาน */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <div className="flex gap-2">
                    <a
                      href={p.plan_file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-pink-50 text-pink-700 hover:bg-pink-100 border border-pink-200 flex items-center gap-1"
                    >
                      <LinkIcon className="w-3.5 h-3.5" />
                      ไฟล์แผน PDF
                    </a>
                    {(p.post_file_url || p.use_existing_file) && (
                      <a
                        href={p.post_file_url || p.plan_file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 flex items-center gap-1"
                      >
                        <LinkIcon className="w-3.5 h-3.5" />
                        ไฟล์บันทึกหลังสอน
                      </a>
                    )}
                  </div>

                  {/* ถ้าแผนผ่านแล้ว หรือบันทึกต้องแก้ สามารถกดส่งบันทึกหลังสอนได้ */}
                  {(p.status === "แผนผ่าน (รอส่งบันทึก)" || p.status === "บันทึกต้องแก้ไข") && (
                    <button
                      onClick={() => {
                        setSelectedPlanForPost(p);
                        setUseExistingFile(true);
                      }}
                      className="px-4 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm hover:shadow"
                    >
                      + ส่งบันทึกหลังการสอน
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal ส่งบันทึกหลังสอน */}
      {selectedPlanForPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="max-w-md w-full glass-panel rounded-3xl p-6 border border-white/80 shadow-2xl space-y-4">
            <h3 className="font-display font-bold text-lg text-slate-800">
              ส่งบันทึกหลังการสอน
            </h3>
            <p className="text-xs text-slate-500">
              วิชา {selectedPlanForPost.subject} ({selectedPlanForPost.class_level}) - {selectedPlanForPost.scope_value}
            </p>

            {postSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs">
                {postSuccess}
              </div>
            )}
            {postError && (
              <div className="p-3 rounded-xl bg-red-50 text-red-800 text-xs">
                {postError}
              </div>
            )}

            <form onSubmit={handlePostSubmit} className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useExistingFile}
                    onChange={(e) => setUseExistingFile(e.target.checked)}
                    className="rounded text-pink-600 focus:ring-pink-500"
                  />
                  <span>ใช้ไฟล์เดิมจากแผนการสอน (ประหยัดพื้นที่จัดเก็บ)</span>
                </label>
                <p className="text-[11px] text-slate-500 pl-5">
                  เหมาะสำหรับครูที่บันทึกหลังสอนอยู่ในไฟล์ PDF ฉบับเดิมอยู่แล้ว ไม่ต้องอัปโหลดไฟล์ซ้ำ
                </p>
              </div>

              {!useExistingFile && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ลิงก์ไฟล์ PDF บันทึกหลังสอน (Google Drive)
                  </label>
                  <input
                    type="url"
                    required
                    value={postFileUrl}
                    onChange={(e) => setPostFileUrl(e.target.value)}
                    placeholder="https://drive.google.com/file/d/..."
                    className="w-full px-3 py-2 rounded-xl text-xs glass-input"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedPlanForPost(null)}
                  className="w-1/2 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPost}
                  className="w-1/2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold shadow disabled:opacity-50"
                >
                  {isSubmittingPost ? "กำลังบันทึก..." : "ส่งบันทึก"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
