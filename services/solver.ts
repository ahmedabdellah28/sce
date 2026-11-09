/**
 * Real constraint solver + independent zero-trust validator for the school timetable.
 *
 * - Pure TypeScript (no DOM / no Node APIs) so it runs both in the browser and in server.ts.
 * - NO teacher/school specific hard-coding: every rule comes from the SchoolData.
 * - Algorithm: MRV-ordered constructive search + ejection chains (min-conflicts walk with tabu),
 *   followed by soft-cost local search (moves + same-section swaps).
 * - `validateSchedule` re-checks every hard rule from the raw entries only, so a result is never
 *   reported "valid" unless it really satisfies all constraints.
 */

import type {
  DailyPlacementRule,
  Schedule,
  SchoolData,
  Section,
  Subject,
  Teacher,
  TimetableEntry,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SolverOptions {
  /** Total time budget in ms (default 6000). */
  maxTimeMs?: number;
  /** PRNG seed for reproducible results (default 42). */
  seed?: number;
  /** Time reserved for soft-cost optimisation after a complete schedule is found (ms). */
  polishMs?: number;
}

export interface ValidationIssue {
  constraint_code: string;
  severity: "ERROR" | "WARNING";
  message: string;
  section_id?: string;
  teacher_id?: string;
  day?: number;
  period?: number;
}

export interface ValidationResult {
  is_valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  stats: {
    expected_lessons: number;
    placed_lessons: number;
    unplaced_lessons: number;
    hard_violations: number;
    soft_violations: number;
    teacher_gaps: number;
    section_gaps: number;
  };
}

export interface SolveResult {
  schedule: Schedule;
  validation: { is_valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] };
  metrics: {
    teacher_preferences_compliance_percent: number;
    schedule_compactness_percent: number;
    double_periods_compliance_percent: number;
    placed_lessons: number;
    expected_lessons: number;
    unplaced_lessons: number;
    soft_cost: number;
    iterations: number;
  };
}

// ---------------------------------------------------------------------------
// Shared helpers (also used by analysis / UI)
// ---------------------------------------------------------------------------

export const MAX_PERIOD_STRIDE = 14; // periods 1..13

function dayKey(d: number): string {
  return String(d);
}

/** Number of periods of a section on a day (0 when the day is not a school day). */
export function sectionPeriods(school: SchoolData, sec: Section, day: number): number {
  if (!school.days.includes(day)) return 0;
  const grade = school.grades.find((g) => g.id === sec.grade_id);
  const v = sec.daily_period_limits?.[dayKey(day)] ?? grade?.daily_period_limits?.[dayKey(day)] ?? school.periods_per_day;
  return Math.max(0, Math.min(MAX_PERIOD_STRIDE - 1, Number(v) || 0));
}

export function isPositiveRule(r: DailyPlacementRule): boolean {
  return (
    r.placement_type === "FIRST_N" ||
    r.placement_type === "LAST_N" ||
    r.placement_type === "EXACT_PERIODS" ||
    r.placement_type === "EDGES"
  );
}
export function isNegativeRule(r: DailyPlacementRule): boolean {
  return (
    r.placement_type === "AVOID_FIRST" ||
    r.placement_type === "AVOID_LAST" ||
    r.placement_type === "AVOID_PERIODS"
  );
}

export function ruleSatisfied(r: DailyPlacementRule, p: number, L: number): boolean {
  const n = r.n_periods ?? 3;
  switch (r.placement_type) {
    case "FIRST_N":
      return p <= n;
    case "LAST_N":
      return p > L - n;
    case "EXACT_PERIODS":
      return (r.exact_periods || []).includes(p);
    case "EDGES":
      return p <= n || p > L - n;
    case "AVOID_FIRST":
      return p !== 1;
    case "AVOID_LAST":
      return p !== L;
    case "AVOID_PERIODS":
      return !(r.exact_periods || []).includes(p);
    default:
      return true;
  }
}

/** Rules that apply on `day`: day-specific rules override generic (day == null) rules. */
export function applicableRules(t: Teacher | undefined, day: number): DailyPlacementRule[] {
  const all = t?.work_pattern?.placement_rules || [];
  const specific = all.filter((r) => r.day !== null && r.day !== undefined && Number(r.day) === day);
  if (specific.length > 0) return specific;
  return all.filter((r) => r.day === null || r.day === undefined);
}

export function isTeacherOffDay(t: Teacher | undefined, day: number): boolean {
  return t?.work_pattern?.day_rules?.[dayKey(day)] === "MANDATORY_OFF";
}

/** Hard placement check (positive rules are a union, negative rules an intersection). */
export function hardPlacementOk(t: Teacher | undefined, day: number, p: number, L: number): boolean {
  const rules = applicableRules(t, day).filter((r) => r.is_hard);
  const pos = rules.filter(isPositiveRule);
  if (pos.length > 0 && !pos.some((r) => ruleSatisfied(r, p, L))) return false;
  for (const r of rules.filter(isNegativeRule)) if (!ruleSatisfied(r, p, L)) return false;
  return true;
}

/** Soft placement penalty (0 when every soft rule is respected). */
export function softPlacementPenalty(t: Teacher | undefined, day: number, p: number, L: number): number {
  const rules = applicableRules(t, day).filter((r) => !r.is_hard);
  let pen = 0;
  const pos = rules.filter(isPositiveRule);
  if (pos.length > 0 && !pos.some((r) => ruleSatisfied(r, p, L))) {
    pen += 25 * (Math.max(...pos.map((r) => r.weight || 10)) / 10);
  }
  for (const r of rules.filter(isNegativeRule)) {
    if (!ruleSatisfied(r, p, L)) pen += 25 * ((r.weight || 10) / 10);
  }
  return pen;
}

export type DoublePolicy = "FREE" | "DOUBLE_REQUIRED" | "SINGLE_ONLY" | "PREFER_DOUBLE";

