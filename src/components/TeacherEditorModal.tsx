import React, { useMemo, useState } from "react";
import { X, Save, Plus, Wand2, RotateCcw, AlertTriangle, Check } from "lucide-react";
import { DAYS, PERIOD_TIMES, TeacherRecord } from "../data/teachers";
import {
  autoFixScheduleGridFormat,
  summarizeTeacherGrid,
  validateTeacherScheduleGrid,
} from "../utils/scheduler";

interface TeacherEditorModalProps {
  initialTeacher: TeacherRecord | null; // null = เพิ่มครูใหม่
  existingIds: number[];
  initialActiveCell?: { day: number; period: number } | null;
  onClose: () => void;
  onSave: (teacher: TeacherRecord) => Promise<void>;
}

const DEFAULT_DEPARTMENTS = [
  "บริหาร",
  "ภาษาไทย",
  "คณิตศาสตร์",
  "วิทยาศาสตร์",
  "สังคมศึกษา",
  "พลศึกษา",
  "ศิลปะ",
  "การงานอาชีพ",
  "ภาษาต่างประเทศ",
];

const QUICK_CELL_TAGS = [
  { label: "ว่าง (ล้างช่อง)", value: "" },
  { label: "* ประชุมฝ่าย", value: "*" },
  { label: "#โฮมรูม", value: "#โฮมรูม" },
  { label: "#ชุมนุม", value: "#ชุมนุม" },
  { label: "#ฐาน ศก.", value: "#ฐาน ศก." },
  { label: "#กิจกรรม", value: "#กิจกรรม" },
  { label: "#การป้องกันทุจริต", value: "#การป้องกันทุจริต" },
  { label: "#แนะแนว", value: "#แนะแนว" },
];

