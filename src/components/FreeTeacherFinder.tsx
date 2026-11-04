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
import { AcademicSettings, DEFAULT_ACADEMIC_SETTINGS } from "../utils/databaseStore";

interface FreeTeacherFinderProps {
  teachers: TeacherRecord[];
  academicSettings?: AcademicSettings;
  onSelectTeacherForSubstitute: (teacherId: number) => void;
}

const GRADE_LEVEL_FILTERS = ["ทั้งหมด", "1", "2", "3", "4", "5", "6"] as const;

export const FreeTeacherFinder: React.FC<FreeTeacherFinderProps> = ({
  teachers,
  academicSettings = DEFAULT_ACADEMIC_SETTINGS,
  onSelectTeacherForSubstitute,
}) => {
  const [dayIdx, setDayIdx] = useState<number>(0); // 0 = จันทร์
  const [periodIdx, setPeriodIdx] = useState<number>(0); // 0 = คาบ 1
  const [filterGrade, setFilterGrade] = useState<string>("ทั้งหมด");
  const [filterGroup, setFilterGroup] = useState<string>("ทั้งหมด");

  const studentCount = teachers.filter((t) => Boolean(t.isStudentTeacher)).length;
  const semesterLabel =
    academicSettings.semester === "ฤดูร้อน"
      ? "ภาคฤดูร้อน"
      : `ภาคเรียนที่ ${academicSettings.semester}`;

  const teachersInScope = teachers.filter((t) => {
    if (t.id === 302) return false; // 302 ย้ายไปโรงเรียนอื่น (คาบสอนทั้งหมดไปอยู่กับ 305 ครูศักดิ์ชัย แสงมาศ)
    if (filterGrade !== "ทั้งหมด" && !doesTeacherTeachGrade(t, filterGrade)) {
      return false;
    }
    if (filterGroup === "ทั้งหมด") return true;
    if (filterGroup === "นักศึกษาฝึกสอน") return Boolean(t.isStudentTeacher);
    return t.g === filterGroup;
  });

  const freeTeachers = teachersInScope.filter((t) => {
    if (dayIdx === 3 && periodIdx === 0) return false; // พฤหัสฯ คาบ 1 โฮมรูม
    const raw = t.d?.[dayIdx]?.[periodIdx] || "";
    return raw.trim() === "";
  });

  const busyTeachers = teachersInScope.filter((t) => {
    if (dayIdx === 3 && periodIdx === 0) return true;
    const raw = t.d?.[dayIdx]?.[periodIdx] || "";
    return raw.trim() !== "";
  });

  return (
    <div className="space-y-5">
      <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold text-[#0f2150] dark:text-[#e9eefc]">
              เช็คครูว่างรายคาบ (ตรวจสอบผู้พร้อมสอนแทนตามระดับชั้นและกลุ่มสาระ)
            </h2>
            <p className="text-sm text-[#51608a] dark:text-[#9fb0dc] mt-0.5">
              {semesterLabel} ปีการศึกษา {academicSettings.academicYear} · เลือกวัน คาบเรียน ระดับชั้น และกลุ่มสาระ เพื่อดูรายชื่อครูประจำการและนักศึกษาฝึกสอนที่ว่างพร้อมสอนแทน
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {/* เลือกวัน */}
          <div>
            <span className="block text-sm font-semibold text-[#0f2150] dark:text-[#e9eefc] mb-1.5">
              วันทำการ
            </span>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, idx) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDayIdx(idx)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                    dayIdx === idx
                      ? "bg-[#1b4fb8] text-white"
                      : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* เลือกคาบ */}
          <div className="md:col-span-2">
            <span className="block text-sm font-semibold text-[#0f2150] dark:text-[#e9eefc] mb-1.5">
              คาบเรียน
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PERIOD_TIMES.map((tm, p) => (
                <button
                  key={tm}
                  type="button"
                  onClick={() => setPeriodIdx(p)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                    periodIdx === p
                      ? "bg-[#1b4fb8] text-white"
                      : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
                  }`}
                >
                  คาบ {p + 1} ({tm})
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* กรองระดับชั้น (หลัก) */}
        <div className="flex flex-wrap items-center gap-1.5 mt-4 pt-3 border-t border-[#c9d4ec] dark:border-[#2a3a6e]">
          <span className="text-xs font-semibold text-[#0f2150] dark:text-[#e9eefc] mr-1">
            ระดับชั้นที่สอน (หลัก):
          </span>
          {GRADE_LEVEL_FILTERS.map((gr) => (
            <button
              key={gr}
              type="button"
              onClick={() => setFilterGrade(gr)}
              className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                filterGrade === gr
                  ? "bg-[#1b4fb8] text-white"
                  : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
              }`}
            >
              {gr === "ทั้งหมด" ? "ทุกระดับชั้น" : `ชั้น ม.${gr}`}
            </button>
          ))}
        </div>

        {/* กรองกลุ่มสาระ (รอง) */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2.5 border-t border-dashed border-[#c9d4ec] dark:border-[#2a3a6e]">
          <span className="text-xs font-semibold text-[#51608a] dark:text-[#9fb0dc] mr-1">
            กลุ่มสาระ/ประเภท:
          </span>
          <button
            type="button"
            onClick={() => setFilterGroup("ทั้งหมด")}
            className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
              filterGroup === "ทั้งหมด"
                ? "bg-[#1b4fb8] text-white"
                : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
            }`}
          >
            ทั้งหมด
          </button>
          <button
            type="button"
            onClick={() => setFilterGroup("นักศึกษาฝึกสอน")}
            className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
              filterGroup === "นักศึกษาฝึกสอน"
                ? "bg-[#1b4fb8] text-white"
                : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
            }`}
          >
            นักศึกษาฝึกสอน ({studentCount})
          </button>
          {DEPARTMENT_GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setFilterGroup(g)}
              className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                filterGroup === g
                  ? "bg-[#1b4fb8] text-white"
                  : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </section>

      {/* ผลลัพธ์ครูว่าง vs ครูติดสอน */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* คอลัมน์ครูว่าง */}
        <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#c9d4ec] dark:border-[#2a3a6e]">
            <h3 className="text-lg font-bold text-[#0b7a4b] dark:text-[#4fd39a] flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              <span>
                ครูที่ว่างในวัน{DAYS[dayIdx]} คาบที่ {periodIdx + 1} ({freeTeachers.length} ท่าน)
              </span>
            </h3>
          </div>

          {freeTeachers.length === 0 ? (
            <p className="text-sm text-[#51608a] dark:text-[#9fb0dc] py-4">
              ไม่มีครูว่างในคาบเวลานี้ตามเงื่อนไขที่เลือก
            </p>
          ) : (
            <div className="divide-y divide-[#c9d4ec]/60 dark:divide-[#2a3a6e]/60">
              {freeTeachers.map((t) => {
                const gradesLabel = formatTeacherGradesSummary(t);
                return (
                  <div
                    key={t.id}
                    className="py-2.5 flex items-center justify-between gap-2 text-sm"
                  >
                    <div>
                      <span className="font-bold text-[#0f2150] dark:text-[#e9eefc]">
                        {t.id} {t.n}
                        {t.isStudentTeacher ? " (นักศึกษาฝึกสอน)" : ""}
                      </span>
                      <span className="text-[#51608a] dark:text-[#9fb0dc] ml-2">
                        · {t.pdfGroup} ({formatRoomLabel(t.r)})
                      </span>
                      {gradesLabel !== "-" && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-[#eaf0fa] dark:bg-[#0b1330] text-xs font-semibold text-[#1b4fb8] dark:text-[#6c97ff]">
                          สอน {gradesLabel}
                        </span>
                      )}
                    </div>
                    {isExcludedFromSubstituting(t) ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                        {isSchoolAdministrator(t) ? "ผู้บริหาร (ไม่จัดสอนแทน)" : "ยกเว้นการสอนแทน"}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-[#0b7a4b] dark:text-[#4fd39a] whitespace-nowrap">
                        ว่างพร้อมสอนแทน
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* คอลัมน์ครูมีคาบสอน/ติดภารกิจ */}
        <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#c9d4ec] dark:border-[#2a3a6e]">
            <h3 className="text-lg font-bold text-[#0f2150] dark:text-[#e9eefc] flex items-center gap-2">
              <Clock className="w-5 h-5 text-[#1b4fb8] dark:text-[#6c97ff]" />
              <span>
                ครูที่มีคาบสอน / ภารกิจ ({busyTeachers.length} ท่าน)
              </span>
            </h3>
          </div>

          <div className="divide-y divide-[#c9d4ec]/60 dark:divide-[#2a3a6e]/60">
            {busyTeachers.map((t) => {
              const raw = t.d?.[dayIdx]?.[periodIdx] || "";
              const parsed = parseScheduleCell(raw, t.r);
              return (
                <div
                  key={t.id}
                  className="py-2.5 flex items-center justify-between gap-2 text-sm"
                >
                  <div>
                    <span className="font-bold text-[#0f2150] dark:text-[#e9eefc]">
                      {t.id} {t.n}
                      {t.isStudentTeacher ? " (นักศึกษาฝึกสอน)" : ""}
                    </span>
                    <span className="text-[#51608a] dark:text-[#9fb0dc] ml-2">
                      · {t.pdfGroup} ·{" "}
                      <b className="text-[#1b4fb8] dark:text-[#6c97ff]">
                        {parsed.displayLabel}
                      </b>
                    </span>
                  </div>
                  {parsed.isTeachable && (
                    <button
                      type="button"
                      onClick={() => onSelectTeacherForSubstitute(t.id)}
                      className="text-xs font-semibold text-[#1b4fb8] dark:text-[#6c97ff] hover:underline cursor-pointer whitespace-nowrap"
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
