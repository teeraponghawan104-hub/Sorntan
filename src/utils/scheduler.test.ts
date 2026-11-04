import test from "node:test";
import assert from "node:assert/strict";
import {
  TEACHERS,
  INITIAL_TEACHERS,
  DEPARTMENT_GROUPS,
  REGULAR_TEACHERS,
  STUDENT_TEACHERS,
  setRuntimeTeachers,
} from "../data/teachers";
import {
  getDayIndex,
  parseScheduleCell,
  getTeacherClasses,
  getCombinedTeacherClasses,
  getCandidateTeachers,
  autoAssignSubstitutes,
  autoAssignCombinedSubstitutes,
  autoAssignMultipleTeachers,
  buildDocumentRows,
  buildCombinedDocumentRows,
  buildCombinedTeacherHeader,
  formatCleanSubstituteName,
  formatClassLevelLabel,
  getSubjectNameFromCourse,
  formatShortThaiDate,
  formatThaiMonthYearHeader,
  isSchoolAdministrator,
  isTeacherExemptFromNeedingSubstitute,
  isExcludedFromSubstituting,
  extractGradeLevel,
  normalizeClassRoom,
  getTeacherTaughtGrades,
  getTeacherTaughtClassRooms,
  doesTeacherTeachGrade,
  doesTeacherTeachExactClass,
  formatTeacherGradesSummary,
} from "./scheduler";

test("all 31 teachers (27 regular + 4 student teachers) from the 16-page PDF are loaded with 5x7 schedules", () => {
  assert.equal(TEACHERS.length, 31);
  assert.equal(REGULAR_TEACHERS.length, 27);
  assert.equal(STUDENT_TEACHERS.length, 4);
  assert.deepEqual(
    STUDENT_TEACHERS.map((t) => t.id),
    [205, 307, 308, 604]
  );
  assert.ok(DEPARTMENT_GROUPS.includes("บริหาร"));
  assert.ok(DEPARTMENT_GROUPS.includes("ภาษาไทย"));
  assert.ok(DEPARTMENT_GROUPS.includes("คณิตศาสตร์"));
  assert.ok(DEPARTMENT_GROUPS.includes("วิทยาศาสตร์"));
  assert.ok(DEPARTMENT_GROUPS.includes("สังคมศึกษา"));
  assert.ok(DEPARTMENT_GROUPS.includes("พลศึกษา"));
  assert.ok(DEPARTMENT_GROUPS.includes("ศิลปะ"));
  assert.ok(DEPARTMENT_GROUPS.includes("การงานอาชีพ"));
  assert.ok(DEPARTMENT_GROUPS.includes("ภาษาต่างประเทศ"));

  for (const t of TEACHERS) {
    assert.ok(Array.isArray(t.d), `Teacher ${t.id} should have parsed schedule matrix`);
    assert.equal(t.d.length, 5, `Teacher ${t.id} should have 5 days`);
    for (let day = 0; day < 5; day++) {
      assert.equal(t.d[day].length, 7, `Teacher ${t.id} day ${day} should have 7 periods`);
    }
  }
});

test("getDayIndex maps weekdays to 0..4 and weekends to -1", () => {
  assert.equal(getDayIndex("2026-11-02"), 0); // Monday
  assert.equal(getDayIndex("2026-11-03"), 1); // Tuesday
  assert.equal(getDayIndex("2026-11-04"), 2); // Wednesday
  assert.equal(getDayIndex("2026-11-05"), 3); // Thursday
  assert.equal(getDayIndex("2026-11-06"), 4); // Friday
  assert.equal(getDayIndex("2026-11-07"), -1); // Saturday
  assert.equal(getDayIndex("2026-11-08"), -1); // Sunday
});

test("parseScheduleCell parses regular classes, custom rooms, meetings, and activities", () => {
  const reg = parseScheduleCell("ท33102 6/1", "138");
  assert.equal(reg.isTeachable, true);
  assert.equal(reg.code, "ท33102");
  assert.equal(reg.cls, "6/1");
  assert.equal(reg.room, "138");

  const customRoom = parseScheduleCell("ว31102 4/1@ห้องชีวะ", "ห้อง121");
  assert.equal(customRoom.isTeachable, true);
  assert.equal(customRoom.code, "ว31102");
  assert.equal(customRoom.cls, "4/1");
  assert.equal(customRoom.room, "ห้องชีวะ");

  const meeting = parseScheduleCell("*", "138");
  assert.equal(meeting.isMeeting, true);
  assert.equal(meeting.isTeachable, false);

  const supervision = parseScheduleCell("#นิเทศสอน ม.ต้น", "ห้องเรียน");
  assert.equal(supervision.isSupervision, true);
  assert.equal(supervision.isTeachable, false);
});

