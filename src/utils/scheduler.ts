import { DAYS, PERIOD_TIMES, TEACHERS, TeacherRecord } from "../data/teachers";

export interface ParsedCell {
  raw: string;
  isEmpty: boolean;
  isMeeting: boolean;      // * ประชุมหัวหน้าฝ่าย / บริหาร
  isSupervision: boolean;  // #นิเทศสอน
  isActivity: boolean;     // #โฮมรูม, #ชุมนุม, #ฐาน ศก., #กิจกรรม, #การป้องกันทุจริต, #แนะแนว
  isTeachable: boolean;    // วิชาเรียนปกติ หรือ เลือกเสรี ที่จัดสอนแทนได้
  code: string;
  cls: string;
  room: string;
  displayLabel: string;
}

export interface ClassSlot {
  p: number; // 0-based period index (0..6)
  tm: string;
  raw: string;
  code: string;
  cls: string;
  room: string;
  isSupervision?: boolean;
}

export interface CombinedClassSlot extends ClassSlot {
  slotKey: string; // `${absentTeacherId}_${p}`
  absentTeacherId: number;
  absentTeacherName: string;
  absentTeacherGroup: string;
  absentTeacherPdfGroup: string;
}

export interface SubstituteRow {
  p: number; // 1-based period number (1..7)
  tm: string;
  code: string;
  cls: string;
  room: string;
  n: string;
  g: string;
  slotKey?: string;
  absentTeacherId?: number;
  absentTeacherName?: string;
  subName?: string;         // ชื่อ-สกุล ผู้สอนแทน (ไม่มีวงเล็บต่อท้าย สำหรับใบแบบบันทึกการจัดสอนแทน)
  classRoomLabel?: string;  // ห้อง เช่น ม.1/2, ม.3/1
  subjectName?: string;     // วิชา เช่น ภาษาไทย, คณิตศาสตร์
  shortDate?: string;       // วันที่รูปแบบย่อ พ.ศ. เช่น 18/05/69
}

export function getTeacherById(id: string | number): TeacherRecord | undefined {
  const numId = Number(id);
  if (!numId) return undefined;
  return TEACHERS.find((t) => t.id === numId);
}

/**
 * แปลงวันที่ YYYY-MM-DD เป็นดัชนีวันจันทร์-ศุกร์ (0..4) หรือ -1 ถ้าเป็นวันเสาร์-อาทิตย์
 */
export function getDayIndex(dateStr: string): number {
  if (!dateStr) return -1;
  const dt = new Date(dateStr + "T00:00:00");
  if (isNaN(dt.getTime())) return -1;
  const w = dt.getDay();
  return w >= 1 && w <= 5 ? w - 1 : -1;
}

/**
 * แปลงข้อมูลช่องตารางสอน 1 คาบ
 */
export function parseScheduleCell(rawCell: string | undefined, defaultRoom: string): ParsedCell {
  const raw = (rawCell || "").trim();
  if (!raw) {
    return {
      raw: "",
      isEmpty: true,
      isMeeting: false,
      isSupervision: false,
      isActivity: false,
      isTeachable: false,
      code: "",
      cls: "",
      room: defaultRoom,
      displayLabel: "ว่าง",
    };
  }

  if (raw === "*") {
    return {
      raw,
      isEmpty: false,
      isMeeting: true,
      isSupervision: false,
      isActivity: false,
      isTeachable: false,
      code: "ประชุมหัวหน้าฝ่าย",
      cls: "-",
      room: "ปาริชาติ",
      displayLabel: "ประชุมหัวหน้าฝ่าย (ปาริชาติ)",
    };
  }

  if (raw.startsWith("#นิเทศสอน")) {
    const label = raw.replace("#", "").trim();
    const parts = label.split(" ");
    return {
      raw,
      isEmpty: false,
      isMeeting: false,
      isSupervision: true,
      isActivity: false,
      isTeachable: false,
      code: "นิเทศสอน",
      cls: parts[1] || "ทุกชั้น",
      room: defaultRoom,
      displayLabel: label,
    };
  }

  if (raw.startsWith("#")) {
    const label = raw.replace("#", "").trim();
    return {
      raw,
      isEmpty: false,
      isMeeting: false,
      isSupervision: false,
      isActivity: true,
      isTeachable: false,
      code: label,
      cls: "-",
      room: label.includes("โฮมรูม") ? "หอประชุม" : "-",
      displayLabel: label,
    };
  }

  // รูปแบบ "รหัสวิชา ชั้น@ห้อง" หรือ "รหัสวิชา ชั้น"
  const [coursePart, customRoom] = raw.split("@");
  const room = customRoom ? customRoom.trim() : defaultRoom;
  const tokens = coursePart.trim().split(/\s+/);
  const code = tokens[0] || coursePart;
  const cls = tokens.slice(1).join(" ") || "-";

  return {
    raw,
    isEmpty: false,
    isMeeting: false,
    isSupervision: false,
    isActivity: false,
    isTeachable: true,
    code,
    cls,
    room,
    displayLabel: `${code} (${cls})`,
  };
}

/**
 * ดึงรายการคาบสอนของครูในวันที่เลือก
 */
export function getTeacherClasses(
  teacherId: string | number,
  dateStr: string,
  includeSupervision = false
): ClassSlot[] {
  // ครู 302 ครูรณสิทธิ์ ประดับศรี ไม่ต้องจัดสอนแทนให้ครูท่านนี้ตามนโยบายโรงเรียน
  if (isTeacherExemptFromNeedingSubstitute(teacherId)) return [];

  const teacher = getTeacherById(teacherId);
  const dayIdx = getDayIndex(dateStr);
  if (!teacher || dayIdx < 0 || !teacher.d) return [];

  const daySchedule = teacher.d[dayIdx] || [];
  const results: ClassSlot[] = [];

  PERIOD_TIMES.forEach((tm, p) => {
    // คาบ 1 วันพฤหัสบดี เป็นคาบโฮมรูมรวมของโรงเรียน
    if (dayIdx === 3 && p === 0) return;

    const parsed = parseScheduleCell(daySchedule[p], teacher.r);
    if (parsed.isTeachable || (includeSupervision && parsed.isSupervision)) {
      results.push({
        p,
        tm,
        raw: `${parsed.code} ${parsed.cls}`,
        code: parsed.code,
        cls: parsed.cls,
        room: parsed.room,
        isSupervision: parsed.isSupervision,
      });
    }
  });

  return results;
}

/**
 * ดึงรายการคาบสอนรวมของครูที่ลาทุกคนในวันเดียวกัน เพื่อนำมาเรียงรวมในตารางเดียวกัน
 * เรียงตามลำดับคาบที่ 1..7 แล้วตามลำดับครูที่เลือก
 * โดยยกเว้นครู 302 (ครูรณสิทธิ์ ประดับศรี) ที่ไม่ต้องจัดสอนแทนให้
 */
export function getCombinedTeacherClasses(
  teacherIds: (string | number)[],
  dateStr: string,
  includeSupervision = false
): CombinedClassSlot[] {
  const seenTeachers = new Set<number>();
  const validTeachers: TeacherRecord[] = [];

  for (const rawId of teacherIds) {
    if (isTeacherExemptFromNeedingSubstitute(rawId)) continue;
    const t = getTeacherById(rawId);
    if (t && !seenTeachers.has(t.id)) {
      seenTeachers.add(t.id);
      validTeachers.push(t);
    }
  }

  const combined: { orderIdx: number; slot: CombinedClassSlot }[] = [];

  validTeachers.forEach((teacher, orderIdx) => {
    const classes = getTeacherClasses(teacher.id, dateStr, includeSupervision);
    classes.forEach((c) => {
      combined.push({
        orderIdx,
        slot: {
          ...c,
          slotKey: `${teacher.id}_${c.p}`,
          absentTeacherId: teacher.id,
          absentTeacherName: teacher.n,
          absentTeacherGroup: teacher.g,
          absentTeacherPdfGroup: teacher.pdfGroup,
        },
      });
    });
  });

  combined.sort((a, b) => {
    if (a.slot.p !== b.slot.p) return a.slot.p - b.slot.p;
    return a.orderIdx - b.orderIdx;
  });

  return combined.map((item) => item.slot);
}

export interface AbsentTeacherEntry {
  teacherId: string;
  reason: string;
  studentTeacherName: string;
  includeSupervision: boolean;
  assignments: Record<number, string>;
}

/**
 * ตรวจสอบว่าเป็นครูที่ได้รับการยกเว้นไม่ต้องจัดสอนแทนให้หรือไม่
 * ตามความต้องการของโรงเรียน: 302 ครูรณสิทธิ์ ประดับศรี (ชีววิทยา · ห้องชีวะ) ไม่ต้องจัดสอนแทนให้ครูท่านนี้
 */
