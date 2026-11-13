"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { Profile, SchoolSettings, Teacher, UserRole } from "@/types/database";

const DEFAULT_SCHOOL_SETTINGS: SchoolSettings = {
  id: "default",
  school_name: "โรงเรียนวัดโป่งแรด (ปคุณวิทยาคาร)",
  system_title: "ระบบติดตามภาระงานการส่งแผนการจัดการเรียนรู้และบันทึกหลังสอน",
  logo_url: null,
};

function translateAuthError(message: string): string {
  const msg = (message || "").toLowerCase();
  if (msg.includes("email not confirmed")) {
    return "บัญชีนี้ยังไม่ได้รับการยืนยันอีเมล — กรุณากดปุ่ม 'คัดลอกโค้ด SQL' ด้านบนไป Run ใน Supabase SQL Editor เพื่อเปิดระบบ Auto-Confirm ทันที";
  }
  if (msg.includes("invalid login credentials")) {
    return "อีเมลหรือรหัสผ่านไม่ถูกต้อง (หากยังไม่เคยสมัคร กรุณาเลือกแท็บ 'ลงทะเบียนผู้ใช้ใหม่')";
  }
  if (msg.includes("user already registered")) {
    return "อีเมลนี้ได้ลงทะเบียนไว้แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านเดิม หรือใช้เมนูรีเซ็ตรหัสผ่าน";
  }
  if (msg.includes("password should be at least")) {
    return "รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร";
  }
  return message || "เกิดข้อผิดพลาดในการดำเนินการ";
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  teacher: Teacher | null;
  isLoading: boolean;
  isAdmin: boolean;
  isConfigured: boolean;
  isSchemaReady: boolean;
  schoolSettings: SchoolSettings;
  checkSchema: () => Promise<void>;
  refreshSchoolSettings: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    role: UserRole,
    teacherId?: string,
    teacherName?: string
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSchemaReady, setIsSchemaReady] = useState<boolean>(true);
  const [schoolSettings, setSchoolSettings] = useState<SchoolSettings>(DEFAULT_SCHOOL_SETTINGS);
  const isConfigured = isSupabaseConfigured();

  const refreshSchoolSettings = useCallback(async () => {
    if (!isConfigured) return;
    try {
      const { data, error } = await supabase
        .from("school_settings")
        .select("*")
        .eq("id", "default")
        .maybeSingle();
      if (!error && data) {
        setSchoolSettings({
          ...DEFAULT_SCHOOL_SETTINGS,
          ...(data as SchoolSettings),
        });
      }
    } catch {
      // Table may not exist yet; keep defaults
    }
  }, [isConfigured]);

  const checkSchema = useCallback(async () => {
    if (!isConfigured) {
      setIsSchemaReady(false);
      return;
    }
    try {
      const { error } = await supabase.from("teachers").select("id").limit(1);
      if (error && (error.code === "42P01" || error.code === "PGRST205" || error.message?.includes("does not exist"))) {
        setIsSchemaReady(false);
      } else {
        setIsSchemaReady(true);
      }
    } catch {
      // Ignore network hiccup
    }
  }, [isConfigured]);

  const fetchProfileAndTeacher = useCallback(async (currentUser: User) => {
    try {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .single();

      if (profileData) {
        setProfile(profileData as Profile);

        if (profileData.teacher_id) {
          const { data: teacherData } = await supabase
            .from("teachers")
            .select("*")
            .eq("id", profileData.teacher_id)
            .single();

          if (teacherData) {
            setTeacher(teacherData as Teacher);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching profile:", err);
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      setIsLoading(false);
      setIsSchemaReady(false);
      return;
    }

    checkSchema();
    refreshSchoolSettings();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfileAndTeacher(session.user).finally(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfileAndTeacher(session.user);
      } else {
        setProfile(null);
        setTeacher(null);
      }
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [isConfigured, checkSchema, fetchProfileAndTeacher]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      return { error: new Error(translateAuthError(error.message)) };
    }
    return { error: null };
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    _role: UserRole,
    teacherId?: string,
    teacherName?: string
  ) => {
    const cleanEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          role: "teacher",
          teacher_id: teacherId || null,
          teacher_name: teacherName || fullName.trim(),
        },
      },
    });

    if (error) {
      return { error: new Error(translateAuthError(error.message)) };
    }

    // Auto sign-in immediately
    if (data.user && !data.session) {
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (signInErr) {
        return { error: new Error(translateAuthError(signInErr.message)) };
      }
    }

    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setTeacher(null);
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfileAndTeacher(user);
    }
  };

  const isAdmin = profile?.role === "admin";

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        teacher,
        isLoading,
        isAdmin,
        isConfigured,
        isSchemaReady,
        schoolSettings,
        checkSchema,
        refreshSchoolSettings,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
