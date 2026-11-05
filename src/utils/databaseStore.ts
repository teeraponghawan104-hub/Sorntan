import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  INITIAL_TEACHERS,
  TeacherRecord,
  hydrateTeacherSchedule,
  setRuntimeTeachers,
} from "../data/teachers";
import { setRuntimeSubjectMappings } from "./scheduler";
import {
  DEFAULT_DOCUMENT_SIGNATORIES,
  setRuntimeDocumentSignatories,
} from "./exportDoc";
import { OperationType, db, handleFirestoreError } from "../firebase";

const LOCAL_TEACHERS_KEY = "worakhun_teachers_db_v4";
const LOCAL_RECORDS_KEY = "worakhun_sub_records_db_v2";
const LOCAL_PLANNER_STATE_KEY = "worakhun_live_planner_v4";
const LOCAL_SUBJECT_MAPPINGS_KEY = "worakhun_subject_mappings_v2";
const LOCAL_ACADEMIC_SETTINGS_KEY = "worakhun_academic_settings_v1";

export const SHARED_OWNER_ID = "worakhun_shared";
export const LIVE_WORKSPACE_DOC_ID = "live_workspace";
export const SUBJECT_MAPPINGS_DOC_ID = "custom";
export const ACADEMIC_SETTINGS_DOC_ID = "academic_settings";

export interface AcademicSettings {
  academicYear: string;      // เช่น "2569", "2570"
  semester: string;          // เช่น "1", "2"
  plannerName: string;       // ชื่อผู้จัดสอนแทน เช่น "นายธีระพงษ์ หาวัน"
  plannerPosition: string;   // ตำแหน่งผู้จัดสอนแทน เช่น "งานการจัดการเรียนการสอน"
  approverName: string;      // ชื่อหัวหน้ากลุ่มบริหารวิชาการ เช่น "นายสุทธิศักดิ์ เกตษา"
  approverPosition: string;  // ตำแหน่งหัวหน้ากลุ่มบริหารวิชาการ เช่น "ผู้ช่วยผู้อำนวยการโรงเรียนวรคุณอุปถัมภ์"
}

export const DEFAULT_ACADEMIC_SETTINGS: AcademicSettings = {
  academicYear: "2569",
  semester: "2",
  plannerName: DEFAULT_DOCUMENT_SIGNATORIES.plannerName,
  plannerPosition: DEFAULT_DOCUMENT_SIGNATORIES.plannerPosition,
  approverName: DEFAULT_DOCUMENT_SIGNATORIES.approverName,
  approverPosition: DEFAULT_DOCUMENT_SIGNATORIES.approverPosition,
};

export interface SavedSubstituteRecord {
  recordId: string;
  absentTeacherId: number;
  absentTeacherIds?: string[];
  absentTeacherName: string;
  absentTeacherGroup: string;
  selectedDate: string;
  reason: string;
  studentTeacherName: string;
  includeSupervision: boolean;
  assignments: Record<string, string>;
  updatedAtIso: string;
}

export interface LivePlannerWorkspaceState {
  absentTeacherIds: string[];
  selectedDate: string;
  reason: string;
  studentTeacherName: string;
  includeSupervision: boolean;
  assignments: Record<string, string>;
  clientWriteId?: string;
}

export function encodeAssignments(
  assignments: Record<string, string>,
  absentTeacherIds?: string[],
  clientWriteId?: string
): string {
  const parts: string[] = [];
  if (absentTeacherIds && absentTeacherIds.length > 0) {
    parts.push(`_t:${absentTeacherIds.join("+")}`);
  }
  if (clientWriteId) {
    parts.push(`_c:${clientWriteId.replace(/[,:|]/g, "")}`);
  }
  Object.entries(assignments).forEach(([k, v]) => {
    if (k !== "_t" && k !== "_c" && v) {
      parts.push(`${k}:${v}`);
    }
  });
  return parts.join(",").slice(0, 2000);
}

