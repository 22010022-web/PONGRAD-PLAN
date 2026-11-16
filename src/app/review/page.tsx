"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabase/client";
import { LessonPlan, PlanStatus } from "@/types/database";
import { FileCheck, ShieldAlert, ExternalLink, X } from "lucide-react";
import {
  COMMENT_PRESETS,
  DirectorOverlayExport,
  DirectorStampCanvas,
} from "@/components/director-stamp-canvas";

export default function ReviewPage() {
  const { user, profile, isAdmin } = useAuth();
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<LessonPlan | null>(null);
  const [reviewNote, setReviewNote] = useState(COMMENT_PRESETS[0].text);
  const [approvalChoice, setApprovalChoice] = useState<"allow" | "disallow">("allow");
  const [stampOntoPdf, setStampOntoPdf] = useState(true);
  const [reviewedFileUrl, setReviewedFileUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const overlayExporterRef = useRef<(() => DirectorOverlayExport | null) | null>(null);

  const loadPlansForReview = async () => {
    try {
      const { data } = await supabase
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

  const handleOpenPlanModal = (p: LessonPlan) => {
    setSelectedPlan(p);
    setReviewedFileUrl("");
    setMsg(null);
    setApprovalChoice("allow");
    setStampOntoPdf(true);
    setReviewNote(
      p.status === "รอตรวจบันทึก" ? COMMENT_PRESETS[2].text : COMMENT_PRESETS[0].text
    );
  };

  const handleReviewAction = async (
    statusAssigned: PlanStatus,
    reviewMode: "plan" | "post" | "plan_and_post"
  ) => {
    if (!selectedPlan || !user) return;
    setIsSubmitting(true);
    setMsg(null);

    try {
      const reviewerName = profile?.full_name || "นางสาวอำพร คงเจริญ";
      const reviewerRole = "ผู้อำนวยการสถานศึกษา";
      let finalReviewedUrl = reviewedFileUrl.trim() || null;
      let finalReviewedFileId: string | null = null;

      // ประทับกล่องความเห็นและลายเซ็นสีน้ำเงินลงบนหน้า PDF ที่เลือก แล้วอัปโหลดกลับไปที่ Google Drive
      if (stampOntoPdf && overlayExporterRef.current) {
        const exported = overlayExporterRef.current();
        if (exported?.overlayPngDataUrl) {
          setMsg({
            type: "success",
            text: `กำลังประทับความเห็นและลายเซ็นลงในหน้า ${exported.pageNumber} ของไฟล์ PDF และอัปโหลดไปยัง Google Drive...`,
          });

          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!session?.access_token) {
            throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
          }

          const sourceFileUrl = selectedPlan.post_file_url || selectedPlan.plan_file_url;
          const sourceFileId = selectedPlan.post_file_id || selectedPlan.plan_file_id;

          const signRes = await fetch("/api/drive/sign", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              fileId: sourceFileId || undefined,
              fileUrl: sourceFileUrl,
              overlayPngDataUrl: exported.overlayPngDataUrl,
              pageNumber: exported.pageNumber,
              teacherName: selectedPlan.teacher_name,
              taskCode: selectedPlan.task_code,
            }),
          });

          const signData = await signRes.json();
          if (!signRes.ok || !signData.viewUrl) {
            throw new Error(signData.error || "ประทับความเห็นและลายเซ็นลงในไฟล์ PDF ไม่สำเร็จ");
          }
          finalReviewedUrl = signData.viewUrl;
          finalReviewedFileId = signData.fileId || null;
          setReviewedFileUrl(signData.viewUrl);
        }
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

      // 2. อัปเดตสถานะของแผน (และอัปเดตลิงก์ไฟล์หลักให้ชี้ไปยังไฟล์ที่ลงนามแล้วเสมอ)
      const planUpdatePayload: Record<string, any> = {
        status: statusAssigned,
        updated_at: new Date().toISOString(),
      };

      if (finalReviewedUrl) {
        if (reviewMode === "post" && !selectedPlan.use_existing_file && selectedPlan.post_file_url) {
          planUpdatePayload.post_file_url = finalReviewedUrl;
          if (finalReviewedFileId) planUpdatePayload.post_file_id = finalReviewedFileId;
        } else {
          planUpdatePayload.plan_file_url = finalReviewedUrl;
          if (finalReviewedFileId) planUpdatePayload.plan_file_id = finalReviewedFileId;
          if (selectedPlan.use_existing_file && selectedPlan.post_file_url) {
            planUpdatePayload.post_file_url = finalReviewedUrl;
            if (finalReviewedFileId) planUpdatePayload.post_file_id = finalReviewedFileId;
          }
        }
      }

      const { error: planErr } = await supabase
        .from("lesson_plans")
        .update(planUpdatePayload)
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

      setMsg({
        type: "success",
        text: `บันทึกผลการตรวจ [${statusAssigned}] สำเร็จ และส่งแจ้งเตือน LINE เรียบร้อย!`,
      });
      setTimeout(() => {
        setSelectedPlan(null);
        setReviewedFileUrl("");
        setMsg(null);
        loadPlansForReview();
      }, 1400);
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

  const pendingPlans = plans.filter(
    (p) => p.status === "รอตรวจแผน" || p.status === "รอตรวจบันทึก"
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-800 flex items-center gap-2">
          <FileCheck className="w-6 h-6 text-amber-600" />
          ระบบนิเทศและตรวจแผนการสอน (สำหรับ ผอ.)
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          ประทับความเห็นและลายเซ็นบนหน้ากระดาษ PDF แบบลากวางตำแหน่งได้จริง พร้อมจำลายเซ็นอัตโนมัติ
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

        {isLoading ? (
          <div className="glass-card rounded-2xl p-8 text-center text-slate-500 text-sm">
            กำลังโหลดรายการแผนการสอน...
          </div>
        ) : pendingPlans.length === 0 ? (
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
                    <p className="text-xs text-slate-500">
                      {p.subject} ({p.class_level})
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      p.status === "รอตรวจแผน"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-purple-100 text-purple-800"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>

                <div className="text-xs text-slate-600 bg-white/60 p-2.5 rounded-xl border border-slate-100 space-y-1">
                  <div>
                    <b>รูปแบบ:</b> {p.scope_value} (v{p.version})
                  </div>
                  {p.unit_title && (
                    <div>
                      <b>เรื่อง:</b> {p.unit_title}
                    </div>
                  )}
                  <div>
                    <b>วันที่ส่ง:</b> {new Date(p.created_at).toLocaleDateString("th-TH")}
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <a
                    href={p.post_file_url || p.plan_file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-pink-700 hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    เปิดดูไฟล์ PDF ต้นฉบับ
                  </a>

                  <button
                    onClick={() => handleOpenPlanModal(p)}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-pink-600 text-white shadow-sm hover:shadow"
                  >
                    ตรวจและลงนาม →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review & Interactive Stamp Modal */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="max-w-6xl w-full glass-panel rounded-3xl p-4 sm:p-6 border border-white/80 shadow-2xl space-y-4 max-h-[95vh] overflow-y-auto">
            <div className="flex flex-wrap justify-between items-center gap-2 border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-display font-bold text-base sm:text-lg text-slate-800">
                  ตรวจแผนและประทับลายเซ็น: {selectedPlan.teacher_name}
                </h3>
                <p className="text-xs text-slate-500">
                  วิชา {selectedPlan.subject} ({selectedPlan.class_level}) ·{" "}
                  {selectedPlan.scope_value}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={selectedPlan.post_file_url || selectedPlan.plan_file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-xl bg-pink-50 text-pink-700 border border-pink-200 text-xs font-bold hover:bg-pink-100 flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  เปิดไฟล์เต็มในแท็บใหม่
                </a>
                <button
                  onClick={() => setSelectedPlan(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {msg && (
              <div
                className={`p-3 rounded-xl text-xs font-semibold ${
                  msg.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-red-50 text-red-800 border border-red-200"
                }`}
              >
                {msg.text}
              </div>
            )}

            {/* Interactive PDF Stamp & Comment Canvas */}
            <DirectorStampCanvas
              fileId={selectedPlan.post_file_id || selectedPlan.plan_file_id}
              fileUrl={selectedPlan.post_file_url || selectedPlan.plan_file_url}
              signerName={profile?.full_name || "นางสาวอำพร คงเจริญ"}
              signerTitle="ผู้อำนวยการโรงเรียนวัดโป่งแรด(ปคุณวิทยาคาร)"
              commentText={reviewNote}
              onCommentChange={setReviewNote}
              approvalChoice={approvalChoice}
              onApprovalChoiceChange={setApprovalChoice}
              onBindExporter={(fn) => {
                overlayExporterRef.current = fn;
              }}
            />

            {/* Options & Action Buttons */}
            <div className="space-y-3 pt-3 border-t border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stampOntoPdf}
                    onChange={(e) => setStampOntoPdf(e.target.checked)}
                    className="accent-indigo-600 w-4 h-4"
                  />
                  <span>
                    ประทับเครื่องหมาย ✓ + ความเห็น + ลายเซ็น ผอ. ลงในไฟล์ PDF และบันทึกลง Google Drive
                  </span>
                </label>

                <span className="text-[11px] text-slate-500">
                  * ผอ. ตรวจครั้งเดียว: หากสั่งแก้ไข ครูแก้แล้วส่งแทนไฟล์เดิมจะผ่านอัตโนมัติ
                </span>
              </div>

              {selectedPlan.status === "รอตรวจบันทึก" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleReviewAction("บันทึกต้องแก้ไข", "post")}
                    className="py-3 px-4 rounded-xl border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 text-xs sm:text-sm font-bold transition-colors disabled:opacity-50"
                  >
                    ✎ บันทึกต้องแก้ไข (ครูแก้แทนไฟล์เดิมได้)
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleReviewAction("เสร็จสมบูรณ์", "post")}
                    className="py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs sm:text-sm font-bold shadow hover:shadow-md transition-all disabled:opacity-50"
                  >
                    ✔✔ อนุมัติเสร็จสมบูรณ์ (พร้อมประทับลายเซ็น)
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleReviewAction("แผนต้องแก้ไข", "plan")}
                    className="py-3 px-4 rounded-xl border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 text-xs sm:text-sm font-bold transition-colors disabled:opacity-50"
                  >
                    ✎ แผนต้องแก้ไข (ครูแก้แทนไฟล์เดิมได้)
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleReviewAction("แผนผ่าน (รอส่งบันทึก)", "plan")}
                    className="py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow transition-colors disabled:opacity-50"
                  >
                    ✔ แผนผ่าน (รอส่งบันทึก)
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleReviewAction("เสร็จสมบูรณ์", "plan_and_post")}
                    className="py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs sm:text-sm font-bold shadow hover:shadow-md transition-all disabled:opacity-50"
                  >
                    ✔✔ อนุมัติเสร็จสมบูรณ์ (มีบันทึกในเล่มแล้ว)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