test("getTeacherClasses excludes meetings and homeroom but includes Period 7 academic classes", () => {
  // Teacher 102 on Tuesday (2026-11-03) has classes in P2 and P3, and meeting (*) in P5
  const tue102 = getTeacherClasses(102, "2026-11-03");
  assert.equal(tue102.length, 2);
  assert.equal(tue102[0].p, 1); // Period 2 (0-indexed 1)
  assert.equal(tue102[1].p, 2); // Period 3 (0-indexed 2)

  // Teacher 203 on Thursday (2026-11-05) has P4 (ค22102 2/2) and P7 (ค31202 4/1)
  const thu203 = getTeacherClasses(203, "2026-11-05");
  assert.equal(thu203.length, 2);
  assert.equal(thu203[0].p, 3); // Period 4
  assert.equal(thu203[1].p, 6); // Period 7
  assert.equal(thu203[1].code, "ค31202");
  assert.equal(thu203[1].cls, "4/1");
});

test("autoAssignSubstitutes and getCandidateTeachers prioritize same grade level first, then subject group", () => {
  // 1) Teacher 201 (คณิตศาสตร์) on Tuesday (2026-11-03): P3 is ค32102 5/1 (Grade 5)
  // Both 203 and 204 are free in คณิตศาสตร์ on Tue P3, but 204 teaches ม.5 (5/1) while 203 only teaches ม.2, ม.4!
  // Therefore 204 (Same Grade ม.5 + Same Group คณิตศาสตร์) MUST be chosen over 203!
  const asg201Tue = autoAssignSubstitutes(201, "2026-11-03");
  assert.equal(asg201Tue[2], "t204");

  const cands201TueP3 = getCandidateTeachers(201, "2026-11-03", 2);
  assert.equal(cands201TueP3[0].id, 204);

  // 2) Teacher 102 (ภาษาไทย) on Monday (2026-11-02): P1 (ท33102 6/1), P2 (ท32102 5/1), P4 (ท32102 5/2)
  // Teacher 103 (ภาษาไทย) only teaches ม.1, ม.3, ม.4 (does NOT teach ม.5 or ม.6).
  // So in P1 (6/1), teachers who teach ม.6 (specifically 6/1, e.g. 301 ครูเมธาวี สายสิน) are prioritized first!
  const asg102Mon = autoAssignSubstitutes(102, "2026-11-02");
  assert.equal(asg102Mon[0], "t301"); // P1 (6/1) -> 301 teaches 6/1 and is free
  assert.equal(asg102Mon[1], "t303"); // P2 (5/1) -> 303 teaches 5/1 and is free
  assert.equal(asg102Mon[3], "t304"); // P4 (5/2) -> 304 teaches 5/2 and has 0 assigned periods so far

  const rows = buildDocumentRows(102, "2026-11-02", asg102Mon, "");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].n, "ครูเมธาวี สายสิน");
  assert.equal(rows[1].n, "ครูสถิตย์ กาทอง");
  assert.equal(rows[2].n, "ครูนิติพงษ์ เหลาทอง");
});

test("getCandidateTeachers excludes teachers in Tuesday Period 5 department head meeting", () => {
  // Tuesday (2026-11-03) Period 5 (index 4): 100, 101, 102, 202, 301, 701, 802 have meeting (*) or supervision
  const cands = getCandidateTeachers(103, "2026-11-03", 4);
  const candIds = cands.map((c) => c.id);
  assert.equal(candIds.includes(102), false);
  assert.equal(candIds.includes(202), false);
  assert.equal(candIds.includes(301), false);
  assert.equal(candIds.includes(701), false);
  assert.equal(candIds.includes(802), false);
});