export const TeacherEditorModal: React.FC<TeacherEditorModalProps> = ({
  initialTeacher,
  existingIds,
  initialActiveCell = null,
  onClose,
  onSave,
}) => {
  const isEditMode = Boolean(initialTeacher);

  // คำนวณรหัสครูถัดไปอัตโนมัติกรณีเพิ่มใหม่
  const suggestedId = (() => {
    if (initialTeacher) return initialTeacher.id;
    let candidate = 104;
    while (existingIds.includes(candidate)) {
      candidate++;
    }
    return candidate;
  })();

  const [id, setId] = useState<string>(String(suggestedId));
  const [name, setName] = useState<string>(initialTeacher?.n || "");
  const [isStudentTeacher, setIsStudentTeacher] = useState<boolean>(
    Boolean(initialTeacher?.isStudentTeacher)
  );
  const [group, setGroup] = useState<string>(initialTeacher?.g || "ภาษาไทย");
  const [pdfGroup, setPdfGroup] = useState<string>(initialTeacher?.pdfGroup || "ภาษาไทย");
  const [room, setRoom] = useState<string>(initialTeacher?.r || "101");
  const [totalHours, setTotalHours] = useState<string>(
    String(initialTeacher?.totalHours ?? 20)
  );
  const [coursesText, setCoursesText] = useState<string>(
    (initialTeacher?.coursesSummary || []).join("\n")
  );
  const [otherSummary, setOtherSummary] = useState<string>(
    initialTeacher?.otherSummary ||
      "PLC [5] กิจกรรม [1] ชุมนุม [1] ฐาน ศก. [1] แนะแนว [1] โฮมรูม ต.ทุจริต [1]"
  );

  // ตารางสอน 5 วัน x 7 คาบ
  const [grid, setGrid] = useState<string[][]>(() => {
    if (initialTeacher?.d && initialTeacher.d.length === 5) {
      return initialTeacher.d.map((row) => [...row]);
    }
    return [
      ["", "", "", "", "", "", "#ชุมนุม"],
      ["", "", "", "", "", "", "#ฐาน ศก."],
      ["", "", "", "", "", "", "#กิจกรรม"],
      ["#โฮมรูม", "", "", "", "", "", "#การป้องกันทุจริต"],
      ["", "", "", "", "", "", "#แนะแนว"],
    ];
  });

  const [activeCell, setActiveCell] = useState<{ day: number; period: number } | null>(
    initialActiveCell
  );
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  const scheduleIssues = useMemo(
    () => validateTeacherScheduleGrid(grid),
    [grid]
  );
  const issueByCellKey = useMemo(() => {
    const map = new Map<string, (typeof scheduleIssues)[number]>();
    scheduleIssues.forEach((iss) => {
      map.set(`${iss.dayIndex}_${iss.periodIndex}`, iss);
    });
    return map;
  }, [scheduleIssues]);
  const hasAutoFixableIssues = useMemo(
    () => scheduleIssues.some((iss) => Boolean(iss.suggestedValue)),
    [scheduleIssues]
  );

  const handleAutoFixGridFormat = () => {
    const { grid: fixedGrid, fixedCount } = autoFixScheduleGridFormat(grid);
    if (fixedCount > 0) {
      setGrid(fixedGrid);
      syncSummaryWithGrid(fixedGrid, room);
    }
  };

  const syncSummaryWithGrid = (
    nextGrid: string[][],
    targetRoom: string,
    targetOther = otherSummary,
    targetIsStudent = isStudentTeacher,
    targetGroup = pdfGroup || group
  ) => {
    const existingLines = coursesText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const auto = summarizeTeacherGrid(
      nextGrid,
      targetRoom,
      targetOther,
      targetIsStudent,
      targetGroup,
      Number(id) || initialTeacher?.id,
      existingLines.length > 0 ? existingLines : initialTeacher?.coursesSummary || []
    );
    setTotalHours(String(auto.totalHours));
    setCoursesText(auto.coursesSummary.join("\n"));
  };

  const handleCellChange = (dayIdx: number, periodIdx: number, val: string) => {
    setGrid((prev) => {
      const next = prev.map((r) => [...r]);
      next[dayIdx][periodIdx] = val;
      syncSummaryWithGrid(next, room);
      return next;
    });
  };

  // รองรับการก๊อปปี้ตาราง 5 วัน x 7 คาบจาก Excel มาวาง (Ctrl+V) ลงในช่องตารางโดยตรง
  const handleCellPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    startDay: number,
    startPeriod: number
  ) => {
    const pasted = e.clipboardData?.getData("text") || "";
    if (!pasted.includes("\t") && !pasted.includes("\n")) return;

    e.preventDefault();
    const rows = pasted.replace(/\r/g, "").split("\n").filter((r, idx, arr) => idx < arr.length - 1 || r.trim() !== "");
    setGrid((prev) => {
      const next = prev.map((r) => [...r]);
      rows.forEach((rowStr, rOffset) => {
        const dIdx = startDay + rOffset;
        if (dIdx >= 5) return;
        const cols = rowStr.split("\t");
        cols.forEach((cellVal, cOffset) => {
          const pIdx = startPeriod + cOffset;
          if (pIdx >= 7) return;
          next[dIdx][pIdx] = cellVal.replace(/[|,]/g, " ").trim();
        });
      });
      syncSummaryWithGrid(next, room);
      return next;
    });
  };

  // คำนวณชั่วโมงรวมและสรุปรายวิชาจากตาราง 5x7 อัตโนมัติในคลิกเดียว
  const handleAutoSummarizeFromGrid = () => {
    syncSummaryWithGrid(grid, room);
  };

  // ล้างเฉพาะวิชาเรียนเพื่อจัดตารางภาคเรียนใหม่ (คงโฮมรูมและกิจกรรมคาบ 7 ไว้)
  const handleClearAcademicClassesOnly = () => {
    const freshGrid = [
      ["", "", "", "", "", "", "#ชุมนุม"],
      ["", "", "", "", "", "", "#ฐาน ศก."],
      ["", "", "", "", "", "", "#กิจกรรม"],
      ["#โฮมรูม", "", "", "", "", "", "#การป้องกันทุจริต"],
      ["", "", "", "", "", "", "#แนะแนว"],
    ];
    setGrid(freshGrid);
    syncSummaryWithGrid(freshGrid, room);
  };

  const applyQuickTagToActiveCell = (tagValue: string) => {
    if (!activeCell) return;
    handleCellChange(activeCell.day, activeCell.period, tagValue);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg("");

    const numId = Number(id);
    if (!numId || numId < 1 || numId > 99999) {
      setErrorMsg("กรุณาระบุรหัสประจำตัวเป็นตัวเลข (1 - 99999)");
      return;
    }
    if (!isEditMode && existingIds.includes(numId)) {
      setErrorMsg(`รหัสประจำตัว ${numId} มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น`);
      return;
    }
    if (!name.trim()) {
      setErrorMsg("กรุณาระบุชื่อ-นามสกุลครูหรือนักศึกษาฝึกสอน");
      return;
    }

    const { grid: autoCleanedGrid } = autoFixScheduleGridFormat(grid);
    const cleanGrid = autoCleanedGrid.map((row) =>
      row.map((c) => String(c || "").replace(/[|,]/g, " ").trim())
    );
    const s = cleanGrid.map((row) => row.join(",")).join("|");

    const manualLines = coursesText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 15);

    const autoSummary = summarizeTeacherGrid(
      cleanGrid,
      room,
      otherSummary,
      isStudentTeacher,
      pdfGroup || group,
      numId,
      manualLines.length > 0 ? manualLines : initialTeacher?.coursesSummary || []
    );
    const coursesSummary =
      manualLines.length > 0 ? manualLines : autoSummary.coursesSummary;

    const record: TeacherRecord = {
      id: numId,
      n: name.trim(),
      g: group.trim() || "ภาษาไทย",
      pdfGroup: pdfGroup.trim() || group.trim() || "ภาษาไทย",
      r: room.trim() || "-",
      totalHours: Math.max(
        0,
        Math.min(60, Number(totalHours) || autoSummary.totalHours || 0)
      ),
      coursesSummary,
      otherSummary: otherSummary.trim(),
      s,
      isStudentTeacher,
      d: cleanGrid,
    };

    try {
      setSaving(true);
      await onSave(record);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "บันทึกข้อมูลไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-teacher-title"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
    >
      <div className="bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-xl overflow-hidden">
        {/* Header พร้อมปุ่มบันทึกด่วนด้านบน */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-3.5 bg-[#12307a] text-white border-b-2 border-[#f2c230] shrink-0">
          <h3 id="modal-teacher-title" className="text-sm sm:text-lg font-bold truncate">
            {isEditMode
              ? `แก้ไขข้อมูลและตารางสอน: ${initialTeacher?.id} ${initialTeacher?.n}`
              : "เพิ่มข้อมูลครู / นักศึกษาฝึกสอนใหม่ลงฐานข้อมูล"}
          </h3>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSubmit()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#f2c230] hover:bg-[#e0b01e] text-[#0f2150] text-xs sm:text-sm font-bold shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {isEditMode ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              <span>{saving ? "กำลังบันทึก..." : isEditMode ? "บันทึกการแก้ไข" : "เพิ่มลงฐานข้อมูล"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่าง"
              className="p-1.5 rounded-lg hover:bg-blue-800/60 text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-semibold">
              {errorMsg}
            </div>
          )}

          {/* ข้อมูลพื้นฐาน */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                รหัสประจำตัว (เช่น 104, 309) *
              </label>
              <input
                type="number"
                required
                disabled={isEditMode}
                value={id}
                onChange={(e) => setId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] disabled:opacity-60 text-sm font-semibold text-[#0f2150] dark:text-[#e9eefc]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                ชื่อ - นามสกุล *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น ครูสมชาย ใจดี หรือ นายธีระพงษ์ หวัน"
                className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-sm font-semibold text-[#0f2150] dark:text-[#e9eefc]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                ประเภทบุคลากร *
              </label>
              <select
                value={isStudentTeacher ? "student" : "regular"}
                onChange={(e) => {
                  const nextIsStudent = e.target.value === "student";
                  setIsStudentTeacher(nextIsStudent);
                  syncSummaryWithGrid(grid, room, otherSummary, nextIsStudent);
                }}
                className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-sm font-semibold text-[#0f2150] dark:text-[#e9eefc]"
              >
                <option value="regular">ครูประจำการ / บริหาร</option>
                <option value="student">นักศึกษาฝึกสอน</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                กลุ่มสาระหลัก (สำหรับจับคู่สอนแทน)
              </label>
              <select
                value={group}
                onChange={(e) => {
                  const nextG = e.target.value;
                  setGroup(nextG);
                  if (pdfGroup === group) {
                    setPdfGroup(nextG);
                    syncSummaryWithGrid(grid, room, otherSummary, isStudentTeacher, nextG);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-sm text-[#0f2150] dark:text-[#e9eefc]"
              >
                {DEFAULT_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                กลุ่ม/ฝ่าย/งาน (บนหัวใบสอนแทน)
              </label>
              <input
                type="text"
                value={pdfGroup}
                onChange={(e) => setPdfGroup(e.target.value)}
                placeholder="เช่น ภาษาไทย, ฟิสิกส์, คอมพิวเตอร์"
                className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-sm text-[#0f2150] dark:text-[#e9eefc]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                ห้องเรียนประจำ
              </label>
              <input
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="เช่น 138, 121, ห้องดนตรี"
                className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-sm text-[#0f2150] dark:text-[#e9eefc]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                จำนวนชั่วโมงรวม/สัปดาห์
              </label>
              <input
                type="number"
                min={0}
                max={60}
                value={totalHours}
                onChange={(e) => setTotalHours(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-sm text-[#0f2150] dark:text-[#e9eefc]"
              />
            </div>
          </div>

          {/* ตารางสอน 5 วัน x 7 คาบ แบบแก้ไขรายช่อง + รองรับวางจาก Excel */}
          <div className="border border-[#c9d4ec] dark:border-[#2a3a6e] rounded-xl p-3 sm:p-4 bg-[#f8faff] dark:bg-[#0b1330]/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
              <div>
                <h4 className="text-sm font-bold text-[#0f2150] dark:text-[#e9eefc]">
                  ตารางสอน 5 วัน × 7 คาบ (เว้นว่าง = ว่างพร้อมสอนแทน · รองรับก๊อปปี้จาก Excel มาวางได้)
                </h4>
                <p className="text-xs text-[#51608a] dark:text-[#9fb0dc]">
                  รูปแบบวิชา: <b>รหัสวิชา ชั้น</b> (เช่น <code>ท33102 6/1</code> หรือระบุห้อง{" "}
                  <code>ว22104 2/1@201</code>) · เมื่อแก้ไขคาบ ระบบจะคำนวณชั่วโมงรวมและซิงก์กับตารางจัดสอนแทนอัตโนมัติ
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleAutoSummarizeFromGrid}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0b7a4b] hover:bg-[#085c38] text-white text-xs font-bold cursor-pointer"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>คำนวณชั่วโมง & สรุปวิชาอัตโนมัติ</span>
                </button>
                <button
                  type="button"
                  onClick={handleClearAcademicClassesOnly}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#14204a] text-[#51608a] dark:text-[#9fb0dc] hover:text-red-600 text-xs font-semibold cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>ล้างวิชาเพื่อจัดเทอมใหม่</span>
                </button>
              </div>
            </div>

            {/* ปุ่มลัดใส่ค่าในช่องที่กำลังเลือก */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className="text-xs font-semibold text-[#51608a] dark:text-[#9fb0dc]">
                {activeCell
                  ? `ปุ่มลัดสำหรับ วัน${DAYS[activeCell.day]} คาบ ${activeCell.period + 1}:`
                  : "คลิกเลือกช่องคาบเรียนแล้วกดปุ่มลัด:"}
              </span>
              {QUICK_CELL_TAGS.map((tag) => (
                <button
                  key={tag.label}
                  type="button"
                  disabled={!activeCell}
                  onClick={() => applyQuickTagToActiveCell(tag.value)}
                  className="px-2 py-1 rounded text-xs font-semibold bg-white dark:bg-[#14204a] border border-[#c9d4ec] dark:border-[#2a3a6e] text-[#0f2150] dark:text-[#e9eefc] hover:bg-[#1b4fb8] hover:text-white disabled:opacity-40 cursor-pointer transition-colors"
                >
                  {tag.label}
                </button>
              ))}
            </div>

            {/* แจ้งเตือนตรวจสอบรูปแบบข้อความในช่องตารางสอน 5x7 แบบเรียลไทม์ */}
            {scheduleIssues.length > 0 && (
              <div className="mb-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>
                      พบช่องตารางสอนที่อาจพิมพ์ผิดรูปแบบ ({scheduleIssues.length} ช่อง):
                    </span>
                  </div>
                  {hasAutoFixableIssues && (
                    <button
                      type="button"
                      onClick={handleAutoFixGridFormat}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs cursor-pointer shadow-2xs"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>จัดรูปแบบให้ถูกต้องอัตโนมัติ</span>
                    </button>
                  )}
                </div>
                <div className="space-y-1 pl-5 text-amber-800 dark:text-amber-300">
                  {scheduleIssues.map((iss) => (
                    <div
                      key={`${iss.dayIndex}_${iss.periodIndex}`}
                      className="flex items-center justify-between gap-2 flex-wrap"
                    >
                      <span>
                        • <b>วัน{iss.dayName} คาบ {iss.periodNumber}</b> (<code>{iss.rawValue}</code>):{" "}
                        {iss.message}
                      </span>
                      {iss.suggestedValue && (
                        <button
                          type="button"
                          onClick={() =>
                            handleCellChange(
                              iss.dayIndex,
                              iss.periodIndex,
                              iss.suggestedValue || iss.rawValue
                            )
                          }
                          className="px-2 py-0.5 rounded bg-white dark:bg-[#14204a] border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-semibold hover:bg-amber-100 cursor-pointer"
                        >
                          แก้เป็น &ldquo;{iss.suggestedValue}&rdquo;
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-xs">
                <thead>
                  <tr className="bg-[#eaf0fa] dark:bg-[#14204a] text-[#0f2150] dark:text-[#e9eefc]">
                    <th className="border border-[#c9d4ec] dark:border-[#2a3a6e] p-1.5 w-20">
                      วัน / คาบ
                    </th>
                    {PERIOD_TIMES.map((tm, idx) => (
                      <th
                        key={tm}
                        className="border border-[#c9d4ec] dark:border-[#2a3a6e] p-1.5 text-center"
                      >
                        <div>คาบ {idx + 1}</div>
                        <div className="text-[10px] font-normal opacity-80">{tm}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.map((dayName, dIdx) => (
                    <tr key={dayName}>
                      <td className="border border-[#c9d4ec] dark:border-[#2a3a6e] p-1.5 font-bold text-center bg-[#eaf0fa]/50 dark:bg-[#14204a]/50">
                        {dayName}
                      </td>
                      {PERIOD_TIMES.map((_, pIdx) => {
                        const isFocused =
                          activeCell?.day === dIdx && activeCell?.period === pIdx;
                        const isInitialTarget =
                          initialActiveCell?.day === dIdx &&
                          initialActiveCell?.period === pIdx;
                        const cellIssue = issueByCellKey.get(`${dIdx}_${pIdx}`);
                        return (
                          <td
                            key={pIdx}
                            className={`border border-[#c9d4ec] dark:border-[#2a3a6e] p-1 ${
                              isFocused
                                ? "ring-2 ring-[#f2c230] bg-amber-50/30"
                                : cellIssue
                                ? "bg-amber-100/70 dark:bg-amber-950/50"
                                : ""
                            }`}
                          >
                            <input
                              type="text"
                              autoFocus={isInitialTarget}
                              value={grid[dIdx]?.[pIdx] || ""}
                              onFocus={() => setActiveCell({ day: dIdx, period: pIdx })}
                              onChange={(e) => handleCellChange(dIdx, pIdx, e.target.value)}
                              onPaste={(e) => handleCellPaste(e, dIdx, pIdx)}
                              placeholder="ว่าง"
                              title={cellIssue ? cellIssue.message : undefined}
                              aria-label={`วัน${dayName} คาบที่ ${pIdx + 1}`}
                              className={`w-full px-1.5 py-1 rounded bg-white dark:bg-[#0b1330] text-[#0f2150] dark:text-[#e9eefc] text-xs border focus:outline-none ${
                                cellIssue
                                  ? "border-amber-500 dark:border-amber-500 text-amber-900 dark:text-amber-200 font-semibold"
                                  : "border-transparent focus:border-[#1b4fb8]"
                              }`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* รายวิชาที่สอน & กิจกรรมอื่นๆ */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                สรุปรายวิชาที่สอน (ซิงก์อัตโนมัติกับตาราง 5×7 และฐานข้อมูลรหัสวิชา)
              </label>
              <textarea
                rows={3}
                value={coursesText}
                onChange={(e) => setCoursesText(e.target.value)}
                placeholder={"เช่น 1) ท22102 (ภาษาไทย) 2/1 [3], 2/2 [3]\n2) ท32102 (ภาษาไทย) 5/1 [2]"}
                className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-xs text-[#0f2150] dark:text-[#e9eefc]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#0f2150] dark:text-[#e9eefc] mb-1">
                กิจกรรมอื่นๆ ท้ายตาราง
              </label>
              <textarea
                rows={3}
                value={otherSummary}
                onChange={(e) => {
                  const nextOther = e.target.value;
                  setOtherSummary(nextOther);
                  syncSummaryWithGrid(grid, room, nextOther, isStudentTeacher);
                }}
                className="w-full px-3 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] bg-white dark:bg-[#0b1330] text-xs text-[#0f2150] dark:text-[#e9eefc]"
              />
            </div>
          </div>
        </form>

        {/* Sticky Footer Buttons ด้านล่างที่มองเห็นตลอดเวลาโดยไม่ต้องเลื่อนจอ */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6 bg-[#f8faff] dark:bg-[#0b1330] border-t border-[#c9d4ec] dark:border-[#2a3a6e] shrink-0">
          <span className="text-xs text-[#51608a] dark:text-[#9fb0dc] hidden sm:inline">
            ข้อมูลที่บันทึกจะซิงก์ไปยังหน้าจัดสอนแทน ตารางสอน เช็คครูว่าง และฐานข้อมูลทันที
          </span>
          <div className="flex items-center justify-end gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[#c9d4ec] dark:border-[#2a3a6e] text-sm font-semibold text-[#0f2150] dark:text-[#e9eefc] hover:bg-slate-100 dark:hover:bg-blue-950 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSubmit()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#1b4fb8] hover:bg-[#153e91] text-white text-sm font-bold shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {isEditMode ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              <span>{saving ? "กำลังบันทึก..." : isEditMode ? "บันทึกการแก้ไข" : "เพิ่มลงฐานข้อมูล"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
