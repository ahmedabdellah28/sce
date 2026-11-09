import { ALL_SCHOOL_PRESETS, createSchoolFromPreset, getPresetById } from "../presets/commonPresets.js";
import { validateSchoolCapacity, generateSchoolMarkdown } from "../services/schoolCore.js";
import { InBrowserSchoolEngine } from "../services/localEngine.js";
import type { SchoolData, Section, TeachingAssignment } from "../types.js";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failedCount++;
    console.error(`❌ FAILED: ${message}`);
  } else {
    passedCount++;
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log("======================================================================");
console.log("   AUTOMATED REGRESSION TEST: 6-STEP SCHOOL WIZARD (STEPPER) ENGINE   ");
console.log("======================================================================\n");

// ---------------------------------------------------------------------------
// TEST 1: Step 1 - Preset Instantiation & Stage System
// ---------------------------------------------------------------------------
console.log("--- Testing Step 1: Stage, System & Preset Selection ---");
const preset = ALL_SCHOOL_PRESETS.find((p) => p.id === "preset_prep_gov_35")!;
assert(Boolean(preset), "Found target preset preset_prep_gov_35");

let school: SchoolData = createSchoolFromPreset(preset.id, {
  schoolName: "مدرسة الأمل التجريبية",
  sectionsPerGrade: 1,
});

assert(school.name === "مدرسة الأمل التجريبية", `School name properly initialized (${school.name})`);
assert(school.grades.length === 3, `Prep school has 3 grades (actual: ${school.grades.length})`);
assert(school.sections.length === 3, `Sections count matches grades (actual: ${school.sections.length})`);

// ---------------------------------------------------------------------------
// TEST 2: Step 2 - Subjects Customization & Rules
// ---------------------------------------------------------------------------
console.log("\n--- Testing Step 2: Subjects & Rules Customization ---");
const arabicSubj = school.subjects.find((s) => s.id === "arabic");
assert(Boolean(arabicSubj), "Arabic subject exists in school");

// Customize name and rules
arabicSubj!.name = "لغة عربية وقراءة";
arabicSubj!.double_period_policy = "FREE";
arabicSubj!.before_break = false;

assert(arabicSubj!.name === "لغة عربية وقراءة", "Customized subject name preserved");
assert(arabicSubj!.double_period_policy === "FREE", "Double period rule set to FREE");

// ---------------------------------------------------------------------------
// TEST 3: Step 3 - Sections Grid Generator
// ---------------------------------------------------------------------------
console.log("\n--- Testing Step 3: Sections Grid Generator ---");
// Simulate grid generator setting: Grade 1 -> 3 sections, Grade 2 -> 2 sections, Grade 3 -> 2 sections
const desiredCounts: Record<string, number> = {
  [school.grades[0].id]: 3,
  [school.grades[1].id]: 2,
  [school.grades[2].id]: 2,
};

const regeneratedSections: Section[] = [];
school.grades.forEach((g, gIdx) => {
  const count = desiredCounts[g.id] || 1;
  for (let i = 1; i <= count; i++) {
    regeneratedSections.push({
      id: `sec_${g.id}_${i}`,
      grade_id: g.id,
      name: `${g.name} (${i})`,
      code: `${g.order || gIdx + 1}/${i}`,
      shift: "FIRST",
    });
  }
});

assert(regeneratedSections.length === 7, `Grid generator produced 7 sections (3 + 2 + 2 = 7)`);
school.sections = regeneratedSections;

// ---------------------------------------------------------------------------
// TEST 4: Step 4 - Bulk Add Teachers (Multi-line Paste)
// ---------------------------------------------------------------------------
console.log("\n--- Testing Step 4: Teachers Inline Table & Bulk Add ---");
const rawBulkText = `
معلم لغة عربية (1)
معلم لغة عربية (2)
معلم لغة عربية (3)
معلم رياضيات (1)
معلم رياضيات (2)
معلم رياضيات (3)
معلم لغة إنجليزية (1)
معلم لغة إنجليزية (2)
معلم علوم متكاملة (1)
معلم علوم متكاملة (2)
معلم دراسات اجتماعية (1)
معلم دراسات اجتماعية (2)
معلم تربية دينية (1)
معلم تربية دينية (2)
معلم حاسب وتكنولوجيا
معلم تربية فنية
معلم تربية رياضية
`;

const lines = rawBulkText
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0);

school.teachers = [];
lines.forEach((name, idx) => {
  school.teachers.push({
    id: `tch_custom_${idx + 1}`,
    name,
    code: `م-${idx + 1}`,
    max_daily_periods: 7,
    max_weekly_periods: 24,
    max_consecutive_periods: 2,
  });
});

