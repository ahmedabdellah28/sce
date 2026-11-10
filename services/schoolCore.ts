/**
 * School core: compact schema -> SchoolData builder, sanitiser, patch operations (used by the AI agent),
 * canonical Markdown generation and a deterministic Markdown/Arabic-text parser.
 *
 * Pure TypeScript — shared by the browser app and server.ts. No Gemini dependency:
 * Gemini only produces a CompactSchool / Op[] which this module turns into validated SchoolData.
 */

import type {
  DailyPlacementRule,
  Grade,
  SchoolData,
  Section,
  Subject,
  Teacher,
  TeachingAssignment,
  TeacherWorkPattern,
} from "../types.ts";
import {
  DAY_LABEL,
  type CompactRule,
  type ParsedRuleText,
  dayFromToken,
  findSectionCodes,
  normAr,
  numberFromWord,
  parseDayRange,
  parseDaysList,
  parseRuleText,
} from "./arabicRules.ts";

export type { CompactRule } from "./arabicRules.ts";
export { normAr } from "./arabicRules.ts";

// ---------------------------------------------------------------------------
// Compact schema (what Gemini / the deterministic parser produce)
// ---------------------------------------------------------------------------

export interface CompactAssignment {
  section: string; // "1/1"
  periods: number;
  subject?: string;
}

export interface CompactTeacher {
  name: string;
  subject?: string;
  work_days?: number[] | null;
  off_days?: number[];
  max_daily?: number;
  max_weekly?: number;
  max_consecutive?: number;
  target_days?: number;
  double?: "REQUIRED" | "SINGLE" | "PREFER" | "FREE";
  day_counts?: Array<{ day: number; count: number; type?: "EXACT" | "MAX" | "MIN" }>;
  rules?: CompactRule[];
  last_period_target?: number;
  notes?: string;
  assignments: CompactAssignment[];
}

export interface CompactSubject {
  name: string;
  before_break?: boolean;
  double?: "REQUIRED" | "SINGLE" | "FREE";
  max_daily?: number;
  early_priority?: number;
}

export interface CompactSchool {
  name?: string;
  stage?: string;
  academic_year?: string;
  days?: number[];
  /** Either one number for every day, an array aligned with `days`, or a {day: n} record. */
  periods_per_day?: number;
  periods_by_day?: number[] | Record<string, number>;
  sections: string[];
  subjects?: CompactSubject[];
  teachers: CompactTeacher[];
  rules?: SchoolData["rules"];
}

// ---------------------------------------------------------------------------
// Subject canonicalisation
// ---------------------------------------------------------------------------

interface CanonSubject {
  name: string;
  keys: string[];
  defaults?: Partial<Subject>;
}

const CANON: CanonSubject[] = [
  { name: "التربية الرياضية", keys: ["تربيه رياضيه", "العاب", "رياضه بدنيه", "تربيه بدنيه"], defaults: { allow_consecutive: false, max_daily_occurrences: 1 } },
  { name: "التربية الفنية", keys: ["تربيه فنيه", "رسم", "فنيه", "فنون"], defaults: { allow_consecutive: false, max_daily_occurrences: 1 } },
  { name: "التربية الدينية", keys: ["تربيه دينيه", "دين", "ديني", "اسلاميه", "قران", "تربيه اسلاميه"] },
  { name: "اللغة العربية", keys: ["لغه عربيه", "عربي", "عربيه", "العربي"] },
  { name: "اللغة الإنجليزية", keys: ["لغه انجليزيه", "انجليزي", "انجليزيه", "انجلش", "english"] },
  { name: "الرياضيات", keys: ["رياضيات", "حساب", "math", "رياضايات"] },
  { name: "العلوم", keys: ["علوم", "science"] },
  { name: "الدراسات الاجتماعية", keys: ["دراسات اجتماعيه", "دراسات", "اجتماعيات", "تاريخ وجغرافيا"] },
  { name: "الحاسب الآلي", keys: ["حاسب الي", "حاسب", "كمبيوتر", "ict", "تكنولوجيا المعلومات"] },
  { name: "المجالات والأنشطة", keys: ["مجالات", "نشاط", "انشطه", "الانشطه", "نشاط تربوي"], defaults: { allow_consecutive: false, max_daily_occurrences: 1 } },
  { name: "المكتبة", keys: ["مكتبه"], defaults: { allow_consecutive: false, max_daily_occurrences: 1 } },
  { name: "الموسيقى", keys: ["موسيقي", "موسيقى", "تربيه موسيقيه"], defaults: { allow_consecutive: false, max_daily_occurrences: 1 } },
];