test("setRuntimeTeachers dynamically adds and removes teachers and prioritizes same grade + same department", () => {
  const newTeacher = {
    id: 104,
    n: "ครูสมหญิง ใจงาม",
    g: "ภาษาไทย",
    pdfGroup: "ภาษาไทย",
    r: "139",
    totalHours: 18,
    coursesSummary: ["ท32102 5/1 [2]"],
    otherSummary: "PLC [5]",
    s: ",,,,,,#ชุมนุม|,,,,,,#ฐาน ศก.|,,,,,,#กิจกรรม|#โฮมรูม,,,,,,#การป้องกันทุจริต|,,,,,,#แนะแนว",
    isStudentTeacher: false,
  };

  setRuntimeTeachers([...INITIAL_TEACHERS, newTeacher]);
  assert.equal(TEACHERS.length, 32);

  // Now on Monday Period 2 (ท32102 5/1), 104 teaches 5/1 (Grade 5) AND is in ภาษาไทย, so 104 is Tier 1!
  const asg = autoAssignSubstitutes(102, "2026-11-02");
  assert.equal(asg[1], "t104");

  // Restore back to 31 initial teachers
  setRuntimeTeachers(INITIAL_TEACHERS);
  assert.equal(TEACHERS.length, 31);
});

test("grade level and classroom helpers accurately extract and match taught grades and rooms", () => {
  assert.equal(extractGradeLevel("2/1"), "2");
  assert.equal(extractGradeLevel("ม.4/2"), "4");
  assert.equal(extractGradeLevel("ม.1"), "1");
  assert.equal(extractGradeLevel("-"), null);

  assert.equal(normalizeClassRoom("2/1"), "2/1");
  assert.equal(normalizeClassRoom("ม.6/2"), "6/2");
  assert.equal(normalizeClassRoom("ม.1"), null);

  const t102 = TEACHERS.find((t) => t.id === 102);
  const t103 = TEACHERS.find((t) => t.id === 103);
  assert.equal(formatTeacherGradesSummary(t102), "ม.2, ม.5, ม.6");
  assert.equal(formatTeacherGradesSummary(t103), "ม.1, ม.3, ม.4");
  assert.equal(doesTeacherTeachGrade(t102, "6/1"), true);
  assert.equal(doesTeacherTeachGrade(t103, "6/1"), false);
  assert.equal(doesTeacherTeachExactClass(t102, "6/1"), true);
  assert.equal(doesTeacherTeachExactClass(t103, "6/1"), false);
  assert.equal( getTeacherTaughtClassRooms(t102).has("5/2"), true);
  assert.equal(getTeacherTaughtGrades(t103).has("3"), true);
});

test("autoAssignMultipleTeachers prevents absent teachers from covering each other and prevents double-booking in the same period", () => {
  const entries = autoAssignMultipleTeachers(
    [
      {
        teacherId: "102",
        reason: "ไปราชการ",
        studentTeacherName: "",
        includeSupervision: false,
        assignments: {},
      },
      {
        teacherId: "103",
        reason: "อบรม/สัมมนา",
        studentTeacherName: "",
        includeSupervision: false,
        assignments: {},
      },
    ],
    "2026-11-02" // Monday
  );

  assert.equal(entries.length, 2);
  const asg102 = entries[0].assignments;
  const asg103 = entries[1].assignments;

  // Neither 102 nor 103 should ever be assigned to cover the other
  for (const v of Object.values(asg102)) {
    assert.notEqual(v, "t102");
    assert.notEqual(v, "t103");
  }
  for (const v of Object.values(asg103)) {
    assert.notEqual(v, "t102");
    assert.notEqual(v, "t103");
  }

  // On Monday Period 2 (0-indexed 1), both 102 and 103 have classes; they must not be assigned the same teacher
  assert.ok(asg102[1]);
  assert.ok(asg103[1]);
  assert.notEqual(asg102[1], asg103[1]);
});

