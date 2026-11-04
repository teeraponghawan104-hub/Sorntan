import React, { useEffect, useState } from "react";
import {
  Cloud,
  Database,
  Edit3,
  FileText,
  Plus,
  RotateCcw,
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
} from "lucide-react";
import { DEPARTMENT_GROUPS, TeacherRecord } from "../data/teachers";
import {
  formatRoomLabel,
  formatThaiDate,
  getAllDiscoveredSubjectCodes,
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
  onLoadSubstituteRecord: (record: SavedSubstituteRecord) => void;
  onDeleteSubstituteRecord: (recordId: string) => Promise<void>;
  onClearAllSubstituteRecords: () => Promise<void>;
  onViewTeacherTimetable: (teacherId: number) => void;
  onSaveSubjectMappings: (newMappings: Record<string, string>) => Promise<void>;
  onResetSubjectMappings: () => Promise<void>;
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
  onLoadSubstituteRecord,
  onDeleteSubstituteRecord,
  onClearAllSubstituteRecords,
  onViewTeacherTimetable,
  onSaveSubjectMappings,
  onResetSubjectMappings,
}) => {
  const [subTab, setSubTab] = useState<"teachers" | "subjects" | "records">("teachers");

  // State สำหรับตั้งค่าปีการศึกษาและภาคเรียน
  const [yearInput, setYearInput] = useState<string>(academicSettings.academicYear);
  const [semesterInput, setSemesterInput] = useState<string>(academicSettings.semester);

  useEffect(() => {
    setYearInput(academicSettings.academicYear);
    setSemesterInput(academicSettings.semester);
  }, [academicSettings.academicYear, academicSettings.semester]);

  // State สำหรับครู
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterGroup, setFilterGroup] = useState<string>("ทั้งหมด");
  const [confirmDeleteTeacher, setConfirmDeleteTeacher] = useState<TeacherRecord | null>(null);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);

  // State สำหรับประวัติใบสอนแทน
  const [confirmDeleteRecordId, setConfirmDeleteRecordId] = useState<string | null>(null);
  const [confirmClearAllRecords, setConfirmClearAllRecords] = useState<boolean>(false);

  // State สำหรับรหัสวิชา & ชื่อวิชา
  const [subjectSearch, setSubjectSearch] = useState<string>("");
  const [subjectCategoryFilter, setSubjectCategoryFilter] = useState<string>("ทั้งหมด");
  const [editingSubject, setEditingSubject] = useState<SubjectCodeInfo | null>(null);
  const [editSubjectNameInput, setEditSubjectNameInput] = useState<string>("");
  const [isAddingSubject, setIsAddingSubject] = useState<boolean>(false);
  const [newSubjectCode, setNewSubjectCode] = useState<string>("");
  const [newSubjectName, setNewSubjectName] = useState<string>("");
  const [confirmResetSubjects, setConfirmResetSubjects] = useState<boolean>(false);

  // Status message
  const [statusBanner, setStatusBanner] = useState<{ text: string; type: "ok" | "err" } | null>(
    null
  );
  const [busy, setBusy] = useState<boolean>(false);

  const regularCount = teachers.filter((t) => !t.isStudentTeacher).length;
  const studentCount = teachers.filter((t) => Boolean(t.isStudentTeacher)).length;

  // รายการรหัสวิชาทั้งหมดที่ค้นพบในระบบ
  const discoveredSubjects = getAllDiscoveredSubjectCodes();
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

  // บันทึกปีการศึกษาและภาคเรียน
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
    try {
      setBusy(true);
      await onSaveAcademicSettings({
        academicYear: String(parsedYear),
        semester: cleanSemester,
      });
      const semText =
        cleanSemester === "ฤดูร้อน" ? "ภาคฤดูร้อน" : `ภาคเรียนที่ ${cleanSemester}`;
      setStatusBanner({
        text: `อัปเดตเป็น "${semText} ปีการศึกษา ${parsedYear}" เรียบร้อยแล้ว (เปลี่ยนพร้อมกันทุกหน้าในระบบ)`,
        type: "ok",
      });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "บันทึกปีการศึกษาไม่สำเร็จ",
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

  return (
    <div className="space-y-4 sm:space-y-5 w-full">
      {/* แผงตั้งค่าปีการศึกษาและภาคเรียน (สำหรับใช้งานในปีต่อๆ ไป) */}
      <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Calendar className="w-5 h-5 text-[#1b4fb8] dark:text-[#6c97ff]" />
              <h2 className="text-base sm:text-lg font-bold text-[#0f2150] dark:text-[#e9eefc]">
                ตั้งค่าภาคเรียนและปีการศึกษา (สำหรับใช้งานในปีต่อๆ ไป)
              </h2>
              <span className="px-2 py-0.5 rounded-md bg-[#eaf0fa] dark:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff] text-xs font-bold border border-[#c9d4ec] dark:border-[#2a3a6e]">
                กำลังใช้งาน:{" "}
                {academicSettings.semester === "ฤดูร้อน"
                  ? "ภาคฤดูร้อน"
                  : `ภาคเรียนที่ ${academicSettings.semester}`}{" "}
                ปีการศึกษา {academicSettings.academicYear}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-[#51608a] dark:text-[#9fb0dc]">
              เมื่อเปลี่ยนปีการศึกษาหรือภาคเรียน ระบบจะอัปเดตหัวตารางสอนและปี พ.ศ. ในหน้าจัดสอนแทนให้ตรงกันทุกเครื่องโดยอัตโนมัติ
            </p>
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
                ปีการศึกษา (พ.ศ.):
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
                <span>บันทึกปีการศึกษา</span>
              </button>
            </div>
          </div>
        </div>

        {/* ปุ่มลัดเลือกปีการศึกษา */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-dashed border-[#c9d4ec] dark:border-[#2a3a6e]">
          <span className="text-xs font-semibold text-[#51608a] dark:text-[#9fb0dc] mr-1">
            เลือกปีการศึกษาด่วน:
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
      </section>

      {/* แผงควบคุมฐานข้อมูลและสถานะ Cloud Firestore */}
      <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Database className="w-5 h-5 text-[#1b4fb8] dark:text-[#6c97ff]" />
              <h2 className="text-lg sm:text-xl font-bold text-[#0f2150] dark:text-[#e9eefc]">
                จัดการฐานข้อมูลกลาง (เห็นตรงกันทุกคน)
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-[#51608a] dark:text-[#9fb0dc]">
              ครู <b>{regularCount}</b> ท่าน · นศ.ฝึกสอน <b>{studentCount}</b> ท่าน · รหัสวิชา{" "}
              <b>{discoveredSubjects.length}</b> รหัส (แก้ไขแล้ว <b>{customSubjectsCount}</b>) ·
              ประวัติ <b>{savedRecords.length}</b> รายการ
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
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>เพิ่มครู / นศ.ฝึกสอนใหม่</span>
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#51608a] dark:text-[#9fb0dc] hover:text-[#0f2150] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-blue-950 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 shrink-0" />
                  <span>คืนค่าเริ่มต้น PDF (31 ท่าน)</span>
                </button>
              </>
            )}

            {subTab === "subjects" && (
              <>
                <button
                  type="button"
                  onClick={() => setIsAddingSubject(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>ผูกรหัสวิชาใหม่</span>
                </button>

                {customSubjectsCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmResetSubjects(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#51608a] dark:text-[#9fb0dc] hover:text-[#0f2150] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-blue-950 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4 shrink-0" />
                    <span>คืนค่าชื่อวิชาทั้งหมด</span>
                  </button>
                )}
              </>
            )}

            {subTab === "records" && savedRecords.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmClearAllRecords(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>ล้างประวัติทั้งหมด (เริ่มปีใหม่)</span>
              </button>
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
              ผูกรหัสวิชากับชื่อวิชา ({discoveredSubjects.length}
              {customSubjectsCount > 0 ? ` · แก้ไข ${customSubjectsCount}` : ""})
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
            <FileText className="w-4 h-4 shrink-0" />
            <span>ประวัติใบสอนแทน ({savedRecords.length})</span>
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

      {/* หมวดที่ 2: ผูกรหัสวิชากับชื่อวิชา */}
      {subTab === "subjects" && (
        <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
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
                  <th className="p-3 w-32">รหัสวิชา</th>
                  <th className="p-3">ชื่อวิชาที่แสดงในเอกสาร</th>
                  <th className="p-3">ค่าเริ่มต้นระบบ</th>
                  <th className="p-3 w-28 text-center">สถานะ</th>
                  <th className="p-3">ครูผู้สอนในระบบ</th>
                  <th className="p-3 w-36 text-right">จัดการ</th>
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
                  filteredDiscoveredSubjects.map((item) => (
                    <tr
                      key={item.code}
                      className="hover:bg-slate-50 dark:hover:bg-blue-950/40 transition-colors"
                    >
                      <td className="p-3 font-mono font-bold text-[#1b4fb8] dark:text-[#6c97ff]">
                        {item.code}
                      </td>
                      <td className="p-3 font-bold text-[#0f2150] dark:text-[#e9eefc]">
                        {item.currentName}
                      </td>
                      <td className="p-3 text-[#51608a] dark:text-[#9fb0dc]">
                        {item.defaultName}
                      </td>
                      <td className="p-3 text-center">
                        {item.isCustom ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-[#0b7a4b] dark:text-[#4fd39a] text-xs font-bold">
                            <Check className="w-3 h-3" /> แก้ไขแล้ว
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[#51608a] dark:text-[#9fb0dc] text-xs font-medium">
                            ค่าเริ่มต้น
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-xs text-[#51608a] dark:text-[#9fb0dc]">
                        {item.teacherNames.length > 0 ? (
                          <span>{item.teacherNames.join(", ")}</span>
                        ) : (
                          <span className="italic text-slate-400">-</span>
                        )}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap space-x-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditSubject(item)}
                          className="px-2.5 py-1 rounded-md bg-[#1b4fb8] hover:bg-[#153e91] text-white text-xs font-bold cursor-pointer"
                        >
                          แก้ไขชื่อวิชา
                        </button>
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* หมวดที่ 3: ประวัติใบสอนแทนที่บันทึกไว้ */}
      {subTab === "records" && (
        <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
          {savedRecords.length === 0 ? (
            <div className="text-center py-10 text-[#51608a] dark:text-[#9fb0dc]">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-base font-bold text-[#0f2150] dark:text-[#e9eefc]">
                ยังไม่มีประวัติใบสอนแทนที่บันทึกไว้ในฐานข้อมูล
              </p>
              <p className="text-xs mt-1">
                สามารถกดปุ่ม &ldquo;บันทึกประวัติ&rdquo; ได้ที่หน้าจัดสอนแทน
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
                        <span>เปิดดู / แก้ไขใบสอนแทน</span>
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
    </div>
  );
};
