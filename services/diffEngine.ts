import type { SchoolData, Schedule, TimetableEntry } from "../types.js";
import { InBrowserSchoolEngine } from "./localEngine.js";

export interface TimetableDiffItem {
  type: "ADDED" | "REMOVED" | "MOVED";
  section_id: string;
  section_name?: string;
  subject_id: string;
  subject_name?: string;
  teacher_id: string;
  teacher_name?: string;
  from?: { day: number; period: number };
  to?: { day: number; period: number };
  label: string;
}

export interface TimetableDiffReport {
  has_changes: boolean;
  total_changes: number;
  added: TimetableDiffItem[];
  removed: TimetableDiffItem[];
  moved: TimetableDiffItem[];
  unchanged_count: number;
  preview_schedule: Schedule;
  changed_cell_keys: Set<string>;
}

export function calculateTimetableDiff(
  before: Schedule | null,
  after: Schedule,
  school: SchoolData
): TimetableDiffReport {
  if (!after || !after.entries) {
    after = {
      id: "schedule_diff",
      school_id: school.id,
      academic_year: school.academic_year || "2025-2026",
      status: "VALID",
      entries: [],
      quality_score: 1.0,
      solver_status: "OPTIMAL",
      solve_time_seconds: 0,
    };
  }

  if (!before || !before.entries || before.entries.length === 0) {
    if (after.entries.length === 0) {
      return {
        has_changes: false,
        total_changes: 0,
        added: [],
        removed: [],
        moved: [],
        unchanged_count: 0,
        preview_schedule: after,
        changed_cell_keys: new Set<string>(),
      };
    }
    return {
      has_changes: true,
      total_changes: after.entries.length,
      added: after.entries.map((e) => ({
        type: "ADDED",
        section_id: e.section_id,
        section_name: school.sections.find((s) => s.id === e.section_id)?.name || e.section_id,
        subject_id: e.subject_id,
        subject_name: school.subjects.find((s) => s.id === e.subject_id)?.name || e.subject_id,
        teacher_id: e.teacher_id,
        teacher_name: school.teachers.find((t) => t.id === e.teacher_id)?.name || e.teacher_id,
        to: { day: e.day, period: e.period },
        label: `إضافة حصة ${school.subjects.find((s) => s.id === e.subject_id)?.name || e.subject_id} (${school.sections.find((s) => s.id === e.section_id)?.name})`,
      })),
      removed: [],
      moved: [],
      unchanged_count: 0,
      preview_schedule: after,
      changed_cell_keys: new Set(after.entries.map((e) => `${e.section_id}_${e.day}_${e.period}`)),
    };
  }

  const added: TimetableDiffItem[] = [];
  const removed: TimetableDiffItem[] = [];
  const moved: TimetableDiffItem[] = [];
  const changedCellKeys = new Set<string>();
  let unchangedCount = 0;

  const unmatchedBefore = [...before.entries];
  const unmatchedAfter: TimetableEntry[] = [];

  for (const aEntry of after.entries) {
    const exactMatchIdx = unmatchedBefore.findIndex(
      (b) =>
        b.section_id === aEntry.section_id &&
        b.subject_id === aEntry.subject_id &&
        b.teacher_id === aEntry.teacher_id &&
        b.day === aEntry.day &&
        b.period === aEntry.period
    );

    if (exactMatchIdx >= 0) {
      unchangedCount++;
      unmatchedBefore.splice(exactMatchIdx, 1);
    } else {
      unmatchedAfter.push(aEntry);
    }
  }

  for (const aEntry of [...unmatchedAfter]) {
    const moveMatchIdx = unmatchedBefore.findIndex(
      (b) =>
        b.section_id === aEntry.section_id &&
        b.subject_id === aEntry.subject_id &&
        b.teacher_id === aEntry.teacher_id
    );

    const secName = school.sections.find((s) => s.id === aEntry.section_id)?.name || aEntry.section_id;
    const subName = school.subjects.find((s) => s.id === aEntry.subject_id)?.name || aEntry.subject_id;
    const tchName = school.teachers.find((t) => t.id === aEntry.teacher_id)?.name || aEntry.teacher_id;

    if (moveMatchIdx >= 0) {
      const bEntry = unmatchedBefore[moveMatchIdx];
      unmatchedBefore.splice(moveMatchIdx, 1);
      const aIdx = unmatchedAfter.indexOf(aEntry);
      if (aIdx >= 0) unmatchedAfter.splice(aIdx, 1);

      moved.push({
        type: "MOVED",
        section_id: aEntry.section_id,
        section_name: secName,
        subject_id: aEntry.subject_id,
        subject_name: subName,
        teacher_id: aEntry.teacher_id,
        teacher_name: tchName,
        from: { day: bEntry.day, period: bEntry.period },
        to: { day: aEntry.day, period: aEntry.period },
        label: `نقل ${subName} (${secName}) من يوم ${bEntry.day} ح${bEntry.period} إلى يوم ${aEntry.day} ح${aEntry.period}`,
      });

      changedCellKeys.add(`${aEntry.section_id}_${aEntry.day}_${aEntry.period}`);
      changedCellKeys.add(`${bEntry.section_id}_${bEntry.day}_${bEntry.period}`);
    }
  }

  for (const aEntry of unmatchedAfter) {
    const secName = school.sections.find((s) => s.id === aEntry.section_id)?.name || aEntry.section_id;
    const subName = school.subjects.find((s) => s.id === aEntry.subject_id)?.name || aEntry.subject_id;
    const tchName = school.teachers.find((t) => t.id === aEntry.teacher_id)?.name || aEntry.teacher_id;

    added.push({
      type: "ADDED",
      section_id: aEntry.section_id,
      section_name: secName,
      subject_id: aEntry.subject_id,
      subject_name: subName,
      teacher_id: aEntry.teacher_id,
      teacher_name: tchName,
      to: { day: aEntry.day, period: aEntry.period },
      label: `إضافة ${subName} في ${secName} (يوم ${aEntry.day} ح${aEntry.period})`,
    });
    changedCellKeys.add(`${aEntry.section_id}_${aEntry.day}_${aEntry.period}`);
  }

  for (const bEntry of unmatchedBefore) {
    const secName = school.sections.find((s) => s.id === bEntry.section_id)?.name || bEntry.section_id;
    const subName = school.subjects.find((s) => s.id === bEntry.subject_id)?.name || bEntry.subject_id;
    const tchName = school.teachers.find((t) => t.id === bEntry.teacher_id)?.name || bEntry.teacher_id;

    removed.push({
      type: "REMOVED",
      section_id: bEntry.section_id,
      section_name: secName,
      subject_id: bEntry.subject_id,
      subject_name: subName,
      teacher_id: bEntry.teacher_id,
      teacher_name: tchName,
      from: { day: bEntry.day, period: bEntry.period },
      label: `إلغاء ${subName} من ${secName} (يوم ${bEntry.day} ح${bEntry.period})`,
    });
    changedCellKeys.add(`${bEntry.section_id}_${bEntry.day}_${bEntry.period}`);
  }

  const totalChanges = added.length + removed.length + moved.length;

  return {
    has_changes: totalChanges > 0,
    total_changes: totalChanges,
    added,
    removed,
    moved,
    unchanged_count: unchangedCount,
    preview_schedule: after,
    changed_cell_keys: changedCellKeys,
  };
}

