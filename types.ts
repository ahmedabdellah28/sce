export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DAY_NAMES_AR: Record<number, string> = {
  0: "الأحد",
  1: "الاثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
  6: "السبت",
};

export interface Grade {
  id: string;
  name: string;
  code: string;
  order: number;
  daily_period_limits?: Record<string, number>;
}

export interface Section {
  id: string;
  grade_id: string;
  name: string;
  code: string;
  shift?: "FIRST" | "SECOND";
  daily_period_limits?: Record<string, number>;
  is_partial_attendance?: boolean;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  priority?: number;
  early_period_priority?: number;
  max_daily_occurrences?: number | null;
  allow_consecutive?: boolean;
  /** Lessons of this subject must be placed before the break (e.g. religion before recess). */
  before_break?: boolean;
  /** Pairing policy for the subject's lessons inside a section-day. */
  double_period_policy?: "FREE" | "DOUBLE_REQUIRED" | "SINGLE_ONLY";
}

export interface DailyPeriodRule {
  day: number;
  rule_type: "EXACT" | "MAX" | "MIN";
  count: number;
  is_hard: boolean;
  weight: number;
}

/**
 * Placement rule semantics (period numbers are 1-based):
 * - FIRST_N: lessons must fall in periods 1..n
 * - LAST_N: lessons must fall in the last n periods of the section's day
 * - EXACT_PERIODS: lessons must fall in `exact_periods` (allowed set)
 * - EDGES: lessons must fall in the first n OR last n periods (avoid the middle)
 * - AVOID_FIRST / AVOID_LAST: forbid the first / last period of the day
 * - AVOID_PERIODS: forbid the listed `exact_periods`
 * - HAS_LAST: on that day the teacher (if teaching) should hold the final period
 */
export interface DailyPlacementRule {
  day: number | null;
  placement_type:
    | "ANY_TIME"
    | "FIRST_N"
    | "LAST_N"
    | "EXACT_PERIODS"
    | "CONTIGUOUS"
    | "EDGES"
    | "AVOID_FIRST"
    | "AVOID_LAST"
    | "AVOID_PERIODS"
    | "HAS_LAST";
  n_periods?: number | null;
  exact_periods?: number[];
  is_hard: boolean;
  weight: number;
}

export interface TeacherWorkPattern {
  target_working_days?: number | null;
  target_working_days_is_hard?: boolean;
  day_rules: Record<string, "ALLOWED" | "PREFERRED" | "DISLIKED" | "MANDATORY_OFF">;
  daily_period_rules: DailyPeriodRule[];
  placement_rules: DailyPlacementRule[];
  last_period_target?: number | null;
  last_period_is_exact?: boolean;
  minimize_gaps?: boolean;
  double_period_policy?: "FREE" | "DOUBLE_REQUIRED" | "SINGLE_ONLY";
}

export interface Teacher {
  id: string;
  name: string;
  code: string;
  max_daily_periods?: number | null;
  max_weekly_periods?: number | null;
  max_consecutive_periods?: number;
  preferred_last_period?: number | null;
  force_double_periods?: boolean;
  work_pattern?: TeacherWorkPattern | null;
  /** Free-text details copied from the school document (kept for the .md round-trip). */
  notes?: string;
}

export interface TeacherAvailability {
  teacher_id: string;
  day: number;
  period: number;
  is_available: boolean;
}

export interface TeachingAssignment {
  id: string;
  section_id: string;
  subject_id: string;
  teacher_id: string;
  weekly_periods: number;
  priority?: number;
}

export interface TimetableEntry {
  entry_id: string;
  section_id: string;
  grade_id: string;
  subject_id: string;
  teacher_id: string;
  day: number;
  period: number;
  shift?: "FIRST" | "SECOND";
  is_pinned?: boolean;
}

export interface SchoolRules {
  /** Recess happens after this period (used by subject.before_break). Default 3. */
  break_after_period?: number;
  /** Max consecutive lessons of the same teacher in the same section (default: unlimited). */
  max_consecutive_same_teacher_section?: number;
  /** When false, internal empty periods inside a section-day are allowed. Default true. */
  no_section_gaps?: boolean;
  /** When false, teacher gaps are not minimised. Default true. */
  minimize_teacher_gaps?: boolean;
}

export interface SchoolData {
  id: string;
  rules?: SchoolRules;
  name: string;
  academic_year: string;
  shift_mode?: "SINGLE" | "TWO_SHIFTS";
  days: number[];
  periods_per_day: number;
  grades: Grade[];
  sections: Section[];
  subjects: Subject[];
  teachers: Teacher[];
  availabilities: TeacherAvailability[];
  assignments: TeachingAssignment[];
  pinned_entries?: TimetableEntry[];
  metadata?: Record<string, any>;
}

export interface Schedule {
  id: string;
  school_id: string;
  academic_year: string;
  status: string;
  entries: TimetableEntry[];
  quality_score: number;
  solver_status: string;
  solve_time_seconds: number;
}

export interface AnalysisReport {
  is_feasible: boolean;
  total_sections: number;
  total_teachers: number;
  total_subjects: number;
  total_assignments: number;
  total_weekly_periods: number;
  errors: Array<{ constraint_code: string; severity: string; message: string }>;
  warnings: Array<{ constraint_code: string; severity: string; message: string }>;
  diagnostic_report: string;
  section_reports: Array<{
    section_id: string;
    section_name: string;
    assigned_periods: number;
    expected_periods: number;
    difference: number;
    is_balanced: boolean;
    subjects_count: number;
  }>;
  teacher_reports: Array<{
    teacher_id: string;
    teacher_name: string;
    weekly_periods: number;
    available_slots: number;
    active_days: string[];
    off_days: string[];
    utilization_percent: number;
    rules_summary: string[];
  }>;
  day_bottlenecks: Array<{
    day: string;
    required_lessons: number;
    active_teachers_count: number;
    sections_count: number;
    status: string;
  }>;
}

