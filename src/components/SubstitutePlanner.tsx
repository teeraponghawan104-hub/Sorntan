import React, { useRef, useState } from "react";
import {
  FileDown,
  FileText,
  Image as ImageIcon,
  RefreshCw,
  Table2,
  Printer,
} from "lucide-react";
import { SCHOOL_LOGO } from "../data/logo";
import {
  DAYS,
  DEPARTMENT_GROUPS,
  REGULAR_TEACHERS,
  STUDENT_TEACHERS,
} from "../data/teachers";
import {
  autoAssignSubstitutes,
  buildDocumentRows,
  formatRoomLabel,
  formatThaiDate,
  getCandidateTeachers,
  getDayIndex,
  getTeacherById,
  getTeacherClasses,
} from "../utils/scheduler";
import { exportSubstituteDocument } from "../utils/exportDoc";

interface SubstitutePlannerProps {
  selectedTeacherId: string;
  onChangeTeacherId: (id: string) => void;
  selectedDate: string;
  onChangeDate: (date: string) => void;
  reason: string;
  onChangeReason: (reason: string) => void;
  studentTeacherName: string;
  onChangeStudentTeacherName: (name: string) => void;
  assignments: Record<number, string>;
  onChangeAssignment: (periodIndex: number, value: string) => void;
  onResetAutoAssign: () => void;
  includeSupervision: boolean;
  onChangeIncludeSupervision: (inc: boolean) => void;
  onViewTeacherTimetable: (teacherId: number) => void;
}

const REASON_PRESETS = ["ไปราชการ", "อบรม/สัมมนา", "ลากิจ", "ลาป่วย", "คุมสอบ/นำนักเรียนแข่งขัน"];

