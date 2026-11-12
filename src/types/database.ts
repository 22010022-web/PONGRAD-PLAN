export type UserRole = "admin" | "teacher";

export type PlanStatus = 
  | "รอตรวจแผน"
  | "แผนต้องแก้ไข"
  | "แผนผ่าน (รอส่งบันทึก)"
  | "รอตรวจบันทึก"
  | "บันทึกต้องแก้ไข"
  | "เสร็จสมบูรณ์";

export type ScopeType = "term" | "unit" | "week";

export interface Teacher {
  id: string;
  name: string;
  short_name: string;
  category: "early_childhood" | "primary";
  grade_level: string;
  default_subject?: string;
  display_order: number;
  is_active: boolean;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  teacher_id?: string;
  created_at: string;
}

export interface LessonPlan {
  id: string;
  task_code: string;
  teacher_id: string;
  teacher_name: string;
  subject: string;
  class_level: string;
  academic_year: string;
  semester: string;
  scope_type: ScopeType;
  scope_value: string;
  unit_title?: string;
  version: number;
  plan_file_url: string;
  plan_file_id?: string;
  status: PlanStatus;
  post_file_url?: string;
  post_file_id?: string;
  post_submitted_at?: string;
  use_existing_file: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
  reviews?: PlanReview[];
}

export interface PlanReview {
  id: string;
  plan_id: string;
  reviewer_name: string;
  reviewer_role: string;
  review_mode: "plan" | "post" | "plan_and_post";
  status_assigned: PlanStatus;
  note?: string;
  reviewed_file_url?: string;
  reviewed_file_id?: string;
  reviewed_at: string;
  created_by?: string;
}
