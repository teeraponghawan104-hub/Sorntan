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
 * ค้นหาครูและนักศึกษาฝึกสอนที่ว่างในวันและคาบที่กำหนด
 * เรียงลำดับ:
 * 1) ครูประจำการในกลุ่มสาระเดียวกัน (!isStudentTeacher && g === absent.g)
 * 2) นักศึกษาฝึกสอนที่ว่างในคาบนั้น (isStudentTeacher) โดยเรียงกลุ่มสาระเดียวกันขึ้นก่อน
 * 3) ครูประจำการต่างกลุ่มสาระ (!isStudentTeacher && g !== absent.g)
 *
 * โดยตัดรายชื่อครูที่ลาในวันเดียวกัน (excludedTeacherIds), ผู้บริหารสถานศึกษา
 * และครู 302 (ครูรณสิทธิ์ ประดับศรี) ออกเด็ดขาด
 */
export function getCandidateTeachers(
  absentTeacherId: string | number,
  dateStr: string,
  periodIndex: number,
  excludedTeacherIds: number[] = []
): TeacherRecord[] {
  const absentTeacher = getTeacherById(absentTeacherId);
  const dayIdx = getDayIndex(dateStr);
  if (!absentTeacher || dayIdx < 0) return [];
  if (dayIdx === 3 && periodIndex === 0) return [];

  const excludedSet = new Set<number>([
    absentTeacher.id,
    ...excludedTeacherIds.map(Number).filter(Boolean),
  ]);

  return TEACHERS.filter((t) => {
    if (excludedSet.has(t.id)) return false;
    // ผู้บริหารโรงเรียน และ ครู 302 (ครูรณสิทธิ์ ประดับศรี) ไม่ให้ไปสอนแทนเด็ดขาด
    if (isExcludedFromSubstituting(t)) return false;
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
 * จัดครูสอนแทนอัตโนมัติสำหรับครู 1 ท่าน (รองรับการตัดครูท่านอื่นที่ลาในวันเดียวกันออก)
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
    const allFree = getCandidateTeachers(absentTeacherId, dateStr, slot.p, [
      ...otherAbsentTeacherIds,
      ...Array.from(busySet),
    ]);

    // 1. ค้นหาครูประจำการในกลุ่มสาระเดียวกันที่ว่างและยังไม่ถูกจัดสอนแทนท่านอื่นในคาบเดียวกัน
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
      if (usedInPeriod) {
        if (!usedInPeriod[slot.p]) usedInPeriod[slot.p] = new Set<number>();
        usedInPeriod[slot.p].add(chosen.id);
      }
      return;
    }

    // 2. หากไม่มีครูประจำการในกลุ่มสาระว่าง ให้จัดนักศึกษาฝึกสอน (205, 307, 308, 604) ที่ว่างและไม่ชนคาบกัน
    const freeStudentTeachers = allFree
      .filter((u) => Boolean(u.isStudentTeacher))
      .sort((m, n) => {
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
      if (usedInPeriod) {
        if (!usedInPeriod[slot.p]) usedInPeriod[slot.p] = new Set<number>();
        usedInPeriod[slot.p].add(chosenSt.id);
      }
      return;
    }

    // 3. หากครูในกลุ่มสาระและนักศึกษาฝึกสอนไม่ว่าง ให้เลือกครูประจำการต่างกลุ่มสาระที่ว่างและไม่ชนคาบ (เมื่อมีครูลาหลายคน)
    const otherDeptRegular = allFree
      .filter((u) => !u.isStudentTeacher)
      .sort((m, n) => {
        const countDiff = (assignedCount[m.id] || 0) - (assignedCount[n.id] || 0);
        if (countDiff !== 0) return countDiff;
        return m.id - n.id;
      });

    if (otherAbsentTeacherIds.length > 0 && otherDeptRegular[0]) {
      const chosenOther = otherDeptRegular[0];
      assignments[slot.p] = `t${chosenOther.id}`;
      assignedCount[chosenOther.id] = (assignedCount[chosenOther.id] || 0) + 1;
      if (usedInPeriod) {
        if (!usedInPeriod[slot.p]) usedInPeriod[slot.p] = new Set<number>();
        usedInPeriod[slot.p].add(chosenOther.id);
      }
      return;
    }

    // 4. กรณีนักศึกษาฝึกสอนทั้ง 4 ท่านติดสอนในคาบนั้นทั้งหมด
    assignments[slot.p] = "s";
  });

  return assignments;
}

