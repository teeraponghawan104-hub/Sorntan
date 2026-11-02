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
import { OperationType, auth, db, handleFirestoreError } from "../firebase";

const LOCAL_TEACHERS_KEY = "worakhun_teachers_db_v2";
const LOCAL_RECORDS_KEY = "worakhun_sub_records_db_v2";

export interface SavedSubstituteRecord {
  recordId: string;
  absentTeacherId: number;
  absentTeacherName: string;
  absentTeacherGroup: string;
  selectedDate: string;
  reason: string;
  studentTeacherName: string;
  includeSupervision: boolean;
  assignments: Record<number, string>;
  updatedAtIso: string;
}

export function encodeAssignments(assignments: Record<number, string>): string {
  return Object.entries(assignments)
    .filter(([, val]) => Boolean(val))
    .map(([k, v]) => `${k}:${v}`)
    .join(",")
    .slice(0, 400);
}

export function decodeAssignments(assignmentsJson: string): Record<number, string> {
  const result: Record<number, string> = {};
  if (!assignmentsJson) return result;
  assignmentsJson.split(",").forEach((pair) => {
    const [k, v] = pair.split(":");
    const pIdx = Number(k);
    if (!Number.isNaN(pIdx) && v) {
      result[pIdx] = v.trim();
    }
  });
  return result;
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

  // Rebuild s from d if d is provided, otherwise normalize s
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
  const updated = setRuntimeTeachers(teachers.map((t) => sanitizeTeacherPayload(t)));
  try {
    localStorage.setItem(LOCAL_TEACHERS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota errors
  }
  return updated;
}

export function loadLocalSubstituteRecords(): SavedSubstituteRecord[] {
  try {
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
    localStorage.setItem(LOCAL_RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors
  }
}

export function getTeacherDocId(uid: string, teacherId: number): string {
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return `u_${safeUid}_t_${teacherId}`;
}

/**
 * ซิงก์ข้อมูลครู 1 ท่าน (เพิ่มใหม่ หรือ แก้ไข) ลง Firestore และ LocalStorage
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

  const user = auth.currentUser;
  if (user && user.emailVerified) {
    const docId = getTeacherDocId(user.uid, clean.id);
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
          ownerId: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  return savedLocal;
}

/**
 * ลบข้อมูลครูออกจากฐานข้อมูล Firestore และ LocalStorage
 */
export async function removeTeacherFromDatabase(
  teacherId: number,
  currentTeachers: TeacherRecord[]
): Promise<TeacherRecord[]> {
  const nextList = currentTeachers.filter((t) => t.id !== teacherId);
  const savedLocal = saveLocalTeachers(nextList);

  const user = auth.currentUser;
  if (user && user.emailVerified) {
    const docId = getTeacherDocId(user.uid, teacherId);
    const path = `teachers/${docId}`;
    try {
      await deleteDoc(doc(db, "teachers", docId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  return savedLocal;
}

/**
 * ซิงก์ข้อมูลครูทั้งหมดขึ้น Cloud Firestore (หรือกู้คืนค่าเริ่มต้น 31 ท่านจาก PDF)
 */
export async function syncAllTeachersToCloud(
  teachersToSync: TeacherRecord[]
): Promise<TeacherRecord[]> {
  const savedLocal = saveLocalTeachers(teachersToSync);
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    return savedLocal;
  }

  const path = "teachers";
  try {
    const q = query(collection(db, "teachers"), where("ownerId", "==", user.uid));
    const snap = await getDocs(q);
    const existingIds = new Set<string>();
    snap.forEach((d) => existingIds.add(d.id));

    const batch = writeBatch(db);
    const targetDocIds = new Set<string>();

    savedLocal.forEach((t) => {
      const clean = sanitizeTeacherPayload(t);
      const docId = getTeacherDocId(user.uid, clean.id);
      targetDocIds.add(docId);
      const ref = doc(db, "teachers", docId);
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
        ownerId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    // ลบรายการที่ไม่อยู่ในชุดใหม่
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

/**
 * บันทึกหรืออัปเดตใบสอนแทนลงฐานข้อมูล
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
    absentTeacherName: record.absentTeacherName.trim().slice(0, 120) || "-",
    absentTeacherGroup: record.absentTeacherGroup.trim().slice(0, 60) || "-",
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

  const user = auth.currentUser;
  if (user && user.emailVerified) {
    const cloudDocId = `u_${user.uid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}_${cleanRecordId}`.slice(
      0,
      128
    );
    const path = `substitute_records/${cloudDocId}`;
    const docRef = doc(db, "substitute_records", cloudDocId);
    const assignmentsJson = encodeAssignments(updatedItem.assignments);

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
          recordId: cloudDocId,
          absentTeacherId: updatedItem.absentTeacherId,
          absentTeacherName: updatedItem.absentTeacherName,
          absentTeacherGroup: updatedItem.absentTeacherGroup,
          selectedDate: updatedItem.selectedDate,
          reason: updatedItem.reason,
          studentTeacherName: updatedItem.studentTeacherName,
          includeSupervision: Boolean(updatedItem.includeSupervision),
          assignmentsJson,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  return nextRecords;
}

/**
 * ลบประวัติใบสอนแทนออกจากฐานข้อมูล
 */
export async function removeSubstituteRecordFromDatabase(
  recordId: string,
  currentRecords: SavedSubstituteRecord[]
): Promise<SavedSubstituteRecord[]> {
  const nextRecords = currentRecords.filter((r) => r.recordId !== recordId);
  saveLocalSubstituteRecords(nextRecords);

  const user = auth.currentUser;
  if (user && user.emailVerified) {
    const cleanId = recordId.startsWith(`u_${user.uid.slice(0, 10)}`)
      ? recordId
      : `u_${user.uid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}_${recordId}`.slice(0, 128);
    const path = `substitute_records/${cleanId}`;
    try {
      await deleteDoc(doc(db, "substitute_records", cleanId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }

  return nextRecords;
}
