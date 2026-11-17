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
  AlertTriangle,
  Clock,
  GitMerge,
  Ban,
} from "lucide-react";
import { DAYS, DEPARTMENT_GROUPS, TeacherRecord } from "../data/teachers";
import {
  CombinedClassSlot,
  LeavePeriodMode,
  buildCombinedDocumentRows,
  buildCombinedTeacherHeader,
  computeSubstituteStatistics,
  detectLeavePeriodMode,
  doesTeacherTeachExactClass,
  doesTeacherTeachGrade,
  doesTeacherTeachPrevPeriodExactClass,
  extractGradeLevel,
  extractRecordTeacherIds,
  findDoubleBookedSubstitutes,
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
  onApplyLeavePeriodMode?: (mode: LeavePeriodMode, targetTeacherId?: number | string) => void;
  onResolveDoubleBooking?: () => void;
  onMergeSavedRecord?: (record: SavedSubstituteRecord) => void;
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
  onApplyLeavePeriodMode,
  onResolveDoubleBooking,
  onMergeSavedRecord,
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

  // ตรวจสอบว่ามีใบสอนแทนของวันที่เลือก (selectedDate) บันทึกอยู่ในประวัติแล้วหรือไม่
  const matchingSavedRecordsForDate = useMemo(
    () => savedRecords.filter((rec) => rec.selectedDate === selectedDate),
    [savedRecords, selectedDate]
  );

  // ตรวจสอบกรณีมีการเลือกครูผู้สอนแทนคนเดียวกันซ้ำในคาบเรียนเดียวกัน
  const doubleBookingConflicts = useMemo(
    () => findDoubleBookedSubstitutes(combinedClasses, assignments),
    [combinedClasses, assignments]
  );

  // ตรวจสอบโหมดการลา (เต็มวัน / ครึ่งเช้า / ครึ่งบ่าย)
  const overallLeaveMode = useMemo(
    () =>
      detectLeavePeriodMode(
        absentTeacherIds,
        selectedDate,
        assignments,
        undefined,
        includeSupervision
      ),
    [absentTeacherIds, selectedDate, assignments, includeSupervision, teachers]
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
      renderPaperPagesToCanvases(combinedHeaderTeacher, selectedDate, reason, docRows, 2.5)
        .then((canvases) => {
          if (!cancelled) {
            lastRenderedKeyRef.current = previewRenderKey;
            setPreviewPages(canvases.map((c) => c.toDataURL("image/png")));
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
    <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] xl:grid-cols-[460px_1fr] gap-4 sm:gap-5 items-start w-full">
      {/* แผงตั้งค่าและจัดคาบสอนแทนด้านซ้าย */}
      <section className="min-w-0 w-full bg-white dark:bg-[#111827] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] print:hidden space-y-5">
        {/* ส่วนหัวแผงจัดสอนแทน */}
        <div className="flex items-center justify-between gap-2 pb-3.5 border-b border-slate-100 dark:border-slate-800 flex-wrap">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50 tracking-tight">
              จัดครูสอนแทน
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              เลือกครูที่ลา วันที่ และตรวจสอบรายคาบ
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
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
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-blue-300 hover:text-blue-700 dark:hover:text-blue-400 flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors"
              >
                <Table2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>
                  {selectedAbsentTeachers.length > 1
                    ? `ดูตาราง (${selectedAbsentTeachers.length})`
                    : "ดูตารางสอน"}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenDatabaseTab}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors"
            >
              <Database className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>ฐานข้อมูล</span>
            </button>
          </div>
        </div>

        {/* ขั้นตอนที่ 1: เลือกครูที่ลา */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="ta"
              className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-700 text-white text-[11px] font-bold tabular-nums">
                1
              </span>
              <span>เลือกครูที่ลา / ติดราชการ</span>
            </label>
            {selectedAbsentTeachers.length > 1 && (
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 tabular-nums">
                เลือก {selectedAbsentTeachers.length} ท่าน
              </span>
            )}
          </div>

          <select
            id="ta"
            value={primaryTeacherId}
            onChange={(e) => onChangePrimaryTeacherId(e.target.value)}
            className="w-full max-w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
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

          {/* รายชื่อครูที่เลือกในใบเดียวกัน + เพิ่มครูที่ลา */}
          <div className="space-y-2 pt-0.5">
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
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-100"
                    >
                      <button
                        type="button"
                        onClick={() => onViewTeacherTimetable(t.id)}
                        title={`คลิกเพื่อดูตารางสอนของ ${t.id} ${t.n}`}
                        className="inline-flex items-center gap-1 hover:underline cursor-pointer text-left"
                      >
                        <span className="font-mono text-blue-700 dark:text-blue-400 font-bold">
                          {t.id}
                        </span>
                        <span className="font-semibold">{t.n}</span>
                        <span className="text-slate-500 dark:text-slate-400 text-[11px] tabular-nums">
                          · {tClasses.length} คาบ{selectedAbsentTeachers.length > 1 ? ` · ${tReason}` : ""}
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

            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
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
                className="w-full px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              >
                <option value="">
                  + เพิ่มครูที่ลาเพิ่มเติมในใบเดียวกัน...
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
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label
              htmlFor="dt"
              className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-700 text-white text-[11px] font-bold tabular-nums">
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
                  className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700 text-xs font-semibold cursor-pointer hover:bg-amber-100"
                >
                  ปรับปีเป็น พ.ศ. {academicSettings.academicYear}
                </button>
              )}
          </div>

          <div>
            <input
              type="date"
              id="dt"
              value={selectedDate}
              onChange={(e) => onChangeDate(e.target.value)}
              className="block w-full max-w-full min-w-0 appearance-none px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
            />

            {/* ปุ่มลัดเลือกวันจันทร์-ศุกร์ */}
            <div className="grid grid-cols-5 gap-1.5 mt-2 bg-slate-100 dark:bg-slate-800/70 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700">
              {DAYS.map((dayName, idx) => (
                <button
                  key={dayName}
                  type="button"
                  onClick={() => jumpToWeekday(idx)}
                  className={`py-1.5 px-1 rounded-lg text-xs font-semibold text-center transition-all cursor-pointer whitespace-nowrap ${
                    dayIdx === idx
                      ? "bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-xs ring-1 ring-slate-200/80 dark:ring-slate-700"
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {dayName}
                </button>
              ))}
            </div>

            {/* แจ้งเตือนเมื่อวันที่เลือกมีใบสอนแทนบันทึกอยู่ในประวัติแล้ว */}
            {matchingSavedRecordsForDate.length > 0 && (
              <div className="mt-3 p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 space-y-2">
                <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="font-semibold">
                    วันที่ {formatThaiDate(selectedDate)} มีใบสอนแทนในประวัติแล้ว (
                    {matchingSavedRecordsForDate.length} รายการ)
                  </div>
                </div>
                <div className="space-y-1.5">
                  {matchingSavedRecordsForDate.map((rec) => {
                    const recIds = extractRecordTeacherIds(rec);
                    const unmergedIds = recIds.filter((id) => !cleanAbsentIds.includes(id));
                    const isExactSameSelection =
                      recIds.length > 0 &&
                      recIds.length === cleanAbsentIds.length &&
                      unmergedIds.length === 0;
                    const isAlreadyIncluded = recIds.length > 0 && unmergedIds.length === 0;

                    return (
                      <div
                        key={rec.recordId}
                        className="flex flex-wrap items-center justify-between gap-1.5 p-2 rounded-lg bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-amber-800/60 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {/^\d{3}\s/.test(rec.absentTeacherName)
                              ? rec.absentTeacherName
                              : `${rec.absentTeacherId} ${rec.absentTeacherName}`}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400 ml-1">
                            ({rec.reason})
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onLoadSavedRecord(rec);
                              setStatusMsg({
                                text: `โหลดข้อมูลใบสอนแทน "${rec.absentTeacherName}" เรียบร้อยแล้ว`,
                                type: "ok",
                              });
                            }}
                            className="px-2.5 py-1 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <FolderOpen className="w-3 h-3" />
                            <span>เปิดใบเดิม</span>
                          </button>
                          {onMergeSavedRecord && (
                            <button
                              type="button"
                              onClick={() => {
                                onMergeSavedRecord(rec);
                                setStatusMsg({
                                  text: isAlreadyIncluded
                                    ? `บันทึกและอัปเดตใบจัดสอนแทน (${rec.absentTeacherName}) เรียบร้อยแล้ว`
                                    : `รวมรายชื่อครู (${rec.absentTeacherName}) และบันทึกใบจัดสอนแทนอัตโนมัติเรียบร้อยแล้ว`,
                                  type: "ok",
                                });
                              }}
                              title={
                                isAlreadyIncluded
                                  ? "บันทึกและอัปเดตใบจัดสอนแทนปัจจุบันแล้ว (คลิกเพื่อบันทึกซ้ำได้)"
                                  : "นำรายชื่อครูจากใบที่บันทึกไว้ มารวมเข้ากับครูที่เลือกอยู่บนหน้าจอและบันทึกอัตโนมัติทันที"
                              }
                              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                                isAlreadyIncluded
                                  ? "bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700"
                                  : "bg-emerald-700 hover:bg-emerald-800 text-white"
                              }`}
                            >
                              {isAlreadyIncluded ? (
                                <>
                                  <Check className="w-3 h-3" />
                                  <span>
                                    {isExactSameSelection
                                      ? "บันทึกอัตโนมัติแล้ว"
                                      : "รวมและบันทึกแล้ว"}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <GitMerge className="w-3 h-3" />
                                  <span>+ รวมครูเข้าใบเดียวกัน</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* เหตุผล / ภารกิจ */}
          {selectedAbsentTeachers.length <= 1 ? (
            <div>
              <label
                htmlFor="wy"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
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
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
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
                      className={`px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${
                        activeReason === preset
                          ? "bg-blue-700 text-white font-semibold"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium"
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  เหตุผล / ภารกิจ แยกรายบุคคล
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
                      className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/80 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor={`wy-${t.id}`}
                          className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5"
                        >
                          <span className="font-mono text-blue-700 dark:text-blue-400">
                            {t.id}
                          </span>
                          <span>{t.n}</span>
                        </label>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
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
                        placeholder="พิมพ์เหตุผลการลา..."
                        className="w-full px-2.5 py-1.5 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
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
                            className={`px-2 py-0.5 rounded-md text-[11px] transition-colors cursor-pointer ${
                              currentTeacherReason === preset
                                ? "bg-blue-700 text-white font-semibold"
                                : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900"
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      {onApplyLeavePeriodMode && (
                        <div className="flex items-center gap-1 flex-wrap pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>ช่วงเวลา:</span>
                          </span>
                          {(
                            [
                              { mode: "full" as const, label: "เต็มวัน" },
                              { mode: "morning" as const, label: "ครึ่งเช้า (1-4)" },
                              { mode: "afternoon" as const, label: "ครึ่งบ่าย (5-7)" },
                            ]
                          ).map((item) => {
                            const tLeaveMode = detectLeavePeriodMode(
                              absentTeacherIds,
                              selectedDate,
                              assignments,
                              t.id,
                              includeSupervision
                            );
                            return (
                              <button
                                key={item.mode}
                                type="button"
                                onClick={() => onApplyLeavePeriodMode(item.mode, t.id)}
                                className={`px-2 py-0.5 rounded-md text-[11px] transition-colors cursor-pointer ${
                                  tLeaveMode === item.mode
                                    ? "bg-emerald-700 text-white font-semibold"
                                    : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                                }`}
                              >
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  ตั้งเหมือนกันทั้งหมด:
                </span>
                {REASON_PRESETS.map((preset) => (
                  <button
                    key={`all-${preset}`}
                    type="button"
                    onClick={() => onChangeReason(preset)}
                    className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 font-semibold cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ช่องระบุชื่อ นศ.ฝึกสอน เพิ่มเติม */}
          {hasCustomStudentTeacherSelected && (
            <div>
              <label
                htmlFor="sn"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                ระบุชื่อนักศึกษาฝึกสอน
              </label>
              <input
                type="text"
                id="sn"
                value={studentTeacherName}
                onChange={(e) => onChangeStudentTeacherName(e.target.value)}
                placeholder="พิมพ์ชื่อ-สกุล นักศึกษาฝึกสอน"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
              />
            </div>
          )}

          {/* ตัวเลือกเสริมสำหรับฝ่ายบริหารที่มีคาบนิเทศสอน */}
          {hasSupervisionSlots && (
            <label className="flex items-center gap-2 pt-1 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSupervision}
                onChange={(e) => onChangeIncludeSupervision(e.target.checked)}
                className="rounded border-slate-300 text-blue-700"
              />
              <span>รวมคาบนิเทศสอนในใบมอบหมายงานด้วย</span>
            </label>
          )}
        </div>

        {/* ขั้นตอนที่ 3: รายการคาบสอนที่ต้องจัดคนแทน */}
        <div
          id="plan"
          className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-700 text-white text-[11px] font-bold tabular-nums">
                3
              </span>
              <span>ตรวจสอบ / เลือกครูสอนแทนรายคาบ</span>
            </div>
            <button
              type="button"
              id="au"
              onClick={onResetAutoAssign}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 hover:bg-blue-700 hover:text-white font-semibold text-xs transition-colors cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3 h-3 shrink-0" />
              <span>จัดอัตโนมัติใหม่</span>
            </button>
          </div>

          {selectedAbsentTeachers.length === 0 ? (
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              กรุณาเลือกครูที่ลาในขั้นตอนที่ 1
            </p>
          ) : !selectedDate ? (
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              กรุณาเลือกวันที่ต้องการจัดสอนแทน
            </p>
          ) : dayIdx < 0 ? (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60">
              <p className="text-red-700 dark:text-red-300 font-semibold text-sm">
                วันที่เลือกตรงกับวันเสาร์–อาทิตย์ ไม่มีคาบสอน กรุณาเลือกวันจันทร์–ศุกร์
              </p>
            </div>
          ) : combinedClasses.length === 0 ? (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <p className="text-slate-800 dark:text-slate-100 font-semibold text-sm">
                <b>{selectedAbsentTeachers.map((t) => t.n).join(", ")}</b>{" "}
                {studentCoveredClasses.length > 0
                  ? `ไม่ต้องจัดสอนแทนในวัน${DAYS[dayIdx]} (นักศึกษาฝึกสอนสอนประจำวิชาแล้ว)`
                  : `ไม่มีคาบสอนวิชาปกติในวัน${DAYS[dayIdx]}`}
              </p>
              {studentCoveredClasses.length > 0 && (
                <div className="text-xs text-emerald-700 dark:text-emerald-400 space-y-0.5 pt-1 border-t border-slate-200 dark:border-slate-700">
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
              {/* ปุ่มลัดเลือกช่วงเวลาการลา */}
              {onApplyLeavePeriodMode && (
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>ช่วงเวลาจัดสอนแทน</span>
                    </span>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                      จัดแทน {docRows.length} / {combinedClasses.length} คาบ
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 bg-slate-200/70 dark:bg-slate-800 p-0.5 rounded-lg">
                    {(
                      [
                        { mode: "full" as const, label: "เต็มวัน (ทุกคาบ)" },
                        { mode: "morning" as const, label: "ครึ่งเช้า (1–4)" },
                        { mode: "afternoon" as const, label: "ครึ่งบ่าย (5–7)" },
                      ]
                    ).map((item) => (
                      <button
                        key={item.mode}
                        type="button"
                        onClick={() => onApplyLeavePeriodMode(item.mode)}
                        className={`py-1.5 px-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer text-center whitespace-nowrap ${
                          overallLeaveMode === item.mode
                            ? "bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-2xs"
                            : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* แจ้งเตือนกรณีผู้ใช้เลือกครูสอนแทนชนกันในคาบเดียวกัน */}
              {doubleBookingConflicts.length > 0 && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-1.5 text-xs text-red-800 dark:text-red-200 font-bold">
                      <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                      <span>
                        พบการเลือกครูสอนแทนซ้ำในคาบเดียวกัน ({doubleBookingConflicts.length} คาบ):
                      </span>
                    </div>
                    {onResolveDoubleBooking && (
                      <button
                        type="button"
                        onClick={onResolveDoubleBooking}
                        className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shrink-0 cursor-pointer"
                      >
                        แก้คาบชนอัตโนมัติ
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-red-700 dark:text-red-300 space-y-0.5 pl-5">
                    {doubleBookingConflicts.map((conf) => (
                      <div key={`${conf.periodIndex}_${conf.substituteTeacherId}`}>
                        • คาบที่ {conf.periodNumber}: <b>{conf.substituteTeacherName}</b> ถูกเลือกซ้ำในห้อง{" "}
                        {conf.slots.map((s) => `ม.${s.cls} (แทน ${s.absentTeacherName})`).join(" และ ")}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {selectedAbsentTeachers.length === 1 ? (
                  <>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedAbsentTeachers[0].n}
                    </span>{" "}
                    · {combinedClasses.length} คาบ · วัน{DAYS[dayIdx]} ({formatThaiDate(selectedDate)})
                  </>
                ) : (
                  <>
                    รวม{" "}
                    <b className="text-slate-900 dark:text-slate-100">
                      {combinedClasses.length} คาบ
                    </b>{" "}
                    ในวัน{DAYS[dayIdx]} (ครูลา {selectedAbsentTeachers.length} ท่าน)
                  </>
                )}
              </div>

              {studentCoveredClasses.length > 0 && (
                <div className="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-800 dark:text-emerald-300 space-y-0.5">
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
                const otherSlotBySubIdInSamePeriod = new Map<number, CombinedClassSlot>();
                combinedClasses.forEach((otherSlot) => {
                  if (otherSlot.slotKey === slot.slotKey) return;
                  if (otherSlot.p !== slot.p) return;
                  const val = getSlotAssignment(
                    assignments,
                    otherSlot.absentTeacherId,
                    otherSlot.p
                  );
                  if (val && val !== "skip" && val.startsWith("t")) {
                    const tid = Number(val.slice(1));
                    if (Number.isFinite(tid)) {
                      otherSlotBySubIdInSamePeriod.set(tid, otherSlot);
                    }
                  }
                });

                const candidates = getCandidateTeachers(
                  slot.absentTeacherId,
                  selectedDate,
                  slot.p,
                  allAbsentNumericIds,
                  slot.cls
                );
                const gradeNum = extractGradeLevel(slot.cls);
                const gradeLabel = gradeNum ? `ม.${gradeNum}` : slot.cls;

                const getBusyWarningLabel = (teacherId: number) => {
                  const busySlot = otherSlotBySubIdInSamePeriod.get(teacherId);
                  if (!busySlot) return "";
                  return ` ⚠️ [ติดสอนแทน ม.${busySlot.cls} คาบนี้แล้ว]`;
                };

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
                const isSkipped = currentVal === "skip";
                const currentSubNumId =
                  !isSkipped && currentVal.startsWith("t")
                    ? Number(currentVal.slice(1))
                    : 0;
                const isDoubleBookedSlot =
                  currentSubNumId > 0 && otherSlotBySubIdInSamePeriod.has(currentSubNumId);

                const subjectTitle = getSubjectNameFromCourse(
                  slot.code,
                  slot.absentTeacherPdfGroup || slot.absentTeacherGroup,
                  slot.absentTeacherId
                );

                return (
                  <div
                    key={slot.slotKey}
                    className={`p-3 rounded-xl border space-y-2 transition-colors ${
                      isSkipped
                        ? "bg-slate-50 dark:bg-slate-900/30 border-dashed border-slate-300 dark:border-slate-700 opacity-75"
                        : isDoubleBookedSlot
                        ? "bg-red-50/70 dark:bg-red-950/30 border-red-300 dark:border-red-700"
                        : "bg-slate-50/60 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700/80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 text-xs sm:text-sm">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`font-bold text-xs tabular-nums ${
                              isSkipped
                                ? "text-slate-400 line-through"
                                : "text-blue-700 dark:text-blue-400"
                            }`}
                          >
                            คาบที่ {slot.p + 1}
                          </span>
                          <span className="text-[11px] text-slate-400 tabular-nums">
                            ({slot.tm})
                          </span>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <span className="font-mono font-bold text-xs text-slate-800 dark:text-slate-200">
                            {slot.code}
                          </span>
                          <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                            {subjectTitle}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            ชั้น ม.{slot.cls}
                          </span>
                          <span>·</span>
                          <span>{formatRoomLabel(slot.room)}</span>
                          {selectedAbsentTeachers.length > 1 && (
                            <>
                              <span>·</span>
                              <span className="font-medium text-amber-700 dark:text-amber-300">
                                แทน {slot.absentTeacherName} (
                                {resolveTeacherReason(
                                  slot.absentTeacherId,
                                  reason,
                                  teacherReasons
                                )}
                                )
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (isSkipped) {
                            const firstAvail = candidates.find(
                              (c) => !otherSlotBySubIdInSamePeriod.has(c.id)
                            );
                            onChangeAssignment(
                              slot.slotKey,
                              slot.p,
                              firstAvail ? `t${firstAvail.id}` : "s"
                            );
                          } else {
                            onChangeAssignment(slot.slotKey, slot.p, "skip");
                          }
                        }}
                        title={
                          isSkipped
                            ? "นำคาบนี้กลับมาจัดครูสอนแทน"
                            : "ตัดคาบนี้ออก (กรณีครูผู้สอนมาสอนเองในคาบนี้ / ลาไม่เต็มวัน)"
                        }
                        className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                          isSkipped
                            ? "bg-blue-700 text-white hover:bg-blue-800"
                            : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 border border-slate-200 dark:border-slate-700"
                        }`}
                      >
                        <Ban className="w-3 h-3" />
                        <span>{isSkipped ? "นำกลับมาจัด" : "ครูสอนเอง"}</span>
                      </button>
                    </div>

                    <select
                      data-p={slot.p}
                      data-slot={slot.slotKey}
                      aria-label={`ครูสอนแทนคาบ ${slot.p + 1} (${slot.code})`}
                      value={currentVal}
                      onChange={(e) =>
                        onChangeAssignment(slot.slotKey, slot.p, e.target.value)
                      }
                      className={`w-full max-w-full px-2.5 py-1.5 rounded-lg border text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 ${
                        isSkipped
                          ? "border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400"
                          : isDoubleBookedSlot
                          ? "border-red-400 dark:border-red-600 bg-white dark:bg-slate-900 text-red-700 dark:text-red-300"
                          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      }`}
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
                                {t.id} {t.n} (สอนต่อเนื่อง ม.{slot.cls} จากคาบ {contInfo.prevPeriodNumber} วิชา{contInfo.prevSubjectName} · {t.pdfGroup}{getSubCountSuffix(t.id)}){getBusyWarningLabel(t.id)}
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
                                {t.id} {t.n} (สอน {exact ? `ม.${slot.cls}` : gradeLabel} · กลุ่มสาระ{t.pdfGroup}{getSubCountSuffix(t.id)}){getBusyWarningLabel(t.id)}
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
                                {t.id} {t.n} (สอน {exact ? `ม.${slot.cls}` : gradeLabel} · {t.pdfGroup}{getSubCountSuffix(t.id)}){getBusyWarningLabel(t.id)}
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
                              {t.id} {t.n} (กลุ่มสาระ{t.pdfGroup} · สอน {formatTeacherGradesSummary(t)}{getSubCountSuffix(t.id)}){getBusyWarningLabel(t.id)}
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
                                {t.pdfGroup}{getSubCountSuffix(t.id)}){getBusyWarningLabel(t.id)}
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
                              {t.id} {t.n} ({t.pdfGroup} · สอน {formatTeacherGradesSummary(t)}{getSubCountSuffix(t.id)}){getBusyWarningLabel(t.id)}
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
                        <option value="skip">
                          ✖ ไม่ลาคาบนี้ / ครูผู้สอนสอนเอง (ตัดออกจากใบสอนแทน)
                        </option>
                      </optgroup>
                    </select>
                  </div>
                );
              })}
            </div>
          )}

          {/* ปุ่มคัดลอกแจ้ง LINE และปุ่มบันทึกประวัติลงฐานข้อมูล */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2">
            <button
              type="button"
              id="btn-copy-line"
              disabled={!canExport}
              onClick={handleCopyLineNotification}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 disabled:opacity-40 font-semibold text-xs sm:text-sm transition-colors cursor-pointer whitespace-nowrap"
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
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white font-semibold text-xs sm:text-sm transition-colors cursor-pointer shadow-2xs whitespace-nowrap"
            >
              <Save className="w-4 h-4 shrink-0" />
              <span>{isSavingRecord ? "กำลังบันทึก..." : "บันทึกประวัติ"}</span>
            </button>
          </div>
        </div>

        {/* รายการใบสอนแทนที่บันทึกไว้ล่าสุด */}
        {savedRecords.length > 0 && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                ประวัติที่บันทึกไว้ล่าสุด ({savedRecords.length})
              </span>
              <button
                type="button"
                onClick={onOpenDatabaseTab}
                className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
              >
                จัดการทั้งหมด
              </button>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {savedRecords.slice(0, 4).map((rec) => (
                <div
                  key={rec.recordId}
                  className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-xs"
                >
                  <div className="min-w-0 truncate">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {/^\d{3}\s/.test(rec.absentTeacherName)
                        ? rec.absentTeacherName
                        : `${rec.absentTeacherId} ${rec.absentTeacherName}`}
                    </span>{" "}
                    <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                      · {formatThaiDate(rec.selectedDate)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onLoadSavedRecord(rec)}
                      title="โหลดมาแก้ไข"
                      className="px-2 py-0.5 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <FolderOpen className="w-3 h-3" />
                      <span>เปิด</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedRecord(rec.recordId)}
                      title="ลบ"
                      className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/60 cursor-pointer"
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

      {/* แผงแสดงตัวอย่างเอกสารใบสอนแทน (A4 Studio Preview) ด้านขวา */}
      <section className="min-w-0 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6 shadow-xs flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100 dark:border-slate-800 print:hidden">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              ตัวอย่างแบบบันทึกการจัดสอนแทน
            </h2>
            {selectedAbsentTeachers.length > 1 && (
              <span className="text-xs font-medium text-blue-700 dark:text-blue-400 tabular-nums">
                · รวม {selectedAbsentTeachers.length} ท่าน
              </span>
            )}
            {previewDataUrl && (
              <button
                type="button"
                onClick={() => setFullscreenImageOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium cursor-pointer whitespace-nowrap shrink-0 text-xs transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>ขยายเต็มจอ</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 sm:flex items-center gap-2 shrink-0">
            <button
              type="button"
              id="bw"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("word")}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span>Word (.docx)</span>
            </button>
            <button
              type="button"
              id="bp"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("pdf")}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
            >
              <FileDown className="w-4 h-4 shrink-0" />
              <span>PDF</span>
            </button>
            <button
              type="button"
              id="bi"
              disabled={!canExport || isExporting}
              onClick={() => handleExport("image")}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ImageIcon className="w-4 h-4 shrink-0 text-blue-700 dark:text-blue-400" />
              <span>รูปภาพ</span>
            </button>
          </div>
        </div>

        {statusMsg.text && (
          <div
            id="msg"
            role="status"
            className={`mb-4 px-3.5 py-2 rounded-lg text-sm font-medium print:hidden border ${
              statusMsg.type === "err"
                ? "bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300"
                : statusMsg.type === "ok"
                ? "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300"
                : "bg-blue-50/70 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300"
            }`}
          >
            {statusMsg.text}
          </div>
        )}

        {/* กระดาษ A4 แนวนอน ตัวอย่างแบบบันทึกการจัดสอนแทนบน Studio Drafting Desk */}
        <div className="studio-desk-bg p-3 sm:p-5 md:p-7 rounded-xl border border-slate-200/80 dark:border-slate-800 print:p-0 print:bg-white print:border-0">
          <div
            id="paper"
            ref={paperRef}
            className="paper-sheet w-full max-w-[1123px] bg-white text-black mx-auto shadow-[0_12px_32px_-8px_rgba(15,23,42,0.18),0_2px_8px_rgba(15,23,42,0.06)] print:shadow-none relative overflow-hidden rounded-sm"
          >
            {!combinedHeaderTeacher || dayIdx < 0 || docRows.length === 0 ? (
              <div className="text-center py-28 sm:py-36 px-6 text-slate-500 min-h-[540px] flex flex-col items-center justify-center bg-white">
                <div className="flex items-center justify-center gap-6 mb-5 opacity-80">
                  <img
                    src={LEFT_SCHOOL_LOGO_URL}
                    alt="ตราโรงเรียนวรคุณอุปถัมภ์"
                    referrerPolicy="no-referrer"
                    className="h-[80px] w-auto object-contain"
                  />
                  <img
                    src={RIGHT_OBEC_LOGO_URL}
                    alt="ตราสำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน"
                    referrerPolicy="no-referrer"
                    className="h-[74px] w-auto object-contain"
                  />
                </div>
                <p className="text-lg sm:text-xl font-semibold text-slate-800 max-w-md text-balance">
                  เลือกครูและวันที่ที่มีคาบสอน เพื่อแสดงแบบบันทึกการจัดสอนแทน
                </p>
                <p className="text-sm mt-2 text-slate-500">
                  โรงเรียนวรคุณอุปถัมภ์ · {formatThaiMonthYearHeader(selectedDate)}
                </p>
              </div>
            ) : (
              <>
                {previewPages.length > 0 && (
                  <div className="space-y-5">
                    {previewPages.map((pageUrl, pIdx) => (
                      <div
                        key={pIdx}
                        className="relative bg-white shadow-sm rounded-sm overflow-hidden"
                      >
                        {previewPages.length > 1 && (
                          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 print:hidden">
                            <span className="tabular-nums">
                              หน้า {pIdx + 1} จาก {previewPages.length}
                            </span>
                            <button
                              type="button"
                              disabled={isExporting}
                              onClick={() => handleDownloadSinglePage(pIdx)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-blue-700 dark:text-blue-400 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
                              title={`ดาวน์โหลดเฉพาะรูปภาพหน้า ${pIdx + 1}`}
                            >
                              <ImageIcon className="w-3.5 h-3.5 shrink-0" />
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
                      alt="ตราสำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน"
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
          className="fixed inset-0 z-50 bg-slate-950/90 flex flex-col items-center justify-start p-3 sm:p-6 overflow-y-auto"
        >
          <div className="w-full max-w-[1123px] flex flex-wrap items-center justify-between gap-2 mb-4 text-white sticky top-0 z-10 bg-slate-900/90 backdrop-blur-md py-2.5 px-4 rounded-xl border border-white/10">
            <span className="text-xs sm:text-sm font-semibold tabular-nums">
              {previewPages.length > 1
                ? `แบบบันทึกการจัดสอนแทน (${previewPages.length} หน้า · ความละเอียดสูง)`
                : "แบบบันทึกการจัดสอนแทน (ความละเอียดสูง)"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isExporting}
                onClick={() => handleExport("image")}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold cursor-pointer shrink-0 whitespace-nowrap transition-colors"
              >
                <ImageIcon className="w-4 h-4" />
                <span>ดาวน์โหลดรูปชัดพิเศษ (Ultra HD)</span>
              </button>
              <button
                type="button"
                onClick={() => setFullscreenImageOpen(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-semibold cursor-pointer shrink-0 whitespace-nowrap transition-colors"
              >
                <X className="w-4 h-4" />
                <span>ปิด</span>
              </button>
            </div>
          </div>
          <div className="w-full max-w-[1123px] space-y-5">
            {(previewPages.length > 0 ? previewPages : [previewDataUrl]).map((pageUrl, pIdx) => (
              <div key={pIdx} className="bg-white rounded-lg overflow-hidden shadow-2xl">
                {previewPages.length > 1 && (
                  <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 text-slate-800 text-xs font-medium border-b border-slate-200">
                    <span className="tabular-nums">หน้า {pIdx + 1} จาก {previewPages.length}</span>
                    <button
                      type="button"
                      onClick={() => handleDownloadSinglePage(pIdx)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-blue-700 text-white hover:bg-blue-800 text-xs font-semibold cursor-pointer whitespace-nowrap"
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