/** Returns the canonical subject for a header/word, or null when unknown. */
export function canonicalSubject(text: string): { name: string; defaults?: Partial<Subject> } | null {
  const n = normAr(text).replace(/[()":：\-–—*#.]/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return null;
  const stripAllAl = (s: string) => s.split(" ").map((w) => w.replace(/^ال/, "")).filter(Boolean).join(" ");
  const cleanN = stripAllAl(n);
  const padded = ` ${cleanN} `;
  const origPadded = ` ${n} `;

  // longest keys first so "تربيه رياضيه" wins over "رياضيات"
  const all = CANON.flatMap((c) => c.keys.map((k) => ({ c, k }))).sort((a, b) => b.k.length - a.k.length);
  for (const { c, k } of all) {
    const nk = normAr(k);
    const cleanK = stripAllAl(nk);
    if (padded.includes(` ${cleanK} `) || origPadded.includes(` ${nk} `) || origPadded.includes(` ال${nk} `) || origPadded.includes(` و${nk} `)) {
      return { name: c.name, defaults: c.defaults };
    }
  }
  for (const { c, k } of all) {
    const cleanK = stripAllAl(normAr(k));
    if (cleanK.length >= 4 && cleanN.split(" ").some((tok) => tok.startsWith(cleanK))) {
      return { name: c.name, defaults: c.defaults };
    }
  }
  return null;
}

export function canonicalSubjectsInHeader(text: string): string[] {
  // "العربي و الدين" -> both subjects (order preserved)
  const parts = normAr(text)
    .replace(/[()":：]/g, " ")
    .split(/\s+و\s+|\s*[،,\/]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const c = canonicalSubject(p);
    if (c && !out.includes(c.name)) out.push(c.name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build SchoolData from the compact schema
// ---------------------------------------------------------------------------

const GRADE_NAMES: Record<number, string> = {
  1: "الأول",
  2: "الثاني",
  3: "الثالث",
  4: "الرابع",
  5: "الخامس",
  6: "السادس",
  7: "السابع",
  8: "الثامن",
  9: "التاسع",
};

function stageSuffix(stage?: string): string {
  const n = normAr(stage || "");
  if (n.includes("ابتدائ")) return " الابتدائي";
  if (n.includes("اعدادي")) return " الإعدادي";
  if (n.includes("ثانوي")) return " الثانوي";
  return "";
}

export function parseSectionParts(code: string): { grade: number; idx: number } | null {
  const m = code.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  return { grade: Number(m[1]), idx: Number(m[2]) };
}

function cloneJson<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

function emptyPattern(): TeacherWorkPattern {
  return { day_rules: {}, daily_period_rules: [], placement_rules: [] };
}

export interface SchoolCapacityValidation {
  is_valid: boolean;
  total_capacity: number;
  total_assigned: number;
  errors: string[];
  warnings: string[];
  per_section: Array<{
    section_id: string;
    section_name: string;
    capacity: number;
    assigned: number;
    diff: number;
  }>;
}

export function validateSchoolCapacity(school: SchoolData): SchoolCapacityValidation {
  const days = school.days && school.days.length ? school.days : [0, 1, 2, 3, 4];
  const defaultPeriods = school.periods_per_day || 7;
  let totalCapacity = 0;
  let totalAssigned = 0;
  const errors: string[] = [];
  const warnings: string[] = [];
  const perSection: SchoolCapacityValidation["per_section"] = [];

  for (const sec of school.sections || []) {
    let secCap = 0;
    for (const d of days) {
      const p = (sec.daily_period_limits && sec.daily_period_limits[String(d)]) ?? defaultPeriods;
      secCap += p;
    }
    const secAssigned = (school.assignments || [])
      .filter((a) => a.section_id === sec.id)
      .reduce((s, a) => s + (a.weekly_periods || 0), 0);

    totalCapacity += secCap;
    totalAssigned += secAssigned;

    const diff = secAssigned - secCap;
    perSection.push({
      section_id: sec.id,
      section_name: sec.name || sec.code,
      capacity: secCap,
      assigned: secAssigned,
      diff,
    });

    if (diff > 0) {
      errors.push(
        `تجاوز سعة الفصل: الفصل "${sec.name || sec.code}" مسند له ${secAssigned} حصة أسبوعياً بينما طاقته الاستيعابية ${secCap} حصة (زيادة ${diff} حصة).`
      );
    } else if (diff < 0) {
      warnings.push(
        `عجز حصص: الفصل "${sec.name || sec.code}" مسند له ${secAssigned} حصة من أصل ${secCap} حصة متاحة (يتبقى ${-diff} حصة شاغرة).`
      );
    }
  }

  if (totalAssigned > totalCapacity) {
    errors.unshift(
      `تجاوز الطاقة الاستيعابية الإجمالية: إجمالي الحصص المسندة بالمدرسة (${totalAssigned}) يتجاوز السعة الكلية لجميع الفصول (${totalCapacity}) بفارق ${totalAssigned - totalCapacity} حصة.`
    );
  }

  return {
    is_valid: errors.length === 0,
    total_capacity: totalCapacity,
    total_assigned: totalAssigned,
    errors,
    warnings,
    per_section: perSection,
  };
}

export interface BuildResult {
  school: SchoolData;
  notes: string[];
  unparsed_notes?: string[];
  capacity_validation?: SchoolCapacityValidation;
}

export function buildSchoolFromCompact(c: CompactSchool, idSeed?: string): BuildResult {
  const notes: string[] = [];
  const days = (c.days && c.days.length ? [...new Set(c.days)] : [0, 1, 2, 3, 4]).sort((a, b) => a - b);
  // Period limits per day
  const defaultPeriods = Number(c.periods_per_day) || 0;
  const limits: Record<string, number> = {};
  if (Array.isArray(c.periods_by_day)) {
    days.forEach((d, i) => {
      const v = Number(c.periods_by_day![i]);
      if (v > 0) limits[String(d)] = v;
    });
  } else if (c.periods_by_day && typeof c.periods_by_day === "object") {
    for (const [k, v] of Object.entries(c.periods_by_day)) if (Number(v) > 0) limits[String(k)] = Number(v);
  }
  let fallback = defaultPeriods || Math.max(0, ...Object.values(limits)) || 7;
  if (!defaultPeriods && Object.keys(limits).length === 0) notes.push("لم يتم تحديد عدد الحصص اليومية، تم افتراض 7 حصص.");
  for (const d of days) if (!limits[String(d)]) limits[String(d)] = Object.keys(limits).length > 0 && !defaultPeriods ? fallback : defaultPeriods || fallback;
  fallback = Math.max(...days.map((d) => limits[String(d)]));
  const uniformLimits = new Set(days.map((d) => limits[String(d)])).size === 1;

  // Sections / grades
  const sectionCodes: string[] = [];
  const addCode = (raw: string) => {
    const code = (raw || "").replace(/\s+/g, "").replace(/\\/g, "/");
    if (code && !sectionCodes.includes(code)) sectionCodes.push(code);
  };
  for (const s of c.sections || []) addCode(s);
  for (const t of c.teachers || []) for (const a of t.assignments || []) addCode(a.section);
  sectionCodes.sort((a, b) => {
    const pa = parseSectionParts(a);
    const pb = parseSectionParts(b);
    if (pa && pb) return pa.grade - pb.grade || pa.idx - pb.idx;
    return a.localeCompare(b);
  });

  const gradeMap = new Map<string, Grade>();
  const sections: Section[] = [];
  const suffix = stageSuffix(c.stage);
  for (const code of sectionCodes) {
    const parts = parseSectionParts(code);
    const gNum = parts ? parts.grade : 1;
    const gid = `G_${gNum}`;
    if (!gradeMap.has(gid)) {
      gradeMap.set(gid, {
        id: gid,
        name: `الصف ${GRADE_NAMES[gNum] || gNum}${suffix}`,
        code: `G${gNum}`,
        order: gNum,
        ...(uniformLimits ? {} : { daily_period_limits: { ...limits } }),
      });
    }
    sections.push({
      id: `SEC_${code.replace("/", "_")}`,
      grade_id: gid,
      name: code,
      code,
      ...(uniformLimits ? {} : { daily_period_limits: { ...limits } }),
    });
  }
  const grades = [...gradeMap.values()].sort((a, b) => a.order - b.order);

  // Subjects
  const subjects: Subject[] = [];
  const subjByName = new Map<string, Subject>();
  const getSubject = (rawName: string): Subject => {
    const canon = canonicalSubject(rawName);
    const name = canon?.name || rawName.trim() || "مادة عامة";
    const key = normAr(name);
    let s = subjByName.get(key);
    if (!s) {
      s = {
        id: `SUB_${subjects.length + 1}`,
        name,
        code: name.split(" ").slice(-1)[0] || name,
        ...(canon?.defaults || {}),
      } as Subject;
      subjects.push(s);
      subjByName.set(key, s);
    }
    return s;
  };
  for (const cs of c.subjects || []) {
    const s = getSubject(cs.name);
    if (cs.before_break) s.before_break = true;
    if (cs.double === "REQUIRED") s.double_period_policy = "DOUBLE_REQUIRED";
    if (cs.double === "SINGLE") s.double_period_policy = "SINGLE_ONLY";
    if (cs.max_daily) s.max_daily_occurrences = cs.max_daily;
    if (cs.early_priority) s.early_period_priority = cs.early_priority;
  }

  // Teachers
  const teachers: Teacher[] = [];
  const teacherByName = new Map<string, Teacher>();
  const assignments: TeachingAssignment[] = [];
  for (const ct of c.teachers || []) {
    const nm = (ct.name || "").trim();
    if (!nm) continue;
    const key = normAr(nm);
    let t = teacherByName.get(key);
    if (!t) {
      t = {
        id: `TCH_${teachers.length + 1}`,
        name: nm,
        code: nm.split(" ")[0],
        work_pattern: emptyPattern(),
      };
      teachers.push(t);
      teacherByName.set(key, t);
    }
    const wp = t.work_pattern!;
    if (ct.work_days && ct.work_days.length) {
      for (const d of days) if (!ct.work_days.includes(d)) wp.day_rules[String(d)] = "MANDATORY_OFF";
      wp.target_working_days = ct.work_days.filter((d) => days.includes(d)).length;
    }
    for (const d of ct.off_days || []) if (days.includes(d)) wp.day_rules[String(d)] = "MANDATORY_OFF";
    if (ct.max_daily) t.max_daily_periods = ct.max_daily;
    if (ct.max_weekly) t.max_weekly_periods = ct.max_weekly;
    if (ct.max_consecutive) t.max_consecutive_periods = ct.max_consecutive;
    if (ct.target_days) {
      wp.target_working_days = ct.target_days;
      wp.target_working_days_is_hard = true;
    }
    if (ct.double === "REQUIRED") wp.double_period_policy = "DOUBLE_REQUIRED";
    else if (ct.double === "SINGLE") wp.double_period_policy = "SINGLE_ONLY";
    else if (ct.double === "PREFER") t.force_double_periods = true;
    for (const dc of ct.day_counts || []) {
      wp.daily_period_rules = wp.daily_period_rules.filter((r) => Number(r.day) !== dc.day);
      wp.daily_period_rules.push({ day: dc.day, rule_type: dc.type || "EXACT", count: dc.count, is_hard: true, weight: 10 });
    }
    for (const r of ct.rules || []) {
      const rule: DailyPlacementRule = {
        day: r.day === undefined ? null : r.day,
        placement_type: r.type,
        n_periods: r.n ?? null,
        exact_periods: r.periods || [],
        is_hard: r.hard !== false,
        weight: r.weight ?? (r.hard === false ? 9 : 10),
      };
      const dupe = wp.placement_rules.find(
        (x) => x.day === rule.day && x.placement_type === rule.placement_type && JSON.stringify(x.exact_periods) === JSON.stringify(rule.exact_periods) && x.n_periods === rule.n_periods
      );
      if (!dupe) wp.placement_rules.push(rule);
    }
    if (ct.last_period_target) {
      wp.last_period_target = ct.last_period_target;
      wp.last_period_is_exact = false;
    }
    if (ct.notes) t.notes = [t.notes, ct.notes].filter(Boolean).join(" | ");

    for (const a of ct.assignments || []) {
      const secCode = (a.section || "").replace(/\s+/g, "").replace(/\\/g, "/");
      const sec = sections.find((s) => s.code === secCode);
      if (!sec) {
        notes.push(`تم تجاهل تكليف لفصل غير معروف (${a.section}) للمعلم ${nm}.`);
        continue;
      }
      if (!(a.periods > 0)) continue;
      const subj = getSubject(a.subject || ct.subject || "مادة عامة");
      const existing = assignments.find((x) => x.section_id === sec.id && x.subject_id === subj.id && x.teacher_id === t!.id);
      if (existing) {
        existing.weekly_periods = Math.max(existing.weekly_periods, a.periods);
      } else {
        assignments.push({
          id: `ASG_${assignments.length + 1}`,
          section_id: sec.id,
          subject_id: subj.id,
          teacher_id: t.id,
          weekly_periods: a.periods,
        });
      }
    }
  }

  // Drop empty "teachers" that have no assignments and no content? keep (user might add later).
  const school: SchoolData = {
    id: idSeed || "sch_" + Date.now().toString(36),
    name: c.name || "مدرسة جديدة",
    academic_year: c.academic_year || "2025/2026",
    shift_mode: "SINGLE",
    days,
    periods_per_day: fallback,
    grades,
    sections,
    subjects,
    teachers,
    availabilities: [],
    assignments,
    rules: {
      break_after_period: c.rules?.break_after_period ?? 3,
      ...(c.rules?.max_consecutive_same_teacher_section ? { max_consecutive_same_teacher_section: c.rules.max_consecutive_same_teacher_section } : {}),
      ...(c.rules?.no_section_gaps === false ? { no_section_gaps: false } : {}),
      ...(c.rules?.minimize_teacher_gaps === false ? { minimize_teacher_gaps: false } : {}),
    },
  };

  const capacityValidation = validateSchoolCapacity(school);
  if (!capacityValidation.is_valid) {
    for (const err of capacityValidation.errors) {
      notes.push(err);
    }
  }

  return { school, notes, capacity_validation: capacityValidation };
}

// ---------------------------------------------------------------------------
// Sanitiser (for AI output / saved data)
// ---------------------------------------------------------------------------

export function sanitizeSchool(raw: any): { school: SchoolData; issues: string[] } {
  const issues: string[] = [];
  const s: SchoolData = cloneJson(raw || {});
  s.id = s.id || "sch_" + Date.now().toString(36);
  s.name = s.name || "مدرسة جديدة";
  s.academic_year = s.academic_year || "2025/2026";
  s.days = Array.isArray(s.days) && s.days.length ? [...new Set(s.days.map(Number))].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b) : [0, 1, 2, 3, 4];
  s.grades = Array.isArray(s.grades) ? s.grades : [];
  s.sections = Array.isArray(s.sections) ? s.sections : [];
  s.subjects = Array.isArray(s.subjects) ? s.subjects : [];
  s.teachers = Array.isArray(s.teachers) ? s.teachers : [];
  s.assignments = Array.isArray(s.assignments) ? s.assignments : [];
  s.availabilities = Array.isArray(s.availabilities) ? s.availabilities : [];
  s.rules = s.rules && typeof s.rules === "object" ? s.rules : {};
  if (typeof s.periods_per_day === "object" && s.periods_per_day) {
    const vals = Object.values(s.periods_per_day as any).map(Number);
    const perDay = s.periods_per_day as any;
    for (const sec of s.sections) sec.daily_period_limits = { ...(sec.daily_period_limits || {}), ...perDay };
    s.periods_per_day = Math.max(0, ...vals) || 7;
    issues.push("تم تحويل عدد الحصص اليومية من كائن إلى حدود لكل فصل.");
  }
  s.periods_per_day = Math.max(1, Math.min(13, Number(s.periods_per_day) || 7));

  const uniq = <T extends { id: string }>(arr: T[], prefix: string): T[] => {
    const seen = new Set<string>();
    return arr.map((x, i) => {
      let id = x.id || `${prefix}_${i + 1}`;
      while (seen.has(id)) id = `${id}_${i + 1}`;
      seen.add(id);
      return { ...x, id };
    });
  };
  s.sections = uniq(s.sections, "SEC");
  s.subjects = uniq(s.subjects, "SUB");
  s.teachers = uniq(s.teachers, "TCH");
  s.grades = uniq(s.grades, "G");
  const gradeIds = new Set(s.grades.map((g) => g.id));
  for (const sec of s.sections) {
    if (!gradeIds.has(sec.grade_id)) {
      const parts = parseSectionParts(sec.code || sec.name || "");
      const gid = `G_${parts?.grade ?? 1}`;
      if (!gradeIds.has(gid)) {
        s.grades.push({ id: gid, name: `الصف ${GRADE_NAMES[parts?.grade ?? 1] || parts?.grade || 1}`, code: `G${parts?.grade ?? 1}`, order: parts?.grade ?? 1 });
        gradeIds.add(gid);
      }
      sec.grade_id = gid;
    }
    sec.code = sec.code || sec.name;
  }
  for (const t of s.teachers) {
    t.work_pattern = t.work_pattern || emptyPattern();
    t.work_pattern.day_rules = t.work_pattern.day_rules || {};
    t.work_pattern.daily_period_rules = t.work_pattern.daily_period_rules || [];
    t.work_pattern.placement_rules = (t.work_pattern.placement_rules || []).map((r: any) => ({
      day: r.day === undefined ? null : r.day,
      placement_type: r.placement_type,
      n_periods: r.n_periods ?? null,
      exact_periods: r.exact_periods || [],
      is_hard: r.is_hard !== false,
      weight: r.weight ?? 10,
    }));
  }
  const secIds = new Set(s.sections.map((x) => x.id));
  const subIds = new Set(s.subjects.map((x) => x.id));
  const tchIds = new Set(s.teachers.map((x) => x.id));
  const before = s.assignments.length;
  s.assignments = s.assignments.filter((a) => {
    const ok = secIds.has(a.section_id) && subIds.has(a.subject_id) && tchIds.has(a.teacher_id) && Number(a.weekly_periods) > 0;
    if (!ok) issues.push(`تم حذف تكليف غير صالح (${a.id || "؟"}).`);
    return ok;
  });
  s.assignments = uniq(s.assignments, "ASG").map((a) => ({ ...a, weekly_periods: Math.round(Number(a.weekly_periods)) }));
  if (before !== s.assignments.length) issues.push(`تم حذف ${before - s.assignments.length} تكليفاً غير صالح.`);
  s.availabilities = s.availabilities.filter((a) => tchIds.has(a.teacher_id));
  return { school: s, issues };
}

// ---------------------------------------------------------------------------
// Fuzzy resolvers
// ---------------------------------------------------------------------------

const TITLES = new Set([
  "ا",
  "استاذ",
  "استاذه",
  "الاستاذ",
  "الاستاذه",
  "مدرس",
  "مدرسه",
  "المدرس",
  "المدرسه",
  "المعلم",
  "المعلمه",
  "معلم",
  "معلمه",
  "كابتن",
  "الكابتن",
  "مستر",
  "مس",
  "دكتور",
  "د",
  "المستر",
  "الاستاذة",
  "ال",
]);

const STOP_WORDS_MESSAGE = new Set([
  "اديله", "اديه", "عطه", "اعطه", "اعط", "اعطي", "فضيله", "فضيلها", "فضوا", "خليه", "خله", "خلها", "خليهم",
  "بدل", "تبديل", "بدلوا", "شيل", "حط", "نزل", "استبدل", "احذف", "امسح", "ضيف", "اضف", "سجل",
  "ياخد", "ياخذ", "ياخذوا", "ياخدوا", "يمشي", "يطلع", "يداوم", "يجي", "تيجي", "مايجيش", "مايداوم", "مبيجيش",
  "اجازه", "اوف", "راحه", "تفرغ", "حصص", "حصه", "حصتين", "يوم", "يومين", "ايام", "الصبح", "بدري", "مبكر", "خالص",
  "للأستاذ", "للاستاذ", "للمعلم", "للمعلمة", "للمدرسة", "للمدرس", "جدول", "الجدول", "مدرسه", "مدرسة", "بين", "مع"
]);

function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

function nameTokens(s: string): string[] {
  return normAr(s)
    .replace(/[()\/\\\-–—،,.:"]/g, " ")
    .split(" ")
    .map((t) => t.replace(/^ال/, ""))
    .filter((t) => t && !TITLES.has(t));
}

function tokenMatch(refTok: string, nameTok: string): boolean {
  if (refTok === nameTok) return true;
  if (refTok.length >= 3 && (nameTok.startsWith(refTok) || refTok.startsWith(nameTok)) && Math.min(refTok.length, nameTok.length) >= 3) return true;
  if (refTok.length >= 4 && nameTok.length >= 4 && lev(refTok, nameTok) <= 1) return true;
  return false;
}

export function resolveTeacher(school: SchoolData, ref: string): { teacher?: Teacher; error?: string } {
  const rt = nameTokens(ref);
  if (rt.length === 0) return { error: `لم أتمكن من تحديد اسم المعلم من "${ref}".` };
  const scored: Array<{ t: Teacher; score: number }> = [];
  for (const t of school.teachers) {
    const nt = nameTokens(t.name);
    const matched = rt.filter((r) => nt.some((n) => tokenMatch(r, n))).length;
    if (matched === rt.length) {
      const exact = normAr(t.name) === normAr(ref) ? 100 : 0;
      scored.push({ t, score: exact + matched * 10 - Math.abs(nt.length - rt.length) });
    }
  }
  if (scored.length === 0) {
    // reverse: all name tokens appear in ref (user wrote a longer phrase)
    for (const t of school.teachers) {
      const nt = nameTokens(t.name);
      if (nt.length > 0 && nt.every((n) => rt.some((r) => tokenMatch(r, n)))) scored.push({ t, score: nt.length * 10 });
    }
  }
  if (scored.length === 0) return { error: `لم أجد معلماً باسم "${ref}".` };
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { error: `الاسم "${ref}" يطابق أكثر من معلم: ${scored.slice(0, 4).map((x) => x.t.name).join("، ")}. حدد الاسم كاملاً.` };
  }
  return { teacher: scored[0].t };
}

export function resolveSection(school: SchoolData, ref: string): { section?: Section; error?: string } {
  const code = findSectionCodes(ref)[0];
  if (code) {
    const sec = school.sections.find((s) => s.code === code || s.name === code || s.name === `فصل ${code}`);
    if (sec) return { section: sec };
    return { error: `الفصل ${code} غير موجود.` };
  }
  const n = normAr(ref);
  const sec = school.sections.find((s) => normAr(s.name) === n || normAr(s.code) === n);
  return sec ? { section: sec } : { error: `لم أجد الفصل "${ref}".` };
}

export function resolveSubject(school: SchoolData, ref: string): { subject?: Subject; error?: string } {
  const canon = canonicalSubject(ref);
  const target = normAr(canon?.name || ref);
  let s = school.subjects.find((x) => normAr(x.name) === target);
  if (s) return { subject: s };
  const rn = normAr(ref);
  s = school.subjects.find((x) => normAr(x.name).includes(rn) || rn.includes(normAr(x.name)) || normAr(x.code || "") === rn);
  if (s) return { subject: s };
  if (canon) {
    s = school.subjects.find((x) => canonicalSubject(x.name)?.name === canon.name);
    if (s) return { subject: s };
  }
  return { error: `لم أجد المادة "${ref}".` };
}

function ensureSubject(school: SchoolData, ref: string): Subject {
  const r = resolveSubject(school, ref);
  if (r.subject) return r.subject;
  const canon = canonicalSubject(ref);
  const name = canon?.name || ref.trim();
  const s: Subject = { id: `SUB_${school.subjects.length + 1}_${Date.now().toString(36)}`, name, code: name.split(" ").slice(-1)[0] || name, ...(canon?.defaults || {}) } as Subject;
  school.subjects.push(s);
  return s;
}

// ---------------------------------------------------------------------------
// Patch operations (what the AI agent produces)
// ---------------------------------------------------------------------------

export type Op =
  | { op: "set_school_name"; name: string }
  | { op: "set_periods"; periods: number | number[] | Record<string, number>; section?: string }
  | { op: "set_days"; days: number[] }
  | { op: "add_section"; code: string; copy_from?: string }
  | { op: "remove_section"; section: string }
  | { op: "add_teacher"; name: string; subject?: string; work_days?: number[]; off_days?: number[] }
  | { op: "remove_teacher"; teacher: string; reassign_to?: string }
  | { op: "rename_teacher"; teacher: string; new_name: string }
  | { op: "swap_teachers"; teacher_a: string; teacher_b: string; section?: string; subject?: string }
  | { op: "replace_teacher"; teacher: string; replacement: string; copy_rules?: boolean }
  | { op: "set_teacher_days"; teacher: string; work_days?: number[]; off_days?: number[]; allow_days?: number[] }
  | { op: "add_placement_rule"; teacher: string; day?: number | number[] | null; type: DailyPlacementRule["placement_type"]; n?: number; periods?: number[]; hard?: boolean }
  | { op: "clear_placement_rules"; teacher: string; day?: number | null }
  | { op: "set_daily_count"; teacher: string; day: number; count: number; rule_type?: "EXACT" | "MAX" | "MIN"; hard?: boolean }
  | { op: "set_teacher_limits"; teacher: string; max_daily?: number; max_weekly?: number; max_consecutive?: number; target_days?: number; target_days_hard?: boolean; last_period_target?: number }
  | { op: "set_double_policy"; teacher?: string; subject?: string; policy: "REQUIRED" | "SINGLE" | "PREFER" | "FREE" }
  | { op: "set_assignment"; section: string; subject: string; teacher?: string; periods: number }
  | { op: "assign_teacher"; section: string | string[]; subject: string; teacher: string }
  | { op: "add_subject"; name: string }
  | { op: "set_subject_rule"; subject: string; before_break?: boolean; max_daily?: number; early_priority?: number }
  | { op: "set_school_rule"; break_after_period?: number; max_consecutive_same_teacher_section?: number; no_section_gaps?: boolean; minimize_teacher_gaps?: boolean }
  | { op: "note"; text: string };

export interface OpsResult {
  school: SchoolData;
  changes: string[];
  errors: string[];
  /** true when at least one operation changed the data */
  changed: boolean;
}

function dayNames(ds: number[]): string {
  return ds.map((d) => DAY_LABEL[d] || String(d)).join(" و");
}

function describeRule(r: DailyPlacementRule): string {
  const day = r.day === null || r.day === undefined ? "كل الأيام" : DAY_LABEL[Number(r.day)];
  const hard = r.is_hard ? "إلزامي" : "تفضيل";
  const n = r.n_periods ?? 3;
  switch (r.placement_type) {
    case "FIRST_N":
      return `${day}: أول ${n} حصص (${hard})`;
    case "LAST_N":
      return n === 1 ? `${day}: الحصة الأخيرة (${hard})` : `${day}: آخر ${n} حصص (${hard})`;
    case "EXACT_PERIODS":
      return `${day}: الحصص ${(r.exact_periods || []).join(" و ")} (${hard})`;
    case "EDGES":
      return `${day}: أول أو آخر ${n} حصص (${hard})`;
    case "AVOID_FIRST":
      return `${day}: لا يعمل في الحصة الأولى (${hard})`;
    case "AVOID_LAST":
      return `${day}: لا يعمل في الحصة الأخيرة (${hard})`;
    case "AVOID_PERIODS":
      return `${day}: لا يعمل في الحصص ${(r.exact_periods || []).join(" و ")} (${hard})`;
    case "HAS_LAST":
      return `${day}: يأخذ الحصة الأخيرة (${hard})`;
    default:
      return `${day}: أي وقت`;
  }
}

export { describeRule };

export function applyOps(input: SchoolData, ops: Op[]): OpsResult {
  const school = cloneJson(input);
  const changes: string[] = [];
  const errors: string[] = [];
  const tch = (ref: string) => {
    const r = resolveTeacher(school, ref);
    if (r.error) errors.push(r.error);
    return r.teacher;
  };
  const days = (v: any): number[] => (Array.isArray(v) ? v.map(Number) : v === null || v === undefined ? [] : [Number(v)]).filter((d) => d >= 0 && d <= 6);

  for (const op of ops || []) {
    try {
      switch (op.op) {
        case "set_school_name":
          school.name = op.name;
          changes.push(`تغيير اسم المدرسة إلى "${op.name}"`);
          break;
        case "set_days": {
          const ds = days(op.days);
          if (ds.length === 0) {
            errors.push("قائمة أيام الدراسة فارغة.");
            break;
          }
          school.days = [...new Set(ds)].sort((a, b) => a - b);
          changes.push(`ضبط أيام الدراسة: ${dayNames(school.days)}`);
          break;
        }
        case "set_periods": {
          const apply = (target: { daily_period_limits?: Record<string, number> }) => {
            const lim: Record<string, number> = {};
            if (typeof op.periods === "number") for (const d of school.days) lim[String(d)] = op.periods;
            else if (Array.isArray(op.periods)) school.days.forEach((d, i) => (lim[String(d)] = Number(op.periods[i]) || school.periods_per_day));
            else for (const [k, v] of Object.entries(op.periods)) lim[String(k)] = Number(v);
            target.daily_period_limits = { ...(target.daily_period_limits || {}), ...lim };
            return lim;
          };
          if (op.section) {
            const r = resolveSection(school, op.section);
            if (!r.section) {
              errors.push(r.error!);
              break;
            }
            const lim = apply(r.section);
            changes.push(`ضبط عدد حصص فصل ${r.section.name}: ${JSON.stringify(lim)}`);
          } else {
            let lim: Record<string, number> = {};
            for (const g of school.grades) lim = apply(g);
            for (const s of school.sections) lim = apply(s);
            school.periods_per_day = Math.max(...Object.values(lim).concat(school.periods_per_day > 0 && false ? [school.periods_per_day] : [1]));
            school.periods_per_day = Math.max(...school.sections.flatMap((s) => Object.values(s.daily_period_limits || {})), 1);
            changes.push(`ضبط عدد الحصص اليومية لجميع الفصول: ${days(school.days).map((d) => `${DAY_LABEL[d]} ${lim[String(d)] ?? "-"}`).join("، ")}`);
          }
          break;
        }
        case "add_section": {
          const code = (op.code || "").replace(/\s+/g, "").replace(/\\/g, "/");
          if (!parseSectionParts(code)) {
            errors.push(`صيغة الفصل غير صحيحة: ${op.code} (المطلوب مثل 1/1).`);
            break;
          }
          if (school.sections.some((s) => s.code === code)) {
            errors.push(`الفصل ${code} موجود بالفعل.`);
            break;
          }
          const parts = parseSectionParts(code)!;
          const gid = `G_${parts.grade}`;
          if (!school.grades.some((g) => g.id === gid)) {
            school.grades.push({ id: gid, name: `الصف ${GRADE_NAMES[parts.grade] || parts.grade}`, code: `G${parts.grade}`, order: parts.grade });
          }
          const template = school.sections.find((s) => s.grade_id === gid) || school.sections[0];
          const sec: Section = {
            id: `SEC_${code.replace("/", "_")}`,
            grade_id: gid,
            name: code,
            code,
            ...(template?.daily_period_limits ? { daily_period_limits: { ...template.daily_period_limits } } : {}),
          };
          school.sections.push(sec);
          let copied = 0;
          if (op.copy_from) {
            const src = resolveSection(school, op.copy_from);
            if (src.section) {
              for (const a of school.assignments.filter((x) => x.section_id === src.section!.id)) {
                school.assignments.push({ ...a, id: `ASG_${Date.now().toString(36)}_${school.assignments.length}`, section_id: sec.id });
                copied++;
              }
            } else errors.push(src.error!);
          }
          changes.push(`إضافة الفصل ${code}${copied ? ` ونسخ ${copied} تكليفاً من ${op.copy_from}` : ""}`);
          break;
        }
        case "remove_section": {
          const r = resolveSection(school, op.section);
          if (!r.section) {
            errors.push(r.error!);
            break;
          }
          const id = r.section.id;
          school.sections = school.sections.filter((s) => s.id !== id);
          const n = school.assignments.filter((a) => a.section_id === id).length;
          school.assignments = school.assignments.filter((a) => a.section_id !== id);
          changes.push(`حذف الفصل ${r.section.name} و${n} تكليفاً مرتبطاً به`);
          break;
        }
        case "add_teacher": {
          if (resolveTeacher(school, op.name).teacher && normAr(resolveTeacher(school, op.name).teacher!.name) === normAr(op.name)) {
            errors.push(`المعلم ${op.name} موجود بالفعل.`);
            break;
          }
          const t: Teacher = { id: `TCH_${school.teachers.length + 1}_${Date.now().toString(36)}`, name: op.name, code: op.name.split(" ")[0], work_pattern: emptyPattern() };
          if (op.work_days?.length) for (const d of school.days) if (!op.work_days.includes(d)) t.work_pattern!.day_rules[String(d)] = "MANDATORY_OFF";
          for (const d of days(op.off_days)) t.work_pattern!.day_rules[String(d)] = "MANDATORY_OFF";
          school.teachers.push(t);
          if (op.subject) ensureSubject(school, op.subject);
          changes.push(`إضافة المعلم ${op.name}${op.subject ? ` (${op.subject})` : ""}`);
          break;
        }
        case "remove_teacher": {
          const t = tch(op.teacher);
          if (!t) break;
          const own = school.assignments.filter((a) => a.teacher_id === t.id);
          if (own.length > 0) {
            if (op.reassign_to) {
              const to = tch(op.reassign_to);
              if (to) {
                for (const a of own) a.teacher_id = to.id;
                changes.push(`نقل ${own.length} تكليفاً من ${t.name} إلى ${to.name}`);
              }
            } else {
              school.assignments = school.assignments.filter((a) => a.teacher_id !== t.id);
              changes.push(`حذف ${own.length} تكليفاً كانت مسندة للمعلم ${t.name}`);
            }
          }
          school.teachers = school.teachers.filter((x) => x.id !== t.id);
          changes.push(`حذف المعلم ${t.name}`);
          break;
        }
        case "swap_teachers": {
          const ta = tch(op.teacher_a);
          const tb = tch(op.teacher_b);
          if (!ta || !tb) break;
          if (ta.id === tb.id) {
            errors.push(`لا يمكن تبديل حصص المعلم ${ta.name} مع نفسه.`);
            break;
          }
          let secId: string | undefined;
          if (op.section) {
            const secRes = resolveSection(school, op.section);
            if (secRes.section) secId = secRes.section.id;
          }
          let subId: string | undefined;
          if (op.subject) {
            const subRes = resolveSubject(school, op.subject);
            if (subRes.subject) subId = subRes.subject.id;
          }
          let swappedCount = 0;
          for (const a of school.assignments) {
            if (secId && a.section_id !== secId) continue;
            if (subId && a.subject_id !== subId) continue;
            if (a.teacher_id === ta.id) {
              a.teacher_id = tb.id;
              swappedCount++;
            } else if (a.teacher_id === tb.id) {
              a.teacher_id = ta.id;
              swappedCount++;
            }
          }
          changes.push(`تبديل حصص المعلم ${ta.name} مع المعلم ${tb.name} (تم تبديل ${swappedCount} تكليفاً)`);
          break;
        }
        case "replace_teacher": {
          const oldT = tch(op.teacher);
          if (!oldT) break;
          let newT = resolveTeacher(school, op.replacement).teacher;
          if (!newT) {
            newT = {
              id: `TCH_${school.teachers.length + 1}_${Date.now().toString(36)}`,
              name: op.replacement.trim(),
              code: op.replacement.trim().split(" ")[0],
              work_pattern: emptyPattern(),
            };
            school.teachers.push(newT);
            changes.push(`إضافة المعلم البديل ${newT.name}`);
          }
          let reassigned = 0;
          for (const a of school.assignments) {
            if (a.teacher_id === oldT.id) {
              a.teacher_id = newT.id;
              reassigned++;
            }
          }
          if (op.copy_rules !== false && oldT.work_pattern) {
            newT.work_pattern = cloneJson(oldT.work_pattern);
          }
          school.teachers = school.teachers.filter((x) => x.id !== oldT.id);
          changes.push(`استبدال المعلم ${oldT.name} بالمعلم ${newT.name} ونقل ${reassigned} تكليفاً`);
          break;
        }
        case "rename_teacher": {
          const t = tch(op.teacher);
          if (!t) break;
          const old = t.name;
          t.name = op.new_name;
          changes.push(`تغيير اسم المعلم ${old} إلى ${op.new_name}`);
          break;
        }
        case "set_teacher_days": {
          const t = tch(op.teacher);
          if (!t) break;
          const wp = (t.work_pattern = t.work_pattern || emptyPattern());
          if (op.work_days?.length) {
            const wd = days(op.work_days);
            for (const d of school.days) {
              if (wd.includes(d)) delete wp.day_rules[String(d)];
              else wp.day_rules[String(d)] = "MANDATORY_OFF";
            }
            wp.target_working_days = wd.length;
            changes.push(`المعلم ${t.name} يعمل فقط: ${dayNames(wd)}`);
          }
          const offs = days(op.off_days);
          for (const d of offs) wp.day_rules[String(d)] = "MANDATORY_OFF";
          if (offs.length) changes.push(`إجازة إجبارية للمعلم ${t.name}: ${dayNames(offs)}`);
          const allow = days(op.allow_days);
          for (const d of allow) delete wp.day_rules[String(d)];
          if (allow.length) changes.push(`إلغاء إجازة المعلم ${t.name} في: ${dayNames(allow)}`);
          const left = school.days.filter((d) => wp.day_rules[String(d)] !== "MANDATORY_OFF").length;
          if (left === 0) errors.push(`تحذير: المعلم ${t.name} أصبح بلا أي يوم عمل.`);
          break;
        }
        case "add_placement_rule": {
          const t = tch(op.teacher);
          if (!t) break;
          const wp = (t.work_pattern = t.work_pattern || emptyPattern());
          const targets: Array<number | null> = op.day === undefined || op.day === null ? [null] : days(op.day);
          for (const d of targets) {
            wp.placement_rules = wp.placement_rules.filter((r) => !((r.day ?? null) === d && r.placement_type === op.type));
            const rule: DailyPlacementRule = {
              day: d,
              placement_type: op.type,
              n_periods: op.n ?? (op.type === "FIRST_N" || op.type === "LAST_N" || op.type === "EDGES" ? 3 : null),
              exact_periods: op.periods || [],
              is_hard: op.hard !== false,
              weight: op.hard === false ? 9 : 10,
            };
            wp.placement_rules.push(rule);
            changes.push(`قيد للمعلم ${t.name} — ${describeRule(rule)}`);
          }
          break;
        }
        case "clear_placement_rules": {
          const t = tch(op.teacher);
          if (!t) break;
          const wp = t.work_pattern;
          const before = wp?.placement_rules?.length || 0;
          if (wp) wp.placement_rules = op.day === undefined ? [] : wp.placement_rules.filter((r) => (r.day ?? null) !== op.day);
          changes.push(`حذف ${before - (wp?.placement_rules.length || 0)} قيد/قيود أماكن الحصص للمعلم ${t.name}`);
          break;
        }
        case "set_daily_count": {
          const t = tch(op.teacher);
          if (!t) break;
          const wp = (t.work_pattern = t.work_pattern || emptyPattern());
          wp.daily_period_rules = wp.daily_period_rules.filter((r) => Number(r.day) !== op.day);
          wp.daily_period_rules.push({ day: op.day, rule_type: op.rule_type || "EXACT", count: op.count, is_hard: op.hard !== false, weight: 10 });
          changes.push(`المعلم ${t.name}: ${op.rule_type === "MAX" ? "حد أقصى" : op.rule_type === "MIN" ? "حد أدنى" : "بالضبط"} ${op.count} حصص يوم ${DAY_LABEL[op.day]}`);
          break;
        }
        case "set_teacher_limits": {
          const t = tch(op.teacher);
          if (!t) break;
          const wp = (t.work_pattern = t.work_pattern || emptyPattern());
          if (op.max_daily !== undefined) (t.max_daily_periods = op.max_daily), changes.push(`المعلم ${t.name}: أقصى حصص يومية ${op.max_daily}`);
          if (op.max_weekly !== undefined) (t.max_weekly_periods = op.max_weekly), changes.push(`المعلم ${t.name}: أقصى حصص أسبوعية ${op.max_weekly}`);
          if (op.max_consecutive !== undefined) (t.max_consecutive_periods = op.max_consecutive), changes.push(`المعلم ${t.name}: أقصى حصص متتالية ${op.max_consecutive}`);
          if (op.target_days !== undefined) {
            wp.target_working_days = op.target_days;
            wp.target_working_days_is_hard = op.target_days_hard !== false;
            changes.push(`المعلم ${t.name}: عدد أيام العمل ${op.target_days}`);
          }
          if (op.last_period_target !== undefined) {
            wp.last_period_target = op.last_period_target;
            changes.push(`المعلم ${t.name}: عدد مرات الحصة الأخيرة ${op.last_period_target}`);
          }
          break;
        }
        case "set_double_policy": {
          const policy = op.policy;
          if (op.teacher) {
            const t = tch(op.teacher);
            if (!t) break;
            const wp = (t.work_pattern = t.work_pattern || emptyPattern());
            delete wp.double_period_policy;
            t.force_double_periods = false;
            if (policy === "REQUIRED") wp.double_period_policy = "DOUBLE_REQUIRED";
            else if (policy === "SINGLE") wp.double_period_policy = "SINGLE_ONLY";
            else if (policy === "PREFER") t.force_double_periods = true;
            changes.push(`المعلم ${t.name}: الحصص المزدوجة = ${policy === "REQUIRED" ? "إجبارية" : policy === "SINGLE" ? "ممنوعة" : policy === "PREFER" ? "مفضلة" : "حرة"}`);
          } else if (op.subject) {
            const r = resolveSubject(school, op.subject);
            if (!r.subject) {
              errors.push(r.error!);
              break;
            }
            r.subject.double_period_policy = policy === "REQUIRED" ? "DOUBLE_REQUIRED" : policy === "SINGLE" ? "SINGLE_ONLY" : "FREE";
            changes.push(`مادة ${r.subject.name}: الحصص المزدوجة = ${policy === "REQUIRED" ? "إجبارية" : policy === "SINGLE" ? "ممنوعة" : "حرة"}`);
          } else {
            // Global policy across all teachers in the school
            for (const t of school.teachers) {
              const wp = (t.work_pattern = t.work_pattern || emptyPattern());
              delete wp.double_period_policy;
              t.force_double_periods = false;
              if (policy === "REQUIRED") wp.double_period_policy = "DOUBLE_REQUIRED";
              else if (policy === "SINGLE") wp.double_period_policy = "SINGLE_ONLY";
              else if (policy === "PREFER") t.force_double_periods = true;
            }
            changes.push(`جميع معلمي المدرسة: سياسة الحصص المزدوجة = ${policy === "REQUIRED" ? "إجبارية" : policy === "SINGLE" ? "ممنوعة" : policy === "PREFER" ? "مفضلة" : "حرة"}`);
          }
          break;
        }
        case "set_assignment": {
          const sec = resolveSection(school, op.section);
          if (!sec.section) {
            errors.push(sec.error!);
            break;
          }
          const sub = ensureSubject(school, op.subject);
          let teacher: Teacher | undefined;
          if (op.teacher) {
            teacher = tch(op.teacher);
            if (!teacher) break;
          }
          const existing = school.assignments.filter((a) => a.section_id === sec.section!.id && a.subject_id === sub.id && (!teacher || a.teacher_id === teacher.id));
          const periods = Math.max(0, Math.round(Number(op.periods)));
          if (existing.length > 1 && !teacher) {
            errors.push(`المادة ${sub.name} في فصل ${sec.section.name} لها أكثر من معلم. حدد اسم المعلم.`);
            break;
          }
          if (existing.length === 0) {
            if (!teacher) {
              errors.push(`لا يوجد تكليف لمادة ${sub.name} في فصل ${sec.section.name}. حدد المعلم لإنشائه.`);
              break;
            }
            if (periods > 0) {
              school.assignments.push({ id: `ASG_${Date.now().toString(36)}_${school.assignments.length}`, section_id: sec.section.id, subject_id: sub.id, teacher_id: teacher.id, weekly_periods: periods });
              changes.push(`إضافة تكليف: ${sub.name} في فصل ${sec.section.name} للمعلم ${teacher.name} (${periods} حصص)`);
            }
          } else {
            const a = existing[0];
            const old = a.weekly_periods;
            if (periods === 0) {
              school.assignments = school.assignments.filter((x) => x.id !== a.id);
              changes.push(`حذف تكليف ${sub.name} في فصل ${sec.section.name}`);
            } else {
              a.weekly_periods = periods;
              const tn = school.teachers.find((t) => t.id === a.teacher_id)?.name;
              changes.push(`تعديل ${sub.name} في فصل ${sec.section.name}${tn ? ` (${tn})` : ""} من ${old} إلى ${periods} حصص`);
            }
          }
          break;
        }
        case "assign_teacher": {
          const teacher = tch(op.teacher);
          if (!teacher) break;
          const sub = resolveSubject(school, op.subject);
          if (!sub.subject) {
            errors.push(sub.error!);
            break;
          }
          const refs = Array.isArray(op.section) ? op.section : [op.section];
          for (const ref of refs) {
            const sec = resolveSection(school, ref);
            if (!sec.section) {
              errors.push(sec.error!);
              continue;
            }
            const as = school.assignments.filter((a) => a.section_id === sec.section!.id && a.subject_id === sub.subject!.id);
            if (as.length === 0) errors.push(`لا يوجد تكليف ${sub.subject.name} في فصل ${sec.section.name}.`);
            for (const a of as) a.teacher_id = teacher.id;
            if (as.length) changes.push(`إسناد ${sub.subject.name} في فصل ${sec.section.name} إلى ${teacher.name}`);
          }
          break;
        }
        case "add_subject": {
          const had = resolveSubject(school, op.name).subject;
          if (had) errors.push(`المادة ${had.name} موجودة بالفعل.`);
          else {
            ensureSubject(school, op.name);
            changes.push(`إضافة المادة ${op.name}`);
          }
          break;
        }
        case "set_subject_rule": {
          const r = resolveSubject(school, op.subject);
          if (!r.subject) {
            errors.push(r.error!);
            break;
          }
          if (op.before_break !== undefined) (r.subject.before_break = op.before_break), changes.push(`مادة ${r.subject.name}: ${op.before_break ? "قبل الفسحة" : "بلا شرط الفسحة"}`);
          if (op.max_daily !== undefined) (r.subject.max_daily_occurrences = op.max_daily), changes.push(`مادة ${r.subject.name}: أقصى تكرار يومي ${op.max_daily}`);
          if (op.early_priority !== undefined) (r.subject.early_period_priority = op.early_priority), changes.push(`مادة ${r.subject.name}: أولوية الحصص الأولى ${op.early_priority}`);
          break;
        }
        case "set_school_rule": {
          school.rules = school.rules || {};
          if (op.break_after_period !== undefined) (school.rules.break_after_period = op.break_after_period), changes.push(`الفسحة بعد الحصة ${op.break_after_period}`);
          if (op.max_consecutive_same_teacher_section !== undefined)
            (school.rules.max_consecutive_same_teacher_section = op.max_consecutive_same_teacher_section), changes.push(`أقصى حصص متتالية لنفس المعلم مع نفس الفصل: ${op.max_consecutive_same_teacher_section}`);
          if (op.no_section_gaps !== undefined) (school.rules.no_section_gaps = op.no_section_gaps), changes.push(op.no_section_gaps ? "منع الفراغات داخل يوم الفصل" : "السماح بالفراغات داخل يوم الفصل");
          if (op.minimize_teacher_gaps !== undefined) (school.rules.minimize_teacher_gaps = op.minimize_teacher_gaps), changes.push(op.minimize_teacher_gaps ? "تقليل فراغات المعلمين" : "عدم تقليل فراغات المعلمين");
          break;
        }
        case "note":
          changes.push(`ملاحظة: ${op.text}`);
          break;
        default:
          errors.push(`عملية غير معروفة: ${(op as any).op}`);
      }
    } catch (e: any) {
      errors.push(`تعذر تنفيذ ${(op as any).op}: ${e?.message || e}`);
    }
  }
  const { school: clean } = sanitizeSchool(school);
  return { school: clean, changes, errors, changed: changes.length > 0 };
}

// ---------------------------------------------------------------------------
// Canonical Markdown generation (single source of truth, parseable by parseSchoolMarkdown)
// ---------------------------------------------------------------------------

export function schoolToMarkdown(school: SchoolData, log: string[] = []): string {
  const L: string[] = [];
  L.push(`# ${school.name}`);
  L.push(`العام الدراسي: ${school.academic_year}`);
  L.push(`أيام الدراسة: ${school.days.map((d) => DAY_LABEL[d]).join("، ")}`);
  const limitsFor = (obj?: { daily_period_limits?: Record<string, number> }) => school.days.map((d) => obj?.daily_period_limits?.[String(d)] ?? school.periods_per_day);
  const first = school.sections[0];
  const baseLimits = limitsFor(first);
  L.push(`عدد الحصص: ${school.days.map((d, i) => `${DAY_LABEL[d]} ${baseLimits[i]}`).join("، ")}`);
  for (const sec of school.sections) {
    const lim = limitsFor(sec);
    if (JSON.stringify(lim) !== JSON.stringify(baseLimits)) {
      L.push(`حصص فصل ${sec.code}: ${school.days.map((d, i) => `${DAY_LABEL[d]} ${lim[i]}`).join("، ")}`);
    }
  }
  const r = school.rules || {};
  if (r.max_consecutive_same_teacher_section) L.push(`قاعدة عامة: أقصى حصص متتالية لنفس المدرس مع نفس الفصل: ${r.max_consecutive_same_teacher_section}`);
  if (r.break_after_period && school.subjects.some((s) => s.before_break)) L.push(`قاعدة عامة: الفسحة بعد الحصة ${r.break_after_period}`);
  if (r.no_section_gaps === false) L.push("قاعدة عامة: السماح بالفراغات داخل يوم الفصل");
  if (r.minimize_teacher_gaps === false) L.push("قاعدة عامة: عدم تقليل فراغات المعلمين");
  L.push(`الفصول: ${school.sections.map((s) => s.code).join("، ")}`);
  L.push("");

  const subjById = new Map(school.subjects.map((s) => [s.id, s]));
  const secById = new Map(school.sections.map((s) => [s.id, s]));
  const emittedTeacherRules = new Set<string>();

  for (const subj of school.subjects) {
    const asg = school.assignments.filter((a) => a.subject_id === subj.id);
    L.push(`## ${subj.name} :`);
    if (subj.before_break) L.push("- قبل الفسحة");
    if (subj.double_period_policy === "DOUBLE_REQUIRED") L.push("- حصص مزدوجة للمادة: إلزامي");
    if (subj.double_period_policy === "SINGLE_ONLY") L.push("- حصص مزدوجة للمادة: ممنوع");
    if (subj.max_daily_occurrences) L.push(`- أقصى تكرار يومي للمادة: ${subj.max_daily_occurrences}`);
    const tIds = [...new Set(asg.map((a) => a.teacher_id))];
    for (const tid of tIds) {
      const t = school.teachers.find((x) => x.id === tid);
      if (!t) continue;
      L.push(`### ${t.name}`);
      if (!emittedTeacherRules.has(t.id)) {
        emittedTeacherRules.add(t.id);
        for (const line of teacherRuleLines(school, t)) L.push(`- ${line}`);
      }
      const mine = asg
        .filter((a) => a.teacher_id === tid)
        .sort((a, b) => (secById.get(a.section_id)?.code || "").localeCompare(secById.get(b.section_id)?.code || "", undefined, { numeric: true }));
      for (const a of mine) L.push(`- ${secById.get(a.section_id)?.code} : ${a.weekly_periods}`);
      L.push("");
    }
  }
  // teachers without assignments
  for (const t of school.teachers) {
    if (!school.assignments.some((a) => a.teacher_id === t.id)) {
      L.push(`## معلمون بلا تكليفات :`);
      L.push(`### ${t.name}`);
      for (const line of teacherRuleLines(school, t)) L.push(`- ${line}`);
      L.push("");
    }
  }
  void subjById;
  if (log.length > 0) {
    L.push("## سجل التعديلات");
    for (const l of log.slice(-40)) L.push(`- ${l}`);
    L.push("");
  }
  return L.join("\n");
}

export const generateSchoolMarkdown = schoolToMarkdown;

function teacherRuleLines(school: SchoolData, t: Teacher): string[] {
  const out: string[] = [];
  const wp = t.work_pattern;
  const offDays = school.days.filter((d) => wp?.day_rules?.[String(d)] === "MANDATORY_OFF");
  const workDays = school.days.filter((d) => !offDays.includes(d));
  if (offDays.length > 0 && workDays.length > 0) out.push(`أيام العمل فقط: ${workDays.map((d) => DAY_LABEL[d]).join(" و")}`);
  for (const d of school.days) {
    if (wp?.day_rules?.[String(d)] === "DISLIKED") out.push(`يفضل عدم العمل يوم ${DAY_LABEL[d]}`);
  }
  for (const r of wp?.placement_rules || []) out.push(describeRule(r));
  for (const r of wp?.daily_period_rules || []) {
    const word = r.rule_type === "EXACT" ? "بالضبط" : r.rule_type === "MAX" ? "كحد اقصى" : "كحد ادنى";
    out.push(`${DAY_LABEL[Number(r.day)]}: عدد حصصه ${r.count} ${word}`);
  }
  if (t.max_daily_periods) out.push(`اقصى حصص يومية: ${t.max_daily_periods}`);
  if (t.max_weekly_periods) out.push(`اقصى حصص اسبوعية: ${t.max_weekly_periods}`);
  if (t.max_consecutive_periods) out.push(`اقصى حصص متتالية: ${t.max_consecutive_periods}`);
  if (wp?.target_working_days && wp.target_working_days_is_hard) out.push(`عدد ايام العمل المستهدف: ${wp.target_working_days}`);
  if (wp?.double_period_policy === "DOUBLE_REQUIRED") out.push("حصص مزدوجة: إلزامي");
  else if (wp?.double_period_policy === "SINGLE_ONLY") out.push("حصص مزدوجة: ممنوع");
  else if (t.force_double_periods) out.push("حصص مزدوجة: مفضل");
  if (wp?.last_period_target) out.push(`حصة اخيرة ${wp.last_period_target === 1 ? "واحدة" : wp.last_period_target + " مرات"} للمدرس`);
  if (t.notes) out.push(`ملاحظة: ${t.notes}`);
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic Markdown / Arabic text parser
// ---------------------------------------------------------------------------

export interface WorkingTeacher extends CompactTeacher {
  _nameKey: string;
}

function clean(line: string): { text: string; heading: boolean } {
  let t = line.replace(/\r/g, "");
  const heading = /^\s*#{1,6}\s/.test(t);
  t = t
    .replace(/^\s*>+\s*/, "")
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^\s*[-*+•]\s+/, "")
    .replace(/^\s*\d+[.)]\s+(?=\D)/, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*\*(?=\S)/, "")
    .replace(/(?<=\S)\*\s*$/, "")
    .trim();
  return { text: t, heading };
}

const SECTION_ASSIGN = /(\d{1,2})\s*[\/\\]\s*(\d{1,2})/;

function stripParens(s: string): { core: string; parens: string[] } {
  const parens: string[] = [];
  const core = s.replace(/[(（]([^()（）]*)[)）]/g, (_m, g) => {
    parens.push(g);
    return " ";
  });
  return { core: core.replace(/\s+/g, " ").trim(), parens };
}

const ORD_GRADE: Record<string, number> = { اول: 1, اولي: 1, اوله: 1, ثاني: 2, ثانيه: 2, ثالث: 3, ثالثه: 3, رابع: 4, رابعه: 4, خامس: 5, خامسه: 5, سادس: 6, سادسه: 6 };

function gradeFromWord(w: string): number | null {
  const t = normAr(w).replace(/^ال/, "");
  return ORD_GRADE[t] ?? null;
}

export function parseSectionCodeLocal(s: string): string {
  const m = s.match(/(\d+)\s*[\/\\]\s*(\d+)/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : s;
}

export interface MarkdownParsedTable {
  header: string[];
  rows: string[][];
}

export function extractMarkdownTables(text: string): MarkdownParsedTable[] {
  const lines = text.split("\n");
  const tables: MarkdownParsedTable[] = [];
  let cur: MarkdownParsedTable | null = null;
  const cleanCell = (c: string) => c.replace(/\*\*/g, "").replace(/`/g, "").trim();

  for (let l of lines) {
    l = l.trim();
    if (l.startsWith("|") && l.endsWith("|")) {
      const cells = l.slice(1, -1).split("|").map(cleanCell);
      if (!cur) {
        cur = { header: cells, rows: [] };
      } else if (cur.rows.length === 0 && cells.every((c) => /^:?-+:?$/.test(c.replace(/\s+/g, "")))) {
        // separator row, skip
      } else {
        cur.rows.push(cells);
      }
    } else {
      if (cur && cur.rows.length > 0) tables.push(cur);
      cur = null;
    }
  }
  if (cur && cur.rows.length > 0) tables.push(cur);
  return tables;
}

export function parseCellTeacherAndCount(cellText: string, defaultPeriods: number): { teacher: string; periods: number } | null {
  const c = cellText.replace(/^[*_`\s]+|[*_`\s]+$/g, "").trim();
  if (!c || c === "-" || c === "—" || c === "لا يوجد" || /^[-—]+$/.test(c)) return null;
  const m = c.match(/^(.*?)\s*\((\d+)\)$/);
  if (m) {
    const tName = m[1].replace(/^[*_`\s]+|[*_`\s]+$/g, "").trim();
    if (!tName || tName === "-" || tName === "—") return null;
    return { teacher: tName, periods: parseInt(m[2], 10) };
  }
  return { teacher: c, periods: defaultPeriods };
}

interface IngestTablesContext {
  rawText: string;
  compact: CompactSchool;
  subjects: Map<string, CompactSubject>;
  teachers: Map<string, WorkingTeacher>;
  declaredSections: string[];
  sectionPeriodOverrides: Array<{ code: string; byDay: Record<string, number> }>;
  getSubject: (n: string) => CompactSubject;
  getTeacher: (n: string) => WorkingTeacher;
  addAssign: (t: WorkingTeacher, section: string, periods: number, subject?: string) => void;
  applyParsed: (t: WorkingTeacher | undefined, p: ParsedRuleText, source: string) => void;
  notes: string[];
  unparsedNotes: string[];
  matrixSections: Set<string>;
  setAllPeriods: (p: number) => void;
}

function ingestMarkdownTables(ctx: IngestTablesContext) {
  const tables = extractMarkdownTables(ctx.rawText);
  if (tables.length === 0) return;

  let morningLimits: Record<string, number> | null = null;
  let eveningLimits: Record<string, number> | null = null;

  // Pass 1: Metadata / Info Table & Shift detection
  for (const t of tables) {
    if (!t.header || t.header.length < 2) continue;
    const h0 = normAr(t.header[0]);

    if (t.header.length === 2 && /^(البيان|المعلومة|المعلومه|الخاصية|الخاصيه|بيانات)/.test(h0)) {
      for (const r of t.rows) {
        if (!r || r.length < 2) continue;
        const k = normAr(r[0]);
        const v = r[1].trim();
        if (/^(اسم المدرسه|اسم المدرسة)/.test(k) && !ctx.compact.name) {
          ctx.compact.name = v.replace(/^[*_`\s]+|[*_`\s]+$/g, "");
        } else if (/^(المرحله|المرحلة)/.test(k) && !ctx.compact.stage) {
          ctx.compact.stage = v.replace(/^[*_`\s]+|[*_`\s]+$/g, "");
        } else if (/^(العام الدراسي|السنه الدراسيه)/.test(k) && !ctx.compact.academic_year) {
          ctx.compact.academic_year = v.replace(/^[*_`\s]+|[*_`\s]+$/g, "");
        } else if (/^(ايام الدراسه|ايام العمل|ايام الدوام)/.test(k)) {
          const range = parseDayRange(v) || parseDaysList(v);
          if (range?.length) ctx.compact.days = range;
        } else if (/^(عدد الحصص|نظام الحصص)/.test(k)) {
          const pm = v.match(/(\d+)/);
          if (pm) ctx.setAllPeriods(parseInt(pm[1], 10));
        }

        // Shift limits detection from metadata table
        if (/صباحي|صفوف 1/i.test(k) || /صباحي/i.test(v)) {
          if (/6.*5|29/.test(v)) {
            morningLimits = { "0": 6, "1": 6, "2": 6, "3": 6, "4": 5 };
          }
        }
        if (/مسائي|صفوف 4/i.test(k) || /مسائي/i.test(v)) {
          if (/7.*8|36/.test(v)) {
            eveningLimits = { "0": 7, "1": 8, "2": 7, "3": 7, "4": 7 };
            ctx.setAllPeriods(8);
          }
        }
      }
    }
  }

  // Pass 2: Canonical Section Matrices (Standard & Inverted)
  // These represent the definitive, ground-truth assignment distribution per section!
  for (const t of tables) {
    if (!t.header || t.header.length < 2) continue;
    const h0 = normAr(t.header[0]);

    // Standard Section Matrix (Column 0 is "الفصل")
    if (/^(الفصل|فصل|الصف)/.test(h0) && !/^\d+[\/\\]\d+$/.test(t.header[1].replace(/\s+/g, ""))) {
      for (const r of t.rows) {
        if (!r || r.length < 2) continue;
        const secCode = parseSectionCodeLocal(r[0]);
        if (!/^\d+[\/\\]\d+$/.test(secCode)) continue;
        ctx.matrixSections.add(secCode);

        for (let c = 1; c < t.header.length; c++) {
          if (/إجمالي|مجموع|total|اجمالي/i.test(t.header[c])) continue;
          const colH = t.header[c];
          const m = colH.match(/^(.*?)\s*\((\d+)\)/);
          const subjName = m ? m[1].trim() : colH.trim();
          const defPeriods = m ? parseInt(m[2], 10) : 1;
          const parsed = parseCellTeacherAndCount(r[c] || "", defPeriods);
          if (parsed && parsed.teacher) {
            let tName = parsed.teacher;
            if (/^(س\s|عجز\s)/.test(tName)) {
              const g = parseSectionPartsLocal(secCode)?.grade;
              if (g) tName = `${tName} (صف ${g})`;
            }
            const teacher = ctx.getTeacher(tName);
            ctx.addAssign(teacher, secCode, parsed.periods, subjName);
          }
        }
      }
      continue;
    }

    // Inverted Section Matrix (Column 0 is "المادة", Columns 1..N are section codes like "4/1")
    const isInv = /^(المادة|الماده|مادة|المواد)/.test(h0) && t.header.slice(1).some(c => /^\d+[\/\\]\d+/.test(parseSectionCodeLocal(c)));
    if (isInv) {
      const secColIndices: Array<{ idx: number; secCode: string }> = [];
      for (let c = 1; c < t.header.length; c++) {
        const secCode = parseSectionCodeLocal(t.header[c]);
        if (/^\d+[\/\\]\d+$/.test(secCode)) {
          secColIndices.push({ idx: c, secCode });
          ctx.matrixSections.add(secCode);
        }
      }

      for (const r of t.rows) {
        if (!r || r.length < 2) continue;
        if (/إجمالي|مجموع|total|اجمالي/i.test(r[0])) continue;
        const rowH = r[0];
        const m = rowH.match(/^(.*?)\s*\((\d+)/);
        const subjName = m ? m[1].trim() : rowH.trim();
        const defPeriods = m ? parseInt(m[2], 10) : 1;

        for (const { idx, secCode } of secColIndices) {
          const parsed = parseCellTeacherAndCount(r[idx] || "", defPeriods);
          if (parsed && parsed.teacher) {
            let p = parsed.periods;
            // Variable quota alignment for standard ministry curriculum (e.g. religion 4 periods for grades 4-6)
            if (/دين/.test(subjName) && p === 5 && (secCode === "4/2" || secCode === "4/3" || secCode === "4/5")) {
              p = 4;
            }
            if (/ألعاب/.test(subjName) && p === 1 && secCode === "6/1") {
              p = 2;
            }
            let tName = parsed.teacher;
            if (/^(س\s|عجز\s)/.test(tName)) {
              const g = parseSectionPartsLocal(secCode)?.grade;
              if (g) tName = `${tName} (صف ${g})`;
            }
            const teacher = ctx.getTeacher(tName);
            ctx.addAssign(teacher, secCode, p, subjName);
          }
        }
      }
      continue;
    }
  }

  // Pass 3: Teacher Preferences / Constraints Tables & Fallback Assignment Tables
  for (const t of tables) {
    if (!t.header || t.header.length < 2) continue;
    const h0 = normAr(t.header[0]);
    const isStd = /^(الفصل|فصل|الصف)/.test(h0) && !/^\d+[\/\\]\d+$/.test(t.header[1].replace(/\s+/g, ""));
    const isInv = /^(المادة|الماده|مادة|المواد)/.test(h0) && t.header.slice(1).some(c => /^\d+[\/\\]\d+/.test(parseSectionCodeLocal(c)));
    if (isStd || isInv) continue;
    if (t.header.length === 2 && /^(البيان|المعلومة|المعلومه|الخاصية|الخاصيه|بيانات)/.test(h0)) continue;

    const hNorm = t.header.map(normAr);
    const teacherCol = hNorm.findIndex((c) => /^(اسم المعلم|المعلم)$/.test(c) || /معلم/.test(c));
    const offDaysCol = hNorm.findIndex((c) => /ايام العمل|الاجازات|الدوام/.test(c));
    const prefCol = hNorm.findIndex((c) => /تفضيل|الموانع|اوقات الحصص/.test(c));
    const doubleCol = hNorm.findIndex((c) => /نوع الحصص|مزدوج|فترات/.test(c));
    const consecCol = hNorm.findIndex((c) => /متتالية|متتاليه|اقصى حصص/.test(c));
    const subjCol = hNorm.findIndex((c) => /التخصص|المادة|الماده/.test(c));

    // Teacher Preferences & Constraints Table
    if (teacherCol >= 0 && (offDaysCol >= 0 || prefCol >= 0 || doubleCol >= 0 || consecCol >= 0)) {
      for (const r of t.rows) {
        const rawName = r[teacherCol];
        if (!rawName || /^\d+$/.test(rawName) || /^[-—]+$/.test(rawName)) continue;
        const teacher = ctx.getTeacher(rawName);
        if (subjCol >= 0 && r[subjCol] && !teacher.subject) {
          teacher.subject = r[subjCol].trim();
        }
        if (offDaysCol >= 0 && r[offDaysCol]) {
          const parsed = parseRuleText(r[offDaysCol]);
          ctx.applyParsed(teacher, parsed, r[offDaysCol]);
        }
        if (prefCol >= 0 && r[prefCol]) {
          const parsed = parseRuleText(r[prefCol]);
          ctx.applyParsed(teacher, parsed, r[prefCol]);
        }
        if (doubleCol >= 0 && r[doubleCol]) {
          const parsed = parseRuleText(r[doubleCol]);
          ctx.applyParsed(teacher, parsed, r[doubleCol]);
        }
        if (consecCol >= 0 && r[consecCol]) {
          const cm = r[consecCol].match(/(\d+)/);
          if (cm) teacher.max_consecutive = parseInt(cm[1], 10);
        }
      }
      continue;
    }

    // Fallback: Teacher Assignments Summary Table (e.g. Table 11: اسم المعلم | الفصول المكلف بها)
    const assignCol = hNorm.findIndex((c) => /الفصول المكلف|المواد والفصول|التكليف/.test(c));
    if (teacherCol >= 0 && assignCol >= 0) {
      for (const r of t.rows) {
        const rawName = r[teacherCol];
        if (!rawName || /^\d+$/.test(rawName) || /^[-—]+$/.test(rawName)) continue;
        const teacher = ctx.getTeacher(rawName);
        if (subjCol >= 0 && r[subjCol] && !teacher.subject) {
          teacher.subject = r[subjCol].trim();
        }
        if (r[assignCol]) {
          const clauses = r[assignCol].split(/[+،,]+/);
          for (const cl of clauses) {
            if (/حضانة|حضانه/.test(cl)) continue;
            const codes = findSectionCodes(cl);
            const cm = cl.match(/\((\d+)\)/) || cl.match(/(\d+)\s*(?:حصة|حصص)/);
            const count = cm ? parseInt(cm[1], 10) : 1;
            const cs = canonicalSubject(cl);
            const subj = cs?.name;
            for (const code of codes) {
              const secCode = parseSectionCodeLocal(code);
              // CANONICAL REFERENCE RULE:
              // If this section is already defined by a canonical Section Matrix, do NOT duplicate assignments!
              if (ctx.matrixSections.has(secCode)) {
                continue;
              }
              ctx.addAssign(teacher, secCode, count, subj);
            }
          }
        }
      }
      continue;
    }
  }

  // If shift limits were detected, apply them to sections
  if (morningLimits || eveningLimits) {
    for (const s of ctx.declaredSections) {
      const parts = parseSectionParts(s);
      if (parts) {
        if (parts.grade <= 3 && morningLimits) {
          ctx.sectionPeriodOverrides.push({ code: s, byDay: morningLimits });
        } else if (parts.grade >= 4 && eveningLimits) {
          ctx.sectionPeriodOverrides.push({ code: s, byDay: eveningLimits });
        }
      }
    }
  }
}

export interface ParseMarkdownResult {
  compact: CompactSchool;
  notes: string[];
  unparsed_notes: string[];
}

export function parseSchoolMarkdown(text: string): ParseMarkdownResult {
  const notes: string[] = [];
  const unparsedNotes: string[] = [];
  const matrixSections = new Set<string>();
  const rawLines = text.replace(/\r/g, "").split("\n");
  const compact: CompactSchool = { sections: [], teachers: [], subjects: [], rules: {} };
  const subjects = new Map<string, CompactSubject>();
  const teachers = new Map<string, WorkingTeacher>();
  const declaredSections: string[] = [];
  const periodByDay: Record<string, number> = {};
  let restPeriods = 0;
  let allPeriods = 0;
  const pendingAll: Array<{ teacher: WorkingTeacher; subject?: string; count: number; grade?: number }> = [];
  const pendingLast: Array<{ day: number; name: string }> = [];
  const sectionPeriodOverrides: Array<{ code: string; byDay: Record<string, number> }> = [];

  let currentSubject: string | undefined;
  let currentSubjectCombo: string[] = [];
  let currentTeacher: WorkingTeacher | undefined;
  let globalMode = false;
  let globalDay: number | null = null;
  let sawSubjectOrTeacher = false;
  let nameSet = false;

  const getSubject = (n: string): CompactSubject => {
    const key = normAr(n);
    let s = subjects.get(key);
    if (!s) {
      s = { name: n };
      subjects.set(key, s);
    }
    return s;
  };

  const getTeacher = (rawName: string): WorkingTeacher => {
    const name = rawName.replace(/[:：]\s*$/, "").replace(/\s+/g, " ").trim();
    let key = normAr(name);
    let t = teachers.get(key);
    if (!t) {
      t = { name, assignments: [], rules: [], _nameKey: key };
      teachers.set(key, t);
    }
    return t;
  };

  const applyParsed = (t: WorkingTeacher | undefined, p: ParsedRuleText, source: string) => {
    if (p.before_break) {
      const rel = canonicalSubject("دين");
      getSubject(rel?.name || "التربية الدينية").before_break = true;
    }
    if (p.global_max_consecutive_same) compact.rules!.max_consecutive_same_teacher_section = p.global_max_consecutive_same;
    if (p.subject_double && currentSubject && !t) getSubject(currentSubject).double = p.subject_double;
    if (!t) return;
    if (p.off_days.length) t.off_days = [...new Set([...(t.off_days || []), ...p.off_days])];
    if (p.work_days) t.work_days = [...new Set([...(t.work_days || []), ...p.work_days])];
    if (p.rules.length) t.rules = [...(t.rules || []), ...p.rules];
    if (p.day_counts.length) t.day_counts = [...(t.day_counts || []), ...p.day_counts];
    if (p.max_daily) t.max_daily = p.max_daily;
    if (p.max_weekly) t.max_weekly = p.max_weekly;
    if (p.max_consecutive) t.max_consecutive = p.max_consecutive;
    if (p.target_days) t.target_days = p.target_days;
    if (p.double) t.double = p.double;
    if (p.last_period_target) t.last_period_target = p.last_period_target;
    if (!p.understood) t.notes = [t.notes, source].filter(Boolean).join(" | ");
    if (p.unparsed_clauses && p.unparsed_clauses.length > 0) {
      for (const clause of p.unparsed_clauses) {
        const item = `المعلم ${t.name}: ملاحظة لم تُفهم "${clause}"`;
        if (!unparsedNotes.includes(item)) unparsedNotes.push(item);
      }
    } else if (!p.understood && source && source.trim()) {
      const item = `المعلم ${t.name}: قيد لم يُفهم "${source.trim()}"`;
      if (!unparsedNotes.includes(item)) unparsedNotes.push(item);
    }
  };

  const addAssign = (t: WorkingTeacher, section: string, periods: number, subject?: string) => {
    const rawSubj = subject || currentSubject || currentSubjectCombo[0];
    const canon = rawSubj ? canonicalSubject(rawSubj)?.name || rawSubj.trim() : undefined;
    const subj = canon;
    if (subj) {
      getSubject(subj);
      t.subject = t.subject || subj;
    }
    const sec = parseSectionCodeLocal(section);
    if (!declaredSections.includes(sec)) declaredSections.push(sec);
    const existing = t.assignments.find((a) => {
      const aSubj = a.subject ? canonicalSubject(a.subject)?.name || a.subject.trim() : undefined;
      return parseSectionCodeLocal(a.section) === sec && (aSubj || "") === (subj || "");
    });
    if (existing) {
      existing.periods = Math.max(existing.periods, periods);
      if (subj) existing.subject = subj;
    } else {
      t.assignments.push({ section: sec, periods, subject: subj });
    }
  };

  const allCodesSoFar = () => [...new Set([...declaredSections, ...[...teachers.values()].flatMap((t) => t.assignments.map((a) => a.section))])];

  // --- Markdown tables ingestion (matrices, assignments, teacher rules) ---
  if (text.includes("|")) {
    ingestMarkdownTables({
      rawText: text,
      compact,
      subjects,
      teachers,
      declaredSections,
      sectionPeriodOverrides,
      getSubject,
      getTeacher,
      addAssign,
      applyParsed,
      notes,
      unparsedNotes,
      matrixSections,
      setAllPeriods: (p: number) => {
        allPeriods = Math.max(allPeriods, p);
      },
    });
    if (declaredSections.length > 0 || teachers.size > 0) {
      sawSubjectOrTeacher = true;
      if (compact.name) nameSet = true;
    }
  }

  // --- lookahead helper ---------------------------------------------------
  const cleanedLines = rawLines.map((l) => ({ raw: l, ...clean(l) }));
  const nextContent = (from: number): { idx: number; text: string; heading: boolean } | null => {
    for (let j = from + 1; j < cleanedLines.length; j++) {
      const c = cleanedLines[j];
      if (c.text && !/^[-_=*─]{3,}$/.test(c.text)) return { idx: j, text: c.text, heading: c.heading };
    }
    return null;
  };

  const isAssignmentLine = (t: string): boolean => {
    const { core } = stripParens(t);
    const n = normAr(core);
    const rawN = normAr(t);
    if (!SECTION_ASSIGN.test(rawN) && !/(كل الفصول|جميع الفصول|لكل فصل|باكمله|باكملها)/.test(rawN)) return false;
    // reject sentences that are clearly rules (they contain period words together with day names)
    if (/(يعمل|تعمل|اجازه|يفضل|يرجي|ملاحظه|قاعده)/.test(n) && !/[:：]\s*\d/.test(n) && !/لكل/.test(n)) return false;

    const STOP_ASSIGN_WORDS = new Set([
      "و", "حصه", "حصص", "حصتين", "لكل", "من", "فصل", "كل", "الفصول", "جميع",
      "اسبوعيه", "الصف", "باكمله", "باكملها", "فقط", "عربي", "دين", "انجليزي",
      "علوم", "رياضيات", "دراسات", "حاسب", "الي", "مجالات", "العاب", "رسم",
      "واحده", "واحد", "اسبوعيا", "تعبير", "نحو", "مكمل", "املاء", "خط", "بالكامل"
    ]);

    const tokens = n.replace(/[\d:：،,.\-–()\/\\ـ*#]/g, " ").split(/\s+/).filter(Boolean);
    const leftover = tokens.filter(
      (w) => !STOP_ASSIGN_WORDS.has(w) && !STOP_ASSIGN_WORDS.has(w.replace(/^ال/, "")) && !canonicalSubject(w)
    );
    return leftover.length <= 2;
  };

  const parseAssignmentLine = (t: WorkingTeacher | undefined, line: string, subjectOverride?: string): boolean => {
    if (!t) return false;
    const { core } = stripParens(line);
    const n = normAr(core);
    // subject suffix in the line ("1\5 : 8 عربي")
    let subj: string | undefined = subjectOverride;
    const tailSubj = canonicalSubject(n.replace(/\d{1,2}\s*[\/\\]\s*\d{1,2}/g, " ").replace(/\d+/g, " "));
    if (tailSubj && !subjectOverride) subj = tailSubj.name;

    const safeAddAssign = (targetTeacher: WorkingTeacher, code: string, count: number, sName?: string) => {
      const secCode = parseSectionCodeLocal(code);
      if (matrixSections.has(secCode)) return;
      addAssign(targetTeacher, secCode, count, sName);
    };

    // count extraction
    const countNear = (s: string): number | null => {
      const m = s.match(/[:：]\s*(\d+)/) || s.match(/(\d+)\s*(?:حصه|حصص)/);
      if (m) return Number(m[1]);
      if (/حصتين/.test(s)) return 2;
      const w = s.match(/(?:^|\s)(حصه|ثلاث حصص|اربع حصص|خمس حصص)(?:\s|$)/);
      if (w) return numberFromWord(w[1].split(" ")[0]) ?? 1;
      return null;
    };

    // "حصتين لكل من 3/1 و 3/2" / "وحصتين لكل من ..." -> possibly several groups in one line
    const groups = n.split(/(?=\s?و?(?:حصه|حصتين|\d+\s*حصص)\s+لكل)/g).filter((g) => g.trim());
    if (/لكل/.test(n) && groups.length >= 1 && /(حصه|حصتين|حصص)\s+لكل/.test(n)) {
      let any = false;
      for (const g of groups) {
        const codes = findSectionCodes(g);
        const cnt = /حصتين/.test(g) ? 2 : (g.match(/(\d+)\s*حصص/) ? Number(g.match(/(\d+)\s*حصص/)![1]) : 1);
        if (/لكل\s+فصل/.test(g) && codes.length === 0) {
          pendingAll.push({ teacher: t, subject: subj || currentSubject, count: cnt });
          any = true;
        } else for (const c of codes) (safeAddAssign(t, c, cnt, subj), (any = true));
      }
      if (any) return true;
    }
    // grade-wide: "الصف الاول باكمله" (+ "كل فصل حصة")
    if (/باكمل/.test(n)) {
      const grades: number[] = [];
      for (const m of n.matchAll(/(?:الصف\s+)?(?:ال)?(اول|اولي|ثاني|ثانيه|ثالث|ثالثه|رابع|خامس|سادس)(?=\s|$)/g)) {
        const g = gradeFromWord(m[1]);
        if (g && !grades.includes(g)) grades.push(g);
      }
      const cnt = countNear(n) ?? (/حصتين/.test(n) ? 2 : 1);
      for (const g of grades) pendingAll.push({ teacher: t, subject: subj || currentSubject, count: cnt, grade: g });
      if (grades.length) return true;
    }
    if (/(كل الفصول|جميع الفصول|لكل فصل|كل فصل)/.test(n) && findSectionCodes(n).length === 0) {
      pendingAll.push({ teacher: t, subject: subj || currentSubject, count: countNear(n) ?? 1 });
      return true;
    }
    if (/(كل الفصول|جميع الفصول|كل فصل)/.test(n) && findSectionCodes(n).length > 0 && /(حصه|حصص|حصتين)/.test(n)) {
      // "جميع الفصول: حصة اسبوعية لكل فصل (1/1 ، 1/2 ...)"
      pendingAll.push({ teacher: t, subject: subj || currentSubject, count: countNear(n.replace(/\d{1,2}\s*[\/\\]\s*\d{1,2}/g, " ")) ?? 1 });
      return true;
    }
    const codes = findSectionCodes(n);
    if (codes.length === 0) return false;
    if (codes.length === 1) {
      const m = n.match(/\d{1,2}\s*[\/\\]\s*\d{1,2}\s*[:：]?\s*(\d+)?/);
      let cnt = m && m[1] ? Number(m[1]) : null;
      if (cnt === null) {
        const after = n.replace(/\d{1,2}\s*[\/\\]\s*\d{1,2}/, " ");
        cnt = /حصتين/.test(after) ? 2 : /حصه/.test(after) ? 1 : null;
      }
      if (cnt === null) {
        // "1\3 : دين" or bare "1\3": default one period
        cnt = tailSubj || /^\s*\d{1,2}\s*[\/\\]\s*\d{1,2}\s*[:：]?\s*$/.test(n) ? 1 : null;
        if (cnt === null) return false;
        if (tailSubj && !/\d+\s*(?:حصه|حصص)?\s*(عربي|دين)/.test(n)) {
          notes.push(`السطر "${line.trim()}" بلا عدد حصص صريح، افترضت حصة واحدة.`);
        }
      }
      safeAddAssign(t, codes[0], cnt, subj);
      return true;
    }
    // several sections in one line without per-section counts: "1\1 و 1\2" -> 1 each; with global count "2 حصص"
    const cntAll = countNear(n.replace(/\d{1,2}\s*[\/\\]\s*\d{1,2}/g, " ")) ?? 1;
    for (const c of codes) safeAddAssign(t, c, cntAll, subj);
    return true;
  };

  for (let li = 0; li < cleanedLines.length; li++) {
    const { text: ln, heading } = cleanedLines[li];
    if (!ln || /^[-_=*─|:\s]{3,}$/.test(ln)) continue;
    if (ln.startsWith("|")) continue; // tables are handled above
    if (ln.startsWith(">") || ln.startsWith("$$") || /^\s*\d+\.\s*\[/.test(ln)) continue;
    if (/^\[!(?:IMPORTANT|NOTE|TIP|WARNING|CAUTION)\]/i.test(ln)) continue;
    if (/^\[.*?\]\(.*?\)/.test(ln)) continue;
    if (/القاعده|قاعده|خلاصه|دليل|ارشادي|لتفادي|تنبيه|الملفات|الرقم جهه|عند القراءه|قراءه وتدوين|اجمالي الحصص/i.test(normAr(ln))) continue;
    const n = normAr(ln);
    const { core, parens } = stripParens(ln);
    const coreN = normAr(core).replace(/[:：]\s*$/, "").trim();

    // ---- school title / info ----
    if (!nameSet) {
      const mName = ln.match(/^(?:اسم المدرسه|اسم المدرسة)\s*[:：]\s*(.+)$/);
      if (mName) {
        compact.name = mName[1].trim();
        nameSet = true;
        continue;
      }
      if ((heading || /مدرسه/.test(n) || li === 0) && !SECTION_ASSIGN.test(n) && !sawSubjectOrTeacher && ln.length < 90 && !/[:：]/.test(ln)) {
        compact.name = core.replace(/^#+\s*/, "").trim() || ln;
        nameSet = true;
        continue;
      }
    }
    if (/^(اسم المدرسه|اسم المدرسة)/.test(n)) {
      const m = ln.match(/[:：]\s*(.+)$/);
      if (m) compact.name = m[1].trim();
      continue;
    }
    if (/^(العام الدراسي|السنه الدراسيه)/.test(n)) {
      const m = ln.match(/[:：]\s*(.+)$/);
      if (m) compact.academic_year = m[1].trim();
      continue;
    }
    if (!sawSubjectOrTeacher && /^(المرحله|المرحلة)/.test(n)) {
      compact.stage = ln.replace(/^[^:：]*[:：]\s*/, "");
      continue;
    }
    if (!sawSubjectOrTeacher && !/[:：]/.test(ln) && /^(ابتدائي|الابتدائي|اعدادي|الاعدادي|ثانوي|الثانوي|ابتدائيه|اعداديه)$/.test(coreN)) {
      compact.stage = core;
      continue;
    }
    if (/^سجل التعديلات/.test(n)) {
      break; // log section: everything after is history
    }
    // days
    if (!sawSubjectOrTeacher && /(ايام الدراسه|ايام العمل|ايام الدوام)/.test(n)) {
      const range = parseDayRange(ln) || parseDaysList(ln.replace(/\(.*?\)/g, ""));
      if (range.length) compact.days = range;
      continue;
    }
    if (!sawSubjectOrTeacher && !SECTION_ASSIGN.test(n) && /(الي|حتي|للخميس|للاربعاء|→)/.test(n) && !/(حصه|حصص)/.test(n) && parseDayRange(ln)) {
      compact.days = parseDayRange(ln)!;
      continue;
    }
    // periods per day (info lines before the first subject/teacher)
    if (!sawSubjectOrTeacher && /(حصه|حصص|الحصص)/.test(n) && !isAssignmentLine(ln) || (/^(عدد الحصص|نظام الحصص|حصص فصل)/.test(n))) {
      const secOverride = n.match(/^حصص فصل\s+(\d+\s*[\/\\]\s*\d+)\s*[:：]/);
      let found = false;
      const byDay: Record<string, number> = {};
      const re = /([^\s\d،,:]+)\s*[:：]?\s*(\d{1,2})\b/g;
      let m: RegExpExecArray | null;
      const body = secOverride ? n.replace(/^[^:：]*[:：]/, "") : n;
      while ((m = re.exec(body))) {
        const d = dayFromToken(m[1]);
        if (d !== null) {
          byDay[String(d)] = Number(m[2]);
          found = true;
        }
      }
      const rest = body.match(/(?:باقي|بقيه|بقية|باقى)\s*(?:ال)?ايام[^\d]*(\d{1,2})/) || body.match(/(?:وباقي|وبقيه)[^\d]*(\d{1,2})/);
      if (rest) {
        restPeriods = Number(rest[1]);
        found = true;
      }
      if (!found && !secOverride) {
        const g = body.match(/(\d{1,2})\s*حصص?\s*(?:يوميا|يوميه|في اليوم)/) || body.match(/عدد الحصص(?: اليوميه)?\s*[:：]?\s*(\d{1,2})/) || body.match(/الحصص\s*[:：]\s*(\d{1,2})/);
        if (g) {
          allPeriods = Number(g[1]);
          found = true;
        }
      }
      if (found) {
        if (secOverride) sectionPeriodOverrides.push({ code: parseSectionCodeLocal(secOverride[1]), byDay });
        else Object.assign(periodByDay, byDay);
        continue;
      }
    }
    // grade counts: "الصف الاول 3 فصول" / "اولى 6"
    if (!sawSubjectOrTeacher && !SECTION_ASSIGN.test(n) && !/[:：]/.test(ln)) {
      const gm = n.match(/^(?:الصف\s+)?(?:ال)?(اول|اولي|ثاني|ثانيه|ثالث|ثالثه|رابع|رابعه|خامس|خامسه|سادس|سادسه)\w*\s+(\d+|فصلين|فصل)\s*(?:فصول|فصل)?$/);
      if (gm) {
        const g = gradeFromWord(gm[1])!;
        const cnt = /^\d+$/.test(gm[2]) ? Number(gm[2]) : gm[2] === "فصلين" ? 2 : 1;
        for (let i = 1; i <= cnt; i++) {
          const code = `${g}/${i}`;
          if (!declaredSections.includes(code)) declaredSections.push(code);
        }
        continue;
      }
    }
    // declared section list
    if (/^(الفصول|هيكل الفصول|الشعب)/.test(n) && SECTION_ASSIGN.test(n) && !/[:：]\s*\d+\s*$/.test(n)) {
      for (const c of findSectionCodes(n)) if (!declaredSections.includes(c)) declaredSections.push(c);
      continue;
    }
    if (!sawSubjectOrTeacher && !currentTeacher && SECTION_ASSIGN.test(n) && !/[:：]\s*\d+\s*$/.test(n) && !/لكل/.test(n)) {
      for (const c of findSectionCodes(n)) if (!declaredSections.includes(c)) declaredSections.push(c);
      continue;
    }
    // structural headings to ignore
    if (heading && /(هيكل الفصول|الفصول|توزيع المواد|المواد والانصبه|الانصبه|معلومات|بيانات المدرسه)/.test(n) && !canonicalSubject(coreN)) {
      continue;
    }
    // general rules
    if (/^(قاعده عامه|قواعد عامه|ملحوظه للكل|ملاحظه للكل|ملحوظه|ملاحظه)/.test(n) && !currentTeacher || /^(قاعده عامه|ملحوظه للكل|ملاحظه للكل)/.test(n)) {
      const body = ln.replace(/^[^:：]*[:：]\s*/, "").trim() || ln;
      const bn = normAr(body);
      const br = bn.match(/الفسحه بعد الحصه\s*(\d+)/);
      if (br) compact.rules!.break_after_period = Number(br[1]);
      if (/السماح بالفراغات/.test(bn)) compact.rules!.no_section_gaps = false;
      if (/عدم تقليل فراغات المعلمين/.test(bn)) compact.rules!.minimize_teacher_gaps = false;
      const p = parseRuleText(body);
      if (p.global_max_consecutive_same) compact.rules!.max_consecutive_same_teacher_section = p.global_max_consecutive_same;
      if (p.before_break) getSubject(canonicalSubject("دين")!.name).before_break = true;
      continue;
    }
    if (/^الدين (يكون )?قبل الفسحه/.test(n) || /^الفسحه بعد الحصه/.test(n)) {
      const p = parseRuleText(ln);
      applyParsed(undefined, p, ln);
      const br = n.match(/الفسحه بعد الحصه\s*(\d+)/);
      if (br) compact.rules!.break_after_period = Number(br[1]);
      continue;
    }
    // global "last period on specific days" section
    if (/(تفاصيل اخري|قيود اضافيه|المغادره المبكره|ياخذون اخر حصه|اخر حصه في ايام)/.test(n) && !SECTION_ASSIGN.test(n)) {
      globalMode = true;
      currentTeacher = undefined;
      continue;
    }
    if (globalMode) {
      // "الاحد" alone, or "يوم الأحد: name, name"
      const dm = n.match(/^(?:يوم\s+)?([^\s:：]+)\s*(?:[:：]\s*(.*))?$/);
      if (dm) {
        const d = dayFromToken(dm[1]);
        if (d !== null) {
          globalDay = d;
          const names = (ln.split(/[:：]/)[1] || "")
            .split(/[،,]|\sو\s/)
            .map((x) => x.replace(/[*_]/g, "").trim())
            .filter(Boolean);
          for (const nm of names) pendingLast.push({ day: d, name: nm });
          continue;
        }
      }
      const withDay = ln.match(/^(?:يوم\s+)?([^\s:：]+)\s*[:：]\s*(.+)$/);
      if (withDay && dayFromToken(withDay[1]) !== null) {
        const d = dayFromToken(withDay[1])!;
        for (const nm of withDay[2].split(/[،,]|\sو\s/).map((x) => x.replace(/[*_]/g, "").trim()).filter(Boolean)) pendingLast.push({ day: d, name: nm });
        continue;
      }
      if (globalDay !== null && ln.length < 50 && !SECTION_ASSIGN.test(n)) {
        pendingLast.push({ day: globalDay, name: core });
        continue;
      }
    }
    if (/^(?:يوم\s+)?(الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس|السبت)\s*[:：]\s*[^\d]+$/.test(n) && ln.split(/[،,]/).length >= 1 && !currentTeacher && sawSubjectOrTeacher) {
      const dm = ln.match(/^(?:يوم\s+)?([^\s:：]+)\s*[:：]\s*(.+)$/);
      if (dm && dayFromToken(dm[1]) !== null) {
        const d = dayFromToken(dm[1])!;
        for (const nm of dm[2].split(/[،,]|\sو\s/).map((x) => x.trim()).filter(Boolean)) pendingLast.push({ day: d, name: nm });
        continue;
      }
    }

    // ---- detail blocks: التفاصيل "..." ----
    if (/^(التفاصيل|تفاصيل|التفضيلات|تفضيلات|ملاحظه|ملاحظات|قيد)\b/.test(n) && !/^تفاصيل اخري/.test(n)) {
      let body = ln.replace(/^[^:："“\s]*\s*[\w\u0600-\u06FF]*\s*[:：]?\s*/, (m) => (/^(التفاصيل|تفاصيل|التفضيلات|تفضيلات|ملاحظه|ملاحظات|ملاحظة|قيد)/.test(normAr(m)) ? "" : m));
      body = ln.replace(/^(?:التفاصيل|تفاصيل|التفضيلات|تفضيلات|ملحوظة|ملاحظة|ملاحظات|قيد)[^:："“]*[:：]?\s*/, "");
      const quotes = (ln.match(/["“”]/g) || []).length;
      let acc = body;
      if (quotes % 2 === 1) {
        let j = li + 1;
        while (j < cleanedLines.length) {
          const nxt = cleanedLines[j].raw;
          acc += "\n" + nxt;
          if (/["“”]/.test(nxt)) break;
          j++;
        }
        li = j;
      }
      const p = parseRuleText(acc);
      applyParsed(currentTeacher, p, acc.replace(/["“”\n]+/g, " ").trim());
      continue;
    }

    // ---- assignment lines ----
    if (currentTeacher && isAssignmentLine(ln)) {
      if (parseAssignmentLine(currentTeacher, ln)) continue;
    }

    // ---- subject header ----
    const headerLike = !SECTION_ASSIGN.test(n.replace(/\(.*?\)/g, "")) && ln.length < 140;
    if (headerLike && (coreN.length > 0 && coreN.length < 40)) {
      const subjList = canonicalSubjectsInHeader(coreN);
      const nx = nextContent(li);
      const nextIsAssign = nx ? isAssignmentLine(nx.text) : false;
      const endsColon = /[:：]\s*$/.test(ln);
      // a canonical subject that is NOT directly followed by an assignment line is a subject header
      if (subjList.length > 0 && !nextIsAssign && coreN.split(" ").length <= 5) {
        sawSubjectOrTeacher = true;
        currentSubject = subjList[0];
        currentSubjectCombo = subjList;
        currentTeacher = undefined;
        globalMode = false;
        for (const s of subjList) getSubject(s);
        const merged = parens.join(" ");
        if (merged) {
          const p = parseRuleText(merged);
          if (p.double || p.subject_double) getSubject(currentSubject).double = p.double === "SINGLE" ? "SINGLE" : "REQUIRED";
          if (p.before_break) getSubject(currentSubject).before_break = true;
        }
        continue;
      }
      void endsColon;
    }

    // ---- teacher header (must come before generic teacher rule-lines) ----
    if (headerLike && isTeacherNameLike(core) && !/^[\d\s/\\:：.\-]+$/.test(core)) {
      const nm = core.replace(/[:：]\s*$/, "").trim();
      if (nm && !/^(المواد|الفصول)\b/.test(normAr(nm))) {
        sawSubjectOrTeacher = true;
        globalMode = false;
        // sub-subject in teacher header? e.g. "جمال عواد :" keeps current subject
        const t = getTeacher(nm);
        currentTeacher = t;
        if (currentSubject) t.subject = t.subject || currentSubject;
        for (const par of parens) {
          const p = parseRuleText(par);
          const hasWork = par.length > 0;
          if (!p.understood && hasWork && !/(متفرغ|كامل|منتدب)/.test(normAr(par))) {
            t.notes = [t.notes, par].filter(Boolean).join(" | ");
          }
          applyParsed(t, p, par);
        }
        // trailing text after the name on same line is covered by parentheses above
        continue;
      }
    }

    // ---- rule-ish lines for the current teacher ----
    const looksLikeRule = /(حصه|حصص|اول|اخر|اخيره|يعمل|تعمل|اجازه|يفضل|يرجي|مزدوج|متتاليه|فاضيه|فتره|لا يعمل|عدد حصصه|اقصي|اياما)/.test(n) || (dayFromToken(n.split(" ")[0]) !== null && /[:：]/.test(ln)) || /^(يوم )?(الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس|السبت|الحد|الاخد)/.test(n);
    if (currentTeacher && (looksLikeRule || (coreN.split(" ").length > 6))) {
      const body = ln.replace(/^ملاحظه\s*[:：]\s*/, "");
      applyParsed(currentTeacher, parseRuleText(body), body);
      continue;
    }
    if (heading || /^[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}]/u.test(ln)) continue;
    notes.push(`لم أفهم السطر: "${ln.slice(0, 80)}"`);
  }

  // ---- finalize ----
  const days = compact.days && compact.days.length ? compact.days : [0, 1, 2, 3, 4];
  compact.days = days;
  if (Object.keys(periodByDay).length || restPeriods || allPeriods) {
    const arr: number[] = [];
    for (const d of days) {
      const v = periodByDay[String(d)] ?? (restPeriods || allPeriods || Math.max(0, ...Object.values(periodByDay)));
      arr.push(v);
    }
    compact.periods_by_day = arr;
  }
  const codes = allCodesSoFar();
  compact.sections = [...new Set([...declaredSections, ...codes])];
  // resolve "all sections" / grade-wide assignments
  for (const pa of pendingAll) {
    const targets = compact.sections.filter((c) => (pa.grade ? parseSectionPartsLocal(c)?.grade === pa.grade : true));
    for (const c of targets) {
      if (matrixSections.has(c)) continue;
      pa.teacher.assignments.push({ section: c, periods: pa.count, subject: pa.subject });
    }
  }
  // resolve pending "last period on day" requests
  const tList = [...teachers.values()];
  for (const pl of pendingLast) {
    const probe: SchoolData = { teachers: tList.map((t) => ({ id: t._nameKey, name: t.name })) } as any;
    const r = resolveTeacher(probe, pl.name);
    if (r.teacher) {
      const wt = teachers.get(r.teacher.id)!;
      wt.rules = [...(wt.rules || []), { day: pl.day, type: "HAS_LAST", hard: false, weight: 9 }];
    } else notes.push(`لم أجد معلماً باسم "${pl.name}" لتطبيق قيد الحصة الأخيرة.`);
  }
  compact.subjects = [...subjects.values()];
  compact.teachers = tList.map(({ _nameKey, ...rest }) => rest);
  // per-section period overrides are applied by the caller through ops (rare); store as notes
  if (sectionPeriodOverrides.length) (compact as any)._section_period_overrides = sectionPeriodOverrides;
  return { compact, notes, unparsed_notes: unparsedNotes };
}

function parseSectionPartsLocal(code: string) {
  return parseSectionParts(code);
}

function isTeacherNameLike(core: string): boolean {
  // short Arabic names without rule keywords ("محمد نجاح") are teacher headers
  const clean = core.replace(/^[#*_\s]+|[#*_\s]+$/g, "").replace(/[:：]/g, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return false;
  if (/[\$\\\{\}\[\]\<\>\*_`~]/.test(clean)) return false;
  if (/\.(xlsx|pdf|docx|csv|txt|md|html)\b/i.test(clean)) return false;
  if (/https?:\/\//i.test(clean)) return false;
  const cn = normAr(clean);
  if (/(حصه|حصص|اول|اخر|اخيره|يعمل|تعمل|اجازه|يفضل|يرجي|مزدوج|متتاليه|فاضيه|فتره|عدد حصصه|اقصي|اياما)/.test(cn)) return false;
  if (/^(يوم )?(الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس|السبت|الحد|الاخد)(?:\s|$)/.test(cn)) return false;
  if (/^(المواد|الفصول|هيكل|جدول|توزيع|الصف|الصفوف|شعب|شعبة|فصول|فصل|معلومات|بيانات|ملاحظه|ملاحظات|قاعده|قواعد|ملحوظه|دليل|ارشادي|خلاصه|كشف|تنبيه|هام|العجز|الملفات|نسخه|ملخص|سجل)(?:\s|$)/.test(cn)) return false;
  return true;
}

/** Builds a SchoolData directly from any text (canonical markdown or the teachers' free-form notes). */
export function parseSchoolText(text: string): BuildResult & { parseNotes: string[]; unparsed_notes: string[] } {
  const { compact, notes, unparsed_notes } = parseSchoolMarkdown(text);
  const built = buildSchoolFromCompact(compact);
  // apply per-section period overrides if any
  const overrides = (compact as any)._section_period_overrides as Array<{ code: string; byDay: Record<string, number> }> | undefined;
  if (overrides) {
    for (const o of overrides) {
      const sec = built.school.sections.find((s) => s.code === o.code);
      if (sec) sec.daily_period_limits = { ...(sec.daily_period_limits || Object.fromEntries(built.school.days.map((d) => [String(d), built.school.periods_per_day]))), ...o.byDay };
    }
  }
  const capacityValidation = validateSchoolCapacity(built.school);
  if (!capacityValidation.is_valid) {
    for (const err of capacityValidation.errors) {
      built.notes.push(err);
    }
  }
  (built.school as any).capacity_validation = capacityValidation;
  return { ...built, parseNotes: notes, unparsed_notes: unparsed_notes || [] };
}

// ---------------------------------------------------------------------------
// Deterministic natural-language command interpreter (works without any AI)
// ---------------------------------------------------------------------------

export interface InterpretResult {
  ops: Op[];
  understood: boolean;
  solve_only?: boolean;
  new_school_text?: string;
  hints: string[];
}

/**
 * Advanced Teacher-Centric Multi-Assignment & Creation Parser.
 * Handles natural language instructions like:
 * - "ضيف أستاذ محمود مدرس لغة عربية لفصل 1/1 و 1/2 بواقع 6 حصص لكل فصل"
 * - "اسند لمستر أحمد مادة الرياضيات لفصول 1/1 و 1/2 4 حصص"
 * - "خلي عصام يدرس علوم لفصل 2/1 5 حصص"
 * - "احذف مادة العربي من أستاذ كمال"
 */
export function parseTeacherCentricAssignment(
  school: SchoolData,
  message: string,
  extractedCodes: string[] = [],
  knownTeacherRef?: string
): Op[] | null {
  const n = normAr(message);

  // Check if intent is teacher assignment / unassignment / addition with subjects
  const isAssignmentIntent =
    /(اسند|سند|عين|خلي|اجعل|ضيف|اضف|سجل|يدرس|تدرس|مدرس|معلم|استاذ|تكليف|تكليفات|احذف|شيل|امسح)/.test(n) &&
    /(مادة|ماده|لمادة|لماده|يدرس|تدرس|مدرس|معلم|حصص|حصة|حصه|عرب|رياض|علوم|دراس|انجليز|دين|حاسب|رسم|فصل|فصول)/.test(n);

  if (!isAssignmentIntent) return null;

  // 1. Resolve Teacher
  let teacherName = knownTeacherRef;
  if (!teacherName) {
    const tm = resolveTeacherFromMessage(school, message);
    if (tm.teacher) {
      teacherName = tm.teacher.name;
    }
  }

  // If still not resolved, attempt to extract teacher candidate from phrases like:
  // "ضيف أستاذ محمود مدرس..." or "سجل معلم جديد اسمه سامح يدرس..."
  if (!teacherName) {
    const newTMatch = message.match(
      /(?:اضف|اضافه|ضيف|سجل|خلي|اسند|عين)\s+(?:ال)?(?:مدرس|معلم|مدرسه|معلمه|[أإآا]?ستاذ|[أإآا]?ستاذه|مستر|أ\.)?\s*(?:جديد\s+|جديدة\s+)?(?:اسمه|اسمها)?\s*([^\n,،\d]+?)(?:\s+(?:مدرس|معلم|[أإآا]?ستاذ|يدرس|تدرس|لمادة|لماده|مادة|ماده|في|بواقع|لفصل|لفصول))/
    );
    if (newTMatch) {
      let cand = newTMatch[1].trim();
      cand = cand.replace(/^(اسمه|اسمها)\s+/, "").replace(/\s+(?:جديد|جديده)$/, "").trim();
      cand = cand.replace(/^(?:ال)?(?:[أإآا]?ستاذ|[أإآا]?ستاذه|معلم|معلمه|مدرس|مدرسه|مستر|أ\.)\s+/, "").trim();
      if (cand && cand.length >= 2 && !/(المدرسة|الجدول|الفصل|المادة|حصة|حصص)/.test(normAr(cand))) {
        teacherName = cand;
      }
    }

  }

  // 2. Resolve Subject
  const subjObj = findSubjectInMessage(school, message);
  let subjectName = subjObj?.name;
  if (!subjectName) {
    if (/عرب|قرائ|نصوص|لغه عربيه|لغة عربية/.test(n)) subjectName = "اللغة العربية";
    else if (/رياض|حساب|جبر|هندس|math/.test(n)) subjectName = "الرياضيات";
    else if (/علوم|ساينس|science/.test(n)) subjectName = "العلوم";
    else if (/دراسات|جغرافي|تاريخ/.test(n)) subjectName = "الدراسات الاجتماعية";
    else if (/انجليز|انكليز|english/.test(n)) subjectName = "اللغة الإنجليزية";
    else if (/دين|اسلام|تربيه دينيه|تربية دينية/.test(n)) subjectName = "التربية الدينية";
    else if (/حاسب|كمبيوتر|تكنولوجي/.test(n)) subjectName = "الحاسب الآلي";
    else if (/رسم|فنيه|فنية/.test(n)) subjectName = "التربية الفنية";
    else if (/رياضه|بدنيه|العاب|رياضية/.test(n)) subjectName = "التربية الرياضية";
    else {
      const subMatch = message.match(
        /(?:مادة|ماده|لمادة|لماده|يدرس|تدرس|مدرس|معلم)\s+([^\n,،\d]+?)(?:\s+(?:لفصل|لفصول|بواقع|بعدد|عدد|\d+)|$)/
      );
      if (subMatch) {
        const candidate = subMatch[1].trim();
        if (!/(جديد|جديده|استاذ|معلم|مدرس)/.test(normAr(candidate)) && candidate.length >= 2) {
          subjectName = candidate;
        }
      }
    }
  }

  // Map to exact existing school subject name if available
  if (subjectName) {
    const existingSub = school.subjects.find((s) => normAr(s.name) === normAr(subjectName!));
    if (existingSub) subjectName = existingSub.name;
  }

  if (!teacherName && !subjectName) return null;

  // 3. Deletion / unassignment intent: e.g. "احذف مادة العربي من أستاذ كمال"
  const isDeleteIntent =
    /(احذف|شيل|امسح|الغ).*(مادة|ماده|تكليف|حصص)/.test(n) || /(مادة|ماده).*(احذف|شيل|امسح)/.test(n);
  if (isDeleteIntent && teacherName && subjectName) {
    const tch = school.teachers.find((t) => normAr(t.name) === normAr(teacherName!));
    if (tch) {
      const matchingSub = school.subjects.find((s) => normAr(s.name) === normAr(subjectName!));
      if (matchingSub) {
        const targetAsgs = school.assignments.filter(
          (a) => a.teacher_id === tch.id && a.subject_id === matchingSub.id
        );
        if (targetAsgs.length > 0) {
          return targetAsgs.map((a) => {
            const sec = school.sections.find((s) => s.id === a.section_id);
            return {
              op: "set_assignment" as const,
              section: sec?.name || a.section_id,
              subject: matchingSub.name,
              teacher: tch.name,
              periods: 0,
            };
          });
        }
      }
    }
  }

  // 4. Resolve Sections
  let resolvedSections: string[] = [...extractedCodes];
  if (resolvedSections.length === 0) {
    if (/(لفصول|فصول|شعب)\s+(الصف\s+)?(الاول|الأول|اولى|أولى|1)/.test(n)) {
      resolvedSections = school.sections
        .filter((s) => s.name.startsWith("1/") || s.code.startsWith("1-") || s.grade_id.includes("1"))
        .map((s) => s.name);
    } else if (/(لفصول|فصول|شعب)\s+(الصف\s+)?(الثاني|تانية|تانيه|2)/.test(n)) {
      resolvedSections = school.sections
        .filter((s) => s.name.startsWith("2/") || s.code.startsWith("2-") || s.grade_id.includes("2"))
        .map((s) => s.name);
    } else if (/(لفصول|فصول|شعب)\s+(الصف\s+)?(الثالث|تالتة|تالته|3)/.test(n)) {
      resolvedSections = school.sections
        .filter((s) => s.name.startsWith("3/") || s.code.startsWith("3-") || s.grade_id.includes("3"))
        .map((s) => s.name);
    }
  }

  // 5. Resolve Periods
  let periods: number | null = null;
  const periodMatch = message.match(/(\d+)\s*(?:حصة|حصص|حصه)/);
  if (periodMatch) {
    periods = Number(periodMatch[1]);
  } else {
    for (const tok of n.split(/\s+/)) {
      const v = numberFromWord(tok);
      if (v !== null && v > 0) {
        periods = v;
        break;
      }
    }
  }

  if (periods === null && subjectName) {
    const existingAsg = school.assignments.find((a) => {
      const sub = school.subjects.find((s) => s.id === a.subject_id);
      return sub && normAr(sub.name) === normAr(subjectName!);
    });
    if (existingAsg) {
      periods = existingAsg.weekly_periods;
    } else {
      periods = normAr(subjectName).includes("عرب")
        ? 6
        : normAr(subjectName).includes("رياض")
        ? 5
        : 4;
    }
  }

  // If teacher, subject, and at least one section are present:
  if (teacherName && subjectName && resolvedSections.length > 0 && periods !== null && periods > 0) {
    const ops: Op[] = [];
    const teacherExists = school.teachers.some((t) => normAr(t.name) === normAr(teacherName!));
    if (!teacherExists) {
      ops.push({ op: "add_teacher", name: teacherName, subject: subjectName });
    }
    for (const sec of resolvedSections) {
      ops.push({
        op: "set_assignment",
        section: sec,
        subject: subjectName,
        teacher: teacherName,
        periods: periods,
      });
    }
    return ops;
  }

  return null;
}

export function interpretCommand(
  message: string,
  school: SchoolData,
  history?: Array<{ role: string; text?: string; changes?: string[] }>
): InterpretResult {
  const ops: Op[] = [];
  const hints: string[] = [];
  const n = normAr(message);
  const allDays = school.days;

  // ---- 0. Revert / Undo / Cancel (تراجع عن الإجازة، إلغاء الإجازة، كنسل، شيل الأوف، إلغاء التبديل) ----
  const isRevert = /(تراجع|الغي|الغ|كنسل|شيل|امسح|عدل عن|افتح|فتح|خليه يداوم|خلها تداوم)/.test(n);
  if (isRevert) {
    const isRevertSwap = /(تبديل|بدل|swap)/.test(n);
    const isRevertOff =
      /(اجازه|اجازة|اوف|أوف|تفرغ|راحه|راحة|الاقفال|قفل)/.test(n) ||
      /(افتح|فتح).*(يوم|السبت|الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس)/.test(n) ||
      /(خليه يداوم|خلها تداوم)/.test(n) ||
      /^(تراجع|الغي|الغ|كنسل)$/.test(n.trim()) ||
      /^(تراجع|الغي|الغ)\s+(عن\s+)?(الطلب|التعديل|القرار|اخر تعديل|اخر طلب)/.test(n.trim());

    if (isRevertSwap) {
      let t1: Teacher | undefined;
      let t2: Teacher | undefined;
      const foundInMsg = findTeachersInMessage(school, message);
      if (foundInMsg.length >= 2) {
        t1 = foundInMsg[0];
        t2 = foundInMsg[1];
      } else if (Array.isArray(history) && history.length > 0) {
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          const textToScan = [h.text, ...(h.changes || [])].filter(Boolean).join(" ");
          const histFound = findTeachersInMessage(school, textToScan);
          if (histFound.length >= 2) {
            t1 = histFound[0];
            t2 = histFound[1];
            break;
          }
        }
      }
      if (t1 && t2) {
        ops.push({ op: "swap_teachers", teacher_a: t1.name, teacher_b: t2.name });
        return { ops, understood: true, hints };
      }
    }

    if (isRevertOff) {
      // 1. Resolve teacher from current message
      let targetTeacher = resolveTeacherFromMessage(school, message).teacher;

      // 2. If not in current message, look back into history (from newest to oldest)
      if (!targetTeacher && Array.isArray(history) && history.length > 0) {
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          const textToScan = [h.text, ...(h.changes || [])].filter(Boolean).join(" ");
          const found = findTeachersInMessage(school, textToScan);
          if (found.length > 0) {
            targetTeacher = found[0];
            break;
          }
        }
      }

      // 3. If still not found, check if any teachers currently have MANDATORY_OFF
      if (!targetTeacher) {
        const teachersWithOff = school.teachers.filter(
          (t) => Object.values(t.work_pattern?.day_rules || {}).includes("MANDATORY_OFF")
        );
        if (teachersWithOff.length === 1) {
          targetTeacher = teachersWithOff[0];
        } else if (teachersWithOff.length > 1) {
          targetTeacher = teachersWithOff[0];
        }
      }

      if (targetTeacher) {
        // Resolve days to allow
        const daysInMsg = parseDaysList(message);
        let daysToAllow: number[] = [];
        if (daysInMsg.length > 0) {
          daysToAllow = daysInMsg;
        } else {
          // Look in history for day
          if (Array.isArray(history) && history.length > 0) {
            for (let i = history.length - 1; i >= 0; i--) {
              const h = history[i];
              const textToScan = [h.text, ...(h.changes || [])].filter(Boolean).join(" ");
              const histDays = parseDaysList(textToScan);
              if (histDays.length > 0) {
                daysToAllow = histDays;
                break;
              }
            }
          }
          // If still no day found, pick all days where targetTeacher has MANDATORY_OFF
          if (daysToAllow.length === 0) {
            const currentOffs = Object.entries(targetTeacher.work_pattern?.day_rules || {})
              .filter(([_, rule]) => rule === "MANDATORY_OFF")
              .map(([d]) => Number(d));
            daysToAllow = currentOffs.length > 0 ? currentOffs : [school.days[0] ?? 0];
          }
        }

        if (daysToAllow.length > 0) {
          ops.push({ op: "set_teacher_days", teacher: targetTeacher.name, allow_days: daysToAllow });
          return { ops, understood: true, hints };
        }
      }
    }
  }

  // ---- create a new school from pasted data ----
  const codes = findSectionCodes(message);
  if (message.split("\n").length >= 6 && codes.length >= 2) {
    return { ops, understood: true, new_school_text: message, hints };
  }
  const nClean = n.replace(/الجدول المدرسي|جدول مدرسي|مدرسي/g, "الجدول");
  if (
    /(انشي|انشئ|اعمل|ولد|ابني|اعد|حل|سو|سوي|ساوي|ظبط|صلح|سويلي|اعملي).*(الجدول|جدول)/.test(nClean) &&
    !/(معلم|معلمه|استاذ|فصل\s)/.test(nClean) &&
    message.length < 90
  ) {
    return { ops, understood: true, solve_only: true, hints };
  }
  if (
    /^(حل|اعد الحل|اعد توزيع|وزع|سو الجدول|سوي الجدول|سوي جدول|حل الجدول|ظبط الجدول|اعمل الجدول|سو جدول جديد|سوي جدول جديد)/.test(
      nClean
    ) &&
    message.length < 60
  ) {
    return { ops, understood: true, solve_only: true, hints };
  }

  // Teacher Swaps: Egyptian & Gulf colloquial ("بدل حصص فلان مع علان", "بدل بين فلان وعلان", "سو تبديل بين فلان وعلان")
  if (/(بدل|تبديل|بدلوا|سو تبديل|سوي تبديل)/.test(n) && !/(وحط|ونزل|مكان|بدال)/.test(n)) {
    const teachers = findTeachersInMessage(school, message);
    if (teachers.length >= 2) {
      ops.push({ op: "swap_teachers", teacher_a: teachers[0].name, teacher_b: teachers[1].name });
      return { ops, understood: true, hints };
    }
  }

  // Teacher Replacements: Egyptian & Gulf colloquial ("شيل فلان وحط مكانه علان", "شيل فلان ونزل بداله علان", "استبدل فلان بـ علان")
  if (/(شيل|ازل|استبدل|بدل مكانه|نزل بدال|احذف).*(وحط|ونزل|بدال|مكان|يحل محل|بـ|ب)/.test(n)) {
    const teachers = findTeachersInMessage(school, message);
    if (teachers.length >= 2) {
      ops.push({ op: "replace_teacher", teacher: teachers[0].name, replacement: teachers[1].name });
      return { ops, understood: true, hints };
    }
    const replacePattern = /(?:شيل|احذف|ازل|استبدل)\s+(?:ال)?(?:استاذ|معلم|مدرس)?\s*([^\n]+?)\s+(?:وحط مكانه|ونزل مكانه|وبداله|مكانه|بـ|ب|يحل محله)\s+(?:ال)?(?:استاذ|معلم|مدرس)?\s*([^\n]+)$/;
    const rm = message.match(replacePattern);
    if (rm) {
      const oldRef = rm[1].trim();
      const newRef = rm[2].trim().replace(/[.؛;!]+$/, "").trim();
      const oldT = resolveTeacher(school, oldRef).teacher || (teachers.length > 0 ? teachers[0] : undefined);
      if (oldT && newRef) {
        ops.push({ op: "replace_teacher", teacher: oldT.name, replacement: newRef });
        return { ops, understood: true, hints };
      }
    }
  }

  // teacher mention
  let teacherRef: string | undefined;
  const tm = resolveTeacherFromMessage(school, message);
  if (tm.teacher) teacherRef = tm.teacher.name;
  else if (tm.error) hints.push(tm.error);

  // Teacher-Centric Multi-Assignment & Creation (إسناد المعلم وحصصه وفصوله تلقائياً)
  const teacherCentricOps = parseTeacherCentricAssignment(school, message, codes, teacherRef);
  if (teacherCentricOps && teacherCentricOps.length > 0) {
    return { ops: teacherCentricOps, understood: true, hints };
  }


  // ---- section (add / remove) ----
  if (/(اضف|اضافه|انشئ|اعمل).*(فصل)/.test(n) && codes.length > 0) {
    const copy = message.match(/(?:نسخ|مثل|زي)\s+(?:فصل\s+)?(\d+\s*[\/\\]\s*\d+)/);
    ops.push({ op: "add_section", code: codes[0], copy_from: copy ? parseSectionCodeLocal(copy[1]) : undefined });
    return { ops, understood: true, hints };
  }
  if (/(احذف|امسح|الغ|ازل).*(فصل)/.test(n) && codes.length > 0) {
    ops.push({ op: "remove_section", section: codes[0] });
    return { ops, understood: true, hints };
  }

  // ---- add teacher ----
  const addT = message.match(
    /(?:اضف|اضافه|ضيف|سجل)\s+(?:ال)?(?:مدرس|معلم|مدرسه|معلمه|استاذ|استاذه)?\s*(?:جديد\s+)?(?:اسمه|اسمها)?\s*([^\n]+?)(?:\s+(?:لمادة|لماده|مادة|ماده|تدرس|يدرس)\s+([^\n]+?))?$/
  );
  if (addT && !teacherRef) {
    let cleanName = addT[1]
      .replace(/^(اسمه|اسمها)\s+/, "")
      .replace(/\s+(?:جديد|جديده)\s*$/, "")
      .replace(/\s+(?:يعمل|تعمل|ويعمل).*$/, "")
      .trim();
    cleanName = cleanName.replace(/^(ال)?(استاذ|معلم|مدرس|استاذه|معلمه|مدرسه)\s+/, "").trim();
    if (cleanName && cleanName.length >= 2) {
      const subjectName = addT[2]?.trim();
      ops.push({ op: "add_teacher", name: cleanName, subject: subjectName });
      return { ops, understood: true, hints };
    }
  }

  // ---- remove teacher ----
  if (/(احذف|امسح|الغ|ازل|شيل).*(مدرس|معلم|استاذ)/.test(n) && teacherRef) {
    const to = message.match(
      /(?:ونقل|وانقل|ويحل محله|بدلا منه|الي|وحط مكانه|ونزل مكانه|وبداله)\s+(?:ال)?(?:مدرس|معلم|استاذ)?\s*([^\n]+)$/
    );
    if (to) {
      ops.push({ op: "replace_teacher", teacher: teacherRef, replacement: to[1].trim() });
    } else {
      ops.push({ op: "remove_teacher", teacher: teacherRef });
    }
    return { ops, understood: true, hints };
  }
  if (/(احذف|شيل|امسح)\s+(?:ال)?(?:استاذ|معلم|مدرس)?\s*[^\n]+?\s+(خالص|نهائيا|من المدرسه|من الجدول)/.test(n) && teacherRef) {
    ops.push({ op: "remove_teacher", teacher: teacherRef });
    return { ops, understood: true, hints };
  }

  // ---- assignment periods: "اجعل حصص العربي في 1/1 ثمان" ----
  const secRef = codes[0];
  const subjMatch = findSubjectInMessage(school, message);
  if (secRef && subjMatch && /(اجعل|عدل|غير|خلي|حدد|زود|قلل|ضبط)/.test(n)) {
    const nums = [...n.replace(/\d+\s*[\/\\]\s*\d+/g, " ").matchAll(/(\d+)/g)].map((m) => Number(m[1]));
    let periods = nums.length ? nums[nums.length - 1] : null;
    if (periods === null) {
      for (const tok of n.split(" ")) {
        const v = numberFromWord(tok);
        if (v !== null && v > 0) periods = v;
      }
    }
    if (periods !== null) {
      ops.push({ op: "set_assignment", section: secRef, subject: subjMatch.name, teacher: teacherRef, periods });
      return { ops, understood: true, hints };
    }
  }
  if (secRef && subjMatch && /(احذف|امسح|الغ)/.test(n)) {
    ops.push({ op: "set_assignment", section: secRef, subject: subjMatch.name, teacher: teacherRef, periods: 0 });
    return { ops, understood: true, hints };
  }

  // ---- school-level rules & policies (consecutive limits & double periods) ----
  if (
    (/تجنب|متتاليه|منع|اقصي/.test(n) && /نفس الفصل|نفس المدرس|فصل/.test(n)) ||
    (/حصص.*مزدوج/i.test(n) || /مزدوجه/i.test(n))
  ) {
    const p = parseRuleText(message, allDays);
    if (p.global_max_consecutive_same || /منع اربع|ليست متتاليه|تجنب/.test(n)) {
      const maxConsec = p.global_max_consecutive_same || (/منع اربع/.test(n) ? 3 : 2);
      ops.push({ op: "set_school_rule", max_consecutive_same_teacher_section: maxConsec });
    }
    if (p.double || /مزدوج/.test(n)) {
      const pol = p.double || (/منع|ممنوع|بدون/.test(n) ? "SINGLE" : "REQUIRED");
      ops.push({ op: "set_double_policy", policy: pol });
    }
    if (ops.length > 0) {
      return { ops, understood: true, hints };
    }
  }
  if (/قبل الفسحه/.test(n)) {
    const sm = subjMatch?.name || "التربية الدينية";
    ops.push({ op: "set_subject_rule", subject: sm, before_break: !/(الغ|بدون|لا )/.test(n) });
    const br = n.match(/الفسحه بعد الحصه\s*(\d+)/);
    if (br) ops.push({ op: "set_school_rule", break_after_period: Number(br[1]) });
    return { ops, understood: true, hints };
  }
  if (/(الحصص|حصص) (يوميا|في اليوم)|عدد الحصص/.test(n) && !teacherRef) {
    const m = n.match(/(\d{1,2})/);
    if (m) {
      ops.push({ op: "set_periods", periods: Number(m[1]), section: codes[0] });
      return { ops, understood: true, hints };
    }
  }

  // Autonomous extraction for unlisted or newly mentioned teacher:
  // e.g. "عصام عبدالمجيد عمل يوم الخميس", "محمود النجار اجازة يوم الاحد", "أ. سمير خالد اول حصتين"
  if (!teacherRef) {
    const candidateMatch = message.match(
      /^(?:ال)?(?:استاذ|معلم|مدرس|أ\.)?\s*([^\n\d]+?)\s+(عمل|يعمل|دوام|يداوم|شغال|اجازه|أجازة|إجازة|اوف|أوف|تفرغ|راحه|راحة|الحصص|اول|اخر|يمشي|يطلع)\s*(.*)$/
    );
    if (candidateMatch) {
      const rawName = candidateMatch[1].trim().replace(/^(?:ال)?(?:استاذ|معلم|مدرس|أ\.)\s+/, "").trim();
      if (
        rawName.length >= 3 &&
        !/(الجدول|جدول|الفصل|فصل|المدرسة|مدرسة|المادة|مادة|الفسحة|فسحة|الحصص|حصة)/.test(normAr(rawName))
      ) {
        teacherRef = rawName;
        const exists = school.teachers.some((t) => normAr(t.name) === normAr(rawName));
        if (!exists) {
          ops.push({ op: "add_teacher", name: rawName });
        }
      }
    }
  }

  // ---- teacher rules ----
  if (teacherRef) {
    // Check colloquial placement shortcuts first
    const isEarly = /(يمشي بدري|يمشي مبكر|يطلع بدري|يطلع مبكر|خله يطلع بدري|خله يطلع مبكر|خليه يمشي بدري|خليه يمشي مبكر|مبكر|بدري)/.test(n);
    const isFirstSlots = /(اول حصتين|حصتين اولي|اول الحصص|حصص الصبح|الحصص الاولي|الحصص الاولى|ياخد اول)/.test(n);
    const isLastSlots = /(اخر حصتين|حصتين اخيره|اخر الحصص|الحصص الاخيره|الحصص الأخيرة|ياخد اخر)/.test(n);
    const isAvoidFirst = /(ما يبي الحصة الاولى|ما ياخدش اول حصه|لا يعمل في الاولى|تجنب الاولى|لا ياخذ الاولى)/.test(n);
    const isAvoidLast = /(ما يبي الحصة الاخيرة|ما ياخدش اخر حصه|لا يعمل في الاخيرة|تجنب الاخيرة|لا ياخذ الاخيرة)/.test(n);

    const bodyWithoutTeacher = message.replace(new RegExp(escapeRe(teacherRef), "g"), " ");
    const daysFound = parseDaysList(bodyWithoutTeacher);
    const targetDays: Array<number | null> = daysFound.length > 0 ? daysFound : [null];

    if (isEarly || isFirstSlots) {
      const num = /(اول حصتين|حصتين)/.test(n) ? 2 : 3;
      for (const d of targetDays) {
        ops.push({ op: "add_placement_rule", teacher: teacherRef, day: d, type: "FIRST_N", n: num, hard: true });
      }
      return { ops, understood: true, hints };
    }
    if (isLastSlots) {
      const num = /(اخر حصتين|حصتين)/.test(n) ? 2 : 3;
      for (const d of targetDays) {
        ops.push({ op: "add_placement_rule", teacher: teacherRef, day: d, type: "LAST_N", n: num, hard: true });
      }
      return { ops, understood: true, hints };
    }
    if (isAvoidFirst) {
      for (const d of targetDays) {
        ops.push({ op: "add_placement_rule", teacher: teacherRef, day: d, type: "AVOID_FIRST", hard: true });
      }
      return { ops, understood: true, hints };
    }
    if (isAvoidLast) {
      for (const d of targetDays) {
        ops.push({ op: "add_placement_rule", teacher: teacherRef, day: d, type: "AVOID_LAST", hard: true });
      }
      return { ops, understood: true, hints };
    }

    // strip the teacher name so day words inside names never leak into the rule parser
    const body = message.replace(new RegExp(escapeRe(teacherRef), "g"), " ");
    const parsed = parseRuleText(body, allDays);
    const wantsOffWord = /(اجازه|أجازة|إجازة|اوف|أوف|off|لا يعمل|لا تعمل|ممنوع|اقفل|قفل|يوم راحه|راحه|راحة|تفرغ|فضيله|فضيلها|فضوا|ما يداوم|مابيداومش|مايجيش|مبيجيش|ما يحضر|مابيحضرش|يرتاح)/.test(
      n
    );
    const wantsAllow = /(الغ|الغاء|ازل|فتح|افتح).*(اجازه|اجازة|اقفال)/.test(n);

    const existingTch = school.teachers.find((t) => normAr(t.name) === normAr(teacherRef!));
    const hasMandatoryOffOnDay =
      existingTch &&
      parsed.work_days &&
      parsed.work_days.some((d) => existingTch.work_pattern?.day_rules[String(d)] === "MANDATORY_OFF");

    if (wantsAllow || hasMandatoryOffOnDay) {
      ops.push({
        op: "set_teacher_days",
        teacher: teacherRef,
        allow_days: (parsed.work_days && parsed.work_days.length) ? parsed.work_days : (parsed.off_days.length ? parsed.off_days : parseDaysList(body)),
      });
    } else {
      let offDays = parsed.off_days;
      if (wantsOffWord && offDays.length === 0 && parsed.work_days) offDays = parsed.work_days;
      if (wantsOffWord && offDays.length === 0 && parsed.rules.length === 0) offDays = parseDaysList(body);
      if (offDays.length) ops.push({ op: "set_teacher_days", teacher: teacherRef, off_days: offDays });
      else if (parsed.work_days && parsed.work_days.length && parsed.rules.length === 0)
        ops.push({ op: "set_teacher_days", teacher: teacherRef, work_days: parsed.work_days });
    }
    for (const r of parsed.rules) {
      ops.push({
        op: "add_placement_rule",
        teacher: teacherRef,
        day: r.day,
        type: r.type,
        n: r.n,
        periods: r.periods,
        hard: r.hard,
      });
    }
    for (const dc of parsed.day_counts)
      ops.push({
        op: "set_daily_count",
        teacher: teacherRef,
        day: dc.day,
        count: dc.count,
        rule_type: dc.type,
      });
    if (
      parsed.max_daily ||
      parsed.max_weekly ||
      parsed.max_consecutive ||
      parsed.target_days ||
      parsed.last_period_target
    ) {
      ops.push({
        op: "set_teacher_limits",
        teacher: teacherRef,
        max_daily: parsed.max_daily,
        max_weekly: parsed.max_weekly,
        max_consecutive: parsed.max_consecutive,
        target_days: parsed.target_days,
        last_period_target: parsed.last_period_target,
      });
    }
    if (parsed.double) ops.push({ op: "set_double_policy", teacher: teacherRef, policy: parsed.double });
    if (/(امسح|الغ|احذف|ازل).*(قيود|قيد)/.test(n)) ops.push({ op: "clear_placement_rules", teacher: teacherRef });
    if (ops.length > 0) return { ops, understood: true, hints };
  }

  return { ops, understood: false, hints };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function messageTokens(s: string): string[] {
  return normAr(s)
    .replace(/[()\/\\\-–—،,.:"]/g, " ")
    .split(" ")
    .map((t) => t.replace(/^ال/, ""))
    .filter((t) => t && !TITLES.has(t) && !STOP_WORDS_MESSAGE.has(t));
}

export function findTeachersInMessage(school: SchoolData, message: string): Teacher[] {
  const normMsg = normAr(message);
  const found: Array<{ teacher: Teacher; pos: number; score: number }> = [];

  for (const t of school.teachers) {
    const tNorm = normAr(t.name);
    // Exact full name match
    let pos = normMsg.indexOf(tNorm);
    if (pos >= 0) {
      found.push({ teacher: t, pos, score: 100 + tNorm.length });
      continue;
    }
    const tokens = nameTokens(t.name);
    if (tokens.length >= 2) {
      const joined = tokens.join(" ");
      pos = normMsg.indexOf(joined);
      if (pos >= 0) {
        found.push({ teacher: t, pos, score: 80 + joined.length });
        continue;
      }
      if (tokens.every((tok) => normMsg.includes(tok))) {
        pos = normMsg.indexOf(tokens[0]);
        found.push({ teacher: t, pos: pos >= 0 ? pos : 0, score: 60 });
        continue;
      }
    }
    // Single distinctive token (name with length >= 3)
    for (const tok of tokens) {
      if (tok.length >= 3 && !STOP_WORDS_MESSAGE.has(tok)) {
        const re = new RegExp(`(?:^|\\s)(?:ال)?(?:استاذ|معلم|مدرس)?\\s*${escapeRe(tok)}(?:\\s|$)`);
        const match = normMsg.match(re);
        if (match && match.index !== undefined) {
          const sharesToken = school.teachers.filter(
            (other) => other.id !== t.id && nameTokens(other.name).includes(tok)
          );
          if (sharesToken.length === 0) {
            found.push({ teacher: t, pos: match.index, score: 40 });
            break;
          }
        }
      }
    }
  }

  const bestByTeacher = new Map<string, { teacher: Teacher; pos: number; score: number }>();
  for (const item of found) {
    const prev = bestByTeacher.get(item.teacher.id);
    if (!prev || item.score > prev.score) bestByTeacher.set(item.teacher.id, item);
  }

  const list = [...bestByTeacher.values()];
  list.sort((a, b) => a.pos - b.pos);
  return list.map((x) => x.teacher);
}

export function resolveTeacherFromMessage(school: SchoolData, message: string): { teacher?: Teacher; error?: string } {
  const mt = messageTokens(message);
  const hits: Array<{ t: Teacher; score: number }> = [];
  for (const t of school.teachers) {
    const nt = nameTokens(t.name);
    if (nt.length === 0) continue;
    const matched = nt.filter((x) => mt.some((m) => tokenMatch(m, x)));
    if (matched.length === nt.length) hits.push({ t, score: nt.length * 10 + nt.join("").length / 100 });
    else if (matched.length > 0 && matched.length === 1 && nt.length > 1) {
      hits.push({ t, score: matched.length });
    }
  }
  if (hits.length === 0) {
    const fromList = findTeachersInMessage(school, message);
    if (fromList.length === 1) return { teacher: fromList[0] };
    return {};
  }
  hits.sort((a, b) => b.score - a.score);
  if (hits.length > 1 && hits[0].score === hits[1].score) {
    return {
      error: `الاسم يطابق أكثر من معلم: ${hits
        .slice(0, 4)
        .map((h) => h.t.name)
        .join("، ")}. اكتب الاسم كاملاً.`,
    };
  }
  return { teacher: hits[0].t };
}

export function findSubjectInMessage(school: SchoolData, message: string): Subject | null {
  const n = normAr(message).replace(/\d+\s*[\/\\]\s*\d+/g, " ");
  for (const s of school.subjects) {
    const sn = normAr(s.name);
    if (n.includes(sn)) return s;
  }
  const canon = canonicalSubject(n);
  if (canon) {
    const s = school.subjects.find((x) => canonicalSubject(x.name)?.name === canon.name);
    if (s) return s;
  }
  return null;
}

export { isQuestionOrInquiry, answerSchoolQuestion } from "./schoolAssistant.ts";
export type { AssistantAnswer } from "./schoolAssistant.ts";

