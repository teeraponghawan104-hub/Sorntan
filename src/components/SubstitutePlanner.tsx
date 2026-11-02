import React, { useEffect, useRef, useState } from "react";
import {
  FileDown,
  FileText,
  Image as ImageIcon,
  RefreshCw,
  Table2,
  Printer,
  Save,
  Database,
  Trash2,
  FolderOpen,
  Maximize2,
  X,
} from "lucide-react";
import { SCHOOL_LOGO } from "../data/logo";
import { DAYS, DEPARTMENT_GROUPS, TeacherRecord } from "../data/teachers";
import {
  buildDocumentRows,
  formatRoomLabel,
  formatThaiDate,
  getCandidateTeachers,
  getDayIndex,
  getTeacherById,
  getTeacherClasses,
} from "../utils/scheduler";
import { exportSubstituteDocument, renderPaperToCanvas } from "../utils/exportDoc";
import { SavedSubstituteRecord } from "../utils/databaseStore";

interface SubstitutePlannerProps {
  teachers: TeacherRecord[];
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
  savedRecords: SavedSubstituteRecord[];
  onSaveCurrentRecord: () => Promise<void>;
  onLoadSavedRecord: (record: SavedSubstituteRecord) => void;
  onDeleteSavedRecord: (recordId: string) => Promise<void>;
  onOpenDatabaseTab: () => void;
}

const REASON_PRESETS = ["ไปราชการ", "อบรม/สัมมนา", "ลากิจ", "ลาป่วย", "คุมสอบ/นำนักเรียนแข่งขัน"];

