import React from "react";
import { CalendarCheck, Table2, Users, Database, Moon, Sun, Calendar } from "lucide-react";
import { LEFT_SCHOOL_LOGO_URL } from "../utils/exportDoc";
import { AcademicSettings, DEFAULT_ACADEMIC_SETTINGS } from "../utils/databaseStore";

export type ActiveTab = "planner" | "timetables" | "free-finder" | "database";

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  teacherCount?: number;
  academicSettings?: AcademicSettings;
}

const NAV_ITEMS: { id: ActiveTab; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "planner", label: "จัดสอนแทน", shortLabel: "จัดสอนแทน", icon: CalendarCheck },
  { id: "timetables", label: "ตารางสอน", shortLabel: "ตารางสอน", icon: Table2 },
  { id: "free-finder", label: "เช็คครูว่าง", shortLabel: "เช็คครูว่าง", icon: Users },
  { id: "database", label: "ฐานข้อมูล", shortLabel: "ฐานข้อมูล", icon: Database },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  darkMode,
  onToggleDarkMode,
  academicSettings = DEFAULT_ACADEMIC_SETTINGS,
}) => {
  const semesterLabel =
    academicSettings.semester === "ฤดูร้อน"
      ? "ภาคฤดูร้อน"
      : `ภาคเรียนที่ ${academicSettings.semester}`;

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 border-t-[3px] border-t-blue-700 dark:border-t-blue-500 px-3 sm:px-5 lg:px-6 w-full print:hidden">
      <div className="max-w-[1400px] mx-auto">
        {/* Desktop 3-Zone Top Bar & Mobile Compact Top Row */}
        <div className="h-14 sm:h-16 flex items-center justify-between gap-3">
          {/* Zone 1: Brand Crest & Product Title */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <img
              id="lg"
              src={LEFT_SCHOOL_LOGO_URL}
              alt="ตราโรงเรียนวรคุณอุปถัมภ์"
              referrerPolicy="no-referrer"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white p-0.5 ring-1 ring-slate-200 dark:ring-slate-700 object-contain shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-50 truncate">
                ระบบจัดสอนแทน
              </h1>
              <p className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                โรงเรียนวรคุณอุปถัมภ์
              </p>
            </div>
          </div>

          {/* Zone 2 (Desktop): Clean Underline / Minimal Tab Navigation */}
          <nav
            aria-label="เมนูหลัก"
            className="hidden lg:flex items-center gap-1 bg-slate-100/90 dark:bg-slate-800/70 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/70"
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? "bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-xs ring-1 ring-slate-200/70 dark:ring-slate-700"
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Term Selector & Theme Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onSelectTab("database")}
              title="ตั้งค่าภาคเรียนและปีการศึกษา"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50/60 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="tabular-nums">
                {semesterLabel} / {academicSettings.academicYear}
              </span>
            </button>

            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {darkMode ? (
                <>
                  <Sun className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="hidden sm:inline">สว่าง</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-600 shrink-0" />
                  <span className="hidden sm:inline">มืด</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Mobile / Tablet Compact Sub-Nav Strip */}
        <nav
          aria-label="เมนูหลักมือถือ"
          className="grid grid-cols-4 lg:hidden gap-1 pb-2"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all whitespace-nowrap min-w-0 cursor-pointer ${
                  isActive
                    ? "bg-blue-700 text-white shadow-xs"
                    : "bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0 hidden sm:block" />
                <span className="truncate">{item.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
