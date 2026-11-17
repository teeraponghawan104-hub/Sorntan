import React, { useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import {
  DAYS,
  DEPARTMENT_GROUPS,
  PERIOD_TIMES,
  TeacherRecord,
} from "../data/teachers";
import {
  doesTeacherTeachGrade,
  formatRoomLabel,
  formatTeacherGradesSummary,
  isExcludedFromSubstituting,
  isSchoolAdministrator,
  parseScheduleCell,
} from "../utils/scheduler";
import { AcademicSettings } from "../utils/databaseStore";

interface FreeTeacherFinderProps {
  teachers: TeacherRecord[];
  academicSettings?: AcademicSettings;
  onSelectTeacherForSubstitute: (teacherId: number) => void;
}

const GRADE_LEVEL_FILTERS = ["ทั้งหมด", "1", "2", "3", "4", "5", "6"] as const;

export const FreeTeacherFinder: React.FC<FreeTeacherFinderProps> = ({
  teachers,
  onSelectTeacherForSubstitute,
}) => {
  const [dayIdx, setDayIdx] = useState<number>(0);
  const [periodIdx, setPeriodIdx] = useState<number>(0);
  const [filterGrade, setFilterGrade] = useState<string>("ทั้งหมด");
  const [filterGroup, setFilterGroup] = useState<string>("ทั้งหมด");

  const studentCount = teachers.filter((t) => Boolean(t.isStudentTeacher)).length;

  const teachersInScope = teachers.filter((t) => {
    if (t.id === 302) return false;
    if (filterGrade !== "ทั้งหมด" && !doesTeacherTeachGrade(t, filterGrade)) {
      return false;
    }
    if (filterGroup === "ทั้งหมด") return true;
    if (filterGroup === "นักศึกษาฝึกสอน") return Boolean(t.isStudentTeacher);
    return t.g === filterGroup;
  });

  const freeTeachers = teachersInScope.filter((t) => {
    if (dayIdx === 3 && periodIdx === 0) return false;
    const raw = t.d?.[dayIdx]?.[periodIdx] || "";
    return raw.trim() === "";
  });

  const busyTeachers = teachersInScope.filter((t) => {
    if (dayIdx === 3 && periodIdx === 0) return true;
    const raw = t.d?.[dayIdx]?.[periodIdx] || "";
    return raw.trim() !== "";
  });

  return (
    <div className="space-y-4">
      <section className="bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50 tracking-tight">
              เช็คครูว่างรายคาบ
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              ตรวจสอบสถานะครูที่ว่างพร้อมสอนแทนและครูที่มีคาบสอนในแต่ละช่วงเวลา
            </p>
          </div>
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
            วัน{DAYS[dayIdx]} · คาบที่ {periodIdx + 1} ({PERIOD_TIMES[periodIdx]})
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* เลือกวัน */}
          <div className="lg:col-span-4">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              วันทำการ
            </span>
            <div className="grid grid-cols-5 gap-1.5 bg-slate-100 dark:bg-slate-800/70 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700">
              {DAYS.map((d, idx) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDayIdx(idx)}
                  className={`py-1.5 px-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    dayIdx === idx
                      ? "bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-xs ring-1 ring-slate-200/80 dark:ring-slate-700"
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* เลือกคาบ */}
          <div className="lg:col-span-8">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              คาบเรียน
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-1.5">
              {PERIOD_TIMES.map((tm, p) => (
                <button
                  key={tm}
                  type="button"
                  onClick={() => setPeriodIdx(p)}
                  className={`px-2.5 py-1.5 rounded-lg text-left transition-all cursor-pointer border ${
                    periodIdx === p
                      ? "bg-blue-700 border-blue-700 text-white shadow-xs"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-600"
                  }`}
                >
                  <div className="text-xs font-bold leading-tight">คาบ {p + 1}</div>
                  <div
                    className={`text-[11px] tabular-nums mt-0.5 ${
                      periodIdx === p ? "text-blue-100" : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {tm}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ตัวกรองระดับชั้น & กลุ่มสาระ */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1.5">
              ระดับชั้น:
            </span>
            {GRADE_LEVEL_FILTERS.map((gr) => (
              <button
                key={gr}
                type="button"
                onClick={() => setFilterGrade(gr)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  filterGrade === gr
                    ? "bg-slate-900 dark:bg-blue-600 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {gr === "ทั้งหมด" ? "ทุกระดับชั้น" : `ม.${gr}`}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1.5">
              กลุ่มสาระ:
            </span>
            <button
              type="button"
              onClick={() => setFilterGroup("ทั้งหมด")}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                filterGroup === "ทั้งหมด"
                  ? "bg-blue-700 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              ทั้งหมด
            </button>
            <button
              type="button"
              onClick={() => setFilterGroup("นักศึกษาฝึกสอน")}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                filterGroup === "นักศึกษาฝึกสอน"
                  ? "bg-blue-700 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              นักศึกษาฝึกสอน ({studentCount})
            </button>
            {DEPARTMENT_GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setFilterGroup(g)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  filterGroup === g
                    ? "bg-blue-700 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ผลลัพธ์ครูว่าง vs ครูติดสอน */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* คอลัมน์ครูว่าง */}
        <section className="bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                ครูที่ว่างในวัน{DAYS[dayIdx]} คาบที่ {periodIdx + 1}
              </span>
            </h3>
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 tabular-nums">
              {freeTeachers.length} ท่าน
            </span>
          </div>

          {freeTeachers.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
              ไม่มีครูว่างในคาบเวลานี้ตามเงื่อนไขที่เลือก
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {freeTeachers.map((t) => {
                const gradesLabel = formatTeacherGradesSummary(t);
                return (
                  <div
                    key={t.id}
                    className="py-2.5 flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-400 mr-1.5">
                          {t.id}
                        </span>
                        <span>{t.n}</span>
                        {t.isStudentTeacher && (
                          <span className="ml-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                            · นศ.ฝึกสอน
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {t.pdfGroup} · {formatRoomLabel(t.r)}
                        {gradesLabel !== "-" ? ` · สอน ${gradesLabel}` : ""}
                      </div>
                    </div>

                    {isExcludedFromSubstituting(t) ? (
                      <span className="text-xs font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
                        {isSchoolAdministrator(t) ? "ผู้บริหาร" : "ยกเว้นสอนแทน"}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap shrink-0">
                        พร้อมสอนแทน
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* คอลัมน์ครูมีคาบสอน/ติดภารกิจ */}
        <section className="bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <span>ครูที่มีคาบสอน / ภารกิจ</span>
            </h3>
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 tabular-nums">
              {busyTeachers.length} ท่าน
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {busyTeachers.map((t) => {
              const raw = t.d?.[dayIdx]?.[periodIdx] || "";
              const parsed = parseScheduleCell(raw, t.r);
              return (
                <div
                  key={t.id}
                  className="py-2.5 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      <span className="font-mono text-xs font-bold text-slate-500 dark:text-slate-400 mr-1.5">
                        {t.id}
                      </span>
                      <span>{t.n}</span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      {t.pdfGroup} ·{" "}
                      <span className="font-semibold text-blue-700 dark:text-blue-400">
                        {parsed.displayLabel}
                      </span>
                    </div>
                  </div>
                  {parsed.isTeachable && (
                    <button
                      type="button"
                      onClick={() => onSelectTeacherForSubstitute(t.id)}
                      className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                    >
                      จัดคนแทน
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};