export function isTeacherExemptFromNeedingSubstitute(
  teacherOrId: TeacherRecord | number | string | undefined
): boolean {
  if (!teacherOrId) return false;
  if (typeof teacherOrId === "object") {
    if (teacherOrId.id === 302) return true;
    if (teacherOrId.n && teacherOrId.n.includes("รณสิทธิ์ ประดับศรี")) return true;
    return false;
  }
  const num = Number(teacherOrId);
  return num === 302;
}

/**
 * ตรวจสอบว่าเป็นครูที่ยกเว้นไม่ให้ไปสอนแทนผู้อื่นเด็ดขาดหรือไม่
 * 1) ผู้บริหารสถานศึกษา (100 ผอ., 101 รอง ผอ., 202 ผู้ช่วย ผอ., ฝ่ายบริหาร) ไม่จัดสอนแทนเด็ดขาด
 * 2) 302 ครูรณสิทธิ์ ประดับศรี (ชีววิทยา · ห้องชีวะ) ไม่ต้องให้ไปสอนแทนเด็ดขาด
 */
export function isExcludedFromSubstituting(teacher: TeacherRecord | undefined): boolean {
  if (!teacher) return false;
  if (isSchoolAdministrator(teacher)) return true;
  if (teacher.id === 302 || teacher.n?.includes("รณสิทธิ์ ประดับศรี")) return true;
  return false;
}

/**
 * ตรวจสอบว่าเป็นผู้บริหารสถานศึกษาหรือไม่ (ผู้อำนวยการ, รองผู้อำนวยการ, ผู้ช่วยผู้อำนวยการ, ฝ่ายบริหาร)
 * เพื่อป้องกันไม่ให้ระบบนำผู้บริหารมาจัดสอนแทนเด็ดขาดตามนโยบายโรงเรียน
 */
export function isSchoolAdministrator(teacher: TeacherRecord | undefined): boolean {
  if (!teacher) return false;
  if (teacher.g === "บริหาร" || teacher.pdfGroup === "บริหาร") return true;
  if (teacher.id === 100 || teacher.id === 101 || teacher.id === 202) return true;
  const name = teacher.n || "";
  if (
    name.includes("ผู้อำนวยการ") ||
    name.includes("ผอ.") ||
    name.includes("รองผู้อำนวยการ") ||
    name.includes("ผู้ช่วยผู้อำนวยการ")
  ) {
    return true;
  }
  return false;
}

/**
 * ดึงระดับชั้น (1..6) จากข้อความชั้นเรียน เช่น "2/1" -> "2", "ม.4/2" -> "4", "ม.1" -> "1"
 */
export function extractGradeLevel(cls: string | undefined): string | null {
  const trimmed = String(cls || "").trim();
  if (!trimmed || trimmed === "-") return null;
  const match = trimmed.match(/(?:^|ม\.)([1-6])(?:\/\d+|$|\s)/);
  if (match) return match[1];
  const fallback = trimmed.match(/([1-6])\/\d+/);
  if (fallback) return fallback[1];
  return null;
}

/**
 * แปลงข้อความห้องเรียนให้เป็นรูปแบบมาตรฐาน เช่น "ม.2/1" -> "2/1", "4/2" -> "4/2"
 */
export function normalizeClassRoom(cls: string | undefined): string | null {
  const trimmed = String(cls || "").trim();
  if (!trimmed || trimmed === "-") return null;
  const match = trimmed.match(/(?:ม\.)?([1-6]\/\d+)/);
  return match ? match[1] : null;
}

interface TeacherGradeCacheEntry {
  signature: string;
  rooms: Set<string>;
  grades: Set<string>;
  summary: string;
}

const teacherGradeCache = new Map<number, TeacherGradeCacheEntry>();

function getTeacherGradeCacheEntry(teacher: TeacherRecord | undefined): TeacherGradeCacheEntry | null {
  if (!teacher || isTeacherExemptFromNeedingSubstitute(teacher)) return null;
  const sig = `${teacher.s || ""}::${(teacher.coursesSummary || []).join("|")}::${teacher.r || ""}`;
  const cached = teacherGradeCache.get(teacher.id);
  if (cached && cached.signature === sig) {
    return cached;
  }

  const rooms = new Set<string>();
  const grades = new Set<string>();

  if (teacher.d) {
    for (const dayRow of teacher.d) {
      for (const cell of dayRow) {
        const parsed = parseScheduleCell(cell, teacher.r);
        if (parsed.isTeachable && parsed.code !== "เลือกเสรี") {
          const clsRoom = normalizeClassRoom(parsed.cls);
          if (clsRoom) rooms.add(clsRoom);
          const g = extractGradeLevel(parsed.cls);
          if (g) grades.add(g);
        }
      }
    }
  }

  if (Array.isArray(teacher.coursesSummary)) {
    for (const line of teacher.coursesSummary) {
      if (line.includes("->") || line.includes("ย้ายไป")) continue;
      const matches = line.matchAll(/(?:ม\.)?([1-6]\/\d+)/g);
      for (const m of matches) {
        if (m[1]) {
          rooms.add(m[1]);
          const g = extractGradeLevel(m[1]);
          if (g) grades.add(g);
        }
      }
    }
  }

  const sortedGrades = Array.from(grades).sort();
  const summary = sortedGrades.length === 0 ? "-" : sortedGrades.map((g) => `ม.${g}`).join(", ");

  const entry: TeacherGradeCacheEntry = {
    signature: sig,
    rooms,
    grades,
    summary,
  };
  teacherGradeCache.set(teacher.id, entry);
  return entry;
}

/**
 * ดึงรายการห้องเรียนทั้งหมดที่ครูสอน เช่น Set(["2/1", "2/2", "5/1"])
 */
export function getTeacherTaughtClassRooms(teacher: TeacherRecord | undefined): Set<string> {
  const entry = getTeacherGradeCacheEntry(teacher);
  return entry ? entry.rooms : new Set<string>();
}

/**
 * ดึงรายการระดับชั้นทั้งหมดที่ครูสอน เช่น Set(["2", "5", "6"])
 */
export function getTeacherTaughtGrades(teacher: TeacherRecord | undefined): Set<string> {
  const entry = getTeacherGradeCacheEntry(teacher);
  return entry ? entry.grades : new Set<string>();
}

/**
 * แปลงระดับชั้นที่ครูสอนเป็นข้อความสั้น เช่น "ม.1, ม.4, ม.5"
 */
export function formatTeacherGradesSummary(teacher: TeacherRecord | undefined): string {
  const entry = getTeacherGradeCacheEntry(teacher);
  return entry ? entry.summary : "-";
}

/**
 * ตรวจสอบว่าครูท่านนี้สอนในระดับชั้นเดียวกับคาบที่ต้องการจัดสอนแทนหรือไม่
 */
export function doesTeacherTeachGrade(
  teacher: TeacherRecord | undefined,
  targetClassOrGrade: string | undefined
): boolean {
  if (!teacher || !targetClassOrGrade) return false;
  const taughtGrades = getTeacherTaughtGrades(teacher);
  const g = extractGradeLevel(targetClassOrGrade);
  if (g) return taughtGrades.has(g);
  if (targetClassOrGrade.includes("ม.ต้น")) {
    return taughtGrades.has("1") || taughtGrades.has("2") || taughtGrades.has("3");
  }
  if (targetClassOrGrade.includes("ม.ปลาย")) {
    return taughtGrades.has("4") || taughtGrades.has("5") || taughtGrades.has("6");
  }
  return false;
}

/**
 * ตรวจสอบว่าครูท่านนี้สอนห้องเรียนเดียวกันโดยตรงหรือไม่ (เช่น "2/1")
 */
export function doesTeacherTeachExactClass(
  teacher: TeacherRecord | undefined,
  targetClass: string | undefined
): boolean {
  if (!teacher || !targetClass) return false;
  const targetRoom = normalizeClassRoom(targetClass);
  if (!targetRoom) return false;
  return getTeacherTaughtClassRooms(teacher).has(targetRoom);
}