function getSectionDayMax(school: SchoolData, secId: string, d: number): number {
  const sec = school.sections.find((s) => s.id === secId);
  const grade = sec ? school.grades.find((g) => g.id === sec.grade_id) : undefined;
  return (
    sec?.daily_period_limits?.[String(d)] ||
    grade?.daily_period_limits?.[String(d)] ||
    school.periods_per_day ||
    7
  );
}

function entryViolatesSlotRules(
  teacherId: string,
  subjectId: string,
  sectionId: string,
  day: number,
  period: number,
  school: SchoolData
): boolean {
  const maxP = getSectionDayMax(school, sectionId, day);
  if (period < 1 || period > maxP) return true;
  if (!school.days.includes(day)) return true;

  const teacher = school.teachers.find((t) => t.id === teacherId);
  if (!teacher) return true;
  if (teacher.work_pattern?.day_rules?.[String(day)] === "MANDATORY_OFF") return true;

  for (const r of teacher.work_pattern?.placement_rules || []) {
    if (r.is_hard === false) continue;
    if (r.day !== null && r.day !== undefined && Number(r.day) !== day) continue;
    const n = r.n_periods ?? 1;
    switch (r.placement_type) {
      case "AVOID_FIRST":
        if (period === 1) return true;
        break;
      case "AVOID_LAST":
        if (period === maxP) return true;
        break;
      case "AVOID_PERIODS":
        if ((r.exact_periods || []).includes(period)) return true;
        break;
      case "FIRST_N":
        if (period > n) return true;
        break;
      case "LAST_N":
        if (period <= Math.max(0, maxP - n)) return true;
        break;
      case "EXACT_PERIODS":
        if ((r.exact_periods || []).length > 0 && !(r.exact_periods || []).includes(period)) return true;
        break;
    }
  }

  const sub = school.subjects.find((s) => s.id === subjectId);
  if (sub?.before_break) {
    const brk = school.rules?.break_after_period ?? 3;
    if (period > brk) return true;
  }
  return false;
}