export function decodeAssignments(assignmentsJson: string): {
  assignments: Record<string, string>;
  absentTeacherIds?: string[];
  clientWriteId?: string;
} {
  const assignments: Record<string, string> = {};
  let absentTeacherIds: string[] | undefined;
  let clientWriteId: string | undefined;
  if (!assignmentsJson) return { assignments };
  assignmentsJson.split(",").forEach((pair) => {
    const [k, v] = pair.split(":");
    if (!k || !v) return;
    const cleanKey = k.trim();
    const cleanVal = v.trim();
    if (cleanKey === "_t") {
      absentTeacherIds = cleanVal.split("+").filter(Boolean);
    } else if (cleanKey === "_c") {
      clientWriteId = cleanVal;
    } else {
      assignments[cleanKey] = cleanVal;
    }
  });
  return { assignments, absentTeacherIds, clientWriteId };
}

/**
 * Sanitize teacher payload to strictly adhere to firebase-blueprint.json & firestore.rules
 */
export function sanitizeTeacherPayload(raw: TeacherRecord): TeacherRecord {
  const cleanId = Math.max(1, Math.min(99999, Math.round(Number(raw.id) || 100)));
  const cleanName = (raw.n || "").trim().slice(0, 120) || `ครูรหัส ${cleanId}`;
  const cleanGroup = (raw.g || "").trim().slice(0, 60) || "ภาษาไทย";
  const cleanPdfGroup = (raw.pdfGroup || cleanGroup).trim().slice(0, 60) || cleanGroup;
  const cleanRoom = (raw.r || "-").trim().slice(0, 60) || "-";
  const cleanHours = Math.max(0, Math.min(60, Math.round(Number(raw.totalHours) || 0)));
  const cleanCourses = (Array.isArray(raw.coursesSummary) ? raw.coursesSummary : [])
    .map((line) => String(line || "").trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 15);
  const cleanOther = String(raw.otherSummary || "").trim().slice(0, 300);

  let scheduleStr = raw.s || "";
  if (Array.isArray(raw.d) && raw.d.length === 5) {
    scheduleStr = raw.d
      .map((dayRow) => {
        const padded = [...(dayRow || [])];
        while (padded.length < 7) padded.push("");
        return padded
          .slice(0, 7)
          .map((c) => String(c || "").replace(/[|,]/g, " ").trim())
          .join(",");
      })
      .join("|");
  }
  scheduleStr = scheduleStr.slice(0, 1200);

  return hydrateTeacherSchedule({
    id: cleanId,
    n: cleanName,
    g: cleanGroup,
    pdfGroup: cleanPdfGroup,
    r: cleanRoom,
    totalHours: cleanHours,
    coursesSummary: cleanCourses,
    otherSummary: cleanOther,
    s: scheduleStr,
    isStudentTeacher: Boolean(raw.isStudentTeacher),
  });
}

export function loadLocalTeachers(): TeacherRecord[] {
  try {
    if (typeof localStorage === "undefined") {
      return setRuntimeTeachers(INITIAL_TEACHERS);
    }
    const raw = localStorage.getItem(LOCAL_TEACHERS_KEY);
    if (!raw) {
      return setRuntimeTeachers(INITIAL_TEACHERS);
    }
    const parsed = JSON.parse(raw) as TeacherRecord[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return setRuntimeTeachers(INITIAL_TEACHERS);
    }
    return setRuntimeTeachers(parsed.map((t) => sanitizeTeacherPayload(t)));
  } catch {
    return setRuntimeTeachers(INITIAL_TEACHERS);
  }
}

export function saveLocalTeachers(teachers: TeacherRecord[]): TeacherRecord[] {
  const updated = setRuntimeTeachers(
    teachers.map((t) => sanitizeTeacherPayload(t)).sort((a, b) => a.id - b.id)
  );
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCAL_TEACHERS_KEY, JSON.stringify(updated));
    }
  } catch {
    // Ignore storage quota errors
  }
  return updated;
}

