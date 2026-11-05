import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Cloud,
  Database,
  Edit3,
  FileText,
  Plus,
  Search,
  Trash2,
  Table2,
  CheckCircle2,
  AlertTriangle,
  BookOpen,
  X,
  Check,
  Calendar,
  Save,
  Upload,
  Download,
  ClipboardPaste,
  Copy,
  RefreshCw,
  BarChart3,
  UserCheck,
} from "lucide-react";
import { DEPARTMENT_GROUPS, TeacherRecord } from "../data/teachers";
import {
  buildSemesterCourseCodeShiftMap,
  computeSubstituteStatistics,
  exportSubjectsToCsv,
  exportSubstituteStatsToCsv,
  exportTeachersToCsv,
  formatRoomLabel,
  formatSubjectsForBulkText,
  formatThaiDate,
  getAllDiscoveredSubjectCodes,
  parseBulkSubjectLines,
  parseTeachersFromCsv,
  resolveSubstitute,
  SubjectCodeInfo,
} from "../utils/scheduler";
import {
  AcademicSettings,
  DEFAULT_ACADEMIC_SETTINGS,
  SavedSubstituteRecord,
} from "../utils/databaseStore";

interface DatabaseManagerViewProps {
  teachers: TeacherRecord[];
  savedRecords: SavedSubstituteRecord[];
  subjectMappings: Record<string, string>;
  academicSettings: AcademicSettings;
  onSaveAcademicSettings: (settings: AcademicSettings) => Promise<void>;
  onOpenAddTeacher: () => void;
  onOpenEditTeacher: (teacher: TeacherRecord) => void;
  onDeleteTeacher: (teacherId: number) => Promise<void>;
  onResetDefaultTeachers: () => Promise<void>;
  onBulkSaveTeachers?: (nextTeachers: TeacherRecord[]) => Promise<void>;
  onLoadSubstituteRecord: (record: SavedSubstituteRecord) => void;
  onDeleteSubstituteRecord: (recordId: string) => Promise<void>;
  onClearAllSubstituteRecords: () => Promise<void>;
  onViewTeacherTimetable: (teacherId: number) => void;
  onSaveSubjectMappings: (newMappings: Record<string, string>) => Promise<void>;
  onResetSubjectMappings: () => Promise<void>;
  onBulkRenameCourseCodes?: (
    codeRenames: Record<string, string>,
    extraMappings?: Record<string, string>
  ) => Promise<{ replacedSlotCount: number; affectedTeachersCount: number }>;
}

const QUICK_ACADEMIC_YEARS = ["2568", "2569", "2570", "2571", "2572", "2573"];
const QUICK_SEMESTERS = [
  { value: "1", label: "ภาคเรียนที่ 1" },
  { value: "2", label: "ภาคเรียนที่ 2" },
  { value: "ฤดูร้อน", label: "ภาคฤดูร้อน" },
];