test("autoAssignCombinedSubstitutes and buildCombinedDocumentRows merge multiple absent teachers into ONE single table sorted by period", () => {
  const teacherIds = ["102", "103"];
  const dateStr = "2026-11-02"; // Monday

  const slots = getCombinedTeacherClasses(teacherIds, dateStr);
  // 102 has P1, P2, P4; 103 has P2, P3, P5 -> total 6 classes in the same table
  assert.equal(slots.length, 6);
  assert.deepEqual(
    slots.map((s) => s.p + 1),
    [1, 2, 2, 3, 4, 5]
  );

  const asg = autoAssignCombinedSubstitutes(teacherIds, dateStr);
  // In Period 2 (0-indexed 1), both 102_1 and 103_1 are present and must NOT be assigned the same teacher
  assert.ok(asg["102_1"]);
  assert.ok(asg["103_1"]);
  assert.notEqual(asg["102_1"], asg["103_1"]);

  // Neither 102 nor 103 can be assigned in any slot
  for (const val of Object.values(asg)) {
    assert.notEqual(val, "t102");
    assert.notEqual(val, "t103");
  }

  const rows = buildCombinedDocumentRows(teacherIds, dateStr, asg, "");
  assert.equal(rows.length, 6);
  assert.equal(rows[0].code, "ท33102"); // 102 P1
  assert.equal(rows[1].code, "ท32102"); // 102 P2
  assert.equal(rows[2].code, "ท31102"); // 103 P2
  assert.notEqual(rows[1].n, rows[2].n); // P2 substitutes must be two different teachers

  const header = buildCombinedTeacherHeader(teacherIds);
  assert.ok(header);
  assert.equal(
    header.n,
    "102 ครูรติพงษ์ รักษาพันธุ์, 103 ครูอมรรัตน์ สายเหนือ"
  );
  assert.equal(header.pdfGroup, "ภาษาไทย");
});

test("Image 1 10-column record form formatters produce exact Thai month/year, short date DD/MM/YY, room M.x/y, subject name, and clean substitute name", () => {
  assert.equal(formatThaiMonthYearHeader("2026-05-18"), "ประจำเดือน พฤษภาคม พ.ศ. 2569");
  assert.equal(formatThaiMonthYearHeader("2026-11-02"), "ประจำเดือน พฤศจิกายน พ.ศ. 2569");
  assert.equal(formatShortThaiDate("2026-05-18"), "18/05/69");
  assert.equal(formatShortThaiDate("2026-11-02"), "02/11/69");
  assert.equal(formatClassLevelLabel("1/2"), "ม.1/2");
  assert.equal(formatClassLevelLabel("4/1"), "ม.4/1");
  assert.equal(formatClassLevelLabel("ม.2/1"), "ม.2/1");
  assert.equal(getSubjectNameFromCourse("ท21101", "ภาษาไทย"), "ภาษาไทย");
  assert.equal(getSubjectNameFromCourse("ค32102", "คณิตศาสตร์"), "คณิตศาสตร์พื้นฐาน");
  assert.equal(getSubjectNameFromCourse("ค32202", "คณิตศาสตร์"), "คณิตศาสตร์เพิ่มเติม");
  assert.equal(getSubjectNameFromCourse("ว31222", "เคมี"), "เคมี");
  assert.equal(getSubjectNameFromCourse("ว32204", "ฟิสิกส์"), "ฟิสิกส์");
  assert.equal(getSubjectNameFromCourse("ว31242", "ชีววิทยา"), "ชีววิทยา");
  assert.equal(getSubjectNameFromCourse("ว32102", "วิทยาศาสตร์"), "วิทยาศาสตร์กายภาพ");
  assert.equal(getSubjectNameFromCourse("ว21102", "วิทยาศาสตร์"), "วิทยาศาสตร์พื้นฐาน");
  assert.equal(getSubjectNameFromCourse("ว33282", "วิทยาศาสตร์"), "วิทยาการคำนวณ");
  assert.equal(formatCleanSubstituteName("ครูสุภาวรรณ ปวยทอง (นศ.ฝึกสอน)"), "นางสาวสุภาวรรณ ปวยทอง");
  assert.equal(formatCleanSubstituteName("นายธีระเทพ มัครมย์ (นศ.ฝึกสอน)"), "นายธีระเทพ มัครมย์");
});