export function loadLocalSubstituteRecords(): SavedSubstituteRecord[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(LOCAL_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedSubstituteRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalSubstituteRecords(records: SavedSubstituteRecord[]): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCAL_RECORDS_KEY, JSON.stringify(records));
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLocalPlannerState(): LivePlannerWorkspaceState | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LOCAL_PLANNER_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LivePlannerWorkspaceState;
    if (
      !parsed ||
      !Array.isArray(parsed.absentTeacherIds) ||
      typeof parsed.selectedDate !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalPlannerState(state: LivePlannerWorkspaceState): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCAL_PLANNER_STATE_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLocalSubjectMappings(): Record<string, string> {
  try {
    if (typeof localStorage === "undefined") {
      setRuntimeSubjectMappings({});
      return {};
    }
    const raw = localStorage.getItem(LOCAL_SUBJECT_MAPPINGS_KEY);
    if (!raw) {
      setRuntimeSubjectMappings({});
      return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      setRuntimeSubjectMappings(parsed);
      return parsed;
    }
    setRuntimeSubjectMappings({});
    return {};
  } catch {
    setRuntimeSubjectMappings({});
    return {};
  }
}

export function saveLocalSubjectMappings(
  mappings: Record<string, string>
): Record<string, string> {
  setRuntimeSubjectMappings(mappings);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCAL_SUBJECT_MAPPINGS_KEY, JSON.stringify(mappings));
    }
  } catch {
    // Ignore storage quota errors
  }
  return mappings;
}