export const DatabaseManagerView: React.FC<DatabaseManagerViewProps> = ({
  teachers,
  savedRecords,
  subjectMappings,
  academicSettings = DEFAULT_ACADEMIC_SETTINGS,
  onSaveAcademicSettings,
  onOpenAddTeacher,
  onOpenEditTeacher,
  onDeleteTeacher,
  onResetDefaultTeachers,
  onBulkSaveTeachers,
  onLoadSubstituteRecord,
  onDeleteSubstituteRecord,
  onClearAllSubstituteRecords,
  onViewTeacherTimetable,
  onSaveSubjectMappings,
  onResetSubjectMappings,
  onBulkRenameCourseCodes,
}) => {
  const [subTab, setSubTab] = useState<"teachers" | "subjects" | "records">("teachers");
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const teacherCsvFileInputRef = useRef<HTMLInputElement | null>(null);

  // State สำหรับตั้งค่าปีการศึกษา ภาคเรียน และผู้ลงนามท้ายใบสอนแทน
  const [yearInput, setYearInput] = useState<string>(academicSettings.academicYear);
  const [semesterInput, setSemesterInput] = useState<string>(academicSettings.semester);
  const [plannerNameInput, setPlannerNameInput] = useState<string>(
    academicSettings.plannerName
  );
  const [plannerPositionInput, setPlannerPositionInput] = useState<string>(
    academicSettings.plannerPosition
  );
  const [approverNameInput, setApproverNameInput] = useState<string>(
    academicSettings.approverName
  );
  const [approverPositionInput, setApproverPositionInput] = useState<string>(
    academicSettings.approverPosition
  );

  useEffect(() => {
    setYearInput(academicSettings.academicYear);
    setSemesterInput(academicSettings.semester);
    setPlannerNameInput(academicSettings.plannerName);
    setPlannerPositionInput(academicSettings.plannerPosition);
    setApproverNameInput(academicSettings.approverName);
    setApproverPositionInput(academicSettings.approverPosition);
  }, [
    academicSettings.academicYear,
    academicSettings.semester,
    academicSettings.plannerName,
    academicSettings.plannerPosition,
    academicSettings.approverName,
    academicSettings.approverPosition,
  ]);

  // State สำหรับครู
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterGroup, setFilterGroup] = useState<string>("ทั้งหมด");
  const [confirmDeleteTeacher, setConfirmDeleteTeacher] = useState<TeacherRecord | null>(null);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);

  // State สำหรับประวัติใบสอนแทน
  const [confirmDeleteRecordId, setConfirmDeleteRecordId] = useState<string | null>(null);
  const [confirmClearAllRecords, setConfirmClearAllRecords] = useState<boolean>(false);

  // State สำหรับรหัสวิชา & ชื่อวิชา (รองรับทั้งแก้ในตารางทันที, วางจาก Excel, และนำเข้า/ส่งออก CSV)
  const [subjectSearch, setSubjectSearch] = useState<string>("");
  const [subjectCategoryFilter, setSubjectCategoryFilter] = useState<string>("ทั้งหมด");
  const [editingSubject, setEditingSubject] = useState<SubjectCodeInfo | null>(null);
  const [editSubjectNameInput, setEditSubjectNameInput] = useState<string>("");
  const [isAddingSubject, setIsAddingSubject] = useState<boolean>(false);
  const [newSubjectCode, setNewSubjectCode] = useState<string>("");
  const [newSubjectName, setNewSubjectName] = useState<string>("");
  const [confirmResetSubjects, setConfirmResetSubjects] = useState<boolean>(false);

  // Inline Edits ในตารางรหัสวิชาและชื่อวิชา (แก้หลายสิบ/หลายร้อยวิชาพร้อมกันแล้วกดบันทึกทีเดียวได้)
  const [inlineNameDrafts, setInlineNameDrafts] = useState<Record<string, string>>({});
  const [inlineCodeDrafts, setInlineCodeDrafts] = useState<Record<string, string>>({});

  // Bulk Paste / Spreadsheet Modal
  const [isBulkModalOpen, setIsBulkModalOpen] = useState<boolean>(false);
  const [bulkTextInput, setBulkTextInput] = useState<string>("");

  // Semester Course Code Shift Confirmation
  const [pendingSemesterShift, setPendingSemesterShift] = useState<"1" | "2" | null>(null);

  // Status message
  const [statusBanner, setStatusBanner] = useState<{ text: string; type: "ok" | "err" } | null>(
    null
  );
  const [busy, setBusy] = useState<boolean>(false);

  const regularCount = teachers.filter((t) => !t.isStudentTeacher).length;
  const studentCount = teachers.filter((t) => Boolean(t.isStudentTeacher)).length;

  // รายการรหัสวิชาทั้งหมดที่ค้นพบในระบบ
  const discoveredSubjects = useMemo(
    () => getAllDiscoveredSubjectCodes(),
    [teachers, subjectMappings]
  );
  const customSubjectsCount = Object.keys(subjectMappings).length;

  const filteredTeachers = teachers.filter((t) => {
    const matchGroup =
      filterGroup === "ทั้งหมด" ||
      (filterGroup === "นักศึกษาฝึกสอน" ? Boolean(t.isStudentTeacher) : t.g === filterGroup);
    if (!matchGroup) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      String(t.id).includes(q) ||
      t.n.toLowerCase().includes(q) ||
      t.pdfGroup.toLowerCase().includes(q) ||
      t.r.toLowerCase().includes(q)
    );
  });

  const filteredDiscoveredSubjects = discoveredSubjects.filter((item) => {
    if (subjectCategoryFilter === "แก้ไขแล้ว" && !item.isCustom) return false;
    if (subjectCategoryFilter === "วิทยาศาสตร์ (ว)" && !item.code.startsWith("ว")) return false;
    if (subjectCategoryFilter === "คณิตศาสตร์ (ค)" && !item.code.startsWith("ค")) return false;
    if (subjectCategoryFilter === "ภาษาไทย (ท)" && !item.code.startsWith("ท")) return false;
    if (subjectCategoryFilter === "สังคมศึกษา (ส)" && !item.code.startsWith("ส")) return false;
    if (
      subjectCategoryFilter === "ภาษาต่างประเทศ (อ/จ)" &&
      !item.code.startsWith("อ") &&
      !item.code.startsWith("จ")
    )
      return false;
    if (subjectCategoryFilter === "สุขศึกษา/พลศึกษา (พ)" && !item.code.startsWith("พ")) return false;
    if (subjectCategoryFilter === "ศิลปะ (ศ)" && !item.code.startsWith("ศ")) return false;
    if (subjectCategoryFilter === "การงานอาชีพ (ง)" && !item.code.startsWith("ง")) return false;
    if (
      subjectCategoryFilter === "กิจกรรม/IS" &&
      !item.code.startsWith("I") &&
      !item.code.startsWith("#")
    )
      return false;

    const q = subjectSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      item.code.toLowerCase().includes(q) ||
      item.currentName.toLowerCase().includes(q) ||
      item.defaultName.toLowerCase().includes(q) ||
      item.teacherNames.some((tn) => tn.toLowerCase().includes(q))
    );
  });

  // สถิติการสอนแทนและการลาสะสม
  const substituteStats = useMemo(
    () => computeSubstituteStatistics(savedRecords, teachers),
    [savedRecords, teachers]
  );

  const handleExportStatsCsv = () => {
    const csvContent = exportSubstituteStatsToCsv(
      substituteStats.sortedList,
      academicSettings.academicYear,
      academicSettings.semester
    );
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `สถิติการสอนแทนและการลา_รร.วรคุณอุปถัมภ์_${academicSettings.academicYear}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusBanner({
      text: "ดาวน์โหลดไฟล์สรุปสถิติการสอนแทนและการลา (.csv) เรียบร้อยแล้ว",
      type: "ok",
    });
  };

  // บันทึกปีการศึกษา ภาคเรียน และผู้ลงนามท้ายเอกสาร
  const handleSaveAcademicYearAndSemester = async (
    overrideYear?: string,
    overrideSemester?: string
  ) => {
    const cleanYear = String(overrideYear ?? yearInput).trim();
    const parsedYear = parseInt(cleanYear, 10);
    if (!Number.isFinite(parsedYear) || parsedYear < 2500 || parsedYear > 2699) {
      setStatusBanner({
        text: "กรุณาระบุปีการศึกษา (พ.ศ.) เป็นตัวเลข 4 หลัก เช่น 2569, 2570",
        type: "err",
      });
      return;
    }
    const cleanSemester = String(overrideSemester ?? semesterInput).trim() || "2";
    const cleanPlannerName =
      plannerNameInput.trim() || DEFAULT_ACADEMIC_SETTINGS.plannerName;
    const cleanPlannerPos =
      plannerPositionInput.trim() || DEFAULT_ACADEMIC_SETTINGS.plannerPosition;
    const cleanApproverName =
      approverNameInput.trim() || DEFAULT_ACADEMIC_SETTINGS.approverName;
    const cleanApproverPos =
      approverPositionInput.trim() || DEFAULT_ACADEMIC_SETTINGS.approverPosition;

    try {
      setBusy(true);
      await onSaveAcademicSettings({
        academicYear: String(parsedYear),
        semester: cleanSemester,
        plannerName: cleanPlannerName,
        plannerPosition: cleanPlannerPos,
        approverName: cleanApproverName,
        approverPosition: cleanApproverPos,
      });
      const semText =
        cleanSemester === "ฤดูร้อน" ? "ภาคฤดูร้อน" : `ภาคเรียนที่ ${cleanSemester}`;
      setStatusBanner({
        text: `บันทึกการตั้งค่า (${semText} ปีการศึกษา ${parsedYear} และผู้ลงนามท้ายใบสอนแทน) เรียบร้อยแล้ว`,
        type: "ok",
      });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "บันทึกการตั้งค่าไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // ลบครู
  const handleConfirmDeleteTeacher = async () => {
    if (!confirmDeleteTeacher) return;
    try {
      setBusy(true);
      const targetName = `${confirmDeleteTeacher.id} ${confirmDeleteTeacher.n}`;
      await onDeleteTeacher(confirmDeleteTeacher.id);
      setConfirmDeleteTeacher(null);
      setStatusBanner({ text: `ลบข้อมูล "${targetName}" และบันทึกอัตโนมัติเรียบร้อยแล้ว`, type: "ok" });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "ลบข้อมูลไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // รีเซ็ตครู
  const handleConfirmReset = async () => {
    try {
      setBusy(true);
      await onResetDefaultTeachers();
      setConfirmReset(false);
      setStatusBanner({
        text: "กู้คืนข้อมูลครูและนักศึกษาฝึกสอนทั้ง 31 ท่านจาก PDF และซิงก์อัตโนมัติเรียบร้อยแล้ว",
        type: "ok",
      });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "กู้คืนข้อมูลไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // ลบใบสอนแทน
  const handleConfirmDeleteRecord = async (recordId: string) => {
    try {
      setBusy(true);
      await onDeleteSubstituteRecord(recordId);
      setConfirmDeleteRecordId(null);
      setStatusBanner({ text: "ลบประวัติใบสอนแทนและอัปเดตฐานข้อมูลกลางเรียบร้อยแล้ว", type: "ok" });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "ลบใบสอนแทนไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // ล้างประวัติใบสอนแทนทั้งหมด
  const handleConfirmClearAllRecords = async () => {
    try {
      setBusy(true);
      await onClearAllSubstituteRecords();
      setConfirmClearAllRecords(false);
      setStatusBanner({
        text: "ล้างประวัติใบสอนแทนทั้งหมดเรียบร้อยแล้ว พร้อมสำหรับเริ่มปีการศึกษา/ภาคเรียนใหม่",
        type: "ok",
      });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "ล้างประวัติไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // เปิด modal แก้ไขชื่อวิชา
  const handleOpenEditSubject = (subject: SubjectCodeInfo) => {
    setEditingSubject(subject);
    setEditSubjectNameInput(subject.currentName);
  };

  // บันทึกชื่อวิชา
  const handleSaveSingleSubject = async () => {
    if (!editingSubject) return;
    const cleanName = editSubjectNameInput.trim();
    if (!cleanName) return;

    try {
      setBusy(true);
      const nextMappings = {
        ...subjectMappings,
        [editingSubject.code]: cleanName,
      };
      await onSaveSubjectMappings(nextMappings);
      setEditingSubject(null);
      setStatusBanner({
        text: `อัปเดตชื่อวิชาสำหรับรหัส "${editingSubject.code}" เป็น "${cleanName}" เรียบร้อยแล้ว`,
        type: "ok",
      });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "บันทึกชื่อวิชาไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // รีเซ็ตรหัสวิชาเดียวกลับเป็นค่าเริ่มต้น
  const handleResetSingleSubject = async (code: string) => {
    try {
      setBusy(true);
      const nextMappings = { ...subjectMappings };
      delete nextMappings[code];
      await onSaveSubjectMappings(nextMappings);
      setStatusBanner({
        text: `คืนค่าเริ่มต้นสำหรับรหัสวิชา "${code}" เรียบร้อยแล้ว`,
        type: "ok",
      });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "คืนค่าชื่อวิชาไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // เพิ่มรหัสวิชาใหม่
  const handleAddNewSubject = async () => {
    const code = newSubjectCode.trim();
    const name = newSubjectName.trim();
    if (!code || !name) return;

    try {
      setBusy(true);
      const nextMappings = {
        ...subjectMappings,
        [code]: name,
      };
      await onSaveSubjectMappings(nextMappings);
      setIsAddingSubject(false);
      setNewSubjectCode("");
      setNewSubjectName("");
      setStatusBanner({
        text: `เพิ่มผูกรหัสวิชา "${code}" -> "${name}" เรียบร้อยแล้ว`,
        type: "ok",
      });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "เพิ่มรหัสวิชาไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // รีเซ็ตรหัสวิชาทั้งหมด
  const handleConfirmResetAllSubjects = async () => {
    try {
      setBusy(true);
      await onResetSubjectMappings();
      setInlineNameDrafts({});
      setInlineCodeDrafts({});
      setConfirmResetSubjects(false);
      setStatusBanner({
        text: "คืนค่าเริ่มต้นชื่อวิชาตามรหัสวิชาทั้งหมดเรียบร้อยแล้ว",
        type: "ok",
      });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "คืนค่าเริ่มต้นไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // นับจำนวนแถวที่ถูกพิมพ์แก้ไขค้างไว้ในตาราง (Inline Dirty Count)
  const pendingInlineChanges = useMemo(() => {
    const nameChanges: Record<string, string> = {};
    const codeRenames: Record<string, string> = {};

    discoveredSubjects.forEach((item) => {
      const draftedCode =
        inlineCodeDrafts[item.code] !== undefined
          ? inlineCodeDrafts[item.code].trim()
          : item.code;
      const draftedName =
        inlineNameDrafts[item.code] !== undefined
          ? inlineNameDrafts[item.code].trim()
          : item.currentName;

      if (draftedCode && draftedCode !== item.code) {
        codeRenames[item.code] = draftedCode;
      }
      const targetCode = draftedCode || item.code;
      if (
        draftedName &&
        (draftedName !== item.currentName || draftedCode !== item.code)
      ) {
        nameChanges[targetCode] = draftedName;
      }
    });

    return {
      nameChanges,
      codeRenames,
      totalCount:
        Object.keys(nameChanges).length + Object.keys(codeRenames).length,
    };
  }, [discoveredSubjects, inlineNameDrafts, inlineCodeDrafts]);

  // บันทึกการแก้ไขในตารางทั้งหมดในคลิกเดียว
  const handleSaveAllInlineEdits = async () => {
    if (pendingInlineChanges.totalCount === 0) return;
    try {
      setBusy(true);
      const { nameChanges, codeRenames } = pendingInlineChanges;
      const renameKeys = Object.keys(codeRenames);

      if (renameKeys.length > 0 && onBulkRenameCourseCodes) {
        const { replacedSlotCount, affectedTeachersCount } =
          await onBulkRenameCourseCodes(codeRenames, nameChanges);
        setInlineNameDrafts({});
        setInlineCodeDrafts({});
        setStatusBanner({
          text: `บันทึกสำเร็จ: เปลี่ยนรหัสวิชา ${renameKeys.length} รหัส (อัปเดตตารางสอนครู ${affectedTeachersCount} ท่าน รวม ${replacedSlotCount} คาบ) และอัปเดตชื่อวิชาเรียบร้อยแล้ว`,
          type: "ok",
        });
      } else {
        const nextMappings = {
          ...subjectMappings,
          ...nameChanges,
        };
        await onSaveSubjectMappings(nextMappings);
        setInlineNameDrafts({});
        setInlineCodeDrafts({});
        setStatusBanner({
          text: `บันทึกการแก้ไขชื่อวิชาจำนวน ${Object.keys(nameChanges).length} รายการเรียบร้อยแล้ว`,
          type: "ok",
        });
      }
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "บันทึกข้อมูลไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // เปิดหน้าต่างแก้ไขเป็นชุด / วางจาก Excel
  const handleOpenBulkModal = () => {
    setBulkTextInput(formatSubjectsForBulkText(discoveredSubjects));
    setIsBulkModalOpen(true);
  };

  const parsedBulkPreview = useMemo(
    () => parseBulkSubjectLines(bulkTextInput),
    [bulkTextInput]
  );

  // บันทึกข้อมูลจากหน้าต่างวางจาก Excel / แก้ไขเป็นชุด
  const handleApplyBulkText = async () => {
    const { mappings, codeRenames, mappingCount, renameCount } = parsedBulkPreview;
    if (mappingCount === 0 && renameCount === 0) {
      setStatusBanner({
        text: "ไม่พบข้อมูลรหัสวิชาและชื่อวิชาที่ถูกต้อง กรุณาตรวจสอบรูปแบบข้อความ",
        type: "err",
      });
      return;
    }

    try {
      setBusy(true);
      if (renameCount > 0 && onBulkRenameCourseCodes) {
        const { replacedSlotCount, affectedTeachersCount } =
          await onBulkRenameCourseCodes(codeRenames, mappings);
        setIsBulkModalOpen(false);
        setInlineNameDrafts({});
        setInlineCodeDrafts({});
        setStatusBanner({
          text: `นำเข้าข้อมูลเป็นชุดสำเร็จ: เปลี่ยนรหัสวิชา ${renameCount} รหัส (${affectedTeachersCount} ท่าน / ${replacedSlotCount} คาบ) และอัปเดตชื่อวิชา ${mappingCount} วิชาเรียบร้อยแล้ว`,
          type: "ok",
        });
      } else {
        const nextMappings = {
          ...subjectMappings,
          ...mappings,
        };
        await onSaveSubjectMappings(nextMappings);
        setIsBulkModalOpen(false);
        setInlineNameDrafts({});
        setInlineCodeDrafts({});
        setStatusBanner({
          text: `อัปเดตชื่อวิชาเป็นชุดจำนวน ${mappingCount} รายการเรียบร้อยแล้ว`,
          type: "ok",
        });
      }
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "นำเข้าข้อมูลไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // ส่งออกไฟล์ CSV (เปิดใน Microsoft Excel ได้ทันที)
  const handleExportSubjectsCsv = () => {
    const csvContent = exportSubjectsToCsv(discoveredSubjects);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `รหัสวิชาและชื่อวิชา_รร.วรคุณอุปถัมภ์_${academicSettings.academicYear}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusBanner({
      text: "ดาวน์โหลดไฟล์ Excel (.csv) เรียบร้อยแล้ว สามารถเปิดแก้ไขในโปรแกรม Excel แล้วกด 'นำเข้าไฟล์ Excel (.csv)' กลับมาได้ทันที",
      type: "ok",
    });
  };

  // นำเข้าไฟล์ CSV ที่แก้ไขจาก Excel
  const handleImportSubjectsCsvFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      setBusy(true);
      const text = await file.text();
      const { mappings, codeRenames, mappingCount, renameCount } =
        parseBulkSubjectLines(text);

      if (mappingCount === 0 && renameCount === 0) {
        setStatusBanner({
          text: "ไม่พบข้อมูลรหัสวิชาหรือชื่อวิชาในไฟล์ที่เลือก",
          type: "err",
        });
        return;
      }

      if (renameCount > 0 && onBulkRenameCourseCodes) {
        const { replacedSlotCount, affectedTeachersCount } =
          await onBulkRenameCourseCodes(codeRenames, mappings);
        setInlineNameDrafts({});
        setInlineCodeDrafts({});
        setStatusBanner({
          text: `นำเข้าไฟล์ Excel (.csv) สำเร็จ: เปลี่ยนรหัสวิชา ${renameCount} รหัส (${affectedTeachersCount} ท่าน / ${replacedSlotCount} คาบ) และอัปเดตชื่อวิชา ${mappingCount} รายการ`,
          type: "ok",
        });
      } else {
        const nextMappings = {
          ...subjectMappings,
          ...mappings,
        };
        await onSaveSubjectMappings(nextMappings);
        setInlineNameDrafts({});
        setInlineCodeDrafts({});
        setStatusBanner({
          text: `นำเข้าไฟล์ Excel (.csv) และอัปเดตชื่อวิชา ${mappingCount} รายการเรียบร้อยแล้ว`,
          type: "ok",
        });
      }
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "อ่านไฟล์ CSV ไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // คำนวณรายการรหัสวิชาที่จะถูกสลับเมื่อเปลี่ยนเป็นเทอม 1 หรือ เทอม 2
  const semesterShiftPreviewMap = useMemo(() => {
    if (!pendingSemesterShift) return {};
    return buildSemesterCourseCodeShiftMap(teachers, pendingSemesterShift);
  }, [teachers, pendingSemesterShift]);

  const handleConfirmSemesterCodeShift = async () => {
    if (!pendingSemesterShift || !onBulkRenameCourseCodes) return;
    const shiftCount = Object.keys(semesterShiftPreviewMap).length;
    if (shiftCount === 0) {
      setPendingSemesterShift(null);
      return;
    }

    try {
      setBusy(true);
      const { replacedSlotCount, affectedTeachersCount } =
        await onBulkRenameCourseCodes(semesterShiftPreviewMap);
      const targetSem = pendingSemesterShift;
      setPendingSemesterShift(null);
      setInlineNameDrafts({});
      setInlineCodeDrafts({});
      setStatusBanner({
        text: `ปรับรหัสวิชาเป็นภาคเรียนที่ ${targetSem} อัตโนมัติสำเร็จ (${shiftCount} รหัสวิชา · อัปเดตตารางสอนครู ${affectedTeachersCount} ท่าน รวม ${replacedSlotCount} คาบ)`,
        type: "ok",
      });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "ปรับรหัสวิชาไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  // ส่งออกตารางสอนครูทั้งหมดเป็นไฟล์ Excel (.csv)
  const handleExportTeachersCsv = () => {
    const csvContent = exportTeachersToCsv(teachers);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ตารางสอนครูทั้งหมด_รร.วรคุณอุปถัมภ์_${academicSettings.academicYear}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatusBanner({
      text: "ดาวน์โหลดไฟล์ตารางสอนครูทั้งหมด (.csv) เรียบร้อยแล้ว สามารถเปิดแก้ไขตารางสอนของครูทุกคนใน Excel แล้วกดนำเข้ากลับมาได้ทันที",
      type: "ok",
    });
  };

  // นำเข้าตารางสอนครูทั้งหมดจากไฟล์ Excel (.csv)
  const handleImportTeachersCsvFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onBulkSaveTeachers) return;

    try {
      setBusy(true);
      const text = await file.text();
      const { teachers: parsedTeachers, updatedCount } = parseTeachersFromCsv(
        text,
        teachers
      );

      if (updatedCount === 0) {
        setStatusBanner({
          text: "ไม่พบข้อมูลตารางสอนครูที่ถูกต้องในไฟล์ CSV ที่เลือก",
          type: "err",
        });
        return;
      }

      await onBulkSaveTeachers(parsedTeachers);
      setStatusBanner({
        text: `นำเข้าตารางสอนจาก Excel (.csv) สำเร็จ: อัปเดตข้อมูลและตารางสอนของครูจำนวน ${updatedCount} ท่านเรียบร้อยแล้ว`,
        type: "ok",
      });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "นำเข้าไฟล์ตารางสอนไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5 w-full">
      {/* แผงตั้งค่าปีการศึกษา ภาคเรียน และผู้ลงนามท้ายใบสอนแทน */}
      <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-5 h-5 text-[#1b4fb8] dark:text-[#6c97ff]" />
            <h2 className="text-base sm:text-lg font-bold text-[#0f2150] dark:text-[#e9eefc]">
              ตั้งค่าภาคเรียน ปีการศึกษา และผู้ลงนามท้ายเอกสาร
            </h2>
            <span className="px-2 py-0.5 rounded-md bg-[#eaf0fa] dark:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff] text-xs font-bold border border-[#c9d4ec] dark:border-[#2a3a6e]">
              {academicSettings.semester === "ฤดูร้อน"
                ? "ภาคฤดูร้อน"
                : `ภาคเรียนที่ ${academicSettings.semester}`}{" "}
              ปีการศึกษา {academicSettings.academicYear}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* เลือกภาคเรียน */}
            <div className="flex items-center gap-1.5 bg-[#eaf0fa] dark:bg-[#0b1330] p-1 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e]">
              {QUICK_SEMESTERS.map((sem) => (
                <button
                  key={sem.value}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSemesterInput(sem.value);
                    handleSaveAcademicYearAndSemester(yearInput, sem.value);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${
                    semesterInput === sem.value
                      ? "bg-[#1b4fb8] text-white shadow-2xs"
                      : "text-[#0f2150] dark:text-[#9fb0dc] hover:bg-white/60 dark:hover:bg-[#14204a]"
                  }`}
                >
                  {sem.label}
                </button>
              ))}
            </div>

            {/* ระบุปีการศึกษา พ.ศ. */}
            <div className="flex items-center gap-2">
              <label
                htmlFor="academic-year-input"
                className="text-xs sm:text-sm font-bold text-[#0f2150] dark:text-[#e9eefc] whitespace-nowrap"
              >
                ปีการศึกษา:
              </label>
              <input
                id="academic-year-input"
                type="number"
                min={2500}
                max={2699}
                value={yearInput}
                onChange={(e) => setYearInput(e.target.value)}
                aria-label="ปีการศึกษา พ.ศ."
                className="w-24 px-3 py-1.5 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-sm font-bold text-center text-[#0f2150] dark:text-[#e9eefc] focus:outline-2 focus:outline-[#f2c230]"
              />
              <button
                type="button"
                id="save-academic-year-btn"
                disabled={busy}
                onClick={() => handleSaveAcademicYearAndSemester()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0b7a4b] hover:bg-[#085c38] disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer whitespace-nowrap"
              >
                <Save className="w-4 h-4 shrink-0" />
                <span>บันทึกการตั้งค่า</span>
              </button>
            </div>
          </div>
        </div>

        {/* ปุ่มลัดเลือกปีการศึกษา */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-dashed border-[#c9d4ec] dark:border-[#2a3a6e]">
          <span className="text-xs font-semibold text-[#51608a] dark:text-[#9fb0dc] mr-1">
            เลือกปีด่วน:
          </span>
          {QUICK_ACADEMIC_YEARS.map((yr) => (
            <button
              key={yr}
              type="button"
              disabled={busy}
              onClick={() => {
                setYearInput(yr);
                handleSaveAcademicYearAndSemester(yr, semesterInput);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                academicSettings.academicYear === yr
                  ? "bg-[#1b4fb8] text-white"
                  : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc] hover:bg-blue-200 dark:hover:bg-blue-900"
              }`}
            >
              พ.ศ. {yr}
            </button>
          ))}
        </div>

        {/* ตั้งค่ารายชื่อผู้ลงนามท้ายใบแบบบันทึกการจัดสอนแทน (ซ้าย: ผู้จัดสอนแทน / ขวา: หัวหน้ากลุ่มบริหารวิชาการ) */}
        <div className="pt-3 border-t border-[#c9d4ec] dark:border-[#2a3a6e] grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-[#f8faff] dark:bg-[#0b1330]/60 border border-[#c9d4ec] dark:border-[#2a3a6e] space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#1b4fb8] dark:text-[#6c97ff]">
              <UserCheck className="w-3.5 h-3.5" />
              <span>ผู้ลงนามฝั่งซ้าย (ผู้จัดสอนแทน)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="sig-planner-name"
                  className="block text-[11px] font-semibold text-[#51608a] dark:text-[#9fb0dc] mb-0.5"
                >
                  ชื่อ-สกุล (ไม่ต้องใส่วงเล็บ)
                </label>
                <input
                  id="sig-planner-name"
                  type="text"
                  value={plannerNameInput}
                  onChange={(e) => setPlannerNameInput(e.target.value)}
                  placeholder="เช่น นายธีระพงษ์ หาวัน"
                  className="w-full px-2.5 py-1.5 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-xs sm:text-sm font-semibold text-[#0f2150] dark:text-[#e9eefc]"
                />
              </div>
              <div>
                <label
                  htmlFor="sig-planner-pos"
                  className="block text-[11px] font-semibold text-[#51608a] dark:text-[#9fb0dc] mb-0.5"
                >
                  ตำแหน่ง / งาน
                </label>
                <input
                  id="sig-planner-pos"
                  type="text"
                  value={plannerPositionInput}
                  onChange={(e) => setPlannerPositionInput(e.target.value)}
                  placeholder="เช่น งานการจัดการเรียนการสอน"
                  className="w-full px-2.5 py-1.5 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-xs sm:text-sm font-semibold text-[#0f2150] dark:text-[#e9eefc]"
                />
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#f8faff] dark:bg-[#0b1330]/60 border border-[#c9d4ec] dark:border-[#2a3a6e] space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#1b4fb8] dark:text-[#6c97ff]">
              <UserCheck className="w-3.5 h-3.5" />
              <span>ผู้ลงนามฝั่งขวา (หัวหน้ากลุ่มบริหารวิชาการ)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="sig-approver-name"
                  className="block text-[11px] font-semibold text-[#51608a] dark:text-[#9fb0dc] mb-0.5"
                >
                  ชื่อ-สกุล (ไม่ต้องใส่วงเล็บ)
                </label>
                <input
                  id="sig-approver-name"
                  type="text"
                  value={approverNameInput}
                  onChange={(e) => setApproverNameInput(e.target.value)}
                  placeholder="เช่น นายสุทธิศักดิ์ เกตษา"
                  className="w-full px-2.5 py-1.5 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-xs sm:text-sm font-semibold text-[#0f2150] dark:text-[#e9eefc]"
                />
              </div>
              <div>
                <label
                  htmlFor="sig-approver-pos"
                  className="block text-[11px] font-semibold text-[#51608a] dark:text-[#9fb0dc] mb-0.5"
                >
                  ตำแหน่ง / โรงเรียน
                </label>
                <input
                  id="sig-approver-pos"
                  type="text"
                  value={approverPositionInput}
                  onChange={(e) => setApproverPositionInput(e.target.value)}
                  placeholder="เช่น ผู้ช่วยผู้อำนวยการโรงเรียนวรคุณอุปถัมภ์"
                  className="w-full px-2.5 py-1.5 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-xs sm:text-sm font-semibold text-[#0f2150] dark:text-[#e9eefc]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* แผงควบคุมฐานข้อมูลและสถานะ Cloud Firestore */}
      <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Database className="w-5 h-5 text-[#1b4fb8] dark:text-[#6c97ff]" />
              <h2 className="text-lg sm:text-xl font-bold text-[#0f2150] dark:text-[#e9eefc]">
                ฐานข้อมูลกลาง
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-[#51608a] dark:text-[#9fb0dc]">
              ครู <b>{regularCount}</b> · นศ.ฝึกสอน <b>{studentCount}</b> · รหัสวิชา{" "}
              <b>{discoveredSubjects.length}</b> · ประวัติ <b>{savedRecords.length}</b> รายการ
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <Cloud className="w-4 h-4 text-[#0b7a4b] dark:text-[#4fd39a] shrink-0" />
              <span className="text-xs font-bold text-[#0b7a4b] dark:text-[#4fd39a]">
                ซิงก์ฐานข้อมูลกลางอัตโนมัติ
              </span>
            </div>

            {subTab === "teachers" && (
              <>
                <button
                  type="button"
                  onClick={onOpenAddTeacher}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>เพิ่มครู / นศ.ฝึกสอนใหม่</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportTeachersCsv}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] hover:bg-slate-100 dark:hover:bg-blue-950 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 shrink-0 text-[#1b4fb8] dark:text-[#6c97ff]" />
                  <span>ส่งออกตารางสอน Excel (.csv)</span>
                </button>

                {onBulkSaveTeachers && (
                  <>
                    <button
                      type="button"
                      onClick={() => teacherCsvFileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] hover:bg-slate-100 dark:hover:bg-blue-950 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                    >
                      <Upload className="w-4 h-4 shrink-0 text-[#0b7a4b] dark:text-[#4fd39a]" />
                      <span>นำเข้าตารางสอน Excel (.csv)</span>
                    </button>
                    <input
                      ref={teacherCsvFileInputRef}
                      type="file"
                      accept=".csv,.txt"
                      onChange={handleImportTeachersCsvFile}
                      className="hidden"
                    />
                  </>
                )}
              </>
            )}

            {subTab === "subjects" && (
              <>
                <button
                  type="button"
                  onClick={handleOpenBulkModal}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0b7a4b] hover:bg-[#085c38] text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <ClipboardPaste className="w-4 h-4 shrink-0" />
                  <span>วางจาก Excel / แก้ไขเป็นชุด</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportSubjectsCsv}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] hover:bg-slate-100 dark:hover:bg-blue-950 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 shrink-0 text-[#1b4fb8] dark:text-[#6c97ff]" />
                  <span>ส่งออก Excel (.csv)</span>
                </button>

                <button
                  type="button"
                  onClick={() => csvFileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] hover:bg-slate-100 dark:hover:bg-blue-950 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                >
                  <Upload className="w-4 h-4 shrink-0 text-[#0b7a4b] dark:text-[#4fd39a]" />
                  <span>นำเข้า Excel (.csv)</span>
                </button>
                <input
                  ref={csvFileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleImportSubjectsCsvFile}
                  className="hidden"
                />
              </>
            )}

            {subTab === "records" && (
              <>
                <button
                  type="button"
                  onClick={handleExportStatsCsv}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] hover:bg-slate-100 dark:hover:bg-blue-950 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 shrink-0 text-[#1b4fb8] dark:text-[#6c97ff]" />
                  <span>ส่งออกสถิติ Excel (.csv)</span>
                </button>
                {savedRecords.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmClearAllRecords(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4 shrink-0" />
                    <span>ล้างประวัติทั้งหมด</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {statusBanner && (
          <div
            role="status"
            className={`mt-3 p-3 rounded-lg flex items-center justify-between gap-2 text-sm font-semibold ${
              statusBanner.type === "ok"
                ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[#0b7a4b] dark:text-[#4fd39a]"
                : "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-[#b3261e] dark:text-[#ff8b82]"
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-xs underline cursor-pointer"
            >
              ปิด
            </button>
          </div>
        )}

        {/* แถบสลับหมวดหมู่ในฐานข้อมูล */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4 pt-3 border-t border-[#c9d4ec] dark:border-[#2a3a6e]">
          <button
            type="button"
            onClick={() => setSubTab("teachers")}
            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
              subTab === "teachers"
                ? "bg-[#1b4fb8] text-white"
                : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
            }`}
          >
            <Database className="w-4 h-4 shrink-0" />
            <span>รายชื่อครู & ตารางสอน ({teachers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("subjects")}
            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
              subTab === "subjects"
                ? "bg-[#1b4fb8] text-white"
                : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
            }`}
          >
            <BookOpen className="w-4 h-4 shrink-0" />
            <span>
              รหัสวิชา & ชื่อวิชา ({discoveredSubjects.length})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("records")}
            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
              subTab === "records"
                ? "bg-[#1b4fb8] text-white"
                : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
            }`}
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span>ประวัติ & สถิติสอนแทน ({savedRecords.length})</span>
          </button>
        </div>
      </section>

      {/* ยืนยันการคืนค่าเริ่มต้นรายชื่อครู */}
      {confirmReset && (
        <div className="bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                ยืนยันการกู้คืนข้อมูลเริ่มต้นจาก PDF ทั้ง 31 ท่าน?
              </h3>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                ข้อมูลครูประจำการ 27 ท่าน และนักศึกษาฝึกสอน 4 ท่าน จะถูกรีเซ็ตกลับเป็นตารางสอนต้นฉบับจากไฟล์ PDF
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="px-3 py-1.5 rounded-lg border border-amber-400 text-xs font-semibold text-amber-900 dark:text-amber-200 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleConfirmReset}
              className="px-3.5 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold cursor-pointer"
            >
              {busy ? "กำลังกู้คืน..." : "ยืนยันกู้คืนข้อมูล"}
            </button>
          </div>
        </div>
      )}

      {/* ยืนยันการลบครู */}
      {confirmDeleteTeacher && (
        <div className="bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-700 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-red-900 dark:text-red-200">
                ยืนยันการลบข้อมูล "{confirmDeleteTeacher.id} {confirmDeleteTeacher.n}"?
              </h3>
              <p className="text-xs text-red-800 dark:text-red-300 mt-0.5">
                เมื่อลบแล้ว รายชื่อและตารางสอนของท่านนี้จะถูกนำออกจากฐานข้อมูลทันที
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmDeleteTeacher(null)}
              className="px-3 py-1.5 rounded-lg border border-red-300 text-xs font-semibold text-red-900 dark:text-red-200 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleConfirmDeleteTeacher}
              className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
            >
              {busy ? "กำลังลบ..." : "ยืนยันลบรายชื่อ"}
            </button>
          </div>
        </div>
      )}

      {/* ยืนยันการล้างชื่อวิชาที่แก้ไขไว้ทั้งหมด */}
      {confirmResetSubjects && (
        <div className="bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                ยืนยันการคืนค่าเริ่มต้นชื่อวิชาตามรหัสวิชาทั้งหมด?
              </h3>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                การแก้ไขชื่อวิชาที่คุณกำหนดไว้จะถูกรีเซ็ตกลับเป็นค่าเริ่มต้นจากระบบ
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmResetSubjects(false)}
              className="px-3 py-1.5 rounded-lg border border-amber-400 text-xs font-semibold text-amber-900 dark:text-amber-200 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleConfirmResetAllSubjects}
              className="px-3.5 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold cursor-pointer"
            >
              {busy ? "กำลังรีเซ็ต..." : "ยืนยันรีเซ็ตทั้งหมด"}
            </button>
          </div>
        </div>
      )}

      {/* ยืนยันการล้างประวัติใบสอนแทนทั้งหมด */}
      {confirmClearAllRecords && (
        <div className="bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-700 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-red-900 dark:text-red-200">
                ยืนยันการล้างประวัติใบสอนแทนทั้งหมด ({savedRecords.length} รายการ)?
              </h3>
              <p className="text-xs text-red-800 dark:text-red-300 mt-0.5">
                เหมาะสำหรับการเริ่มต้นภาคเรียนหรือปีการศึกษาใหม่ ข้อมูลรายชื่อครูและตารางสอนจะไม่ถูกลบ
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmClearAllRecords(false)}
              className="px-3 py-1.5 rounded-lg border border-red-300 text-xs font-semibold text-red-900 dark:text-red-200 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleConfirmClearAllRecords}
              className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
            >
              {busy ? "กำลังล้างประวัติ..." : "ยืนยันล้างประวัติทั้งหมด"}
            </button>
          </div>
        </div>
      )}

      {/* หมวดที่ 1: จัดการรายชื่อครูและตารางสอน */}
      {subTab === "teachers" && (
        <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-[#51608a] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหารหัสครู, ชื่อ-สกุล, กลุ่มสาระ, ห้อง..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-sm text-[#0f2150] dark:text-[#e9eefc]"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setFilterGroup("ทั้งหมด")}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                  filterGroup === "ทั้งหมด"
                    ? "bg-[#1b4fb8] text-white"
                    : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
                }`}
              >
                ทั้งหมด ({teachers.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterGroup("นักศึกษาฝึกสอน")}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
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
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                    filterGroup === g
                      ? "bg-[#1b4fb8] text-white"
                      : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-[#c9d4ec] dark:divide-[#2a3a6e]">
            {filteredTeachers.map((t) => (
              <div
                key={t.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-base text-[#0f2150] dark:text-[#e9eefc]">
                      {t.id} {t.n}
                    </span>
                    {t.isStudentTeacher ? (
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300 text-xs font-bold">
                        นักศึกษาฝึกสอน
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-[#eaf0fa] dark:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff] text-xs font-semibold">
                        {t.pdfGroup}
                      </span>
                    )}
                    {t.id === 302 && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 text-xs font-bold">
                        ย้ายไป รร.อื่น · โอนคาบให้ 305 ครูศักดิ์ชัย ทั้งหมด
                      </span>
                    )}
                    {t.id === 305 && (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 text-xs font-bold">
                        รับโอนคาบชีววิทยาจาก 302 ครูรณสิทธิ์ ทั้งหมด
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#51608a] dark:text-[#9fb0dc] mt-0.5">
                    กลุ่มสาระหลัก: <b>{t.g}</b> · ประจำ{formatRoomLabel(t.r)} · รวม{" "}
                    <b>{t.totalHours}</b> ชม./สัปดาห์
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onViewTeacherTimetable(t.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] text-xs font-semibold text-[#0f2150] dark:text-[#e9eefc] hover:bg-slate-100 dark:hover:bg-blue-950 cursor-pointer"
                  >
                    <Table2 className="w-3.5 h-3.5" />
                    <span>ดูตาราง</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenEditTeacher(t)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-xs font-bold cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>แก้ไขข้อมูล / ตารางสอน</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteTeacher(t)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs font-semibold cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>ลบ</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* หมวดที่ 2: ผูกรหัสวิชากับชื่อวิชา (แก้ไขในตารางได้ทันที + รองรับ Excel/CSV + สลับรหัสวิชาเทอม 1/2) */}
      {subTab === "subjects" && (
        <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
          {/* แถบปรับรหัสวิชาข้ามเทอมอัตโนมัติ */}
          {onBulkRenameCourseCodes && (
            <div className="bg-[#f4f7fc] dark:bg-[#0b1330] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <span className="text-xs sm:text-sm font-semibold text-[#0f2150] dark:text-[#e9eefc]">
                คลิกพิมพ์แก้ไขรหัสวิชาหรือชื่อวิชาในตารางด้านล่างได้ทันที (กด Enter เพื่อบันทึก)
              </span>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingSemesterShift("1")}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#14204a] hover:bg-blue-50 dark:hover:bg-blue-950 text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] cursor-pointer"
                  title="แปลงรหัสวิชาที่ลงท้ายด้วย 2 เป็น 1 ทั้งโรงเรียน เช่น ว21102 -> ว21101"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#1b4fb8] dark:text-[#6c97ff]" />
                  <span>แปลงรหัสเป็น เทอม 1 (ลงท้าย 1)</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingSemesterShift("2")}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#14204a] hover:bg-blue-50 dark:hover:bg-blue-950 text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] cursor-pointer"
                  title="แปลงรหัสวิชาที่ลงท้ายด้วย 1 เป็น 2 ทั้งโรงเรียน เช่น ว21101 -> ว21102"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#0b7a4b] dark:text-[#4fd39a]" />
                  <span>แปลงรหัสเป็น เทอม 2 (ลงท้าย 2)</span>
                </button>
              </div>
            </div>
          )}

          {/* ยืนยันการแปลงรหัสวิชาข้ามเทอมอัตโนมัติ */}
          {pendingSemesterShift && (
            <div className="bg-blue-50 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-700 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#0f2150] dark:text-blue-200">
                  ยืนยันการปรับรหัสวิชาทั้งโรงเรียนให้เป็น “ภาคเรียนที่ {pendingSemesterShift}” (ลงท้ายเลข {pendingSemesterShift})?
                </h3>
                {Object.keys(semesterShiftPreviewMap).length === 0 ? (
                  <p className="text-xs text-[#51608a] dark:text-blue-300">
                    รหัสวิชามาตรฐานทั้งหมดในตารางสอนเป็นรหัสของภาคเรียนที่ {pendingSemesterShift} อยู่แล้ว
                  </p>
                ) : (
                  <p className="text-xs text-[#51608a] dark:text-blue-300">
                    พบ <b>{Object.keys(semesterShiftPreviewMap).length}</b> รหัสวิชาที่จะเปลี่ยนอัตโนมัติในตารางสอนของครูทุกคน เช่น{" "}
                    <b>
                      {Object.entries(semesterShiftPreviewMap)
                        .slice(0, 5)
                        .map(([o, n]) => `${o} → ${n}`)
                        .join(", ")}
                    </b>
                    {Object.keys(semesterShiftPreviewMap).length > 5 ? " ฯลฯ" : ""}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setPendingSemesterShift(null)}
                  className="px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 text-xs font-semibold text-[#0f2150] dark:text-blue-200 cursor-pointer"
                >
                  ยกเลิก
                </button>
                {Object.keys(semesterShiftPreviewMap).length > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleConfirmSemesterCodeShift}
                    className="px-3.5 py-1.5 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-xs font-bold cursor-pointer"
                  >
                    {busy ? "กำลังอัปเดต..." : `ยืนยันแปลง ${Object.keys(semesterShiftPreviewMap).length} รหัสวิชา`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* แถบแจ้งเตือนเมื่อมีการพิมพ์แก้ไขในตารางหลายรายการ */}
          {pendingInlineChanges.totalCount > 0 && (
            <div className="sticky top-2 z-20 bg-[#0f2150] text-white rounded-xl p-3.5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-2 border-[#f2c230]">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
                <Edit3 className="w-4 h-4 text-[#f2c230] shrink-0" />
                <span>
                  แก้ไขค้างไว้{" "}
                  <b className="text-[#f2c230]">{pendingInlineChanges.totalCount}</b> รายการ
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setInlineNameDrafts({});
                    setInlineCodeDrafts({});
                  }}
                  className="px-3 py-1.5 rounded-lg border border-white/30 hover:bg-white/10 text-xs font-semibold text-white cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSaveAllInlineEdits}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#f2c230] hover:bg-[#e0b120] text-[#0f2150] text-xs sm:text-sm font-bold shadow-xs cursor-pointer"
                >
                  <Save className="w-4 h-4 shrink-0" />
                  <span>{busy ? "กำลังบันทึก..." : `บันทึกทั้งหมด (${pendingInlineChanges.totalCount})`}</span>
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-[#51608a] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={subjectSearch}
                onChange={(e) => setSubjectSearch(e.target.value)}
                placeholder="ค้นหารหัสวิชา (เช่น ว21102), ชื่อวิชา, ครู..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-sm text-[#0f2150] dark:text-[#e9eefc]"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                "ทั้งหมด",
                "แก้ไขแล้ว",
                "วิทยาศาสตร์ (ว)",
                "คณิตศาสตร์ (ค)",
                "ภาษาไทย (ท)",
                "สังคมศึกษา (ส)",
                "ภาษาต่างประเทศ (อ/จ)",
                "สุขศึกษา/พลศึกษา (พ)",
                "ศิลปะ (ศ)",
                "การงานอาชีพ (ง)",
                "กิจกรรม/IS",
              ].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSubjectCategoryFilter(cat)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                    subjectCategoryFilter === cat
                      ? "bg-[#1b4fb8] text-white"
                      : "bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#9fb0dc]"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e]">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] font-bold">
                <tr>
                  <th className="p-2.5 w-36">รหัสวิชา (คลิกแก้ได้)</th>
                  <th className="p-2.5 min-w-[220px]">ชื่อวิชาที่แสดงในเอกสาร (คลิกพิมพ์แก้ได้ทันที)</th>
                  <th className="p-2.5 w-44">ค่าเริ่มต้นระบบ</th>
                  <th className="p-2.5 w-28 text-center">สถานะ</th>
                  <th className="p-2.5">ครูผู้สอนในระบบ</th>
                  <th className="p-2.5 w-28 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#c9d4ec] dark:divide-[#2a3a6e]">
                {filteredDiscoveredSubjects.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-[#51608a] dark:text-[#9fb0dc]">
                      ไม่พบรหัสวิชาที่ตรงตามเงื่อนไข
                    </td>
                  </tr>
                ) : (
                  filteredDiscoveredSubjects.map((item) => {
                    const codeVal =
                      inlineCodeDrafts[item.code] !== undefined
                        ? inlineCodeDrafts[item.code]
                        : item.code;
                    const nameVal =
                      inlineNameDrafts[item.code] !== undefined
                        ? inlineNameDrafts[item.code]
                        : item.currentName;
                    const isRowDirty =
                      codeVal.trim() !== item.code ||
                      nameVal.trim() !== item.currentName;

                    return (
                      <tr
                        key={item.code}
                        className={`transition-colors ${
                          isRowDirty
                            ? "bg-amber-50/70 dark:bg-amber-950/30"
                            : "hover:bg-slate-50 dark:hover:bg-blue-950/40"
                        }`}
                      >
                        <td className="p-2">
                          <input
                            type="text"
                            value={codeVal}
                            aria-label={`รหัสวิชา ${item.code}`}
                            onChange={(e) =>
                              setInlineCodeDrafts((prev) => ({
                                ...prev,
                                [item.code]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleSaveAllInlineEdits();
                              }
                            }}
                            className={`w-full px-2.5 py-1.5 rounded-md border font-mono font-bold text-xs sm:text-sm ${
                              codeVal.trim() !== item.code
                                ? "border-amber-500 bg-white dark:bg-[#0b1330] text-amber-900 dark:text-amber-300"
                                : "border-transparent hover:border-[#c9d4ec] focus:border-[#1b4fb8] bg-transparent focus:bg-white dark:focus:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff]"
                            }`}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={nameVal}
                            aria-label={`ชื่อวิชาสำหรับรหัส ${item.code}`}
                            onChange={(e) =>
                              setInlineNameDrafts((prev) => ({
                                ...prev,
                                [item.code]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleSaveAllInlineEdits();
                              }
                            }}
                            className={`w-full px-2.5 py-1.5 rounded-md border font-bold text-xs sm:text-sm ${
                              nameVal.trim() !== item.currentName
                                ? "border-amber-500 bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc]"
                                : "border-[#c9d4ec]/70 dark:border-[#2a3a6e] focus:border-[#1b4fb8] bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc]"
                            }`}
                          />
                        </td>
                        <td className="p-2.5 text-[#51608a] dark:text-[#9fb0dc] text-xs">
                          {item.defaultName}
                        </td>
                        <td className="p-2.5 text-center">
                          {isRowDirty ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-xs font-bold">
                              รอการบันทึก
                            </span>
                          ) : item.isCustom ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-[#0b7a4b] dark:text-[#4fd39a] text-xs font-bold">
                              <Check className="w-3 h-3" /> แก้ไขแล้ว
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[#51608a] dark:text-[#9fb0dc] text-xs font-medium">
                              ค่าเริ่มต้น
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-xs text-[#51608a] dark:text-[#9fb0dc]">
                          {item.teacherNames.length > 0 ? (
                            <span>{item.teacherNames.join(", ")}</span>
                          ) : (
                            <span className="italic text-slate-400">-</span>
                          )}
                        </td>
                        <td className="p-2.5 text-right whitespace-nowrap space-x-1">
                          {isRowDirty ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={handleSaveAllInlineEdits}
                              className="px-2.5 py-1 rounded-md bg-[#0b7a4b] hover:bg-[#085c38] text-white text-xs font-bold cursor-pointer"
                            >
                              บันทึก
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenEditSubject(item)}
                              className="px-2.5 py-1 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#0f2150] dark:text-[#e9eefc] hover:bg-slate-100 dark:hover:bg-blue-950 text-xs font-semibold cursor-pointer"
                            >
                              แก้ไข
                            </button>
                          )}
                          {item.isCustom && (
                            <button
                              type="button"
                              onClick={() => handleResetSingleSubject(item.code)}
                              className="px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 text-[#51608a] dark:text-[#9fb0dc] hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer"
                              title="คืนค่าเริ่มต้น"
                            >
                              คืนค่า
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* หมวดที่ 3: ประวัติใบสอนแทนที่บันทึกไว้ + สรุปสถิติภาระงานการสอนแทน */}
      {subTab === "records" && (
        <div className="space-y-4">
          {/* ตารางสรุปสถิติภาระงานการสอนแทนและการลาสะสม */}
          <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <BarChart3 className="w-5 h-5 text-[#1b4fb8] dark:text-[#6c97ff]" />
                <h3 className="text-base font-bold text-[#0f2150] dark:text-[#e9eefc]">
                  สรุปสถิติภาระงานการสอนแทนและการลาสะสม
                </h3>
                <span className="px-2 py-0.5 rounded-md bg-[#eaf0fa] dark:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff] text-xs font-bold">
                  รวมสอนแทนสะสม {substituteStats.totalSubstitutedPeriods} คาบ
                </span>
              </div>
              <button
                type="button"
                onClick={handleExportStatsCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0b7a4b] hover:bg-[#085c38] text-white text-xs font-bold cursor-pointer self-start sm:self-auto"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>ดาวน์โหลดตารางสถิติ Excel (.csv)</span>
              </button>
            </div>

            <div className="overflow-x-auto max-h-72 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e]">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] font-bold sticky top-0">
                  <tr>
                    <th className="p-2.5 w-20">รหัส</th>
                    <th className="p-2.5">ชื่อ-สกุล</th>
                    <th className="p-2.5">กลุ่มสาระ/งาน</th>
                    <th className="p-2.5 text-center">ช่วยสอนแทนสะสม (คาบ)</th>
                    <th className="p-2.5 text-center">ลา/ไปราชการ (ครั้ง)</th>
                    <th className="p-2.5 text-center">คาบที่ลา (คาบ)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#c9d4ec] dark:divide-[#2a3a6e]">
                  {substituteStats.sortedList.map((st) => (
                    <tr
                      key={st.teacherId}
                      className="hover:bg-slate-50 dark:hover:bg-blue-950/40"
                    >
                      <td className="p-2 font-mono font-bold text-[#1b4fb8] dark:text-[#6c97ff]">
                        {st.teacherId}
                      </td>
                      <td className="p-2 font-semibold text-[#0f2150] dark:text-[#e9eefc]">
                        {st.teacherName}
                        {st.isStudentTeacher && (
                          <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                            นศ.ฝึกสอน
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-xs text-[#51608a] dark:text-[#9fb0dc]">
                        {st.group}
                      </td>
                      <td className="p-2 text-center font-bold">
                        {st.substitutedPeriods > 0 ? (
                          <span className="inline-block px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-[#0b7a4b] dark:text-[#4fd39a]">
                            {st.substitutedPeriods} คาบ
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                      <td className="p-2 text-center text-[#0f2150] dark:text-[#e9eefc]">
                        {st.absentDays > 0 ? `${st.absentDays} ครั้ง` : "-"}
                      </td>
                      <td className="p-2 text-center text-[#51608a] dark:text-[#9fb0dc]">
                        {st.absentPeriods > 0 ? `${st.absentPeriods} คาบ` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* รายการประวัติใบสอนแทนที่บันทึกไว้ */}
          <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-[#0f2150] dark:text-[#e9eefc]">
              รายการใบสอนแทนที่บันทึกไว้ ({savedRecords.length})
            </h3>
            {savedRecords.length === 0 ? (
              <div className="text-center py-8 text-[#51608a] dark:text-[#9fb0dc]">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-bold text-[#0f2150] dark:text-[#e9eefc]">
                  ยังไม่มีประวัติใบสอนแทนที่บันทึกไว้
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#c9d4ec] dark:divide-[#2a3a6e]">
                {savedRecords.map((rec) => {
                  const assignedList = Object.entries(rec.assignments)
                    .filter(([k]) => k.includes("_") || !rec.absentTeacherIds || rec.absentTeacherIds.length <= 1)
                    .map(([pStr, val]) => {
                      const pNum = pStr.includes("_")
                        ? Number(pStr.split("_")[1]) + 1
                        : Number(pStr) + 1;
                      const sub = resolveSubstitute(val, rec.studentTeacherName);
                      return `คาบ ${pNum}: ${sub.n}`;
                    });

                  return (
                    <div
                      key={rec.recordId}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-base text-[#0f2150] dark:text-[#e9eefc]">
                            {/^\d{3}\s/.test(rec.absentTeacherName)
                              ? rec.absentTeacherName
                              : `${rec.absentTeacherId} ${rec.absentTeacherName}`}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-[#eaf0fa] dark:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff] text-xs font-semibold">
                            วันที่ {formatThaiDate(rec.selectedDate)}
                          </span>
                          <span className="text-xs text-[#51608a] dark:text-[#9fb0dc]">
                            เนื่องจาก: <b>{rec.reason}</b>
                          </span>
                        </div>
                        {assignedList.length > 0 && (
                          <div className="text-xs text-[#51608a] dark:text-[#9fb0dc]">
                            ผู้สอนแทน: {assignedList.join(" · ")}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onLoadSubstituteRecord(rec)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-xs font-bold cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>เปิดดู / แก้ไข</span>
                        </button>

                        {confirmDeleteRecordId === rec.recordId ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleConfirmDeleteRecord(rec.recordId)}
                            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer"
                          >
                            ยืนยันลบ
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteRecordId(rec.recordId)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-semibold cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>ลบ</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Modal แก้ไขชื่อวิชาตามรหัสวิชา */}
      {editingSubject && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl max-w-md w-full p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#c9d4ec] dark:border-[#2a3a6e] pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#1b4fb8] dark:text-[#6c97ff]" />
                <h3 className="font-bold text-base text-[#0f2150] dark:text-[#e9eefc]">
                  แก้ไขชื่อวิชาสำหรับรหัส {editingSubject.code}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingSubject(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#51608a] dark:text-[#9fb0dc] mb-1">
                  รหัสวิชา
                </label>
                <input
                  type="text"
                  readOnly
                  value={editingSubject.code}
                  className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-slate-100 dark:bg-[#0b1330] font-mono font-bold text-sm text-[#0f2150] dark:text-[#e9eefc]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#51608a] dark:text-[#9fb0dc] mb-1">
                  ค่าเริ่มต้นจากระบบ
                </label>
                <input
                  type="text"
                  readOnly
                  value={editingSubject.defaultName}
                  className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-slate-100 dark:bg-[#0b1330] text-sm text-[#51608a] dark:text-[#9fb0dc]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                  ชื่อวิชาที่จะแสดงในเอกสาร
                </label>
                <input
                  type="text"
                  value={editSubjectNameInput}
                  onChange={(e) => setEditSubjectNameInput(e.target.value)}
                  placeholder="เช่น วิทยาศาสตร์พื้นฐาน 1, เคมี 1"
                  className="w-full px-3 py-2 rounded-lg border-2 border-[#1b4fb8] dark:border-[#6c97ff] bg-white dark:bg-[#0b1330] font-bold text-sm text-[#0f2150] dark:text-[#e9eefc] focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#c9d4ec] dark:border-[#2a3a6e]">
              <button
                type="button"
                onClick={() => setEditingSubject(null)}
                className="px-4 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] text-xs font-semibold text-[#0f2150] dark:text-[#e9eefc]"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={busy || !editSubjectNameInput.trim()}
                onClick={handleSaveSingleSubject}
                className="px-4 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-xs font-bold"
              >
                {busy ? "กำลังบันทึก..." : "บันทึกชื่อวิชา"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal เพิ่มรหัสวิชาใหม่ */}
      {isAddingSubject && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl max-w-md w-full p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#c9d4ec] dark:border-[#2a3a6e] pb-3">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-[#1b4fb8] dark:text-[#6c97ff]" />
                <h3 className="font-bold text-base text-[#0f2150] dark:text-[#e9eefc]">
                  ผูกรหัสวิชากับชื่อวิชาใหม่
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddingSubject(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                  รหัสวิชา (เช่น ว30289, ค21102)
                </label>
                <input
                  type="text"
                  value={newSubjectCode}
                  onChange={(e) => setNewSubjectCode(e.target.value)}
                  placeholder="เช่น ว30289"
                  className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] font-mono font-bold text-sm text-[#0f2150] dark:text-[#e9eefc]"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                  ชื่อวิชาที่จะแสดงในเอกสาร
                </label>
                <input
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="เช่น หุ่นยนต์และปัญญาประดิษฐ์"
                  className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-sm text-[#0f2150] dark:text-[#e9eefc]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#c9d4ec] dark:border-[#2a3a6e]">
              <button
                type="button"
                onClick={() => setIsAddingSubject(false)}
                className="px-4 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] text-xs font-semibold text-[#0f2150] dark:text-[#e9eefc]"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={busy || !newSubjectCode.trim() || !newSubjectName.trim()}
                onClick={handleAddNewSubject}
                className="px-4 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-xs font-bold"
              >
                {busy ? "กำลังบันทึก..." : "เพิ่มรหัสวิชา"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal วางข้อมูลจาก Excel / แก้ไขเป็นชุดรวดเดียว (100+ วิชา) */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl max-w-3xl w-full p-4 sm:p-5 shadow-xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[#c9d4ec] dark:border-[#2a3a6e] pb-3">
              <div className="flex items-center gap-2">
                <ClipboardPaste className="w-5 h-5 text-[#0b7a4b] dark:text-[#4fd39a]" />
                <div>
                  <h3 className="font-bold text-base text-[#0f2150] dark:text-[#e9eefc]">
                    วางข้อมูลจาก Excel / แก้ไขรหัสวิชาและชื่อวิชาเป็นชุด (100+ วิชาในคลิกเดียว)
                  </h3>
                  <p className="text-xs text-[#51608a] dark:text-[#9fb0dc]">
                    คัดลอก 2 คอลัมน์จาก Excel (รหัสวิชา และ ชื่อวิชา) มาวางทับได้เลย หรือพิมพ์บรรทัดละ 1 วิชา
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#f4f7fc] dark:bg-[#0b1330] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-lg p-3 text-xs space-y-1 text-[#0f2150] dark:text-[#e9eefc]">
              <div className="font-bold text-[#1b4fb8] dark:text-[#6c97ff]">
                รองรับทุกรูปแบบในกล่องเดียว (บรรทัดละ 1 วิชา):
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[#51608a] dark:text-[#9fb0dc]">
                <li>
                  <b>วางจาก Excel 2 คอลัมน์:</b>{" "}
                  <code className="text-[#0f2150] dark:text-white font-mono">
                    ว21102 &nbsp;&nbsp; วิทยาศาสตร์พื้นฐาน 2
                  </code>
                </li>
                <li>
                  <b>คั่นด้วย = หรือ , หรือ เว้นวรรค:</b>{" "}
                  <code className="text-[#0f2150] dark:text-white font-mono">
                    ค31102 = คณิตศาสตร์พื้นฐาน
                  </code>{" "}
                  หรือ{" "}
                  <code className="text-[#0f2150] dark:text-white font-mono">
                    ท21102,ภาษาไทยพื้นฐาน
                  </code>
                </li>
                <li>
                  <b>เปลี่ยนรหัสวิชาในตารางสอนครูพร้อมชื่อวิชา:</b>{" "}
                  <code className="text-[#0f2150] dark:text-white font-mono">
                    ว21101 -&gt; ว21102 = วิทยาศาสตร์พื้นฐาน
                  </code>
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#0f2150] dark:text-[#e9eefc]">
                ตรวจพบข้อมูลพร้อมบันทึก:{" "}
                <span className="text-[#0b7a4b] dark:text-[#4fd39a]">
                  ชื่อวิชา {parsedBulkPreview.mappingCount} รายการ
                </span>
                {parsedBulkPreview.renameCount > 0 && (
                  <span className="ml-2 text-[#1b4fb8] dark:text-[#6c97ff]">
                    · เปลี่ยนรหัสวิชาในตารางสอน {parsedBulkPreview.renameCount} รหัส
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(bulkTextInput);
                    setStatusBanner({
                      text: "คัดลอกรายการทั้งหมดแล้ว สามารถนำไปวางใน Excel เพื่อแก้ไขได้เลย",
                      type: "ok",
                    });
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] text-xs font-semibold text-[#0f2150] dark:text-[#e9eefc] hover:bg-slate-100 dark:hover:bg-blue-950 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>คัดลอกทั้งหมดไป Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBulkTextInput("")}
                  className="px-2.5 py-1 rounded-md border border-[#c9d4ec] dark:border-[#2a3a6e] text-xs font-semibold text-[#51608a] dark:text-[#9fb0dc] hover:bg-slate-100 dark:hover:bg-blue-950 cursor-pointer"
                >
                  ล้างช่องข้อความเพื่อวางใหม่
                </button>
              </div>
            </div>

            <textarea
              value={bulkTextInput}
              onChange={(e) => setBulkTextInput(e.target.value)}
              rows={12}
              placeholder={"วางข้อมูลจาก Excel ที่นี่ เช่น:\nว21102\tวิทยาศาสตร์พื้นฐาน\nค21102\tคณิตศาสตร์พื้นฐาน\nท21101 -> ท21102 = ภาษาไทยพื้นฐาน"}
              className="w-full flex-1 min-h-[220px] p-3 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] font-mono text-xs sm:text-sm text-[#0f2150] dark:text-[#e9eefc] focus:outline-2 focus:outline-[#1b4fb8]"
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#c9d4ec] dark:border-[#2a3a6e]">
              <button
                type="button"
                onClick={() => setIsBulkModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] text-xs font-semibold text-[#0f2150] dark:text-[#e9eefc] cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  (parsedBulkPreview.mappingCount === 0 &&
                    parsedBulkPreview.renameCount === 0)
                }
                onClick={handleApplyBulkText}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0b7a4b] hover:bg-[#085c38] disabled:opacity-50 text-white text-xs sm:text-sm font-bold cursor-pointer"
              >
                <Save className="w-4 h-4 shrink-0" />
                <span>
                  {busy
                    ? "กำลังบันทึก..."
                    : `บันทึกทั้งหมดในคลิกเดียว (${parsedBulkPreview.mappingCount + parsedBulkPreview.renameCount} รายการ)`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
