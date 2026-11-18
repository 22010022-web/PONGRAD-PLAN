"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabase/client";
import { LessonPlan, PlanStatus } from "@/types/database";
import { FileCheck, ShieldAlert, ExternalLink, X } from "lucide-react";
import {
  DirectorOverlayExport,
  DirectorStampCanvas,
} from "@/components/director-stamp-canvas";
import {
  buildSubmissionOrderMap,
  formatThaiDateTime,
  isPermissionMemoPlan,
  PlanSortOrder,
  sortPlansByDate,
} from "@/lib/plan-ordering";

type ReviewFilterType = "all" | "permission" | "plan";

export default function ReviewPage() {
  const { user, profile, isAdmin } = useAuth();
  const params = useParams<{ id?: string }>();
  const autoOpenedIdRef = useRef<string | null>(null);
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortOrder, setSortOrder] = useState<PlanSortOrder>("oldest");
  const [filterType, setFilterType] = useState<ReviewFilterType>("all");
  const [selectedPlan, setSelectedPlan] = useState<LessonPlan | null>(null);
  const [reviewNote, setReviewNote] = useState("");
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

  // ซ่อน Scrollbar ของหน้าเว็บหลักด้านขวาสุดเมื่อเปิดหน้าต่างตรวจแผน เพื่อให้เลื่อนเฉพาะในกรอบ PDF เท่านั้น
  useEffect(() => {
    if (!selectedPlan || typeof document === "undefined") return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [selectedPlan]);

  useEffect(() => {
    if (!isAdmin || plans.length === 0) return;
    const targetId =
      (typeof params?.id === "string" ? params.id : "") ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("id") || ""
        : "");
    if (!targetId || autoOpenedIdRef.current === targetId) return;
    const found = plans.find((p) => p.id === targetId);
    if (found) {
      autoOpenedIdRef.current = targetId;
      handleOpenPlanModal(found);
    }
  }, [isAdmin, params?.id, plans]);

  const handleOpenPlanModal = (p: LessonPlan) => {
    setSelectedPlan(p);
    setReviewedFileUrl("");
    setMsg(null);
    setStampOntoPdf(true);
    setReviewNote("");
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

      // ประทับลายมือเขียนแก้ไขและลายเซ็น ผอ. ลงบนไฟล์ PDF แล้วบันทึกลง Google Drive
      if (stampOntoPdf && overlayExporterRef.current) {
        const exported = overlayExporterRef.current();
        if (exported?.overlays && exported.overlays.length > 0) {
          setMsg({
            type: "success",
            text: `กำลังบันทึกลายเซ็นและลายมือเขียนของ ผอ. ลงในไฟล์ PDF และอัปโหลดไปยัง Google Drive...`,
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
              overlays: exported.overlays,
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
      let quotaWarning = "";
      try {
        const lineRes = await fetch("/api/line-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: "plan_reviewed",
            planData: selectedPlan,
            reviewData: reviewRecord,
          }),
        });
        const lineJson = await lineRes.json().catch(() => ({}));
        if (lineJson?.quotaExceeded) {
          quotaWarning =
            " (โควตา LINE Push เดือนนี้หมดแล้ว — ครูพิมพ์ 'ผ่านแล้ว' หรือ 'งานแก้ไข' ในกลุ่ม LINE เพื่อดูผลฟรีได้เลย)";
        }
      } catch (lineErr) {
        console.warn("LINE Notify failed:", lineErr);
      }

      setMsg({
        type: "success",
        text: quotaWarning
          ? `บันทึกผลการตรวจ [${statusAssigned}] สำเร็จ!${quotaWarning}`
          : `บันทึกผลการตรวจ [${statusAssigned}] สำเร็จ และส่งแจ้งเตือน LINE เรียบร้อย!`,
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

  const orderMap = buildSubmissionOrderMap(plans);
  const allPendingPlans = plans.filter(
    (p) => p.status === "รอตรวจแผน" || p.status === "รอตรวจบันทึก"
  );
  const pendingPermissionCount = allPendingPlans.filter((p) => isPermissionMemoPlan(p)).length;
  const pendingPlanCount = allPendingPlans.length - pendingPermissionCount;
  const pendingPlans = sortPlansByDate(
    allPendingPlans.filter((p) => {
      if (filterType === "permission") return isPermissionMemoPlan(p);
      if (filterType === "plan") return !isPermissionMemoPlan(p);
      return true;
    }),
    sortOrder
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-800 flex items-center gap-2">
          <FileCheck className="w-6 h-6 text-amber-600" />
          ระบบนิเทศและตรวจแผนการสอน (สำหรับ ผอ.)
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          ประทับความเห็นและลายเซ็นบนหน้ากระดาษ PDF ทั้งแผนการสอนและใบขออนุญาตใช้แผน (บันทึกข้อความ) พร้อมจำลายเซ็นอัตโนมัติ
        </p>
      </div>

      {/* รายการแผนที่รอตรวจ */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
              <span>รายการที่รอการตรวจอนุมัติ</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-extrabold">
                {pendingPlans.length}
              </span>
            </h2>

            <div className="inline-flex flex-wrap rounded-xl bg-white/75 p-1 border border-slate-200 gap-1">
              {[
                { key: "all" as ReviewFilterType, label: `ทั้งหมด (${allPendingPlans.length})` },
                {
                  key: "permission" as ReviewFilterType,
                  label: `📝 ใบขออนุญาต (${pendingPermissionCount})`,
                },
                { key: "plan" as ReviewFilterType, label: `📚 แผน/บันทึก (${pendingPlanCount})` },
              ].map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setFilterType(chip.key)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                    filterType === chip.key
                      ? "bg-amber-600 text-white shadow-xs"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as PlanSortOrder)}
            className="text-xs rounded-xl glass-input px-3 py-1.5 text-slate-700 font-semibold"
          >
            <option value="oldest">เรียง: ส่งก่อนตรวจก่อน (ลำดับ 1 → ...)</option>
            <option value="newest">เรียง: ส่งล่าสุดอยู่บน</option>
          </select>
        </div>

        {isLoading ? (
          <div className="glass-card rounded-2xl p-8 text-center text-slate-500 text-sm">
            กำลังโหลดรายการแผนการสอน...
          </div>
        ) : pendingPlans.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center text-slate-500 text-sm">
            ไม่มีงานค้างตรวจในหมวดนี้
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingPlans.map((p) => {
              const order = orderMap[p.id];
              const isPermMemo = isPermissionMemoPlan(p);
              const { dateText, timeText } = formatThaiDateTime(p.created_at);
              return (
              <div
                key={p.id}
                className={`glass-card rounded-2xl p-5 border space-y-3 hover:shadow-md transition-all ${
                  isPermMemo ? "border-teal-300 bg-teal-50/20" : "border-white/80"
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {isPermMemo && (
                        <span className="px-2 py-0.5 rounded-md bg-teal-100 text-teal-800 border border-teal-300 text-[11px] font-bold">
                          📝 ใบขออนุญาตใช้แผน (1 ใบ/วิชา)
                        </span>
                      )}
                      {order && (
                        <span className="px-2 py-0.5 rounded-md bg-pink-50 text-pink-700 border border-pink-200 text-[11px] font-bold">
                          ส่งครั้งที่ {order.teacherOrder} ({p.subject} #{order.subjectOrder})
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-slate-900 text-base mt-1">{p.teacher_name}</h3>
                    <p className="text-xs text-slate-500">
                      {p.subject} ({p.class_level})
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${
                      isPermMemo
                        ? "bg-teal-100 text-teal-800"
                        : p.status === "รอตรวจแผน"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-purple-100 text-purple-800"
                    }`}
                  >
                    {isPermMemo ? "รออนุญาตใช้แผน" : p.status}
                  </span>
                </div>

                <div className="text-xs text-slate-600 bg-white/60 p-2.5 rounded-xl border border-slate-100 space-y-1">
                  <div>
                    <b>รูปแบบ:</b> {p.scope_value} (v{p.version})
                  </div>
                  {p.unit_title && (
                    <div>
                      <b>{isPermMemo ? "เลขที่/ชั่วโมง:" : "เรื่อง:"}</b> {p.unit_title}
                    </div>
                  )}
                  <div>
                    <b>วันที่ส่ง:</b> {dateText} {timeText}
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
                    className={`px-4 py-1.5 rounded-xl text-xs font-bold text-white shadow-sm hover:shadow ${
                      isPermMemo
                        ? "bg-gradient-to-r from-teal-600 to-emerald-600"
                        : "bg-gradient-to-r from-amber-500 to-pink-600"
                    }`}
                  >
                    {isPermMemo ? "ลงนามใบขออนุญาต →" : "ตรวจและลงนาม →"}
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Review & Interactive Stamp Modal */}
      {selectedPlan && (
        <div className="fixed inset-0 !mt-0 z-[60] flex items-center justify-center p-1.5 sm:p-2.5 bg-slate-900/55 backdrop-blur-sm overflow-hidden">
          <div className="max-w-[98vw] xl:max-w-[1540px] w-full glass-panel rounded-2xl sm:rounded-3xl p-2.5 sm:p-4 border border-white/80 shadow-2xl flex flex-col gap-2 h-[96vh] overflow-hidden">
            <div className="shrink-0 flex flex-wrap justify-between items-center gap-2 border-b border-slate-200 pb-2">
              <div>
                <h3 className="font-display font-bold text-base sm:text-lg text-slate-800">
                  {isPermissionMemoPlan(selectedPlan)
                    ? `ลงนามใบขออนุญาตใช้แผน (บันทึกข้อความ): ${selectedPlan.teacher_name}`
                    : `ตรวจแผนและประทับลายเซ็น: ${selectedPlan.teacher_name}`}
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
                className={`shrink-0 p-3 rounded-xl text-xs font-semibold ${
                  msg.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-red-50 text-red-800 border border-red-200"
                }`}
              >
                {msg.text}
              </div>
            )}

            {/* Interactive PDF Stamp & Comment Canvas */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <DirectorStampCanvas
                fileId={selectedPlan.post_file_id || selectedPlan.plan_file_id}
                fileUrl={selectedPlan.post_file_url || selectedPlan.plan_file_url}
                signerName={profile?.full_name || "นางสาวอำพร คงเจริญ"}
                signerTitle="ผู้อำนวยการโรงเรียนวัดโป่งแรด(ปคุณวิทยาคาร)"
                commentText={reviewNote}
                onCommentChange={setReviewNote}
                onBindExporter={(fn) => {
                  overlayExporterRef.current = fn;
                }}
              />
            </div>

            {/* Options & Action Buttons */}
            <div className="shrink-0 space-y-2.5 pt-2.5 border-t border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-indigo-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stampOntoPdf}
                    onChange={(e) => setStampOntoPdf(e.target.checked)}
                    className="accent-indigo-600 w-4 h-4"
                  />
                  <span>
                    บันทึกลายเซ็น ผอ. และลายมือที่เขียนแก้ไขลงในไฟล์ PDF (อัปเดตทับไฟล์ใน Google Drive)
                  </span>
                </label>

                <span className="text-[11px] text-slate-500">
                  {isPermissionMemoPlan(selectedPlan)
                    ? "* ใช้ปากกาสีน้ำเงิน/แดงติ๊กอนุญาต เขียนเหตุผล และวางลายเซ็น ผอ. แล้วกดอนุญาต"
                    : "* ผอ. ตรวจครั้งเดียว: หากสั่งแก้ไข ครูแก้แล้วส่งแทนไฟล์เดิมจะผ่านอัตโนมัติ"}
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
              ) : isPermissionMemoPlan(selectedPlan) ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleReviewAction("แผนต้องแก้ไข", "plan")}
                    className="py-3 px-4 rounded-xl border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 text-xs sm:text-sm font-bold transition-colors disabled:opacity-50"
                  >
                    ✎ ไม่อนุญาต / ส่งกลับให้ครูแก้ไข
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleReviewAction("เสร็จสมบูรณ์", "plan_and_post")}
                    className="py-3 px-4 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-xs sm:text-sm font-bold shadow hover:shadow-md transition-all disabled:opacity-50"
                  >
                    ✔✔ อนุญาตให้ใช้แผนการจัดการเรียนรู้ (ลงนามเสร็จสมบูรณ์)
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
