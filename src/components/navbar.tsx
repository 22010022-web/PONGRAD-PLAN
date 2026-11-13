"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { BookOpen, LayoutDashboard, PlusCircle, FileCheck, LogIn, LogOut, Settings, Wrench } from "lucide-react";

export default function Navbar() {
  const pathname = usePathname();
  const { user, profile, teacher, isAdmin, schoolSettings, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-white/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center space-x-3 group">
            {schoolSettings.logo_url ? (
              <img
                src={schoolSettings.logo_url}
                alt="โลโก้โรงเรียน"
                className="w-10 h-10 rounded-xl object-contain bg-white p-0.5 shadow-md group-hover:scale-105 transition-transform border border-white/80"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-pink-600 to-amber-500 flex items-center justify-center text-white font-bold text-lg shadow-md group-hover:scale-105 transition-transform">
                PR
              </div>
            )}
            <div>
              <div className="font-display font-bold text-slate-800 text-sm sm:text-base leading-tight">
                {schoolSettings.school_name}
              </div>
              <div className="text-xs text-pink-700 font-medium">
                {schoolSettings.system_title}
              </div>
            </div>
          </Link>

          <nav className="flex items-center space-x-1 sm:space-x-3">
            <Link
              href="/"
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                pathname === "/"
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">แดชบอร์ด</span>
            </Link>

            <Link
              href="/pdf-tools"
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                pathname === "/pdf-tools"
                  ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
              }`}
            >
              <Wrench className="w-4 h-4" />
              <span className="hidden sm:inline">PDF Tools</span>
            </Link>

            {user && (
              <>
                <Link
                  href="/submit"
                  className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                    pathname === "/submit"
                      ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
                  }`}
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>ส่งแผนการสอน</span>
                </Link>

                <Link
                  href="/my-plans"
                  className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                    pathname === "/my-plans"
                      ? "bg-gradient-to-r from-pink-600 to-purple-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  <span className="hidden sm:inline">แผนของฉัน</span>
                </Link>

                {isAdmin && (
                  <>
                    <Link
                      href="/review"
                      className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                        pathname === "/review"
                          ? "bg-gradient-to-r from-amber-500 to-pink-600 text-white shadow-sm"
                          : "text-amber-700 bg-amber-50 hover:bg-amber-100"
                      }`}
                    >
                      <FileCheck className="w-4 h-4" />
                      <span>ตรวจแผน (ผอ.)</span>
                    </Link>

                    <Link
                      href="/admin"
                      className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                        pathname === "/admin"
                          ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm"
                          : "text-purple-700 bg-purple-50 hover:bg-purple-100"
                      }`}
                    >
                      <Settings className="w-4 h-4" />
                      <span className="hidden md:inline">จัดการระบบ</span>
                    </Link>
                  </>
                )}
              </>
            )}

            {user ? (
              <div className="flex items-center pl-2 border-l border-slate-200 space-x-2">
                <div className="hidden md:block text-right">
                  <div className="text-xs font-bold text-slate-800 leading-tight">
                    {profile?.full_name || teacher?.name || user.email}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {isAdmin ? "ผู้บริหารสถานศึกษา" : teacher?.grade_level || "ครูผู้สอน"}
                  </div>
                </div>
                <button
                  onClick={() => signOut()}
                  title="ออกจากระบบ"
                  className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="flex items-center space-x-1 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white/80 border border-slate-200 text-slate-700 hover:bg-white hover:border-pink-300 shadow-sm transition-all"
              >
                <LogIn className="w-4 h-4" />
                <span>เข้าสู่ระบบ</span>
              </Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