/**
 * จัดครูสอนแทนอัตโนมัติลงในตารางเดียวกัน (สำหรับครูลา 1 ท่าน หรือหลายท่านในใบเดียวกัน)
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
    const allFree = getCandidateTeachers(slot.absentTeacherId, dateStr, slot.p, [
      ...allAbsentIds,
      ...Array.from(busySet),
    ]);

    // 1. ค้นหาครูประจำการในกลุ่มสาระเดียวกับเจ้าของวิชานั้น ที่ว่างและยังไม่ถูกจัดซ้ำในคาบเดียวกัน
    const sameDeptRegular = allFree
      .filter((u) => !u.isStudentTeacher && u.g === slot.absentTeacherGroup)
      .sort((m, n) => {
        const countDiff = (assignedCount[m.id] || 0) - (assignedCount[n.id] || 0);
        if (countDiff !== 0) return countDiff;
        const mSub = m.pdfGroup === slot.absentTeacherPdfGroup ? 1 : 0;
        const nSub = n.pdfGroup === slot.absentTeacherPdfGroup ? 1 : 0;
        if (nSub !== mSub) return nSub - mSub;
        return m.id - n.id;
      });

    if (sameDeptRegular[0]) {
      const chosen = sameDeptRegular[0];
      const val = `t${chosen.id}`;
      assignments[slot.slotKey] = val;
      if (allAbsentIds.length === 1) assignments[String(slot.p)] = val;
      assignedCount[chosen.id] = (assignedCount[chosen.id] || 0) + 1;
      if (!usedInPeriod[slot.p]) usedInPeriod[slot.p] = new Set<number>();
      usedInPeriod[slot.p].add(chosen.id);
      return;
    }

    // 2. จัดนักศึกษาฝึกสอน (205, 307, 308, 604) ที่ว่างและไม่ชนคาบกัน
    const freeStudentTeachers = allFree
      .filter((u) => Boolean(u.isStudentTeacher))
      .sort((m, n) => {
        const mSameG = m.g === slot.absentTeacherGroup ? 1 : 0;
        const nSameG = n.g === slot.absentTeacherGroup ? 1 : 0;
        if (nSameG !== mSameG) return nSameG - mSameG;
        const countDiff = (assignedCount[m.id] || 0) - (assignedCount[n.id] || 0);
        if (countDiff !== 0) return countDiff;
        return m.id - n.id;
      });

    if (freeStudentTeachers[0]) {
      const chosenSt = freeStudentTeachers[0];
      const val = `t${chosenSt.id}`;
      assignments[slot.slotKey] = val;
      if (allAbsentIds.length === 1) assignments[String(slot.p)] = val;
      assignedCount[chosenSt.id] = (assignedCount[chosenSt.id] || 0) + 1;
      if (!usedInPeriod[slot.p]) usedInPeriod[slot.p] = new Set<number>();
      usedInPeriod[slot.p].add(chosenSt.id);
      return;
    }

    // 3. หากครูในกลุ่มสาระและนักศึกษาฝึกสอนไม่ว่าง ให้เลือกครูประจำการต่างกลุ่มสาระที่ว่างและไม่ชนคาบ
    const otherDeptRegular = allFree
      .filter((u) => !u.isStudentTeacher)
      .sort((m, n) => {
        const countDiff = (assignedCount[m.id] || 0) - (assignedCount[n.id] || 0);
        if (countDiff !== 0) return countDiff;
        return m.id - n.id;
      });

    if (allAbsentIds.length > 1 && otherDeptRegular[0]) {
      const chosenOther = otherDeptRegular[0];
      const val = `t${chosenOther.id}`;
      assignments[slot.slotKey] = val;
      assignedCount[chosenOther.id] = (assignedCount[chosenOther.id] || 0) + 1;
      if (!usedInPeriod[slot.p]) usedInPeriod[slot.p] = new Set<number>();
      usedInPeriod[slot.p].add(chosenOther.id);
      return;
    }

    // 4. กรณีไม่มีผู้ว่างในรายชื่อระบบ
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