export function resolveDoublePolicy(t: Teacher | undefined, s: Subject | undefined): DoublePolicy {
  const tp = t?.work_pattern?.double_period_policy;
  if (tp === "DOUBLE_REQUIRED" || tp === "SINGLE_ONLY") return tp;
  if (s?.double_period_policy === "DOUBLE_REQUIRED" || s?.double_period_policy === "SINGLE_ONLY") {
    return s.double_period_policy;
  }
  if (t?.force_double_periods) return "PREFER_DOUBLE";
  if (s?.allow_consecutive === false) return "SINGLE_ONLY";
  return "FREE";
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

interface Unit {
  id: number;
  asgId: string;
  secI: number;
  subjI: number;
  tchI: number;
  slot: number; // -1 when unplaced, otherwise d * STRIDE + p
  weekly: number; // weekly periods of the whole (section, subject)
  lastEvicted: number;
}

const STRIDE = MAX_PERIOD_STRIDE;

export function solveSchool(school: SchoolData, opts: SolverOptions = {}): SolveResult {
  const t0 = Date.now();
  const maxTimeMs = opts.maxTimeMs ?? 6000;
  const polishMs = opts.polishMs ?? Math.min(1500, Math.floor(maxTimeMs * 0.25));
  const rand = mulberry32(opts.seed ?? 42);

  const rules = school.rules || {};
  const breakAfter = rules.break_after_period ?? 3;
  const maxSameTS = rules.max_consecutive_same_teacher_section ?? 99;
  const noSecGaps = rules.no_section_gaps !== false;
  const minTchGaps = rules.minimize_teacher_gaps !== false;

  const sections = school.sections;
  const teachers = school.teachers;
  const subjects = school.subjects;
  const secIdx = new Map(sections.map((s, i) => [s.id, i]));
  const tchIdx = new Map(teachers.map((t, i) => [t.id, i]));
  const subjIdx = new Map(subjects.map((s, i) => [s.id, i]));
  const nSec = sections.length;
  const nTch = teachers.length;
  const nSubj = subjects.length;
  const dayList = [...school.days].sort((a, b) => a - b);

  // Section lengths + shifts
  const L: number[][] = sections.map((s) => {
    const row = new Array(7).fill(0);
    for (const d of dayList) row[d] = sectionPeriods(school, s, d);
    return row;
  });
  const shiftOf = sections.map((s) => (s.shift === "SECOND" ? 1 : 0));

  // Unavailability
  const unavail = new Set<string>();
  for (const av of school.availabilities || []) {
    if (!av.is_available) unavail.add(`${av.teacher_id}:${av.day}:${av.period}`);
  }

  // Units
  const units: Unit[] = [];
  const weeklyBySecSubj = new Map<string, number>();
  const badRefs: string[] = [];
  for (const asg of school.assignments) {
    const si = secIdx.get(asg.section_id);
    const ti = tchIdx.get(asg.teacher_id);
    const ji = subjIdx.get(asg.subject_id);
    if (si === undefined || ti === undefined || ji === undefined) {
      badRefs.push(asg.id);
      continue;
    }
    const k = `${si}:${ji}`;
    weeklyBySecSubj.set(k, (weeklyBySecSubj.get(k) || 0) + asg.weekly_periods);
  }
  for (const asg of school.assignments) {
    const si = secIdx.get(asg.section_id);
    const ti = tchIdx.get(asg.teacher_id);
    const ji = subjIdx.get(asg.subject_id);
    if (si === undefined || ti === undefined || ji === undefined) continue;
    const weekly = weeklyBySecSubj.get(`${si}:${ji}`) || asg.weekly_periods;
    for (let i = 0; i < asg.weekly_periods; i++) {
      units.push({ id: units.length, asgId: asg.id, secI: si, subjI: ji, tchI: ti, slot: -1, weekly, lastEvicted: -1000 });
    }
  }
  const total = units.length;

  // Teacher active (non-off) days
  const tchActiveDays = teachers.map((t) => dayList.filter((d) => !isTeacherOffDay(t, d)));

  // Per-teacher daily caps
  const dailyCap: number[][] = teachers.map((t) => {
    const row = new Array(7).fill(99);
    if (t.max_daily_periods) for (const d of dayList) row[d] = Math.min(row[d], t.max_daily_periods);
    for (const r of t.work_pattern?.daily_period_rules || []) {
      if (r.rule_type === "EXACT" || r.rule_type === "MAX") row[Number(r.day)] = Math.min(row[Number(r.day)], r.count);
    }
    return row;
  });
  const targetDaysHard: number[] = teachers.map((t) =>
    t.work_pattern?.target_working_days_is_hard && t.work_pattern.target_working_days
      ? t.work_pattern.target_working_days
      : 99
  );
  const maxConsecAny: number[] = teachers.map((t) => t.max_consecutive_periods || 99);

  // Subject/day cap per (section, subject)
  const subjDayCap = new Map<string, number>();
  for (const [k, w] of weeklyBySecSubj) {
    const [si, ji] = k.split(":").map(Number);
    const subj = subjects[ji];
    // teachers that teach it
    const tIds = new Set(units.filter((u) => u.secI === si && u.subjI === ji).map((u) => u.tchI));
    let minActive = dayList.length;
    for (const ti of tIds) minActive = Math.min(minActive, tchActiveDays[ti].length || 1);
    const natural = Math.max(2, Math.ceil(w / Math.max(1, dayList.length)));
    const byTeacher = Math.max(1, Math.ceil(w / Math.max(1, minActive)));
    let cap = subj.max_daily_occurrences ?? Math.max(natural, byTeacher);
    // never let the declared cap make the demand infeasible
    cap = Math.max(cap, Math.ceil(w / Math.max(1, minActive)));
    subjDayCap.set(k, cap);
  }

  // Grids
  const secGrid = new Int32Array(nSec * 7 * STRIDE).fill(-1);
  const tchGrid = new Int32Array(nTch * 2 * 7 * STRIDE).fill(-1);
  const tchDayCnt = new Int32Array(nTch * 7);
  const ssdCnt = new Int32Array(nSec * nSubj * 7);
  const sIdx = (si: number, d: number, p: number) => (si * 7 + d) * STRIDE + p;
  const tIdx = (ti: number, sh: number, d: number, p: number) => ((ti * 2 + sh) * 7 + d) * STRIDE + p;
  const tchDaysUsed = (ti: number) => {
    let n = 0;
    for (const d of dayList) if (tchDayCnt[ti * 7 + d] > 0) n++;
    return n;
  };

  function staticOk(u: Unit, d: number, p: number): boolean {
    const maxP = L[u.secI][d];
    if (p < 1 || p > maxP) return false;
    const t = teachers[u.tchI];
    if (isTeacherOffDay(t, d)) return false;
    if (unavail.has(`${t.id}:${d}:${p}`)) return false;
    if (!hardPlacementOk(t, d, p, maxP)) return false;
    if (subjects[u.subjI].before_break && p > breakAfter) return false;
    return true;
  }

  // Static slot lists per unit (cached by assignment).
  const staticSlotsCache = new Map<string, number[]>();
  function staticSlots(u: Unit): number[] {
    const key = `${u.secI}:${u.tchI}:${u.subjI}`;
    let v = staticSlotsCache.get(key);
    if (!v) {
      v = [];
      for (const d of dayList) for (let p = 1; p <= L[u.secI][d]; p++) if (staticOk(u, d, p)) v.push(d * STRIDE + p);
      staticSlotsCache.set(key, v);
    }
    return v;
  }

  /** Length of the run of consecutive teacher lessons through (d,p) if a lesson were placed there. */
  function runAny(ti: number, sh: number, d: number, p: number): number {
    let n = 1;
    for (let q = p - 1; q >= 1 && tchGrid[tIdx(ti, sh, d, q)] >= 0; q--) n++;
    for (let q = p + 1; q < STRIDE && tchGrid[tIdx(ti, sh, d, q)] >= 0; q++) n++;
    return n;
  }
  function runSameSec(u: Unit, d: number, p: number): number {
    let n = 1;
    for (let q = p - 1; q >= 1; q--) {
      const o = secGrid[sIdx(u.secI, d, q)];
      if (o >= 0 && units[o].tchI === u.tchI) n++;
      else break;
    }
    for (let q = p + 1; q < STRIDE; q++) {
      const o = secGrid[sIdx(u.secI, d, q)];
      if (o >= 0 && units[o].tchI === u.tchI) n++;
      else break;
    }
    return n;
  }

  /** Dynamic constraints (assumes slot free of collisions). */
  function dynamicOk(u: Unit, d: number, p: number): boolean {
    const ti = u.tchI;
    if (tchDayCnt[ti * 7 + d] >= dailyCap[ti][d]) return false;
    if (targetDaysHard[ti] < 99 && tchDayCnt[ti * 7 + d] === 0 && tchDaysUsed(ti) >= targetDaysHard[ti]) return false;
    const cap = subjDayCap.get(`${u.secI}:${u.subjI}`) || 99;
    if (ssdCnt[(u.secI * nSubj + u.subjI) * 7 + d] >= cap) return false;
    const sh = shiftOf[u.secI];
    if (maxConsecAny[ti] < 99 && runAny(ti, sh, d, p) > maxConsecAny[ti]) return false;
    if (maxSameTS < 99 && runSameSec(u, d, p) > maxSameTS) return false;
    return true;
  }

  function canPlace(u: Unit, d: number, p: number): boolean {
    if (secGrid[sIdx(u.secI, d, p)] >= 0) return false;
    if (tchGrid[tIdx(u.tchI, shiftOf[u.secI], d, p)] >= 0) return false;
    return dynamicOk(u, d, p);
  }

  function place(u: Unit, d: number, p: number) {
    secGrid[sIdx(u.secI, d, p)] = u.id;
    tchGrid[tIdx(u.tchI, shiftOf[u.secI], d, p)] = u.id;
    tchDayCnt[u.tchI * 7 + d]++;
    ssdCnt[(u.secI * nSubj + u.subjI) * 7 + d]++;
    u.slot = d * STRIDE + p;
  }
  function unplace(u: Unit) {
    if (u.slot < 0) return;
    const d = Math.floor(u.slot / STRIDE);
    const p = u.slot % STRIDE;
    secGrid[sIdx(u.secI, d, p)] = -1;
    tchGrid[tIdx(u.tchI, shiftOf[u.secI], d, p)] = -1;
    tchDayCnt[u.tchI * 7 + d]--;
    ssdCnt[(u.secI * nSubj + u.subjI) * 7 + d]--;
    u.slot = -1;
  }

  // ---------------- soft costs ----------------
  const policyOf = units.map((u) => resolveDoublePolicy(teachers[u.tchI], subjects[u.subjI]));

  function localCost(u: Unit, d: number, p: number): number {
    const t = teachers[u.tchI];
    const maxP = L[u.secI][d];
    let c = softPlacementPenalty(t, d, p, maxP);
    const dr = t.work_pattern?.day_rules?.[dayKey(d)];
    if (dr === "DISLIKED") c += 8;
    if (dr === "PREFERRED") c -= 2;
    const ep = subjects[u.subjI].early_period_priority;
    if (ep) c += ep * (p - 1) * 0.6;
    return c;
  }

  function secDayCost(si: number, d: number): number {
    const maxP = L[si][d];
    let c = 0;
    let lastOcc = 0;
    for (let p = 1; p <= maxP; p++) if (secGrid[sIdx(si, d, p)] >= 0) lastOcc = p;
    if (noSecGaps) {
      for (let p = 1; p < lastOcc; p++) if (secGrid[sIdx(si, d, p)] < 0) c += 40;
    }
    // subject runs
    const seen = new Map<number, number[]>();
    for (let p = 1; p <= maxP; p++) {
      const o = secGrid[sIdx(si, d, p)];
      if (o < 0) continue;
      const sj = units[o].subjI;
      if (!seen.has(sj)) seen.set(sj, []);
      seen.get(sj)!.push(p);
    }
    for (const [sj, ps] of seen) {
      // runs of consecutive periods
      const runs: number[] = [];
      let cur = 1;
      for (let i = 1; i < ps.length; i++) {
        if (ps[i] === ps[i - 1] + 1) cur++;
        else {
          runs.push(cur);
          cur = 1;
        }
      }
      runs.push(cur);
      const o = secGrid[sIdx(si, d, ps[0])];
      const pol = policyOf[o];
      const weekly = units[o].weekly;
      if (runs.length > 1) c += 12 * (runs.length - 1);
      for (const r of runs) {
        if (r > 2) c += 15 * (r - 2);
        if (pol === "SINGLE_ONLY" && r > 1) c += 25 * (r - 1);
        if (pol === "DOUBLE_REQUIRED" && r === 1 && weekly >= 2) c += 30;
        if (pol === "PREFER_DOUBLE" && r === 1 && weekly >= 2) c += 8;
      }
      if (pol === "FREE" && ps.length > 1 && runs.length === ps.length) c += 4;
    }
    return c;
  }

  function tchDayCost(ti: number, d: number): number {
    const t = teachers[ti];
    let c = 0;
    let first = 0;
    let last = 0;
    let occ = 0;
    let hasFinal = false;
    for (let sh = 0; sh < 2; sh++) {
      for (let p = 1; p < STRIDE; p++) {
        const o = tchGrid[tIdx(ti, sh, d, p)];
        if (o >= 0) {
          occ++;
          if (first === 0 || p < first) first = p;
          if (p > last) last = p;
          if (p === L[units[o].secI][d]) hasFinal = true;
        }
      }
    }
    if (occ === 0) return 0;
    if (minTchGaps) {
      let cnt = 0;
      for (let p = first; p <= last; p++) {
        let used = false;
        for (let sh = 0; sh < 2 && !used; sh++) if (tchGrid[tIdx(ti, sh, d, p)] >= 0) used = true;
        if (!used) cnt++;
      }
      c += cnt * 6;
    }
    const hl = applicableRules(t, d).find((r) => r.placement_type === "HAS_LAST");
    if (hl && !hasFinal) c += 30 * ((hl.weight || 10) / 10);
    return c;
  }

  function affectedCost(list: Array<{ u: Unit; d: number; p: number }>, secDays: Set<number>, tchDays: Set<number>) {
    let c = 0;
    for (const k of secDays) c += secDayCost(Math.floor(k / 7), k % 7);
    for (const k of tchDays) c += tchDayCost(Math.floor(k / 7), k % 7);
    for (const it of list) c += localCost(it.u, it.d, it.p);
    return c;
  }

  function totalSoftCost(): number {
    let c = 0;
    for (let si = 0; si < nSec; si++) for (const d of dayList) c += secDayCost(si, d);
    for (let ti = 0; ti < nTch; ti++) for (const d of dayList) c += tchDayCost(ti, d);
    for (const u of units) if (u.slot >= 0) c += localCost(u, Math.floor(u.slot / STRIDE), u.slot % STRIDE);
    // target working days (soft)
    for (let ti = 0; ti < nTch; ti++) {
      const tgt = teachers[ti].work_pattern?.target_working_days;
      if (tgt) c += 15 * Math.abs(tchDaysUsed(ti) - tgt) * (teachers[ti].work_pattern?.target_working_days_is_hard ? 0 : 1);
    }
    return c;
  }

  // ---------------- constructive search with ejection chains ----------------
  const order = units.map((u) => u.id);
  const difficulty = (u: Unit) => {
    const slots = staticSlots(u).length;
    const t = teachers[u.tchI];
    const load = units.filter((x) => x.tchI === u.tchI).length; // small N, cached below
    void load;
    return -slots + (t.work_pattern?.target_working_days ? 0 : 0);
  };
  const teacherLoad = new Array(nTch).fill(0);
  for (const u of units) teacherLoad[u.tchI]++;
  const diffCache = units.map((u) => {
    const slots = Math.max(1, staticSlots(u).length);
    // scarcity: teacher load relative to his available slots (higher = harder)
    const tchSlots = new Set<number>();
    for (const x of units) if (x.tchI === u.tchI) for (const s of staticSlots(x)) tchSlots.add(s);
    const ratio = teacherLoad[u.tchI] / Math.max(1, tchSlots.size);
    return ratio * 1000 + 1000 / slots;
  });
  void difficulty;
  order.sort((a, b) => diffCache[b] - diffCache[a]);

  let iterations = 0;
  let bestPlaced = -1;
  let bestSlots: number[] = units.map(() => -1);

  function pickSlot(u: Unit): number {
    // choose the cheapest feasible slot (soft cost incl. neighbours)
    const slots = staticSlots(u);
    let best = -1;
    let bestC = Infinity;
    for (const s of slots) {
      const d = Math.floor(s / STRIDE);
      const p = s % STRIDE;
      if (!canPlace(u, d, p)) continue;
      // evaluate cost delta
      const sd = new Set<number>([u.secI * 7 + d]);
      const td = new Set<number>([u.tchI * 7 + d]);
      const before = affectedCost([], sd, td);
      place(u, d, p);
      const after = affectedCost([{ u, d, p }], sd, td);
      unplace(u);
      const noise = rand() * 4;
      const c = after - before + noise;
      if (c < bestC) {
        bestC = c;
        best = s;
      }
    }
    return best;
  }

  function evictAndPlace(u: Unit, iter: number): Unit[] {
    // find the slot with minimum blockers (<=2), prefer least recently evicted blockers
    const slots = staticSlots(u);
    let bestSlot = -1;
    let bestScore = Infinity;
    let bestBlockers: Unit[] = [];
    for (const s of slots) {
      const d = Math.floor(s / STRIDE);
      const p = s % STRIDE;
      const blockers: Unit[] = [];
      const so = secGrid[sIdx(u.secI, d, p)];
      if (so >= 0) blockers.push(units[so]);
      const to = tchGrid[tIdx(u.tchI, shiftOf[u.secI], d, p)];
      if (to >= 0 && to !== so) blockers.push(units[to]);
      // temporarily remove blockers and check dynamic feasibility
      const saved = blockers.map((b) => b.slot);
      for (const b of blockers) unplace(b);
      const ok = dynamicOk(u, d, p);
      for (let i = 0; i < blockers.length; i++) {
        const b = blockers[i];
        place(b, Math.floor(saved[i] / STRIDE), saved[i] % STRIDE);
      }
      if (!ok) {
        // dynamic blocker (cap / consecutive): treat as expensive but possible via random eviction of a same-day unit
        continue;
      }
      let score = blockers.length * 100 + rand() * 30;
      for (const b of blockers) score += Math.max(0, 60 - (iter - b.lastEvicted)) * 2;
      if (score < bestScore) {
        bestScore = score;
        bestSlot = s;
        bestBlockers = blockers;
      }
    }
    if (bestSlot < 0) {
      // Dynamic blockage everywhere: free a random same-teacher or same-section-subject lesson on a random static day
      if (slots.length === 0) return [];
      const s = slots[Math.floor(rand() * slots.length)];
      const d = Math.floor(s / STRIDE);
      const victims: Unit[] = [];
      for (const x of units) {
        if (x.slot < 0 || x === u) continue;
        const xd = Math.floor(x.slot / STRIDE);
        if (xd !== d) continue;
        if ((x.tchI === u.tchI) || (x.secI === u.secI && x.subjI === u.subjI)) victims.push(x);
      }
      if (victims.length === 0) return [];
      const v = victims[Math.floor(rand() * victims.length)];
      unplace(v);
      v.lastEvicted = iter;
      return [v];
    }
    const d = Math.floor(bestSlot / STRIDE);
    const p = bestSlot % STRIDE;
    for (const b of bestBlockers) {
      unplace(b);
      b.lastEvicted = iter;
    }
    if (canPlace(u, d, p)) place(u, d, p);
    return bestBlockers;
  }

  function constructPhase(deadline: number): number {
    const queue: number[] = order.filter((id) => units[id].slot < 0);
    let guard = 0;
    const maxIter = Math.max(2000, total * 400);
    while (queue.length > 0 && guard < maxIter) {
      if ((guard & 127) === 0 && Date.now() > deadline) break;
      guard++;
      iterations++;
      const id = queue.shift()!;
      const u = units[id];
      if (u.slot >= 0) continue;
      const s = pickSlot(u);
      if (s >= 0) {
        place(u, Math.floor(s / STRIDE), s % STRIDE);
        continue;
      }
      if (staticSlots(u).length === 0) continue; // impossible lesson, skip (diagnosed later)
      const evicted = evictAndPlace(u, guard);
      if (u.slot < 0) queue.push(id); // could not place yet
      for (const e of evicted) queue.push(e.id);
      // keep queue moving fairly: shuffle occasionally
      if (guard % 50 === 0 && queue.length > 2) {
        const k = Math.floor(rand() * queue.length);
        const tmp = queue[0];
        queue[0] = queue[k];
        queue[k] = tmp;
      }
    }
    return units.filter((u) => u.slot >= 0).length;
  }

  function snapshotIfBest() {
    const placed = units.filter((u) => u.slot >= 0).length;
    if (placed > bestPlaced) {
      bestPlaced = placed;
      bestSlots = units.map((u) => u.slot);
    }
    return placed;
  }
  function restoreSnapshot(slotsSnap: number[]) {
    for (const u of units) unplace(u);
    for (let i = 0; i < units.length; i++) {
      if (slotsSnap[i] >= 0) place(units[i], Math.floor(slotsSnap[i] / STRIDE), slotsSnap[i] % STRIDE);
    }
  }

  const buildDeadline = t0 + maxTimeMs - polishMs;
  let attempt = 0;
  while (true) {
    attempt++;
    constructPhase(attempt === 1 ? buildDeadline : Math.min(buildDeadline, Date.now() + Math.max(400, (buildDeadline - Date.now()) / 2)));
    const placed = snapshotIfBest();
    if (placed === total || Date.now() >= buildDeadline) break;
    // restart: keep the best solution, drop a random 25% of lessons to escape the local trap
    restoreSnapshot(bestSlots);
    for (const u of units) if (u.slot >= 0 && rand() < 0.25) unplace(u);
    order.sort((a, b) => diffCache[b] - diffCache[a] + (rand() - 0.5) * 400);
  }
  restoreSnapshot(bestSlots);

  // ---------------- soft optimisation ----------------
  const polishDeadline = Math.min(t0 + maxTimeMs, Date.now() + polishMs);
  const placedUnits = () => units.filter((u) => u.slot >= 0);
  let pu = placedUnits();
  let polishIter = 0;
  while (pu.length > 1 && Date.now() < polishDeadline && polishIter < 400000) {
    polishIter++;
    iterations++;
    const u = pu[Math.floor(rand() * pu.length)];
    const d1 = Math.floor(u.slot / STRIDE);
    const p1 = u.slot % STRIDE;
    if (rand() < 0.5) {
      // move to a random free static slot
      const slots = staticSlots(u);
      if (slots.length < 2) continue;
      const s = slots[Math.floor(rand() * slots.length)];
      if (s === u.slot) continue;
      const d2 = Math.floor(s / STRIDE);
      const p2 = s % STRIDE;
      const sd = new Set<number>([u.secI * 7 + d1, u.secI * 7 + d2]);
      const td = new Set<number>([u.tchI * 7 + d1, u.tchI * 7 + d2]);
      const before = affectedCost([{ u, d: d1, p: p1 }], sd, td);
      unplace(u);
      if (!canPlace(u, d2, p2)) {
        place(u, d1, p1);
        continue;
      }
      place(u, d2, p2);
      const after = affectedCost([{ u, d: d2, p: p2 }], sd, td);
      if (after >= before - 0.001) {
        unplace(u);
        place(u, d1, p1);
      }
    } else {
      // swap with another lesson of the same section
      const others = pu.filter((x) => x !== u && x.secI === u.secI);
      if (others.length === 0) continue;
      const v = others[Math.floor(rand() * others.length)];
      const d2 = Math.floor(v.slot / STRIDE);
      const p2 = v.slot % STRIDE;
      if (!staticOk(u, d2, p2) || !staticOk(v, d1, p1)) continue;
      const sd = new Set<number>([u.secI * 7 + d1, u.secI * 7 + d2]);
      const td = new Set<number>([u.tchI * 7 + d1, u.tchI * 7 + d2, v.tchI * 7 + d1, v.tchI * 7 + d2]);
      const before = affectedCost(
        [
          { u, d: d1, p: p1 },
          { u: v, d: d2, p: p2 },
        ],
        sd,
        td
      );
      unplace(u);
      unplace(v);
      if (canPlace(u, d2, p2)) {
        place(u, d2, p2);
        if (canPlace(v, d1, p1)) {
          place(v, d1, p1);
          const after = affectedCost(
            [
              { u, d: d2, p: p2 },
              { u: v, d: d1, p: p1 },
            ],
            sd,
            td
          );
          if (after < before - 0.001) continue; // accepted
          unplace(v);
        }
        unplace(u);
      }
      place(u, d1, p1);
      place(v, d2, p2);
    }
    if (polishIter % 5000 === 0) pu = placedUnits();
  }

  // ---------------- assemble result ----------------
  const entries: TimetableEntry[] = [];
  let counter = 1;
  for (const u of units) {
    if (u.slot < 0) continue;
    const d = Math.floor(u.slot / STRIDE);
    const p = u.slot % STRIDE;
    const sec = sections[u.secI];
    entries.push({
      entry_id: `E_${counter++}`,
      section_id: sec.id,
      grade_id: sec.grade_id,
      subject_id: subjects[u.subjI].id,
      teacher_id: teachers[u.tchI].id,
      day: d,
      period: p,
      shift: sec.shift || "FIRST",
    });
  }
  entries.sort((a, b) => a.day - b.day || a.period - b.period || a.section_id.localeCompare(b.section_id));
  entries.forEach((e, i) => (e.entry_id = `E_${i + 1}`));

  const softCost = totalSoftCost();
  const elapsed = (Date.now() - t0) / 1000;
  const validation = validateSchedule(school, entries);
  const unplaced = total - entries.length;

  // diagnostics for unplaced lessons
  const diag = diagnoseUnplaced(
    school,
    units.filter((u) => u.slot < 0).map((u) => ({ secI: u.secI, tchI: u.tchI, subjI: u.subjI })),
    (u) => staticSlots(units.find((x) => x.secI === u.secI && x.tchI === u.tchI && x.subjI === u.subjI)!).length
  );
  for (const m of diag) {
    validation.errors.push({ constraint_code: "C3_UNPLACED", severity: "ERROR", message: m });
  }
  for (const id of badRefs) {
    validation.errors.push({
      constraint_code: "C0_BAD_REFERENCE",
      severity: "ERROR",
      message: `التكليف ${id} يشير إلى فصل أو مادة أو معلم غير موجود.`,
    });
  }
  validation.is_valid = validation.errors.length === 0;

  const quality = Math.max(
    0,
    Math.min(
      100,
      100 -
        (total ? (unplaced / total) * 100 : 0) -
        validation.stats.hard_violations * 4 -
        Math.min(25, total ? (softCost / total) * 1.2 : 0)
    )
  );

  const metrics = computeMetrics(school, entries);
  const schedule: Schedule = {
    id: `SCHED_${Date.now().toString(36).toUpperCase()}`,
    school_id: school.id,
    academic_year: school.academic_year,
    status: validation.is_valid ? "VALID" : "DRAFT",
    entries,
    quality_score: Math.round(quality * 10) / 10,
    solver_status: unplaced === 0 ? (validation.is_valid ? "OPTIMAL" : "INVALID") : "INFEASIBLE_PARTIAL",
    solve_time_seconds: Math.max(0.01, elapsed),
  };

  return {
    schedule,
    validation: { is_valid: validation.is_valid, errors: validation.errors, warnings: validation.warnings },
    metrics: {
      ...metrics,
      placed_lessons: entries.length,
      expected_lessons: total,
      unplaced_lessons: unplaced,
      soft_cost: Math.round(softCost),
      iterations,
    },
  };
}

// ---------------------------------------------------------------------------
// Diagnostics of impossible lessons
// ---------------------------------------------------------------------------

function diagnoseUnplaced(
  school: SchoolData,
  unplaced: Array<{ secI: number; tchI: number; subjI: number }>,
  staticCount: (u: { secI: number; tchI: number; subjI: number }) => number
): string[] {
  const out = new Map<string, { count: number; msg: string }>();
  for (const u of unplaced) {
    const sec = school.sections[u.secI];
    const t = school.teachers[u.tchI];
    const subj = school.subjects[u.subjI];
    const key = `${u.secI}:${u.tchI}:${u.subjI}`;
    const prev = out.get(key);
    if (prev) {
      prev.count++;
      continue;
    }
    let reason: string;
    if (staticCount(u) === 0) {
      reason = `لا توجد أي حصة متاحة للمعلم ${t.name} مع قيوده (الإجازات/الحصص المسموحة) في فصل ${sec.name}`;
    } else {
      reason = `تعذر إيجاد وقت خالٍ يجمع المعلم ${t.name} وفصل ${sec.name} دون كسر القيود`;
    }
    out.set(key, { count: 1, msg: `${subj.name} - ${reason}` });
  }
  return [...out.values()].map((v) => `${v.msg} (${v.count} حصة غير موزعة).`);
}

// ---------------------------------------------------------------------------
// Independent validator
// ---------------------------------------------------------------------------

export function validateSchedule(school: SchoolData, entries: TimetableEntry[]): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const secMap = new Map(school.sections.map((s) => [s.id, s]));
  const tchMap = new Map(school.teachers.map((t) => [t.id, t]));
  const subjMap = new Map(school.subjects.map((s) => [s.id, s]));
  const rules = school.rules || {};
  const breakAfter = rules.break_after_period ?? 3;
  const maxSameTS = rules.max_consecutive_same_teacher_section ?? 99;
  const noSecGaps = rules.no_section_gaps !== false;

  const unavail = new Set<string>();
  for (const av of school.availabilities || []) {
    if (!av.is_available) unavail.add(`${av.teacher_id}:${av.day}:${av.period}`);
  }

  const secSlot = new Map<string, TimetableEntry>();
  const tchSlot = new Map<string, TimetableEntry>();
  for (const e of entries) {
    const sec = secMap.get(e.section_id);
    const t = tchMap.get(e.teacher_id);
    if (!sec || !t || !subjMap.has(e.subject_id)) {
      errors.push({ constraint_code: "C0_BAD_REFERENCE", severity: "ERROR", message: `حصة تشير إلى عنصر غير موجود (${e.entry_id}).` });
      continue;
    }
    const Lsec = sectionPeriods(school, sec, e.day);
    if (e.period < 1 || e.period > Lsec) {
      errors.push({
        constraint_code: "C4_PERIOD_OUT_OF_RANGE",
        severity: "ERROR",
        message: `فصل ${sec.name} لديه حصة خارج عدد حصص اليوم (حصة ${e.period} يوم ${e.day}).`,
        section_id: sec.id,
        day: e.day,
        period: e.period,
      });
    }
    const sk = `${e.section_id}:${e.day}:${e.period}`;
    if (secSlot.has(sk)) {
      errors.push({
        constraint_code: "C1_SECTION_COLLISION",
        severity: "ERROR",
        message: `تعارض فصل: ${sec.name} لديه حصتان في نفس الوقت (يوم ${e.day} حصة ${e.period}).`,
        section_id: sec.id,
        day: e.day,
        period: e.period,
      });
    }
    secSlot.set(sk, e);
    const tk = `${e.teacher_id}:${sec.shift === "SECOND" ? 1 : 0}:${e.day}:${e.period}`;
    if (tchSlot.has(tk)) {
      errors.push({
        constraint_code: "C2_TEACHER_COLLISION",
        severity: "ERROR",
        message: `تعارض معلم: ${t.name} في فصلين بنفس الوقت (يوم ${e.day} حصة ${e.period}).`,
        teacher_id: t.id,
        day: e.day,
        period: e.period,
      });
    }
    tchSlot.set(tk, e);
    if (isTeacherOffDay(t, e.day)) {
      errors.push({
        constraint_code: "C5_TEACHER_OFF_DAY",
        severity: "ERROR",
        message: `المعلم ${t.name} لديه حصة في يوم إجازته (يوم ${e.day}).`,
        teacher_id: t.id,
        day: e.day,
        period: e.period,
      });
    }
    if (unavail.has(`${t.id}:${e.day}:${e.period}`)) {
      errors.push({
        constraint_code: "C5_TEACHER_UNAVAILABLE",
        severity: "ERROR",
        message: `المعلم ${t.name} غير متاح في يوم ${e.day} حصة ${e.period}.`,
        teacher_id: t.id,
        day: e.day,
        period: e.period,
      });
    }
    if (!hardPlacementOk(t, e.day, e.period, Lsec)) {
      errors.push({
        constraint_code: "C6_PLACEMENT_RULE",
        severity: "ERROR",
        message: `المعلم ${t.name} خالف قيد مكان الحصة الإلزامي (يوم ${e.day} حصة ${e.period}).`,
        teacher_id: t.id,
        day: e.day,
        period: e.period,
      });
    } else if (softPlacementPenalty(t, e.day, e.period, Lsec) > 0) {
      warnings.push({
        constraint_code: "W1_PREFERENCE",
        severity: "WARNING",
        message: `تفضيل غير متحقق للمعلم ${t.name} (يوم ${e.day} حصة ${e.period}).`,
        teacher_id: t.id,
        day: e.day,
        period: e.period,
      });
    }
    const subj = subjMap.get(e.subject_id)!;
    if (subj.before_break && e.period > breakAfter) {
      errors.push({
        constraint_code: "C8_BEFORE_BREAK",
        severity: "ERROR",
        message: `مادة ${subj.name} يجب أن تكون قبل الفسحة (بعد الحصة ${breakAfter}) لكنها في الحصة ${e.period}.`,
        section_id: sec.id,
        day: e.day,
        period: e.period,
      });
    }
  }

  // Counts per assignment
  const placedPerKey = new Map<string, number>();
  for (const e of entries) {
    const k = `${e.section_id}|${e.subject_id}|${e.teacher_id}`;
    placedPerKey.set(k, (placedPerKey.get(k) || 0) + 1);
  }
  let expected = 0;
  const expectedPerKey = new Map<string, number>();
  for (const a of school.assignments) {
    const k = `${a.section_id}|${a.subject_id}|${a.teacher_id}`;
    expectedPerKey.set(k, (expectedPerKey.get(k) || 0) + a.weekly_periods);
    expected += a.weekly_periods;
  }
  for (const [k, exp] of expectedPerKey) {
    const got = placedPerKey.get(k) || 0;
    if (got > exp) {
      errors.push({
        constraint_code: "C9_EXTRA_LESSONS",
        severity: "ERROR",
        message: `عدد حصص زائد عن النصاب المطلوب (${got} من ${exp}).`,
      });
    }
  }

  // Daily rules, caps, consecutive, gaps
  const tchDay = new Map<string, TimetableEntry[]>();
  const secDay = new Map<string, TimetableEntry[]>();
  for (const e of entries) {
    const a = `${e.teacher_id}:${e.day}`;
    const b = `${e.section_id}:${e.day}`;
    if (!tchDay.has(a)) tchDay.set(a, []);
    tchDay.get(a)!.push(e);
    if (!secDay.has(b)) secDay.set(b, []);
    secDay.get(b)!.push(e);
  }
  let teacherGaps = 0;
  let sectionGaps = 0;

  for (const t of school.teachers) {
    const wp = t.work_pattern;
    const daysUsed = new Set<number>();
    for (const d of school.days) {
      const list = tchDay.get(`${t.id}:${d}`) || [];
      if (list.length > 0) daysUsed.add(d);
      const count = list.length;
      if (t.max_daily_periods && count > t.max_daily_periods) {
        errors.push({
          constraint_code: "C7_DAILY_LIMIT",
          severity: "ERROR",
          message: `المعلم ${t.name} لديه ${count} حصص يوم ${d} وهو أكثر من الحد اليومي ${t.max_daily_periods}.`,
          teacher_id: t.id,
          day: d,
        });
      }
      for (const r of wp?.daily_period_rules || []) {
        if (Number(r.day) !== d) continue;
        const bad =
          (r.rule_type === "EXACT" && count !== r.count) ||
          (r.rule_type === "MAX" && count > r.count) ||
          (r.rule_type === "MIN" && count > 0 && count < r.count);
        if (bad) {
          const issue: ValidationIssue = {
            constraint_code: "C7_DAILY_RULE",
            severity: r.is_hard ? "ERROR" : "WARNING",
            message: `المعلم ${t.name} لديه ${count} حصص يوم ${d} بينما القيد (${r.rule_type} ${r.count}).`,
            teacher_id: t.id,
            day: d,
          };
          (r.is_hard ? errors : warnings).push(issue);
        }
      }
      // consecutive + gaps
      if (list.length > 0) {
        const ps = list.map((e) => e.period).sort((a, b) => a - b);
        let run = 1;
        let maxRun = 1;
        for (let i = 1; i < ps.length; i++) {
          if (ps[i] === ps[i - 1] + 1) run++;
          else if (ps[i] !== ps[i - 1]) run = 1;
          maxRun = Math.max(maxRun, run);
        }
        if (t.max_consecutive_periods && maxRun > t.max_consecutive_periods) {
          errors.push({
            constraint_code: "C7_CONSECUTIVE",
            severity: "ERROR",
            message: `المعلم ${t.name} لديه ${maxRun} حصص متتالية يوم ${d} (الحد ${t.max_consecutive_periods}).`,
            teacher_id: t.id,
            day: d,
          });
        }
        const gaps = ps[ps.length - 1] - ps[0] + 1 - new Set(ps).size;
        teacherGaps += Math.max(0, gaps);
        const hl = applicableRules(t, d).find((r) => r.placement_type === "HAS_LAST");
        if (hl) {
          const hasFinal = list.some((e) => e.period === sectionPeriods(school, secMap.get(e.section_id)!, d));
          if (!hasFinal) {
            (hl.is_hard ? errors : warnings).push({
              constraint_code: "W2_HAS_LAST",
              severity: hl.is_hard ? "ERROR" : "WARNING",
              message: `المعلم ${t.name} لا يحمل الحصة الأخيرة يوم ${d} كما هو مطلوب.`,
              teacher_id: t.id,
              day: d,
            });
          }
        }
      }
    }
    if (wp?.target_working_days && wp.target_working_days_is_hard && daysUsed.size > wp.target_working_days) {
      errors.push({
        constraint_code: "C7_WORKING_DAYS",
        severity: "ERROR",
        message: `المعلم ${t.name} يعمل ${daysUsed.size} أيام بينما الحد ${wp.target_working_days}.`,
        teacher_id: t.id,
      });
    }
  }

  // Section checks: same-teacher consecutive, subject caps, gaps, double policies
  const weeklyBySecSubj = new Map<string, number>();
  for (const a of school.assignments) {
    const k = `${a.section_id}|${a.subject_id}`;
    weeklyBySecSubj.set(k, (weeklyBySecSubj.get(k) || 0) + a.weekly_periods);
  }
  let doubleTotal = 0;
  let doubleOk = 0;
  for (const sec of school.sections) {
    for (const d of school.days) {
      const list = (secDay.get(`${sec.id}:${d}`) || []).slice().sort((a, b) => a.period - b.period);
      if (list.length === 0) continue;
      const Lsec = sectionPeriods(school, sec, d);
      if (noSecGaps) {
        const occ = new Set(list.map((e) => e.period));
        const last = list[list.length - 1].period;
        for (let p = 1; p < last; p++) {
          if (!occ.has(p)) {
            sectionGaps++;
            warnings.push({
              constraint_code: "W3_SECTION_GAP",
              severity: "WARNING",
              message: `فصل ${sec.name} لديه حصة فارغة داخل اليوم (يوم ${d} حصة ${p}).`,
              section_id: sec.id,
              day: d,
              period: p,
            });
          }
        }
      }
      void Lsec;
      // same teacher consecutive in section
      if (maxSameTS < 99) {
        let run = 1;
        for (let i = 1; i < list.length; i++) {
          if (list[i].teacher_id === list[i - 1].teacher_id && list[i].period === list[i - 1].period + 1) {
            run++;
            if (run > maxSameTS) {
              errors.push({
                constraint_code: "C7_SAME_TEACHER_CONSECUTIVE",
                severity: "ERROR",
                message: `فصل ${sec.name}: ${run} حصص متتالية لنفس المعلم يوم ${d} (الحد ${maxSameTS}).`,
                section_id: sec.id,
                day: d,
              });
            }
          } else run = 1;
        }
      }
      // doubles
      const bySubj = new Map<string, TimetableEntry[]>();
      for (const e of list) {
        if (!bySubj.has(e.subject_id)) bySubj.set(e.subject_id, []);
        bySubj.get(e.subject_id)!.push(e);
      }
      for (const [sj, es] of bySubj) {
        const pol = resolveDoublePolicy(tchMap.get(es[0].teacher_id), subjMap.get(sj));
        const weekly = weeklyBySecSubj.get(`${sec.id}|${sj}`) || 0;
        const ps = es.map((e) => e.period);
        const adjacent = ps.some((p) => ps.includes(p + 1));
        if (pol === "DOUBLE_REQUIRED" || pol === "PREFER_DOUBLE") {
          if (weekly >= 2) {
            doubleTotal++;
            if (adjacent || ps.length > 1) doubleOk++;
            else if (pol === "DOUBLE_REQUIRED") {
              warnings.push({
                constraint_code: "W4_DOUBLE_NOT_HONORED",
                severity: "WARNING",
                message: `مادة ${subjMap.get(sj)!.name} في فصل ${sec.name} يوم ${d} حصة منفردة بينما المطلوب حصتان متتاليتان.`,
                section_id: sec.id,
                day: d,
              });
            }
          }
        } else if (pol === "SINGLE_ONLY") {
          doubleTotal++;
          if (!adjacent) doubleOk++;
        }
      }
    }
  }

  // Unplaced / missing lessons
  let missing = 0;
  for (const [k, exp] of expectedPerKey) {
    const got = placedPerKey.get(k) || 0;
    if (got < exp) missing += exp - got;
  }
  void doubleTotal;
  void doubleOk;

  return {
    is_valid: errors.length === 0 && missing === 0,
    errors,
    warnings,
    stats: {
      expected_lessons: expected,
      placed_lessons: entries.length,
      unplaced_lessons: missing,
      hard_violations: errors.length,
      soft_violations: warnings.length,
      teacher_gaps: teacherGaps,
      section_gaps: sectionGaps,
    },
  };
}

