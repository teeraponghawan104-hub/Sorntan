import React, { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { ActiveTab, Header } from "./components/Header";
import { SubstitutePlanner } from "./components/SubstitutePlanner";
import { MasterTimetableView } from "./components/MasterTimetableView";
import { FreeTeacherFinder } from "./components/FreeTeacherFinder";
import { DatabaseManagerView } from "./components/DatabaseManagerView";
import { TeacherEditorModal } from "./components/TeacherEditorModal";
import { INITIAL_TEACHERS, TeacherRecord } from "./data/teachers";
import {
  adjustDateToAcademicYear,
  autoAssignCombinedSubstitutes,
  buildCombinedTeacherHeader,
  formatCombinedReasonsSummary,
  getInitialWeekdayDate,
  isTeacherExemptFromNeedingSubstitute,
  renameCourseCodesInTeachers,
} from "./utils/scheduler";
import { OperationType, db, handleFirestoreError } from "./firebase";
import {
  ACADEMIC_SETTINGS_DOC_ID,
  AcademicSettings,
  LIVE_WORKSPACE_DOC_ID,
  LivePlannerWorkspaceState,
  SHARED_OWNER_ID,
  SUBJECT_MAPPINGS_DOC_ID,
  SavedSubstituteRecord,
  clearAllSubstituteRecordsFromDatabase,
  decodeAssignments,
  loadLocalAcademicSettings,
  loadLocalPlannerState,
  loadLocalSubjectMappings,
  loadLocalSubstituteRecords,
  loadLocalTeachers,
  removeSubstituteRecordFromDatabase,
  removeTeacherFromDatabase,
  saveAcademicSettingsToCloud,
  saveLocalAcademicSettings,
  saveLocalPlannerState,
  saveLocalSubjectMappings,
  saveLocalSubstituteRecords,
  saveLocalTeachers,
  saveSubjectMappingsToCloud,
  syncAllTeachersToCloud,
  upsertSubstituteRecordInDatabase,
  upsertTeacherInDatabase,
} from "./utils/databaseStore";

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("planner");
  const [darkMode, setDarkMode] = useState<boolean>(false);

  // รายชื่อครูทั้งหมด, ประวัติใบสอนแทน, รหัสวิชา และปีการศึกษาจากฐานข้อมูลกลาง
  const [teachers, setTeachers] = useState<TeacherRecord[]>(() => loadLocalTeachers());
  const [savedRecords, setSavedRecords] = useState<SavedSubstituteRecord[]>(() =>
    loadLocalSubstituteRecords()
  );
  const [subjectMappings, setSubjectMappings] = useState<Record<string, string>>(() =>
    loadLocalSubjectMappings()
  );
  const [academicSettings, setAcademicSettings] = useState<AcademicSettings>(() =>
    loadLocalAcademicSettings()
  );

  // สถานะ Modal แก้ไข/เพิ่มครู
  const [editorModalOpen, setEditorModalOpen] = useState<boolean>(false);
  const [editingTeacher, setEditingTeacher] = useState<TeacherRecord | null>(null);
  const [saveToastMessage, setSaveToastMessage] = useState<string>("");

  // โหลดค่าเริ่มต้นของหน้าจัดครูสอนแทนจากที่บันทึกไว้ล่าสุด (หรือค่าเริ่มต้นครู 102)
  const initialDate = getInitialWeekdayDate();
  const initialSavedPlanner = loadLocalPlannerState();
  const rawInitialTeacherIds =
    initialSavedPlanner && initialSavedPlanner.absentTeacherIds.length > 0
      ? initialSavedPlanner.absentTeacherIds.filter((id) => !isTeacherExemptFromNeedingSubstitute(id))
      : ["102"];
  const initialTeacherIds = rawInitialTeacherIds.length > 0 ? rawInitialTeacherIds : ["102"];
  const initialSelectedDate = initialSavedPlanner?.selectedDate || initialDate;
  const initialReason = initialSavedPlanner?.reason || "ไปราชการ";
  const initialTeacherReasons: Record<string, string> =
    initialSavedPlanner?.teacherReasons &&
    Object.keys(initialSavedPlanner.teacherReasons).length > 0
      ? initialSavedPlanner.teacherReasons
      : Object.fromEntries(initialTeacherIds.map((id) => [String(id), initialReason]));
  const initialStudentTeacherName = initialSavedPlanner?.studentTeacherName || "";
  const initialIncludeSupervision = Boolean(initialSavedPlanner?.includeSupervision);

  const [absentTeacherIds, setAbsentTeacherIds] = useState<string[]>(initialTeacherIds);
  const [selectedDate, setSelectedDate] = useState<string>(initialSelectedDate);
  const [reason, setReason] = useState<string>(initialReason);
  const [teacherReasons, setTeacherReasons] = useState<Record<string, string>>(
    initialTeacherReasons
  );
  const [studentTeacherName, setStudentTeacherName] = useState<string>(
    initialStudentTeacherName
  );
  const [includeSupervision, setIncludeSupervision] = useState<boolean>(
    initialIncludeSupervision
  );
  const [assignments, setAssignments] = useState<Record<string, string>>(() => {
    if (
      initialSavedPlanner &&
      initialSavedPlanner.assignments &&
      Object.keys(initialSavedPlanner.assignments).length > 0
    ) {
      return initialSavedPlanner.assignments;
    }
    return autoAssignCombinedSubstitutes(
      initialTeacherIds,
      initialSelectedDate,
      initialIncludeSupervision
    );
  });

  const [focusTimetableTeacherIds, setFocusTimetableTeacherIds] = useState<number[]>(
    []
  );

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [darkMode]);

  // ซิงก์ข้อมูลกับ Cloud Firestore ฐานข้อมูลกลางแบบเรียลไทม์ทันทีโดยไม่ต้องล็อกอิน
  useEffect(() => {
    const teachersQuery = query(
      collection(db, "teachers"),
      where("ownerId", "==", SHARED_OWNER_ID)
    );

    let seededOnce = false;
    let lastTeachersSig = "";
    let lastRecordsSig = "";
    let lastMappingsSig = "";
    let lastAcademicSig = "";

    const unsubTeachers = onSnapshot(
      teachersQuery,
      (snapshot) => {
        if (snapshot.empty && !seededOnce) {
          seededOnce = true;
          syncAllTeachersToCloud(loadLocalTeachers()).catch((err) => {
            console.error("Failed to seed initial teachers to Firestore:", err);
          });
          return;
        }
        if (!snapshot.empty) {
          const cloudTeachers: TeacherRecord[] = [];
          snapshot.forEach((docSnap) => {
            const d = docSnap.data();
            cloudTeachers.push({
              id: Number(d.id),
              n: String(d.n || ""),
              g: String(d.g || ""),
              pdfGroup: String(d.pdfGroup || d.g || ""),
              r: String(d.r || "-"),
              totalHours: Number(d.totalHours || 0),
              coursesSummary: Array.isArray(d.coursesSummary)
                ? d.coursesSummary.map(String)
                : [],
              otherSummary: String(d.otherSummary || ""),
              s: String(d.s || ""),
              isStudentTeacher: Boolean(d.isStudentTeacher),
            });
          });

          cloudTeachers.sort((a, b) => a.id - b.id);
          const nextSig = JSON.stringify(cloudTeachers);
          if (nextSig !== lastTeachersSig) {
            lastTeachersSig = nextSig;
            const updated = saveLocalTeachers(cloudTeachers);
            setTeachers(updated);
          }
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "teachers");
      }
    );

    const recordsQuery = query(
      collection(db, "substitute_records"),
      where("ownerId", "==", SHARED_OWNER_ID)
    );

    const unsubRecords = onSnapshot(
      recordsQuery,
      (snapshot) => {
        const cloudRecords: SavedSubstituteRecord[] = [];
        snapshot.forEach((docSnap) => {
          if (docSnap.id === LIVE_WORKSPACE_DOC_ID) return;
          const d = docSnap.data();
          const decoded = decodeAssignments(String(d.assignmentsJson || ""));

          cloudRecords.push({
            recordId: String(d.recordId || docSnap.id),
            absentTeacherId: Number(d.absentTeacherId),
            absentTeacherIds: decoded.absentTeacherIds,
            absentTeacherName: String(d.absentTeacherName || ""),
            absentTeacherGroup: String(d.absentTeacherGroup || ""),
            selectedDate: String(d.selectedDate || ""),
            reason: String(d.reason || "ไปราชการ"),
            teacherReasons: decoded.teacherReasons,
            studentTeacherName: String(d.studentTeacherName || ""),
            includeSupervision: Boolean(d.includeSupervision),
            assignments: decoded.assignments,
            updatedAtIso: String(d.updatedAtIso || ""),
          });
        });

        const nextSig = JSON.stringify(cloudRecords);
        if (nextSig !== lastRecordsSig) {
          lastRecordsSig = nextSig;
          saveLocalSubstituteRecords(cloudRecords);
          setSavedRecords(cloudRecords);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "substitute_records");
      }
    );

    const mappingsQuery = query(
      collection(db, "subject_mappings"),
      where("ownerId", "==", SHARED_OWNER_ID)
    );

    const unsubMappings = onSnapshot(
      mappingsQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          snapshot.forEach((docSnap) => {
            if (docSnap.id === SUBJECT_MAPPINGS_DOC_ID) {
              const d = docSnap.data();
              const rawJson = String(d.mappingsJson || "{}");
              if (rawJson !== lastMappingsSig) {
                try {
                  const parsed = JSON.parse(rawJson);
                  if (parsed && typeof parsed === "object") {
                    lastMappingsSig = rawJson;
                    saveLocalSubjectMappings(parsed);
                    setSubjectMappings(parsed);
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            } else if (docSnap.id === ACADEMIC_SETTINGS_DOC_ID) {
              const d = docSnap.data();
              const rawJson = String(d.mappingsJson || "{}");
              if (rawJson !== lastAcademicSig) {
                try {
                  const parsed = JSON.parse(rawJson);
                  if (parsed && typeof parsed === "object") {
                    lastAcademicSig = rawJson;
                    const cleanSettings = saveLocalAcademicSettings(parsed);
                    setAcademicSettings(cleanSettings);
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "subject_mappings");
      }
    );

    return () => {
      unsubTeachers();
      unsubRecords();
      unsubMappings();
    };
  }, []);

  // บันทึกฉบับร่างในเครื่อง (localStorage) เพื่อป้องกันข้อมูลสูญหายเมื่อรีเฟรชหน้าจอ โดยไม่บันทึกลงฐานข้อมูลอัตโนมัติ
  const saveLocalDraft = (nextState: LivePlannerWorkspaceState) => {
    saveLocalPlannerState(nextState);
  };

  // เปลี่ยนครูหลักจาก #ta
  const handlePrimaryTeacherChange = (newId: string) => {
    if (!newId) {
      setAbsentTeacherIds([]);
      setAssignments({});
      return;
    }
    if (isTeacherExemptFromNeedingSubstitute(newId)) return;
    const rest = absentTeacherIds.slice(1).filter((id) => id !== newId);
    const nextIds = [newId, ...rest];
    const nextReasons: Record<string, string> = {
      ...teacherReasons,
      [newId]: teacherReasons[newId] || reason || "ไปราชการ",
    };
    const nextAssignments = autoAssignCombinedSubstitutes(
      nextIds,
      selectedDate,
      includeSupervision
    );
    setAbsentTeacherIds(nextIds);
    setTeacherReasons(nextReasons);
    setAssignments(nextAssignments);
    saveLocalDraft({
      absentTeacherIds: nextIds,
      selectedDate,
      reason,
      teacherReasons: nextReasons,
      studentTeacherName,
      includeSupervision,
      assignments: nextAssignments,
    });
  };

  // เพิ่มครูที่ลาเพิ่มเติมลงในตารางเดียวกัน
  const handleAddAbsentTeacher = (preferredTeacherId?: string) => {
    const usedIds = new Set(absentTeacherIds);
    let targetId = preferredTeacherId || "";
    if (isTeacherExemptFromNeedingSubstitute(targetId)) return;
    if (!targetId || usedIds.has(targetId)) {
      const nextAvailable = teachers.find(
        (t) => !usedIds.has(String(t.id)) && !isTeacherExemptFromNeedingSubstitute(t)
      );
      targetId = nextAvailable ? String(nextAvailable.id) : "";
    }
    if (!targetId || isTeacherExemptFromNeedingSubstitute(targetId)) return;

    const nextIds = [...absentTeacherIds, targetId];
    const nextReasons: Record<string, string> = { ...teacherReasons };
    absentTeacherIds.forEach((id) => {
      if (!nextReasons[id]) {
        nextReasons[id] = reason || "ไปราชการ";
      }
    });
    if (!nextReasons[targetId]) {
      nextReasons[targetId] = reason || "ไปราชการ";
    }
    const nextAssignments = autoAssignCombinedSubstitutes(
      nextIds,
      selectedDate,
      includeSupervision
    );
    setAbsentTeacherIds(nextIds);
    setTeacherReasons(nextReasons);
    setAssignments(nextAssignments);
    saveLocalDraft({
      absentTeacherIds: nextIds,
      selectedDate,
      reason,
      teacherReasons: nextReasons,
      studentTeacherName,
      includeSupervision,
      assignments: nextAssignments,
    });
  };

  // ลบครูออกจากตารางเดียวกัน
  const handleRemoveAbsentTeacher = (teacherIdToRemove: string) => {
    if (absentTeacherIds.length <= 1) return;
    const nextIds = absentTeacherIds.filter((id) => id !== teacherIdToRemove);
    const nextAssignments = autoAssignCombinedSubstitutes(
      nextIds,
      selectedDate,
      includeSupervision
    );
    setAbsentTeacherIds(nextIds);
    setAssignments(nextAssignments);
    saveLocalDraft({
      absentTeacherIds: nextIds,
      selectedDate,
      reason,
      teacherReasons,
      studentTeacherName,
      includeSupervision,
      assignments: nextAssignments,
    });
  };

  // เปลี่ยนวันที่สอนแทน
  const handleDateChange = (newDate: string) => {
    const nextAssignments = autoAssignCombinedSubstitutes(
      absentTeacherIds,
      newDate,
      includeSupervision
    );
    setSelectedDate(newDate);
    setAssignments(nextAssignments);
    saveLocalDraft({
      absentTeacherIds,
      selectedDate: newDate,
      reason,
      teacherReasons,
      studentTeacherName,
      includeSupervision,
      assignments: nextAssignments,
    });
  };

  // เปลี่ยนเหตุผล / ภารกิจ (สำหรับกรณีครูคนเดียว หรือกดปุ่มตั้งให้เหมือนกันทุกคน)
  const handleReasonChange = (newReason: string) => {
    const nextReasons: Record<string, string> = { ...teacherReasons };
    absentTeacherIds.forEach((id) => {
      nextReasons[String(id)] = newReason;
    });
    setReason(newReason);
    setTeacherReasons(nextReasons);
    saveLocalDraft({
      absentTeacherIds,
      selectedDate,
      reason: newReason,
      teacherReasons: nextReasons,
      studentTeacherName,
      includeSupervision,
      assignments,
    });
  };

  // เปลี่ยนเหตุผลการลารายบุคคล (กรณีมีครูลาหลายท่านและเหตุผลไม่เหมือนกัน)
  const handleTeacherReasonChange = (teacherId: string, newReason: string) => {
    const key = String(teacherId);
    const nextReasons: Record<string, string> = {
      ...teacherReasons,
      [key]: newReason,
    };
    setTeacherReasons(nextReasons);
    const nextDefaultReason =
      absentTeacherIds.length === 1 && String(absentTeacherIds[0]) === key
        ? newReason
        : reason;
    if (nextDefaultReason !== reason) {
      setReason(nextDefaultReason);
    }
    saveLocalDraft({
      absentTeacherIds,
      selectedDate,
      reason: nextDefaultReason,
      teacherReasons: nextReasons,
      studentTeacherName,
      includeSupervision,
      assignments,
    });
  };

  // เปลี่ยนชื่อนักศึกษาฝึกสอนเพิ่มเติม
  const handleStudentTeacherNameChange = (newName: string) => {
    setStudentTeacherName(newName);
    saveLocalDraft({
      absentTeacherIds,
      selectedDate,
      reason,
      teacherReasons,
      studentTeacherName: newName,
      includeSupervision,
      assignments,
    });
  };

  // เปลี่ยนตัวเลือกรวมคาบนิเทศสอน
  const handleIncludeSupervisionChange = (inc: boolean) => {
    const nextAssignments = autoAssignCombinedSubstitutes(
      absentTeacherIds,
      selectedDate,
      inc
    );
    setIncludeSupervision(inc);
    setAssignments(nextAssignments);
    saveLocalDraft({
      absentTeacherIds,
      selectedDate,
      reason,
      teacherReasons,
      studentTeacherName,
      includeSupervision: inc,
      assignments: nextAssignments,
    });
  };

  // จัดอัตโนมัติใหม่ทั้งตาราง
  const handleResetAutoAssign = () => {
    const nextAssignments = autoAssignCombinedSubstitutes(
      absentTeacherIds,
      selectedDate,
      includeSupervision
    );
    setAssignments(nextAssignments);
    saveLocalDraft({
      absentTeacherIds,
      selectedDate,
      reason,
      teacherReasons,
      studentTeacherName,
      includeSupervision,
      assignments: nextAssignments,
    });
  };

  // เปลี่ยนผู้สอนแทนรายคาบในตารางเดียวกัน
  const handleAssignmentChange = (
    slotKey: string,
    periodIndex: number,
    value: string
  ) => {
    const next: Record<string, string> = {
      ...assignments,
      [slotKey]: value,
    };
    if (absentTeacherIds.length === 1) {
      next[String(periodIndex)] = value;
    }
    setAssignments(next);
    saveLocalDraft({
      absentTeacherIds,
      selectedDate,
      reason,
      teacherReasons,
      studentTeacherName,
      includeSupervision,
      assignments: next,
    });
  };

  const handleViewTeacherTimetable = (teacherIdOrIds: number | number[]) => {
    const ids = (Array.isArray(teacherIdOrIds) ? teacherIdOrIds : [teacherIdOrIds])
      .map(Number)
      .filter((id) => id > 0);
    setFocusTimetableTeacherIds(ids);
    setActiveTab("timetables");
  };

  const handleSelectTeacherFromDirectory = (teacherId: number) => {
    const effectiveTeacherId = teacherId === 302 ? 305 : teacherId;
    const idStr = String(effectiveTeacherId);
    const nextIds = [idStr];
    const nextReasons: Record<string, string> = {
      ...teacherReasons,
      [idStr]: teacherReasons[idStr] || reason || "ไปราชการ",
    };
    const nextAssignments = autoAssignCombinedSubstitutes(
      nextIds,
      selectedDate,
      includeSupervision
    );
    setAbsentTeacherIds(nextIds);
    setTeacherReasons(nextReasons);
    setAssignments(nextAssignments);
    setActiveTab("planner");
    saveLocalDraft({
      absentTeacherIds: nextIds,
      selectedDate,
      reason,
      teacherReasons: nextReasons,
      studentTeacherName,
      includeSupervision,
      assignments: nextAssignments,
    });
  };

  // CRUD: เพิ่ม / แก้ไขครู (บันทึกลงฐานข้อมูลกลาง)
  const handleSaveTeacher = async (teacherRecord: TeacherRecord) => {
    const updated = await upsertTeacherInDatabase(teacherRecord, teachers);
    setTeachers(updated);
    const nextAssignments = autoAssignCombinedSubstitutes(
      absentTeacherIds,
      selectedDate,
      includeSupervision
    );
    setAssignments(nextAssignments);
    saveLocalDraft({
      absentTeacherIds,
      selectedDate,
      reason,
      teacherReasons,
      studentTeacherName,
      includeSupervision,
      assignments: nextAssignments,
    });
    setSaveToastMessage(
      `บันทึกตารางสอนของ "${teacherRecord.id} ${teacherRecord.n}" ลงฐานข้อมูลเรียบร้อยแล้ว`
    );
    window.setTimeout(() => {
      setSaveToastMessage("");
    }, 3500);
  };

  // CRUD: ลบครู (ลบจากฐานข้อมูลกลาง)
  const handleDeleteTeacher = async (teacherId: number) => {
    const updated = await removeTeacherFromDatabase(teacherId, teachers);
    setTeachers(updated);
    const remainingIds = absentTeacherIds.filter((id) => id !== String(teacherId));
    const nextIds =
      remainingIds.length > 0
        ? remainingIds
        : updated[0]
        ? [String(updated[0].id)]
        : [];
    const nextAssignments = autoAssignCombinedSubstitutes(
      nextIds,
      selectedDate,
      includeSupervision
    );
    setAbsentTeacherIds(nextIds);
    setAssignments(nextAssignments);
    saveLocalDraft({
      absentTeacherIds: nextIds,
      selectedDate,
      reason,
      teacherReasons,
      studentTeacherName,
      includeSupervision,
      assignments: nextAssignments,
    });
  };

  // CRUD: กู้คืนข้อมูลเริ่มต้นจาก PDF ทั้ง 31 ท่าน
  const handleResetDefaultTeachers = async () => {
    const updated = await syncAllTeachersToCloud(INITIAL_TEACHERS);
    setTeachers(updated);
    const nextAssignments = autoAssignCombinedSubstitutes(
      absentTeacherIds,
      selectedDate,
      includeSupervision
    );
    setAssignments(nextAssignments);
    saveLocalDraft({
      absentTeacherIds,
      selectedDate,
      reason,
      teacherReasons,
      studentTeacherName,
      includeSupervision,
      assignments: nextAssignments,
    });
  };

  // CRUD: บันทึกใบสอนแทนปัจจุบันลงฐานข้อมูลกลาง (เมื่อผู้ใช้กดปุ่มบันทึกประวัติ)
  const handleSaveCurrentSubstituteRecord = async () => {
    const combinedHeader = buildCombinedTeacherHeader(absentTeacherIds);
    if (!combinedHeader) return;
    const idsPart = absentTeacherIds.join("-");
    const recordId = `rec_${idsPart}_${selectedDate.replace(/[^0-9]/g, "")}`;
    const selectedTeachersForSummary = absentTeacherIds
      .map((id) => teachers.find((t) => String(t.id) === String(id)))
      .filter((t): t is TeacherRecord => Boolean(t));
    const combinedReasonSummary = formatCombinedReasonsSummary(
      selectedTeachersForSummary,
      reason,
      teacherReasons
    );
    const updatedRecords = await upsertSubstituteRecordInDatabase(
      {
        recordId,
        absentTeacherId: combinedHeader.id,
        absentTeacherIds: [...absentTeacherIds],
        absentTeacherName: combinedHeader.n,
        absentTeacherGroup: combinedHeader.pdfGroup,
        selectedDate,
        reason: combinedReasonSummary,
        teacherReasons: { ...teacherReasons },
        studentTeacherName,
        includeSupervision,
        assignments,
      },
      savedRecords
    );
    setSavedRecords(updatedRecords);
  };

  // CRUD: โหลดใบสอนแทนที่บันทึกไว้กลับมาแก้ไข/พิมพ์
  const handleLoadSubstituteRecord = (record: SavedSubstituteRecord) => {
    const loadedIds =
      record.absentTeacherIds && record.absentTeacherIds.length > 0
        ? record.absentTeacherIds
        : [String(record.absentTeacherId)];
    const loadedAssignments = { ...record.assignments };
    const loadedReasons: Record<string, string> =
      record.teacherReasons && Object.keys(record.teacherReasons).length > 0
        ? { ...record.teacherReasons }
        : Object.fromEntries(loadedIds.map((id) => [String(id), record.reason || "ไปราชการ"]));
    setAbsentTeacherIds(loadedIds);
    setSelectedDate(record.selectedDate);
    setReason(record.reason);
    setTeacherReasons(loadedReasons);
    setStudentTeacherName(record.studentTeacherName);
    setIncludeSupervision(record.includeSupervision);
    setAssignments(loadedAssignments);
    setActiveTab("planner");
    saveLocalDraft({
      absentTeacherIds: loadedIds,
      selectedDate: record.selectedDate,
      reason: record.reason,
      teacherReasons: loadedReasons,
      studentTeacherName: record.studentTeacherName,
      includeSupervision: record.includeSupervision,
      assignments: loadedAssignments,
    });
  };

  // CRUD: ลบใบสอนแทนที่บันทึกไว้
  const handleDeleteSubstituteRecord = async (recordId: string) => {
    const updated = await removeSubstituteRecordFromDatabase(recordId, savedRecords);
    setSavedRecords(updated);
  };

  // CRUD: ล้างประวัติใบสอนแทนทั้งหมด (สำหรับเริ่มต้นภาคเรียน / ปีการศึกษาใหม่)
  const handleClearAllSubstituteRecords = async () => {
    const updated = await clearAllSubstituteRecordsFromDatabase(savedRecords);
    setSavedRecords(updated);
  };

  // CRUD: บันทึกผูกชื่อวิชาตามรหัสวิชา
  const handleSaveSubjectMappings = async (newMappings: Record<string, string>) => {
    const updated = await saveSubjectMappingsToCloud(newMappings);
    setSubjectMappings({ ...updated });
    const nextAssignments = autoAssignCombinedSubstitutes(
      absentTeacherIds,
      selectedDate,
      includeSupervision
    );
    setAssignments(nextAssignments);
  };

  // CRUD: รีเซ็ตชื่อวิชาตามรหัสวิชาทั้งหมด
  const handleResetSubjectMappings = async () => {
    const updated = await saveSubjectMappingsToCloud({});
    setSubjectMappings({ ...updated });
    const nextAssignments = autoAssignCombinedSubstitutes(
      absentTeacherIds,
      selectedDate,
      includeSupervision
    );
    setAssignments(nextAssignments);
  };

  // CRUD: เปลี่ยนรหัสวิชาแบบกลุ่มในตารางสอนของครูทุกคน พร้อมอัปเดตชื่อวิชาที่ผูกไว้ในครั้งเดียว
  const handleBulkRenameCourseCodes = async (
    codeRenames: Record<string, string>,
    extraMappings?: Record<string, string>
  ): Promise<{ replacedSlotCount: number; affectedTeachersCount: number }> => {
    const { updatedTeachers, replacedSlotCount, affectedTeachersCount } =
      renameCourseCodesInTeachers(teachers, codeRenames);

    if (affectedTeachersCount > 0) {
      const syncedTeachers = await syncAllTeachersToCloud(updatedTeachers);
      setTeachers(syncedTeachers);
    }

    const nextMappings: Record<string, string> = { ...subjectMappings };
    Object.entries(codeRenames).forEach(([oldCode, newCode]) => {
      if (oldCode && newCode && oldCode !== newCode && nextMappings[oldCode]) {
        if (!nextMappings[newCode]) {
          nextMappings[newCode] = nextMappings[oldCode];
        }
        delete nextMappings[oldCode];
      }
    });

    if (extraMappings) {
      Object.entries(extraMappings).forEach(([code, name]) => {
        if (code.trim() && name.trim()) {
          nextMappings[code.trim()] = name.trim();
        }
      });
    }

    const updatedMappings = await saveSubjectMappingsToCloud(nextMappings);
    setSubjectMappings({ ...updatedMappings });

    const nextAssignments = autoAssignCombinedSubstitutes(
      absentTeacherIds,
      selectedDate,
      includeSupervision
    );
    setAssignments(nextAssignments);

    return { replacedSlotCount, affectedTeachersCount };
  };

  // CRUD: บันทึกปีการศึกษาและภาคเรียนลงฐานข้อมูลกลาง และปรับปีของวันที่จัดสอนแทนให้ตรงกับปีการศึกษาใหม่ทันที
  const handleSaveAcademicSettings = async (newSettings: AcademicSettings) => {
    const updated = await saveAcademicSettingsToCloud(newSettings);
    setAcademicSettings({ ...updated });

    // ปรับปีของวันที่ในหน้าจัดสอนแทนให้ตรงกับปีการศึกษาที่เลือก เพื่อให้ใบสอนแทนแสดง พ.ศ. ตรงกันทันที
    const nextDate = adjustDateToAcademicYear(selectedDate, updated.academicYear);
    if (nextDate !== selectedDate) {
      const nextAssignments = autoAssignCombinedSubstitutes(
        absentTeacherIds,
        nextDate,
        includeSupervision
      );
      setSelectedDate(nextDate);
      setAssignments(nextAssignments);
      saveLocalDraft({
        absentTeacherIds,
        selectedDate: nextDate,
        reason,
        teacherReasons,
        studentTeacherName,
        includeSupervision,
        assignments: nextAssignments,
      });
    }
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] transition-colors">
      <Header
        activeTab={activeTab}
        onSelectTab={(tab) => {
          if (tab !== "timetables") setFocusTimetableTeacherIds([]);
          setActiveTab(tab);
        }}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        teacherCount={teachers.length}
        academicSettings={academicSettings}
      />

      <main className="max-w-[1360px] mx-auto p-3 sm:p-4 md:p-5">
        {saveToastMessage && (
          <div
            role="status"
            className="mb-3 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-400 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 text-sm font-bold flex items-center justify-between shadow-xs print:hidden"
          >
            <span>{saveToastMessage}</span>
            <button
              type="button"
              onClick={() => setSaveToastMessage("")}
              className="text-xs font-semibold underline ml-3 cursor-pointer"
            >
              ปิด
            </button>
          </div>
        )}
        {activeTab === "planner" && (
          <SubstitutePlanner
            teachers={teachers}
            academicSettings={academicSettings}
            absentTeacherIds={absentTeacherIds}
            onChangePrimaryTeacherId={handlePrimaryTeacherChange}
            onAddAbsentTeacher={handleAddAbsentTeacher}
            onRemoveAbsentTeacher={handleRemoveAbsentTeacher}
            selectedDate={selectedDate}
            onChangeDate={handleDateChange}
            reason={reason}
            onChangeReason={handleReasonChange}
            teacherReasons={teacherReasons}
            onChangeTeacherReason={handleTeacherReasonChange}
            studentTeacherName={studentTeacherName}
            onChangeStudentTeacherName={handleStudentTeacherNameChange}
            assignments={assignments}
            onChangeAssignment={handleAssignmentChange}
            onResetAutoAssign={handleResetAutoAssign}
            includeSupervision={includeSupervision}
            onChangeIncludeSupervision={handleIncludeSupervisionChange}
            onViewTeacherTimetable={handleViewTeacherTimetable}
            savedRecords={savedRecords}
            onSaveCurrentRecord={handleSaveCurrentSubstituteRecord}
            onLoadSavedRecord={handleLoadSubstituteRecord}
            onDeleteSavedRecord={handleDeleteSubstituteRecord}
            onOpenDatabaseTab={() => setActiveTab("database")}
          />
        )}

        {activeTab === "timetables" && (
          <MasterTimetableView
            teachers={teachers}
            academicSettings={academicSettings}
            initialFocusTeacherIds={focusTimetableTeacherIds}
            onClearFocusTeachers={() => setFocusTimetableTeacherIds([])}
            onBackToPlanner={() => setActiveTab("planner")}
            onSelectTeacherForSubstitute={handleSelectTeacherFromDirectory}
            onOpenAddTeacher={() => {
              setEditingTeacher(null);
              setEditorModalOpen(true);
            }}
            onOpenEditTeacher={(teacher) => {
              setEditingTeacher(teacher);
              setEditorModalOpen(true);
            }}
          />
        )}

        {activeTab === "free-finder" && (
          <FreeTeacherFinder
            teachers={teachers}
            academicSettings={academicSettings}
            onSelectTeacherForSubstitute={handleSelectTeacherFromDirectory}
          />
        )}

        {activeTab === "database" && (
          <DatabaseManagerView
            teachers={teachers}
            savedRecords={savedRecords}
            subjectMappings={subjectMappings}
            academicSettings={academicSettings}
            onSaveAcademicSettings={handleSaveAcademicSettings}
            onOpenAddTeacher={() => {
              setEditingTeacher(null);
              setEditorModalOpen(true);
            }}
            onOpenEditTeacher={(teacher) => {
              setEditingTeacher(teacher);
              setEditorModalOpen(true);
            }}
            onDeleteTeacher={handleDeleteTeacher}
            onResetDefaultTeachers={handleResetDefaultTeachers}
            onBulkSaveTeachers={async (nextTeachers) => {
              const updated = await syncAllTeachersToCloud(nextTeachers);
              setTeachers(updated);
              const nextAssignments = autoAssignCombinedSubstitutes(
                absentTeacherIds,
                selectedDate,
                includeSupervision
              );
              setAssignments(nextAssignments);
            }}
            onLoadSubstituteRecord={handleLoadSubstituteRecord}
            onDeleteSubstituteRecord={handleDeleteSubstituteRecord}
            onClearAllSubstituteRecords={handleClearAllSubstituteRecords}
            onViewTeacherTimetable={handleViewTeacherTimetable}
            onSaveSubjectMappings={handleSaveSubjectMappings}
            onResetSubjectMappings={handleResetSubjectMappings}
            onBulkRenameCourseCodes={handleBulkRenameCourseCodes}
          />
        )}
      </main>

      <footer className="mt-8 py-4 border-t border-[#c9d4ec] dark:border-[#2a3a6e] text-center text-xs text-[#51608a] dark:text-[#9fb0dc] print:hidden">
        <p>
          ระบบจัดสอนแทน โรงเรียนวรคุณอุปถัมภ์ ·{" "}
          {academicSettings.semester === "ฤดูร้อน"
            ? "ภาคฤดูร้อน"
            : `ภาคเรียนที่ ${academicSettings.semester}`}{" "}
          ปีการศึกษา {academicSettings.academicYear}
        </p>
        <p className="mt-0.5 font-medium text-[#1b4fb8] dark:text-[#6c97ff]">
          พัฒนาโดย นักศึกษาฝึกวิชาชีพครู นายธีระพงษ์ หาวัน
        </p>
      </footer>

      {editorModalOpen && (
        <TeacherEditorModal
          initialTeacher={editingTeacher}
          existingIds={teachers.map((t) => t.id)}
          onClose={() => {
            setEditorModalOpen(false);
            setEditingTeacher(null);
          }}
          onSave={handleSaveTeacher}
        />
      )}
    </div>
  );
}
