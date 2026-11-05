import React, { useEffect, useState } from "react";
import { Search, UserCheck, Plus, Edit3, ArrowLeft, Users } from "lucide-react";
import {
  DAYS,
  DEPARTMENT_GROUPS,
  PERIOD_TIMES,
  TeacherRecord,
} from "../data/teachers";
import { parseScheduleCell } from "../utils/scheduler";
import { AcademicSettings, DEFAULT_ACADEMIC_SETTINGS } from "../utils/databaseStore";

interface MasterTimetableViewProps {
  teachers: TeacherRecord[];
  academicSettings?: AcademicSettings;
  initialFocusTeacherIds?: number[];
  onClearFocusTeachers?: () => void;
  onBackToPlanner?: () => void;
  onSelectTeacherForSubstitute: (teacherId: number) => void;
  onOpenAddTeacher: () => void;
  onOpenEditTeacher: (teacher: TeacherRecord) => void;
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
        // รองรับการค้นหาหลายรหัสหรือหลายชื่อพร้อมกัน เช่น "102 203" หรือ "102, 203, 301"
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
        <div className="text-xs font-semibold text-amber-900 dark:text-amber-300 leading-tight">
          <div>{teacher.id === 100 ? "ประชุมบริหาร" : "ประชุมหัวหน้าฝ่าย"}</div>
          <div className="text-[11px] opacity-85">ปาริชาติ</div>
        </div>
      );
    }
    if (parsed.isSupervision) {
      const parts = parsed.displayLabel.split(" ");
      return (
        <div className="text-xs font-semibold text-indigo-800 dark:text-indigo-300 leading-tight">
          <div>{parts[0]}</div>
          {parts[1] && <div className="text-[11px] mt-0.5">{parts[1]}</div>}
        </div>
      );
    }
    if (parsed.isActivity) {
      if (parsed.displayLabel.includes("โฮมรูม")) {
        return (
          <div className="text-xs font-medium text-slate-800 dark:text-slate-200 leading-tight">
            <div>โฮมรูม</div>
            <div>ต.ทุจริต</div>
            <div className="text-[11px] opacity-80">หอประชุม</div>
          </div>
        );
      }
      if (parsed.displayLabel.includes("การป้องกันทุจริต")) {
        return (
          <div className="text-xs font-medium text-slate-800 dark:text-slate-200 leading-tight">
            <div>การป้องกันทุจริต</div>
            <div className="text-[11px] opacity-80">ที่ปรึกษา</div>
          </div>
        );
      }
      if (parsed.displayLabel.includes("ต้านทุจริต")) {
        return (
          <div className="text-xs font-medium text-slate-800 dark:text-slate-200 leading-tight">
            <div>ต้านทุจริต</div>
            <div className="text-[11px] opacity-80">ที่ปรึกษา</div>
          </div>
        );
      }
      if (parsed.displayLabel.includes("ลูกเสือ")) {
        return (
          <div className="text-xs font-medium text-slate-800 dark:text-slate-200 leading-tight">
            <div>กิจกรรม</div>
            <div>ลูกเสือ ยุวกาชาด</div>
          </div>
        );
      }
      return (
        <div className="text-xs font-medium text-slate-800 dark:text-slate-200 leading-tight">
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
        <div className="font-bold text-[#0f2150] dark:text-[#e9eefc]">
          {displayCode}
        </div>
        <div className="font-semibold text-[#1b4fb8] dark:text-[#6c97ff]">
          {parsed.cls}
        </div>
        {!hideRoom && (
          <div className="text-[11px] text-[#51608a] dark:text-[#9fb0dc]">
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
      {/* แถบลิงก์ด่วนตารางสอนครูที่ลา (แสดงเมื่อกดปุ่ม "ดูตารางสอน" มาจากหน้าจัดสอนแทน ไม่ว่าจะลา 1, 2, 3 หรือหลายท่าน) */}
      {focusedTeachers.length > 0 && (
        <section
          id="focused-absent-teachers-bar"
          className="bg-white dark:bg-[#14204a] border-2 border-[#1b4fb8] dark:border-[#6c97ff] rounded-xl p-3.5 sm:p-4 shadow-xs space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {onBackToPlanner && (
                <button
                  type="button"
                  onClick={onBackToPlanner}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-xs sm:text-sm font-bold cursor-pointer transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 shrink-0" />
                  <span>กลับหน้าจัดสอนแทน</span>
                </button>
              )}
              <div className="flex items-center gap-1.5 text-sm font-bold text-[#0f2150] dark:text-[#e9eefc]">
                <Users className="w-4 h-4 text-[#1b4fb8] dark:text-[#6c97ff] shrink-0" />
                <span>
                  ตารางสอนครูที่ลา ({focusedTeachers.length} ท่าน)
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={clearFocusMode}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#51608a] dark:text-[#9fb0dc] hover:bg-[#eaf0fa] dark:hover:bg-[#0b1330] hover:text-[#0f2150] dark:hover:text-white cursor-pointer"
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
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                  isFocusModeActive && activeSingleFocusId === null
                    ? "bg-[#1b4fb8] text-white"
                    : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] hover:bg-blue-200 dark:hover:bg-blue-900"
                }`}
              >
                ดูครบทั้ง {focusedTeachers.length} ท่านพร้อมกัน
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
                  className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                    isSelectedSingle
                      ? "bg-[#0b7a4b] text-white font-bold"
                      : "bg-[#f8faff] dark:bg-[#0b1330] border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#0f2150] dark:text-[#e9eefc] hover:border-[#1b4fb8]"
                  }`}
                >
                  {t.id} {t.n} ({t.pdfGroup})
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* แถบค้นหาและตัวกรองกลุ่มสาระ */}
      <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#0f2150] dark:text-[#e9eefc]">
              {isFocusModeActive
                ? `กำลังแสดงตารางสอนครูที่ลา (${filteredTeachers.length} ท่าน)`
                : `ตารางสอนครูและบุคลากรทั้งหมด (${teachers.length} ท่าน)`}
            </h2>
            <p className="text-sm text-[#51608a] dark:text-[#9fb0dc]">
              {semesterLabel} ปีการศึกษา {academicSettings.academicYear} · ครูประจำการ {regularCount} ท่าน · นักศึกษาฝึกสอน {studentCount} ท่าน
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-[#51608a] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="ค้นหาชื่อครู รหัสครู หรือวิชา"
                placeholder="ค้นหาชื่อครู, รหัส (เช่น 102 203), วิชา..."
                className="w-full pl-9 pr-8 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] text-sm sm:text-base focus:outline-2 focus:outline-[#f2c230]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="ล้างคำค้นหา"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#51608a] hover:text-[#0f2150] cursor-pointer"
                >
                  ล้าง
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onOpenAddTeacher}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-sm font-bold whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>เพิ่มครู / นศ.ฝึกสอน</span>
            </button>
          </div>
        </div>

        {/* ปุ่มกรองกลุ่มสาระ */}
        <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-[#c9d4ec] dark:border-[#2a3a6e]">
          <button
            type="button"
            onClick={() => {
              clearFocusMode();
              setSelectedGroup("ทั้งหมด");
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              !isFocusModeActive && selectedGroup === "ทั้งหมด"
                ? "bg-[#1b4fb8] text-white"
                : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc] hover:bg-blue-200 dark:hover:bg-blue-900"
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
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              selectedGroup === "นักศึกษาฝึกสอน"
                ? "bg-[#1b4fb8] text-white"
                : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc] hover:bg-blue-200 dark:hover:bg-blue-900"
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
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  selectedGroup === group
                    ? "bg-[#1b4fb8] text-white"
                    : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc] hover:bg-blue-200 dark:hover:bg-blue-900"
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
        <div className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-10 text-center">
          <p className="text-lg font-semibold text-[#0f2150] dark:text-[#e9eefc]">
            ไม่พบข้อมูลครูที่ตรงกับเงื่อนไขการค้นหา
          </p>
          <button
            type="button"
            onClick={() => {
              clearFocusMode();
              setSelectedGroup("ทั้งหมด");
              setSearchQuery("");
            }}
            className="mt-3 px-4 py-2 rounded-lg bg-[#1b4fb8] text-white font-semibold text-sm cursor-pointer"
          >
            แสดงครูทั้งหมด
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {filteredTeachers.map((teacher) => (
            <article
              key={teacher.id}
              id={`timetable-card-${teacher.id}`}
              className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 md:p-6 shadow-xs"
            >
              {/* ส่วนหัวตารางตามต้นฉบับ PDF */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 mb-4 border-b border-[#c9d4ec] dark:border-[#2a3a6e]">
                <div className="text-center md:text-left flex-1">
                  <div className="text-base font-bold text-[#0f2150] dark:text-[#e9eefc]">
                    โรงเรียนวรคุณอุปถัมภ์ · ตารางสอน{semesterLabel} ปีการศึกษา {academicSettings.academicYear} กลุ่ม/ฝ่าย/งาน{" "}
                    {teacher.pdfGroup}
                  </div>
                  <div className="text-lg font-bold text-[#1b4fb8] dark:text-[#6c97ff] mt-0.5">
                    ชื่อ-สกุล {teacher.id} {teacher.n}
                    {teacher.isStudentTeacher ? " (นักศึกษาฝึกสอน)" : ""} &nbsp;·&nbsp; จำนวนชั่วโมง{" "}
                    {teacher.totalHours}
                    {teacher.id === 302 && (
                      <span className="ml-2 inline-block px-2.5 py-0.5 text-xs font-bold rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                        ย้ายไป รร.อื่น · โอนคาบสอนให้ 305 ครูศักดิ์ชัย แสงมาศ ทั้งหมด
                      </span>
                    )}
                    {teacher.id === 305 && (
                      <span className="ml-2 inline-block px-2.5 py-0.5 text-xs font-bold rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                        รวมคาบสอนจาก 302 ครูรณสิทธิ์ ประดับศรี ทั้งหมดแล้ว
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenEditTeacher(teacher)}
                    className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#1b4fb8] dark:border-[#6c97ff] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-[#eaf0fa] dark:hover:bg-blue-950 text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Edit3 className="w-4 h-4" />
                    <span>แก้ไขตารางสอน</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectTeacherForSubstitute(teacher.id)}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <UserCheck className="w-4 h-4" />
                    <span>
                      {teacher.id === 302
                        ? "จัดสอนแทน (ไปที่ 305 ครูศักดิ์ชัย)"
                        : "จัดสอนแทนครูท่านนี้"}
                    </span>
                  </button>
                </div>
              </div>

              {/* ตารางสอน 2 แถวหัวตาราง (ชั่วโมงที่ / เวลา) + ช่อง 12.00-13.00 ตรงตาม PDF */}
              <div className="overflow-x-auto">
                <table
                  style={{ borderCollapse: "collapse", tableLayout: "fixed" }}
                  className="w-full text-center min-w-[820px] border border-slate-800 dark:border-[#4a5d99]"
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
                    <tr className="bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] text-sm font-bold">
                      <th className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-2">
                        ชั่วโมงที่
                      </th>
                      <th className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-2">
                        1
                      </th>
                      <th className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-2">
                        2
                      </th>
                      <th className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-2">
                        3
                      </th>
                      <th className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-2">
                        4
                      </th>
                      <th className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-1 bg-slate-100 dark:bg-slate-900/60"></th>
                      <th className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-2">
                        5
                      </th>
                      <th className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-2">
                        6
                      </th>
                      <th className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-2">
                        7
                      </th>
                    </tr>
                    <tr className="bg-[#f4f7fc] dark:bg-[#101b3d] text-[#0f2150] dark:text-[#e9eefc] text-xs font-semibold">
                      <th className="border border-slate-700 dark:border-[#3b4e87] py-1 px-2">
                        เวลา
                      </th>
                      {PERIOD_TIMES.slice(0, 4).map((tm) => (
                        <th
                          key={tm}
                          className="border border-slate-700 dark:border-[#3b4e87] py-1 px-1 whitespace-nowrap"
                        >
                          {tm}
                        </th>
                      ))}
                      <th className="border border-slate-700 dark:border-[#3b4e87] py-1 px-1 bg-slate-100 dark:bg-slate-900/60 whitespace-nowrap">
                        12.00-13.00
                      </th>
                      {PERIOD_TIMES.slice(4).map((tm) => (
                        <th
                          key={tm}
                          className="border border-slate-700 dark:border-[#3b4e87] py-1 px-1 whitespace-nowrap"
                        >
                          {tm}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((dayName, dayIdx) => {
                      const dayRow = teacher.d?.[dayIdx] || [];
                      return (
                        <tr
                          key={dayName}
                          className="hover:bg-slate-50/70 dark:hover:bg-blue-950/30"
                        >
                          <td className="border border-slate-700 dark:border-[#3b4e87] py-2 px-2 font-bold text-sm text-[#0f2150] dark:text-[#e9eefc] bg-[#eaf0fa]/30 dark:bg-[#0b1330]/40">
                            {dayName}
                          </td>
                          {dayRow.slice(0, 4).map((cell, pIdx) => (
                            <td
                              key={pIdx}
                              className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-1 align-middle h-[58px]"
                            >
                              {renderCellContent(teacher, cell)}
                            </td>
                          ))}
                          <td className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-1 bg-slate-50/60 dark:bg-slate-900/30"></td>
                          {dayRow.slice(4, 7).map((cell, pIdx) => (
                            <td
                              key={pIdx + 4}
                              className="border border-slate-700 dark:border-[#3b4e87] py-1.5 px-1 align-middle h-[58px]"
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

              {/* สรุปวิชาที่สอนและกิจกรรมด้านล่างตารางตามแบบใน PDF */}
              <div className="mt-3 pt-2.5 text-xs text-[#0f2150] dark:text-[#e9eefc]">
                <div className="flex items-center justify-between font-bold border-b border-[#c9d4ec] dark:border-[#2a3a6e] pb-1 mb-1.5">
                  <span>วิชาที่สอน / ชั้น [รวม]</span>
                  <span>รวม ({teacher.totalHours} ชม.)</span>
                </div>
                <div className="space-y-0.5 text-[#51608a] dark:text-[#9fb0dc]">
                  {teacher.coursesSummary.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                  <div className="pt-0.5 text-[#0f2150] dark:text-[#e9eefc] font-medium">
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
