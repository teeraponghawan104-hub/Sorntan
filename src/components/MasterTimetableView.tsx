import React, { useEffect, useState } from "react";
import { Search, UserCheck, Plus, Edit3, ArrowLeft, Users } from "lucide-react";
import {
  DAYS,
  DEPARTMENT_GROUPS,
  PERIOD_TIMES,
  TeacherRecord,
} from "../data/teachers";
import {
  formatLinkedCourseSummaryLine,
  parseScheduleCell,
} from "../utils/scheduler";
import { AcademicSettings, DEFAULT_ACADEMIC_SETTINGS } from "../utils/databaseStore";

interface MasterTimetableViewProps {
  teachers: TeacherRecord[];
  academicSettings?: AcademicSettings;
  initialFocusTeacherIds?: number[];
  onClearFocusTeachers?: () => void;
  onBackToPlanner?: () => void;
  onSelectTeacherForSubstitute: (teacherId: number) => void;
  onOpenAddTeacher: () => void;
  onOpenEditTeacher: (
    teacher: TeacherRecord,
    focusCell?: { day: number; period: number }
  ) => void;
}

export const MasterTimetableView: React.FC<MasterTimetableViewProps> = ({
  teachers,
  academicSettings = DEFAULT_ACADEMIC_SETTINGS,
  initialFocusTeacherIds = [],
  onClearFocusTeachers,
  onBackToPlanner,
  onSelectTeacherForSubstitute,
  onOpenAddTeacher,
  onOpenEditTeacher,
}) => {
  const [selectedGroup, setSelectedGroup] = useState<string>("ทั้งหมด");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [focusedIds, setFocusedIds] = useState<number[]>(() =>
    initialFocusTeacherIds.length > 0 ? initialFocusTeacherIds : []
  );
  const [activeSingleFocusId, setActiveSingleFocusId] = useState<number | null>(null);

  useEffect(() => {
    setFocusedIds(initialFocusTeacherIds);
    setActiveSingleFocusId(null);
  }, [initialFocusTeacherIds]);

  const regularCount = teachers.filter((t) => !t.isStudentTeacher).length;
  const studentCount = teachers.filter((t) => Boolean(t.isStudentTeacher)).length;
  const semesterLabel =
    academicSettings.semester === "ฤดูร้อน"
      ? "ภาคฤดูร้อน"
      : `ภาคเรียนที่ ${academicSettings.semester}`;

  const focusedTeachers = focusedIds
    .map((id) => teachers.find((t) => t.id === id))
    .filter((t): t is TeacherRecord => Boolean(t));

  const isFocusModeActive =
    focusedTeachers.length > 0 && !searchQuery.trim() && selectedGroup === "ทั้งหมด";

  const filteredTeachers = isFocusModeActive
    ? activeSingleFocusId !== null
      ? focusedTeachers.filter((t) => t.id === activeSingleFocusId)
      : focusedTeachers
    : teachers.filter((t) => {
        const matchGroup =
          selectedGroup === "ทั้งหมด" ||
          (selectedGroup === "นักศึกษาฝึกสอน"
            ? Boolean(t.isStudentTeacher)
            : t.g === selectedGroup);
        if (!matchGroup) return false;
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        const tokens = q
          .split(/[,]+|\s+/)
          .map((tok) => tok.trim())
          .filter(Boolean);
        if (tokens.length > 1 && tokens.every((tok) => /^\d{3}$/.test(tok))) {
          return tokens.includes(String(t.id));
        }
        return (
          String(t.id).includes(q) ||
          t.n.toLowerCase().includes(q) ||
          t.pdfGroup.toLowerCase().includes(q) ||
          t.r.toLowerCase().includes(q) ||
          t.s.toLowerCase().includes(q)
        );
      });

  const renderCellContent = (teacher: TeacherRecord, rawCell: string) => {
    const parsed = parseScheduleCell(rawCell, teacher.r);
    if (parsed.isEmpty) {
      return null;
    }
    if (parsed.isMeeting) {
      return (
        <div className="text-xs font-semibold text-amber-800 dark:text-amber-300 leading-tight">
          <div>{teacher.id === 100 ? "ประชุมบริหาร" : "ประชุมหัวหน้าฝ่าย"}</div>
          <div className="text-[11px] font-normal opacity-80">ปาริชาติ</div>
        </div>
      );
    }
    if (parsed.isSupervision) {
      const parts = parsed.displayLabel.split(" ");
      return (
        <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 leading-tight">
          <div>{parts[0]}</div>
          {parts[1] && <div className="text-[11px] mt-0.5">{parts[1]}</div>}
        </div>
      );
    }
    if (parsed.isActivity) {
      if (parsed.displayLabel.includes("โฮมรูม")) {
        return (
          <div className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-tight">
            <div>โฮมรูม</div>
            <div>ต.ทุจริต</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">หอประชุม</div>
          </div>
        );
      }
      if (parsed.displayLabel.includes("การป้องกันทุจริต")) {
        return (
          <div className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-tight">
            <div>การป้องกันทุจริต</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">ที่ปรึกษา</div>
          </div>
        );
      }
      if (parsed.displayLabel.includes("ต้านทุจริต")) {
        return (
          <div className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-tight">
            <div>ต้านทุจริต</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">ที่ปรึกษา</div>
          </div>
        );
      }
      if (parsed.displayLabel.includes("ลูกเสือ")) {
        return (
          <div className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-tight">
            <div>กิจกรรม</div>
            <div>ลูกเสือ ยุวกาชาด</div>
          </div>
        );
      }
      return (
        <div className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-tight">
          <div>{parsed.displayLabel}</div>
        </div>
      );
    }

    const displayCode = parsed.code.replace("IS-", "IS ");
    const hideRoom =
      parsed.room === "-" ||
      parsed.room === "ห้องเรียนชั้น" ||
      parsed.code.startsWith("เลือกเสรี");

    return (
      <div className="text-xs leading-tight">
        <div className="font-bold text-slate-900 dark:text-slate-100">
          {displayCode}
        </div>
        <div className="font-semibold text-blue-700 dark:text-blue-400">
          {parsed.cls}
        </div>
        {!hideRoom && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {parsed.room}
          </div>
        )}
      </div>
    );
  };

  const clearFocusMode = () => {
    setFocusedIds([]);
    setActiveSingleFocusId(null);
    if (onClearFocusTeachers) onClearFocusTeachers();
  };

  return (
    <div className="space-y-4">
      {/* แถบลิงก์ด่วนตารางสอนครูที่ลา */}
      {focusedTeachers.length > 0 && (
        <section
          id="focused-absent-teachers-bar"
          className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-3.5 sm:p-4 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              {onBackToPlanner && (
                <button
                  type="button"
                  onClick={onBackToPlanner}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs sm:text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap"
                >
                  <ArrowLeft className="w-4 h-4 shrink-0" />
                  <span>กลับหน้าจัดสอนแทน</span>
                </button>
              )}
              <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                <Users className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0" />
                <span>ตารางสอนครูที่ลา ({focusedTeachers.length} ท่าน)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={clearFocusMode}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer whitespace-nowrap"
            >
              แสดงตารางสอนครูทั้งหมด ({teachers.length} ท่าน)
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {focusedTeachers.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedGroup("ทั้งหมด");
                  setSearchQuery("");
                  setActiveSingleFocusId(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  isFocusModeActive && activeSingleFocusId === null
                    ? "bg-blue-700 text-white"
                    : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                }`}
              >
                ดูครบทั้ง {focusedTeachers.length} ท่าน
              </button>
            )}
            {focusedTeachers.map((t) => {
              const isSelectedSingle =
                isFocusModeActive &&
                (activeSingleFocusId === t.id ||
                  (focusedTeachers.length === 1 && activeSingleFocusId === null));
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedGroup("ทั้งหมด");
                    setSearchQuery("");
                    if (focusedTeachers.length > 1) {
                      setActiveSingleFocusId(
                        activeSingleFocusId === t.id ? null : t.id
                      );
                    } else {
                      setActiveSingleFocusId(null);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    isSelectedSingle
                      ? "bg-emerald-700 text-white"
                      : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-400"
                  }`}
                >
                  {t.id} {t.n} · {t.pdfGroup}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* แถบค้นหาและตัวกรองกลุ่มสาระ */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50 tracking-tight">
              {isFocusModeActive
                ? `ตารางสอนครูที่ลา (${filteredTeachers.length} ท่าน)`
                : `ตารางสอนครูและบุคลากร (${teachers.length} ท่าน)`}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {semesterLabel} ปีการศึกษา {academicSettings.academicYear} · ครูประจำการ{" "}
              {regularCount} ท่าน · นักศึกษาฝึกสอน {studentCount} ท่าน
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="ค้นหาชื่อครู รหัสครู หรือวิชา"
                placeholder="ค้นหาชื่อครู, รหัส (เช่น 102 203), วิชา..."
                className="w-full pl-9 pr-12 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="ล้างคำค้นหา"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  ล้าง
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onOpenAddTeacher}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer shadow-2xs transition-colors"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>เพิ่มครู / นศ.ฝึกสอน</span>
            </button>
          </div>
        </div>

        {/* ปุ่มกรองกลุ่มสาระ */}
        <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => {
              clearFocusMode();
              setSelectedGroup("ทั้งหมด");
            }}
            className={`px-3 py-1 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              !isFocusModeActive && selectedGroup === "ทั้งหมด"
                ? "bg-blue-700 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            ทั้งหมด ({teachers.length})
          </button>
          <button
            type="button"
            onClick={() => {
              clearFocusMode();
              setSelectedGroup("นักศึกษาฝึกสอน");
            }}
            className={`px-3 py-1 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              selectedGroup === "นักศึกษาฝึกสอน"
                ? "bg-blue-700 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            นักศึกษาฝึกสอน ({studentCount})
          </button>
          {DEPARTMENT_GROUPS.map((group) => {
            const count = teachers.filter((t) => t.g === group).length;
            return (
              <button
                key={group}
                type="button"
                onClick={() => {
                  clearFocusMode();
                  setSelectedGroup(group);
                }}
                className={`px-3 py-1 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  selectedGroup === group
                    ? "bg-blue-700 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {group} ({count})
              </button>
            );
          })}
        </div>
      </section>

      {/* รายการตารางสอน */}
      {filteredTeachers.length === 0 ? (
        <div className="bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-slate-800 rounded-xl p-10 text-center">
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
            ไม่พบข้อมูลครูที่ตรงกับเงื่อนไขการค้นหา
          </p>
          <button
            type="button"
            onClick={() => {
              clearFocusMode();
              setSelectedGroup("ทั้งหมด");
              setSearchQuery("");
            }}
            className="mt-3 px-4 py-2 rounded-lg bg-blue-700 text-white font-semibold text-sm cursor-pointer"
          >
            แสดงครูทั้งหมด
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {filteredTeachers.map((teacher) => (
            <article
              key={teacher.id}
              id={`timetable-card-${teacher.id}`}
              className="bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            >
              {/* ส่วนหัวตาราง */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3.5 mb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-blue-700 dark:text-blue-400">
                      {teacher.id}
                    </span>
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50 tracking-tight">
                      {teacher.n}
                    </h3>
                    {teacher.isStudentTeacher && (
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                        · นักศึกษาฝึกสอน
                      </span>
                    )}
                    {teacher.id === 302 && (
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                        · ย้ายไป รร.อื่น (โอนคาบให้ 305 ครูศักดิ์ชัย)
                      </span>
                    )}
                    {teacher.id === 305 && (
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        · รวมคาบสอนจาก 302 ครูรณสิทธิ์ แล้ว
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    กลุ่ม/ฝ่าย/งาน {teacher.pdfGroup} · {semesterLabel} {academicSettings.academicYear} · รวม{" "}
                    <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                      {teacher.totalHours} ชม./สัปดาห์
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenEditTeacher(teacher)}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-blue-300 hover:text-blue-700 dark:hover:text-blue-400 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Edit3 className="w-3.5 h-3.5 shrink-0" />
                    <span>แก้ไขตารางสอน</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectTeacherForSubstitute(teacher.id)}
                    className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <UserCheck className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {teacher.id === 302
                        ? "จัดสอนแทน (ไปที่ 305)"
                        : "จัดสอนแทนครูท่านนี้"}
                    </span>
                  </button>
                </div>
              </div>

              {/* ตารางสอน 5 วัน x 7 คาบ */}
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table
                  style={{ borderCollapse: "collapse", tableLayout: "fixed" }}
                  className="w-full text-center min-w-[820px]"
                >
                  <colgroup>
                    <col style={{ width: "90px" }} />
                    <col style={{ width: "95px" }} />
                    <col style={{ width: "95px" }} />
                    <col style={{ width: "95px" }} />
                    <col style={{ width: "95px" }} />
                    <col style={{ width: "86px" }} />
                    <col style={{ width: "95px" }} />
                    <col style={{ width: "95px" }} />
                    <col style={{ width: "95px" }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 text-xs font-bold">
                      <th className="border-b border-r border-slate-200 dark:border-slate-700 py-2 px-2">
                        ชั่วโมงที่
                      </th>
                      <th className="border-b border-r border-slate-200 dark:border-slate-700 py-2 px-2">
                        1
                      </th>
                      <th className="border-b border-r border-slate-200 dark:border-slate-700 py-2 px-2">
                        2
                      </th>
                      <th className="border-b border-r border-slate-200 dark:border-slate-700 py-2 px-2">
                        3
                      </th>
                      <th className="border-b border-r border-slate-200 dark:border-slate-700 py-2 px-2">
                        4
                      </th>
                      <th className="border-b border-r border-slate-200 dark:border-slate-700 py-2 px-1 bg-slate-100/80 dark:bg-slate-900/60 text-slate-400">
                        พัก
                      </th>
                      <th className="border-b border-r border-slate-200 dark:border-slate-700 py-2 px-2">
                        5
                      </th>
                      <th className="border-b border-r border-slate-200 dark:border-slate-700 py-2 px-2">
                        6
                      </th>
                      <th className="border-b border-slate-200 dark:border-slate-700 py-2 px-2">
                        7
                      </th>
                    </tr>
                    <tr className="bg-slate-50/70 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-[11px] font-medium tabular-nums">
                      <th className="border-b border-r border-slate-200 dark:border-slate-700 py-1 px-2">
                        เวลา
                      </th>
                      {PERIOD_TIMES.slice(0, 4).map((tm) => (
                        <th
                          key={tm}
                          className="border-b border-r border-slate-200 dark:border-slate-700 py-1 px-1 whitespace-nowrap"
                        >
                          {tm}
                        </th>
                      ))}
                      <th className="border-b border-r border-slate-200 dark:border-slate-700 py-1 px-1 bg-slate-100/80 dark:bg-slate-900/60 whitespace-nowrap">
                        12.00-13.00
                      </th>
                      {PERIOD_TIMES.slice(4).map((tm, idx) => (
                        <th
                          key={tm}
                          className={`border-b ${
                            idx < 2 ? "border-r" : ""
                          } border-slate-200 dark:border-slate-700 py-1 px-1 whitespace-nowrap`}
                        >
                          {tm}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {DAYS.map((dayName, dayIdx) => {
                      const dayRow = teacher.d?.[dayIdx] || [];
                      return (
                        <tr
                          key={dayName}
                          className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                        >
                          <td className="border-r border-slate-200 dark:border-slate-700 py-2 px-2 font-bold text-xs text-slate-700 dark:text-slate-200 bg-slate-50/60 dark:bg-slate-800/40">
                            {dayName}
                          </td>
                          {dayRow.slice(0, 4).map((cell, pIdx) => (
                            <td
                              key={pIdx}
                              onClick={() =>
                                onOpenEditTeacher(teacher, { day: dayIdx, period: pIdx })
                              }
                              title={`คลิกเพื่อแก้ไข วัน${dayName} คาบที่ ${pIdx + 1}`}
                              className="border-r border-slate-200 dark:border-slate-700 py-1.5 px-1 align-middle h-[56px] cursor-pointer hover:bg-blue-50/70 dark:hover:bg-blue-950/30 transition-colors"
                            >
                              {renderCellContent(teacher, cell)}
                            </td>
                          ))}
                          <td className="border-r border-slate-200 dark:border-slate-700 py-1.5 px-1 bg-slate-100/50 dark:bg-slate-900/40"></td>
                          {dayRow.slice(4, 7).map((cell, pIdx) => (
                            <td
                              key={pIdx + 4}
                              onClick={() =>
                                onOpenEditTeacher(teacher, {
                                  day: dayIdx,
                                  period: pIdx + 4,
                                })
                              }
                              title={`คลิกเพื่อแก้ไข วัน${dayName} คาบที่ ${pIdx + 5}`}
                              className={`${
                                pIdx < 2 ? "border-r border-slate-200 dark:border-slate-700" : ""
                              } py-1.5 px-1 align-middle h-[56px] cursor-pointer hover:bg-blue-50/70 dark:hover:bg-blue-950/30 transition-colors`}
                            >
                              {renderCellContent(teacher, cell)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* สรุปวิชาที่สอนด้านล่างตาราง */}
              <div className="mt-3 pt-2.5 text-xs text-slate-600 dark:text-slate-300">
                <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-1.5 mb-1.5">
                  <span>วิชาที่สอน / ชั้น [รวม]</span>
                  <span className="tabular-nums">รวม {teacher.totalHours} ชม.</span>
                </div>
                <div className="space-y-0.5">
                  {teacher.coursesSummary.map((line, i) => (
                    <div key={i}>
                      {formatLinkedCourseSummaryLine(
                        line,
                        teacher.pdfGroup || teacher.g,
                        teacher.id
                      )}
                    </div>
                  ))}
                  <div className="pt-1 text-slate-700 dark:text-slate-200 font-medium">
                    อื่นๆ {teacher.otherSummary}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
