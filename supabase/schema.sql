-- ==============================================================================
-- ระบบบริหารจัดการและนิเทศแผนการจัดการเรียนรู้ โรงเรียนวัดโป่งแรด (ปคุณวิทยาคาร)
-- Supabase SQL Schema (Bulletproof, Auto-Confirm, Self-Healing Profile & RLS)
-- ==============================================================================

-- 1. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Create Tables

-- 2.1 Table: teachers (ข้อมูลครูผู้สอนทั้ง 9 ท่าน)
CREATE TABLE IF NOT EXISTS public.teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    short_name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('early_childhood', 'primary')),
    grade_level TEXT NOT NULL,
    default_subject TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2.2 Table: profiles (ข้อมูลผู้ใช้ และ Role สิทธิ์การใช้งาน)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'teacher')) DEFAULT 'teacher',
    teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2.3 Table: lesson_plans (รายการแผนการจัดการเรียนรู้)
CREATE TABLE IF NOT EXISTS public.lesson_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_code TEXT NOT NULL UNIQUE,
    teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
    teacher_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_level TEXT NOT NULL,
    academic_year TEXT NOT NULL DEFAULT '2569',
    semester TEXT NOT NULL DEFAULT '2',
    scope_type TEXT NOT NULL CHECK (scope_type IN ('term', 'unit', 'week')),
    scope_value TEXT NOT NULL,
    unit_title TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    plan_file_url TEXT NOT NULL,
    plan_file_id TEXT,
    status TEXT NOT NULL CHECK (status IN (
        'รอตรวจแผน',
        'แผนต้องแก้ไข',
        'แผนผ่าน (รอส่งบันทึก)',
        'รอตรวจบันทึก',
        'บันทึกต้องแก้ไข',
        'เสร็จสมบูรณ์'
    )) DEFAULT 'รอตรวจแผน',
    post_file_url TEXT,
    post_file_id TEXT,
    post_submitted_at TIMESTAMP WITH TIME ZONE,
    use_existing_file BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2.4 Table: plan_reviews (ผลการตรวจและข้อคิดเห็นของ ผอ.)
CREATE TABLE IF NOT EXISTS public.plan_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.lesson_plans(id) ON DELETE CASCADE,
    reviewer_name TEXT NOT NULL DEFAULT 'นางสาวอำพร คงเจริญ',
    reviewer_role TEXT NOT NULL DEFAULT 'ผู้อำนวยการสถานศึกษา',
    review_mode TEXT NOT NULL CHECK (review_mode IN ('plan', 'post', 'plan_and_post')),
    status_assigned TEXT NOT NULL,
    note TEXT,
    reviewed_file_url TEXT,
    reviewed_file_id TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 2.5 Table: school_settings (โลโก้และข้อมูลโรงเรียนที่ ผอ./แอดมิน แก้ไขได้)
CREATE TABLE IF NOT EXISTS public.school_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    school_name TEXT NOT NULL DEFAULT 'โรงเรียนวัดโป่งแรด (ปคุณวิทยาคาร)',
    system_title TEXT NOT NULL DEFAULT 'ระบบติดตามภาระงานการส่งแผนการจัดการเรียนรู้และบันทึกหลังสอน',
    logo_url TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.school_settings (id, school_name, system_title)
VALUES (
    'default',
    'โรงเรียนวัดโป่งแรด (ปคุณวิทยาคาร)',
    'ระบบติดตามภาระงานการส่งแผนการจัดการเรียนรู้และบันทึกหลังสอน'
) ON CONFLICT (id) DO NOTHING;

