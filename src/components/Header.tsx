import React from "react";
import { CalendarCheck, Table2, Users, Database, Moon, Sun } from "lucide-react";
import { LEFT_SCHOOL_LOGO_URL } from "../utils/exportDoc";

export type ActiveTab = "planner" | "timetables" | "free-finder" | "database";

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  teacherCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  darkMode,
  onToggleDarkMode,
  teacherCount = 31,
}) => {
  return (
    <header className="bg-[#12307a] text-white border-b-4 border-[#f2c230] px-3 py-3 sm:px-5 md:px-6 w-full overflow-hidden print:hidden">
      <div className="max-w-[1360px] mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        {/* Top Row on Mobile: Brand lockup + Dark mode button */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
            <img
              id="lg"
              src={LEFT_SCHOOL_LOGO_URL}
              alt="ตราโรงเรียนวรคุณอุปถัมภ์"
              referrerPolicy="no-referrer"
              className="h-11 sm:h-14 w-auto object-contain shrink-0"
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-[15px] sm:text-xl md:text-2xl font-bold leading-tight tracking-tight text-white">
                ระบบจัดสอนแทน โรงเรียนวรคุณอุปถัมภ์
              </h1>
              <p className="text-[12px] sm:text-xs text-blue-100/90 leading-snug mt-0.5">
                ภาคเรียนที่ 2 ปีการศึกษา 2569 · พัฒนาโดย นักศึกษาฝึกวิชาชีพครู นายธีระพงษ์ หาวัน
              </p>
            </div>
          </div>

          {/* Theme action on mobile (right-aligned in top row) */}
          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"}
            className="flex lg:hidden items-center gap-1 px-2.5 py-1.5 rounded-md border border-blue-400/40 bg-blue-900/40 hover:bg-blue-800/60 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {darkMode ? (
              <>
                <Sun className="w-3.5 h-3.5 text-[#f2c230]" />
                <span>สว่าง</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-[#f2c230]" />
                <span>มืด</span>
              </>
            )}
          </button>
        </div>

        {/* Navigation links + Desktop Theme button */}
        <div className="flex items-center justify-between gap-3 w-full lg:w-auto">
          <nav
            aria-label="เมนูหลัก"
            className="grid grid-cols-2 sm:grid-cols-4 lg:flex items-center gap-1.5 bg-[#0a1d4e] p-1.5 rounded-lg border border-blue-700/60 w-full lg:w-auto"
          >
            <button
              type="button"
              onClick={() => onSelectTab("planner")}
              className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === "planner"
                  ? "bg-[#f2c230] text-[#091536] shadow-xs"
                  : "text-white/90 hover:text-white hover:bg-blue-800/60"
              }`}
            >
              <CalendarCheck className="w-3.5 h-3.5 shrink-0" />
              <span>จัดสอนแทน</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectTab("timetables")}
              className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === "timetables"
                  ? "bg-[#f2c230] text-[#091536] shadow-xs"
                  : "text-white/90 hover:text-white hover:bg-blue-800/60"
              }`}
            >
              <Table2 className="w-3.5 h-3.5 shrink-0" />
              <span>ตารางสอน</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectTab("free-finder")}
              className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === "free-finder"
                  ? "bg-[#f2c230] text-[#091536] shadow-xs"
                  : "text-white/90 hover:text-white hover:bg-blue-800/60"
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span>เช็คครูว่าง</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectTab("database")}
              className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === "database"
                  ? "bg-[#f2c230] text-[#091536] shadow-xs"
                  : "text-white/90 hover:text-white hover:bg-blue-800/60"
              }`}
            >
              <Database className="w-3.5 h-3.5 shrink-0" />
              <span>ฐานข้อมูล</span>
            </button>
          </nav>

          {/* Theme action on desktop */}
          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"}
            className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-blue-400/40 bg-blue-900/40 hover:bg-blue-800/60 text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {darkMode ? (
              <>
                <Sun className="w-4 h-4 text-[#f2c230]" />
                <span>โหมดสว่าง</span>
              </>
            ) : (
              <>
                <Moon className="w-4 h-4 text-[#f2c230]" />
                <span>โหมดมืด</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