export interface ContinuousPeriodInfo {
  isPrevContinuous: boolean;       // เพิ่งสอนห้องเดียวกันนี้ในคาบก่อนหน้า (p - 1)
  prevPeriodNumber: number | null; // หมายเลขคาบก่อนหน้า (1..6)
  prevCourseCode: string;          // รหัสวิชาที่สอนในคาบก่อนหน้า
  prevSubjectName: string;         // ชื่อวิชาที่สอนในคาบก่อนหน้า
  isNextContinuous: boolean;       // มีสอนห้องเดียวกันนี้ต่อในคาบถัดไป (p + 1)
  nextPeriodNumber: number | null; // หมายเลขคาบถัดไป (2..7)
  nextCourseCode: string;          // รหัสวิชาที่สอนในคาบถัดไป
  nextSubjectName: string;         // ชื่อวิชาที่สอนในคาบถัดไป
}

/**
 * ตรวจสอบข้อมูลคาบสอนต่อเนื่องในห้องเรียนเดียวกัน (targetClass) ของครูในวันที่เลือก
 * เช่น คาบที่ 3 ครูสอนคณิตศาสตร์ ม.5/1 อยู่ แล้วคาบที่ 4 ครูวิทย์ ม.5/1 ไม่อยู่ และครูคณิตว่างในคาบที่ 4
 */
export function getContinuousPeriodInfo(
  teacher: TeacherRecord | undefined,
  dateStr: string,
  periodIndex: number,
  targetClass: string | undefined
): ContinuousPeriodInfo {
  const empty: ContinuousPeriodInfo = {
    isPrevContinuous: false,
    prevPeriodNumber: null,
    prevCourseCode: "",
    prevSubjectName: "",
    isNextContinuous: false,
    nextPeriodNumber: null,
    nextCourseCode: "",
    nextSubjectName: "",
  };

  if (!teacher || !dateStr || !targetClass) return empty;
  const dayIdx = getDayIndex(dateStr);
  const targetRoom = normalizeClassRoom(targetClass);
  if (dayIdx < 0 || !targetRoom) return empty;

  let isPrevContinuous = false;
  let prevPeriodNumber: number | null = null;
  let prevCourseCode = "";
  let prevSubjectName = "";

  if (periodIndex > 0) {
    const prevRaw = teacher.d?.[dayIdx]?.[periodIndex - 1] || "";
    const parsedPrev = parseScheduleCell(prevRaw, teacher.r);
    if (
      parsedPrev.isTeachable &&
      parsedPrev.code !== "เลือกเสรี" &&
      normalizeClassRoom(parsedPrev.cls) === targetRoom
    ) {
      isPrevContinuous = true;
      prevPeriodNumber = periodIndex; // periodIndex - 1 in 0-based is periodIndex in 1-based
      prevCourseCode = parsedPrev.code;
      prevSubjectName = getSubjectNameFromCourse(parsedPrev.code, teacher.pdfGroup, teacher.id);
    }
  }

  let isNextContinuous = false;
  let nextPeriodNumber: number | null = null;
  let nextCourseCode = "";
  let nextSubjectName = "";

  if (periodIndex >= 0 && periodIndex < 6) {
    const nextRaw = teacher.d?.[dayIdx]?.[periodIndex + 1] || "";
    const parsedNext = parseScheduleCell(nextRaw, teacher.r);
    if (
      parsedNext.isTeachable &&
      parsedNext.code !== "เลือกเสรี" &&
      normalizeClassRoom(parsedNext.cls) === targetRoom
    ) {
      isNextContinuous = true;
      nextPeriodNumber = periodIndex + 2; // periodIndex + 1 in 0-based is periodIndex + 2 in 1-based
      nextCourseCode = parsedNext.code;
      nextSubjectName = getSubjectNameFromCourse(parsedNext.code, teacher.pdfGroup, teacher.id);
    }
  }

  return {
    isPrevContinuous,
    prevPeriodNumber,
    prevCourseCode,
    prevSubjectName,
    isNextContinuous,
    nextPeriodNumber,
    nextCourseCode,
    nextSubjectName,
  };
}

/**
 * ตรวจสอบว่าครูท่านนี้เพิ่งสอนห้องเรียนเดียวกัน (targetClass) ในคาบก่อนหน้า (periodIndex - 1) หรือไม่
 */
export function doesTeacherTeachPrevPeriodExactClass(
  teacher: TeacherRecord | undefined,
  dateStr: string,
  periodIndex: number,
  targetClass: string | undefined
): boolean {
  return getContinuousPeriodInfo(teacher, dateStr, periodIndex, targetClass).isPrevContinuous;
}

/**
 * ค้นหาครูและนักศึกษาฝึกสอนที่ว่างในวันและคาบที่กำหนด
 * เรียงลำดับความสำคัญ:
 * 0) ครูประจำการที่เพิ่งสอนห้องเรียนนี้ในคาบก่อนหน้า (p - 1) และว่างในคาบนี้ (ให้คาบต่อเนื่องได้เลย)
 * 1) ครูประจำการที่สอนระดับชั้นเดียวกัน และอยู่กลุ่มสาระเดียวกัน (!isStudentTeacher && sameGrade && sameGroup)
 * 2) ครูประจำการที่สอนระดับชั้นเดียวกัน (ต่างกลุ่มสาระ) (!isStudentTeacher && sameGrade && !sameGroup)
 * 3) ครูประจำการในกลุ่มสาระเดียวกัน (ที่สอนระดับชั้นอื่น) (!isStudentTeacher && !sameGrade && sameGroup)
 * 4) นักศึกษาฝึกสอนที่ว่างในคาบนั้น (isStudentTeacher) โดยเรียงตามคาบต่อเนื่องห้องเดิม -> ระดับชั้นเดียวกัน -> กลุ่มสาระเดียวกัน
 * 5) ครูประจำการท่านอื่นที่ว่าง (ต่างระดับชั้น และต่างกลุ่มสาระ)
 *
 * โดยตัดรายชื่อครูที่ลาในวันเดียวกัน (excludedTeacherIds), ผู้บริหารสถานศึกษา
 * และครู 302 (ครูรณสิทธิ์ ประดับศรี) ออกเด็ดขาด
 */
export function getCandidateTeachers(
  absentTeacherId: string | number,
  dateStr: string,
  periodIndex: number,
  excludedTeacherIds: number[] = [],
  targetClass?: string
): TeacherRecord[] {
  const absentTeacher = getTeacherById(absentTeacherId);
  const dayIdx = getDayIndex(dateStr);
  if (!absentTeacher || dayIdx < 0) return [];
  if (dayIdx === 3 && periodIndex === 0) return [];

  const rawAbsentCell = absentTeacher.d?.[dayIdx]?.[periodIndex] || "";
  const parsedAbsentCell = parseScheduleCell(rawAbsentCell, absentTeacher.r);
  const effectiveTargetClass =
    targetClass !== undefined ? targetClass : parsedAbsentCell.cls;

  const excludedSet = new Set<number>([
    absentTeacher.id,
    ...excludedTeacherIds.map(Number).filter(Boolean),
  ]);

  const filtered = TEACHERS.filter((t) => {
    if (excludedSet.has(t.id)) return false;
    // ผู้บริหารโรงเรียน และ ครู 302 (ครูรณสิทธิ์ ประดับศรี) ไม่ให้ไปสอนแทนเด็ดขาด
    if (isExcludedFromSubstituting(t)) return false;
    const cell = t.d?.[dayIdx]?.[periodIndex] || "";
    // ต้องไม่มีคาบสอน ไม่ติดประชุม (*) ไม่ติดนิเทศสอน หรือกิจกรรมในคาบนั้น
    return cell.trim() === "";
  });

  // คำนวณลำดับขั้นความสำคัญล่วงหน้าครั้งเดียวต่อคน เพื่อป้องกันการประมวลผลซ้ำในลูป sort
  const decorated = filtered.map((u) => {
    const prevContinuous = doesTeacherTeachPrevPeriodExactClass(
      u,
      dateStr,
      periodIndex,
      effectiveTargetClass
    );
    const sameGrade = doesTeacherTeachGrade(u, effectiveTargetClass);
    const sameGroup = u.g === absentTeacher.g;
    let tier = 9;
    if (!u.isStudentTeacher && prevContinuous) tier = 0;          // ครูประจำการที่เพิ่งสอนห้องนี้ในคาบก่อนหน้า (คาบต่อเนื่อง)
    else if (!u.isStudentTeacher && sameGrade && sameGroup) tier = 1;  // ครูระดับชั้นเดียวกัน + กลุ่มสาระเดียวกัน
    else if (!u.isStudentTeacher && sameGrade && !sameGroup) tier = 2; // ครูระดับชั้นเดียวกัน + ต่างกลุ่มสาระ
    else if (!u.isStudentTeacher && !sameGrade && sameGroup) tier = 3; // ครูกลุ่มสาระเดียวกัน (ระดับชั้นอื่น)
    else if (u.isStudentTeacher && prevContinuous) tier = 4;           // นศ.ฝึกสอนที่เพิ่งสอนห้องนี้ในคาบก่อนหน้า (คาบต่อเนื่อง)
    else if (u.isStudentTeacher && sameGrade && sameGroup) tier = 5;   // นศ.ฝึกสอนระดับชั้นเดียวกัน + กลุ่มสาระเดียวกัน
    else if (u.isStudentTeacher && sameGrade && !sameGroup) tier = 6;  // นศ.ฝึกสอนระดับชั้นเดียวกัน + ต่างกลุ่มสาระ
    else if (u.isStudentTeacher && !sameGrade && sameGroup) tier = 7;  // นศ.ฝึกสอนกลุ่มสาระเดียวกัน
    else if (u.isStudentTeacher) tier = 8;                             // นศ.ฝึกสอนกลุ่มสาระอื่น

    const exactClass = doesTeacherTeachExactClass(u, effectiveTargetClass) ? 1 : 0;
    const sameGroupNum = sameGroup ? 1 : 0;
    const sameSubNum = u.pdfGroup === absentTeacher.pdfGroup ? 1 : 0;
    return { u, tier, exactClass, sameGroupNum, sameSubNum };
  });

  decorated.sort((m, n) => {
    if (m.tier !== n.tier) return m.tier - n.tier;
    if (n.exactClass !== m.exactClass) return n.exactClass - m.exactClass;
    if (n.sameGroupNum !== m.sameGroupNum) return n.sameGroupNum - m.sameGroupNum;
    if (n.sameSubNum !== m.sameSubNum) return n.sameSubNum - m.sameSubNum;
    return m.u.id - n.u.id;
  });

  return decorated.map((item) => item.u);
}

