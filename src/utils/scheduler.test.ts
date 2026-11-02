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