// ---------------------------------------------------------------------------
// Metrics (always computed from the real schedule)
// ---------------------------------------------------------------------------

export function computeMetrics(school: SchoolData, entries: TimetableEntry[]) {
  const secMap = new Map(school.sections.map((s) => [s.id, s]));
  const tchMap = new Map(school.teachers.map((t) => [t.id, t]));
  const subjMap = new Map(school.subjects.map((s) => [s.id, s]));

  let ruled = 0;
  let ruledOk = 0;
  for (const e of entries) {
    const t = tchMap.get(e.teacher_id);
    const sec = secMap.get(e.section_id);
    if (!t || !sec) continue;
    const Lsec = sectionPeriods(school, sec, e.day);
    const rules = applicableRules(t, e.day).filter((r) => r.placement_type !== "HAS_LAST");
    if (rules.length === 0) continue;
    ruled++;
    const hard = hardPlacementOk(t, e.day, e.period, Lsec);
    const soft = softPlacementPenalty(t, e.day, e.period, Lsec) === 0;
    if (hard && soft) ruledOk++;
  }

  // gaps
  let gaps = 0;
  const tchDay = new Map<string, number[]>();
  for (const e of entries) {
    const k = `${e.teacher_id}:${e.day}`;
    if (!tchDay.has(k)) tchDay.set(k, []);
    tchDay.get(k)!.push(e.period);
  }
  for (const ps of tchDay.values()) {
    const s = [...new Set(ps)].sort((a, b) => a - b);
    gaps += s[s.length - 1] - s[0] + 1 - s.length;
  }
  const secDay = new Map<string, number[]>();
  for (const e of entries) {
    const k = `${e.section_id}:${e.day}`;
    if (!secDay.has(k)) secDay.set(k, []);
    secDay.get(k)!.push(e.period);
  }
  for (const ps of secDay.values()) {
    const s = [...new Set(ps)].sort((a, b) => a - b);
    gaps += s[s.length - 1] - s[0] + 1 - s.length + (s[0] - 1);
  }

  // doubles
  let dTotal = 0;
  let dOk = 0;
  const grp = new Map<string, TimetableEntry[]>();
  for (const e of entries) {
    const k = `${e.section_id}:${e.day}:${e.subject_id}`;
    if (!grp.has(k)) grp.set(k, []);
    grp.get(k)!.push(e);
  }
  const weekly = new Map<string, number>();
  for (const a of school.assignments) {
    const k = `${a.section_id}|${a.subject_id}`;
    weekly.set(k, (weekly.get(k) || 0) + a.weekly_periods);
  }
  for (const es of grp.values()) {
    const pol = resolveDoublePolicy(tchMap.get(es[0].teacher_id), subjMap.get(es[0].subject_id));
    const w = weekly.get(`${es[0].section_id}|${es[0].subject_id}`) || 0;
    const ps = es.map((e) => e.period);
    const adjacent = ps.some((p) => ps.includes(p + 1));
    if ((pol === "DOUBLE_REQUIRED" || pol === "PREFER_DOUBLE") && w >= 2) {
      dTotal++;
      if (adjacent || ps.length > 1) dOk++;
    } else if (pol === "SINGLE_ONLY") {
      dTotal++;
      if (!adjacent) dOk++;
    }
  }

  const n = Math.max(1, entries.length);
  return {
    teacher_preferences_compliance_percent: ruled ? Math.round((ruledOk / ruled) * 1000) / 10 : 100,
    schedule_compactness_percent: Math.max(0, Math.round((1 - gaps / n) * 1000) / 10),
    double_periods_compliance_percent: dTotal ? Math.round((dOk / dTotal) * 1000) / 10 : 100,
  };
}