function canPlaceEntryAtSlot(
  teacherId: string,
  subjectId: string,
  sectionId: string,
  day: number,
  period: number,
  school: SchoolData,
  entriesWithoutDisplaced: TimetableEntry[]
): boolean {
  if (entryViolatesSlotRules(teacherId, subjectId, sectionId, day, period, school)) return false;

  // Section collision
  if (entriesWithoutDisplaced.some((e) => e.section_id === sectionId && e.day === day && e.period === period)) {
    return false;
  }
  // Teacher collision
  if (entriesWithoutDisplaced.some((e) => e.teacher_id === teacherId && e.day === day && e.period === period)) {
    return false;
  }

  const teacher = school.teachers.find((t) => t.id === teacherId);
  const teacherDayPeriods = entriesWithoutDisplaced
    .filter((e) => e.teacher_id === teacherId && e.day === day)
    .map((e) => e.period);

  // Max daily cap
  if (teacher?.max_daily_periods && teacherDayPeriods.length >= teacher.max_daily_periods) {
    return false;
  }
  for (const dr of teacher?.work_pattern?.daily_period_rules || []) {
    if (Number(dr.day) === day && (dr.rule_type === "MAX" || dr.rule_type === "EXACT")) {
      if (teacherDayPeriods.length >= dr.count) return false;
    }
  }

  // Max consecutive cap
  if (teacher?.max_consecutive_periods && teacher.max_consecutive_periods > 0) {
    const setP = new Set([...teacherDayPeriods, period]);
    let run = 0;
    for (let p = 1; p <= (school.periods_per_day || 8) + 2; p++) {
      if (setP.has(p)) {
        run++;
        if (run > teacher.max_consecutive_periods) return false;
      } else {
        run = 0;
      }
    }
  }

  return true;
}

/**
 * Repairs an existing schedule surgically after targeted edits (new rule, off-day, quota update),
 * preserving all valid cells intact via 0-swap / 1-swap / 2-swap local search before falling back
 * to a full solver rebuild only when structural changes make local repair impossible.
 */
