import { LessonPlan } from "@/types/database";

export type PlanSortOrder = "newest" | "oldest";
export type EffectiveScopeKind = "week" | "unit" | "term" | "permission";

export const PERMISSION_MEMO_PREFIX = "ใบขออนุญาตใช้แผน";

export function isPermissionMemoPlan(
  plan?: { scope_value?: string | null } | null
): boolean {
  return Boolean(plan?.scope_value?.startsWith(PERMISSION_MEMO_PREFIX));
}

export function getEffectiveScopeKind(
  plan?: { scope_type?: string | null; scope_value?: string | null } | null
): EffectiveScopeKind {
  if (isPermissionMemoPlan(plan)) return "permission";
  if (plan?.scope_type === "week") return "week";
  if (plan?.scope_type === "unit") return "unit";
  return "term";
}

export interface SubmissionOrderInfo {
  /** ลำดับการส่งทั้งหมดของครูท่านนี้ (เรียงจากส่งก่อน -> หลัง: 1, 2, 3...) */
  teacherOrder: number;
  /** ลำดับการส่งภายในรายวิชานั้นๆ ของครู (1, 2, 3...) */
  subjectOrder: number;
}

export function buildSubmissionOrderMap(
  plans: LessonPlan[]
): Record<string, SubmissionOrderInfo> {
  const chronological = [...plans].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const teacherCounters: Record<string, number> = {};
  const subjectCounters: Record<string, number> = {};
  const map: Record<string, SubmissionOrderInfo> = {};

  for (const plan of chronological) {
    const teacherKey = plan.teacher_id || plan.teacher_name || "unknown";
    const subjectKey = `${teacherKey}::${plan.subject || "-"}`;

    teacherCounters[teacherKey] = (teacherCounters[teacherKey] || 0) + 1;
    subjectCounters[subjectKey] = (subjectCounters[subjectKey] || 0) + 1;

    map[plan.id] = {
      teacherOrder: teacherCounters[teacherKey],
      subjectOrder: subjectCounters[subjectKey],
    };
  }

  return map;
}

export function sortPlansByDate(
  plans: LessonPlan[],
  direction: PlanSortOrder
): LessonPlan[] {
  return [...plans].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return direction === "oldest" ? diff : -diff;
  });
}

export function formatThaiDateTime(iso: string): { dateText: string; timeText: string } {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    return { dateText: "-", timeText: "" };
  }
  const dateText = dt.toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const timeText = dt.toLocaleTimeString("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { dateText, timeText: `${timeText} น.` };
}
