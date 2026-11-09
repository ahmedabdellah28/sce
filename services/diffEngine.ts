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
  changed_cell_keys: Set<string>; // Set of "sec_day_period" for visual highlighting
}

/**
 * Calculates deterministic diff between two schedules (before and after).
 */
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

  const beforeMap = new Map<string, TimetableEntry>();
  before.entries.forEach((e) => {
    beforeMap.set(`${e.section_id}_${e.subject_id}_${e.day}_${e.period}`, e);
  });

  const afterMap = new Map<string, TimetableEntry>();
  after.entries.forEach((e) => {
    afterMap.set(`${e.section_id}_${e.subject_id}_${e.day}_${e.period}`, e);
  });

  const added: TimetableDiffItem[] = [];
  const removed: TimetableDiffItem[] = [];
  const moved: TimetableDiffItem[] = [];
  const changedCellKeys = new Set<string>();
  let unchangedCount = 0;

  // Track moves across periods for same (section, subject, teacher)
  const unmatchedBefore = [...before.entries];
  const unmatchedAfter: TimetableEntry[] = [];

  for (const aEntry of after.entries) {
    // Check exact match (same section, subject, day, period)
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

  // Detect moves (same section, subject, teacher, but different day/period)
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

  // Remaining in unmatchedAfter are newly ADDED
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

  // Remaining in unmatchedBefore are REMOVED
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

/**
 * Dry-run minimal change re-generation:
 * Preserves all valid lessons by pinning them, and only re-schedules conflicting lessons.
 */
export function dryRunMinimalChange(
  currentSchool: SchoolData,
  currentSchedule: Schedule | null,
  modifiedSchool: SchoolData
): TimetableDiffReport {
  // If no existing schedule, simply solve the modified school
  if (!currentSchedule || currentSchedule.entries.length === 0) {
    const solved = InBrowserSchoolEngine.solveInBrowser(modifiedSchool);
    return calculateTimetableDiff(null, solved.schedule, modifiedSchool);
  }

  // Identify valid entries to pin (lock) for minimal disturbance
  const safePinnedEntries: TimetableEntry[] = [];

  for (const entry of currentSchedule.entries) {
    // Check if teacher still exists and still works on this day
    const teacher = modifiedSchool.teachers.find((t) => t.id === entry.teacher_id);
    if (!teacher) continue;

    const dayRule = teacher.work_pattern?.day_rules?.[String(entry.day)];
    if (dayRule === "MANDATORY_OFF") continue; // Needs rescheduling!

    // Check if section and assignment still exist
    const hasAssignment = modifiedSchool.assignments.some(
      (a) => a.section_id === entry.section_id && a.subject_id === entry.subject_id && a.teacher_id === entry.teacher_id
    );
    if (!hasAssignment) continue;

    // Pin this entry
    safePinnedEntries.push({
      ...entry,
      is_pinned: true,
    });
  }

  // Build a clone school with pinned entries
  const dryRunSchool: SchoolData = {
    ...modifiedSchool,
    pinned_entries: safePinnedEntries,
  };

  const solved = InBrowserSchoolEngine.solveInBrowser(dryRunSchool);
  return calculateTimetableDiff(currentSchedule, solved.schedule, modifiedSchool);
}