export async function saveSubjectMappingsToCloud(
  mappings: Record<string, string>
): Promise<Record<string, string>> {
  saveLocalSubjectMappings(mappings);

  const path = `subject_mappings/${SUBJECT_MAPPINGS_DOC_ID}`;
  const docRef = doc(db, "subject_mappings", SUBJECT_MAPPINGS_DOC_ID);
  const mappingsJson = JSON.stringify(mappings).slice(0, 5000);

  await enqueueCloudWrite(async () => {
    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        await updateDoc(docRef, {
          mappingsJson,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(docRef, {
          recordId: SUBJECT_MAPPINGS_DOC_ID,
          mappingsJson,
          ownerId: SHARED_OWNER_ID,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  });

  return mappings;
}

export function getTeacherDocId(teacherId: number): string {
  return `t_${Math.max(1, Math.min(99999, Math.round(Number(teacherId) || 100)))}`;
}

/**
 * ซิงก์ข้อมูลครู 1 ท่าน (เพิ่มใหม่ หรือ แก้ไข) ลง Firestore ฐานข้อมูลกลาง และ LocalStorage ทันทีโดยไม่ต้องล็อกอิน
 */
export async function upsertTeacherInDatabase(
  teacher: TeacherRecord,
  currentTeachers: TeacherRecord[]
): Promise<TeacherRecord[]> {
  const clean = sanitizeTeacherPayload(teacher);
  const nextList = [
    ...currentTeachers.filter((t) => t.id !== clean.id),
    clean,
  ].sort((a, b) => a.id - b.id);

  const savedLocal = saveLocalTeachers(nextList);

  const docId = getTeacherDocId(clean.id);
  const path = `teachers/${docId}`;
  const docRef = doc(db, "teachers", docId);
  try {
    const existingSnap = await getDoc(docRef);
    if (existingSnap.exists()) {
      await updateDoc(docRef, {
        id: clean.id,
        n: clean.n,
        g: clean.g,
        pdfGroup: clean.pdfGroup,
        r: clean.r,
        totalHours: clean.totalHours,
        coursesSummary: clean.coursesSummary,
        otherSummary: clean.otherSummary,
        s: clean.s,
        isStudentTeacher: Boolean(clean.isStudentTeacher),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(docRef, {
        id: clean.id,
        n: clean.n,
        g: clean.g,
        pdfGroup: clean.pdfGroup,
        r: clean.r,
        totalHours: clean.totalHours,
        coursesSummary: clean.coursesSummary,
        otherSummary: clean.otherSummary,
        s: clean.s,
        isStudentTeacher: Boolean(clean.isStudentTeacher),
        ownerId: SHARED_OWNER_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }

  return savedLocal;
}

/**
 * ลบข้อมูลครูออกจากฐานข้อมูลกลาง Firestore และ LocalStorage ทันทีโดยไม่ต้องล็อกอิน
 */
export async function removeTeacherFromDatabase(
  teacherId: number,
  currentTeachers: TeacherRecord[]
): Promise<TeacherRecord[]> {
  const nextList = currentTeachers.filter((t) => t.id !== teacherId);
  const savedLocal = saveLocalTeachers(nextList);

  const docId = getTeacherDocId(teacherId);
  const path = `teachers/${docId}`;
  try {
    await deleteDoc(doc(db, "teachers", docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }

  return savedLocal;
}

/**
 * ซิงก์ข้อมูลครูทั้งหมดขึ้น Cloud Firestore ฐานข้อมูลกลาง (หรือกู้คืนค่าเริ่มต้น 31 ท่านจาก PDF)
 */
export async function syncAllTeachersToCloud(
  teachersToSync: TeacherRecord[]
): Promise<TeacherRecord[]> {
  const savedLocal = saveLocalTeachers(teachersToSync);

  const path = "teachers";
  try {
    const q = query(
      collection(db, "teachers"),
      where("ownerId", "==", SHARED_OWNER_ID)
    );
    const snap = await getDocs(q);
    const existingIds = new Set<string>();
    snap.forEach((d) => existingIds.add(d.id));

    const batch = writeBatch(db);
    const targetDocIds = new Set<string>();

    savedLocal.forEach((t) => {
      const clean = sanitizeTeacherPayload(t);
      const docId = getTeacherDocId(clean.id);
      targetDocIds.add(docId);
      const ref = doc(db, "teachers", docId);
      if (existingIds.has(docId)) {
        batch.update(ref, {
          id: clean.id,
          n: clean.n,
          g: clean.g,
          pdfGroup: clean.pdfGroup,
          r: clean.r,
          totalHours: clean.totalHours,
          coursesSummary: clean.coursesSummary,
          otherSummary: clean.otherSummary,
          s: clean.s,
          isStudentTeacher: Boolean(clean.isStudentTeacher),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(ref, {
          id: clean.id,
          n: clean.n,
          g: clean.g,
          pdfGroup: clean.pdfGroup,
          r: clean.r,
          totalHours: clean.totalHours,
          coursesSummary: clean.coursesSummary,
          otherSummary: clean.otherSummary,
          s: clean.s,
          isStudentTeacher: Boolean(clean.isStudentTeacher),
          ownerId: SHARED_OWNER_ID,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });

    existingIds.forEach((oldDocId) => {
      if (!targetDocIds.has(oldDocId)) {
        batch.delete(doc(db, "teachers", oldDocId));
      }
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }

  return savedLocal;
}

let cloudWriteChain: Promise<void> = Promise.resolve();

function enqueueCloudWrite(task: () => Promise<void>): Promise<void> {
  const next = cloudWriteChain.then(task, task);
  cloudWriteChain = next.catch(() => {});
  return next;
}

/**
 * บันทึกหรืออัปเดตสถานะตารางจัดสอนแทนปัจจุบันลง Cloud Firestore อัตโนมัติ เพื่อให้ทุกคนเห็นตรงกันแบบเรียลไทม์
 */
export async function saveLiveWorkspaceToCloud(
  state: LivePlannerWorkspaceState,
  headerInfo?: { id: number; n: string; pdfGroup: string } | null
): Promise<void> {
  saveLocalPlannerState(state);

  const absentTeacherId = Math.max(
    1,
    Math.min(
      99999,
      Math.round(Number(headerInfo?.id || state.absentTeacherIds[0] || 102))
    )
  );
  const absentTeacherName = (headerInfo?.n || `ครูรหัส ${absentTeacherId}`)
    .trim()
    .slice(0, 300) || "-";
  const absentTeacherGroup = (headerInfo?.pdfGroup || "ภาษาไทย")
    .trim()
    .slice(0, 150) || "-";
  const selectedDate = (state.selectedDate || "2026-11-02").trim().slice(0, 20);
  const reason = (state.reason || "ไปราชการ").trim().slice(0, 200) || "ไปราชการ";
  const studentTeacherName = (state.studentTeacherName || "").trim().slice(0, 120);
  const assignmentsJson = encodeAssignments(
    state.assignments,
    state.absentTeacherIds,
    state.clientWriteId
  );

  const path = `substitute_records/${LIVE_WORKSPACE_DOC_ID}`;
  const docRef = doc(db, "substitute_records", LIVE_WORKSPACE_DOC_ID);
  await enqueueCloudWrite(async () => {
    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        await updateDoc(docRef, {
          absentTeacherId,
          absentTeacherName,
          absentTeacherGroup,
          selectedDate,
          reason,
          studentTeacherName,
          includeSupervision: Boolean(state.includeSupervision),
          assignmentsJson,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(docRef, {
          recordId: LIVE_WORKSPACE_DOC_ID,
          absentTeacherId,
          absentTeacherName,
          absentTeacherGroup,
          selectedDate,
          reason,
          studentTeacherName,
          includeSupervision: Boolean(state.includeSupervision),
          assignmentsJson,
          ownerId: SHARED_OWNER_ID,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  });
}

/**
 * บันทึกหรืออัปเดตใบสอนแทนลงฐานข้อมูลกลางโดยไม่ต้องล็อกอิน
 */
export async function upsertSubstituteRecordInDatabase(
  record: Omit<SavedSubstituteRecord, "updatedAtIso">,
  currentRecords: SavedSubstituteRecord[]
): Promise<SavedSubstituteRecord[]> {
  const cleanRecordId =
    record.recordId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120) ||
    `rec_${record.absentTeacherId}_${record.selectedDate.replace(/[^0-9]/g, "")}`;

  const updatedItem: SavedSubstituteRecord = {
    ...record,
    recordId: cleanRecordId,
    absentTeacherName: record.absentTeacherName.trim().slice(0, 300) || "-",
    absentTeacherGroup: record.absentTeacherGroup.trim().slice(0, 150) || "-",
    selectedDate: record.selectedDate.trim().slice(0, 20),
    reason: (record.reason || "ไปราชการ").trim().slice(0, 200) || "ไปราชการ",
    studentTeacherName: (record.studentTeacherName || "").trim().slice(0, 120),
    updatedAtIso: new Date().toISOString(),
  };

  const nextRecords = [
    updatedItem,
    ...currentRecords.filter((r) => r.recordId !== cleanRecordId),
  ];
  saveLocalSubstituteRecords(nextRecords);

  const path = `substitute_records/${cleanRecordId}`;
  const docRef = doc(db, "substitute_records", cleanRecordId);
  const assignmentsJson = encodeAssignments(
    updatedItem.assignments,
    updatedItem.absentTeacherIds
  );

  await enqueueCloudWrite(async () => {
    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        await updateDoc(docRef, {
          absentTeacherId: updatedItem.absentTeacherId,
          absentTeacherName: updatedItem.absentTeacherName,
          absentTeacherGroup: updatedItem.absentTeacherGroup,
          selectedDate: updatedItem.selectedDate,
          reason: updatedItem.reason,
          studentTeacherName: updatedItem.studentTeacherName,
          includeSupervision: Boolean(updatedItem.includeSupervision),
          assignmentsJson,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(docRef, {
          recordId: cleanRecordId,
          absentTeacherId: updatedItem.absentTeacherId,
          absentTeacherName: updatedItem.absentTeacherName,
          absentTeacherGroup: updatedItem.absentTeacherGroup,
          selectedDate: updatedItem.selectedDate,
          reason: updatedItem.reason,
          studentTeacherName: updatedItem.studentTeacherName,
          includeSupervision: Boolean(updatedItem.includeSupervision),
          assignmentsJson,
          ownerId: SHARED_OWNER_ID,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  });

  return nextRecords;
}

/**
 * ลบประวัติใบสอนแทนออกจากฐานข้อมูลกลางโดยไม่ต้องล็อกอิน
 */
export async function removeSubstituteRecordFromDatabase(
  recordId: string,
  currentRecords: SavedSubstituteRecord[]
): Promise<SavedSubstituteRecord[]> {
  const cleanId = recordId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
  const nextRecords = currentRecords.filter((r) => r.recordId !== cleanId);
  saveLocalSubstituteRecords(nextRecords);

  const path = `substitute_records/${cleanId}`;
  try {
    await deleteDoc(doc(db, "substitute_records", cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }

  return nextRecords;
}

/**
 * ล้างประวัติใบสอนแทนทั้งหมด (สำหรับเริ่มต้นภาคเรียน / ปีการศึกษาใหม่)
 */
export async function clearAllSubstituteRecordsFromDatabase(
  currentRecords: SavedSubstituteRecord[]
): Promise<SavedSubstituteRecord[]> {
  saveLocalSubstituteRecords([]);

  const path = "substitute_records";
  try {
    const batch = writeBatch(db);
    currentRecords.forEach((rec) => {
      const cleanId = rec.recordId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
      if (cleanId && cleanId !== LIVE_WORKSPACE_DOC_ID) {
        batch.delete(doc(db, "substitute_records", cleanId));
      }
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }

  return [];
}

/**
 * ตรวจสอบความถูกต้องของค่าตั้งต้นปีการศึกษาและภาคเรียน
 */
export function sanitizeAcademicSettings(
  raw?: Partial<AcademicSettings> | null
): AcademicSettings {
  const rawYear = String(raw?.academicYear || "").trim();
  const parsedYear = parseInt(rawYear, 10);
  const cleanYear =
    Number.isFinite(parsedYear) && parsedYear >= 2500 && parsedYear <= 2699
      ? String(parsedYear)
      : DEFAULT_ACADEMIC_SETTINGS.academicYear;

  const rawSemester = String(raw?.semester || "").trim();
  const cleanSemester =
    rawSemester === "1" || rawSemester === "2" || rawSemester === "ฤดูร้อน"
      ? rawSemester
      : DEFAULT_ACADEMIC_SETTINGS.semester;

  const sig = setRuntimeDocumentSignatories({
    plannerName: raw?.plannerName,
    plannerPosition: raw?.plannerPosition,
    approverName: raw?.approverName,
    approverPosition: raw?.approverPosition,
  });

  return {
    academicYear: cleanYear,
    semester: cleanSemester,
    plannerName: sig.plannerName,
    plannerPosition: sig.plannerPosition,
    approverName: sig.approverName,
    approverPosition: sig.approverPosition,
  };
}

export function loadLocalAcademicSettings(): AcademicSettings {
  try {
    if (typeof localStorage === "undefined") {
      return sanitizeAcademicSettings(DEFAULT_ACADEMIC_SETTINGS);
    }
    const raw = localStorage.getItem(LOCAL_ACADEMIC_SETTINGS_KEY);
    if (!raw) {
      return sanitizeAcademicSettings(DEFAULT_ACADEMIC_SETTINGS);
    }
    const parsed = JSON.parse(raw) as Partial<AcademicSettings>;
    return sanitizeAcademicSettings(parsed);
  } catch {
    return sanitizeAcademicSettings(DEFAULT_ACADEMIC_SETTINGS);
  }
}

export function saveLocalAcademicSettings(
  settings: Partial<AcademicSettings>
): AcademicSettings {
  const clean = sanitizeAcademicSettings(settings);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCAL_ACADEMIC_SETTINGS_KEY, JSON.stringify(clean));
    }
  } catch {
    // Ignore storage quota errors
  }
  return clean;
}

/**
 * บันทึกปีการศึกษาและภาคเรียนลง Cloud Firestore เพื่อให้ทุกเครื่องเห็นตรงกันแบบเรียลไทม์
 */
export async function saveAcademicSettingsToCloud(
  settings: Partial<AcademicSettings>
): Promise<AcademicSettings> {
  const clean = saveLocalAcademicSettings(settings);
  const path = `subject_mappings/${ACADEMIC_SETTINGS_DOC_ID}`;
  const docRef = doc(db, "subject_mappings", ACADEMIC_SETTINGS_DOC_ID);
  const mappingsJson = JSON.stringify(clean).slice(0, 5000);

  await enqueueCloudWrite(async () => {
    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        await updateDoc(docRef, {
          mappingsJson,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(docRef, {
          recordId: ACADEMIC_SETTINGS_DOC_ID,
          mappingsJson,
          ownerId: SHARED_OWNER_ID,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  });

  return clean;
}