test("School administrators (100 ผอ., 101 รอง ผอ., 202 ผู้ช่วย ผอ., and บริหาร group) are strictly excluded from substitute assignment", () => {
  const t100 = TEACHERS.find((t) => t.id === 100);
  const t101 = TEACHERS.find((t) => t.id === 101);
  const t202 = TEACHERS.find((t) => t.id === 202);
  const t102 = TEACHERS.find((t) => t.id === 102);

  assert.equal(isSchoolAdministrator(t100), true);
  assert.equal(isSchoolAdministrator(t101), true);
  assert.equal(isSchoolAdministrator(t202), true);
  assert.equal(isSchoolAdministrator(t102), false);

  // Across all 5 weekdays and all 7 periods, candidate lists must never include administrators
  const testDates = [
    "2026-11-02", // Monday
    "2026-11-03", // Tuesday
    "2026-11-04", // Wednesday
    "2026-11-05", // Thursday
    "2026-11-06", // Friday
  ];

  for (const date of testDates) {
    for (let p = 0; p < 7; p++) {
      const candidates = getCandidateTeachers(102, date, p);
      const candIds = candidates.map((c) => c.id);
      assert.equal(
        candIds.includes(100),
        false,
        `100 (ผอ.) must not be a substitute candidate on ${date} period ${p}`
      );
      assert.equal(
        candIds.includes(101),
        false,
        `101 (รอง ผอ.) must not be a substitute candidate on ${date} period ${p}`
      );
      assert.equal(
        candIds.includes(202),
        false,
        `202 (ผู้ช่วย ผอ.) must not be a substitute candidate on ${date} period ${p}`
      );
    }
  }

  // Also verify autoAssignSubstitutes never assigns administrators
  for (const date of testDates) {
    const asg = autoAssignSubstitutes(102, date);
    for (const val of Object.values(asg)) {
      assert.notEqual(val, "t100");
      assert.notEqual(val, "t101");
      assert.notEqual(val, "t202");
    }
  }
});

test("Teacher 302 (ครูรณสิทธิ์ ประดับศรี) is strictly exempt from needing substitutes and excluded from going to substitute", () => {
  const t302 = TEACHERS.find((t) => t.id === 302);
  assert.ok(t302);
  assert.equal(t302.n, "ครูรณสิทธิ์ ประดับศรี");
  assert.equal(t302.pdfGroup, "ชีววิทยา");

  // 1. isTeacherExemptFromNeedingSubstitute
  assert.equal(isTeacherExemptFromNeedingSubstitute(302), true);
  assert.equal(isTeacherExemptFromNeedingSubstitute("302"), true);
  assert.equal(isTeacherExemptFromNeedingSubstitute(t302), true);
  assert.equal(isTeacherExemptFromNeedingSubstitute(102), false);

  // 2. isExcludedFromSubstituting
  assert.equal(isExcludedFromSubstituting(t302), true);

  // 3. getTeacherClasses for 302 must always return []
  const monClasses = getTeacherClasses(302, "2026-11-02");
  assert.deepEqual(monClasses, []);
  const wedClasses = getTeacherClasses(302, "2026-11-04");
  assert.deepEqual(wedClasses, []);

  // 4. getCombinedTeacherClasses with 302 filters 302 out
  const combined = getCombinedTeacherClasses([302, 102], "2026-11-03");
  for (const slot of combined) {
    assert.notEqual(slot.absentTeacherId, 302);
  }

  // 5. autoAssignSubstitutes for 302 returns empty
  const asg302 = autoAssignSubstitutes(302, "2026-11-02");
  assert.deepEqual(asg302, {});

  // 6. Across all 5 weekdays and all 7 periods, 302 is NEVER in getCandidateTeachers
  const testDates = [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
  ];
  for (const date of testDates) {
    for (let p = 0; p < 7; p++) {
      const candidates = getCandidateTeachers(102, date, p);
      const candIds = candidates.map((c) => c.id);
      assert.equal(
        candIds.includes(302),
        false,
        `Teacher 302 must not be a substitute candidate on ${date} period ${p}`
      );
    }
  }

  // 7. autoAssignCombinedSubstitutes never assigns 302 to any class
  for (const date of testDates) {
    const asg = autoAssignCombinedSubstitutes([102, 103], date);
    for (const val of Object.values(asg)) {
      assert.notEqual(val, "t302");
    }
  }
});

