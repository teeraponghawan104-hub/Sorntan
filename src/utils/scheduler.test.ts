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

test("getTeacherClasses excludes meetings, homeroom, and student-teacher co-taught classes, while including Period 7 academic classes", () => {
  // Teacher 102 on Tuesday (2026-11-03) has classes in P2 and P3, and meeting (*) in P5
  const tue102 = getTeacherClasses(102, "2026-11-03");
  assert.equal(tue102.length, 2);
  assert.equal(tue102[0].p, 1); // Period 2 (0-indexed 1)
  assert.equal(tue102[1].p, 2); // Period 3 (0-indexed 2)

  // Teacher 203 on Thursday (2026-11-05) has P4 (ค22102 2/2 - taught by student teacher 205) and P7 (ค31202 4/1)
  // P4 (ค22102 2/2) is excluded because student teacher 205 teaches it; P7 (ค31202 4/1) is included!
  const thu203 = getTeacherClasses(203, "2026-11-05");
  assert.equal(thu203.length, 1);
  assert.equal(thu203[0].p, 6); // Period 7
  assert.equal(thu203[0].code, "ค31202");
  assert.equal(thu203[0].cls, "4/1");
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

test("Word (.docx) export generates quickly, produces a compact file (< 200 KB), and has valid OpenXML layout matching the preview", async () => {
  const JSZip = (await import("jszip")).default;
  const { generateDocxBlob } = await import("./exportDoc");

  const t308 = TEACHERS.find((t) => t.id === 308)!;
  const dateStr = "2026-11-04";
  const asg = autoAssignCombinedSubstitutes([308], dateStr);
  const rows = buildCombinedDocumentRows([308], dateStr, asg, "");

  const startMs = Date.now();
  const blob = await generateDocxBlob(t308, dateStr, "ไปราชการ", rows);
  const elapsedMs = Date.now() - startMs;

  assert.ok(elapsedMs < 500, `Word generation should be fast (< 500ms), took ${elapsedMs}ms`);
  assert.ok(
    blob.size > 1000 && blob.size < 200 * 1024,
    `Word file size should be compact (< 200 KB), got ${(blob.size / 1024).toFixed(1)} KB`
  );

  const buf = Buffer.from(await blob.arrayBuffer());
  const zip = await JSZip.loadAsync(buf);

  const docXml = await zip.file("word/document.xml")!.async("string");
  const stylesXml = await zip.file("word/styles.xml")!.async("string");
  const settingsXml = await zip.file("word/settings.xml")!.async("string");
  const fontTableXml = await zip.file("word/fontTable.xml")!.async("string");

  assert.ok(stylesXml.includes('w:ascii="TH SarabunPSK"'));
  assert.ok(settingsXml.includes("compatibilityMode"));
  assert.ok(fontTableXml.includes('w:name="TH SarabunPSK"'));
  assert.ok(fontTableXml.includes('w:altName w:val="TH Sarabun New'));

  // Verify no <w:noWrap/> that could distort fixed column widths
  assert.equal(docXml.includes("<w:noWrap/>"), false);

  // Verify all 3 tables (header 5 cols, main 10 cols, signature 5 cols) have matching <w:gridCol> and <w:tc> counts
  const tables = docXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
  assert.equal(tables.length, 3, "Single-page document must have 3 tables (header, 10-col data, signature)");

  const expectedCols = [5, 10, 5];
  tables.forEach((tblXml, idx) => {
    const gridCols = tblXml.match(/<w:gridCol\b/g) || [];
    assert.equal(
      gridCols.length,
      expectedCols[idx],
      `Table ${idx} must have ${expectedCols[idx]} <w:gridCol> elements`
    );
    const trList = tblXml.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || [];
    for (const trXml of trList) {
      const tcList = trXml.match(/<w:tc>/g) || [];
      assert.equal(
        tcList.length,
        expectedCols[idx],
        `Every <w:tr> in table ${idx} must have ${expectedCols[idx]} <w:tc> cells`
      );
    }
  });

  // Verify long subject "วิทยาศาสตร์ชีวภาพ" has auto-fitted font size (< 32 half-points)
  assert.ok(docXml.includes("วิทยาศาสตร์ชีวภาพ"));
  const bioCellMatch = docXml.match(/<w:rPr>[^<]*<w:rFonts[^>]*\/>(?:<w:b\/><w:bCs\/>)?<w:sz w:val="(\d+)"\/><w:szCs w:val="\d+"\/><\/w:rPr><w:t[^>]*>วิทยาศาสตร์ชีวภาพ<\/w:t>/);
  assert.ok(bioCellMatch, "Must find run for วิทยาศาสตร์ชีวภาพ");
  assert.ok(Number(bioCellMatch[1]) < 32, `Long subject font size must auto-fit (< 32), got ${bioCellMatch[1]}`);
});

test("adjustDateToAcademicYear shifts date to target Buddhist Era year and ensures a valid Mon-Fri weekday", async () => {
  const { adjustDateToAcademicYear, formatThaiMonthYearHeader, formatShortThaiDate } = await import(
    "./scheduler"
  );

  // 2026-11-04 (Wed, B.E. 2569) -> B.E. 2570 (2027-11-04 is Thu)
  const date2570 = adjustDateToAcademicYear("2026-11-04", "2570");
  assert.equal(date2570, "2027-11-04");
  assert.ok(getDayIndex(date2570) >= 0 && getDayIndex(date2570) <= 4);
  assert.equal(formatThaiMonthYearHeader(date2570), "ประจำเดือน พฤศจิกายน พ.ศ. 2570");
  assert.equal(formatShortThaiDate(date2570), "04/11/70");

  // 2026-11-04 -> B.E. 2571 (2028-11-04 is Saturday -> shifts to Monday 2028-11-06)
  const date2571 = adjustDateToAcademicYear("2026-11-04", "2571");
  assert.equal(date2571, "2028-11-06");
  assert.equal(getDayIndex(date2571), 0); // Monday
  assert.equal(formatThaiMonthYearHeader(date2571), "ประจำเดือน พฤศจิกายน พ.ศ. 2571");
  assert.equal(formatShortThaiDate(date2571), "06/11/71");
});

test("Bulk subject & course code tools: parseBulkSubjectLines, exportSubjectsToCsv, renameCourseCodesInTeachers, and buildSemesterCourseCodeShiftMap", async () => {
  const {
    parseBulkSubjectLines,
    exportSubjectsToCsv,
    getAllDiscoveredSubjectCodes,
    renameCourseCodesInTeachers,
    buildSemesterCourseCodeShiftMap,
  } = await import("./scheduler");

  // 1. Test Excel tab-separated, CSV, =, and arrow course code renames in one block
  const bulkInput = [
    "รหัสวิชา\tชื่อวิชาที่แสดงในเอกสาร",
    "ว21102\tวิทยาศาสตร์และเทคโนโลยี 2",
    "ค31102 = คณิตศาสตร์พื้นฐาน ม.4",
    "ท21102,ภาษาไทยพื้นฐาน 2",
    "ว31242 -> ว31241 = ชีววิทยาเพิ่มเติม 1",
    "อ21102\tอ21101\tภาษาอังกฤษพื้นฐาน 1",
  ].join("\n");

  const parsed = parseBulkSubjectLines(bulkInput);
  assert.equal(parsed.mappingCount, 5);
  assert.equal(parsed.renameCount, 2);
  assert.equal(parsed.mappings["ว21102"], "วิทยาศาสตร์และเทคโนโลยี 2");
  assert.equal(parsed.mappings["ค31102"], "คณิตศาสตร์พื้นฐาน ม.4");
  assert.equal(parsed.mappings["ท21102"], "ภาษาไทยพื้นฐาน 2");
  assert.equal(parsed.mappings["ว31241"], "ชีววิทยาเพิ่มเติม 1");
  assert.equal(parsed.mappings["อ21101"], "ภาษาอังกฤษพื้นฐาน 1");
  assert.equal(parsed.codeRenames["ว31242"], "ว31241");
  assert.equal(parsed.codeRenames["อ21102"], "อ21101");

  // 2. Test CSV export round-trip
  const subjects = getAllDiscoveredSubjectCodes();
  const csv = exportSubjectsToCsv(subjects);
  assert.ok(csv.startsWith("\uFEFFรหัสวิชา,"));
  const roundTrip = parseBulkSubjectLines(csv);
  assert.equal(roundTrip.mappingCount, subjects.length);

  // 3. Test renaming course codes in teachers' timetables
  const { updatedTeachers, replacedSlotCount, affectedTeachersCount } =
    renameCourseCodesInTeachers(INITIAL_TEACHERS, { ว31242: "ว31241" });
  assert.ok(replacedSlotCount >= 3);
  assert.equal(affectedTeachersCount, 2); // Teacher 305 (grid + coursesSummary) and Teacher 302 (coursesSummary)
  const updated305 = updatedTeachers.find((t) => t.id === 305);
  assert.ok(updated305?.s.includes("ว31241 4/1"));
  assert.ok(updated305?.coursesSummary.some((c) => c.includes("ว31241")));
  assert.ok(!updated305?.s.includes("ว31242"));

  // 4. Test automatic Semester 2 -> Semester 1 course code shifter
  const shiftToSem1 = buildSemesterCourseCodeShiftMap(INITIAL_TEACHERS, "1");
  assert.equal(shiftToSem1["ท22102"], "ท22101");
  assert.equal(shiftToSem1["ค31102"], "ค31101");
  assert.equal(shiftToSem1["ว31242"], "ว31241");
  assert.ok(Object.keys(shiftToSem1).length >= 30);
});

test("LINE notification formatter, substitute workload statistics, and dynamic signatories work end-to-end", async () => {
  const {
    formatLineNotificationMessage,
    computeSubstituteStatistics,
    exportSubstituteStatsToCsv,
  } = await import("./scheduler");
  const {
    setRuntimeDocumentSignatories,
    DEFAULT_DOCUMENT_SIGNATORIES,
    generateDocxBlob,
  } = await import("./exportDoc");
  const JSZip = (await import("jszip")).default;

  // 1. Test LINE notification formatting
  const t102 = TEACHERS.find((t) => t.id === 102)!;
  const dateStr = "2026-11-02";
  const asg = autoAssignCombinedSubstitutes([102], dateStr);
  const rows = buildCombinedDocumentRows([102], dateStr, asg, "");
  const lineMsg = formatLineNotificationMessage([t102], dateStr, "ไปราชการ", rows);
  assert.ok(lineMsg.includes("📋 แจ้งจัดสอนแทน โรงเรียนวรคุณอุปถัมภ์"));
  assert.ok(lineMsg.includes("👤 แทน: ครูรติพงษ์ รักษาพันธุ์ (ไปราชการ)"));
  assert.ok(lineMsg.includes("• คาบ 1"));

  // 2. Test substitute workload statistics calculation & CSV export
  const mockRecords = [
    {
      recordId: "r1",
      absentTeacherId: 102,
      absentTeacherIds: [102],
      absentTeacherName: "ครูรติพงษ์ รักษาพันธุ์",
      selectedDate: "2026-11-02",
      reason: "ไปราชการ",
      studentTeacherName: "",
      includeSupervision: false,
      assignments: {
        "102_0": "t301",
        "102_1": "t303",
        "0": "t301",
        "1": "t303",
      },
    },
  ];
  const stats = computeSubstituteStatistics(mockRecords, INITIAL_TEACHERS);
  assert.equal(stats.totalSubstitutedPeriods, 2);
  assert.equal(stats.byTeacherId[301].substitutedPeriods, 1);
  assert.equal(stats.byTeacherId[303].substitutedPeriods, 1);
  assert.equal(stats.byTeacherId[102].absentDays, 1);
  assert.equal(stats.byTeacherId[102].absentPeriods, 2);

  const statsCsv = exportSubstituteStatsToCsv(stats.sortedList, "2569", "2");
  assert.ok(statsCsv.startsWith("\uFEFFรหัสครู,ชื่อ-สกุล,"));
  assert.ok(statsCsv.includes("ครูเมธาวี สายสิน"));

  // 3. Test custom document signatories in Word (.docx)
  setRuntimeDocumentSignatories({
    plannerName: "นางสาวทดสอบ จัดตาราง",
    plannerPosition: "งานวิชาการโรงเรียน",
    approverName: "นายผู้อนุมัติ ทดสอบ",
    approverPosition: "รองผู้อำนวยการฝ่ายวิชาการ",
  });

  const blob = await generateDocxBlob(t102, dateStr, "ไปราชการ", rows);
  const buf = Buffer.from(await blob.arrayBuffer());
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file("word/document.xml")!.async("string");
  assert.ok(docXml.includes("(นางสาวทดสอบ จัดตาราง)"));
  assert.ok(docXml.includes("งานวิชาการโรงเรียน"));
  assert.ok(docXml.includes("(นายผู้อนุมัติ ทดสอบ)"));
  assert.ok(docXml.includes("รองผู้อำนวยการฝ่ายวิชาการ"));

  // Reset signatories back to default
  setRuntimeDocumentSignatories(DEFAULT_DOCUMENT_SIGNATORIES);
});

test("Per-teacher individual leave reasons (ไปราชการ, ลากิจ, ลาป่วย, custom text) work across combined document rows, Word export, LINE notification, and database encoding", async () => {
  const {
    formatLineNotificationMessage,
    formatCombinedReasonsSummary,
    resolveTeacherReason,
  } = await import("./scheduler");
  const { generateDocxBlob } = await import("./exportDoc");
  const { encodeAssignments, decodeAssignments } = await import("./databaseStore");
  const JSZip = (await import("jszip")).default;

  const teacherIds = ["102", "201", "301"];
  const dateStr = "2026-11-02"; // Monday
  const teacherReasons: Record<string, string> = {
    "102": "ไปราชการ",
    "201": "ลากิจ",
    "301": "ลาป่วยพบแพทย์",
  };

  assert.equal(resolveTeacherReason(102, "ไปราชการ", teacherReasons), "ไปราชการ");
  assert.equal(resolveTeacherReason(201, "ไปราชการ", teacherReasons), "ลากิจ");
  assert.equal(resolveTeacherReason(301, "ไปราชการ", teacherReasons), "ลาป่วยพบแพทย์");

  const selectedTeachers = teacherIds.map((id) => TEACHERS.find((t) => String(t.id) === id)!);
  const summary = formatCombinedReasonsSummary(selectedTeachers, "ไปราชการ", teacherReasons);
  assert.equal(summary, "102 ไปราชการ / 201 ลากิจ / 301 ลาป่วยพบแพทย์");

  const asg = autoAssignCombinedSubstitutes(teacherIds, dateStr);
  const rows = buildCombinedDocumentRows(
    teacherIds,
    dateStr,
    asg,
    "",
    false,
    "ไปราชการ",
    teacherReasons
  );
  assert.ok(rows.length > 0);

  for (const row of rows) {
    if (row.absentTeacherId === 102) {
      assert.equal(row.note, "ไปราชการ");
    } else if (row.absentTeacherId === 201) {
      assert.equal(row.note, "ลากิจ");
    } else if (row.absentTeacherId === 301) {
      assert.equal(row.note, "ลาป่วยพบแพทย์");
    }
  }

  // Verify LINE notification shows each teacher's individual reason
  const lineMsg = formatLineNotificationMessage(
    selectedTeachers,
    dateStr,
    "ไปราชการ",
    rows,
    teacherReasons
  );
  assert.ok(lineMsg.includes("ครูรติพงษ์ รักษาพันธุ์ (ไปราชการ)"));
  assert.ok(lineMsg.includes("ครูอำมาลา เกตษา (ลากิจ)"));
  assert.ok(lineMsg.includes("ครูเมธาวี สายสิน (ลาป่วยพบแพทย์)"));

  // Verify Word (.docx) export embeds all individual reasons in Column 10 (หมายเหตุ)
  const combinedHeader = buildCombinedTeacherHeader(teacherIds)!;
  const blob = await generateDocxBlob(combinedHeader, dateStr, "ไปราชการ", rows);
  const buf = Buffer.from(await blob.arrayBuffer());
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file("word/document.xml")!.async("string");
  assert.ok(docXml.includes("ไปราชการ"));
  assert.ok(docXml.includes("ลากิจ"));
  assert.ok(docXml.includes("ลาป่วยพบแพทย์"));

  // Verify encodeAssignments / decodeAssignments round-trips teacherReasons cleanly
  const encoded = encodeAssignments(asg, teacherIds, undefined, teacherReasons);
  const decoded = decodeAssignments(encoded);
  assert.deepEqual(decoded.absentTeacherIds, teacherIds);
  assert.deepEqual(decoded.teacherReasons, teacherReasons);
});

test("Regular teachers' classes matching a student teacher (same course code & subject) are automatically excluded from substitute table, while different course codes or student teachers' own absences are still included", async () => {
  const { getStudentTeacherCoveredClasses } = await import("./scheduler");

  // 1) Teacher 305 (ครูศักดิ์ชัย แสงมาศ) on Tuesday (2026-11-03):
  // Raw schedule has P1 (ว31102 4/2 - taught by ST 308), P2 (ว31102 4/1 - taught by ST 307), P5 (ว33246 6/1 - taught by 305 himself)
  const tue305Classes = getTeacherClasses(305, "2026-11-03");
  assert.equal(tue305Classes.length, 1, "Only P5 (ว33246 6/1) should need a substitute");
  assert.equal(tue305Classes[0].p, 4); // Period 5
  assert.equal(tue305Classes[0].code, "ว33246");

  const tue305Covered = getStudentTeacherCoveredClasses([305], "2026-11-03");
  assert.equal(tue305Covered.length, 2);
  assert.equal(tue305Covered[0].code, "ว31102");
  assert.equal(tue305Covered[0].cls, "4/2");
  assert.equal(tue305Covered[0].studentTeacherId, 308);
  assert.equal(tue305Covered[1].code, "ว31102");
  assert.equal(tue305Covered[1].cls, "4/1");
  assert.equal(tue305Covered[1].studentTeacherId, 307);

  // 2) Teacher 303 (ครูสถิตย์ กาทอง) on Monday (2026-11-02):
  // Raw schedule has P3 (ว21102 1/1 - taught by ST 307) and P6 (ว32224 5/1 - Chemistry taught by 303)
  const mon303Classes = getTeacherClasses(303, "2026-11-02");
  assert.equal(mon303Classes.length, 1);
  assert.equal(mon303Classes[0].p, 5); // Period 6
  assert.equal(mon303Classes[0].code, "ว32224");

  // 3) Teacher 203 & 204 (Math) co-taught with ST 205 (ครูสุภาวรรณ ปวยทอง - ค22102 2/1 & 2/2):
  // On Monday (2026-11-02), 204 has P1 (ค32202-พต 5/1) and P2 (ค22102 2/1 -> ST 205)
  const mon204Classes = getTeacherClasses(204, "2026-11-02");
  assert.equal(mon204Classes.length, 1);
  assert.equal(mon204Classes[0].code, "ค32202-พต");

  // 4) Teacher 601 (ครูปิยพงษ์ โสมาลีย์) on Friday (2026-11-06):
  // P4 is ศ23102 5/2 (ทัศนศิลป์), whereas ST 604 has ศ32102 5/2 (ดนตรี-นาฏศิลป์) -> DIFFERENT course code & subject!
  // So 601's Friday P4 MUST NOT be excluded!
  const fri601Classes = getTeacherClasses(601, "2026-11-06");
  assert.equal(fri601Classes.length, 1);
  assert.equal(fri601Classes[0].code, "ศ23102");
  assert.equal(fri601Classes[0].cls, "5/2");

  // 5) When a student teacher themselves (e.g. 307 นายธีระพงษ์ หาวัน) is selected as absent, their classes ARE included!
  const tue307Classes = getTeacherClasses(307, "2026-11-03");
  assert.equal(tue307Classes.length, 2);
  assert.equal(tue307Classes[0].code, "ว31102");
  assert.equal(tue307Classes[1].code, "ว21102");
});

test("Dynamic data reorganization (editing schedules, renaming course codes, or adding student teachers) automatically recalculates overlapping periods and substitute assignments", async () => {
  const {
    getStudentTeacherCoveredClasses,
    renameCourseCodesInTeachers,
  } = await import("./scheduler");

  try {
    // Case A: Both mentor (305) and student teacher (307) are absent on Tuesday (2026-11-03)
    // Period 2 (ว31102 4/1) is taught by ST 307, who is ALSO absent -> must appear ONCE in combined classes (under 307), and NOT in covered list!
    // Period 1 (ว31102 4/2) is taught by ST 308, who is PRESENT -> must be in covered list and NOT in combined classes!
    const combined305And307 = getCombinedTeacherClasses([305, 307], "2026-11-03");
    const p2Slots = combined305And307.filter((s) => s.p === 1 && s.code === "ว31102");
    assert.equal(p2Slots.length, 1, "Period 2 ว31102 4/1 should appear once for absent ST 307");
    assert.equal(p2Slots[0].absentTeacherId, 307);

    const covered305And307 = getStudentTeacherCoveredClasses([305, 307], "2026-11-03");
    assert.equal(covered305And307.length, 1, "Only Period 1 (ST 308 present) should be listed as covered");
    assert.equal(covered305And307[0].studentTeacherId, 308);

    // Case B: Reorganize data dynamically -> suppose ST 307's course ว31102 4/1 is changed to ว39999 4/1
    // Now Teacher 305's Tuesday Period 2 (ว31102 4/1) no longer matches any student teacher, so it MUST automatically appear on 305's substitute table!
    const modifiedTeachers = INITIAL_TEACHERS.map((t) => {
      if (t.id === 307) {
        return {
          ...t,
          s: t.s.replace(/ว31102 4\/1/g, "ว39999 4/1"),
        };
      }
      return t;
    });
    setRuntimeTeachers(modifiedTeachers);

    const tue305AfterEdit = getTeacherClasses(305, "2026-11-03");
    assert.equal(
      tue305AfterEdit.length,
      2,
      "After ST 307 no longer teaches ว31102 4/1, 305's P2 (ว31102 4/1) automatically returns to needing a substitute"
    );
    assert.deepEqual(
      tue305AfterEdit.map((c) => `${c.p + 1}:${c.code}:${c.cls}`),
      ["2:ว31102:4/1", "5:ว33246:6/1"]
    );

    // Case C: Bulk rename ว31102 -> ว31199 across all teachers -> both 305 and ST 307/308 are updated together, so P1 & P2 are automatically exempted again!
    const { updatedTeachers } = renameCourseCodesInTeachers(INITIAL_TEACHERS, {
      "ว31102": "ว31199",
    });
    setRuntimeTeachers(updatedTeachers);

    const tue305AfterBulkRename = getTeacherClasses(305, "2026-11-03");
    assert.equal(
      tue305AfterBulkRename.length,
      1,
      "After bulk renaming ว31102 -> ว31199, ST 307 & 308 still match 305's new code automatically"
    );
    assert.equal(tue305AfterBulkRename[0].code, "ว33246");
  } finally {
    // Restore original runtime teachers
    setRuntimeTeachers(INITIAL_TEACHERS);
  }
});

test("Two-way linking: summarizeTeacherGrid, formatLinkedCourseSummaryLine, syncCoursesSummaryWithSubjectMappings, and reconcileCombinedSubstitutes keep all views synchronized", async () => {
  const {
    summarizeTeacherGrid,
    formatLinkedCourseSummaryLine,
    syncCoursesSummaryWithSubjectMappings,
    reconcileCombinedSubstitutes,
    setRuntimeSubjectMappings,
  } = await import("./scheduler");

  try {
    // 1. summarizeTeacherGrid preserves subject names in parentheses and ม. prefix for student teacher 307
    const t307 = INITIAL_TEACHERS.find((t) => t.id === 307)!;
    const summary307 = summarizeTeacherGrid(
      t307.d!,
      t307.r,
      t307.otherSummary,
      t307.isStudentTeacher,
      t307.pdfGroup,
      t307.id,
      t307.coursesSummary
    );
    assert.equal(summary307.totalHours, 13);
    assert.deepEqual(summary307.coursesSummary, [
      "1) ว21102 (วิทยาศาสตร์) ม.1/1 [3], ม.1/2 [3]",
      "2) ว31102 (วิทย์ชีวภาพ) ม.4/1 [2]",
    ]);

    // 2. formatLinkedCourseSummaryLine automatically enriches lines missing subject names AND reflects custom subjectMappings
    assert.equal(
      formatLinkedCourseSummaryLine("1) ว21102 1/2 [3], 1/1 [3]", "วิทยาศาสตร์", 307),
      "1) ว21102 (วิทยาศาสตร์พื้นฐาน) 1/2 [3], 1/1 [3]"
    );

    setRuntimeSubjectMappings({ ว21102: "วิทยาศาสตร์พื้นฐาน 2" });
    assert.equal(
      formatLinkedCourseSummaryLine("1) ว21102 (วิทยาศาสตร์) ม.1/1 [3], ม.1/2 [3]", "วิทยาศาสตร์", 307),
      "1) ว21102 (วิทยาศาสตร์พื้นฐาน 2) ม.1/1 [3], ม.1/2 [3]"
    );

    const { updatedTeachers, changedCount } = syncCoursesSummaryWithSubjectMappings(
      [t307],
      { ว21102: "วิทยาศาสตร์พื้นฐาน 2" }
    );
    assert.equal(changedCount, 1);
    assert.equal(
      updatedTeachers[0].coursesSummary[0],
      "1) ว21102 (วิทยาศาสตร์พื้นฐาน 2) ม.1/1 [3], ม.1/2 [3]"
    );

    // 3. reconcileCombinedSubstitutes preserves valid manual assignments and automatically reassigns when a timetable edit causes a conflict
    const initialAsg = autoAssignCombinedSubstitutes([102], "2026-11-02");
    // Manually assign t103 to Period 1 (slotKey "102_0", where 103 is free on Monday P1)
    const customAsg = { ...initialAsg, "102_0": "t103", "0": "t103" };
    const reconciledSame = reconcileCombinedSubstitutes([102], "2026-11-02", customAsg);
    assert.equal(reconciledSame["102_0"], "t103", "Valid manual substitute t103 is preserved");

    // Now suppose Teacher 103's timetable is edited so 103 teaches on Monday Period 1 (d[0][0] = "ท21102 1/1")
    const editedWith103Busy = INITIAL_TEACHERS.map((t) => {
      if (t.id === 103) {
        const nextD = t.d!.map((row) => [...row]);
        nextD[0][0] = "ท21102 1/1";
        return {
          ...t,
          s: nextD.map((r) => r.join(",")).join("|"),
          d: nextD,
        };
      }
      return t;
    });
    setRuntimeTeachers(editedWith103Busy);

    const reconciledAfterEdit = reconcileCombinedSubstitutes([102], "2026-11-02", customAsg);
    assert.notEqual(
      reconciledAfterEdit["102_0"],
      "t103",
      "After 103's timetable is edited to have a class on Monday P1, 103 is automatically replaced with a free substitute"
    );
  } finally {
    setRuntimeSubjectMappings({});
    setRuntimeTeachers(INITIAL_TEACHERS);
  }
});

test("Five school-administration enhancements: partial-day leave (skip), cumulative workload balancing, double-booking detection, schedule cell validator/auto-fix, and same-date record merging", async () => {
  const {
    applyPartialDayLeaveFilter,
    detectLeavePeriodMode,
    computeCumulativeSubCountsExcludingDate,
    setRuntimeCumulativeSubCounts,
    findDoubleBookedSubstitutes,
    validateTeacherScheduleGrid,
    autoFixScheduleCellFormat,
    autoFixScheduleGridFormat,
    extractRecordTeacherIds,
    mergeSubstituteWorkspaceWithRecord,
    computeSubstituteStatistics,
    reconcileCombinedSubstitutes,
  } = await import("./scheduler");

  try {
    // 1. Partial-Day Leave (Morning / Afternoon / Skip)
    // Teacher 102 on Wednesday (2026-11-04) has Morning P1 (p=0), P2 (p=1) and Afternoon P5 (p=4), P6 (p=5)
    const fullAsg = autoAssignCombinedSubstitutes([102], "2026-11-04");
    assert.equal(detectLeavePeriodMode([102], "2026-11-04", fullAsg), "full");

    const morningAsg = applyPartialDayLeaveFilter([102], "2026-11-04", fullAsg, "morning");
    assert.equal(detectLeavePeriodMode([102], "2026-11-04", morningAsg), "morning");
    assert.equal(morningAsg["102_4"], "skip", "Afternoon period P5 (p=4) should be skipped for morning leave");
    assert.equal(morningAsg["102_5"], "skip", "Afternoon period P6 (p=5) should be skipped for morning leave");
    const morningRows = buildCombinedDocumentRows([102], "2026-11-04", morningAsg, "");
    assert.equal(morningRows.length, 2, "Only the 2 morning periods should appear on the substitute document");
    assert.deepEqual(morningRows.map((r) => r.p), [1, 2]);

    const afternoonAsg = applyPartialDayLeaveFilter([102], "2026-11-04", morningAsg, "afternoon");
    assert.equal(detectLeavePeriodMode([102], "2026-11-04", afternoonAsg), "afternoon");
    assert.equal(afternoonAsg["102_0"], "skip");
    assert.equal(afternoonAsg["102_1"], "skip");
    assert.notEqual(afternoonAsg["102_4"], "skip");
    assert.notEqual(afternoonAsg["102_5"], "skip");
    const afternoonRows = buildCombinedDocumentRows([102], "2026-11-04", afternoonAsg, "");
    assert.equal(afternoonRows.length, 2);
    assert.deepEqual(afternoonRows.map((r) => r.p), [5, 6]);

    // Statistics should not count "skip" periods as absent or substituted
    const statsWithSkip = computeSubstituteStatistics([
      {
        recordId: "r_half",
        absentTeacherId: 102,
        absentTeacherIds: ["102"],
        absentTeacherName: "ครูรติพงษ์ รักษาพันธุ์",
        selectedDate: "2026-11-04",
        reason: "ลากิจครึ่งบ่าย",
        studentTeacherName: "",
        includeSupervision: false,
        assignments: afternoonAsg,
      },
    ]);
    assert.equal(statsWithSkip.byTeacherId[102].absentPeriods, 2, "Only 2 non-skipped afternoon periods should count as absent");
    assert.equal(statsWithSkip.totalSubstitutedPeriods, 2);

    // 2. Cumulative Workload Balancing across days
    const candsDefault = getCandidateTeachers(102, "2026-11-02", 0);
    const firstCandDefault = candsDefault[0];
    // Give the default #1 candidate 10 historical substitute periods on an earlier date
    const historicalCounts = computeCumulativeSubCountsExcludingDate(
      [
        {
          recordId: "r_prev",
          absentTeacherId: 102,
          absentTeacherName: "ครูศิริพร",
          selectedDate: "2026-10-26",
          reason: "ไปราชการ",
          studentTeacherName: "",
          includeSupervision: false,
          assignments: {
            "102_0": `t${firstCandDefault.id}`,
            "102_1": `t${firstCandDefault.id}`,
            "102_4": `t${firstCandDefault.id}`,
          },
        },
      ],
      "2026-11-02"
    );
    assert.equal(historicalCounts[firstCandDefault.id], 3);
    setRuntimeCumulativeSubCounts({ [firstCandDefault.id]: 10 });
    const asgBalanced = autoAssignCombinedSubstitutes([102], "2026-11-02");
    assert.ok(asgBalanced["102_0"].startsWith("t"));
    setRuntimeCumulativeSubCounts({});

    // 3. Double-Booking Detection & Resolution
    const multiSlots = getCombinedTeacherClasses([102, 103], "2026-11-02");
    const conflictAsg: Record<string, string> = {
      ...autoAssignCombinedSubstitutes([102, 103], "2026-11-02"),
      "102_1": "t201",
      "103_1": "t201", // Intentional manual double-booking in Period 2 (p=1)
    };
    const conflicts = findDoubleBookedSubstitutes(multiSlots, conflictAsg);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].periodNumber, 2);
    assert.equal(conflicts[0].substituteTeacherId, 201);

    const fixedConflictAsg = reconcileCombinedSubstitutes([102, 103], "2026-11-02", conflictAsg);
    const conflictsAfterFix = findDoubleBookedSubstitutes(multiSlots, fixedConflictAsg);
    assert.equal(conflictsAfterFix.length, 0, "reconcileCombinedSubstitutes resolves double-booking automatically");

    // 4. Smart Schedule Cell Validator & Auto-Fix
    assert.equal(autoFixScheduleCellFormat("ว211021/1"), "ว21102 1/1");
    assert.equal(autoFixScheduleCellFormat("ท31102 ม.4/1 @ 138"), "ท31102 4/1@138");

    const sampleBadGrid = [
      ["ว211021/1", "ว21102", "ว21102 121", "", "", "", "#ชุมนุม"],
      ["", "", "", "", "", "", "#ฐาน ศก."],
      ["", "", "", "", "", "", "#กิจกรรม"],
      ["#โฮมรูม", "", "", "", "", "", "#การป้องกันทุจริต"],
      ["", "", "", "", "", "", "#แนะแนว"],
    ];
    const issues = validateTeacherScheduleGrid(sampleBadGrid);
    assert.equal(issues.length, 3);
    assert.equal(issues[0].suggestedValue, "ว21102 1/1");
    assert.ok(issues[1].message.includes("ยังไม่ได้ระบุชั้นเรียน"));
    assert.ok(issues[2].message.includes("เลขห้องเรียน 3 หลัก"));

    const { grid: autoFixedGrid, fixedCount } = autoFixScheduleGridFormat(sampleBadGrid);
    assert.equal(fixedCount, 1);
    assert.equal(autoFixedGrid[0][0], "ว21102 1/1");

    // 5. Same-Date Saved Record Merging (including legacy records where absentTeacherIds is omitted)
    const legacyIds = extractRecordTeacherIds({
      recordId: "rec_102-104_20261102",
      absentTeacherId: 102,
      absentTeacherName: "102 นายรติพงษ์ รักษาพันธุ์, 104 นางสาวพิไลพร พิมพ์พรม",
      assignments: { "102_0": "t205", "104_1": "t206" },
    });
    assert.deepEqual(legacyIds, ["102", "104"]);

    const merged = mergeSubstituteWorkspaceWithRecord(
      ["201"],
      { "201": "ลาป่วย" },
      autoAssignCombinedSubstitutes(["201"], "2026-11-02"),
      {
        recordId: "rec_102_20261102",
        absentTeacherId: 102,
        absentTeacherIds: ["102"],
        absentTeacherName: "ครูรติพงษ์ รักษาพันธุ์",
        selectedDate: "2026-11-02",
        reason: "ไปราชการ",
        teacherReasons: { "102": "ไปราชการ" },
        studentTeacherName: "",
        includeSupervision: false,
        assignments: autoAssignCombinedSubstitutes(["102"], "2026-11-02"),
      },
      "2026-11-02"
    );
    assert.deepEqual(merged.absentTeacherIds, ["201", "102"]);
    assert.deepEqual(merged.addedTeacherIds, ["102"]);
    assert.equal(merged.teacherReasons["102"], "ไปราชการ");
    assert.equal(merged.teacherReasons["201"], "ลาป่วย");
    const mergedSlots = getCombinedTeacherClasses(merged.absentTeacherIds, "2026-11-02");
    assert.equal(findDoubleBookedSubstitutes(mergedSlots, merged.assignments).length, 0);
  } finally {
    setRuntimeCumulativeSubCounts({});
    setRuntimeTeachers(INITIAL_TEACHERS);
  }
});





