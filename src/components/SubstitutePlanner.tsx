import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FileDown,
  FileText,
  Image as ImageIcon,
  RefreshCw,
  Table2,
  Save,
  Database,
  Trash2,
  FolderOpen,
  Maximize2,
  X,
  UserPlus,
  Copy,
  Check,
} from "lucide-react";
import { DAYS, DEPARTMENT_GROUPS, TeacherRecord } from "../data/teachers";
import {
  buildCombinedDocumentRows,
  buildCombinedTeacherHeader,
  computeSubstituteStatistics,
  doesTeacherTeachExactClass,
  doesTeacherTeachGrade,
  doesTeacherTeachPrevPeriodExactClass,
  extractGradeLevel,
  formatClassLevelLabel,
  formatCleanSubstituteName,
  formatLineNotificationMessage,
  formatRoomLabel,
  formatShortThaiDate,
  formatTeacherGradesSummary,
  formatThaiDate,
  formatThaiMonthYearHeader,
  getCandidateTeachers,
  getCombinedTeacherClasses,
  getContinuousPeriodInfo,
  getDayIndex,
  getSlotAssignment,
  getStudentTeacherCoveredClasses,
  getSubjectNameFromCourse,
  getTeacherById,
  getTeacherClasses,
  isTeacherExemptFromNeedingSubstitute,
  resolveTeacherReason,
} from "../utils/scheduler";
import {
  LEFT_SCHOOL_LOGO_URL,
  RIGHT_OBEC_LOGO_URL,
  chunkSubstituteRows,
  ensureSarabunFontLoaded,
  exportSingleSubstitutePageImage,
  exportSubstituteDocument,
  renderPaperPagesToCanvases,
  renderPaperToCanvas,
} from "../utils/exportDoc";
import {
  AcademicSettings,
  DEFAULT_ACADEMIC_SETTINGS,
  SavedSubstituteRecord,
} from "../utils/databaseStore";
import { adjustDateToAcademicYear } from "../utils/scheduler";

interface SubstitutePlannerProps {
  teachers: TeacherRecord[];
  academicSettings?: AcademicSettings;
  absentTeacherIds: string[];
  onChangePrimaryTeacherId: (id: string) => void;
  onAddAbsentTeacher: (teacherId?: string) => void;
  onRemoveAbsentTeacher: (teacherId: string) => void;
  selectedDate: string;
  onChangeDate: (date: string) => void;
  reason: string;
  onChangeReason: (reason: string) => void;
  teacherReasons?: Record<string, string>;
  onChangeTeacherReason?: (teacherId: string, reason: string) => void;
  studentTeacherName: string;
  onChangeStudentTeacherName: (name: string) => void;
  assignments: Record<string, string>;
  onChangeAssignment: (slotKey: string, periodIndex: number, value: string) => void;
  onResetAutoAssign: () => void;
  includeSupervision: boolean;
  onChangeIncludeSupervision: (inc: boolean) => void;
  onViewTeacherTimetable: (teacherIdOrIds: number | number[]) => void;
  savedRecords: SavedSubstituteRecord[];
  onSaveCurrentRecord: () => Promise<void>;
  onLoadSavedRecord: (record: SavedSubstituteRecord) => void;
  onDeleteSavedRecord: (recordId: string) => Promise<void>;
  onOpenDatabaseTab: () => void;
}

const REASON_PRESETS = ["ไปราชการ", "อบรม/สัมมนา", "ลากิจ", "ลาป่วย", "คุมสอบ/นำนักเรียนแข่งขัน"];