/**
 * เลือกผู้สอนแทนที่เหมาะสมที่สุดในคาบเรียนตามลำดับความสำคัญ:
 * 0) ครูประจำการที่เพิ่งสอนห้องเรียนนี้ (targetClass) ในคาบก่อนหน้า (p - 1) และว่างในคาบนี้ (ให้คาบต่อเนื่องได้เลย)
 * 1) ครูประจำการที่สอนระดับชั้นเดียวกัน + กลุ่มสาระเดียวกัน
 * 2) ครูประจำการที่สอนระดับชั้นเดียวกัน (ต่างกลุ่มสาระ)
 * 3) ครูประจำการในกลุ่มสาระเดียวกัน (ระดับชั้นอื่น)
 * 4) นักศึกษาฝึกสอนที่ว่าง (เรียงตามคาบต่อเนื่องห้องเดิม -> ระดับชั้นเดียวกัน -> กลุ่มสาระเดียวกัน)
 * 5) ครูประจำการท่านอื่นที่ว่าง (ต่างระดับชั้น + ต่างกลุ่มสาระ)
 */
function pickBestSubstituteForSlot(
  allFree: TeacherRecord[],
  targetClass: string,
  absentGroup: string,
  absentPdfGroup: string,
  assignedCount: Record<number, number>,
  dateStr?: string,
  periodIndex?: number
): TeacherRecord | undefined {
  const compareCandidates = (m: TeacherRecord, n: TeacherRecord) => {
    const countDiff = (assignedCount[m.id] || 0) - (assignedCount[n.id] || 0);
    if (countDiff !== 0) return countDiff;

    const mExact = doesTeacherTeachExactClass(m, targetClass) ? 1 : 0;
    const nExact = doesTeacherTeachExactClass(n, targetClass) ? 1 : 0;
    if (nExact !== mExact) return nExact - mExact;

    const mSub = m.pdfGroup === absentPdfGroup ? 1 : 0;
    const nSub = n.pdfGroup === absentPdfGroup ? 1 : 0;
    if (nSub !== mSub) return nSub - mSub;

    return m.id - n.id;
  };

  // 0. ครูประจำการที่เพิ่งสอนห้องเรียนนี้ในคาบก่อนหน้า (p - 1) และว่างในคาบนี้ (ให้คาบต่อเนื่องได้เลย)
  if (dateStr && typeof periodIndex === "number" && periodIndex > 0) {
    const prevContinuousRegular = allFree
      .filter(
        (u) =>
          !u.isStudentTeacher &&
          doesTeacherTeachPrevPeriodExactClass(u, dateStr, periodIndex, targetClass)
      )
      .sort((m, n) => {
        const mSameG = m.g === absentGroup ? 1 : 0;
        const nSameG = n.g === absentGroup ? 1 : 0;
        if (nSameG !== mSameG) return nSameG - mSameG;
        return compareCandidates(m, n);
      });
    if (prevContinuousRegular[0]) return prevContinuousRegular[0];
  }

  // 1. ครูประจำการที่สอนในระดับชั้นเดียวกัน และอยู่กลุ่มสาระเดียวกัน
  const sameGradeSameDept = allFree
    .filter(
      (u) =>
        !u.isStudentTeacher &&
        doesTeacherTeachGrade(u, targetClass) &&
        u.g === absentGroup
    )
    .sort(compareCandidates);
  if (sameGradeSameDept[0]) return sameGradeSameDept[0];

  // 2. ครูประจำการที่สอนในระดับชั้นเดียวกัน (ต่างกลุ่มสาระ)
  const sameGradeOtherDept = allFree
    .filter(
      (u) =>
        !u.isStudentTeacher &&
        doesTeacherTeachGrade(u, targetClass) &&
        u.g !== absentGroup
    )
    .sort(compareCandidates);
  if (sameGradeOtherDept[0]) return sameGradeOtherDept[0];

  // 3. ครูประจำการในกลุ่มสาระเดียวกัน (ที่สอนระดับชั้นอื่น)
  const otherGradeSameDept = allFree
    .filter(
      (u) =>
        !u.isStudentTeacher &&
        !doesTeacherTeachGrade(u, targetClass) &&
        u.g === absentGroup
    )
    .sort(compareCandidates);
  if (otherGradeSameDept[0]) return otherGradeSameDept[0];

  // 4. นักศึกษาฝึกสอนที่ว่างในคาบนั้น (เรียงคาบต่อเนื่องห้องเดิม -> ระดับชั้นเดียวกัน -> กลุ่มสาระเดียวกัน)
  const freeStudentTeachers = allFree
    .filter((u) => Boolean(u.isStudentTeacher))
    .sort((m, n) => {
      if (dateStr && typeof periodIndex === "number" && periodIndex > 0) {
        const mPrevCont = doesTeacherTeachPrevPeriodExactClass(m, dateStr, periodIndex, targetClass) ? 1 : 0;
        const nPrevCont = doesTeacherTeachPrevPeriodExactClass(n, dateStr, periodIndex, targetClass) ? 1 : 0;
        if (nPrevCont !== mPrevCont) return nPrevCont - mPrevCont;
      }

      const mSameGrade = doesTeacherTeachGrade(m, targetClass) ? 1 : 0;
      const nSameGrade = doesTeacherTeachGrade(n, targetClass) ? 1 : 0;
      if (nSameGrade !== mSameGrade) return nSameGrade - mSameGrade;

      const mSameG = m.g === absentGroup ? 1 : 0;
      const nSameG = n.g === absentGroup ? 1 : 0;
      if (nSameG !== mSameG) return nSameG - mSameG;

      return compareCandidates(m, n);
    });
  if (freeStudentTeachers[0]) return freeStudentTeachers[0];

  // 5. ครูประจำการท่านอื่นที่ว่าง (ต่างระดับชั้น และต่างกลุ่มสาระ)
  const otherGradeOtherDept = allFree
    .filter(
      (u) =>
        !u.isStudentTeacher &&
        !doesTeacherTeachGrade(u, targetClass) &&
        u.g !== absentGroup
    )
    .sort(compareCandidates);
  if (otherGradeOtherDept[0]) return otherGradeOtherDept[0];

  return undefined;
}

/**
 * จัดครูสอนแทนอัตโนมัติสำหรับครู 1 ท่าน (รองรับการตัดครูท่านอื่นที่ลาในวันเดียวกันออก)
 * โดยให้คาบต่อเนื่องเป็นอันดับแรก หากครูที่สอนห้องนั้นในคาบก่อนหน้าว่าง แล้วคำนึงถึงครูในระดับชั้นเดียวกันและกลุ่มสาระ
 */
