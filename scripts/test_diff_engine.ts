import assert from "node:assert/strict";
import {
  calculateTimetableDiff,
  dryRunMinimalChange,
} from "../services/diffEngine.js";
import { ALL_SCHOOL_PRESETS, createSchoolFromPreset } from "../presets/commonPresets.js";
import { InBrowserSchoolEngine } from "../services/localEngine.js";
import type { SchoolData, Schedule, TimetableEntry, TeachingAssignment } from "../types.js";

console.log("=== Running Diff Engine & Minimal Change Test Suite ===");

// 1. Setup synthetic test school from anonymous preset
const preset = ALL_SCHOOL_PRESETS.find((p) => p.id === "preset_prep_gov_35")!;
assert(preset, "Preset preset_prep_gov_35 should exist");

const school: SchoolData = createSchoolFromPreset(preset.id, {
  schoolName: "مدرسة الأمل التجريبية (اختبار)",
  sectionsPerGrade: 1, // 3 sections total
});

// Build balanced synthetic teachers and assignments
const specialistTeachers: any[] = [];
const balancedAssignments: TeachingAssignment[] = [];
let tchIdx = 1;

school.subjects.forEach((subj) => {
  const subjAsgns = school.assignments.filter((a) => a.subject_id === subj.id);
  const totalPeriods = subjAsgns.reduce((sum, a) => sum + a.weekly_periods, 0);
  const maxCapacityPerTeacher = subj.before_break ? 10 : 20;
  const neededTeachers = Math.max(1, Math.ceil(totalPeriods / maxCapacityPerTeacher));
  const subjTeachers: any[] = [];

  for (let i = 1; i <= neededTeachers; i++) {
    const tId = `tch_${subj.id}_${i}`;
    const tName = `معلم ${subj.name} (${i})`;
    const tObj = {
      id: tId,
      name: tName,
      code: `م-${subj.code}${i}`,
      max_daily_periods: 7,
      max_weekly_periods: 24,
      max_consecutive_periods: 2,
    };
    specialistTeachers.push(tObj);
    subjTeachers.push(tObj);
    tchIdx++;
  }

  subjAsgns.forEach((asgn, aIdx) => {
    const assignedTch = subjTeachers[aIdx % subjTeachers.length];
    balancedAssignments.push({
      ...asgn,
      teacher_id: assignedTch.id,
    });
  });
});

school.teachers = specialistTeachers;
school.assignments = balancedAssignments;

// Initial solve
const initialResult = InBrowserSchoolEngine.solveInBrowser(school);
assert(initialResult.schedule, "Initial solve must produce a valid schedule");
const initialSchedule = initialResult.schedule;
console.log(`✓ Initial solve succeeded with ${initialSchedule.entries.length} entries`);
assert(initialSchedule.entries.length > 0, "Schedule must have scheduled entries");

// 2. Test calculateTimetableDiff with zero changes
const diffSelf = calculateTimetableDiff(initialSchedule, initialSchedule, school);
assert.equal(diffSelf.has_changes, false, "Comparing schedule with itself must have 0 changes");
assert.equal(diffSelf.total_changes, 0);
assert.equal(diffSelf.unchanged_count, initialSchedule.entries.length);
assert.equal(diffSelf.changed_cell_keys.size, 0);
console.log("✓ Zero-diff test passed");

// 3. Test synthetic MOVE, ADD, REMOVE
const modifiedEntries: TimetableEntry[] = initialSchedule.entries.map((e) => ({ ...e }));
const firstEntry = modifiedEntries[0];
const originalDay = firstEntry.day;
const originalPeriod = firstEntry.period;

// Simulate moving the first entry to an alternate slot
firstEntry.period = originalPeriod === 1 ? 2 : 1;

// Simulate adding a new entry
const addedEntry: TimetableEntry = {
  entry_id: "SYNTHETIC_NEW",
  section_id: school.sections[0].id,
  grade_id: school.sections[0].grade_id || "G1",
  subject_id: school.subjects[0].id,
  teacher_id: school.teachers[0].id,
  day: 3,
  period: 4,
};
modifiedEntries.push(addedEntry);

