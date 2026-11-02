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

export interface SubstituteRow {
  p: number; // 1-based period number (1..7)
  tm: string;
  code: string;
  cls: string;
  room: string;
  n: string;
  g: string;
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
 * ค้นหาครูและนักศึกษาฝึกสอนที่ว่างในวันและคาบที่กำหนด
 * เรียงลำดับ:
 * 1) ครูประจำการในกลุ่มสาระเดียวกัน (!isStudentTeacher && g === absent.g)
 * 2) นักศึกษาฝึกสอนที่ว่างในคาบนั้น (isStudentTeacher) โดยเรียงกลุ่มสาระเดียวกันขึ้นก่อน
 * 3) ครูประจำการต่างกลุ่มสาระ (!isStudentTeacher && g !== absent.g)
 */
export function getCandidateTeachers(
  absentTeacherId: string | number,
  dateStr: string,
  periodIndex: number
): TeacherRecord[] {
  const absentTeacher = getTeacherById(absentTeacherId);
  const dayIdx = getDayIndex(dateStr);
  if (!absentTeacher || dayIdx < 0) return [];
  if (dayIdx === 3 && periodIndex === 0) return [];

  return TEACHERS.filter((t) => {
    if (t.id === absentTeacher.id) return false;
    const cell = t.d?.[dayIdx]?.[periodIndex] || "";
    // ต้องไม่มีคาบสอน ไม่ติดประชุม (*) ไม่ติดนิเทศสอน หรือกิจกรรมในคาบนั้น
    return cell.trim() === "";
  }).sort((m, n) => {
    const tier = (u: TeacherRecord) => {
      if (!u.isStudentTeacher && u.g === absentTeacher.g) return 1; // ครูกลุ่มสาระเดียวกัน
      if (u.isStudentTeacher && u.g === absentTeacher.g) return 2;  // นศ.ฝึกสอนกลุ่มสาระเดียวกัน
      if (u.isStudentTeacher) return 3;                             // นศ.ฝึกสอนกลุ่มสาระอื่น
      return 4;                                                     // ครูต่างกลุ่มสาระ
    };
    const tierDiff = tier(m) - tier(n);
    if (tierDiff !== 0) return tierDiff;

    const mSameSub = m.pdfGroup === absentTeacher.pdfGroup ? 1 : 0;
    const nSameSub = n.pdfGroup === absentTeacher.pdfGroup ? 1 : 0;
    if (nSameSub !== mSameSub) return nSameSub - mSameSub;

    return m.id - n.id;
  });
}

/**
 * จัดครูสอนแทนอัตโนมัติ:
 * 1) เลือกครูประจำการกลุ่มสาระเดียวกันที่ว่างในคาบนั้นก่อน (★) โดยเกลี่ยภาระงานให้เท่ากัน
 * 2) หากไม่มีครูประจำการในกลุ่มสาระว่าง ระบบจะจัดนักศึกษาฝึกสอน (205, 307, 308, 604) ที่ว่างในคาบนั้นให้
 *    (โดยให้นักศึกษาฝึกสอนที่ตรงกลุ่มสาระก่อน แล้วจึงเกลี่ยภาระงานในกลุ่มนักศึกษาฝึกสอน)
 * 3) หากนักศึกษาฝึกสอนทั้ง 4 ท่านมีคาบสอนตรงกันหมด จะตั้งเป็น "s" (นักศึกษาฝึกสอนทั่วไป/ระบุชื่อเอง)
 */
export function autoAssignSubstitutes(
  absentTeacherId: string | number,
  dateStr: string,
  includeSupervision = false
): Record<number, string> {
  const absentTeacher = getTeacherById(absentTeacherId);
  const classes = getTeacherClasses(absentTeacherId, dateStr, includeSupervision);
  const assignments: Record<number, string> = {};
  if (!absentTeacher || classes.length === 0) return assignments;

  const assignedCount: Record<number, number> = {};

  classes.forEach((slot) => {
    const allFree = getCandidateTeachers(absentTeacherId, dateStr, slot.p);

    // 1. ค้นหาครูประจำการในกลุ่มสาระเดียวกันที่ว่าง
    const sameDeptRegular = allFree
      .filter((u) => !u.isStudentTeacher && u.g === absentTeacher.g)
      .sort((m, n) => {
        const countDiff = (assignedCount[m.id] || 0) - (assignedCount[n.id] || 0);
        if (countDiff !== 0) return countDiff;
        const mSub = m.pdfGroup === absentTeacher.pdfGroup ? 1 : 0;
        const nSub = n.pdfGroup === absentTeacher.pdfGroup ? 1 : 0;
        if (nSub !== mSub) return nSub - mSub;
        return m.id - n.id;
      });

    if (sameDeptRegular[0]) {
      const chosen = sameDeptRegular[0];
      assignments[slot.p] = `t${chosen.id}`;
      assignedCount[chosen.id] = (assignedCount[chosen.id] || 0) + 1;
      return;
    }

    // 2. หากไม่มีครูประจำการในกลุ่มสาระว่าง ให้จัดนักศึกษาฝึกสอน (205, 307, 308, 604) ที่ว่างในคาบนั้น
    const freeStudentTeachers = allFree
      .filter((u) => Boolean(u.isStudentTeacher))
      .sort((m, n) => {
        // ถ้านักศึกษาฝึกสอนอยู่กลุ่มสาระเดียวกัน ให้มาก่อน
        const mSameG = m.g === absentTeacher.g ? 1 : 0;
        const nSameG = n.g === absentTeacher.g ? 1 : 0;
        if (nSameG !== mSameG) return nSameG - mSameG;

        const countDiff = (assignedCount[m.id] || 0) - (assignedCount[n.id] || 0);
        if (countDiff !== 0) return countDiff;
        return m.id - n.id;
      });

    if (freeStudentTeachers[0]) {
      const chosenSt = freeStudentTeachers[0];
      assignments[slot.p] = `t${chosenSt.id}`;
      assignedCount[chosenSt.id] = (assignedCount[chosenSt.id] || 0) + 1;
      return;
    }

    // 3. กรณีนักศึกษาฝึกสอนทั้ง 4 ท่านติดสอนในคาบนั้นทั้งหมด
    assignments[slot.p] = "s";
  });

  return assignments;
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

/**
 * สร้างข้อมูลแถวสำหรับใบสอนแทน
 */
export function buildDocumentRows(
  absentTeacherId: string | number,
  dateStr: string,
  assignments: Record<number, string>,
  studentTeacherName: string,
  includeSupervision = false
): SubstituteRow[] {
  const classes = getTeacherClasses(absentTeacherId, dateStr, includeSupervision);
  return classes.map((slot) => {
    const sub = resolveSubstitute(assignments[slot.p], studentTeacherName);
    return {
      p: slot.p + 1,
      tm: slot.tm,
      code: slot.code,
      cls: slot.cls,
      room: slot.room,
      n: sub.n,
      g: sub.g,
    };
  });
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