export function autoAssignSubstitutes(
  absentTeacherId: string | number,
  dateStr: string,
  includeSupervision = false,
  otherAbsentTeacherIds: number[] = [],
  sharedAssignedCount?: Record<number, number>,
  usedInPeriod?: Record<number, Set<number>>
): Record<number, string> {
  if (isTeacherExemptFromNeedingSubstitute(absentTeacherId)) return {};

  const absentTeacher = getTeacherById(absentTeacherId);
  const classes = getTeacherClasses(absentTeacherId, dateStr, includeSupervision);
  const assignments: Record<number, string> = {};
  if (!absentTeacher || classes.length === 0) return assignments;

  const assignedCount: Record<number, number> = sharedAssignedCount || {};

  classes.forEach((slot) => {
    const busySet = usedInPeriod?.[slot.p] || new Set<number>();
    const allFree = getCandidateTeachers(
      absentTeacherId,
      dateStr,
      slot.p,
      [...otherAbsentTeacherIds, ...Array.from(busySet)],
      slot.cls
    );

    const chosen = pickBestSubstituteForSlot(
      allFree,
      slot.cls,
      absentTeacher.g,
      absentTeacher.pdfGroup,
      assignedCount,
      dateStr,
      slot.p
    );

    if (chosen) {
      assignments[slot.p] = `t${chosen.id}`;
      assignedCount[chosen.id] = (assignedCount[chosen.id] || 0) + 1;
      if (usedInPeriod) {
        if (!usedInPeriod[slot.p]) usedInPeriod[slot.p] = new Set<number>();
        usedInPeriod[slot.p].add(chosen.id);
      }
      return;
    }

    // กรณีไม่มีผู้ว่างในรายชื่อระบบ
    assignments[slot.p] = "s";
  });

  return assignments;
}

/**
 * จัดครูสอนแทนอัตโนมัติลงในตารางเดียวกัน (สำหรับครูลา 1 ท่าน หรือหลายท่านในใบเดียวกัน)
 * - ให้คาบต่อเนื่องเป็นอันดับแรก หากครูที่สอนห้องนั้นในคาบก่อนหน้าว่าง
 * - คำนึงถึงครูที่สอนในระดับชั้นเดียวกันเป็นหลัก แล้วค่อยเรียงตามกลุ่มสาระ
 * - ตัดชื่อครูที่ลาทุกคนออกจากผู้สอนแทน
 * - ป้องกันไม่ให้จัดผู้สอนแทนคนเดียวกันซ้ำในคาบเรียนเดียวกัน (No Double-Booking)
 * - เกลี่ยจำนวนคาบสอนแทนรวมทั้งวันให้สมดุล
 */
export function autoAssignCombinedSubstitutes(
  teacherIds: (string | number)[],
  dateStr: string,
  includeSupervision = false
): Record<string, string> {
  const allAbsentIds = Array.from(
    new Set(
      teacherIds
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id) && id > 0 && !isTeacherExemptFromNeedingSubstitute(id))
    )
  );
  const combinedSlots = getCombinedTeacherClasses(allAbsentIds, dateStr, includeSupervision);
  const assignments: Record<string, string> = {};
  if (combinedSlots.length === 0) return assignments;

  const assignedCount: Record<number, number> = {};
  const usedInPeriod: Record<number, Set<number>> = {};

  combinedSlots.forEach((slot) => {
    const busySet = usedInPeriod[slot.p] || new Set<number>();
    const allFree = getCandidateTeachers(
      slot.absentTeacherId,
      dateStr,
      slot.p,
      [...allAbsentIds, ...Array.from(busySet)],
      slot.cls
    );

    const chosen = pickBestSubstituteForSlot(
      allFree,
      slot.cls,
      slot.absentTeacherGroup,
      slot.absentTeacherPdfGroup,
      assignedCount,
      dateStr,
      slot.p
    );

    if (chosen) {
      const val = `t${chosen.id}`;
      assignments[slot.slotKey] = val;
      if (allAbsentIds.length === 1) assignments[String(slot.p)] = val;
      assignedCount[chosen.id] = (assignedCount[chosen.id] || 0) + 1;
      if (!usedInPeriod[slot.p]) usedInPeriod[slot.p] = new Set<number>();
      usedInPeriod[slot.p].add(chosen.id);
      return;
    }

    // กรณีไม่มีผู้ว่างในรายชื่อระบบ
    assignments[slot.slotKey] = "s";
    if (allAbsentIds.length === 1) assignments[String(slot.p)] = "s";
  });

  return assignments;
}

export function getSlotAssignment(
  assignments: Record<string | number, string>,
  absentTeacherId: number,
  periodIndex: number
): string | undefined {
  const slotKey = `${absentTeacherId}_${periodIndex}`;
  return assignments[slotKey] ?? assignments[periodIndex] ?? assignments[String(periodIndex)];
}

/**
 * จัดครูสอนแทนอัตโนมัติสำหรับครูที่ลาพร้อมกันหลายคนในวันเดียวกัน
 * - ตัดชื่อครูที่ลาทุกคนออกจากผู้สอนแทน
 * - ป้องกันไม่ให้จัดผู้สอนแทนคนเดียวกันซ้ำในคาบเรียนเดียวกัน (No Double-Booking)
 * - เกลี่ยจำนวนคาบสอนแทนรวมทั้งวันให้สมดุล
 */
export function autoAssignMultipleTeachers(
  entries: AbsentTeacherEntry[],
  dateStr: string
): AbsentTeacherEntry[] {
  const allAbsentIds = entries
    .map((e) => Number(e.teacherId))
    .filter((id) => !Number.isNaN(id) && id > 0);

  const sharedAssignedCount: Record<number, number> = {};
  const usedInPeriod: Record<number, Set<number>> = {};

  return entries.map((entry) => {
    const idStr = String(entry.teacherId || "");
    if (!idStr) {
      return { ...entry, assignments: {} };
    }
    const assignments = autoAssignSubstitutes(
      idStr,
      dateStr,
      Boolean(entry.includeSupervision),
      allAbsentIds,
      sharedAssignedCount,
      usedInPeriod
    );
    return {
      ...entry,
      assignments,
    };
  });
}

/**
 * แปลงรหัสผู้สอนแทนเป็นชื่อและกลุ่มสาระสำหรับแสดงในตารางใบสอนแทน
 */
export function resolveSubstitute(
  assignVal: string | undefined,
  studentTeacherName: string
): { n: string; g: string } {
  if (!assignVal) return { n: "-", g: "-" };
  if (assignVal === "s") {
    const trimmed = studentTeacherName.trim();
    return {
      n: "นักศึกษาฝึกสอน" + (trimmed ? ` (${trimmed})` : ""),
      g: "-",
    };
  }
  const t = TEACHERS.find((x) => `t${x.id}` === assignVal);
  if (!t) return { n: "-", g: "-" };
  if (t.isStudentTeacher) {
    return {
      n: `${t.n} (นศ.ฝึกสอน)`,
      g: t.pdfGroup,
    };
  }
  return { n: t.n, g: t.pdfGroup };
}

export const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;

/**
 * แปลงชื่อผู้สอนแทนสำหรับแสดงในคอลัมน์ "ชื่อ-สกุล ผู้สอนแทน" ของแบบบันทึกการจัดสอนแทน
 */
export function formatCleanSubstituteName(rawSubName: string): string {
  const trimmed = String(rawSubName || "").trim();
  if (!trimmed || trimmed === "-") return "-";
  const customStMatch = trimmed.match(/^นักศึกษาฝึกสอน\s*\((.+)\)$/);
  if (customStMatch && customStMatch[1].trim()) {
    return customStMatch[1].trim();
  }
  const withoutTag = trimmed.replace(/\s*\(นศ\.ฝึกสอน\)\s*$/, "").trim();
  if (withoutTag === "ครูสุภาวรรณ ปวยทอง") {
    return "นางสาวสุภาวรรณ ปวยทอง";
  }
  return withoutTag;
}

/**
 * แปลงชั้นเรียนให้มีคำว่า "ม." นำหน้าสำหรับคอลัมน์ "ห้อง" เช่น "1/2" -> "ม.1/2"
 */
export function formatClassLevelLabel(cls: string): string {
  const trimmed = String(cls || "").trim();
  if (!trimmed || trimmed === "-") return "-";
  if (trimmed.startsWith("ม.")) return trimmed;
  if (/^[1-6](\/\d+)?$/.test(trimmed)) {
    return `ม.${trimmed}`;
  }
  return trimmed;
}

/**
 * แผนที่รหัสวิชาเฉพาะเจาะจง -> ชื่อวิชาที่สอนจริง (ไม่ใช่ชื่อกลุ่มสาระ)
 * เช่น เคมี, ชีววิทยา, ฟิสิกส์, วิทยาศาสตร์กายภาพ, วิทยาศาสตร์ชีวภาพ, วิทยาศาสตร์พื้นฐาน, วิทยาการคำนวณ, คณิตศาสตร์เพิ่มเติม ฯลฯ
 */
