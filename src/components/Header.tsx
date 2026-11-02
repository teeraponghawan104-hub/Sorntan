import React from "react";
import { CalendarCheck, Table2, Users, Moon, Sun } from "lucide-react";
import { SCHOOL_LOGO } from "../data/logo";

export type ActiveTab = "planner" | "timetables" | "free-finder";

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  darkMode,
  onToggleDarkMode,
}) => {
  return (
    <header className="bg-[#12307a] text-white border-b-4 border-[#f2c230] px-4 py-3 md:px-6">
      <div className="max-w-[1360px] mx-auto flex flex-wrap items-center justify-between gap-4">
        {/* Zone 1: Brand lockup */}
        <div className="flex items-center gap-3.5 shrink-0">
          <img
            id="lg"
            src={SCHOOL_LOGO}
            alt="ตราโรงเรียนวรคุณอุปถัมภ์"
            referrerPolicy="no-referrer"
            className="h-14 w-auto object-contain shrink-0"
          />
          <div>
            <h1 className="text-xl md:text-2xl font-bold leading-tight tracking-tight whitespace-nowrap text-white">
              ระบบจัดสอนแทน โรงเรียนวรคุณอุปถัมภ์
            </h1>
            <p className="text-sm text-blue-100/90">
              ภาคเรียนที่ 2 ปีการศึกษา 2569 · ข้อมูลตารางสอนครบทั้ง 31 ท่านจาก PDF
            </p>
          </div>
        </div>

        {/* Zone 2: Navigation links */}
        <nav
          aria-label="เมนูหลัก"
          className="flex items-center gap-1.5 bg-[#0a1d4e] p-1.5 rounded-lg border border-blue-700/60"
        >
          <button
            type="button"
            onClick={() => onSelectTab("planner")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-base font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === "planner"
                ? "bg-[#f2c230] text-[#091536] shadow-xs"
                : "text-white/90 hover:text-white hover:bg-blue-800/60"
            }`}
          >
            <CalendarCheck className="w-4 h-4 shrink-0" />
            <span>จัดครูสอนแทน</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectTab("timetables")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-base font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === "timetables"
                ? "bg-[#f2c230] text-[#091536] shadow-xs"
                : "text-white/90 hover:text-white hover:bg-blue-800/60"
            }`}
          >
            <Table2 className="w-4 h-4 shrink-0" />
            <span>ตารางสอนรวม (31 ท่าน)</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectTab("free-finder")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-base font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === "free-finder"
                ? "bg-[#f2c230] text-[#091536] shadow-xs"
                : "text-white/90 hover:text-white hover:bg-blue-800/60"
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>เช็คครูว่างรายคาบ</span>
          </button>
        </nav>

        {/* Zone 3: Theme action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-blue-400/40 bg-blue-900/40 hover:bg-blue-800/60 text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