test("chunkSubstituteRows keeps <= 7 rows on a single page and cleanly paginates > 7 rows into multiple pages without cramming", async () => {
  const { chunkSubstituteRows } = await import("./exportDoc");

  const makeFakeRow = (i: number): any => ({
    p: i + 1,
    tm: "08:30-09:20",
    code: `ท2110${i + 1}`,
    cls: "1/1",
    room: "138",
    n: "ครูทดสอบ",
    g: "ภาษาไทย",
  });

  // 1 to 13 rows -> exactly 1 page (fits comfortably on A4 landscape with signatures)
  const rows4 = [makeFakeRow(0), makeFakeRow(1), makeFakeRow(2), makeFakeRow(3)];
  const pages4 = chunkSubstituteRows(rows4);
  assert.equal(pages4.length, 1);
  assert.equal(pages4[0].length, 4);

  const rows13 = Array.from({ length: 13 }, (_, i) => makeFakeRow(i));
  const pages13 = chunkSubstituteRows(rows13);
  assert.equal(pages13.length, 1);
  assert.equal(pages13[0].length, 13);

  // 15 rows -> splits into 2 pages: page 1 fills 13 rows, page 2 has 2 rows + signatures
  const rows15 = Array.from({ length: 15 }, (_, i) => makeFakeRow(i));
  const pages15 = chunkSubstituteRows(rows15);
  assert.equal(pages15.length, 2);
  assert.equal(pages15[0].length, 13);
  assert.equal(pages15[1].length, 2);

  // 18 rows -> 2 pages: page 1 fills 14 rows, page 2 has 4 rows + signatures
  const rows18 = Array.from({ length: 18 }, (_, i) => makeFakeRow(i));
  const pages18 = chunkSubstituteRows(rows18);
  assert.equal(pages18.length, 2);
  assert.equal(pages18[0].length, 14);
  assert.equal(pages18[1].length, 4);
});

test("Teacher 305 (ครูศักดิ์ชัย แสงมาศ) holds ONLY the 13 transferred periods from 302 (ครูรณสิทธิ์ ประดับศรี) with old regular classes cut out", () => {
  const t305 = TEACHERS.find((t) => t.id === 305);
  assert.ok(t305);
  assert.equal(t305.n, "ครูศักดิ์ชัย แสงมาศ");
  assert.equal(t305.r, "ห้องชีวะ");
  assert.equal(t305.totalHours, 20);

  // Monday (2026-11-02): ONLY P3 ว31242 4/1, P4 ว31242 4/1, P5 ว33246 6/1 (old P1, P2, P6 classes cut out)
  const mon305 = getTeacherClasses(305, "2026-11-02");
  assert.equal(mon305.length, 3);
  assert.deepEqual(
    mon305.map((c) => `${c.p + 1}:${c.code}:${c.cls}:${c.room}`),
    [
      "3:ว31242:4/1:ห้องชีวะ",
      "4:ว31242:4/1:ห้องชีวะ",
      "5:ว33246:6/1:ห้องชีวะ",
    ]
  );

  // Verify 305 is NOT in candidate teachers during the 13 transferred biology periods
  const busySlots: [string, number][] = [
    ["2026-11-02", 2], // Mon P3
    ["2026-11-02", 3], // Mon P4
    ["2026-11-02", 4], // Mon P5
    ["2026-11-03", 0], // Tue P1
    ["2026-11-03", 1], // Tue P2
    ["2026-11-03", 4], // Tue P5
    ["2026-11-04", 2], // Wed P3
    ["2026-11-04", 3], // Wed P4
    ["2026-11-05", 2], // Thu P3
    ["2026-11-05", 3], // Thu P4
    ["2026-11-05", 4], // Thu P5
    ["2026-11-06", 0], // Fri P1
    ["2026-11-06", 1], // Fri P2
  ];

  for (const [dateStr, pIdx] of busySlots) {
    const cands = getCandidateTeachers(303, dateStr, pIdx).map((c) => c.id);
    assert.equal(
      cands.includes(305),
      false,
      `305 must NOT be free on ${dateStr} period ${pIdx + 1}`
    );
  }

  // Verify 305 IS free during his former regular class slots (e.g. Mon P1, Mon P2, Mon P6, Tue P3, Tue P4, Tue P6)
  const freeSlots: [string, number][] = [
    ["2026-11-02", 0], // Mon P1
    ["2026-11-02", 1], // Mon P2
    ["2026-11-02", 5], // Mon P6
    ["2026-11-03", 2], // Tue P3
    ["2026-11-03", 3], // Tue P4
    ["2026-11-03", 5], // Tue P6
  ];
  for (const [dateStr, pIdx] of freeSlots) {
    const cands = getCandidateTeachers(303, dateStr, pIdx).map((c) => c.id);
    assert.equal(
      cands.includes(305),
      true,
      `305 SHOULD be free on ${dateStr} period ${pIdx + 1} now that old regular classes are cut`
    );
  }
});