export const SubstitutePlanner: React.FC<SubstitutePlannerProps> = ({
  selectedTeacherId,
  onChangeTeacherId,
  selectedDate,
  onChangeDate,
  reason,
  onChangeReason,
  studentTeacherName,
  onChangeStudentTeacherName,
  assignments,
  onChangeAssignment,
  onResetAutoAssign,
  includeSupervision,
  onChangeIncludeSupervision,
  onViewTeacherTimetable,
}) => {
  const paperRef = useRef<HTMLDivElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: "ok" | "err" | "info" | "" }>({
    text: "",
    type: "",
  });
  const [isExporting, setIsExporting] = useState(false);

  const absentTeacher = getTeacherById(selectedTeacherId);
  const dayIdx = getDayIndex(selectedDate);
  const classes = getTeacherClasses(selectedTeacherId, selectedDate, includeSupervision);
  const docRows = buildDocumentRows(
    selectedTeacherId,
    selectedDate,
    assignments,
    studentTeacherName,
    includeSupervision
  );

  const canExport = Boolean(
    absentTeacher && dayIdx >= 0 && docRows.length > 0 && docRows.every((r) => r.n !== "-")
  );

  // ปุ่มสลับวันจันทร์-ศุกร์ในสัปดาห์ของวันที่เลือก
  const jumpToWeekday = (targetDayIdx: number) => {
    const base = selectedDate ? new Date(selectedDate + "T00:00:00") : new Date();
    const currentDay = base.getDay(); // 0=Sun..6=Sat
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const targetDate = new Date(base.getFullYear(), base.getMonth(), base.getDate() + diffToMonday + targetDayIdx);
    const pad = (n: number) => String(n).padStart(2, "0");
    onChangeDate(
      `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-${pad(targetDate.getDate())}`
    );
  };

  const handleExport = async (format: "word" | "pdf" | "image") => {
    if (!absentTeacher || !canExport) return;
    try {
      setIsExporting(true);
      setStatusMsg({ text: "กำลังสร้างไฟล์เอกสาร...", type: "info" });
      await exportSubstituteDocument(
        format,
        absentTeacher,
        selectedDate,
        reason,
        docRows,
        paperRef.current
      );
      setStatusMsg({ text: "บันทึกไฟล์เรียบร้อยแล้ว", type: "ok" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMsg({ text: `สร้างไฟล์ไม่สำเร็จ: ${msg}`, type: "err" });
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const hasSupervisionSlots =
    absentTeacher && (absentTeacher.id === 100 || absentTeacher.id === 101);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5 items-start">
      {/* แผงตั้งค่าและจัดคาบสอนแทนด้านซ้าย */}
      <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-5 shadow-xs print:hidden">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-xl font-bold text-[#0f2150] dark:text-[#e9eefc]">
            จัดครูสอนแทน
          </h2>
          {absentTeacher && (
            <button
              type="button"
              onClick={() => onViewTeacherTimetable(absentTeacher.id)}
              className="text-sm font-semibold text-[#1b4fb8] dark:text-[#6c97ff] hover:underline flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Table2 className="w-4 h-4" />
              <span>ดูตารางสอนเต็ม</span>
            </button>
          )}
        </div>

        {/* เลือกครูที่ลา/ไปราชการ */}
        <label
          htmlFor="ta"
          className="block font-semibold text-[#0f2150] dark:text-[#e9eefc] mt-2 mb-1"
        >
          ครูที่ไม่สามารถสอนได้ (ครูประจำ 27 ท่าน · นศ.ฝึกสอน 4 ท่าน)
        </label>
        <select
          id="ta"
          value={selectedTeacherId}
          onChange={(e) => onChangeTeacherId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] font-medium focus:outline-2 focus:outline-[#f2c230]"
        >
          <option value="">— เลือกครูผู้สอน —</option>
          {DEPARTMENT_GROUPS.map((group) => {
            const groupTeachers = REGULAR_TEACHERS.filter((t) => t.g === group);
            if (groupTeachers.length === 0) return null;
            return (
              <optgroup key={group} label={`กลุ่มสาระ/งาน: ${group}`}>
                {groupTeachers.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.id} {t.n} ({t.pdfGroup} · {formatRoomLabel(t.r)})
                  </option>
                ))}
              </optgroup>
            );
          })}
          <optgroup label="นักศึกษาฝึกสอน (4 ท่าน)">
            {STUDENT_TEACHERS.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.id} {t.n} (นศ.ฝึกสอน · {t.pdfGroup} - {formatRoomLabel(t.r)})
              </option>
            ))}
          </optgroup>
        </select>

        {/* เลือกวันที่ */}
        <label
          htmlFor="dt"
          className="block font-semibold text-[#0f2150] dark:text-[#e9eefc] mt-3.5 mb-1"
        >
          วันที่สอนแทน
        </label>
        <input
          type="date"
          id="dt"
          value={selectedDate}
          onChange={(e) => onChangeDate(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] font-medium focus:outline-2 focus:outline-[#f2c230]"
        />

        {/* ปุ่มลัดเลือกวันจันทร์-ศุกร์ */}
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-xs text-[#51608a] dark:text-[#9fb0dc] shrink-0">
            เลือกวันในสัปดาห์:
          </span>
          {DAYS.map((dayName, idx) => (
            <button
              key={dayName}
              type="button"
              onClick={() => jumpToWeekday(idx)}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                dayIdx === idx
                  ? "bg-[#1b4fb8] text-white"
                  : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc] hover:bg-blue-200 dark:hover:bg-blue-900"
              }`}
            >
              {dayName}
            </button>
          ))}
        </div>

        {/* เหตุผล / ภารกิจ */}
        <label
          htmlFor="wy"
          className="block font-semibold text-[#0f2150] dark:text-[#e9eefc] mt-3.5 mb-1"
        >
          เหตุผล / ภารกิจ
        </label>
        <input
          type="text"
          id="wy"
          value={reason}
          onChange={(e) => onChangeReason(e.target.value)}
          placeholder="เช่น ไปราชการ, อบรม, ลากิจ"
          className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] focus:outline-2 focus:outline-[#f2c230]"
        />
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {REASON_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChangeReason(preset)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                reason === preset
                  ? "bg-[#1b4fb8] text-white"
                  : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#51608a] dark:text-[#9fb0dc] hover:text-[#0f2150]"
              }`}
            >
              {preset}
            </button>
          ))}
        </div>

        {/* รายชื่อนักศึกษาฝึกสอนในระบบ + ช่องระบุชื่อเพิ่มเติมกรณีอื่นๆ */}
        <div className="mt-3.5 p-2.5 rounded-lg bg-[#eaf0fa]/60 dark:bg-[#0b1330]/60 border border-[#c9d4ec] dark:border-[#2a3a6e] text-xs text-[#0f2150] dark:text-[#e9eefc]">
          <div className="font-semibold text-[#1b4fb8] dark:text-[#6c97ff] mb-1">
            นักศึกษาฝึกสอนในระบบ (เช็คตารางว่างรายคาบอัตโนมัติ):
          </div>
          <div className="grid grid-cols-1 gap-0.5 text-[#51608a] dark:text-[#9fb0dc]">
            {STUDENT_TEACHERS.map((st) => (
              <div key={st.id}>
                • <b>{st.id} {st.n}</b> ({st.pdfGroup} · {formatRoomLabel(st.r)})
              </div>
            ))}
          </div>
        </div>

        <label
          htmlFor="sn"
          className="block font-semibold text-[#0f2150] dark:text-[#e9eefc] mt-3 mb-1 text-sm"
        >
          ระบุชื่อนักศึกษาฝึกสอนท่านอื่นเพิ่มเติม (กรณีเลือก "นักศึกษาฝึกสอน (ระบุชื่อเอง)")
        </label>
        <input
          type="text"
          id="sn"
          value={studentTeacherName}
          onChange={(e) => onChangeStudentTeacherName(e.target.value)}
          placeholder="เช่น นายสมชาย ใจดี (กรณีไม่ได้อยู่ใน 4 รายชื่อข้างต้น)"
          className="w-full px-3 py-1.5 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] text-sm focus:outline-2 focus:outline-[#f2c230]"
        />

        {/* ตัวเลือกเสริมสำหรับฝ่ายบริหารที่มีคาบนิเทศสอน */}
        {hasSupervisionSlots && (
          <label className="flex items-center gap-2 mt-3 text-sm font-medium text-[#0f2150] dark:text-[#e9eefc] cursor-pointer">
            <input
              type="checkbox"
              checked={includeSupervision}
              onChange={(e) => onChangeIncludeSupervision(e.target.checked)}
              className="rounded border-[#c9d4ec] text-[#1b4fb8]"
            />
            <span>รวมคาบนิเทศสอนในใบมอบหมายงานด้วย</span>
          </label>
        )}

        {/* รายการคาบสอนที่ต้องจัดคนแทน */}
        <div id="plan" className="mt-4 pt-3 border-t border-[#c9d4ec] dark:border-[#2a3a6e]">
          {!absentTeacher ? (
            <p className="text-[#51608a] dark:text-[#9fb0dc] text-base">
              เลือกครูที่ไม่สามารถสอนได้ ระบบจะค้นหาคาบสอนและจัดครูสอนแทนที่ว่างในกลุ่มสาระเดียวกันให้อัตโนมัติ
            </p>
          ) : !selectedDate ? (
            <p className="text-[#51608a] dark:text-[#9fb0dc] text-base">
              กรุณาเลือกวันที่ต้องการจัดสอนแทน
            </p>
          ) : dayIdx < 0 ? (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60">
              <p className="text-[#b3261e] dark:text-[#ff8b82] font-semibold text-base">
                วันที่เลือกตรงกับวันเสาร์–อาทิตย์ ไม่มีคาบสอน กรุณาเลือกวันจันทร์–ศุกร์
              </p>
            </div>
          ) : classes.length === 0 ? (
            <div className="p-3 rounded-lg bg-[#eaf0fa]/60 dark:bg-[#0b1330]/60 border border-[#c9d4ec] dark:border-[#2a3a6e]">
              <p className="text-[#51608a] dark:text-[#9fb0dc] font-medium">
                <b>{absentTeacher.n}</b> ไม่มีคาบสอนวิชาปกติในวัน{DAYS[dayIdx]}
              </p>
              <p className="text-xs text-[#51608a] dark:text-[#9fb0dc] mt-1">
                สามารถกดเลือกวันอื่นในสัปดาห์ด้านบนเพื่อดูคาบสอนในวันอื่นได้ทันที
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-[#0f2150] dark:text-[#e9eefc]">
                  <span>{absentTeacher.n}</span> · มี {classes.length} คาบในวัน{DAYS[dayIdx]}
                </p>
              </div>

              {classes.map((slot) => {
                const candidates = getCandidateTeachers(absentTeacher.id, selectedDate, slot.p);
                const sameGroupRegular = candidates.filter(
                  (c) => !c.isStudentTeacher && c.g === absentTeacher.g
                );
                const freeStudentTeachers = candidates.filter((c) => c.isStudentTeacher);
                const otherGroupRegular = candidates.filter(
                  (c) => !c.isStudentTeacher && c.g !== absentTeacher.g
                );
                const noSameGroupRegular = sameGroupRegular.length === 0;

                return (
                  <div
                    key={slot.p}
                    className="border-t border-dashed border-[#c9d4ec] dark:border-[#2a3a6e] pt-2.5 grid gap-1.5"
                  >
                    <div className="flex items-center justify-between text-base">
                      <span>
                        <b>คาบที่ {slot.p + 1}</b> ({slot.tm}) ·{" "}
                        <span className="font-semibold text-[#1b4fb8] dark:text-[#6c97ff]">
                          {slot.code}
                        </span>{" "}
                        ชั้น <b>{slot.cls}</b>
                      </span>
                      <span className="text-xs text-[#51608a] dark:text-[#9fb0dc]">
                        {formatRoomLabel(slot.room)}
                      </span>
                    </div>

                    <select
                      data-p={slot.p}
                      aria-label={`ครูสอนแทนคาบ ${slot.p + 1}`}
                      value={assignments[slot.p] || "s"}
                      onChange={(e) => onChangeAssignment(slot.p, e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] text-base focus:outline-2 focus:outline-[#f2c230]"
                    >
                      {sameGroupRegular.length > 0 && (
                        <optgroup label={`★ ครูกลุ่มสาระเดียวกันที่ว่าง (${sameGroupRegular.length} ท่าน)`}>
                          {sameGroupRegular.map((t) => (
                            <option key={t.id} value={`t${t.id}`}>
                              ★ {t.id} {t.n} (กลุ่มสาระเดียวกัน · {t.pdfGroup})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {freeStudentTeachers.length > 0 && (
                        <optgroup label={`นักศึกษาฝึกสอนที่ว่างในคาบนี้ (${freeStudentTeachers.length} ท่าน)`}>
                          {freeStudentTeachers.map((t) => (
                            <option key={t.id} value={`t${t.id}`}>
                              {t.g === absentTeacher.g ? "★ " : ""}
                              {t.id} {t.n} (นศ.ฝึกสอน · {t.pdfGroup} - {formatRoomLabel(t.r)})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {otherGroupRegular.length > 0 && (
                        <optgroup label={`ครูต่างกลุ่มสาระที่ว่าง (${otherGroupRegular.length} ท่าน)`}>
                          {otherGroupRegular.map((t) => (
                            <option key={t.id} value={`t${t.id}`}>
                              {t.id} {t.n} ({t.pdfGroup})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="อื่นๆ">
                        <option value="s">
                          นักศึกษาฝึกสอน{studentTeacherName.trim() ? ` (${studentTeacherName.trim()})` : " (ระบุชื่อเอง)"}
                        </option>
                      </optgroup>
                    </select>

                    {noSameGroupRegular && (
                      <small className="text-xs text-amber-700 dark:text-amber-300">
                        ไม่มีครูประจำกลุ่มสาระ{absentTeacher.g}ว่างในคาบนี้{" "}
                        {freeStudentTeachers.length > 0
                          ? `(ระบบเลือกนักศึกษาฝึกสอนที่ว่างให้อัตโนมัติ หรือเลือกครูต่างกลุ่มสาระได้)`
                          : `(สามารถเลือกครูต่างกลุ่มสาระหรือระบุชื่อนักศึกษาฝึกสอนได้)`}
                      </small>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <button
            type="button"
            id="au"
            onClick={onResetAutoAssign}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#1b4fb8] dark:border-[#6c97ff] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-[#1b4fb8] hover:text-white font-semibold text-base transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>จัดอัตโนมัติใหม่</span>
          </button>
        </div>

        <p className="text-sm text-[#51608a] dark:text-[#9fb0dc] mt-3 mb-0 leading-relaxed">
          หลักการ: จัดครูประจำกลุ่มสาระเดียวกันที่ว่างก่อน (★) โดยเกลี่ยคาบให้สมดุล หากไม่มีครูในกลุ่มสาระว่าง ระบบจะจัดนักศึกษาฝึกสอนที่ว่างในคาบนั้น (205, 307, 308, 604) ให้อัตโนมัติ
        </p>
      </section>

      {/* แผงแสดงตัวอย่างเอกสารใบสอนแทน (A4) ด้านขวา */}
      <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3 print:hidden">
          <h2 className="text-xl font-bold text-[#0f2150] dark:text-[#e9eefc]">
            ตัวอย่างเอกสารใบสอนแทน
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              id="bw"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("word")}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-base transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileText className="w-4 h-4" />
              <span>ดาวน์โหลด Word</span>
            </button>
            <button
              type="button"
              id="bp"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("pdf")}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-base transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileDown className="w-4 h-4" />
              <span>ดาวน์โหลด PDF</span>
            </button>
            <button
              type="button"
              id="bi"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("image")}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#1b4fb8] dark:border-[#6c97ff] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-[#eaf0fa] dark:hover:bg-blue-950 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-base transition-colors cursor-pointer whitespace-nowrap"
            >
              <ImageIcon className="w-4 h-4" />
              <span>ดาวน์โหลดรูปภาพ</span>
            </button>
            <button
              type="button"
              disabled={!canExport || isExporting}
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#0f2150] dark:text-[#e9eefc] hover:bg-slate-100 dark:hover:bg-blue-950 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-base transition-colors cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              <span>พิมพ์</span>
            </button>
          </div>
        </div>

        {statusMsg.text && (
          <div
            id="msg"
            role="status"
            className={`mb-3 text-base font-semibold print:hidden ${
              statusMsg.type === "err"
                ? "text-[#b3261e] dark:text-[#ff8b82]"
                : statusMsg.type === "ok"
                ? "text-[#0b7a4b] dark:text-[#4fd39a]"
                : "text-[#1b4fb8] dark:text-[#6c97ff]"
            }`}
          >
            {statusMsg.text}
          </div>
        )}

        {/* กระดาษ A4 ตัวอย่างใบสอนแทน */}
        <div className="overflow-x-auto bg-slate-100 dark:bg-[#0b1330] p-3 md:p-5 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] print:p-0 print:bg-white print:border-0">
          <div
            id="paper"
            ref={paperRef}
            className="paper-sheet w-[794px] min-h-[1123px] bg-white text-black px-[44px] py-[48px] mx-auto shadow-md print:shadow-none text-[18px] leading-[1.35]"
          >
            {!absentTeacher || dayIdx < 0 || docRows.length === 0 ? (
              <div className="text-center mt-[200px] text-neutral-500">
                <img
                  src={SCHOOL_LOGO}
                  alt="ตราโรงเรียน"
                  referrerPolicy="no-referrer"
                  className="h-[84px] mx-auto mb-4 opacity-50"
                />
                <p className="text-[22px] font-semibold">
                  เลือกครูและวันที่ที่มีคาบสอน เพื่อแสดงตัวอย่างใบสอนแทน
                </p>
                <p className="text-[17px] mt-1">
                  โรงเรียนวรคุณอุปถัมภ์ · ภาคเรียนที่ 2 ปีการศึกษา 2569
                </p>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <img
                    src={SCHOOL_LOGO}
                    alt="ตราโรงเรียนวรคุณอุปถัมภ์"
                    referrerPolicy="no-referrer"
                    className="h-[92px] mx-auto mb-1"
                  />
                  <h3 className="my-0.5 text-[25px] font-bold">
                    โรงเรียนวรคุณอุปถัมภ์
                  </h3>
                  <h4 className="m-0 text-[20px] font-bold">
                    ตารางสอนแทน ภาคเรียนที่ 2 ปีการศึกษา 2569 กลุ่ม/ฝ่าย/งาน{" "}
                    {absentTeacher.pdfGroup}
                  </h4>
                </div>

                <p className="mt-4 mb-0 text-[17px]">
                  ครูผู้สอน {absentTeacher.id} {absentTeacher.n} &nbsp;&nbsp; วัน{DAYS[dayIdx]}ที่{" "}
                  {formatThaiDate(selectedDate)}
                </p>
                <p className="m-0 text-[17px]">
                  ไม่สามารถปฏิบัติการสอนได้เนื่องจาก {reason || "-"} จึงมอบหมายให้สอนแทนดังนี้
                </p>

                <table
                  style={{ borderCollapse: "collapse", tableLayout: "fixed" }}
                  className="w-full mt-4 text-[14px] border border-black"
                >
                  <colgroup>
                    <col style={{ width: "54px" }} />
                    <col style={{ width: "98px" }} />
                    <col style={{ width: "72px" }} />
                    <col style={{ width: "44px" }} />
                    <col style={{ width: "72px" }} />
                    <col style={{ width: "184px" }} />
                    <col style={{ width: "102px" }} />
                    <col style={{ width: "80px" }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-[#e8edf7] text-[14.5px]">
                      <th className="border border-black px-1.5 py-2 text-center font-bold whitespace-nowrap">
                        คาบที่
                      </th>
                      <th className="border border-black px-1.5 py-2 text-center font-bold whitespace-nowrap">
                        เวลา
                      </th>
                      <th className="border border-black px-1.5 py-2 text-center font-bold whitespace-nowrap">
                        รหัสวิชา
                      </th>
                      <th className="border border-black px-1 py-2 text-center font-bold whitespace-nowrap">
                        ชั้น
                      </th>
                      <th className="border border-black px-1.5 py-2 text-center font-bold whitespace-nowrap">
                        ห้องเรียน
                      </th>
                      <th className="border border-black px-2 py-2 text-center font-bold whitespace-nowrap">
                        ผู้สอนแทน
                      </th>
                      <th className="border border-black px-1.5 py-2 text-center font-bold whitespace-nowrap">
                        กลุ่มสาระ
                      </th>
                      <th className="border border-black px-1.5 py-2 text-center font-bold whitespace-nowrap">
                        ลายมือชื่อ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {docRows.map((row) => (
                      <tr key={row.p} className="align-middle">
                        <td className="border border-black px-1.5 py-2 text-center whitespace-nowrap">
                          {row.p}
                        </td>
                        <td className="border border-black px-1.5 py-2 text-center whitespace-nowrap">
                          {row.tm}
                        </td>
                        <td className="border border-black px-1.5 py-2 text-center whitespace-nowrap">
                          {row.code}
                        </td>
                        <td className="border border-black px-1 py-2 text-center whitespace-nowrap">
                          {row.cls}
                        </td>
                        <td className="border border-black px-1.5 py-2 text-center whitespace-nowrap">
                          {row.room}
                        </td>
                        <td className="border border-black px-2.5 py-2 text-left leading-snug">
                          {row.n}
                        </td>
                        <td className="border border-black px-1.5 py-2 text-center leading-snug whitespace-nowrap">
                          {row.g}
                        </td>
                        <td className="border border-black px-1.5 py-2 text-center"></td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="grid grid-cols-3 gap-4 mt-14 text-[15.5px] text-center">
                  <div className="whitespace-nowrap">
                    <div>ลงชื่อ................................................</div>
                    <div className="mt-1 pl-6">(................................................)</div>
                    <div className="mt-1 pl-3 font-medium">ผู้สอนแทน</div>
                  </div>
                  <div className="whitespace-nowrap">
                    <div>ลงชื่อ................................................</div>
                    <div className="mt-1 pl-6">(................................................)</div>
                    <div className="mt-1 pl-3 font-medium">ผู้ช่วยฯฝ่ายวิชาการ</div>
                  </div>
                  <div className="whitespace-nowrap">
                    <div>ลงชื่อ................................................</div>
                    <div className="mt-1 pl-6">(................................................)</div>
                    <div className="mt-1 pl-3 font-medium">ผู้อำนวยการ</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
