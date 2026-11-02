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
 * ดึงรายการคาบสอนรวมของครูที่ลาทุกคนในวันเดียวกัน เพื่อนำมาเรียงรวมในตารางเดียวกัน
 * เรียงตามลำดับคาบที่ 1..7 แล้วตามลำดับครูที่เลือก
 */
export function getCombinedTeacherClasses(
  teacherIds: (string | number)[],
  dateStr: string,
  includeSupervision = false
): CombinedClassSlot[] {
  const seenTeachers = new Set<number>();
  const validTeachers: TeacherRecord[] = [];

  for (const rawId of teacherIds) {
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
 * ค้นหาครูและนักศึกษาฝึกสอนที่ว่างในวันและคาบที่กำหนด
 * เรียงลำดับ:
 * 1) ครูประจำการในกลุ่มสาระเดียวกัน (!isStudentTeacher && g === absent.g)
 * 2) นักศึกษาฝึกสอนที่ว่างในคาบนั้น (isStudentTeacher) โดยเรียงกลุ่มสาระเดียวกันขึ้นก่อน
 * 3) ครูประจำการต่างกลุ่มสาระ (!isStudentTeacher && g !== absent.g)
 *
 * โดยตัดรายชื่อครูที่ลาในวันเดียวกัน (excludedTeacherIds) ออกทันที
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
        .filter((id) => !Number.isNaN(id) && id > 0)
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
  return combinedSlots.map((slot) => {
    const val = getSlotAssignment(assignments, slot.absentTeacherId, slot.p);
    const sub = resolveSubstitute(val, studentTeacherName);
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

