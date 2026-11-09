import { ALL_SCHOOL_PRESETS, getPresetById, createSchoolFromPreset } from "../presets/commonPresets.js";
import { validateSchoolCapacity } from "../services/schoolCore.js";

// List of real personal names that MUST NOT appear anywhere in preset files
const FORBIDDEN_PERSONAL_NAMES = [
  "محمود", "هاني", "أحمد", "محمد", "علي", "سيد", "حسن", "إبراهيم", "عصام", "ياسر",
  "خالد", "رمضان", "شعبان", "نبيل", "سامي", "عاطف", "جمال", "مختار", "أشرف", "رأفت",
  "حنان", "إيمان", "نجلاء", "سهام", "مروة", "دعاء", "منى", "رشا", "عبير", "وفاء",
  "زينب", "سحر", "سميحة", "صباح", "هالة", "عزة", "أميرة", "سناء", "نادية"
];

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
console.log("   AUTOMATED REGRESSION TEST: PRESETS CATALOG INTEGRITY & INVARIANTS   ");
console.log("======================================================================\n");

// 1. Catalog completeness
assert(ALL_SCHOOL_PRESETS.length >= 7, `Catalog contains ${ALL_SCHOOL_PRESETS.length} presets (minimum 7 required)`);

const presetIds = new Set<string>();

for (const preset of ALL_SCHOOL_PRESETS) {
  console.log(`\n--- Inspecting Preset: [${preset.id}] ${preset.name} ---`);

  // Uniqueness
  assert(!presetIds.has(preset.id), `Preset ID '${preset.id}' is unique`);
  presetIds.add(preset.id);

  // Terminology compliance: "قيم شائعة قابلة للتعديل" only, NEVER "معايير وزارية"
  assert(
    !preset.name.includes("معايير وزارية") && !preset.description.includes("معايير وزارية"),
    `Preset '${preset.id}' does NOT use forbidden term 'معايير وزارية'`
  );
  assert(
    preset.description.includes("قيم شائعة قابلة للتعديل"),
    `Preset '${preset.id}' uses sanctioned term 'قيم شائعة قابلة للتعديل'`
  );

  // Allowed categories
  assert(
    ["GOVERNMENT_GENERAL", "EXPERIMENTAL_LANGUAGE"].includes(preset.school_type),
    `Preset '${preset.id}' school_type is valid (${preset.school_type})`
  );
  assert(
    ["PRIMARY", "PREPARATORY", "SECONDARY"].includes(preset.stage),
    `Preset '${preset.id}' stage is valid (${preset.stage})`
  );

  // Shifts integrity
  assert(preset.shifts.length > 0, `Preset '${preset.id}' has at least 1 shift defined`);
  const shiftMap = new Map<string, number>();

  for (const shift of preset.shifts) {
    const computedCapacity = Object.values(shift.periods_by_day).reduce((a, b) => a + b, 0);
    assert(
      shift.weekly_capacity === computedCapacity,
      `Shift '${shift.name}' weekly_capacity (${shift.weekly_capacity}) matches sum of daily periods (${computedCapacity})`
    );
    shiftMap.set(shift.name, shift.weekly_capacity);
  }

  // Strict Mathematical Invariant: Grade periods sum === Shift Capacity
  for (const grade of preset.grades) {
    assert(
      shiftMap.has(grade.shift_name),
      `Grade '${grade.name}' references existing shift '${grade.shift_name}'`
    );
    const expectedCapacity = shiftMap.get(grade.shift_name)!;
    assert(
      grade.weekly_total === expectedCapacity,
      `Grade '${grade.name}' weekly_total (${grade.weekly_total}) === shift capacity (${expectedCapacity})`
    );

    const sumPeriods = grade.subjects.reduce((sum, s) => sum + s.periods, 0);
    assert(
      sumPeriods === expectedCapacity,
      `Grade '${grade.name}' subject periods sum (${sumPeriods}) === shift capacity (${expectedCapacity}) EXACTLY`
    );

    // Subject fields integrity
    for (const subject of grade.subjects) {
      assert(subject.id.trim().length > 0, `Subject in ${grade.name} has non-empty ID (${subject.id})`);
      assert(subject.name.trim().length > 0, `Subject '${subject.id}' has non-empty name (${subject.name})`);
      assert(subject.code.trim().length > 0, `Subject '${subject.id}' has non-empty code (${subject.code})`);
      assert(
        Array.isArray(subject.aliases) && subject.aliases.length > 0,
        `Subject '${subject.id}' has at least one alias/synonym`
      );
      assert(subject.periods > 0, `Subject '${subject.id}' has positive periods (${subject.periods})`);
      assert(
        ["CORE", "LANG", "ACTIVITY", "TECH"].includes(subject.category),
        `Subject '${subject.id}' category is valid (${subject.category})`
      );
    }
  }

  // Strict Privacy: Zero personal names in JSON representation
  const serialized = JSON.stringify(preset);
  for (const forbidden of FORBIDDEN_PERSONAL_NAMES) {
    const forbiddenPattern = new RegExp(`[\\s"]${forbidden}[\\s"]`);
    assert(
      !forbiddenPattern.test(serialized),
      `Preset '${preset.id}' strictly contains NO personal teacher name '${forbidden}'`
    );
  }

  // Instantiation & Capacity Validation Test
  const instantiatedSchool = createSchoolFromPreset(preset.id, { sectionsPerGrade: 2 });
  assert(instantiatedSchool.sections.length === preset.grades.length * 2, `Instantiated school has 2 sections per grade`);
  assert(instantiatedSchool.assignments.length > 0, `Instantiated school has teaching assignments`);

  const capacityValidation = validateSchoolCapacity(instantiatedSchool);
  assert(
    capacityValidation.errors.length === 0,
    `Instantiated school passes validateSchoolCapacity with 0 errors (errors: ${capacityValidation.errors.join(", ")})`
  );
}

console.log("\n======================================================================");
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("======================================================================");

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