export const KNOWN_COURSE_SUBJECTS: Record<string, string> = {
  // ฟิสิกส์
  "ว31202": "ฟิสิกส์",
  "ว32204": "ฟิสิกส์",
  "ว33206": "ฟิสิกส์",
  // เคมี
  "ว31222": "เคมี",
  "ว32224": "เคมี",
  "ว33226": "เคมี",
  // ชีววิทยา
  "ว31242": "ชีววิทยา",
  "ว32244": "ชีววิทยา",
  "ว33246": "ชีววิทยา",
  // วิทยาศาสตร์ ม.ปลาย (กายภาพ / ชีวภาพ)
  "ว32102": "วิทยาศาสตร์กายภาพ",
  "ว31102": "วิทยาศาสตร์ชีวภาพ",
  "ว31103": "วิทยาศาสตร์กายภาพ",
  "ว32103": "วิทยาศาสตร์กายภาพ",
  // วิทยาศาสตร์ ม.ต้น (วิทยาศาสตร์พื้นฐาน)
  "ว21101": "วิทยาศาสตร์พื้นฐาน",
  "ว21102": "วิทยาศาสตร์พื้นฐาน",
  "ว22101": "วิทยาศาสตร์พื้นฐาน",
  "ว22102": "วิทยาศาสตร์พื้นฐาน",
  "ว23101": "วิทยาศาสตร์พื้นฐาน",
  "ว23102": "วิทยาศาสตร์พื้นฐาน",
  // คอมพิวเตอร์ / วิทยาการคำนวณ / เทคโนโลยี
  "ว21104": "วิทยาการคำนวณ",
  "ว22104": "วิทยาการคำนวณ",
  "ว23104": "วิทยาการคำนวณ",
  "ว31104": "วิทยาการคำนวณ",
  "ว32104": "วิทยาการคำนวณ",
  "ว33282": "วิทยาการคำนวณ",
  "ว30273": "มัลติมีเดีย",
  "ว30274": "อินโฟกราฟิก",
  "ว30277": "คอมพิวเตอร์",
  "ว30278": "เขียนโปรแกรม",
  "ว30281": "มัลติมีเดีย",
  "ว30282": "การนำเสนอ",
  // คณิตศาสตร์พื้นฐาน
  "ค21101": "คณิตศาสตร์พื้นฐาน",
  "ค21102": "คณิตศาสตร์พื้นฐาน",
  "ค22101": "คณิตศาสตร์พื้นฐาน",
  "ค22102": "คณิตศาสตร์พื้นฐาน",
  "ค23101": "คณิตศาสตร์พื้นฐาน",
  "ค23102": "คณิตศาสตร์พื้นฐาน",
  "ค31101": "คณิตศาสตร์พื้นฐาน",
  "ค31102": "คณิตศาสตร์พื้นฐาน",
  "ค32101": "คณิตศาสตร์พื้นฐาน",
  "ค32102": "คณิตศาสตร์พื้นฐาน",
  "ค33101": "คณิตศาสตร์พื้นฐาน",
  "ค33102": "คณิตศาสตร์พื้นฐาน",
  // คณิตศาสตร์เพิ่มเติม
  "ค21201": "คณิตศาสตร์เพิ่มเติม",
  "ค21202": "คณิตศาสตร์เพิ่มเติม",
  "ค22201": "คณิตศาสตร์เพิ่มเติม",
  "ค22202": "คณิตศาสตร์เพิ่มเติม",
  "ค23201": "คณิตศาสตร์เพิ่มเติม",
  "ค23202": "คณิตศาสตร์เพิ่มเติม",
  "ค31201": "คณิตศาสตร์เพิ่มเติม",
  "ค31202": "คณิตศาสตร์เพิ่มเติม",
  "ค32201": "คณิตศาสตร์เพิ่มเติม",
  "ค32202": "คณิตศาสตร์เพิ่มเติม",
  "ค32202-พต": "คณิตศาสตร์เพิ่มเติม",
  "ค33201": "คณิตศาสตร์เพิ่มเติม",
  "ค33202": "คณิตศาสตร์เพิ่มเติม",
  "ค33204": "คณิตศาสตร์เพิ่มเติม",
  // สังคมศึกษา & ประวัติศาสตร์ & ศาสนา & เศรษฐศาสตร์
  "ส21101": "สังคมศึกษา",
  "ส21102": "สังคมศึกษา",
  "ส22101": "สังคมศึกษา",
  "ส22103": "สังคมศึกษา",
  "ส23101": "สังคมศึกษา",
  "ส23102": "สังคมศึกษา",
  "ส23103": "สังคมศึกษา",
  "ส31101": "สังคมศึกษา",
  "ส32101": "สังคมศึกษา",
  "ส33101": "สังคมศึกษา",
  "ส21104": "ประวัติศาสตร์",
  "ส22104": "ประวัติศาสตร์",
  "ส23104": "ประวัติศาสตร์",
  "ส31104": "ประวัติศาสตร์",
  "ส31103": "เศรษฐศาสตร์",
  "ส33102": "เศรษฐศาสตร์",
  "ส32103": "พระพุทธศาสนา",
  "ส32104": "หน้าที่พลเมือง",
  "ส30241": "สังคมศึกษาเพิ่มเติม",
  // ภาษาไทย
  "ท21101": "ภาษาไทย",
  "ท21102": "ภาษาไทย",
  "ท22101": "ภาษาไทย",
  "ท22102": "ภาษาไทย",
  "ท23101": "ภาษาไทย",
  "ท23102": "ภาษาไทย",
  "ท31101": "ภาษาไทย",
  "ท31102": "ภาษาไทย",
  "ท32101": "ภาษาไทย",
  "ท32102": "ภาษาไทย",
  "ท33101": "ภาษาไทย",
  "ท33102": "ภาษาไทย",
  // ภาษาต่างประเทศ
  "อ21101": "ภาษาอังกฤษ",
  "อ21102": "ภาษาอังกฤษ",
  "อ22101": "ภาษาอังกฤษ",
  "อ22102": "ภาษาอังกฤษ",
  "อ23101": "ภาษาอังกฤษ",
  "อ23102": "ภาษาอังกฤษ",
  "อ31101": "ภาษาอังกฤษ",
  "อ31102": "ภาษาอังกฤษ",
  "อ32101": "ภาษาอังกฤษ",
  "อ32102": "ภาษาอังกฤษ",
  "อ33101": "ภาษาอังกฤษ",
  "อ33102": "ภาษาอังกฤษ",
  "อ31204": "ภาษาอังกฤษเพิ่มเติม",
  "อ32204": "ภาษาอังกฤษเพิ่มเติม",
  "จ21202": "ภาษาจีน",
  "จ22202": "ภาษาจีน",
  "จ23202": "ภาษาจีน",
  "จ31202": "ภาษาจีน",
  "จ32202": "ภาษาจีน",
  "จ32203": "ภาษาจีน",
  "จ33202": "ภาษาจีน",
  // สุขศึกษา & พลศึกษา
  "พ21103": "สุขศึกษา",
  "พ22103": "สุขศึกษา",
  "พ23103": "สุขศึกษา",
  "พ21104": "ฟุตบอล",
  "พ22104": "กระบี่กระบอง",
  "พ23104": "พลศึกษาเพิ่มเติม",
  "พ31202": "แบดมินตัน",
  "พ32202": "บาสเกตบอล",
  "พ31102": "สุขศึกษาและพลศึกษา",
  "พ32102": "สุขศึกษาและพลศึกษา",
  "พ33102": "สุขศึกษาและพลศึกษา",
  "พ33202": "พลศึกษา",
  // ศิลปะ
  "ศ21102": "ดนตรี-นาฏศิลป์",
  "ศ22102": "ศิลปะ-ดนตรี",
  "ศ23102": "ทัศนศิลป์",
  "ศ23103": "ศิลปะ-ดนตรี",
  "ศ31102": "ดนตรี-นาฏศิลป์",
  "ศ32102": "ศิลปะ-ดนตรี",
  "ศ33102": "ศิลปะ-ดนตรี",
  // การงานอาชีพ
  "ง20213": "การงานอาชีพ",
  "ง21102": "การงานอาชีพ",
  "ง22102": "การงานอาชีพ",
  "ง23102": "การงานอาชีพ",
  "ง23202": "การงานอาชีพ",
  "ง30202": "การงานอาชีพ",
  "ง30207": "เบเกอรี่",
  "ง30208": "ขนมไทย",
  "ง30224": "เทคโนโลยีการเกษตร",
  "ง30242": "ภาษีเบื้องต้น",
  "ง31102": "การงานอาชีพ",
  "ง32102": "การงานอาชีพ",
  "ง33102": "การงานอาชีพ",
  // IS
  "I20202": "การศึกษาค้นคว้าอิสระ (IS)",
  "I30201": "การศึกษาค้นคว้าอิสระ (IS)",
  "IS-2": "การศึกษาค้นคว้าอิสระ (IS)",
  "IS-11": "การศึกษาค้นคว้าอิสระ (IS)",
};