test("System-wide integrity: all course codes resolve to valid Thai subject names and auto-assignment across all 5 weekdays has zero conflicts", () => {
  const weekdays = [
    "2026-11-02", // Mon
    "2026-11-03", // Tue
    "2026-11-04", // Wed
    "2026-11-05", // Thu
    "2026-11-06", // Fri
  ];

  // 1. Verify every teachable course code across all teachers resolves to a valid Thai subject name
  for (const t of TEACHERS) {
    for (let d = 0; d < 5; d++) {
      for (let p = 0; p < 7; p++) {
        const parsed = parseScheduleCell(t.d?.[d]?.[p], t.r);
        if (parsed.isTeachable) {
          const subjectName = getSubjectNameFromCourse(parsed.code, t.pdfGroup, t.id);
          assert.ok(
            subjectName && subjectName !== "-",
            `Course code ${parsed.code} of teacher ${t.id} should resolve to a valid subject name`
          );
        }
      }
    }
  }

  // 2. Verify autoAssignCombinedSubstitutes for every single non-exempt teacher across all 5 weekdays
  for (const t of TEACHERS) {
    if (isTeacherExemptFromNeedingSubstitute(t)) continue;
    for (const dateStr of weekdays) {
      const dayIdx = getDayIndex(dateStr);
      const asg = autoAssignCombinedSubstitutes([t.id], dateStr);
      const rows = buildCombinedDocumentRows([t.id], dateStr, asg, "");
      for (const row of rows) {
        assert.notEqual(row.n, "-", `Teacher ${t.id} on ${dateStr} P${row.p} must have a valid substitute`);
        const slotKey = row.slotKey!;
        const assignedVal = asg[slotKey];
        assert.ok(assignedVal, `Slot ${slotKey} must have an assignment value`);
        if (assignedVal.startsWith("t")) {
          const subId = Number(assignedVal.slice(1));
          assert.notEqual(subId, t.id, "Absent teacher cannot substitute for themselves");
          assert.notEqual(subId, 302, "Exempt teacher 302 cannot substitute");
          assert.notEqual(subId, 100, "Admin 100 cannot substitute");
          assert.notEqual(subId, 101, "Admin 101 cannot substitute");
          assert.notEqual(subId, 202, "Admin 202 cannot substitute");

          const subTeacher = TEACHERS.find((x) => x.id === subId);
          assert.ok(subTeacher, `Substitute teacher ${subId} must exist`);
          const rawCell = subTeacher.d?.[dayIdx]?.[row.p - 1] || "";
          assert.equal(
            rawCell.trim(),
            "",
            `Substitute teacher ${subId} assigned on ${dateStr} P${row.p} must be free in their own schedule`
          );
        }
      }
    }
  }

  // 3. Verify multi-teacher combined assignment (e.g., 305 + 301 + 102 on Monday) has zero double-booking
  const multiIds = [305, 301, 102];
  for (const dateStr of weekdays) {
    const asg = autoAssignCombinedSubstitutes(multiIds, dateStr);
    const slots = getCombinedTeacherClasses(multiIds, dateStr);
    const usedByPeriod: Record<number, Set<string>> = {};
    for (const slot of slots) {
      const val = asg[slot.slotKey];
      assert.ok(val);
      if (val.startsWith("t")) {
        if (!usedByPeriod[slot.p]) usedByPeriod[slot.p] = new Set();
        assert.equal(
          usedByPeriod[slot.p].has(val),
          false,
          `Substitute ${val} must not be double-booked in period ${slot.p + 1} on ${dateStr}`
        );
        usedByPeriod[slot.p].add(val);
      }
    }
  }
});

