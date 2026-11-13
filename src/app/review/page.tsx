"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabase/client";
import { LessonPlan, PlanStatus } from "@/types/database";
import { FileCheck, ShieldAlert, CheckCircle2, AlertTriangle, ExternalLink, X, Eye, EyeOff } from "lucide-react";
import { SignaturePad } from "@/components/signature-pad";

function getDrivePreviewSrc(url?: string | null, explicitId?: string | null): string | null {
  if (explicitId) return `https://drive.google.com/file/d/${explicitId}/preview`;
  if (!url) return null;
  const match = /\/d\/([a-zA-Z0-9_-]{10,})/.exec(url) || /[?&]id=([a-zA-Z0-9_-]{10,})/.exec(url);
  return match?.[1] ? `https://drive.google.com/file/d/${match[1]}/preview` : null;
}

export default function ReviewPage() {
  const { user, profile, isAdmin } = useAuth();
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<LessonPlan | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewedFileUrl, setReviewedFileUrl] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [signPageChoice, setSignPageChoice] = useState<"first" | "last">("last");
  const [signPosition, setSignPosition] = useState<"bottom-right" | "bottom-center" | "bottom-left">("bottom-right");
  const [showPreview, setShowPreview] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadPlansForReview = async () => {
    try {
      const { data, error } = await supabase
        .from("lesson_plans")
        .select("*, reviews:plan_reviews(*)")
        .order("created_at", { ascending: false });

      if (data) setPlans(data as LessonPlan[]);
    } catch (err) {
      console.error("Error loading plans for review:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPlansForReview();
  }, [user]);

  const handleReviewAction = async (statusAssigned: PlanStatus, reviewMode: "plan" | "post" | "plan_and_post") => {
    if (!selectedPlan || !user) return;
    setIsSubmitting(true);
    setMsg(null);

    try {
      const reviewerName = profile?.full_name || "นางสาวอำพร คงเจริญ";
      const reviewerRole = "ผู้อำนวยการสถานศึกษา";
      let finalReviewedUrl = reviewedFileUrl.trim() || null;
      let finalReviewedFileId: string | null = null;

      // หาก ผอ. เซ็นชื่อ E-Signature บนหน้าเว็บ ให้นำลายเซ็นไปฝังลงใน PDF และอัปโหลดกลับไปที่ Google Drive
      if (
        signatureDataUrl &&
        statusAssigned !== "แผนต้องแก้ไข" &&
        statusAssigned !== "บันทึกต้องแก้ไข"
      ) {
        setMsg({
          type: "success",
          text: "กำลังประทับลายเซ็นลงในไฟล์ PDF และอัปโหลดกลับไปยัง Google Drive...",
        });

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
        }

        const sourceFileUrl = selectedPlan.post_file_url || selectedPlan.plan_file_url;
        const sourceFileId = selectedPlan.post_file_id || selectedPlan.plan_file_id;
        const todayStr = new Date().toLocaleDateString("en-GB");

        const signRes = await fetch("/api/drive/sign", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            fileId: sourceFileId || undefined,
            fileUrl: sourceFileUrl,
            signatureDataUrl,
            pageChoice: signPageChoice,
            position: signPosition,
            teacherName: selectedPlan.teacher_name,
            taskCode: selectedPlan.task_code,
            signDateText: todayStr,
          }),
        });

        const signData = await signRes.json();
        if (!signRes.ok || !signData.viewUrl) {
          throw new Error(signData.error || "ฝังลายเซ็นลงในไฟล์ PDF ไม่สำเร็จ");
        }
        finalReviewedUrl = signData.viewUrl;
        finalReviewedFileId = signData.fileId || null;
        setReviewedFileUrl(signData.viewUrl);
      }

      // 1. บันทึกผลการตรวจลงตาราง plan_reviews
      const reviewRecord = {
        plan_id: selectedPlan.id,
        reviewer_name: reviewerName,
        reviewer_role: reviewerRole,
        review_mode: reviewMode,
        status_assigned: statusAssigned,
        note: reviewNote.trim() || "-",
        reviewed_file_url: finalReviewedUrl,
        reviewed_file_id: finalReviewedFileId,
        created_by: user.id,
      };

      const { error: reviewErr } = await supabase.from("plan_reviews").insert([reviewRecord]);
      if (reviewErr) throw reviewErr;

      // 2. อัปเดตสถานะของแผน
      const { error: planErr } = await supabase
        .from("lesson_plans")
        .update({
          status: statusAssigned,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedPlan.id);

      if (planErr) throw planErr;

      // 3. แจ้งเตือนเข้า LINE กลุ่มโรงเรียน
      try {
        await fetch("/api/line-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: "plan_reviewed",
            planData: selectedPlan,
            reviewData: reviewRecord,
          }),
        });
      } catch (lineErr) {
        console.warn("LINE Notify failed:", lineErr);
      }

      setMsg({ type: "success", text: `บันทึกผลการตรวจ [${statusAssigned}] สำเร็จ และส่งแจ้งเตือน LINE เรียบร้อย!` });
      setTimeout(() => {
        setSelectedPlan(null);
        setReviewNote("");
        setReviewedFileUrl("");
        setSignatureDataUrl(null);
        setMsg(null);
        loadPlansForReview();
      }, 1500);
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "เกิดข้อผิดพลาดในการบันทึกผลตรวจ" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 text-center glass-panel rounded-3xl">
        <ShieldAlert className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-800">ไม่มีสิทธิ์เข้าถึงหน้านี้</h2>
        <p className="text-xs text-slate-500 mt-1">
          เฉพาะผู้บริหารสถานศึกษา (ผอ.) เท่านั้นที่มีสิทธิ์ตรวจอนุมัติแผนการจัดการเรียนรู้
        </p>
      </div>
    );
  }

  const pendingPlans = plans.filter(p => p.status === "รอตรวจแผน" || p.status === "รอตรวจบันทึก");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-800 flex items-center gap-2">
          <FileCheck className="w-6 h-6 text-amber-600" />
          ระบบนิเทศและตรวจแผนการสอน (สำหรับ ผอ.)
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          ตรวจแผน อนุมัติ ส่งกลับแก้ไข และแนบไฟล์ที่ขีดเขียนใน iPad
        </p>
      </div>

      {/* รายการแผนที่รอตรวจ */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
          <span>รายการที่รอการตรวจอนุมัติ</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-extrabold">
            {pendingPlans.length}
          </span>
        </h2>

        {pendingPlans.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center text-slate-500 text-sm">
            ไม่มีงานค้างตรวจในขณะนี้ คณะครูส่งงานครบถ้วนแล้วครับ
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingPlans.map((p) => (
              <div
                key={p.id}
                className="glass-card rounded-2xl p-5 border border-white/80 space-y-3 hover:shadow-md transition-all"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">{p.teacher_name}</h3>
                    <p className="text-xs text-slate-500">{p.subject} ({p.class_level})</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                    p.status === 'รอตรวจแผน' ? 'bg-amber-100 text-amber-800' : 'bg-purple-100 text-purple-800'
                  }`}>
                    {p.status}
                  </span>
                </div>

                <div className="text-xs text-slate-600 bg-white/60 p-2.5 rounded-xl border border-slate-100 space-y-1">
                  <div><b>รูปแบบ:</b> {p.scope_value} (v{p.version})</div>
                  {p.unit_title && <div><b>เรื่อง:</b> {p.unit_title}</div>}
                  <div><b>วันที่ส่ง:</b> {new Date(p.created_at).toLocaleDateString("th-TH")}</div>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <a
                    href={p.post_file_url || p.plan_file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-pink-700 hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    เปิดดูไฟล์ PDF
                  </a>

                  <button
                    onClick={() => {
                      setSelectedPlan(p);
                      setReviewNote("");
                      setReviewedFileUrl("");
                    }}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-pink-600 text-white shadow-sm hover:shadow"
                  >
                    ตรวจงานนี้ →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review Modal */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="max-w-3xl w-full glass-panel rounded-3xl p-6 border border-white/80 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-display font-bold text-lg text-slate-800">
                  ตรวจแผน: {selectedPlan.teacher_name}
                </h3>
                <p className="text-xs text-slate-500">
                  วิชา {selectedPlan.subject} ({selectedPlan.class_level}) - {selectedPlan.scope_value}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedPlan(null);
                  setSignatureDataUrl(null);
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {msg && (
              <div className={`p-3 rounded-xl text-xs ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                {msg.text}
              </div>
            )}

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <span className="text-xs text-slate-600 font-medium">ไฟล์เอกสารที่ครูส่ง:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPreview((v) => !v)}
                    className="px-3 py-1.5 rounded-xl bg-white text-slate-700 border border-slate-200 text-xs font-semibold hover:bg-slate-100 flex items-center gap-1"
                  >
                    {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showPreview ? "ซ่อนตัวอย่าง PDF" : "แสดงตัวอย่าง PDF"}
                  </button>
                  <a
                    href={selectedPlan.post_file_url || selectedPlan.plan_file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-xl bg-pink-50 text-pink-700 border border-pink-200 text-xs font-bold hover:bg-pink-100 flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    เปิดอ่านในแท็บใหม่ ↗
                  </a>
                </div>
              </div>

              {showPreview && (() => {
                const previewSrc = getDrivePreviewSrc(
                  selectedPlan.post_file_url || selectedPlan.plan_file_url,
                  selectedPlan.post_file_id || selectedPlan.plan_file_id
                );
                return previewSrc ? (
                  <iframe
                    src={previewSrc}
                    title="PDF Preview"
                    className="w-full h-72 rounded-xl border border-slate-200 bg-white"
                    allow="autoplay"
                  />
                ) : (
                  <p className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded-lg">
                    ไม่สามารถแสดงตัวอย่างในหน้านี้ได้ กรุณากด &quot;เปิดอ่านในแท็บใหม่&quot;
                  </p>
                );
              })()}
            </div>

            {/* E-Signature Section */}
            <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    ลงนามอิเล็กทรอนิกส์ (E-Signature) บนไฟล์ PDF
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    เซ็นชื่อด้านล่างแล้วกดอนุมัติ ระบบจะฝังลายเซ็นลงใน PDF และอัปโหลดกลับ Google Drive ให้อัตโนมัติ
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <select
                    value={signPageChoice}
                    onChange={(e) => setSignPageChoice(e.target.value as "first" | "last")}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs"
                  >
                    <option value="last">ประทับที่หน้าสุดท้าย</option>
                    <option value="first">ประทับที่หน้าแรก</option>
                  </select>
                  <select
                    value={signPosition}
                    onChange={(e) =>
                      setSignPosition(
                        e.target.value as "bottom-right" | "bottom-center" | "bottom-left"
                      )
                    }
                    className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs"
                  >
                    <option value="bottom-right">มุมขวาล่าง</option>
                    <option value="bottom-center">กึ่งกลางล่าง</option>
                    <option value="bottom-left">มุมซ้ายล่าง</option>
                  </select>
                </div>
              </div>

              <SignaturePad
                onChange={setSignatureDataUrl}
                signerName={profile?.full_name || "นางสาวอำพร คงเจริญ"}
                signerTitle="ผู้อำนวยการโรงเรียนวัดโป่งแรดฯ"
              />
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  หมายเหตุ / ข้อเสนอแนะจาก ผอ. (ถ้ามี)
                </label>
                <textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="พิมพ์ข้อคิดเห็นหรือจุดที่ต้องแก้ไขที่นี่..."
                  rows={2}
                  className="w-full p-3 rounded-xl text-xs glass-input text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ลิงก์ไฟล์ PDF ที่ตรวจแล้ว (สร้างอัตโนมัติเมื่อเซ็น E-Signature หรือวางลิงก์เอง)
                </label>
                <input
                  type="url"
                  value={reviewedFileUrl}
                  onChange={(e) => setReviewedFileUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/..."
                  className="w-full px-3 py-2 rounded-xl text-xs glass-input text-slate-800"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <div className="text-xs font-bold text-slate-700">เลือกผลการพิจารณา:</div>
                <span className="text-[11px] text-slate-500">
                  * ผอ. ตรวจครั้งเดียว: หากสั่งแก้ไข ครูแก้แล้วส่งแทนไฟล์เดิมจะผ่านอัตโนมัติ
                </span>
              </div>

              {selectedPlan.status === "รอตรวจบันทึก" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleReviewAction("บันทึกต้องแก้ไข", "post")}
                    className="py-2.5 px-3 rounded-xl border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    ✎ บันทึกต้องแก้ไข (ครูแก้แทนไฟล์เดิมได้)
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleReviewAction("เสร็จสมบูรณ์", "post")}
                    className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold shadow hover:shadow-md transition-all disabled:opacity-50"
                  >
                    ✔✔ อนุมัติเสร็จสมบูรณ์
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleReviewAction("แผนต้องแก้ไข", "plan")}
                      className="py-2.5 px-3 rounded-xl border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 text-xs font-bold transition-colors disabled:opacity-50"
                    >
                      ✎ แผนต้องแก้ไข (ครูแก้แทนไฟล์เดิมได้)
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleReviewAction("แผนผ่าน (รอส่งบันทึก)", "plan")}
                      className="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow transition-colors disabled:opacity-50"
                    >
                      ✔ แผนผ่าน (รอส่งบันทึก)
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleReviewAction("เสร็จสมบูรณ์", "plan_and_post")}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold shadow hover:shadow-md transition-all disabled:opacity-50"
                  >
                    ✔✔ อนุมัติเสร็จสมบูรณ์ (กรณีมีบันทึกหลังสอนในเล่มแล้ว)
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