export const SubstitutePlanner: React.FC<SubstitutePlannerProps> = ({
  teachers,
  academicSettings = DEFAULT_ACADEMIC_SETTINGS,
  absentTeacherIds,
  onChangePrimaryTeacherId,
  onAddAbsentTeacher,
  onRemoveAbsentTeacher,
  selectedDate,
  onChangeDate,
  reason,
  onChangeReason,
  teacherReasons = {},
  onChangeTeacherReason,
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
  const lastRenderedKeyRef = useRef<string>("");
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: "ok" | "err" | "info" | "" }>({
    text: "",
    type: "",
  });
  const [isExporting, setIsExporting] = useState(false);
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [copiedLine, setCopiedLine] = useState(false);
  const [previewPages, setPreviewPages] = useState<string[]>([]);
  const previewDataUrl = previewPages[0] || "";
  const [fontReadyTick, setFontReadyTick] = useState<number>(0);
  const [fullscreenImageOpen, setFullscreenImageOpen] = useState<boolean>(false);
  const [, setAddingTeacherPickerOpen] = useState<boolean>(false);

  // สถิติการสอนแทนสะสมของครูแต่ละท่านจากประวัติที่บันทึกไว้
  const substituteStats = useMemo(
    () => computeSubstituteStatistics(savedRecords, teachers),
    [savedRecords, teachers]
  );

  const getSubCountSuffix = (teacherId: number) => {
    const cnt = substituteStats.byTeacherId[teacherId]?.substitutedPeriods || 0;
    return cnt > 0 ? ` · สอนแทนสะสม ${cnt} คาบ` : "";
  };

  // ไม่รวมครูที่ได้รับการยกเว้นไม่ต้องจัดสอนแทนให้ (302 ครูรณสิทธิ์ ประดับศรี)
  const regularTeachers = useMemo(
    () =>
      teachers.filter(
        (t) => !t.isStudentTeacher && !isTeacherExemptFromNeedingSubstitute(t)
      ),
    [teachers]
  );
  const studentTeachers = useMemo(
    () =>
      teachers.filter(
        (t) => Boolean(t.isStudentTeacher) && !isTeacherExemptFromNeedingSubstitute(t)
      ),
    [teachers]
  );

  const cleanAbsentIds = useMemo(
    () => absentTeacherIds.filter((id) => !isTeacherExemptFromNeedingSubstitute(id)),
    [absentTeacherIds]
  );
  const primaryTeacherId = cleanAbsentIds[0] || "";
  const primaryTeacher = getTeacherById(primaryTeacherId);

  // รายชื่อครูที่ลาทุกคนที่เลือกไว้ในตารางเดียวกัน
  const selectedAbsentTeachers: TeacherRecord[] = useMemo(
    () =>
      cleanAbsentIds
        .map((id) => getTeacherById(id))
        .filter((t): t is TeacherRecord => Boolean(t)),
    [cleanAbsentIds, teachers]
  );

  const allAbsentNumericIds = useMemo(
    () => selectedAbsentTeachers.map((t) => t.id),
    [selectedAbsentTeachers]
  );

  // หัวกระดาษรวมรายชื่อครูที่ลาทุกคนในตารางเดียวกัน (Memoized เพื่อไม่ให้สร้าง Object ใหม่ทุกครั้งที่ re-render)
  const combinedHeaderTeacher = useMemo(
    () => buildCombinedTeacherHeader(absentTeacherIds),
    [absentTeacherIds, teachers]
  );

  const dayIdx = getDayIndex(selectedDate);
  const combinedClasses = useMemo(
    () =>
      getCombinedTeacherClasses(
        absentTeacherIds,
        selectedDate,
        includeSupervision
      ),
    [absentTeacherIds, selectedDate, includeSupervision, teachers]
  );
  const studentCoveredClasses = useMemo(
    () => getStudentTeacherCoveredClasses(absentTeacherIds, selectedDate),
    [absentTeacherIds, selectedDate, teachers]
  );
  const docRows = useMemo(
    () =>
      buildCombinedDocumentRows(
        absentTeacherIds,
        selectedDate,
        assignments,
        studentTeacherName,
        includeSupervision,
        reason,
        teacherReasons
      ),
    [
      absentTeacherIds,
      selectedDate,
      assignments,
      studentTeacherName,
      includeSupervision,
      reason,
      teacherReasons,
      teachers,
    ]
  );

  const canExport = Boolean(
    combinedHeaderTeacher &&
      dayIdx >= 0 &&
      docRows.length > 0 &&
      docRows.every((r) => r.n !== "-")
  );

  // ตรวจสอบว่าปี พ.ศ. ของวันที่เลือก ตรงกับปีการศึกษาที่ตั้งค่าไว้ในฐานข้อมูลหรือไม่
  const selectedDateBuddhistYear = (() => {
    if (!selectedDate) return "";
    const dt = new Date(selectedDate + "T00:00:00");
    if (isNaN(dt.getTime())) return "";
    return String(dt.getFullYear() + 543);
  })();

  // โหลดฟอนต์ราชการ THSarabunNewWeb เพียงครั้งเดียวตอนเปิดหน้า ไม่ใช้ event listener ซ้ำซ้อน
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let mounted = true;
    ensureSarabunFontLoaded()
      .then(() => {
        if (mounted) setFontReadyTick(1);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const previewRenderKey = useMemo(() => {
    if (!combinedHeaderTeacher || dayIdx < 0 || docRows.length === 0) return "";
    return JSON.stringify({
      id: combinedHeaderTeacher.id,
      n: combinedHeaderTeacher.n,
      g: combinedHeaderTeacher.g,
      pdfGroup: combinedHeaderTeacher.pdfGroup,
      selectedDate,
      reason,
      teacherReasons,
      rows: docRows,
      fontReadyTick,
      plannerName: academicSettings.plannerName,
      plannerPosition: academicSettings.plannerPosition,
      approverName: academicSettings.approverName,
      approverPosition: academicSettings.approverPosition,
    });
  }, [
    combinedHeaderTeacher,
    dayIdx,
    selectedDate,
    reason,
    teacherReasons,
    docRows,
    fontReadyTick,
    academicSettings.plannerName,
    academicSettings.plannerPosition,
    academicSettings.approverName,
    academicSettings.approverPosition,
  ]);

  // วาดภาพตัวอย่าง A4 จาก Canvas 2D โดยป้องกันการวาดซ้ำ (Deduplicated + Debounced)
  useEffect(() => {
    if (!previewRenderKey || !combinedHeaderTeacher || dayIdx < 0 || docRows.length === 0) {
      lastRenderedKeyRef.current = "";
      setPreviewPages((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    if (previewRenderKey === lastRenderedKeyRef.current) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      renderPaperPagesToCanvases(combinedHeaderTeacher, selectedDate, reason, docRows, 1.35)
        .then((canvases) => {
          if (!cancelled) {
            lastRenderedKeyRef.current = previewRenderKey;
            setPreviewPages(canvases.map((c) => c.toDataURL("image/jpeg", 0.92)));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPreviewPages((prev) => (prev.length === 0 ? prev : []));
          }
        });
    }, 60);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewRenderKey, combinedHeaderTeacher, dayIdx, selectedDate, reason, docRows]);

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
    if (!combinedHeaderTeacher || !canExport) return;
    try {
      setIsExporting(true);
      const isMultiPageImage = format === "image" && previewPages.length > 1;
      setStatusMsg({
        text: isMultiPageImage
          ? `กำลังสร้างและดาวน์โหลดรูปภาพครบทั้ง ${previewPages.length} หน้า...`
          : "กำลังสร้างไฟล์เอกสาร...",
        type: "info",
      });
      await exportSubstituteDocument(
        format,
        combinedHeaderTeacher,
        selectedDate,
        reason,
        docRows,
        paperRef.current
      );
      if (isMultiPageImage) {
        setStatusMsg({
          text: `ดาวน์โหลดรูปภาพครบทั้ง ${previewPages.length} หน้าเรียบร้อยแล้ว`,
          type: "ok",
        });
      } else {
        setStatusMsg({ text: "บันทึก/ดาวน์โหลดไฟล์เรียบร้อยแล้ว", type: "ok",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMsg({ text: `สร้างไฟล์ไม่สำเร็จ: ${msg}`, type: "err" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadSinglePage = async (pageIdx: number) => {
    if (!combinedHeaderTeacher || !canExport) return;
    try {
      setIsExporting(true);
      setStatusMsg({
        text: `กำลังสร้างรูปภาพหน้า ${pageIdx + 1}...`,
        type: "info",
      });
      await exportSingleSubstitutePageImage(
        combinedHeaderTeacher,
        selectedDate,
        reason,
        docRows,
        pageIdx
      );
      setStatusMsg({
        text: `ดาวน์โหลดรูปภาพหน้า ${pageIdx + 1} เรียบร้อยแล้ว`,
        type: "ok",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMsg({ text: `ดาวน์โหลดไม่สำเร็จ: ${msg}`, type: "err" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveToDatabase = async () => {
    if (!combinedHeaderTeacher || !canExport) return;
    try {
      setIsSavingRecord(true);
      await onSaveCurrentRecord();
      const label =
        selectedAbsentTeachers.length > 1
          ? `รวม ${selectedAbsentTeachers.length} ท่าน (${selectedAbsentTeachers
              .map((t) => t.n)
              .join(", ")})`
          : combinedHeaderTeacher.n;
      setStatusMsg({
        text: `บันทึกใบสอนแทนของ ${label} (${formatThaiDate(selectedDate)}) ลงฐานข้อมูลเรียบร้อยแล้ว`,
        type: "ok",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMsg({ text: `บันทึกลงฐานข้อมูลไม่สำเร็จ: ${msg}`, type: "err" });
    } finally {
      setIsSavingRecord(false);
    }
  };

  const handleCopyLineNotification = async () => {
    if (!combinedHeaderTeacher || !canExport) return;
    const message = formatLineNotificationMessage(
      selectedAbsentTeachers,
      selectedDate,
      reason,
      docRows,
      teacherReasons
    );
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(message);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      setCopiedLine(true);
      setStatusMsg({
        text: "คัดลอกข้อความแจ้งสอนแทนแล้ว สามารถกดวาง (Paste) ในกลุ่ม LINE โรงเรียนได้ทันที",
        type: "ok",
      });
      window.setTimeout(() => setCopiedLine(false), 2500);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = message;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopiedLine(true);
        setStatusMsg({
          text: "คัดลอกข้อความแจ้งสอนแทนแล้ว สามารถกดวาง (Paste) ในกลุ่ม LINE โรงเรียนได้ทันที",
          type: "ok",
        });
        window.setTimeout(() => setCopiedLine(false), 2500);
      } catch {
        setStatusMsg({
          text: "ไม่สามารถคัดลอกข้อความอัตโนมัติได้ กรุณาลองอีกครั้ง",
          type: "err",
        });
      }
    }
  };

  const hasCustomStudentTeacherSelected = useMemo(
    () => Object.values(assignments).some((v) => v === "s"),
    [assignments]
  );

  const hasSupervisionSlots = selectedAbsentTeachers.some(
    (t) => t.id === 100 || t.id === 101
  );

  // รายชื่อครูที่ยังไม่ได้อยู่ในตารางลาวันนี้ และไม่ได้ยกเว้นการจัดสอนแทน
  const availableTeachersToAdd = teachers.filter(
    (t) =>
      !allAbsentNumericIds.includes(t.id) &&
      !isTeacherExemptFromNeedingSubstitute(t)
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[460px_1fr] gap-4 sm:gap-5 items-start w-full">
      {/* แผงตั้งค่าและจัดคาบสอนแทนด้านซ้าย (แบ่ง 3 ขั้นตอนชัดเจน ใช้งานง่าย) */}
      <section className="min-w-0 w-full bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs print:hidden space-y-4">
        {/* ส่วนหัวแผงจัดสอนแทน */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#c9d4ec] dark:border-[#2a3a6e] flex-wrap">
          <h2 className="text-lg sm:text-xl font-bold text-[#0f2150] dark:text-[#e9eefc]">
            จัดครูสอนแทน
          </h2>
          <div className="flex items-center gap-2">
            {selectedAbsentTeachers.length > 0 && (
              <button
                type="button"
                id="btn-view-absent-timetables"
                onClick={() =>
                  onViewTeacherTimetable(selectedAbsentTeachers.map((t) => t.id))
                }
                title={`เปิดดูตารางสอนของครูที่ลา (${selectedAbsentTeachers
                  .map((t) => t.n)
                  .join(", ")})`}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-[#eaf0fa] dark:hover:bg-blue-950 flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>
                  {selectedAbsentTeachers.length > 1
                    ? `ดูตารางสอน (${selectedAbsentTeachers.length} ท่าน)`
                    : "ดูตารางสอน"}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenDatabaseTab}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-[#eaf0fa] dark:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-blue-200 dark:hover:bg-blue-950 flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Database className="w-3.5 h-3.5" />
              <span>ฐานข้อมูล / ปีการศึกษา</span>
            </button>
          </div>
        </div>

        {/* ขั้นตอนที่ 1: เลือกครูที่ลา */}
        <div className="p-3.5 rounded-lg bg-[#f8faff] dark:bg-[#0b1330]/60 border border-[#c9d4ec] dark:border-[#2a3a6e] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="ta"
              className="text-sm font-bold text-[#0f2150] dark:text-[#e9eefc] flex items-center gap-1.5"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-[#1b4fb8] text-white text-xs font-bold">
                1
              </span>
              <span>เลือกครูที่ลา / ติดราชการ</span>
            </label>
            {selectedAbsentTeachers.length > 1 && (
              <span className="text-xs font-bold text-[#1b4fb8] dark:text-[#6c97ff]">
                เลือก {selectedAbsentTeachers.length} ท่าน
              </span>
            )}
          </div>

          <select
            id="ta"
            value={primaryTeacherId}
            onChange={(e) => onChangePrimaryTeacherId(e.target.value)}
            className="w-full max-w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] text-sm font-semibold focus:outline-2 focus:outline-[#f2c230]"
          >
            <option value="">— เลือกครูผู้สอน —</option>
            {DEPARTMENT_GROUPS.map((group) => {
              const groupTeachers = regularTeachers.filter((t) => t.g === group);
              if (groupTeachers.length === 0) return null;
              return (
                <optgroup key={group} label={`กลุ่มสาระ/งาน: ${group}`}>
                  {groupTeachers.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.id} {t.n} ({t.pdfGroup})
                    </option>
                  ))}
                </optgroup>
              );
            })}
            {studentTeachers.length > 0 && (
              <optgroup label="นักศึกษาฝึกสอน">
                {studentTeachers.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.id} {t.n} (นศ.ฝึกสอน · {t.pdfGroup})
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {/* รายชื่อครูที่เลือกในใบเดียวกัน + ปุ่มเพิ่มครูที่ลา */}
          <div className="space-y-2 pt-1">
            {selectedAbsentTeachers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedAbsentTeachers.map((t) => {
                  const tClasses = getTeacherClasses(
                    t.id,
                    selectedDate,
                    includeSupervision
                  );
                  const tReason = resolveTeacherReason(t.id, reason, teacherReasons);
                  return (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] text-xs font-medium text-[#0f2150] dark:text-[#e9eefc]"
                    >
                      <button
                        type="button"
                        onClick={() => onViewTeacherTimetable(t.id)}
                        title={`คลิกเพื่อดูตารางสอนของ ${t.id} ${t.n}`}
                        className="inline-flex items-center gap-1 hover:underline cursor-pointer text-left"
                      >
                        <span className="text-[#1b4fb8] dark:text-[#6c97ff] font-bold">
                          {t.id}
                        </span>
                        <span className="font-semibold">{t.n}</span>
                        <span className="text-[#51608a] dark:text-[#9fb0dc] text-[11px]">
                          ({tClasses.length} คาบ{selectedAbsentTeachers.length > 1 ? ` · ${tReason}` : ""})
                        </span>
                      </button>
                      {selectedAbsentTeachers.length > 1 && (
                        <button
                          type="button"
                          title={`นำ ${t.n} ออก`}
                          onClick={() => onRemoveAbsentTeacher(String(t.id))}
                          className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-950 text-red-500 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5 text-[#1b4fb8] dark:text-[#6c97ff] shrink-0" />
              <select
                id="add-teacher-select"
                aria-label="เลือกครูที่ลาเพิ่มเติมในตารางเดียวกัน"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    onAddAbsentTeacher(e.target.value);
                    setAddingTeacherPickerOpen(true);
                  }
                }}
                className="w-full px-2.5 py-1.5 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#14204a] text-[#0f2150] dark:text-[#e9eefc] text-xs font-medium focus:outline-2 focus:outline-[#f2c230]"
              >
                <option value="">
                  + เพิ่มครูที่ลาเพิ่มเติมในใบเดียวกัน (กรณีลาพร้อมกันหลายท่าน)...
                </option>
                {DEPARTMENT_GROUPS.map((group) => {
                  const groupTeachers = availableTeachersToAdd.filter(
                    (t) => !t.isStudentTeacher && t.g === group
                  );
                  if (groupTeachers.length === 0) return null;
                  return (
                    <optgroup key={group} label={`กลุ่มสาระ/งาน: ${group}`}>
                      {groupTeachers.map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.id} {t.n} ({t.pdfGroup})
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
                {availableTeachersToAdd.some((t) => t.isStudentTeacher) && (
                  <optgroup label="นักศึกษาฝึกสอน">
                    {availableTeachersToAdd
                      .filter((t) => t.isStudentTeacher)
                      .map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.id} {t.n} (นศ.ฝึกสอน · {t.pdfGroup})
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>
        </div>

        {/* ขั้นตอนที่ 2: กำหนดวันที่และภารกิจ */}
        <div className="p-3.5 rounded-lg bg-[#f8faff] dark:bg-[#0b1330]/60 border border-[#c9d4ec] dark:border-[#2a3a6e] space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label
              htmlFor="dt"
              className="text-sm font-bold text-[#0f2150] dark:text-[#e9eefc] flex items-center gap-1.5"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-[#1b4fb8] text-white text-xs font-bold">
                2
              </span>
              <span>เลือกวันที่และเหตุผลการลา</span>
            </label>
            {selectedDateBuddhistYear &&
              selectedDateBuddhistYear !== academicSettings.academicYear && (
                <button
                  type="button"
                  onClick={() =>
                    onChangeDate(
                      adjustDateToAcademicYear(
                        selectedDate,
                        academicSettings.academicYear
                      )
                    )
                  }
                  className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 text-xs font-bold cursor-pointer hover:bg-amber-200"
                >
                  ปรับปีวันที่เป็น พ.ศ. {academicSettings.academicYear}
                </button>
              )}
          </div>

          <div>
            <input
              type="date"
              id="dt"
              value={selectedDate}
              onChange={(e) => onChangeDate(e.target.value)}
              className="block w-full max-w-full min-w-0 appearance-none px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] text-sm font-semibold focus:outline-2 focus:outline-[#f2c230]"
            />

            {/* ปุ่มลัดเลือกวันจันทร์-ศุกร์ */}
            <div className="grid grid-cols-5 gap-1.5 mt-2">
              {DAYS.map((dayName, idx) => (
                <button
                  key={dayName}
                  type="button"
                  onClick={() => jumpToWeekday(idx)}
                  className={`py-1.5 px-1 rounded-md text-xs font-bold text-center transition-colors cursor-pointer whitespace-nowrap ${
                    dayIdx === idx
                      ? "bg-[#1b4fb8] text-white shadow-2xs"
                      : "bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#0f2150] dark:text-[#9fb0dc] hover:bg-blue-100 dark:hover:bg-blue-900"
                  }`}
                >
                  {dayName}
                </button>
              ))}
            </div>
          </div>

          {/* เหตุผล / ภารกิจ (รองรับทั้งครูท่านเดียว และแยกเหตุผลรายบุคคลเมื่อมีครูลาหลายท่าน) */}
          {selectedAbsentTeachers.length <= 1 ? (
            <div>
              <label
                htmlFor="wy"
                className="block text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] mb-1"
              >
                เหตุผล / ภารกิจ (แสดงในช่องหมายเหตุ)
              </label>
              <input
                type="text"
                id="wy"
                value={
                  primaryTeacherId && teacherReasons[primaryTeacherId] !== undefined
                    ? teacherReasons[primaryTeacherId]
                    : reason
                }
                onChange={(e) => {
                  const val = e.target.value;
                  onChangeReason(val);
                  if (primaryTeacherId && onChangeTeacherReason) {
                    onChangeTeacherReason(primaryTeacherId, val);
                  }
                }}
                placeholder="พิมพ์เหตุผลการลา หรือเลือกปุ่มลัดด้านล่าง เช่น ไปราชการ, ลากิจ, ลาป่วย"
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] focus:outline-2 focus:outline-[#f2c230]"
              />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {REASON_PRESETS.map((preset) => {
                  const activeReason =
                    primaryTeacherId && teacherReasons[primaryTeacherId] !== undefined
                      ? teacherReasons[primaryTeacherId]
                      : reason;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        onChangeReason(preset);
                        if (primaryTeacherId && onChangeTeacherReason) {
                          onChangeTeacherReason(primaryTeacherId, preset);
                        }
                      }}
                      className={`px-2 py-0.5 rounded-md text-xs transition-colors cursor-pointer ${
                        activeReason === preset
                          ? "bg-[#1b4fb8] text-white font-semibold"
                          : "bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#51608a] dark:text-[#9fb0dc] hover:text-[#0f2150]"
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold text-[#0f2150] dark:text-[#e9eefc]">
                  เหตุผล / ภารกิจ แยกรายบุคคล (แสดงในช่องหมายเหตุของครูแต่ละท่าน)
                </span>
              </div>

              <div className="space-y-2">
                {selectedAbsentTeachers.map((t) => {
                  const tKey = String(t.id);
                  const currentTeacherReason =
                    teacherReasons[tKey] !== undefined ? teacherReasons[tKey] : reason;
                  return (
                    <div
                      key={t.id}
                      className="p-2.5 rounded-lg bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor={`wy-${t.id}`}
                          className="text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] flex items-center gap-1.5"
                        >
                          <span className="px-1.5 py-0.5 rounded bg-[#eaf0fa] dark:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff] font-bold">
                            {t.id}
                          </span>
                          <span>{t.n}</span>
                        </label>
                        <span className="text-[11px] text-[#51608a] dark:text-[#9fb0dc]">
                          {t.pdfGroup}
                        </span>
                      </div>
                      <input
                        type="text"
                        id={`wy-${t.id}`}
                        aria-label={`เหตุผลการลาของ ${t.id} ${t.n}`}
                        value={currentTeacherReason}
                        onChange={(e) => {
                          if (onChangeTeacherReason) {
                            onChangeTeacherReason(tKey, e.target.value);
                          } else {
                            onChangeReason(e.target.value);
                          }
                        }}
                        placeholder="พิมพ์เหตุผลการลา หรือกดเลือกปุ่มลัดด้านล่าง..."
                        className="w-full px-2.5 py-1.5 text-xs sm:text-sm rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] bg-[#f8faff] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] focus:outline-2 focus:outline-[#f2c230]"
                      />
                      <div className="flex flex-wrap gap-1">
                        {REASON_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              if (onChangeTeacherReason) {
                                onChangeTeacherReason(tKey, preset);
                              } else {
                                onChangeReason(preset);
                              }
                            }}
                            className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                              currentTeacherReason === preset
                                ? "bg-[#1b4fb8] text-white font-semibold"
                                : "bg-[#f8faff] dark:bg-[#0b1330] border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#51608a] dark:text-[#9fb0dc] hover:text-[#0f2150]"
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[11px] font-semibold text-[#51608a] dark:text-[#9fb0dc]">
                  ตั้งให้เหมือนกันทุกคน:
                </span>
                {REASON_PRESETS.map((preset) => (
                  <button
                    key={`all-${preset}`}
                    type="button"
                    onClick={() => onChangeReason(preset)}
                    className="px-2 py-0.5 rounded bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] text-[11px] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-[#eaf0fa] dark:hover:bg-blue-950 font-semibold cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ช่องระบุชื่อ นศ.ฝึกสอน เพิ่มเติม (แสดงเฉพาะเมื่อมีการเลือกตัวเลือก "นักศึกษาฝึกสอน (ระบุชื่อเอง)" ในคาบเรียน) */}
          {hasCustomStudentTeacherSelected && (
            <div>
              <label
                htmlFor="sn"
                className="block text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] mb-1"
              >
                ระบุชื่อนักศึกษาฝึกสอน
              </label>
              <input
                type="text"
                id="sn"
                value={studentTeacherName}
                onChange={(e) => onChangeStudentTeacherName(e.target.value)}
                placeholder="พิมพ์ชื่อ-สกุล นักศึกษาฝึกสอน"
                className="w-full px-2.5 py-1.5 text-xs rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] focus:outline-2 focus:outline-[#f2c230]"
              />
            </div>
          )}

          {/* ตัวเลือกเสริมสำหรับฝ่ายบริหารที่มีคาบนิเทศสอน */}
          {hasSupervisionSlots && (
            <label className="flex items-center gap-2 pt-1 text-xs font-semibold text-[#0f2150] dark:text-[#e9eefc] cursor-pointer">
              <input
                type="checkbox"
                checked={includeSupervision}
                onChange={(e) => onChangeIncludeSupervision(e.target.checked)}
                className="rounded border-[#c9d4ec] text-[#1b4fb8]"
              />
              <span>รวมคาบนิเทศสอนในใบมอบหมายงานด้วย</span>
            </label>
          )}
        </div>

        {/* ขั้นตอนที่ 3: รายการคาบสอนที่ต้องจัดคนแทน */}
        <div
          id="plan"
          className="p-3.5 rounded-lg bg-[#f8faff] dark:bg-[#0b1330]/60 border border-[#c9d4ec] dark:border-[#2a3a6e] space-y-3"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-bold text-[#0f2150] dark:text-[#e9eefc] flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-[#1b4fb8] text-white text-xs font-bold">
                3
              </span>
              <span>ตรวจสอบ / เลือกครูสอนแทนรายคาบ</span>
            </div>
            <button
              type="button"
              id="au"
              onClick={onResetAutoAssign}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#1b4fb8] dark:border-[#6c97ff] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-[#1b4fb8] hover:text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3 shrink-0" />
              <span>จัดอัตโนมัติใหม่</span>
            </button>
          </div>

          {selectedAbsentTeachers.length === 0 ? (
            <p className="text-[#51608a] dark:text-[#9fb0dc] text-sm">
              กรุณาเลือกครูที่ลาในขั้นตอนที่ 1
            </p>
          ) : !selectedDate ? (
            <p className="text-[#51608a] dark:text-[#9fb0dc] text-sm">
              กรุณาเลือกวันที่ต้องการจัดสอนแทน
            </p>
          ) : dayIdx < 0 ? (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60">
              <p className="text-[#b3261e] dark:text-[#ff8b82] font-semibold text-sm">
                วันที่เลือกตรงกับวันเสาร์–อาทิตย์ ไม่มีคาบสอน กรุณาเลือกวันจันทร์–ศุกร์
              </p>
            </div>
          ) : combinedClasses.length === 0 ? (
            <div className="p-3 rounded-lg bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] space-y-1.5">
              <p className="text-[#0f2150] dark:text-[#e9eefc] font-semibold text-sm">
                <b>{selectedAbsentTeachers.map((t) => t.n).join(", ")}</b>{" "}
                {studentCoveredClasses.length > 0
                  ? `ไม่ต้องจัดสอนแทนในวัน${DAYS[dayIdx]} (นักศึกษาฝึกสอนสอนประจำวิชาแล้ว)`
                  : `ไม่มีคาบสอนวิชาปกติในวัน${DAYS[dayIdx]}`}
              </p>
              {studentCoveredClasses.length > 0 && (
                <div className="text-xs text-[#0b7a4b] dark:text-[#4fd39a] space-y-0.5 pt-1 border-t border-[#c9d4ec] dark:border-[#2a3a6e]">
                  {studentCoveredClasses.map((sc) => (
                    <div key={`${sc.absentTeacherId}_${sc.p}`}>
                      • คาบที่ {sc.p + 1} <b>{sc.code}</b> ({sc.subjectName}) ม.{sc.cls} —{" "}
                      <b>{sc.studentTeacherName}</b> (นศ.ฝึกสอน) สอนแล้ว
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-[#51608a] dark:text-[#9fb0dc]">
                {selectedAbsentTeachers.length === 1 ? (
                  <>
                    <span>{selectedAbsentTeachers[0].n}</span> · มี{" "}
                    <b className="text-[#0f2150] dark:text-[#e9eefc]">{combinedClasses.length} คาบ</b>{" "}
                    ที่ต้องจัดสอนแทนในวัน{DAYS[dayIdx]} ({formatThaiDate(selectedDate)})
                  </>
                ) : (
                  <>
                    <span>
                      รวมทั้งหมด{" "}
                      <b className="text-[#0f2150] dark:text-[#e9eefc]">
                        {combinedClasses.length} คาบ
                      </b>{" "}
                      ที่ต้องจัดสอนแทนในวัน{DAYS[dayIdx]} (จากครูที่ลา {selectedAbsentTeachers.length} ท่าน)
                    </span>
                  </>
                )}
              </div>

              {studentCoveredClasses.length > 0 && (
                <div className="p-2.5 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs text-[#0b7a4b] dark:text-[#4fd39a] space-y-0.5">
                  <div className="font-bold">
                    ตัดคาบที่นักศึกษาฝึกสอนสอนอยู่แล้วออกอัตโนมัติ ({studentCoveredClasses.length} คาบ):
                  </div>
                  {studentCoveredClasses.map((sc) => (
                    <div key={`${sc.absentTeacherId}_${sc.p}`}>
                      • คาบที่ {sc.p + 1} <b>{sc.code}</b> ({sc.subjectName}) ม.{sc.cls} —{" "}
                      <b>{sc.studentTeacherName}</b> สอนแล้ว
                    </div>
                  ))}
                </div>
              )}

              {combinedClasses.map((slot) => {
                // ตรวจสอบว่ามีครูคนไหนถูกเลือกให้สอนแทนคาบอื่นในคาบเรียนเดียวกัน (slot.p) ไปแล้วบ้าง
                const assignedInOtherSlotsSamePeriod: number[] = [];
                combinedClasses.forEach((otherSlot) => {
                  if (otherSlot.slotKey === slot.slotKey) return;
                  if (otherSlot.p !== slot.p) return;
                  const val = getSlotAssignment(
                    assignments,
                    otherSlot.absentTeacherId,
                    otherSlot.p
                  );
                  if (val && val.startsWith("t")) {
                    const tid = Number(val.slice(1));
                    if (Number.isFinite(tid)) {
                      assignedInOtherSlotsSamePeriod.push(tid);
                    }
                  }
                });

                const excludedIdsForSlot = Array.from(
                  new Set([
                    ...allAbsentNumericIds,
                    ...assignedInOtherSlotsSamePeriod,
                  ])
                );

                const candidates = getCandidateTeachers(
                  slot.absentTeacherId,
                  selectedDate,
                  slot.p,
                  excludedIdsForSlot,
                  slot.cls
                );
                const gradeNum = extractGradeLevel(slot.cls);
                const gradeLabel = gradeNum ? `ม.${gradeNum}` : slot.cls;

                const prevContinuousRegular = candidates.filter(
                  (c) =>
                    !c.isStudentTeacher &&
                    doesTeacherTeachPrevPeriodExactClass(
                      c,
                      selectedDate,
                      slot.p,
                      slot.cls
                    )
                );
                const prevContinuousIds = new Set(
                  prevContinuousRegular.map((c) => c.id)
                );

                const sameGradeSameGroupRegular = candidates.filter(
                  (c) =>
                    !c.isStudentTeacher &&
                    !prevContinuousIds.has(c.id) &&
                    doesTeacherTeachGrade(c, slot.cls) &&
                    c.g === slot.absentTeacherGroup
                );
                const sameGradeOtherGroupRegular = candidates.filter(
                  (c) =>
                    !c.isStudentTeacher &&
                    !prevContinuousIds.has(c.id) &&
                    doesTeacherTeachGrade(c, slot.cls) &&
                    c.g !== slot.absentTeacherGroup
                );
                const otherGradeSameGroupRegular = candidates.filter(
                  (c) =>
                    !c.isStudentTeacher &&
                    !prevContinuousIds.has(c.id) &&
                    !doesTeacherTeachGrade(c, slot.cls) &&
                    c.g === slot.absentTeacherGroup
                );
                const freeStudentTeachers = candidates.filter(
                  (c) => c.isStudentTeacher
                );
                const otherGradeOtherGroupRegular = candidates.filter(
                  (c) =>
                    !c.isStudentTeacher &&
                    !prevContinuousIds.has(c.id) &&
                    !doesTeacherTeachGrade(c, slot.cls) &&
                    c.g !== slot.absentTeacherGroup
                );
                const currentVal =
                  getSlotAssignment(assignments, slot.absentTeacherId, slot.p) || "s";
                const subjectTitle = getSubjectNameFromCourse(
                  slot.code,
                  slot.absentTeacherPdfGroup || slot.absentTeacherGroup,
                  slot.absentTeacherId
                );

                return (
                  <div
                    key={slot.slotKey}
                    className="p-2.5 rounded-lg bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs sm:text-sm flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="px-2 py-0.5 rounded-md bg-[#12307a] text-white font-bold text-xs">
                          คาบที่ {slot.p + 1}
                        </span>
                        <span className="text-xs text-[#51608a] dark:text-[#9fb0dc]">
                          ({slot.tm})
                        </span>
                        <span className="font-bold text-[#1b4fb8] dark:text-[#6c97ff]">
                          {slot.code}
                        </span>
                        <span className="text-[#0f2150] dark:text-[#e9eefc] font-semibold">
                          {subjectTitle}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-md bg-[#eaf0fa] dark:bg-[#0b1330] font-bold text-[#0f2150] dark:text-[#e9eefc] text-xs">
                          ม.{slot.cls}
                        </span>
                        {selectedAbsentTeachers.length > 1 && (
                          <span className="px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-xs font-semibold text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            แทน {slot.absentTeacherName} ({resolveTeacherReason(slot.absentTeacherId, reason, teacherReasons)})
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-[#51608a] dark:text-[#9fb0dc] whitespace-nowrap shrink-0">
                        {formatRoomLabel(slot.room)}
                      </span>
                    </div>

                    <select
                      data-p={slot.p}
                      data-slot={slot.slotKey}
                      aria-label={`ครูสอนแทนคาบ ${slot.p + 1} (${slot.code})`}
                      value={currentVal}
                      onChange={(e) =>
                        onChangeAssignment(slot.slotKey, slot.p, e.target.value)
                      }
                      className="w-full max-w-full px-2.5 py-1.5 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] bg-[#f8faff] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] text-sm font-medium focus:outline-2 focus:outline-[#f2c230]"
                    >
                      {prevContinuousRegular.length > 0 && (
                        <optgroup
                          label={`★ คาบต่อเนื่อง · เพิ่งสอน ม.${slot.cls} ในคาบที่ ${slot.p} และว่างคาบนี้ (${prevContinuousRegular.length} ท่าน)`}
                        >
                          {prevContinuousRegular.map((t) => {
                            const contInfo = getContinuousPeriodInfo(
                              t,
                              selectedDate,
                              slot.p,
                              slot.cls
                            );
                            return (
                              <option key={t.id} value={`t${t.id}`}>
                                {t.id} {t.n} (สอนต่อเนื่อง ม.{slot.cls} จากคาบ {contInfo.prevPeriodNumber} วิชา{contInfo.prevSubjectName} · {t.pdfGroup}{getSubCountSuffix(t.id)})
                              </option>
                            );
                          })}
                        </optgroup>
                      )}
                      {sameGradeSameGroupRegular.length > 0 && (
                        <optgroup
                          label={`1. ครูระดับชั้นเดียวกัน (${gradeLabel}) · กลุ่มสาระเดียวกัน (${sameGradeSameGroupRegular.length} ท่าน)`}
                        >
                          {sameGradeSameGroupRegular.map((t) => {
                            const exact = doesTeacherTeachExactClass(t, slot.cls);
                            return (
                              <option key={t.id} value={`t${t.id}`}>
                                {t.id} {t.n} (สอน {exact ? `ม.${slot.cls}` : gradeLabel} · กลุ่มสาระ{t.pdfGroup}{getSubCountSuffix(t.id)})
                              </option>
                            );
                          })}
                        </optgroup>
                      )}
                      {sameGradeOtherGroupRegular.length > 0 && (
                        <optgroup
                          label={`2. ครูระดับชั้นเดียวกัน (${gradeLabel}) · ต่างกลุ่มสาระ (${sameGradeOtherGroupRegular.length} ท่าน)`}
                        >
                          {sameGradeOtherGroupRegular.map((t) => {
                            const exact = doesTeacherTeachExactClass(t, slot.cls);
                            return (
                              <option key={t.id} value={`t${t.id}`}>
                                {t.id} {t.n} (สอน {exact ? `ม.${slot.cls}` : gradeLabel} · {t.pdfGroup}{getSubCountSuffix(t.id)})
                              </option>
                            );
                          })}
                        </optgroup>
                      )}
                      {otherGradeSameGroupRegular.length > 0 && (
                        <optgroup
                          label={`3. ครูกลุ่มสาระเดียวกัน · สอนระดับชั้นอื่น (${otherGradeSameGroupRegular.length} ท่าน)`}
                        >
                          {otherGradeSameGroupRegular.map((t) => (
                            <option key={t.id} value={`t${t.id}`}>
                              {t.id} {t.n} (กลุ่มสาระ{t.pdfGroup} · สอน {formatTeacherGradesSummary(t)}{getSubCountSuffix(t.id)})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {freeStudentTeachers.length > 0 && (
                        <optgroup
                          label={`4. นักศึกษาฝึกสอนที่ว่างในคาบนี้ (${freeStudentTeachers.length} ท่าน)`}
                        >
                          {freeStudentTeachers.map((t) => {
                            const stCont = getContinuousPeriodInfo(
                              t,
                              selectedDate,
                              slot.p,
                              slot.cls
                            );
                            const stSameGrade = doesTeacherTeachGrade(t, slot.cls);
                            const stExact = doesTeacherTeachExactClass(t, slot.cls);
                            return (
                              <option key={t.id} value={`t${t.id}`}>
                                {t.id} {t.n} (นศ.ฝึกสอน ·{" "}
                                {stCont.isPrevContinuous
                                  ? `สอนต่อเนื่อง ม.${slot.cls} จากคาบ ${stCont.prevPeriodNumber} · `
                                  : stSameGrade
                                    ? `สอน ${stExact ? `ม.${slot.cls}` : gradeLabel} · `
                                    : `สอน ${formatTeacherGradesSummary(t)} · `}
                                {t.pdfGroup}{getSubCountSuffix(t.id)})
                              </option>
                            );
                          })}
                        </optgroup>
                      )}
                      {otherGradeOtherGroupRegular.length > 0 && (
                        <optgroup
                          label={`5. ครูท่านอื่นที่ว่าง (ต่างระดับชั้น · ต่างกลุ่มสาระ) (${otherGradeOtherGroupRegular.length} ท่าน)`}
                        >
                          {otherGradeOtherGroupRegular.map((t) => (
                            <option key={t.id} value={`t${t.id}`}>
                              {t.id} {t.n} ({t.pdfGroup} · สอน {formatTeacherGradesSummary(t)}{getSubCountSuffix(t.id)})
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
                  </div>
                );
              })}
            </div>
          )}

          {/* ปุ่มคัดลอกแจ้ง LINE และปุ่มบันทึกประวัติลงฐานข้อมูล */}
          <div className="pt-2 border-t border-[#c9d4ec] dark:border-[#2a3a6e] grid grid-cols-2 gap-2">
            <button
              type="button"
              id="btn-copy-line"
              disabled={!canExport}
              onClick={handleCopyLineNotification}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#0b7a4b] dark:border-[#4fd39a] text-[#0b7a4b] dark:text-[#4fd39a] hover:bg-emerald-50 dark:hover:bg-emerald-950/50 disabled:opacity-40 font-bold text-xs sm:text-sm transition-colors cursor-pointer whitespace-nowrap"
            >
              {copiedLine ? (
                <>
                  <Check className="w-4 h-4 shrink-0" />
                  <span>คัดลอกแล้ว!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 shrink-0" />
                  <span>คัดลอกแจ้ง LINE</span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={!canExport || isSavingRecord}
              onClick={handleSaveToDatabase}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0b7a4b] hover:bg-[#085c38] disabled:opacity-40 text-white font-bold text-xs sm:text-sm transition-colors cursor-pointer shadow-xs whitespace-nowrap"
            >
              <Save className="w-4 h-4 shrink-0" />
              <span>{isSavingRecord ? "กำลังบันทึก..." : "บันทึกประวัติ"}</span>
            </button>
          </div>
        </div>

        {/* รายการใบสอนแทนที่บันทึกไว้ล่าสุด */}
        {savedRecords.length > 0 && (
          <div className="pt-2 border-t border-[#c9d4ec] dark:border-[#2a3a6e]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-[#0f2150] dark:text-[#e9eefc]">
                ประวัติที่บันทึกไว้ล่าสุด ({savedRecords.length})
              </span>
              <button
                type="button"
                onClick={onOpenDatabaseTab}
                className="text-xs font-semibold text-[#1b4fb8] dark:text-[#6c97ff] hover:underline cursor-pointer"
              >
                จัดการทั้งหมด
              </button>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {savedRecords.slice(0, 4).map((rec) => (
                <div
                  key={rec.recordId}
                  className="flex items-center justify-between gap-2 p-2 rounded-md bg-[#f8faff] dark:bg-[#0b1330]/60 border border-[#c9d4ec] dark:border-[#2a3a6e] text-xs"
                >
                  <div className="min-w-0 truncate">
                    <span className="font-semibold text-[#0f2150] dark:text-[#e9eefc]">
                      {/^\d{3}\s/.test(rec.absentTeacherName)
                        ? rec.absentTeacherName
                        : `${rec.absentTeacherId} ${rec.absentTeacherName}`}
                    </span>{" "}
                    <span className="text-[#51608a] dark:text-[#9fb0dc] text-[11px]">
                      · {formatThaiDate(rec.selectedDate)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onLoadSavedRecord(rec)}
                      title="โหลดมาแก้ไข"
                      className="px-2 py-0.5 rounded-md bg-[#1b4fb8] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <FolderOpen className="w-3 h-3" />
                      <span>เปิด</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedRecord(rec.recordId)}
                      title="ลบ"
                      className="p-1 rounded-md text-red-500 hover:bg-red-100 dark:hover:bg-red-950/60 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* แผงแสดงตัวอย่างเอกสารใบสอนแทน (A4) ด้านขวา */}
      <section className="min-w-0 w-full bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-3 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3 print:hidden">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-[#0f2150] dark:text-[#e9eefc]">
              ตัวอย่างแบบบันทึกการจัดสอนแทน
            </h2>
            {selectedAbsentTeachers.length > 1 && (
              <span className="text-xs px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-[#1b4fb8] dark:text-[#6c97ff] font-bold">
                รวม {selectedAbsentTeachers.length} ท่าน
              </span>
            )}
            {previewDataUrl && (
              <button
                type="button"
                onClick={() => setFullscreenImageOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#eaf0fa] dark:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-blue-200 dark:hover:bg-blue-950 font-semibold cursor-pointer whitespace-nowrap text-xs"
              >
                <Maximize2 className="w-3 h-3" />
                <span>ขยายเต็มจอ</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 sm:flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              id="bw"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("word")}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap shadow-2xs"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span>Word (.docx)</span>
            </button>
            <button
              type="button"
              id="bp"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("pdf")}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#12307a] hover:bg-[#0d2259] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap shadow-2xs"
            >
              <FileDown className="w-4 h-4 shrink-0" />
              <span>PDF</span>
            </button>
            <button
              type="button"
              id="bi"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("image")}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#1b4fb8] dark:border-[#6c97ff] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-[#eaf0fa] dark:hover:bg-blue-950 disabled:opacity-40 disabled:cursor-not-allowed text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap"
            >
              <ImageIcon className="w-4 h-4 shrink-0" />
              <span>รูปภาพ</span>
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

        {/* กระดาษ A4 แนวนอน ตัวอย่างแบบบันทึกการจัดสอนแทน (รูปแบบตามภาพที่ 1 เป๊ะ 100%) */}
        <div className="bg-slate-100 dark:bg-[#0b1330] p-2 sm:p-4 md:p-5 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] print:p-0 print:bg-white print:border-0">
          <div
            id="paper"
            ref={paperRef}
            className="paper-sheet w-full max-w-[1123px] bg-white text-black mx-auto shadow-md print:shadow-none relative overflow-hidden"
          >
            {!combinedHeaderTeacher || dayIdx < 0 || docRows.length === 0 ? (
              <div className="text-center py-32 px-6 text-neutral-500 min-h-[540px] flex flex-col items-center justify-center">
                <div className="flex items-center justify-center gap-6 mb-4 opacity-70">
                  <img
                    src={LEFT_SCHOOL_LOGO_URL}
                    alt="ตราโรงเรียนวรคุณอุปถัมภ์"
                    referrerPolicy="no-referrer"
                    className="h-[84px] w-auto object-contain"
                  />
                  <img
                    src={RIGHT_OBEC_LOGO_URL}
                    alt="ตราองค์กรหมายเลข 1"
                    referrerPolicy="no-referrer"
                    className="h-[78px] w-auto object-contain"
                  />
                </div>
                <p className="text-xl font-semibold">
                  เลือกครูและวันที่ที่มีคาบสอน เพื่อแสดงแบบบันทึกการจัดสอนแทน
                </p>
                <p className="text-base mt-1">
                  โรงเรียนวรคุณอุปถัมภ์ · {formatThaiMonthYearHeader(selectedDate)}
                </p>
              </div>
            ) : (
              <>
                {previewPages.length > 0 && (
                  <div className="space-y-4">
                    {previewPages.map((pageUrl, pIdx) => (
                      <div
                        key={pIdx}
                        className="relative bg-white shadow-md rounded overflow-hidden"
                      >
                        {previewPages.length > 1 && (
                          <div className="flex flex-wrap items-center justify-between gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 print:hidden">
                            <span>
                              หน้า {pIdx + 1} จาก {previewPages.length}
                            </span>
                            <button
                              type="button"
                              disabled={isExporting}
                              onClick={() => handleDownloadSinglePage(pIdx)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-[#14204a] hover:bg-blue-50 dark:hover:bg-blue-900 border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#1b4fb8] dark:text-[#6c97ff] text-xs font-medium cursor-pointer shadow-2xs transition-colors"
                              title={`ดาวน์โหลดเฉพาะรูปภาพหน้า ${pIdx + 1}`}
                            >
                              <ImageIcon className="w-3 h-3 shrink-0" />
                              <span>โหลดรูปหน้า {pIdx + 1}</span>
                            </button>
                          </div>
                        )}
                        <img
                          src={pageUrl}
                          alt={`ตัวอย่างแบบบันทึกการจัดสอนแทน หน้า ${pIdx + 1}`}
                          className="w-full h-auto block"
                        />
                      </div>
                    ))}
                  </div>
                )}
                {/* โครงสร้างตาราง Semantic 10 คอลัมน์ตามภาพที่ 1 สำหรับ Screen Reader และการค้นหาข้อความ */}
                <div
                  className={
                    previewDataUrl
                      ? "sr-only"
                      : "px-[36px] py-[32px] text-[15px] leading-[1.35]"
                  }
                >
                  <div className="flex items-center justify-center gap-[58px] mb-4">
                    <img
                      src={LEFT_SCHOOL_LOGO_URL}
                      alt="ตราโรงเรียนวรคุณอุปถัมภ์"
                      className="h-[92px] w-auto object-contain"
                    />
                    <div className="text-center pt-1">
                      <h3 className="text-[20px] font-bold">แบบบันทึกการจัดสอนแทน</h3>
                      <h4 className="text-[19px] font-bold mt-2.5">
                        {formatThaiMonthYearHeader(selectedDate)}
                      </h4>
                    </div>
                    <img
                      src={RIGHT_OBEC_LOGO_URL}
                      alt="ตราองค์กรหมายเลข 1"
                      className="h-[84px] w-auto object-contain"
                    />
                  </div>
                  <table className="w-full border-collapse border border-black text-[15px]">
                    <thead>
                      <tr>
                        <th className="border border-black px-2 py-1.5 text-center font-bold">ที่</th>
                        <th className="border border-black px-2.5 py-1.5 text-center font-bold">
                          ชื่อ-สกุล ผู้สอนแทน
                        </th>
                        <th className="border border-black px-2.5 py-1.5 text-center font-bold">
                          สอนแทน
                        </th>
                        <th className="border border-black px-2 py-1.5 text-center font-bold">
                          คาบที่
                        </th>
                        <th className="border border-black px-2 py-1.5 text-center font-bold">
                          ห้อง
                        </th>
                        <th className="border border-black px-2 py-1.5 text-center font-bold">
                          วิชา
                        </th>
                        <th className="border border-black px-2 py-1.5 text-center font-bold">
                          รหัสวิชา
                        </th>
                        <th className="border border-black px-2 py-1.5 text-center font-bold">
                          วันที่
                        </th>
                        <th className="border border-black px-2 py-1.5 text-center font-bold">
                          ลงชื่อ
                        </th>
                        <th className="border border-black px-2 py-1.5 text-center font-bold">
                          หมายเหตุ
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {docRows.map((row, idx) => {
                        const subDisplay = row.subName || formatCleanSubstituteName(row.n);
                        const absentDisplay = (
                          row.absentTeacherName ||
                          combinedHeaderTeacher.n.split(",")[0] ||
                          ""
                        )
                          .replace(/^\d{3}\s+/, "")
                          .trim();
                        const roomClassDisplay =
                          row.classRoomLabel || formatClassLevelLabel(row.cls);
                        const subjectDisplay =
                          row.subjectName ||
                          getSubjectNameFromCourse(row.code, combinedHeaderTeacher.g);
                        const rowShortDate =
                          row.shortDate || formatShortThaiDate(selectedDate);
                        const noteStr =
                          (row.note || reason || "ไปราชการ").trim() || "ไปราชการ";

                        return (
                          <tr key={row.slotKey || `${row.p}-${idx}`}>
                            <td className="border border-black px-2 py-1.5 text-center">
                              {idx + 1}
                            </td>
                            <td className="border border-black px-2.5 py-1.5 text-left">
                              {subDisplay}
                            </td>
                            <td className="border border-black px-2.5 py-1.5 text-left">
                              {absentDisplay}
                            </td>
                            <td className="border border-black px-2 py-1.5 text-center">
                              {row.p}
                            </td>
                            <td className="border border-black px-2 py-1.5 text-center">
                              {roomClassDisplay}
                            </td>
                            <td className="border border-black px-2 py-1.5 text-center">
                              {subjectDisplay}
                            </td>
                            <td className="border border-black px-2 py-1.5 text-center">
                              {row.code}
                            </td>
                            <td className="border border-black px-2 py-1.5 text-center">
                              {rowShortDate}
                            </td>
                            <td className="border border-black px-2 py-1.5 text-center"></td>
                            <td className="border border-black px-2 py-1.5 text-center">
                              {noteStr}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="mt-10 flex items-stretch justify-around gap-6">
                    <div className="border-2 border-black px-6 py-3 text-center">
                      <p>ลงชื่อ.................................ผู้จัดสอนแทน</p>
                      <p className="mt-1">({academicSettings.plannerName})</p>
                      <p className="mt-1">{academicSettings.plannerPosition}</p>
                    </div>
                    <div className="border-2 border-black px-6 py-3 text-center">
                      <p>ลงชื่อ.................................หัวหน้ากลุ่มบริหารวิชาการ</p>
                      <p className="mt-1">({academicSettings.approverName})</p>
                      <p className="mt-1">{academicSettings.approverPosition}</p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* หน้าต่างขยายดูใบสอนแทนเต็มจอ */}
      {fullscreenImageOpen && (previewPages.length > 0 || previewDataUrl) && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-start p-3 sm:p-6 overflow-y-auto"
        >
          <div className="w-full max-w-[1123px] flex items-center justify-between gap-2 mb-3 text-white sticky top-0 z-10 bg-black/70 backdrop-blur-xs py-2 px-3 rounded-lg">
            <span className="text-xs sm:text-sm font-semibold">
              {previewPages.length > 1
                ? `แบบบันทึกการจัดสอนแทน (${previewPages.length} หน้า)`
                : "แบบบันทึกการจัดสอนแทน"}
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
          <div className="w-full max-w-[1123px] space-y-4">
            {(previewPages.length > 0 ? previewPages : [previewDataUrl]).map((pageUrl, pIdx) => (
              <div key={pIdx} className="bg-white rounded-lg overflow-hidden shadow-2xl">
                {previewPages.length > 1 && (
                  <div className="flex items-center justify-between px-4 py-2 bg-slate-100 text-slate-800 text-xs font-semibold border-b border-slate-200">
                    <span>หน้า {pIdx + 1} จาก {previewPages.length}</span>
                    <button
                      type="button"
                      onClick={() => handleDownloadSinglePage(pIdx)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1b4fb8] text-white hover:bg-[#153e91] text-xs font-medium cursor-pointer"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>ดาวน์โหลดหน้านี้</span>
                    </button>
                  </div>
                )}
                <img
                  src={pageUrl}
                  alt={`ใบสอนแทน หน้า ${pIdx + 1}`}
                  className="w-full h-auto block"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
