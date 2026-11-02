import React, { useEffect, useState } from "react";
import { ActiveTab, Header } from "./components/Header";
import { SubstitutePlanner } from "./components/SubstitutePlanner";
import { MasterTimetableView } from "./components/MasterTimetableView";
import { FreeTeacherFinder } from "./components/FreeTeacherFinder";
import {
  autoAssignSubstitutes,
  getInitialWeekdayDate,
} from "./utils/scheduler";

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("planner");
  const [darkMode, setDarkMode] = useState<boolean>(false);

  // ค่าเริ่มต้น: เลือกครู 102 (ครูรติพงษ์ รักษาพันธุ์) และวันทำการปัจจุบัน เพื่อให้เห็นตัวอย่างใบสอนแทนทันที
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

  return (
    <div className="min-h-screen bg-[#eaf0fa] dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] transition-colors">
      <Header
        activeTab={activeTab}
        onSelectTab={(tab) => {
          if (tab !== "timetables") setFocusTimetableTeacherId(null);
          setActiveTab(tab);
        }}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
      />

      <main className="max-w-[1360px] mx-auto p-4 md:p-5">
        {activeTab === "planner" && (
          <SubstitutePlanner
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
          />
        )}

        {activeTab === "timetables" && (
          <MasterTimetableView
            initialFocusTeacherId={focusTimetableTeacherId}
            onSelectTeacherForSubstitute={handleSelectTeacherFromDirectory}
          />
        )}

        {activeTab === "free-finder" && (
          <FreeTeacherFinder
            onSelectTeacherForSubstitute={handleSelectTeacherFromDirectory}
          />
        )}
      </main>
    </div>
  );
}