-- 3. Initial Seed Data (ข้อมูลครูทั้ง 9 ท่าน)
INSERT INTO public.teachers (id, name, short_name, category, grade_level, default_subject, display_order)
VALUES
  ('00000000-0000-0000-0001-000000000001', 'นางสาวธารารัตน์ สามิภักดิ์', 'ครูธารารัตน์', 'early_childhood', 'ระดับปฐมวัย', 'แผนการจัดประสบการณ์เรียนรู้ปฐมวัย', 1),
  ('00000000-0000-0000-0001-000000000002', 'นางสาวนภาวรรณ สันดิษฐ์', 'ครูนภาวรรณ', 'early_childhood', 'ระดับปฐมวัย', 'แผนการจัดประสบการณ์เรียนรู้ปฐมวัย', 2),
  ('00000000-0000-0000-0001-000000000003', 'นางสาวณิชนันทน์ การบุญ', 'ครูณิชนันทน์', 'primary', 'ประจำชั้น ป.1', 'ภาษาไทย', 3),
  ('00000000-0000-0000-0001-000000000004', 'นางสาวกชกร อรัญวัชน์', 'ครูกชกร', 'primary', 'ประจำชั้น ป.2', 'ภาษาไทย', 4),
  ('00000000-0000-0000-0001-000000000005', 'นางสาวรักชนก โสภักต์', 'ครูรักชนก', 'primary', 'ประจำชั้น ป.3', 'คอมพิวเตอร์ (วิทยาการคำนวณ)', 5),
  ('00000000-0000-0000-0001-000000000006', 'นางสาวมณีมัญชุ์ ศาสตร์ทรัพย์', 'ครูมณีมัญชุ์', 'primary', 'ประจำชั้น ป.4', 'วิทยาศาสตร์และเทคโนโลยี', 6),
  ('00000000-0000-0000-0001-000000000007', 'นายณัฐวุฒิ คำจันทร์', 'ครูณัฐวุฒิ', 'primary', 'ประจำชั้น ป.5', 'สุขศึกษาและพลศึกษา', 7),
  ('00000000-0000-0000-0001-000000000008', 'นางสาวชมพูนุท บุญอากาศ', 'ครูชมพูนุท', 'primary', 'ประจำชั้น ป.6', 'ภาษาอังกฤษพื้นฐาน', 8),
  ('00000000-0000-0000-0001-000000000009', 'นางสาวจันทนิภา เขียวละลิ้ม', 'ครูจันทนิภา', 'primary', 'ประจำชั้น ป.6', 'คณิตศาสตร์', 9)
ON CONFLICT (name) DO UPDATE SET
  short_name = EXCLUDED.short_name,
  category = EXCLUDED.category,
  grade_level = EXCLUDED.grade_level,
  default_subject = EXCLUDED.default_subject,
  display_order = EXCLUDED.display_order;