export let CUSTOM_SUBJECT_MAPPINGS: Record<string, string> = {};

/**
 * กำหนดค่าชื่อวิชาตามรหัสวิชาแบบกำหนดเอง (Custom Overrides)
 */
export function setRuntimeSubjectMappings(mappings: Record<string, string>): void {
  CUSTOM_SUBJECT_MAPPINGS = { ...mappings };
}

/**
 * แปลงรหัสวิชาเป็นชื่อวิชาเฉพาะที่สอนจริง (ไม่ใช่ชื่อกลุ่มสาระ)
 * โดยจะตรวจสอบจากชื่อวิชาที่ผู้ใช้อัปเดตเอง (Custom Mappings) ก่อนเสมอ
 */
export function getSubjectNameFromCourse(
  code: string,
  fallbackGroup?: string,
  teacherSpecialtyOrId?: string | number
): string {
  const trimmed = String(code || "").trim();
  if (!trimmed || trimmed === "-") return fallbackGroup || "-";
  if (trimmed.startsWith("นิเทศสอน")) return "นิเทศการสอน";

  const cleanCode = trimmed.replace(/\s+/g, "").replace(/@.*$/, "");

  // 0. ตรวจสอบจากชื่อวิชาที่กำหนดเอง (Custom Mappings) ก่อน
  if (CUSTOM_SUBJECT_MAPPINGS[cleanCode]) {
    return CUSTOM_SUBJECT_MAPPINGS[cleanCode];
  }
  if (CUSTOM_SUBJECT_MAPPINGS[trimmed]) {
    return CUSTOM_SUBJECT_MAPPINGS[trimmed];
  }
  const baseCode = cleanCode.split("-")[0];
  if (CUSTOM_SUBJECT_MAPPINGS[baseCode]) {
    return CUSTOM_SUBJECT_MAPPINGS[baseCode];
  }

  // 1. ตรวจสอบจากตารางรหัสวิชาตรงตัว (System Default Map)
  if (KNOWN_COURSE_SUBJECTS[cleanCode]) {
    return KNOWN_COURSE_SUBJECTS[cleanCode];
  }
  if (KNOWN_COURSE_SUBJECTS[baseCode]) {
    return KNOWN_COURSE_SUBJECTS[baseCode];
  }

  const specialtyStr = String(fallbackGroup || "") + " " + String(teacherSpecialtyOrId || "");

  // 2. หมวดวิทยาศาสตร์
  if (cleanCode.startsWith("ว")) {
    if (/^ว3\d20/.test(cleanCode) || specialtyStr.includes("ฟิสิกส์")) {
      if (cleanCode === "ว32102" || cleanCode === "ว31103" || cleanCode === "ว32103") {
        return "วิทยาศาสตร์กายภาพ";
      }
      return "ฟิสิกส์";
    }
    if (/^ว3\d22/.test(cleanCode) || specialtyStr.includes("เคมี")) {
      return "เคมี";
    }
    if (/^ว3\d24/.test(cleanCode) || specialtyStr.includes("ชีววิทยา")) {
      if (cleanCode === "ว31102") return "วิทยาศาสตร์ชีวภาพ";
      return "ชีววิทยา";
    }
    if (cleanCode === "ว32102" || cleanCode === "ว31103") {
      return "วิทยาศาสตร์กายภาพ";
    }
    if (cleanCode === "ว31102") {
      return "วิทยาศาสตร์ชีวภาพ";
    }
    if (/^ว[12]\d102/.test(cleanCode) || /^ว[12]\d101/.test(cleanCode)) {
      return "วิทยาศาสตร์พื้นฐาน";
    }
    if (/^ว\d+104/.test(cleanCode) || /^ว33282/.test(cleanCode) || specialtyStr.includes("คอมพิวเตอร์")) {
      return "วิทยาการคำนวณ";
    }
    return "วิทยาศาสตร์พื้นฐาน";
  }

  // 3. หมวดคณิตศาสตร์
  if (cleanCode.startsWith("ค")) {
    if (/^ค\d+2\d+/.test(cleanCode) || cleanCode.includes("พต")) {
      return "คณิตศาสตร์เพิ่มเติม";
    }
    if (/^ค\d+1\d+/.test(cleanCode)) {
      return "คณิตศาสตร์พื้นฐาน";
    }
    return "คณิตศาสตร์พื้นฐาน";
  }

  // 4. หมวดสังคมศึกษา
  if (cleanCode.startsWith("ส")) {
    if (/^ส\d+104/.test(cleanCode)) return "ประวัติศาสตร์";
    if (cleanCode === "ส31103" || cleanCode === "ส33102") return "เศรษฐศาสตร์";
    if (cleanCode === "ส32103") return "พระพุทธศาสนา";
    if (cleanCode === "ส32104") return "หน้าที่พลเมือง";
    if (cleanCode === "ส30241") return "สังคมศึกษาเพิ่มเติม";
    return "สังคมศึกษา";
  }

  // 5. หมวดภาษาไทย
  if (cleanCode.startsWith("ท")) {
    return "ภาษาไทย";
  }

  // 6. หมวดภาษาต่างประเทศ
  if (cleanCode.startsWith("อ")) {
    if (/^อ\d+2\d+/.test(cleanCode)) return "ภาษาอังกฤษเพิ่มเติม";
    return "ภาษาอังกฤษ";
  }
  if (cleanCode.startsWith("จ")) {
    return "ภาษาจีน";
  }

  // 7. หมวดสุขศึกษาและพลศึกษา
  if (cleanCode.startsWith("พ")) {
    if (/^พ\d+103/.test(cleanCode)) return "สุขศึกษา";
    if (cleanCode === "พ21104") return "ฟุตบอล";
    if (cleanCode === "พ22104") return "กระบี่กระบอง";
    if (cleanCode === "พ31202") return "แบดมินตัน";
    if (cleanCode === "พ32202") return "บาสเกตบอล";
    return "พลศึกษา";
  }

  // 8. หมวดศิลปะ
  if (cleanCode.startsWith("ศ")) {
    return "ศิลปะ";
  }

  // 9. หมวดการงานอาชีพ
  if (cleanCode.startsWith("ง")) {
    return "การงานอาชีพ";
  }

  if (/^I\d+/i.test(cleanCode) || /^IS/i.test(cleanCode)) {
    return "การศึกษาค้นคว้าอิสระ (IS)";
  }

  return fallbackGroup || trimmed;
}

/**
 * แปลงวันที่ YYYY-MM-DD เป็นรูปแบบย่อ พ.ศ. DD/MM/YY เช่น "18/05/69"
 */
