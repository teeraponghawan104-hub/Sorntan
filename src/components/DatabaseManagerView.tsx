import React, { useState } from "react";
import {
  Cloud,
  Database,
  Edit3,
  FileText,
  LogIn,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Table2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { User } from "firebase/auth";
import { DEPARTMENT_GROUPS, TeacherRecord } from "../data/teachers";
import { formatRoomLabel, formatThaiDate, resolveSubstitute } from "../utils/scheduler";
import { SavedSubstituteRecord } from "../utils/databaseStore";

interface DatabaseManagerViewProps {
  teachers: TeacherRecord[];
  savedRecords: SavedSubstituteRecord[];
  currentUser: User | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onOpenAddTeacher: () => void;
  onOpenEditTeacher: (teacher: TeacherRecord) => void;
  onDeleteTeacher: (teacherId: number) => Promise<void>;
  onResetDefaultTeachers: () => Promise<void>;
  onLoadSubstituteRecord: (record: SavedSubstituteRecord) => void;
  onDeleteSubstituteRecord: (recordId: string) => Promise<void>;
  onViewTeacherTimetable: (teacherId: number) => void;
}

export const DatabaseManagerView: React.FC<DatabaseManagerViewProps> = ({
  teachers,
  savedRecords,
  currentUser,
  onSignIn,
  onSignOut,
  onOpenAddTeacher,
  onOpenEditTeacher,
  onDeleteTeacher,
  onResetDefaultTeachers,
  onLoadSubstituteRecord,
  onDeleteSubstituteRecord,
  onViewTeacherTimetable,
}) => {
  const [subTab, setSubTab] = useState<"teachers" | "records">("teachers");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterGroup, setFilterGroup] = useState<string>("ทั้งหมด");
  const [confirmDeleteTeacher, setConfirmDeleteTeacher] = useState<TeacherRecord | null>(null);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [confirmDeleteRecordId, setConfirmDeleteRecordId] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{ text: string; type: "ok" | "err" } | null>(
    null
  );
  const [busy, setBusy] = useState<boolean>(false);

  const regularCount = teachers.filter((t) => !t.isStudentTeacher).length;
  const studentCount = teachers.filter((t) => Boolean(t.isStudentTeacher)).length;

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

  const handleConfirmDeleteTeacher = async () => {
    if (!confirmDeleteTeacher) return;
    try {
      setBusy(true);
      const targetName = `${confirmDeleteTeacher.id} ${confirmDeleteTeacher.n}`;
      await onDeleteTeacher(confirmDeleteTeacher.id);
      setConfirmDeleteTeacher(null);
      setStatusBanner({ text: `ลบข้อมูล "${targetName}" เรียบร้อยแล้ว`, type: "ok" });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "ลบข้อมูลไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmReset = async () => {
    try {
      setBusy(true);
      await onResetDefaultTeachers();
      setConfirmReset(false);
      setStatusBanner({
        text: "กู้คืนข้อมูลครูและนักศึกษาฝึกสอนทั้ง 31 ท่านจาก PDF เรียบร้อยแล้ว",
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

  const handleConfirmDeleteRecord = async (recordId: string) => {
    try {
      setBusy(true);
      await onDeleteSubstituteRecord(recordId);
      setConfirmDeleteRecordId(null);
      setStatusBanner({ text: "ลบประวัติใบสอนแทนเรียบร้อยแล้ว", type: "ok" });
    } catch (err: unknown) {
      setStatusBanner({
        text: err instanceof Error ? err.message : "ลบใบสอนแทนไม่สำเร็จ",
        type: "err",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5 w-full">
      {/* แผงควบคุมฐานข้อมูลและสถานะ Cloud Firestore */}
      <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Database className="w-5 h-5 text-[#1b4fb8] dark:text-[#6c97ff]" />
              <h2 className="text-lg sm:text-xl font-bold text-[#0f2150] dark:text-[#e9eefc]">
                จัดการฐานข้อมูล (เพิ่ม · แก้ไข · ลบ ข้อมูลครูและใบสอนแทน)
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-[#51608a] dark:text-[#9fb0dc]">
              ครูประจำการ <b>{regularCount}</b> ท่าน · นักศึกษาฝึกสอน <b>{studentCount}</b> ท่าน ·
              ประวัติใบสอนแทน <b>{savedRecords.length}</b> รายการ
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {currentUser ? (
              <div className="flex flex-wrap items-center gap-2 bg-[#eaf0fa] dark:bg-[#0b1330] px-3 py-1.5 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e]">
                <Cloud className="w-4 h-4 text-[#0b7a4b] dark:text-[#4fd39a] shrink-0" />
                <span className="text-xs font-semibold text-[#0f2150] dark:text-[#e9eefc]">
                  ซิงก์ Cloud: {currentUser.email}
                </span>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-white dark:bg-[#14204a] text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>ออกจากระบบ</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#1b4fb8] dark:border-[#6c97ff] text-[#1b4fb8] dark:text-[#6c97ff] hover:bg-[#eaf0fa] dark:hover:bg-blue-950 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
              >
                <LogIn className="w-4 h-4 shrink-0" />
                <span>เข้าสู่ระบบ Google (ซิงก์ Cloud Database)</span>
              </button>
            )}

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
        <div className="grid grid-cols-2 sm:flex items-center gap-2 mt-4 pt-3 border-t border-[#c9d4ec] dark:border-[#2a3a6e]">
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

      {/* ยืนยันการคืนค่าเริ่มต้น */}
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
                      <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300 text-xs font-bold">
                        นักศึกษาฝึกสอน
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-[#eaf0fa] dark:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff] text-xs font-semibold">
                        {t.pdfGroup}
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

      {/* หมวดที่ 2: ประวัติใบสอนแทนที่บันทึกไว้ */}
      {subTab === "records" && (
        <section className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-4 sm:p-5 shadow-xs space-y-4">
          {savedRecords.length === 0 ? (
            <div className="text-center py-10 text-[#51608a] dark:text-[#9fb0dc]">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-base font-bold text-[#0f2150] dark:text-[#e9eefc]">
                ยังไม่มีประวัติใบสอนแทนที่บันทึกไว้ในฐานข้อมูล
              </p>
              <p className="text-xs mt-1">
                สามารถกดปุ่ม &ldquo;บันทึกใบสอนแทนลงฐานข้อมูล&rdquo; ได้ที่หน้าจัดครูสอนแทน
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#c9d4ec] dark:divide-[#2a3a6e]">
              {savedRecords.map((rec) => {
                const assignedList = Object.entries(rec.assignments).map(([pStr, val]) => {
                  const sub = resolveSubstitute(val, rec.studentTeacherName);
                  return `คาบ ${Number(pStr) + 1}: ${sub.n}`;
                });

                return (
                  <div
                    key={rec.recordId}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-base text-[#0f2150] dark:text-[#e9eefc]">
                          {rec.absentTeacherId} {rec.absentTeacherName}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#eaf0fa] dark:bg-[#0b1330] text-[#1b4fb8] dark:text-[#6c97ff] text-xs font-semibold">
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
    </div>
  );
};
