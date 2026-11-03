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

test("autoAssignSubstitutes prioritizes same department regular teachers first, then free student teachers (205, 307, 308, 604)", () => {
  // Teacher 102 (ภาษาไทย) on Monday (2026-11-02): P1 (ท33102 6/1), P2 (ท32102 5/1), P4 (ท32102 5/2)
  // Teacher 103 (ภาษาไทย) is free on Monday in P1 and P4, but busy in P2 (ท31102 4/1)
  // In P2 on Monday: student teachers 205, 307, 604 have classes, while 308 (นายธีระเทพ มัครมย์) is free!
  const asg = autoAssignSubstitutes(102, "2026-11-02");
  assert.equal(asg[0], "t103"); // P1 -> 103 is free and in ภาษาไทย
  assert.equal(asg[1], "t308"); // P2 -> 103 is busy, so assigns free student teacher 308
  assert.equal(asg[3], "t103"); // P4 -> 103 is free and in ภาษาไทย

  const rows = buildDocumentRows(102, "2026-11-02", asg, "");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].n, "ครูอมรรัตน์ สายเหนือ");
  assert.equal(rows[1].n, "นายธีระเทพ มัครมย์ (นศ.ฝึกสอน)");
  assert.equal(rows[1].g, "วิทยาศาสตร์");
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

test("setRuntimeTeachers dynamically adds and removes teachers and updates substitute scheduling", () => {
  const newTeacher = {
    id: 104,
    n: "ครูสมหญิง ใจงาม",
    g: "ภาษาไทย",
    pdfGroup: "ภาษาไทย",
    r: "139",
    totalHours: 18,
    coursesSummary: ["ท21102 1/1 [3]"],
    otherSummary: "PLC [5]",
    s: ",,,,,,#ชุมนุม|,,,,,,#ฐาน ศก.|,,,,,,#กิจกรรม|#โฮมรูม,,,,,,#การป้องกันทุจริต|,,,,,,#แนะแนว",
    isStudentTeacher: false,
  };

  setRuntimeTeachers([...INITIAL_TEACHERS, newTeacher]);
  assert.equal(TEACHERS.length, 32);

  // Now on Monday Period 2 (when 103 is busy), 104 (ภาษาไทย) is free and should be assigned for 102!
  const asg = autoAssignSubstitutes(102, "2026-11-02");
  assert.equal(asg[1], "t104");

  // Restore back to 31 initial teachers
  setRuntimeTeachers(INITIAL_TEACHERS);
  assert.equal(TEACHERS.length, 31);
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





