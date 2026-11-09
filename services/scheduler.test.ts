import test from "node:test";
import assert from "node:assert/strict";
import { getDemoSchool, getBuiltInSchool376, InBrowserSchoolEngine } from "./localEngine.ts";

test("Built-in Demo School data integrity: 7 sections, 20 teachers, and 252 total weekly periods", () => {
  const school = getDemoSchool();
  assert.equal(school.sections.length, 7, "Must have exactly 7 sections");
  assert.equal(school.teachers.length, 20, "Must have exactly 20 teachers");
  const totalPeriods = school.assignments.reduce((sum, a) => sum + a.weekly_periods, 0);
  assert.equal(totalPeriods, 252, "Total weekly assignment periods must be exactly 252");
});

test("CP-SAT Simulation Solver: solves all 252 periods with 0 collisions", () => {
  const school = getBuiltInSchool376();
  const res = InBrowserSchoolEngine.solveInBrowser(school);

  assert.equal(res.schedule.entries.length, 252, "All 252 periods must be scheduled");
  assert.equal(res.validation.is_valid, true, "Validation must be valid");

  // Check C1: Section Collision = 0 (No section has 2 subjects in same slot)
  const secSlots = new Set<string>();
  let c1Collisions = 0;
  for (const entry of res.schedule.entries) {
    const key = `${entry.section_id}:${entry.day}:${entry.period}`;
    if (secSlots.has(key)) c1Collisions++;
    secSlots.add(key);
  }
  assert.equal(c1Collisions, 0, "C1 Section Collisions must be 0");

  // Check C2: Teacher Collision = 0 (No teacher has 2 sections in same slot)
  const tchSlots = new Set<string>();
  let c2Collisions = 0;
  for (const entry of res.schedule.entries) {
    const key = `${entry.teacher_id}:${entry.day}:${entry.period}`;
    if (tchSlots.has(key)) c2Collisions++;
    tchSlots.add(key);
  }
  assert.equal(c2Collisions, 0, "C2 Teacher Collisions must be 0");
});

test("Teacher Constraints: Early/Late placement rules and mandatory off-days", () => {
  const school = getBuiltInSchool376();
  const res = InBrowserSchoolEngine.solveInBrowser(school);

  // 1. TCH_NASSER: Last periods (period >= 4)
  const nasserEntries = res.schedule.entries.filter((e) => e.teacher_id === "TCH_NASSER");
  assert.equal(nasserEntries.length, 16, "TCH_NASSER must have 16 scheduled periods");
  const nasserEarlyPeriods = nasserEntries.filter((e) => e.period < 4);
  assert.equal(nasserEarlyPeriods.length, 0, "TCH_NASSER must only be assigned to late periods (period >= 4)");

  // 2. TCH_OREINY: First periods on Sun, Mon, Tue (days 0, 1, 2 => period <= 4)
  const oreinyEntries = res.schedule.entries.filter((e) => e.teacher_id === "TCH_OREINY");
  assert.equal(oreinyEntries.length, 18, "TCH_OREINY must have 18 scheduled periods");
  const oreinySunTueLate = oreinyEntries.filter((e) => e.day <= 2 && e.period > 4);
  assert.equal(oreinySunTueLate.length, 0, "TCH_OREINY must only have early periods (period <= 4) on Sun, Mon, Tue");

  // 3. TCH_YOUSSEF: Wednesday and Thursday only
  const youssefEntries = res.schedule.entries.filter((e) => e.teacher_id === "TCH_YOUSSEF");
  assert.equal(youssefEntries.length, 8, "TCH_YOUSSEF must have 8 scheduled periods");
  const youssefForbiddenDays = youssefEntries.filter((e) => e.day !== 3 && e.day !== 4);
  assert.equal(youssefForbiddenDays.length, 0, "TCH_YOUSSEF must only be scheduled on Wednesday (3) and Thursday (4)");

  // 4. Daily period limits check: Monday-Thursday (days 1..4) have max 7 periods (no period 8)
  const period8MonThu = res.schedule.entries.filter((e) => e.day > 0 && e.period === 8);
  assert.equal(period8MonThu.length, 0, "No period 8 can exist on Monday to Thursday");
});