export function formatShortThaiDate(dateStr: string): string {
  if (!dateStr) return "-";
  const dt = new Date(dateStr + "T00:00:00");
  if (isNaN(dt.getTime())) return "-";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const buddhistYear = dt.getFullYear() + 543;
  const yy = String(buddhistYear).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

/**
 * แปลงวันที่ YYYY-MM-DD เป็นข้อความหัวกระดาษ "ประจำเดือน <เดือนไทย> พ.ศ. <ปี พ.ศ.>"
 * เช่น "ประจำเดือน พฤษภาคม พ.ศ. 2569"
 */
export function formatThaiMonthYearHeader(dateStr: string): string {
  const dt = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const validDt = isNaN(dt.getTime()) ? new Date() : dt;
  const monthName = THAI_MONTHS[validDt.getMonth()] || "พฤษภาคม";
  const buddhistYear = validDt.getFullYear() + 543;
  return `ประจำเดือน ${monthName} พ.ศ. ${buddhistYear}`;
}

/**
 * สร้างข้อมูลแถวสำหรับใบสอนแทน (ครู 1 ท่าน)
 */
export function buildDocumentRows(
  absentTeacherId: string | number,
  dateStr: string,
  assignments: Record<string | number, string>,
  studentTeacherName: string,
  includeSupervision = false
): SubstituteRow[] {
  const teacher = getTeacherById(absentTeacherId);
  const classes = getTeacherClasses(absentTeacherId, dateStr, includeSupervision);
  const shortDate = formatShortThaiDate(dateStr);
  return classes.map((slot) => {
    const val = teacher
      ? getSlotAssignment(assignments, teacher.id, slot.p)
      : assignments[slot.p];
    const sub = resolveSubstitute(val, studentTeacherName);
    return {
      p: slot.p + 1,
      tm: slot.tm,
      code: slot.code,
      cls: slot.cls,
      room: slot.room,
      n: sub.n,
      g: sub.g,
      slotKey: teacher ? `${teacher.id}_${slot.p}` : String(slot.p),
      absentTeacherId: teacher?.id,
      absentTeacherName: teacher?.n,
      subName: formatCleanSubstituteName(sub.n),
      classRoomLabel: formatClassLevelLabel(slot.cls),
      subjectName: getSubjectNameFromCourse(
        slot.code,
        teacher?.pdfGroup || teacher?.g,
        teacher?.id
      ),
      shortDate,
    };
  });
}

/**
 * สร้างข้อมูลแถวรวมในตารางเดียวกันสำหรับครูที่ลา 1 หรือหลายท่านในวันเดียวกัน
 */
export function buildCombinedDocumentRows(
  teacherIds: (string | number)[],
  dateStr: string,
  assignments: Record<string | number, string>,
  studentTeacherName: string,
  includeSupervision = false
): SubstituteRow[] {
  const combinedSlots = getCombinedTeacherClasses(teacherIds, dateStr, includeSupervision);
  const shortDate = formatShortThaiDate(dateStr);
  return combinedSlots.map((slot) => {
    const val = getSlotAssignment(assignments, slot.absentTeacherId, slot.p);
    const sub = resolveSubstitute(val, studentTeacherName);
    const absentT = getTeacherById(slot.absentTeacherId);
    const specialty = absentT?.pdfGroup || slot.absentTeacherGroup;
    return {
      p: slot.p + 1,
      tm: slot.tm,
      code: slot.code,
      cls: slot.cls,
      room: slot.room,
      n: sub.n,
      g: sub.g,
      slotKey: slot.slotKey,
      absentTeacherId: slot.absentTeacherId,
      absentTeacherName: slot.absentTeacherName,
      subName: formatCleanSubstituteName(sub.n),
      classRoomLabel: formatClassLevelLabel(slot.cls),
      subjectName: getSubjectNameFromCourse(
        slot.code,
        specialty,
        slot.absentTeacherId
      ),
      shortDate,
    };
  });
}

/**
 * สร้างข้อมูลหัวเอกสารรวม (TeacherRecord เสมือน) สำหรับแสดงรายชื่อครูที่ลาทุกคนในใบเดียวกัน
 */
export function buildCombinedTeacherHeader(
  teacherIds: (string | number)[]
): TeacherRecord | undefined {
  const seen = new Set<number>();
  const list: TeacherRecord[] = [];
  for (const rawId of teacherIds) {
    const t = getTeacherById(rawId);
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      list.push(t);
    }
  }
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];

  const primary = list[0];
  const uniqueGroups = Array.from(new Set(list.map((t) => t.pdfGroup)));
  const combinedNamesWithId = list.map((t) => `${t.id} ${t.n}`).join(", ");

  return {
    ...primary,
    n: combinedNamesWithId,
    pdfGroup: uniqueGroups.join(" / "),
  };
}

/**
 * แปลงวันที่เป็นรูปแบบภาษาไทย เช่น "2 พฤศจิกายน 2569"
 */
export function formatThaiDate(dateStr: string): string {
  if (!dateStr) return "-";
  const dt = new Date(dateStr + "T00:00:00");
  if (isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * หาวันที่ที่เป็นวันทำการ (จันทร์-ศุกร์) สำหรับค่าเริ่มต้น
 */
export function getInitialWeekdayDate(baseDate = new Date()): string {
  const dt = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const day = dt.getDay();
  if (day === 6) {
    // เสาร์ -> เลื่อนไปวันจันทร์ถัดไป
    dt.setDate(dt.getDate() + 2);
  } else if (day === 0) {
    // อาทิตย์ -> เลื่อนไปวันจันทร์ถัดไป
    dt.setDate(dt.getDate() + 1);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/**
 * ปรับปีของวันที่ YYYY-MM-DD ให้ตรงกับปีการศึกษา (พ.ศ.) ที่เลือก โดยคงเดือนและวันเดิมไว้
 * และหากตรงกับวันเสาร์-อาทิตย์ จะเลื่อนไปวันทำการจันทร์-ศุกร์ในเดือนเดียวกันอัตโนมัติ
 */
export function adjustDateToAcademicYear(
  dateStr: string,
  buddhistYearStr: string
): string {
  const parsedBy = parseInt(String(buddhistYearStr || "").trim(), 10);
  if (!Number.isFinite(parsedBy) || parsedBy < 2400 || parsedBy > 2700) {
    return dateStr || getInitialWeekdayDate();
  }
  const targetGregorianYear = parsedBy - 543;
  const base = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const validBase = isNaN(base.getTime()) ? new Date() : base;

  const month = validBase.getMonth();
  const maxDayInMonth = new Date(targetGregorianYear, month + 1, 0).getDate();
  const dayOfMonth = Math.min(validBase.getDate(), maxDayInMonth);

  const dt = new Date(targetGregorianYear, month, dayOfMonth);
  const dow = dt.getDay();
  if (dow === 6) {
    // วันเสาร์: ถ้าบวก 2 วันแล้วยังอยู่เดือนเดิมให้ไปวันจันทร์ มิฉะนั้นถอยไปวันศุกร์
    if (dayOfMonth + 2 <= maxDayInMonth) {
      dt.setDate(dayOfMonth + 2);
    } else {
      dt.setDate(dayOfMonth - 1);
    }
  } else if (dow === 0) {
    // วันอาทิตย์: ถ้าบวก 1 วันแล้วยังอยู่เดือนเดิมให้ไปวันจันทร์ มิฉะนั้นถอยไปวันศุกร์
    if (dayOfMonth + 1 <= maxDayInMonth) {
      dt.setDate(dayOfMonth + 1);
    } else {
      dt.setDate(dayOfMonth - 2);
    }
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function getDayName(dateStr: string): string {
  const idx = getDayIndex(dateStr);
  return idx >= 0 ? DAYS[idx] : "";
}

export function formatRoomLabel(room: string): string {
  const trimmed = (room || "").trim();
  if (!trimmed || trimmed === "-") return "-";
  if (trimmed.startsWith("ห้อง")) return trimmed;
  return `ห้อง ${trimmed}`;
}

export interface SubjectCodeInfo {
  code: string;
  defaultName: string;
  currentName: string;
  isCustom: boolean;
  teachersCount: number;
  teacherNames: string[];
}

/**
 * ดึงรายการรหัสวิชาทั้งหมดที่มีในระบบ (ทั้งจากตารางสอนครู และจาก KNOWN_COURSE_SUBJECTS)
 */
export function getAllDiscoveredSubjectCodes(): SubjectCodeInfo[] {
  const codeToTeachers: Record<string, Set<string>> = {};

  TEACHERS.forEach((t) => {
    if (!t.d) return;
    t.d.forEach((dayRow) => {
      dayRow.forEach((cell) => {
        const parsed = parseScheduleCell(cell, t.r);
        if (parsed.isTeachable && parsed.code && parsed.code !== "-") {
          const clean = parsed.code.trim();
          if (!codeToTeachers[clean]) {
            codeToTeachers[clean] = new Set();
          }
          codeToTeachers[clean].add(t.n);
        }
      });
    });
  });

  const allCodesSet = new Set<string>([
    ...Object.keys(KNOWN_COURSE_SUBJECTS),
    ...Object.keys(codeToTeachers),
    ...Object.keys(CUSTOM_SUBJECT_MAPPINGS),
  ]);

  const results: SubjectCodeInfo[] = [];

  allCodesSet.forEach((code) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;

    const customOverride = CUSTOM_SUBJECT_MAPPINGS[cleanCode];
    const defaultName = KNOWN_COURSE_SUBJECTS[cleanCode] || KNOWN_COURSE_SUBJECTS[cleanCode.split("-")[0]] || "-";
    const resolvedDefault = defaultName !== "-" ? defaultName : getSubjectNameFromCourse(cleanCode);

    const isCustom = Boolean(customOverride);
    const currentName = customOverride || resolvedDefault;

    const teacherSet = codeToTeachers[cleanCode] || new Set();
    const teacherNames = Array.from(teacherSet);

    results.push({
      code: cleanCode,
      defaultName: resolvedDefault,
      currentName,
      isCustom,
      teachersCount: teacherNames.length,
      teacherNames,
    });
  });

  return results.sort((a, b) => a.code.localeCompare(b.code, "th"));
}


