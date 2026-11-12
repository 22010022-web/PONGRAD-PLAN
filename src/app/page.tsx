"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { LessonPlan, Teacher } from "@/types/database";
import { FileText, CheckCircle2, Clock, AlertCircle, FileCheck, Search, Filter } from "lucide-react";

export default function DashboardPage() {
  const [plans, setPlans] = useState<LessonPlan[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterTeacher, setFilterTeacher] = useState("");
  const [filterScope, setFilterScope] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    async function loadData() {
      if (!isSupabaseConfigured()) {
        setIsLoading(false);
        return;
      }

      try {
        const [plansRes, teachersRes] = await Promise.all([
          supabase.from("lesson_plans").select("*, reviews:plan_reviews(*)").order("created_at", { ascending: false }),
          supabase.from("teachers").select("*").eq("is_active", true).order("display_order", { ascending: true })
        ]);

        if (plansRes.data) setPlans(plansRes.data as LessonPlan[]);
        if (teachersRes.data) setTeachers(teachersRes.data as Teacher[]);
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  const totalPlans = plans.length;
  const approvedPlans = plans.filter(p => p.status === "เสร็จสมบูรณ์" || p.status === "แผนผ่าน (รอส่งบันทึก)" || p.status === "รอตรวจบันทึก").length;
  const pendingReview = plans.filter(p => p.status === "รอตรวจแผน" || p.status === "รอตรวจบันทึก").length;
  const completedPlans = plans.filter(p => p.status === "เสร็จสมบูรณ์").length;

  const termCount = plans.filter(p => p.scope_type === "term").length;
  const unitCount = plans.filter(p => p.scope_type === "unit").length;
  const weekCount = plans.filter(p => p.scope_type === "week").length;

  const filteredPlans = plans.filter(p => {
    if (filterTeacher && p.teacher_name !== filterTeacher) return false;
    if (filterScope && p.scope_type !== filterScope) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-amber-500/10 border border-white/60">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-pink-100 text-pink-700 text-xs font-bold mb-2">
              <span>ภาคเรียนที่ 2/2569</span>
              <span>•</span>
              <span>โรงเรียนวัดโป่งแรด (ปคุณวิทยาคาร)</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-display text-slate-800">
              แดชบอร์ดสารสนเทศและนิเทศแผนการจัดการเรียนรู้
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              ระบบตรวจสอบ ป้องกันการลักไก่ผ่านงานด้วย Supabase Role-Based Security และจัดเก็บไฟล์ Google Drive
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/submit"
              className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold text-xs sm:text-sm shadow-md hover:shadow-lg transition-all"
            >
              + ส่งแผนการสอนใหม่
            </Link>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card rounded-2xl p-5 border-l-4 border-l-pink-600">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500">แผนที่ส่งทั้งหมด</p>
              <h3 className="text-2xl sm:text-3xl font-extrabold text-pink-700 mt-1">{totalPlans}</h3>
            </div>
            <div className="p-2.5 rounded-xl bg-pink-50 text-pink-600">
              <FileText className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2 font-medium">
            รวมเล่ม {termCount} · รายหน่วย {unitCount} · สัปดาห์ {weekCount}
          </p>
        </div>

        <div className="glass-card rounded-2xl p-5 border-l-4 border-l-emerald-500">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500">แผนผ่านการอนุมัติแล้ว</p>
              <h3 className="text-2xl sm:text-3xl font-extrabold text-emerald-600 mt-1">{approvedPlans}</h3>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2 font-medium">
            คิดเป็น {totalPlans > 0 ? Math.round((approvedPlans / totalPlans) * 100) : 0}% ของแผนทั้งหมด
          </p>
        </div>

        <div className="glass-card rounded-2xl p-5 border-l-4 border-l-amber-500">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500">รอ ผอ. ตรวจอนุมัติ</p>
              <h3 className="text-2xl sm:text-3xl font-extrabold text-amber-600 mt-1">{pendingReview}</h3>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2 font-medium">
            แผนรอตรวจ {plans.filter(p => p.status === 'รอตรวจแผน').length} · บันทึกรอตรวจ {plans.filter(p => p.status === 'รอตรวจบันทึก').length}
          </p>
        </div>

        <div className="glass-card rounded-2xl p-5 border-l-4 border-l-purple-600">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold text-slate-500">เสร็จสมบูรณ์ครบวงจร</p>
              <h3 className="text-2xl sm:text-3xl font-extrabold text-purple-700 mt-1">{completedPlans}</h3>
            </div>
            <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600">
              <FileCheck className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2 font-medium">
            งานต้องแก้ไข {plans.filter(p => p.status === 'แผนต้องแก้ไข' || p.status === 'บันทึกต้องแก้ไข').length} ฉบับ
          </p>
        </div>
      </div>

      {/* Teacher Workload Summary Table */}
      <div className="glass-card rounded-3xl p-6 border border-white/80">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-display font-bold text-base sm:text-lg text-slate-800 flex items-center gap-2">
            <span className="w-2.5 h-6 rounded-full bg-gradient-to-b from-pink-600 to-amber-500"></span>
            ตารางสรุปภาระงานและความคืบหน้ารายบุคคล (คณะครู {teachers.length} ท่าน)
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50/80 text-xs font-bold text-slate-600 uppercase border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">ชื่อ - นามสกุล</th>
                <th className="py-3 px-4">ระดับชั้น / บทบาท</th>
                <th className="py-3 px-4 text-center">รวมเล่ม</th>
                <th className="py-3 px-4 text-center">รายหน่วย</th>
                <th className="py-3 px-4 text-center">รายสัปดาห์</th>
                <th className="py-3 px-4 text-center">บันทึกหลังสอน</th>
                <th className="py-3 px-4 text-center">ผ่านอนุมัติ</th>
                <th className="py-3 px-4 text-center">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {teachers.map((t) => {
                const tPlans = plans.filter(p => p.teacher_name === t.name);
                const tTerm = tPlans.filter(p => p.scope_type === 'term').length;
                const tUnit = tPlans.filter(p => p.scope_type === 'unit').length;
                const tWeek = tPlans.filter(p => p.scope_type === 'week').length;
                const tPost = tPlans.filter(p => !!p.post_file_url || p.use_existing_file).length;
                const tApproved = tPlans.filter(p => p.status === 'เสร็จสมบูรณ์' || p.status === 'แผนผ่าน (รอส่งบันทึก)' || p.status === 'รอตรวจบันทึก').length;
                const tNeedFix = tPlans.filter(p => p.status === 'แผนต้องแก้ไข' || p.status === 'บันทึกต้องแก้ไข').length;
                const tWaiting = tPlans.filter(p => p.status === 'รอตรวจแผน' || p.status === 'รอตรวจบันทึก').length;

                return (
                  <tr key={t.id} className="hover:bg-white/60 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900">{t.name}</td>
                    <td className="py-3 px-4 text-xs text-slate-600">{t.grade_level}</td>
                    <td className="py-3 px-4 text-center font-semibold text-amber-700">
                      {tTerm > 0 ? `${tTerm} เล่ม` : "-"}
                    </td>
                    <td className="py-3 px-4 text-center font-semibold text-pink-700">
                      {tUnit > 0 ? `${tUnit} ฉบับ` : "-"}
                    </td>
                    <td className="py-3 px-4 text-center font-semibold text-sky-700">
                      {tWeek > 0 ? `${tWeek} สัปดาห์` : "-"}
                    </td>
                    <td className="py-3 px-4 text-center text-xs text-purple-700 font-semibold">
                      {tPost > 0 ? `${tPost} ฉบับ` : "0"}
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-emerald-600">
                      {tApproved} <span className="text-xs text-slate-400 font-normal">/ {tPlans.length}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {tPlans.length === 0 ? (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                          ยังไม่ส่งแผน
                        </span>
                      ) : tNeedFix > 0 ? (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 border border-red-200">
                          ต้องแก้ไข {tNeedFix}
                        </span>
                      ) : tWaiting > 0 ? (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                          รอตรวจ {tWaiting}
                        </span>
                      ) : (
                        <span className="text-emerald-600 font-bold text-xs flex items-center justify-center gap-1">
                          ✔ ตรวจครบแล้ว
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Submissions List & Filter */}
      <div className="glass-card rounded-3xl p-6 border border-white/80">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <h2 className="font-display font-bold text-base sm:text-lg text-slate-800 flex items-center gap-2">
            <span className="w-2.5 h-6 rounded-full bg-gradient-to-b from-purple-600 to-pink-600"></span>
            ประวัติการส่งแผนการจัดการเรียนรู้ล่าสุด
          </h2>

          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <select
              value={filterTeacher}
              onChange={(e) => setFilterTeacher(e.target.value)}
              className="text-xs rounded-xl glass-input px-3 py-2 text-slate-700 font-medium"
            >
              <option value="">ครูทุกท่าน</option>
              {teachers.map(t => <option key={t.id} value={t.name}>{t.short_name}</option>)}
            </select>

            <select
              value={filterScope}
              onChange={(e) => setFilterScope(e.target.value)}
              className="text-xs rounded-xl glass-input px-3 py-2 text-slate-700 font-medium"
            >
              <option value="">ทุกรูปแบบ</option>
              <option value="term">📚 รวมเล่มรายภาคเรียน</option>
              <option value="unit">📑 รายหน่วยการเรียนรู้</option>
              <option value="week">📅 รายสัปดาห์</option>
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="text-xs rounded-xl glass-input px-3 py-2 text-slate-700 font-medium"
            >
              <option value="">ทุกสถานะ</option>
              <option value="รอตรวจแผน">รอตรวจแผน</option>
              <option value="แผนต้องแก้ไข">แผนต้องแก้ไข</option>
              <option value="แผนผ่าน (รอส่งบันทึก)">แผนผ่าน (รอส่งบันทึก)</option>
              <option value="รอตรวจบันทึก">รอตรวจบันทึก</option>
              <option value="บันทึกต้องแก้ไข">บันทึกต้องแก้ไข</option>
              <option value="เสร็จสมบูรณ์">เสร็จสมบูรณ์</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50/80 text-xs font-bold text-slate-600 uppercase border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">วันที่ส่ง</th>
                <th className="py-3 px-4">ครูผู้สอน</th>
                <th className="py-3 px-4">รายวิชา (ระดับชั้น)</th>
                <th className="py-3 px-4">รูปแบบการส่ง</th>
                <th className="py-3 px-4 text-center">สถานะ</th>
                <th className="py-3 px-4 text-right">ไฟล์เอกสาร</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPlans.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    ไม่พบรายการข้อมูล
                  </td>
                </tr>
              ) : (
                filteredPlans.map((p) => (
                  <tr key={p.id} className="hover:bg-white/60 transition-colors">
                    <td className="py-3 px-4 text-xs text-slate-500">
                      {new Date(p.created_at).toLocaleDateString("th-TH")}
                      <span className="block text-[10px] text-slate-400">v{p.version}</span>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-800">{p.teacher_name}</td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800">{p.subject}</div>
                      <div className="text-xs text-slate-500">ชั้น {p.class_level}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 mr-1.5">
                        {p.scope_type === 'term' ? '📚 รวมเล่ม' : p.scope_type === 'week' ? '📅 รายสัปดาห์' : '📑 รายหน่วย'}
                      </span>
                      <span className="text-xs text-slate-600 font-medium">{p.scope_value}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${
                        p.status === 'เสร็จสมบูรณ์' ? 'bg-emerald-100 text-emerald-800' :
                        p.status === 'รอตรวจแผน' ? 'bg-amber-100 text-amber-800' :
                        p.status === 'แผนผ่าน (รอส่งบันทึก)' ? 'bg-blue-100 text-blue-800' :
                        p.status === 'รอตรวจบันทึก' ? 'bg-purple-100 text-purple-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-1.5">
                      {p.plan_file_url && (
                        <a
                          href={p.plan_file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-pink-50 text-pink-700 hover:bg-pink-100 border border-pink-200"
                        >
                          แผน PDF
                        </a>
                      )}
                      {(p.post_file_url || p.use_existing_file) && (
                        <a
                          href={p.post_file_url || p.plan_file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200"
                        >
                          บันทึก PDF
                        </a>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
