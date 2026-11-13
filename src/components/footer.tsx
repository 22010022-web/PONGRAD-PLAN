"use client";

import { Code2, MapPin, School } from "lucide-react";
import { useAuth } from "@/context/auth-context";

export default function Footer() {
  const { schoolSettings } = useAuth();

  return (
    <footer className="mt-12 py-7 px-4 sm:px-6 lg:px-8 border-t border-white/60 bg-white/40 backdrop-blur-md">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
          <div className="flex items-center gap-3">
            {schoolSettings.logo_url ? (
              <img
                src={schoolSettings.logo_url}
                alt="โลโก้โรงเรียน"
                className="w-10 h-10 rounded-xl object-contain bg-white p-0.5 border border-white/80 shadow-sm shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-pink-50 border border-pink-200/70 flex items-center justify-center text-pink-600 shrink-0">
                <School className="w-5 h-5" />
              </div>
            )}
            <div>
              <div className="font-display font-bold text-slate-800 text-sm sm:text-base">
                {schoolSettings.school_name}
              </div>
              <div className="text-xs text-slate-600 flex items-center justify-center md:justify-start gap-1 mt-0.5">
                <MapPin className="w-3.5 h-3.5 text-pink-600 shrink-0" />
                <span>สำนักงานเขตพื้นที่การศึกษาประถมศึกษาจันทบุรี เขต 1</span>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-600 md:text-right space-y-0.5">
            <div className="font-semibold text-slate-800">{schoolSettings.system_title}</div>
            <div>พัฒนาเพื่อการบริหารจัดการและการประกันคุณภาพการศึกษาภายในสถานศึกษา</div>
          </div>
        </div>

        <div className="pt-4 border-t border-white/60 flex flex-col sm:flex-row items-center justify-center gap-1.5 text-[11px] text-pink-800/80 text-center">
          <Code2 className="w-3.5 h-3.5 text-pink-700 hidden sm:inline-block" />
          <span>
            พัฒนาโดย ครูเอก · © 2026 Crafted with code &amp; coffee by Kru Aek. All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  );
}
