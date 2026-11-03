import React, { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { ActiveTab, Header } from "./components/Header";
import { SubstitutePlanner } from "./components/SubstitutePlanner";
import { MasterTimetableView } from "./components/MasterTimetableView";
import { FreeTeacherFinder } from "./components/FreeTeacherFinder";
import { DatabaseManagerView } from "./components/DatabaseManagerView";
import { TeacherEditorModal } from "./components/TeacherEditorModal";
import { INITIAL_TEACHERS, TeacherRecord } from "./data/teachers";
import {
  autoAssignCombinedSubstitutes,
  buildCombinedTeacherHeader,
  getCombinedTeacherClasses,
  getInitialWeekdayDate,
  isTeacherExemptFromNeedingSubstitute,
} from "./utils/scheduler";
import { OperationType, db, handleFirestoreError } from "./firebase";
import {
  LIVE_WORKSPACE_DOC_ID,
  LivePlannerWorkspaceState,
  SHARED_OWNER_ID,
  SavedSubstituteRecord,
  decodeAssignments,
  loadLocalPlannerState,
  loadLocalSubstituteRecords,
  loadLocalTeachers,
  removeSubstituteRecordFromDatabase,
  removeTeacherFromDatabase,
  saveLocalPlannerState,
  saveLocalSubstituteRecords,
  saveLocalTeachers,
  syncAllTeachersToCloud,
  upsertSubstituteRecordInDatabase,
  upsertTeacherInDatabase,
} from "./utils/databaseStore";

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("planner");
  const [darkMode, setDarkMode] = useState<boolean>(false);

  // รายชื่อครูทั้งหมดและประวัติใบสอนแทนจากฐานข้อมูลกลาง
  const [teachers, setTeachers] = useState<TeacherRecord[]>(() => loadLocalTeachers());
  const [savedRecords, setSavedRecords] = useState<SavedSubstituteRecord[]>(() =>
    loadLocalSubstituteRecords()
  );

  // สถานะ Modal แก้ไข/เพิ่มครู
  const [editorModalOpen, setEditorModalOpen] = useState<boolean>(false);
  const [editingTeacher, setEditingTeacher] = useState<TeacherRecord | null>(null);

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
  const initialStudentTeacherName = initialSavedPlanner?.studentTeacherName || "";
  const initialIncludeSupervision = Boolean(initialSavedPlanner?.includeSupervision);

  const [absentTeacherIds, setAbsentTeacherIds] = useState<string[]>(initialTeacherIds);
  const [selectedDate, setSelectedDate] = useState<string>(initialSelectedDate);
  const [reason, setReason] = useState<string>(initialReason);
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

  const [focusTimetableTeacherId, setFocusTimetableTeacherId] = useState<number | null>(
    null
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
          const updated = saveLocalTeachers(cloudTeachers);
          setTeachers(updated);
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
            studentTeacherName: String(d.studentTeacherName || ""),
            includeSupervision: Boolean(d.includeSupervision),
            assignments: decoded.assignments,
            updatedAtIso: new Date().toISOString(),
          });
        });

        saveLocalSubstituteRecords(cloudRecords);
        setSavedRecords(cloudRecords);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "substitute_records");
      }
    );

    return () => {
      unsubTeachers();
      unsubRecords();
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
      studentTeacherName,
      includeSupervision,
      assignments: nextAssignments,
    });
  };

  // เปลี่ยนเหตุผล / ภารกิจ
  const handleReasonChange = (newReason: string) => {
    setReason(newReason);
    saveLocalDraft({
      absentTeacherIds,
      selectedDate,
      reason: newReason,
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
      studentTeacherName,
      includeSupervision,
      assignments: next,
    });
  };

  const handleViewTeacherTimetable = (teacherId: number) => {
    setFocusTimetableTeacherId(teacherId);
    setActiveTab("timetables");
  };

  const handleSelectTeacherFromDirectory = (teacherId: number) => {
    const idStr = String(teacherId);
    const nextIds = [idStr];
    const nextAssignments = autoAssignCombinedSubstitutes(
      nextIds,
      selectedDate,
      includeSupervision
    );
    setAbsentTeacherIds(nextIds);
    setAssignments(nextAssignments);
    setActiveTab("planner");
    saveLocalDraft({
      absentTeacherIds: nextIds,
      selectedDate,
      reason,
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
  };

  // CRUD: บันทึกใบสอนแทนปัจจุบันลงฐานข้อมูลกลาง (เมื่อผู้ใช้กดปุ่มบันทึกประวัติ)
  const handleSaveCurrentSubstituteRecord = async () => {
    const combinedHeader = buildCombinedTeacherHeader(absentTeacherIds);
    if (!combinedHeader) return;
    const idsPart = absentTeacherIds.join("-");
    const recordId = `rec_${idsPart}_${selectedDate.replace(/[^0-9]/g, "")}`;
    const updatedRecords = await upsertSubstituteRecordInDatabase(
      {
        recordId,
        absentTeacherId: combinedHeader.id,
        absentTeacherIds: [...absentTeacherIds],
        absentTeacherName: combinedHeader.n,
        absentTeacherGroup: combinedHeader.pdfGroup,
        selectedDate,
        reason,
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
    setAbsentTeacherIds(loadedIds);
    setSelectedDate(record.selectedDate);
    setReason(record.reason);
    setStudentTeacherName(record.studentTeacherName);
    setIncludeSupervision(record.includeSupervision);
    setAssignments(loadedAssignments);
    setActiveTab("planner");
    saveLocalDraft({
      absentTeacherIds: loadedIds,
      selectedDate: record.selectedDate,
      reason: record.reason,
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

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] transition-colors">
      <Header
        activeTab={activeTab}
        onSelectTab={(tab) => {
          if (tab !== "timetables") setFocusTimetableTeacherId(null);
          setActiveTab(tab);
        }}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        teacherCount={teachers.length}
      />

      <main className="max-w-[1360px] mx-auto p-3 sm:p-4 md:p-5">
        {activeTab === "planner" && (
          <SubstitutePlanner
            teachers={teachers}
            absentTeacherIds={absentTeacherIds}
            onChangePrimaryTeacherId={handlePrimaryTeacherChange}
            onAddAbsentTeacher={handleAddAbsentTeacher}
            onRemoveAbsentTeacher={handleRemoveAbsentTeacher}
            selectedDate={selectedDate}
            onChangeDate={handleDateChange}
            reason={reason}
            onChangeReason={handleReasonChange}
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
            initialFocusTeacherId={focusTimetableTeacherId}
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
            onSelectTeacherForSubstitute={handleSelectTeacherFromDirectory}
          />
        )}

        {activeTab === "database" && (
          <DatabaseManagerView
            teachers={teachers}
            savedRecords={savedRecords}
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
            onLoadSubstituteRecord={handleLoadSubstituteRecord}
            onDeleteSubstituteRecord={handleDeleteSubstituteRecord}
            onViewTeacherTimetable={handleViewTeacherTimetable}
          />
        )}
      </main>

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
