"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabase/client";
import { LessonPlan } from "@/types/database";
import {
  BookOpen,
  AlertCircle,
  CheckCircle2,
  Upload,
  Link as LinkIcon,
  Loader2,
  FileText,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { uploadPdfToGoogleDrive } from "@/lib/drive-upload-client";

export default function MyPlansPage() {
  const { user, isAdmin } = useAuth();
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionAlert, setActionAlert] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  // State สำหรับส่งบันทึกหลังสอนครั้งแรก
  const [selectedPlanForPost, setSelectedPlanForPost] = useState<LessonPlan | null>(null);
  const [useExistingFile, setUseExistingFile] = useState(true);
  const [postFileUrl, setPostFileUrl] = useState("");
  const [postFileId, setPostFileId] = useState<string | null>(null);
  const [postUploadedName, setPostUploadedName] = useState<string | null>(null);
  const [postUploadProgress, setPostUploadProgress] = useState<number | null>(null);
  const [isUploadingPost, setIsUploadingPost] = useState(false);
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [postSuccess, setPostSuccess] = useState("");
  const [postError, setPostError] = useState("");

  // State สำหรับอัปโหลดไฟล์ฉบับแก้ไขแทนไฟล์เดิม (ผอ. ตรวจครั้งเดียว ไม่ต้องตรวจซ้ำ)
  const [selectedPlanForRevise, setSelectedPlanForRevise] = useState<LessonPlan | null>(null);
  const [reviseFileUrl, setReviseFileUrl] = useState("");
  const [reviseFileId, setReviseFileId] = useState<string | null>(null);
  const [reviseUploadedName, setReviseUploadedName] = useState<string | null>(null);
  const [reviseUploadProgress, setReviseUploadProgress] = useState<number | null>(null);
  const [isUploadingRevise, setIsUploadingRevise] = useState(false);
  const [isSubmittingRevise, setIsSubmittingRevise] = useState(false);
  const [reviseSuccess, setReviseSuccess] = useState("");
  const [reviseError, setReviseError] = useState("");

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

  const handlePostFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPlanForPost) return;

    setPostError("");
    setIsUploadingPost(true);
    setPostUploadProgress(0);

    try {
      const result = await uploadPdfToGoogleDrive(
        file,
        selectedPlanForPost.teacher_name || "ครูผู้สอน",
        (pct) => setPostUploadProgress(pct),
        { kind: "post" }
      );
      setPostFileId(result.fileId);
      setPostFileUrl(result.viewUrl);
      setPostUploadedName(result.fileName);
    } catch (err: any) {
      setPostError(err?.message || "อัปโหลดไฟล์บันทึกหลังสอนไม่สำเร็จ");
      setPostUploadProgress(null);
    } finally {
      setIsUploadingPost(false);
    }
  };

  const handlePostSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanForPost) return;

    setIsSubmittingPost(true);
    setPostError("");
    setPostSuccess("");

    try {
      const finalPostUrl = useExistingFile ? selectedPlanForPost.plan_file_url : postFileUrl.trim();
      const finalPostFileId = useExistingFile
        ? selectedPlanForPost.plan_file_id || null
        : postFileId;

      const { error: updateErr } = await supabase
        .from("lesson_plans")
        .update({
          status: "รอตรวจบันทึก",
          post_file_url: finalPostUrl,
          post_file_id: finalPostFileId,
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

  const handleDeletePlan = async (plan: LessonPlan) => {
    const canDelete = isAdmin || plan.status === "รอตรวจแผน";
    if (!canDelete) {
      setActionAlert({
        type: "error",
        text: "ไม่สามารถลบแผนที่ผ่านการตรวจหรือเสร็จสมบูรณ์แล้วได้ (เฉพาะ ผอ./แอดมิน ลบได้)",
      });
      return;
    }

    if (!window.confirm(`ยืนยันการลบแผนวิชา "${plan.subject} (${plan.class_level})" ใช่หรือไม่?`)) {
      return;
    }

    setDeletingPlanId(plan.id);
    setActionAlert(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
      }

      const res = await fetch("/api/plans/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ planId: plan.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "ลบแผนการสอนไม่สำเร็จ");
      }

      setActionAlert({ type: "success", text: `ลบแผน "${plan.subject}" เรียบร้อยแล้ว` });
      loadMyPlans();
    } catch (err: any) {
      setActionAlert({ type: "error", text: err?.message || "ลบแผนการสอนไม่สำเร็จ" });
    } finally {
      setDeletingPlanId(null);
    }
  };

  const openReviseModal = (plan: LessonPlan) => {
    setSelectedPlanForRevise(plan);
    setReviseFileUrl("");
    setReviseFileId(null);
    setReviseUploadedName(null);
    setReviseUploadProgress(null);
    setReviseError("");
    setReviseSuccess("");
  };

  const handleReviseFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPlanForRevise) return;

    const isPostRevision = selectedPlanForRevise.status === "บันทึกต้องแก้ไข";
    const oldFileId = isPostRevision
      ? selectedPlanForRevise.post_file_id
      : selectedPlanForRevise.plan_file_id;

    setReviseError("");
    setIsUploadingRevise(true);
    setReviseUploadProgress(0);

    try {
      const result = await uploadPdfToGoogleDrive(
        file,
        selectedPlanForRevise.teacher_name || "ครูผู้สอน",
        (pct) => setReviseUploadProgress(pct),
        {
          kind: isPostRevision ? "post" : "plan",
          replaceFileId: oldFileId,
          planId: selectedPlanForRevise.id,
        }
      );
      setReviseFileId(result.fileId);
      setReviseFileUrl(result.viewUrl);
      setReviseUploadedName(result.fileName);
    } catch (err: any) {
      setReviseError(err?.message || "อัปโหลดไฟล์ฉบับแก้ไขไม่สำเร็จ");
      setReviseUploadProgress(null);
    } finally {
      setIsUploadingRevise(false);
    }
  };

  const handleReviseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanForRevise) return;

    if (!reviseFileUrl.trim().startsWith("http")) {
      setReviseError("กรุณาอัปโหลดไฟล์ PDF หรือวางลิงก์ Google Drive ที่ถูกต้อง");
      return;
    }

    setIsSubmittingRevise(true);
    setReviseError("");
    setReviseSuccess("");

    try {
      const isPostRevision = selectedPlanForRevise.status === "บันทึกต้องแก้ไข";
      const isPlanRevisionAfterReview = selectedPlanForRevise.status === "แผนต้องแก้ไข";
      const nextVersion = (selectedPlanForRevise.version || 1) + 1;

      const nextStatus = isPostRevision
        ? "เสร็จสมบูรณ์"
        : isPlanRevisionAfterReview
        ? "แผนผ่าน (รอส่งบันทึก)"
        : "รอตรวจแผน";

      const updatePayload: Record<string, unknown> = {
        status: nextStatus,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      };

      if (isPostRevision) {
        updatePayload.post_file_url = reviseFileUrl.trim();
        updatePayload.post_file_id = reviseFileId;
        updatePayload.use_existing_file = false;
        updatePayload.post_submitted_at = new Date().toISOString();
      } else {
        updatePayload.plan_file_url = reviseFileUrl.trim();
        updatePayload.plan_file_id = reviseFileId;
      }

      const { error: updateErr } = await supabase
        .from("lesson_plans")
        .update(updatePayload)
        .eq("id", selectedPlanForRevise.id);

      if (updateErr) throw updateErr;

      // แจ้งเตือน LINE เมื่อส่งฉบับแก้ไขแทนไฟล์เดิม
      if (isPostRevision || isPlanRevisionAfterReview) {
        try {
          await fetch("/api/line-notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventType: isPostRevision ? "post_revised" : "plan_revised",
              planData: {
                ...selectedPlanForRevise,
                ...updatePayload,
              },
            }),
          });
        } catch (lineErr) {
          console.warn("LINE Notify failed:", lineErr);
        }
      }

      setReviseSuccess(
        isPostRevision
          ? "อัปโหลดบันทึกฉบับแก้ไขแทนไฟล์เดิมแล้ว สถานะปรับเป็น 'เสร็จสมบูรณ์' ทันที!"
          : isPlanRevisionAfterReview
          ? "อัปโหลดแผนฉบับแก้ไขแทนไฟล์เดิมแล้ว สถานะปรับเป็น 'แผนผ่าน (รอส่งบันทึก)' ทันที (ผอ. ไม่ต้องตรวจซ้ำ)!"
          : "เปลี่ยนไฟล์แผน PDF เรียบร้อยแล้ว"
      );

      setTimeout(() => {
        setSelectedPlanForRevise(null);
        setReviseSuccess("");
        loadMyPlans();
      }, 1600);
    } catch (err: any) {
      setReviseError(err?.message || "บันทึกไฟล์ฉบับแก้ไขไม่สำเร็จ");
    } finally {
      setIsSubmittingRevise(false);
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
            ติดตามสถานะการตรวจ อัปโหลดฉบับแก้ไขแทนไฟล์เดิม และส่งบันทึกหลังสอน
          </p>
        </div>
      </div>

      {actionAlert && (
        <div
          className={`p-3.5 rounded-2xl text-xs flex items-center gap-2 border ${
            actionAlert.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {actionAlert.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          )}
          <span>{actionAlert.text}</span>
        </div>
      )}

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

                  <div className="flex flex-wrap items-center gap-2">
                    {/* กรณี ผอ. ตรวจแล้วให้แก้ไข: ครูแก้เอง ส่งแทนไฟล์เดิม -> ผ่านโดย ผอ. ไม่ต้องตรวจซ้ำ */}
                    {(p.status === "แผนต้องแก้ไข" || p.status === "บันทึกต้องแก้ไข") && (
                      <button
                        type="button"
                        onClick={() => openReviseModal(p)}
                        className="px-4 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-sm hover:shadow flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {p.status === "บันทึกต้องแก้ไข"
                          ? "อัปโหลดบันทึกฉบับแก้ไข (แทนไฟล์เดิม)"
                          : "อัปโหลดแผนฉบับแก้ไข (แทนไฟล์เดิม)"}
                      </button>
                    )}

                    {/* กรณีส่งครั้งแรกยังรอตรวจ: เปลี่ยนไฟล์หรือลบได้ */}
                    {p.status === "รอตรวจแผน" && (
                      <button
                        type="button"
                        onClick={() => openReviseModal(p)}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 flex items-center gap-1"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        เปลี่ยนไฟล์แผน
                      </button>
                    )}

                    {/* ส่งบันทึกหลังสอนเมื่อแผนผ่านแล้ว */}
                    {p.status === "แผนผ่าน (รอส่งบันทึก)" && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPlanForPost(p);
                          setUseExistingFile(true);
                          setPostFileUrl("");
                          setPostFileId(null);
                          setPostUploadedName(null);
                          setPostUploadProgress(null);
                          setPostError("");
                          setPostSuccess("");
                        }}
                        className="px-4 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm hover:shadow"
                      >
                        + ส่งบันทึกหลังการสอน
                      </button>
                    )}

                    {/* สิทธิ์ลบ: ครูลบได้เฉพาะตอนส่งแรก ('รอตรวจแผน') เท่านั้น / ผอ.-แอดมินลบได้ทุกสถานะ */}
                    {(isAdmin || p.status === "รอตรวจแผน") && (
                      <button
                        type="button"
                        disabled={deletingPlanId === p.id}
                        onClick={() => handleDeletePlan(p)}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 flex items-center gap-1 disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {deletingPlanId === p.id ? "กำลังลบ..." : "ลบแผน"}
                      </button>
                    )}
                  </div>
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
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      อัปโหลดไฟล์ PDF บันทึกหลังสอน (เข้า Google Drive อัตโนมัติ)
                    </label>
                    <label className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-xl border-2 border-dashed border-emerald-300 bg-white hover:bg-emerald-50/40 cursor-pointer text-xs font-semibold text-emerald-700">
                      {isUploadingPost ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>กำลังอัปโหลด... {postUploadProgress ?? 0}%</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          <span>{postUploadedName ? `เปลี่ยนไฟล์ (${postUploadedName})` : "เลือกไฟล์ PDF จากเครื่อง"}</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={handlePostFileUpload}
                        disabled={isUploadingPost}
                        className="hidden"
                      />
                    </label>

                    {postUploadProgress !== null && (
                      <div className="mt-2 w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-200"
                          style={{ width: `${postUploadProgress}%` }}
                        />
                      </div>
                    )}

                    {postUploadedName && postFileId && !isUploadingPost && (
                      <p className="mt-1 text-[11px] text-emerald-700 flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" />
                        อัปโหลดสำเร็จ: {postUploadedName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      หรือวางลิงก์ Google Drive
                    </label>
                    <input
                      type="url"
                      required
                      value={postFileUrl}
                      onChange={(e) => {
                        setPostFileUrl(e.target.value);
                        setPostFileId(null);
                        setPostUploadedName(null);
                      }}
                      placeholder="https://drive.google.com/file/d/..."
                      className="w-full px-3 py-2 rounded-xl text-xs glass-input"
                    />
                  </div>
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
                  disabled={isSubmittingPost || isUploadingPost}
                  className="w-1/2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold shadow disabled:opacity-50"
                >
                  {isSubmittingPost ? "กำลังบันทึก..." : "ส่งบันทึก"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal อัปโหลดไฟล์ฉบับแก้ไขแทนไฟล์เดิม */}
      {selectedPlanForRevise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="max-w-md w-full glass-panel rounded-3xl p-6 border border-white/80 shadow-2xl space-y-4">
            <h3 className="font-display font-bold text-lg text-slate-800">
              {selectedPlanForRevise.status === "บันทึกต้องแก้ไข"
                ? "อัปโหลดบันทึกหลังสอนฉบับแก้ไข (แทนไฟล์เดิม)"
                : selectedPlanForRevise.status === "แผนต้องแก้ไข"
                ? "อัปโหลดแผนฉบับแก้ไข (แทนไฟล์เดิม)"
                : "เปลี่ยนไฟล์แผนการสอน PDF"}
            </h3>
            <p className="text-xs text-slate-500">
              วิชา {selectedPlanForRevise.subject} ({selectedPlanForRevise.class_level}) - {selectedPlanForRevise.scope_value}
            </p>

            {(selectedPlanForRevise.status === "แผนต้องแก้ไข" ||
              selectedPlanForRevise.status === "บันทึกต้องแก้ไข") && (
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-[11px] text-blue-800">
                💡 เมื่ออัปโหลดไฟล์ที่แก้ไขแล้วส่งแทนไฟล์เดิม ระบบจะบันทึกเป็นไฟล์ล่าสุดและปรับสถานะผ่านให้อัตโนมัติ โดย ผอ. ไม่ต้องตรวจซ้ำ
              </div>
            )}

            {reviseSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs">
                {reviseSuccess}
              </div>
            )}
            {reviseError && (
              <div className="p-3 rounded-xl bg-red-50 text-red-800 text-xs">
                {reviseError}
              </div>
            )}

            <form onSubmit={handleReviseSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  เลือกไฟล์ PDF ฉบับปรับปรุงใหม่ (อัปโหลดเข้า Google Drive แทนไฟล์เดิม)
                </label>
                <label className="flex items-center justify-center gap-2 w-full px-3 py-3 rounded-xl border-2 border-dashed border-amber-300 bg-white hover:bg-amber-50/40 cursor-pointer text-xs font-semibold text-amber-800">
                  {isUploadingRevise ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>กำลังอัปโหลด... {reviseUploadProgress ?? 0}%</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span>{reviseUploadedName ? `เปลี่ยนไฟล์ (${reviseUploadedName})` : "เลือกไฟล์ PDF ฉบับแก้ไข"}</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handleReviseFileUpload}
                    disabled={isUploadingRevise}
                    className="hidden"
                  />
                </label>

                {reviseUploadProgress !== null && (
                  <div className="mt-2 w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all duration-200"
                      style={{ width: `${reviseUploadProgress}%` }}
                    />
                  </div>
                )}

                {reviseUploadedName && reviseFileId && !isUploadingRevise && (
                  <p className="mt-1 text-[11px] text-emerald-700 flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" />
                    อัปโหลดสำเร็จ: {reviseUploadedName}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  หรือวางลิงก์ Google Drive ฉบับใหม่
                </label>
                <input
                  type="url"
                  required
                  value={reviseFileUrl}
                  onChange={(e) => {
                    setReviseFileUrl(e.target.value);
                    setReviseFileId(null);
                    setReviseUploadedName(null);
                  }}
                  placeholder="https://drive.google.com/file/d/..."
                  className="w-full px-3 py-2 rounded-xl text-xs glass-input"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedPlanForRevise(null)}
                  className="w-1/2 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRevise || isUploadingRevise}
                  className="w-1/2 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-xs font-bold shadow disabled:opacity-50"
                >
                  {isSubmittingRevise ? "กำลังบันทึก..." : "ยืนยันส่งแทนไฟล์เดิม"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
