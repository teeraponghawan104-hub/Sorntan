import React, { useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { ActiveTab, Header } from "./components/Header";
import { SubstitutePlanner } from "./components/SubstitutePlanner";
import { MasterTimetableView } from "./components/MasterTimetableView";
import { FreeTeacherFinder } from "./components/FreeTeacherFinder";
import { DatabaseManagerView } from "./components/DatabaseManagerView";
import { TeacherEditorModal } from "./components/TeacherEditorModal";
import { INITIAL_TEACHERS, TeacherRecord } from "./data/teachers";
import {
  autoAssignSubstitutes,
  getInitialWeekdayDate,
  getTeacherById,
} from "./utils/scheduler";
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  signInWithGoogle,
  signOutUser,
} from "./firebase";
import {
  SavedSubstituteRecord,
  decodeAssignments,
  loadLocalSubstituteRecords,
  loadLocalTeachers,
  removeSubstituteRecordFromDatabase,
  removeTeacherFromDatabase,
  saveLocalSubstituteRecords,
  saveLocalTeachers,
  syncAllTeachersToCloud,
  upsertSubstituteRecordInDatabase,
  upsertTeacherInDatabase,
} from "./utils/databaseStore";

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("planner");
  const [darkMode, setDarkMode] = useState<boolean>(false);

  // รายชื่อครูทั้งหมดและประวัติใบสอนแทนจากฐานข้อมูล
  const [teachers, setTeachers] = useState<TeacherRecord[]>(() => loadLocalTeachers());
  const [savedRecords, setSavedRecords] = useState<SavedSubstituteRecord[]>(() =>
    loadLocalSubstituteRecords()
  );
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // สถานะ Modal แก้ไข/เพิ่มครู
  const [editorModalOpen, setEditorModalOpen] = useState<boolean>(false);
  const [editingTeacher, setEditingTeacher] = useState<TeacherRecord | null>(null);

  // ค่าเริ่มต้นของหน้าจัดครูสอนแทน
  const initialDate = getInitialWeekdayDate();
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("102");
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [reason, setReason] = useState<string>("ไปราชการ");
  const [studentTeacherName, setStudentTeacherName] = useState<string>("");
  const [includeSupervision, setIncludeSupervision] = useState<boolean>(false);
  const [assignments, setAssignments] = useState<Record<number, string>>(() =>
    autoAssignSubstitutes("102", initialDate, false)
  );
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

  // ตรวจสอบสถานะการเข้าสู่ระบบและซิงก์ข้อมูลกับ Cloud Firestore แบบเรียลไทม์
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!currentUser || !currentUser.emailVerified) return;

    const teachersQuery = query(
      collection(db, "teachers"),
      where("ownerId", "==", currentUser.uid)
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
      where("ownerId", "==", currentUser.uid)
    );

    const unsubRecords = onSnapshot(
      recordsQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const cloudRecords: SavedSubstituteRecord[] = [];
          snapshot.forEach((docSnap) => {
            const d = docSnap.data();
            cloudRecords.push({
              recordId: String(d.recordId || docSnap.id),
              absentTeacherId: Number(d.absentTeacherId),
              absentTeacherName: String(d.absentTeacherName || ""),
              absentTeacherGroup: String(d.absentTeacherGroup || ""),
              selectedDate: String(d.selectedDate || ""),
              reason: String(d.reason || "ไปราชการ"),
              studentTeacherName: String(d.studentTeacherName || ""),
              includeSupervision: Boolean(d.includeSupervision),
              assignments: decodeAssignments(String(d.assignmentsJson || "")),
              updatedAtIso: new Date().toISOString(),
            });
          });
          saveLocalSubstituteRecords(cloudRecords);
          setSavedRecords(cloudRecords);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "substitute_records");
      }
    );

    return () => {
      unsubTeachers();
      unsubRecords();
    };
  }, [currentUser]);

  const handleTeacherChange = (newId: string) => {
    setSelectedTeacherId(newId);
    setAssignments(autoAssignSubstitutes(newId, selectedDate, includeSupervision));
  };

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    setAssignments(
      autoAssignSubstitutes(selectedTeacherId, newDate, includeSupervision)
    );
  };

  const handleIncludeSupervisionChange = (inc: boolean) => {
    setIncludeSupervision(inc);
    setAssignments(autoAssignSubstitutes(selectedTeacherId, selectedDate, inc));
  };

  const handleResetAutoAssign = () => {
    setAssignments(
      autoAssignSubstitutes(selectedTeacherId, selectedDate, includeSupervision)
    );
  };

  const handleAssignmentChange = (periodIndex: number, value: string) => {
    setAssignments((prev) => ({
      ...prev,
      [periodIndex]: value,
    }));
  };

  const handleViewTeacherTimetable = (teacherId: number) => {
    setFocusTimetableTeacherId(teacherId);
    setActiveTab("timetables");
  };

  const handleSelectTeacherFromDirectory = (teacherId: number) => {
    const idStr = String(teacherId);
    setSelectedTeacherId(idStr);
    setAssignments(autoAssignSubstitutes(idStr, selectedDate, includeSupervision));
    setActiveTab("planner");
  };

  // CRUD: เพิ่ม / แก้ไขครู
  const handleSaveTeacher = async (teacherRecord: TeacherRecord) => {
    const updated = await upsertTeacherInDatabase(teacherRecord, teachers);
    setTeachers(updated);
    // คำนวณการจัดสอนแทนใหม่หากกระทบครูที่เลือกอยู่
    setAssignments(
      autoAssignSubstitutes(selectedTeacherId, selectedDate, includeSupervision)
    );
  };

  // CRUD: ลบครู
  const handleDeleteTeacher = async (teacherId: number) => {
    const updated = await removeTeacherFromDatabase(teacherId, teachers);
    setTeachers(updated);
    if (String(teacherId) === selectedTeacherId) {
      const nextDefaultId = updated[0] ? String(updated[0].id) : "";
      setSelectedTeacherId(nextDefaultId);
      setAssignments(
        autoAssignSubstitutes(nextDefaultId, selectedDate, includeSupervision)
      );
    } else {
      setAssignments(
        autoAssignSubstitutes(selectedTeacherId, selectedDate, includeSupervision)
      );
    }
  };

  // CRUD: กู้คืนข้อมูลเริ่มต้นจาก PDF ทั้ง 31 ท่าน
  const handleResetDefaultTeachers = async () => {
    const updated = await syncAllTeachersToCloud(INITIAL_TEACHERS);
    setTeachers(updated);
    setAssignments(
      autoAssignSubstitutes(selectedTeacherId, selectedDate, includeSupervision)
    );
  };

  // CRUD: บันทึกใบสอนแทนปัจจุบันลงฐานข้อมูล
  const handleSaveCurrentSubstituteRecord = async () => {
    const absent = getTeacherById(selectedTeacherId);
    if (!absent) return;
    const recordId = `rec_${absent.id}_${selectedDate.replace(/[^0-9]/g, "")}`;
    const updatedRecords = await upsertSubstituteRecordInDatabase(
      {
        recordId,
        absentTeacherId: absent.id,
        absentTeacherName: absent.n,
        absentTeacherGroup: absent.pdfGroup,
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
    setSelectedTeacherId(String(record.absentTeacherId));
    setSelectedDate(record.selectedDate);
    setReason(record.reason);
    setStudentTeacherName(record.studentTeacherName);
    setIncludeSupervision(record.includeSupervision);
    setAssignments({ ...record.assignments });
    setActiveTab("planner");
  };

  // CRUD: ลบใบสอนแทนที่บันทึกไว้
  const handleDeleteSubstituteRecord = async (recordId: string) => {
    const updated = await removeSubstituteRecordFromDatabase(recordId, savedRecords);
    setSavedRecords(updated);
  };

  const handleSignIn = async () => {
    await signInWithGoogle();
  };

  const handleSignOut = async () => {
    await signOutUser();
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
            selectedTeacherId={selectedTeacherId}
            onChangeTeacherId={handleTeacherChange}
            selectedDate={selectedDate}
            onChangeDate={handleDateChange}
            reason={reason}
            onChangeReason={setReason}
            studentTeacherName={studentTeacherName}
            onChangeStudentTeacherName={setStudentTeacherName}
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
            currentUser={currentUser}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
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