assert(school.teachers.length === 17, `Bulk paste imported exactly 17 teachers (actual: ${school.teachers.length})`);
assert(school.teachers[0].name === "معلم لغة عربية (1)", `First teacher is 'معلم لغة عربية (1)'`);

// ---------------------------------------------------------------------------
// TEST 5: Step 5 - Assignment Matrix & Auto-Balancing
// ---------------------------------------------------------------------------
console.log("\n--- Testing Step 5: Assignment Matrix & Auto-Balance ---");
// Create assignments for all 7 sections based on preset subject quotas
const newAssignments: TeachingAssignment[] = [];
const presetGrades = preset.grades;

school.sections.forEach((sec) => {
  const gradeObj = school.grades.find((g) => g.id === sec.grade_id);
  const pGrade = presetGrades.find((pg) => pg.grade_number === gradeObj?.order) || presetGrades[0];

  pGrade.subjects.forEach((subj) => {
    newAssignments.push({
      id: `asgn_${sec.id}_${subj.id}`,
      section_id: sec.id,
      subject_id: subj.id,
      teacher_id: school.teachers[0].id, // initial dummy teacher
      weekly_periods: subj.periods,
    });
  });
});

school.assignments = newAssignments;
assert(school.assignments.length === 7 * 9, `Matrix contains 63 assignments (7 sections * 9 subjects)`);

// Auto-generate specialist teachers and balanced assignments (Step 5 feature)
const specialistTeachers: any[] = [];
const balancedAssignments: TeachingAssignment[] = [];
let tchIdx = 1;

school.subjects.forEach((subj) => {
  const subjAsgns = newAssignments.filter((a) => a.subject_id === subj.id);
  const totalPeriods = subjAsgns.reduce((sum, a) => sum + a.weekly_periods, 0);
  const maxCapacityPerTeacher = subj.before_break ? 10 : 20;
  const neededTeachers = Math.max(1, Math.ceil(totalPeriods / maxCapacityPerTeacher));
  const subjTeachers: any[] = [];

  for (let i = 1; i <= neededTeachers; i++) {
    const tId = `tch_${subj.id}_${i}`;
    const tName = neededTeachers === 1 ? `معلم ${subj.name}` : `معلم ${subj.name} (${i})`;
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

// Verify workload
const workload: Record<string, number> = {};
school.teachers.forEach((t) => (workload[t.id] = 0));
school.assignments.forEach((a) => {
  workload[a.teacher_id] = (workload[a.teacher_id] || 0) + a.weekly_periods;
});

const maxLoad = Math.max(...Object.values(workload));
const minLoad = Math.min(...Object.values(workload));
assert(maxLoad <= 24, `Auto-balance kept max teacher workload reasonable (actual max: ${maxLoad})`);
assert(minLoad >= 6, `Auto-balance kept min teacher workload reasonable (actual min: ${minLoad})`);

// ---------------------------------------------------------------------------
// TEST 6: Step 6 - Capacity Validation & Feasibility Solve
// ---------------------------------------------------------------------------
console.log("\n--- Testing Step 6: Capacity Validation & In-Browser Solve ---");
const capVal = validateSchoolCapacity(school);
assert(
  capVal.errors.length === 0,
  `School capacity validation passed with 0 errors (errors: ${capVal.errors.join(", ")})`
);
assert(
  capVal.total_assigned === 7 * 35,
  `Total assigned (${capVal.total_assigned}) === 7 sections * 35 = 245 periods exactly`
);

// Solve in browser
const solveResult = InBrowserSchoolEngine.solveInBrowser(school);
if (solveResult.schedule.status !== "VALID") {
  console.log("Solver diagnostics:", solveResult.validation);
  console.log("Unplaced:", 245 - solveResult.schedule.entries.length);
}
assert(solveResult.schedule.status === "VALID", `Solver status is VALID (actual: ${solveResult.schedule.status})`);
assert(
  solveResult.schedule.entries.length === 245,
  `All 245 periods successfully scheduled (actual: ${solveResult.schedule.entries.length})`
);
assert(
  solveResult.schedule.quality_score >= 90,
  `Quality score is >= 90% (actual: ${solveResult.schedule.quality_score.toFixed(1)}%)`
);
assert(solveResult.validation.is_valid === true, `Zero-trust validation verified 0 hard collisions`);

// Markdown generation test
const generatedMd = generateSchoolMarkdown(school);
assert(generatedMd.includes("مدرسة الأمل التجريبية"), "Generated markdown contains school name");
assert(generatedMd.includes("معلم لغة عربية وقراءة"), "Generated markdown contains teachers table");
assert(generatedMd.includes("1/1"), "Generated markdown contains sections table");

console.log("\n======================================================================");
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("======================================================================");

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