export const SubstitutePlanner: React.FC<SubstitutePlannerProps> = ({
  teachers,
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
  savedRecords,
  onSaveCurrentRecord,
  onLoadSavedRecord,
  onDeleteSavedRecord,
  onOpenDatabaseTab,
}) => {
  const paperRef = useRef<HTMLDivElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: "ok" | "err" | "info" | "" }>({
    text: "",
    type: "",
  });
  const [isExporting, setIsExporting] = useState(false);
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string>("");
  const [fontReadyTick, setFontReadyTick] = useState<number>(0);
  const [fullscreenImageOpen, setFullscreenImageOpen] = useState<boolean>(false);

  const regularTeachers = teachers.filter((t) => !t.isStudentTeacher);
  const studentTeachers = teachers.filter((t) => Boolean(t.isStudentTeacher));

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

  // เมื่อฟอนต์ภาษาไทยโหลดเสร็จบน iOS Safari / Messenger WebView ให้สั่งวาด Canvas ใหม่อีกครั้งเพื่อให้ฟอนต์คมชัด 100%
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    const handleFontLoaded = () => {
      setFontReadyTick((t) => t + 1);
    };
    document.fonts.ready.then(handleFontLoaded).catch(() => {});
    document.fonts.addEventListener?.("loadingdone", handleFontLoaded);
    return () => {
      document.fonts.removeEventListener?.("loadingdone", handleFontLoaded);
    };
  }, []);

  // วาดภาพตัวอย่าง A4 ความละเอียดสูงจาก Canvas 2D โดยตรง เพื่อให้แสดงผลเหมือนกัน 100% บนทุกอุปกรณ์และทุกขนาดหน้าจอ
  useEffect(() => {
    let cancelled = false;
    if (!absentTeacher || dayIdx < 0 || docRows.length === 0) {
      setPreviewDataUrl("");
      return;
    }
    renderPaperToCanvas(absentTeacher, selectedDate, reason, docRows)
      .then((canvas) => {
        if (!cancelled) {
          setPreviewDataUrl(canvas.toDataURL("image/png"));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewDataUrl("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    absentTeacher,
    dayIdx,
    selectedDate,
    reason,
    JSON.stringify(docRows),
    teachers,
    fontReadyTick,
  ]);

  // ปุ่มสลับวันจันทร์-ศุกร์ในสัปดาห์ของวันที่เลือก
  const jumpToWeekday = (targetDayIdx: number) => {
    const base = selectedDate ? new Date(selectedDate + "T00:00:00") : new Date();
    const currentDay = base.getDay(); // 0=Sun..6=Sat
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const targetDate = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + diffToMonday + targetDayIdx
    );
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
      setStatusMsg({ text: "บันทึก/แชร์ไฟล์เรียบร้อยแล้ว", type: "ok" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMsg({ text: `สร้างไฟล์ไม่สำเร็จ: ${msg}`, type: "err" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveToDatabase = async () => {
    if (!absentTeacher || !canExport) return;
    try {
      setIsSavingRecord(true);
      await onSaveCurrentRecord();
      setStatusMsg({
        text: `บันทึกใบสอนแทนของ ${absentTeacher.n} (${formatThaiDate(selectedDate)}) ลงฐานข้อมูลเรียบร้อยแล้ว`,
        type: "ok",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMsg({ text: `บันทึกลงฐานข้อมูลไม่สำเร็จ: ${msg}`, type: "err" });
    } finally {
      setIsSavingRecord(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const hasSupervisionSlots =
    absentTeacher && (absentTeacher.id === 100 || absentTeacher.id === 101);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4 sm:gap-5 items-start w-full">
      {/* แผงตั้งค่าและจัดคาบสอนแทนด้านซ้าย */}
      <section className="min-w-0 w-full bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs print:hidden">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 className="text-xl font-bold text-[#0f2150] dark:text-[#e9eefc]">
            จัดครูสอนแทน
          </h2>
          <div className="flex items-center gap-2.5">
            {absentTeacher && (
              <button
                type="button"
                onClick={() => onViewTeacherTimetable(absentTeacher.id)}
                className="text-xs sm:text-sm font-semibold text-[#1b4fb8] dark:text-[#6c97ff] hover:underline flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Table2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span>ดูตารางสอนเต็ม</span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenDatabaseTab}
              className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[#eaf0fa] dark:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-blue-200 dark:hover:bg-blue-950 flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Database className="w-3.5 h-3.5" />
              <span>เพิ่ม/ลบข้อมูล</span>
            </button>
          </div>
        </div>

        {/* เลือกครูที่ลา/ไปราชการ */}
        <label
          htmlFor="ta"
          className="block font-semibold text-[#0f2150] dark:text-[#e9eefc] mt-2 mb-1"
        >
          ครูที่ไม่สามารถสอนได้ (ครูประจำ {regularTeachers.length} ท่าน · นศ.ฝึกสอน{" "}
          {studentTeachers.length} ท่าน)
        </label>
        <select
          id="ta"
          value={selectedTeacherId}
          onChange={(e) => onChangeTeacherId(e.target.value)}
          className="w-full max-w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] font-medium focus:outline-2 focus:outline-[#f2c230]"
        >
          <option value="">— เลือกครูผู้สอน —</option>
          {DEPARTMENT_GROUPS.map((group) => {
            const groupTeachers = regularTeachers.filter((t) => t.g === group);
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
          {studentTeachers.length > 0 && (
            <optgroup label={`นักศึกษาฝึกสอน (${studentTeachers.length} ท่าน)`}>
              {studentTeachers.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.id} {t.n} (นศ.ฝึกสอน · {t.pdfGroup} - {formatRoomLabel(t.r)})
                </option>
              ))}
            </optgroup>
          )}
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
          className="block w-full max-w-full min-w-0 appearance-none px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] font-medium focus:outline-2 focus:outline-[#f2c230]"
        />

        {/* ปุ่มลัดเลือกวันจันทร์-ศุกร์ (จัดเรียง 5 ช่องเท่ากันในแถวเดียว ไม่ตกบรรทัดบนมือถือ) */}
        <div className="grid grid-cols-5 gap-1.5 mt-2">
          {DAYS.map((dayName, idx) => (
            <button
              key={dayName}
              type="button"
              onClick={() => jumpToWeekday(idx)}
              className={`py-1.5 px-1 rounded-md text-xs font-semibold text-center transition-colors cursor-pointer whitespace-nowrap ${
                dayIdx === idx
                  ? "bg-[#1b4fb8] text-white shadow-2xs"
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
            {studentTeachers.map((st) => (
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
          placeholder="เช่น นายสมชาย ใจดี (กรณีไม่ได้อยู่ในรายชื่อข้างต้น)"
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
                    <div className="flex items-center justify-between gap-2 text-sm sm:text-base">
                      <span className="min-w-0">
                        <b>คาบที่ {slot.p + 1}</b> ({slot.tm}) ·{" "}
                        <span className="font-semibold text-[#1b4fb8] dark:text-[#6c97ff]">
                          {slot.code}
                        </span>{" "}
                        ชั้น <b>{slot.cls}</b>
                      </span>
                      <span className="text-xs text-[#51608a] dark:text-[#9fb0dc] whitespace-nowrap shrink-0">
                        {formatRoomLabel(slot.room)}
                      </span>
                    </div>

                    <select
                      data-p={slot.p}
                      aria-label={`ครูสอนแทนคาบ ${slot.p + 1}`}
                      value={assignments[slot.p] || "s"}
                      onChange={(e) => onChangeAssignment(slot.p, e.target.value)}
                      className="w-full max-w-full px-2.5 py-1.5 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] text-sm sm:text-base focus:outline-2 focus:outline-[#f2c230]"
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
                          นักศึกษาฝึกสอน
                          {studentTeacherName.trim()
                            ? ` (${studentTeacherName.trim()})`
                            : " (ระบุชื่อเอง)"}
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

        {/* ปุ่มจัดอัตโนมัติใหม่ & บันทึกใบสอนแทนลงฐานข้อมูล */}
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            type="button"
            id="au"
            onClick={onResetAutoAssign}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#1b4fb8] dark:border-[#6c97ff] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-[#1b4fb8] hover:text-white font-semibold text-sm sm:text-base transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 shrink-0" />
            <span>จัดอัตโนมัติใหม่</span>
          </button>

          <button
            type="button"
            disabled={!canExport || isSavingRecord}
            onClick={handleSaveToDatabase}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0b7a4b] hover:bg-[#085c38] disabled:opacity-40 text-white font-semibold text-sm sm:text-base transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4 shrink-0" />
            <span>{isSavingRecord ? "กำลังบันทึก..." : "บันทึกใบสอนแทน"}</span>
          </button>
        </div>

        {/* รายการใบสอนแทนที่บันทึกไว้ล่าสุด */}
        {savedRecords.length > 0 && (
          <div className="mt-4 pt-3 border-t border-[#c9d4ec] dark:border-[#2a3a6e]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[#0f2150] dark:text-[#e9eefc]">
                ใบสอนแทนที่บันทึกไว้ในฐานข้อมูล ({savedRecords.length})
              </span>
              <button
                type="button"
                onClick={onOpenDatabaseTab}
                className="text-xs font-semibold text-[#1b4fb8] dark:text-[#6c97ff] hover:underline cursor-pointer"
              >
                จัดการทั้งหมด
              </button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {savedRecords.slice(0, 5).map((rec) => (
                <div
                  key={rec.recordId}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#eaf0fa]/60 dark:bg-[#0b1330]/60 border border-[#c9d4ec] dark:border-[#2a3a6e] text-xs"
                >
                  <div className="min-w-0 truncate">
                    <span className="font-bold text-[#0f2150] dark:text-[#e9eefc]">
                      {rec.absentTeacherId} {rec.absentTeacherName}
                    </span>{" "}
                    <span className="text-[#51608a] dark:text-[#9fb0dc]">
                      · {formatThaiDate(rec.selectedDate)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onLoadSavedRecord(rec)}
                      title="โหลดมาแก้ไข"
                      className="px-2 py-1 rounded bg-[#1b4fb8] text-white font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <FolderOpen className="w-3 h-3" />
                      <span>เปิด</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedRecord(rec.recordId)}
                      title="ลบใบสอนแทนนี้"
                      className="p-1 rounded text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-sm text-[#51608a] dark:text-[#9fb0dc] mt-3 mb-0 leading-relaxed">
          หลักการ: จัดครูประจำกลุ่มสาระเดียวกันที่ว่างก่อน (★) โดยเกลี่ยคาบให้สมดุล หากไม่มีครูในกลุ่มสาระว่าง ระบบจะจัดนักศึกษาฝึกสอนที่ว่างในคาบนั้นให้อัตโนมัติ
        </p>
      </section>

      {/* แผงแสดงตัวอย่างเอกสารใบสอนแทน (A4) ด้านขวา */}
      <section className="min-w-0 w-full bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 print:hidden">
          <h2 className="text-xl font-bold text-[#0f2150] dark:text-[#e9eefc]">
            ตัวอย่างเอกสารใบสอนแทน
          </h2>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            <button
              type="button"
              id="bw"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("word")}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm sm:text-base transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span>ดาวน์โหลด Word</span>
            </button>
            <button
              type="button"
              id="bp"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("pdf")}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm sm:text-base transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileDown className="w-4 h-4 shrink-0" />
              <span>ดาวน์โหลด PDF</span>
            </button>
            <button
              type="button"
              id="bi"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("image")}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#1b4fb8] dark:border-[#6c97ff] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-[#eaf0fa] dark:hover:bg-blue-950 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-sm sm:text-base transition-colors cursor-pointer whitespace-nowrap"
            >
              <ImageIcon className="w-4 h-4 shrink-0" />
              <span>ดาวน์โหลดรูปภาพ</span>
            </button>
            <button
              type="button"
              disabled={!canExport || isExporting}
              onClick={handlePrint}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#0f2150] dark:text-[#e9eefc] hover:bg-slate-100 dark:hover:bg-blue-950 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-sm sm:text-base transition-colors cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span>พิมพ์</span>
            </button>
          </div>
        </div>

        {/* คำแนะนำสำหรับผู้ใช้ iPhone / iPad หรือเปิดผ่านแอป Messenger / LINE */}
        {previewDataUrl && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#eaf0fa]/80 dark:bg-[#0b1330] border border-[#c9d4ec] dark:border-[#2a3a6e] text-xs text-[#0f2150] dark:text-[#e9eefc] print:hidden">
            <span>
              💡 <b>สำหรับ iPhone / iPad (iOS):</b> สามารถกดปุ่มดาวน์โหลดเพื่อแชร์/บันทึกไฟล์ หรือ{" "}
              <b>กดค้างที่รูปใบสอนแทนด้านล่าง</b> เพื่อเลือก &ldquo;บันทึกรูปภาพ&rdquo; ลงเครื่องได้โดยตรง
            </span>
            <button
              type="button"
              onClick={() => setFullscreenImageOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#1b4fb8] text-white font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>ขยายเต็มจอ</span>
            </button>
          </div>
        )}

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

        {/* กระดาษ A4 ตัวอย่างใบสอนแทน (ปรับย่อ-ขยายอัตโนมัติทุกขนาดหน้าจอ ไม่เพี้ยนทุกเครื่อง) */}
        <div className="bg-slate-100 dark:bg-[#0b1330] p-2 sm:p-4 md:p-5 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] print:p-0 print:bg-white print:border-0">
          <div
            id="paper"
            ref={paperRef}
            className="paper-sheet w-full max-w-[794px] bg-white text-black mx-auto shadow-md print:shadow-none relative overflow-hidden"
          >
            {!absentTeacher || dayIdx < 0 || docRows.length === 0 ? (
              <div className="text-center py-36 px-6 text-neutral-500 min-h-[640px] flex flex-col items-center justify-center">
                <img
                  src={SCHOOL_LOGO}
                  alt="ตราโรงเรียน"
                  referrerPolicy="no-referrer"
                  className="h-[84px] mx-auto mb-4 opacity-50"
                />
                <p className="text-xl font-semibold">
                  เลือกครูและวันที่ที่มีคาบสอน เพื่อแสดงตัวอย่างใบสอนแทน
                </p>
                <p className="text-base mt-1">
                  โรงเรียนวรคุณอุปถัมภ์ · ภาคเรียนที่ 2 ปีการศึกษา 2569
                </p>
              </div>
            ) : (
              <>
                {previewDataUrl && (
                  <img
                    src={previewDataUrl}
                    alt="ตัวอย่างเอกสารใบสอนแทน A4 โรงเรียนวรคุณอุปถัมภ์"
                    className="w-full h-auto block"
                  />
                )}
                {/* โครงสร้างตาราง Semantic สำหรับ Screen Reader และการค้นหาข้อความ */}
                <div
                  className={
                    previewDataUrl
                      ? "sr-only"
                      : "px-[44px] py-[48px] text-[18px] leading-[1.35]"
                  }
                >
                  <div className="text-center">
                    <h3>โรงเรียนวรคุณอุปถัมภ์</h3>
                    <h4>
                      ตารางสอนแทน ภาคเรียนที่ 2 ปีการศึกษา 2569 กลุ่ม/ฝ่าย/งาน{" "}
                      {absentTeacher.pdfGroup}
                    </h4>
                  </div>
                  <p>
                    ครูผู้สอน {absentTeacher.id} {absentTeacher.n} วัน{DAYS[dayIdx]}ที่{" "}
                    {formatThaiDate(selectedDate)}
                  </p>
                  <p>
                    ไม่สามารถปฏิบัติการสอนได้เนื่องจาก {reason || "-"} จึงมอบหมายให้สอนแทนดังนี้
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>คาบที่</th>
                        <th>เวลา</th>
                        <th>รหัสวิชา</th>
                        <th>ชั้น</th>
                        <th>ห้องเรียน</th>
                        <th>ผู้สอนแทน</th>
                        <th>กลุ่มสาระ</th>
                        <th>ลายมือชื่อ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docRows.map((row) => (
                        <tr key={row.p}>
                          <td>{row.p}</td>
                          <td>{row.tm}</td>
                          <td>{row.code}</td>
                          <td>{row.cls}</td>
                          <td>{row.room}</td>
                          <td>{row.n}</td>
                          <td>{row.g}</td>
                          <td></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* หน้าต่างขยายดูใบสอนแทนเต็มจอสำหรับ iOS / มือถือ (กดค้างที่รูปเพื่อบันทึกภาพได้ทันที) */}
      {fullscreenImageOpen && previewDataUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-3 sm:p-6 overflow-y-auto"
        >
          <div className="w-full max-w-[794px] flex items-center justify-between gap-2 mb-3 text-white">
            <span className="text-xs sm:text-sm font-semibold">
              กดค้างที่รูปภาพใบสอนแทนเพื่อเลือก &ldquo;บันทึกรูปภาพ (Save to Photos)&rdquo; บน iPhone
            </span>
            <button
              type="button"
              onClick={() => setFullscreenImageOpen(false)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs sm:text-sm font-bold cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
              <span>ปิด</span>
            </button>
          </div>
          <div className="w-full max-w-[794px] bg-white rounded-lg overflow-hidden shadow-2xl">
            <img
              src={previewDataUrl}
              alt="ใบสอนแทนเต็มจอ"
              className="w-full h-auto block"
            />
          </div>
        </div>
      )}
    </div>
  );
};