function repairScheduleSurgically(
  currentSchedule: Schedule,
  modifiedSchool: SchoolData
): Schedule | null {
  const targetQuota = new Map<string, number>();
  const keyToMeta = new Map<string, { section_id: string; subject_id: string; teacher_id: string; grade_id: string }>();

  for (const a of modifiedSchool.assignments) {
    if (a.weekly_periods <= 0) continue;
    const key = `${a.section_id}_${a.subject_id}_${a.teacher_id}`;
    targetQuota.set(key, (targetQuota.get(key) || 0) + a.weekly_periods);
    const sec = modifiedSchool.sections.find((s) => s.id === a.section_id);
    keyToMeta.set(key, {
      section_id: a.section_id,
      subject_id: a.subject_id,
      teacher_id: a.teacher_id,
      grade_id: sec?.grade_id || "G1",
    });
  }

  const keptCount = new Map<string, number>();
  const keptEntries: TimetableEntry[] = [];
  const vacatedSlots: Array<{ section_id: string; day: number; period: number }> = [];

  for (const e of currentSchedule.entries) {
    const key = `${e.section_id}_${e.subject_id}_${e.teacher_id}`;
    const allowedQ = targetQuota.get(key) || 0;
    const usedQ = keptCount.get(key) || 0;

    let violates = usedQ >= allowedQ || entryViolatesSlotRules(e.teacher_id, e.subject_id, e.section_id, e.day, e.period, modifiedSchool);
    if (!violates) {
      const tch = modifiedSchool.teachers.find((t) => t.id === e.teacher_id);
      if (tch?.max_daily_periods) {
        const dayTch = keptEntries.filter((x) => x.teacher_id === tch.id && x.day === e.day).length;
        if (dayTch >= tch.max_daily_periods) violates = true;
      }
    }

    if (violates) {
      vacatedSlots.push({ section_id: e.section_id, day: e.day, period: e.period });
      continue;
    }

    keptCount.set(key, usedQ + 1);
    keptEntries.push({ ...e });
  }

  // Build queue of missing lessons that need placing
  interface MissingLesson {
    section_id: string;
    grade_id: string;
    subject_id: string;
    teacher_id: string;
  }
  const missing: MissingLesson[] = [];
  for (const [key, need] of targetQuota.entries()) {
    const have = keptCount.get(key) || 0;
    const meta = keyToMeta.get(key)!;
    for (let i = have; i < need; i++) {
      missing.push({ ...meta });
    }
  }

  if (missing.length === 0 && vacatedSlots.length === 0) {
    return {
      ...currentSchedule,
      school_id: modifiedSchool.id,
      entries: keptEntries,
    };
  }

  // Available valid empty slots per section (vacated slots first, then any open valid slot)
  const working = [...keptEntries];
  const findEmptySlotsForSection = (secId: string): Array<{ day: number; period: number }> => {
    const slots: Array<{ day: number; period: number }> = [];
    const seen = new Set<string>();
    for (const v of vacatedSlots) {
      if (v.section_id === secId && !working.some((e) => e.section_id === secId && e.day === v.day && e.period === v.period)) {
        const k = `${v.day}_${v.period}`;
        if (!seen.has(k)) {
          seen.add(k);
          slots.push({ day: v.day, period: v.period });
        }
      }
    }
    for (const d of modifiedSchool.days) {
      const maxP = getSectionDayMax(modifiedSchool, secId, d);
      for (let p = 1; p <= maxP; p++) {
        if (!working.some((e) => e.section_id === secId && e.day === d && e.period === p)) {
          const k = `${d}_${p}`;
          if (!seen.has(k)) {
            seen.add(k);
            slots.push({ day: d, period: p });
          }
        }
      }
    }
    return slots;
  };

  let seq = 1;
  for (const item of missing) {
    const openSlots = findEmptySlotsForSection(item.section_id);
    let placed = false;

    // 1. Direct placement into an empty slot in the same section
    for (const sl of openSlots) {
      if (canPlaceEntryAtSlot(item.teacher_id, item.subject_id, item.section_id, sl.day, sl.period, modifiedSchool, working)) {
        working.push({
          entry_id: `REPAIR_${Date.now()}_${seq++}`,
          section_id: item.section_id,
          grade_id: item.grade_id,
          subject_id: item.subject_id,
          teacher_id: item.teacher_id,
          day: sl.day,
          period: sl.period,
        });
        placed = true;
        break;
      }
    }
    if (placed) continue;

    // 2. 1-Swap within same section: move a partner entry P into openSlot sl, place item into P's former slot
    const secEntries = working.filter((e) => e.section_id === item.section_id && !e.is_pinned);
    outer1: for (const sl of openSlots) {
      for (const partner of secEntries) {
        const withoutP = working.filter((e) => e.entry_id !== partner.entry_id);
        if (
          canPlaceEntryAtSlot(partner.teacher_id, partner.subject_id, partner.section_id, sl.day, sl.period, modifiedSchool, withoutP) &&
          canPlaceEntryAtSlot(item.teacher_id, item.subject_id, item.section_id, partner.day, partner.period, modifiedSchool, withoutP)
        ) {
          const pIdx = working.findIndex((e) => e.entry_id === partner.entry_id);
          const pDay = partner.day;
          const pPeriod = partner.period;
          working[pIdx] = { ...partner, day: sl.day, period: sl.period };
          working.push({
            entry_id: `REPAIR_${Date.now()}_${seq++}`,
            section_id: item.section_id,
            grade_id: item.grade_id,
            subject_id: item.subject_id,
            teacher_id: item.teacher_id,
            day: pDay,
            period: pPeriod,
          });
          placed = true;
          break outer1;
        }
      }
    }
    if (placed) continue;

    // 3. Cross-section 2-Swap (in case openSlots had free spot blocked only by another section's teacher at sl.day/sl.period)
    outer2: for (const sl of openSlots) {
      const blockingEntries = working.filter((e) => e.teacher_id === item.teacher_id && e.day === sl.day && e.period === sl.period && !e.is_pinned);
      if (blockingEntries.length === 1) {
        const blk = blockingEntries[0];
        const blkSecEntries = working.filter((e) => e.section_id === blk.section_id && e.entry_id !== blk.entry_id && !e.is_pinned);
        for (const p2 of blkSecEntries) {
          const withoutBoth = working.filter((e) => e.entry_id !== blk.entry_id && e.entry_id !== p2.entry_id);
          if (
            canPlaceEntryAtSlot(blk.teacher_id, blk.subject_id, blk.section_id, p2.day, p2.period, modifiedSchool, withoutBoth) &&
            canPlaceEntryAtSlot(p2.teacher_id, p2.subject_id, p2.section_id, blk.day, blk.period, modifiedSchool, withoutBoth)
          ) {
            const afterSwapBlk = [
              ...withoutBoth,
              { ...blk, day: p2.day, period: p2.period },
              { ...p2, day: blk.day, period: blk.period },
            ];
            if (canPlaceEntryAtSlot(item.teacher_id, item.subject_id, item.section_id, sl.day, sl.period, modifiedSchool, afterSwapBlk)) {
              const i1 = working.findIndex((e) => e.entry_id === blk.entry_id);
              const i2 = working.findIndex((e) => e.entry_id === p2.entry_id);
              working[i1] = { ...blk, day: p2.day, period: p2.period };
              working[i2] = { ...p2, day: blk.day, period: blk.period };
              working.push({
                entry_id: `REPAIR_${Date.now()}_${seq++}`,
                section_id: item.section_id,
                grade_id: item.grade_id,
                subject_id: item.subject_id,
                teacher_id: item.teacher_id,
                day: sl.day,
                period: sl.period,
              });
              placed = true;
              break outer2;
            }
          }
        }
      }
    }
    if (!placed) return null;
  }

  // Final strict 0-collision verification
  const expectedTotal = modifiedSchool.assignments.reduce((s, a) => s + a.weekly_periods, 0);
  if (working.length !== expectedTotal) return null;

  const tKeys = new Set<string>();
  const sKeys = new Set<string>();
  for (const e of working) {
    const tk = `${e.teacher_id}_${e.day}_${e.period}`;
    const sk = `${e.section_id}_${e.day}_${e.period}`;
    if (tKeys.has(tk) || sKeys.has(sk)) return null;
    tKeys.add(tk);
    sKeys.add(sk);
  }

  return {
    ...currentSchedule,
    id: `repaired_${Date.now()}`,
    school_id: modifiedSchool.id,
    entries: working,
  };
}

/**
 * Dry-run minimal change re-generation:
 * Repairs only conflicting cells in-place to preserve all valid lessons, falling back to full solve only if necessary.
 */
export function dryRunMinimalChange(
  currentSchool: SchoolData,
  currentSchedule: Schedule | null,
  modifiedSchool: SchoolData
): TimetableDiffReport {
  if (!currentSchedule || currentSchedule.entries.length === 0) {
    const solved = InBrowserSchoolEngine.solveInBrowser(modifiedSchool);
    return calculateTimetableDiff(null, solved.schedule, modifiedSchool);
  }

  const repaired = repairScheduleSurgically(currentSchedule, modifiedSchool);
  if (repaired) {
    return calculateTimetableDiff(currentSchedule, repaired, modifiedSchool);
  }

  const solved = InBrowserSchoolEngine.solveInBrowser(modifiedSchool);
  return calculateTimetableDiff(currentSchedule, solved.schedule, modifiedSchool);
}