// Simulate removing the last entry
const removedEntry = modifiedEntries.splice(modifiedEntries.length - 2, 1)[0];

const modifiedSchedule: Schedule = {
  id: initialSchedule.id,
  school_id: initialSchedule.school_id,
  academic_year: initialSchedule.academic_year,
  status: "VALID",
  entries: modifiedEntries,
  quality_score: 1.0,
  solver_status: "OPTIMAL",
  solve_time_seconds: 0.1,
};

const diffReport = calculateTimetableDiff(initialSchedule, modifiedSchedule, school);
assert.equal(diffReport.has_changes, true, "Diff must detect changes");
assert(diffReport.moved.length >= 1, "Must detect moved entry");
assert.equal(diffReport.added.length, 1, "Must detect 1 added entry");
assert.equal(diffReport.removed.length, 1, "Must detect 1 removed entry");
assert(diffReport.changed_cell_keys.has(`${firstEntry.section_id}_${firstEntry.day}_${firstEntry.period}`));
assert(diffReport.changed_cell_keys.has(`${addedEntry.section_id}_${addedEntry.day}_${addedEntry.period}`));
console.log(`✓ Diff detection passed: ${diffReport.moved.length} moved, ${diffReport.added.length} added, ${diffReport.removed.length} removed`);

// 4. Test dryRunMinimalChange with teacher day-off constraint
const modifiedSchool: SchoolData = JSON.parse(JSON.stringify(school));
const firstTch = modifiedSchool.teachers[0];
firstTch.work_pattern = {
  day_rules: {
    "0": "MANDATORY_OFF",
  },
  daily_period_rules: [],
  placement_rules: [],
};

const dryRunDiff = dryRunMinimalChange(school, initialSchedule, modifiedSchool);
assert(dryRunDiff.has_changes, "Dry run with new mandatory day-off must produce changes");
assert(dryRunDiff.unchanged_count > 0, "Dry run must preserve unaffected lessons");

// Verify that in the preview schedule, the teacher has 0 lessons on Day 0
const tchDay0Lessons = dryRunDiff.preview_schedule.entries.filter(
  (e) => e.teacher_id === firstTch.id && e.day === 0
);
assert.equal(tchDay0Lessons.length, 0, "Teacher must have 0 lessons on Day 0 after minimal change");
console.log(`✓ Minimal change preserved ${dryRunDiff.unchanged_count} lessons while rescheduling Day 0`);

// 5. Privacy audit on diff labels
const allDiffLabels = [
  ...diffReport.added.map((i) => i.label),
  ...diffReport.removed.map((i) => i.label),
  ...diffReport.moved.map((i) => i.label),
  ...dryRunDiff.added.map((i) => i.label),
  ...dryRunDiff.removed.map((i) => i.label),
  ...dryRunDiff.moved.map((i) => i.label),
].join(" ");

const privateKeywordsB64 = [
  "2LHZitinINi52LLYqg==", // Rya
  "2YXYp9mH2LEg2LnYqNiv2KfZhNmB2KrYp9it", // Maher
  "2YbZiNin2YQg2LTYudio2KfZhg==", // Nawal
  "2K3Ys9in2YUg2LXZhNin2K0=", // Hossam
  "2LnYsdioINmF2LfZitix", // Moteer
  "2YrYrdmK2Ykg2KfZhNi52LHZitmG2Yo=", // 376
];
for (const b64 of privateKeywordsB64) {
  const kw = Buffer.from(b64, "base64").toString("utf8");
  assert(!allDiffLabels.includes(kw), `Diff labels must NEVER leak real personal data: found "${kw}"`);
}
console.log("✓ Privacy audit on diff engine passed: 0 real teacher names found");

console.log("\n=== ALL DIFF ENGINE & MINIMAL CHANGE TESTS PASSED! ===");