-- 4. Triggers ป้องกันปัญหา Confirmation Email & Auto Profile
-- 4.1 Trigger Auto-Confirm Email
CREATE OR REPLACE FUNCTION public.auto_confirm_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    NEW.email_confirmed_at := timezone('utc'::text, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_auto_confirm ON auth.users;
CREATE TRIGGER on_auth_user_auto_confirm
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_user();

-- ยืนยันอีเมลให้ทุกบัญชีเดิม
UPDATE auth.users SET email_confirmed_at = timezone('utc'::text, now()) WHERE email_confirmed_at IS NULL;

-- 4.2 Trigger สร้าง Profile อัตโนมัติเมื่อสมัครสมาชิก
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id UUID := NULL;
  v_role TEXT := 'teacher';
  v_full_name TEXT;
BEGIN
  v_full_name := COALESCE(NULLIF(TRIM(new.raw_user_meta_data->>'full_name'), ''), new.email, 'ผู้ใช้งาน');
  v_role := 'teacher';

  IF (new.raw_user_meta_data->>'teacher_id') IS NOT NULL AND (new.raw_user_meta_data->>'teacher_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_teacher_id := (new.raw_user_meta_data->>'teacher_id')::UUID;
  ELSE
    SELECT id INTO v_teacher_id FROM public.teachers WHERE name = (new.raw_user_meta_data->>'teacher_name') LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, teacher_id)
  VALUES (new.id, new.email, v_full_name, v_role, v_teacher_id)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = CASE WHEN profiles.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END,
    teacher_id = COALESCE(EXCLUDED.teacher_id, profiles.teacher_id),
    updated_at = timezone('utc'::text, now());

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4.3 Function รีเซ็ตรหัสผ่านฉุกเฉินสำหรับครู (ไม่ต้องรออีเมล)
CREATE OR REPLACE FUNCTION public.reset_teacher_password(
  p_email TEXT,
  p_teacher_id UUID,
  p_new_password TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF char_length(p_new_password) < 6 THEN
    RAISE EXCEPTION 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร';
  END IF;

  SELECT u.id INTO v_user_id
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = lower(trim(p_email))
    AND (
      p.teacher_id = p_teacher_id
      OR (u.raw_user_meta_data->>'teacher_id') = p_teacher_id::text
    )
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
      updated_at = NOW()
  WHERE id = v_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.reset_teacher_password(TEXT, UUID, TEXT) TO anon, authenticated;

-- 5. Row Level Security (RLS) - ล็อกสิทธิ์แน่นหนาตามบทบาท
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view teachers" ON public.teachers FOR SELECT USING (true);
CREATE POLICY "Admins can insert teachers" ON public.teachers FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update teachers" ON public.teachers FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can delete teachers" ON public.teachers FOR DELETE
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Everyone can view school settings" ON public.school_settings FOR SELECT USING (true);
CREATE POLICY "Admins can insert school settings" ON public.school_settings FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "Admins can update school settings" ON public.school_settings FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Allow view lesson plans" ON public.lesson_plans FOR SELECT USING (true);

-- ครูสร้างแผนใหม่ได้เฉพาะสถานะ 'รอตรวจแผน'
CREATE POLICY "Teachers can insert plans" ON public.lesson_plans FOR INSERT
WITH CHECK (
    auth.role() = 'authenticated' AND
    status IN ('รอตรวจแผน')
);

-- ครูอัปเดตงานตนเองได้:
-- 1) ส่งปกติ / ส่งบันทึกหลังสอน ('รอตรวจแผน', 'รอตรวจบันทึก')
-- 2) ส่งไฟล์ฉบับแก้ไขแทนไฟล์เดิม หลัง ผอ. ตรวจแล้ว 1 ครั้ง -> ผ่าน/เสร็จสมบูรณ์โดย ผอ. ไม่ต้องตรวจซ้ำ
CREATE POLICY "Teachers can update own pending plans" ON public.lesson_plans FOR UPDATE
USING (
    created_by = auth.uid() OR
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR
    (
        created_by = auth.uid() AND (
            status IN ('รอตรวจแผน', 'รอตรวจบันทึก')
            OR (
                status = 'แผนผ่าน (รอส่งบันทึก)' AND
                EXISTS (
                    SELECT 1 FROM public.plan_reviews pr
                    WHERE pr.plan_id = lesson_plans.id AND pr.status_assigned = 'แผนต้องแก้ไข'
                )
            )
            OR (
                status = 'เสร็จสมบูรณ์' AND
                EXISTS (
                    SELECT 1 FROM public.plan_reviews pr
                    WHERE pr.plan_id = lesson_plans.id AND pr.status_assigned = 'บันทึกต้องแก้ไข'
                )
            )
        )
    )
);

-- ครูลบแผนได้เฉพาะตอนส่งแรก (สถานะ 'รอตรวจแผน') เท่านั้น หากผ่าน/เสร็จสมบูรณ์แล้ว เฉพาะ ผอ./แอดมิน ลบได้
DROP POLICY IF EXISTS "Admins can delete plans" ON public.lesson_plans;
CREATE POLICY "Admins or teachers pending can delete plans" ON public.lesson_plans FOR DELETE
USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR
    (created_by = auth.uid() AND status = 'รอตรวจแผน')
);

CREATE POLICY "Everyone can view plan reviews" ON public.plan_reviews FOR SELECT USING (true);

-- เฉพาะ Role admin (ผอ.) เท่านั้นที่กดบันทึกผลการตรวจได้
CREATE POLICY "Admins only can insert reviews" ON public.plan_reviews FOR INSERT
WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