test("Continuous period (คาบต่อเนื่อง) priority: when a teacher teaches a classroom in period p-1 (e.g. Math) and the period p teacher (e.g. Science) is absent, if the period p-1 teacher is free in period p, they are prioritized #1", async () => {
  const { getContinuousPeriodInfo, doesTeacherTeachPrevPeriodExactClass } = await import("./scheduler");

  // Case 1: Tuesday (2026-11-03) Period 3 -> Period 4 in class 5/1
  // Period 3 (p=2): 201 ครูอำมาลา เกตษา (คณิตศาสตร์) teaches ค32102 5/1, and is FREE in Period 4 (p=3)
  // Period 4 (p=3): 301 ครูเมธาวี สายสิน (ฟิสิกส์/วิทยาศาสตร์) teaches ว32204 5/1
  const t201 = TEACHERS.find((t) => t.id === 201)!;
  assert.equal(doesTeacherTeachPrevPeriodExactClass(t201, "2026-11-03", 3, "5/1"), true);
  const cont201TueP4 = getContinuousPeriodInfo(t201, "2026-11-03", 3, "5/1");
  assert.equal(cont201TueP4.isPrevContinuous, true);
  assert.equal(cont201TueP4.prevPeriodNumber, 3);
  assert.equal(cont201TueP4.prevCourseCode, "ค32102");
  assert.equal(cont201TueP4.prevSubjectName, "คณิตศาสตร์พื้นฐาน");

  const cands301TueP4 = getCandidateTeachers(301, "2026-11-03", 3);
  assert.equal(cands301TueP4[0].id, 201, "201 (Math teacher from P3 in 5/1) must be ranked #1 for 301 (Science P4 in 5/1)");
  const asg301Tue = autoAssignSubstitutes(301, "2026-11-03");
  assert.equal(asg301Tue[2], "t305"); // P3 (4/1): 305 taught ว31102 4/1 in P2 and is free in P3 -> continuous period!
  assert.equal(asg301Tue[3], "t201"); // P4 (5/1): 201 taught ค32102 5/1 in P3 and is free in P4 -> continuous period!

  // Case 2: Friday (2026-11-06) Period 3 -> Period 4 in class 5/1
  // Period 3 (p=2): 204 ครูปฐมาวดี มะโนรัตน์ (คณิตศาสตร์) teaches ค32202-พต 5/1, and is FREE in Period 4 (p=3)
  // Period 4 (p=3): 301 ครูเมธาวี สายสิน (วิทยาศาสตร์) teaches ว32102 5/1
  const t204 = TEACHERS.find((t) => t.id === 204)!;
  assert.equal(doesTeacherTeachPrevPeriodExactClass(t204, "2026-11-06", 3, "5/1"), true);
  const cands301FriP4 = getCandidateTeachers(301, "2026-11-06", 3);
  assert.equal(cands301FriP4[0].id, 204, "204 (Math teacher from P3 in 5/1) must be ranked #1 for 301 (Science P4 in 5/1)");
  const asg301Fri = autoAssignSubstitutes(301, "2026-11-06");
  assert.equal(asg301Fri[2], "t303"); // P3 (4/1): 303 taught ว31222 4/1 in P2 and is free in P3 -> continuous period!
  assert.equal(asg301Fri[3], "t204"); // P4 (5/1): 204 taught ค32202-พต 5/1 in P3 and is free in P4 -> continuous period!
  assert.equal(asg301Fri[4], "t601"); // P5 (5/2): 601 taught ศ23102 5/2 in P4 and is free in P5 -> continuous period!

  // Case 3: Friday (2026-11-06) Period 2 -> Period 3 in class 4/2
  // Period 2 (p=1): 203 ที่ ร.ต.เพ็ง แซ่กัง (คณิตศาสตร์) teaches ค31102 4/2, and is FREE in Period 3 (p=2)
  // Period 3 (p=2): 306 ครูณัฐกร ขุนพันธ์ (วิทยาศาสตร์/คอมพิวเตอร์) teaches ว30274 4/2
  const asg306Fri = autoAssignSubstitutes(306, "2026-11-06");
  assert.equal(asg306Fri[2], "t203"); // P3 (4/2): 203 taught ค31102 4/2 in P2 and is free in P3 -> continuous period!
});







