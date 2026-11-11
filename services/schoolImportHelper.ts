import type { DailyPeriodRule, DailyPlacementRule, DayOfWeek, SchoolData, Section, TeacherWorkPattern } from "../types.ts";
import { parseSchoolText } from "./schoolCore.ts";
import { parseUnstructuredArabicSchoolText } from "./unstructuredParser.ts";

export function buildSchoolExtractionPrompt(rawSchoolText: string): string {
  return `أنت خبير استخراج بيانات الجداول المدرسية. حوّل النص التالي (ولو كان مكتوباً بالعامية أو غير منظم) إلى كائن JSON واحد فقط مطابق بدقة لهيكل SchoolData التالي:

قواعد الاستخراج الإلزامية:
1. اسم المدرسة (name): استخرج الاسم الدقيق من النص (مثل "مدرسة النور الإعدادية" أو "مدرسة المستقبل الابتدائية").
2. أيام الدراسة (days): استخدم ترقيم النظام المعتمد حصراً:
   - السبت = 6
   - الأحد = 0
   - الاثنين = 1
   - الثلاثاء = 2
   - الأربعاء = 3
   - الخميس = 4
   مثال من السبت للخميس: [6, 0, 1, 2, 3, 4]. من الأحد للخميس: [0, 1, 2, 3, 4].
3. عدد الحصص اليومية (periods_per_day) واليوم المخفف:
   - periods_per_day = الحد الأقصى لعدد الحصص في اليوم العادي (مثل 8 أو 7 أو 6).
   - إذا ذُكر يوم بعدد حصص أقل لمرحلة/صف/فترة (مثل "الخميس 7 حصص فقط وباقي الأيام 8" أو "الأحد 8 حصص وباقي الأيام 7") ضع periods_per_day: 8 وضع daily_period_limits على الصفوف والفصول، مثل: { "4": 7 } للخميس أو { "6": 7, "1": 7, "2": 7, "3": 7, "4": 7 }.
4. نظام الفترات (shift_mode و section.shift):
   - إذا كانت المدرسة فترة واحدة، ضع "shift_mode": "SINGLE" واضبط "shift": "FIRST" (أو اتركه افتراضياً) في كل فصل.
   - إذا ذُكر فترتان (صباحي ومسائي — مثل "الصفوف الأولى التلاتة صباحي والباقي مسائي" أو "أولى وتانية صباحي وتالتة مسائي")، ضع "shift_mode": "TWO_SHIFTS" واضبط في كل فصل من الفصول الصباحية "shift": "FIRST" وفي كل فصل من الفصول المسائية "shift": "SECOND" مع وضع daily_period_limits الخاصة بكل صف/فصل.
5. الصفوف والفصول (grades و sections):
   - كل صف في grades له id فريد (مثل "G1") وname وcode وorder وdaily_period_limits.
   - كل فصل في sections له id فريد (مثل "SEC_1_1")، وgrade_id يطابق grade.id، وname وcode مثل "1/1"، و"shift": "FIRST" | "SECOND". لا تنس أي فصل عند ذكر عدد الفصول لكل صف (مثل 4 فصول في الصف = 1/1، 1/2، 1/3، 1/4).
6. المواد (subjects):
   - استخرج كل مادة مذكورة باسم واضح وid فريد (مثل "SUB_AR") ولا تنس مادة الدين أو الأنشطة أو المواد الفرعية مثل (عربي2) إن وجدت، وكذلك اللغات (Math, Science, Connect Plus, المستوى الرفيع) والأزهر والثانوي والابتدائي المطور (اكتشف، القيم، التوكاتسو، المهارات المهنية).
   - إذا درّس المعلم الواحد أكثر من مادة (مثل: عربي + دين)، أضف المادتين وكل تكليفاتهما كاملة!
   - إذا ذُكر أن المادة "مزدوجة/دبل" ضع double_period_policy: "DOUBLE_REQUIRED"، وإذا ذُكر "مفردة" ضع "SINGLE_ONLY"، وإلا "FREE".
7. المعلمون والخانات الشاغرة (teachers): استخرج كل معلم مذكور باسمه:
   - **مهم جداً — الخانات الشاغرة ("س"، "س1"، "س2"، "س3"، "س عربي"، "س دين"، "س دراسات")**: في المدارس المصرية الحرف "س" (منفرداً أو برقم أو باسم مادة) يعني **خانة شاغرة مؤقتة / احتياج معلم** ويدرّس تلك المادة. احتفظ بكل منها كمعلم مستقل كامل التكليفات وسمّه بوضوح مثل "س1 (شاغر)" أو "س عربي (شاغر)" بدون استخدام كلمة "عجز" ولا تحذفها أو تدمجها أبداً!
   - الإجازات وأيام العمل: سواء ذُكرت كإجازة ("واخد إجازة التلات والاربع والخميس") أو كأيام حضور ("بتيجي سبت واحد واتنين" / "لا يعمل غير الأربعاء" / "متاح حد وتلات فقط")، ضع جميع أيام الغياب في work_pattern.day_rules كـ "MANDATORY_OFF".
   - قواعد الحصص (work_pattern.placement_rules):
     • تجنب الحصة الأولى ("مش بيدخل أولى" / "الغاء الأولى"): { "day": null, "placement_type": "AVOID_FIRST", "n_periods": 1, "is_hard": true, "weight": 100 }
     • تجنب الأخيرة ("بيمشي بدري" / "الغاء الأخيرة"): { "day": null, "placement_type": "AVOID_LAST", "n_periods": 1, "is_hard": true, "weight": 100 }
     • حصص متأخرة / أخيرة ("أخر حصتين"): { "day": null, "placement_type": "LAST_N", "n_periods": 2, "is_hard": true, "weight": 100 }
     • حصص أولى ("أول حصتين"): { "day": null, "placement_type": "FIRST_N", "n_periods": 2, "is_hard": true, "weight": 100 }
   - حد حصص يومي ("مينفعش تاخد غير حصتين يوم الاربع"): أضف في work_pattern.daily_period_rules: { "day": 3, "rule_type": "MAX", "count": 2, "is_hard": true, "weight": 10 }.
   - إذا ذُكر حد تتابع (مثل "أقصى تتابع 3 حصص") ضعه في max_consecutive_periods؛ وإذا لم يُذكر حد تتابع ضع max_consecutive_periods: 6. إذا ذُكر مزدوجة للمعلم ضع force_double_periods: true.
8. الإسنادات والملاحظات (assignments):
   - يمكنك وضع section_ids مصفوفة للفصول المتماثلة لنفس المعلم والمادة والعدد.
   - انتبه للملاحظات التكميلية مثل "(ملاحظة: فصل 1/1 فاضله 3 حصص دين ممكن نديهم لـ س3)" وأضف تكليفها حتى يكتمل نصاب كل فصل تماماً ولا تسقط أي مادة!

الهيكل المطلوب (JSON فقط):
{
  "id": "sch_ai_1",
  "name": "string",
  "academic_year": "2025/2026",
  "days": [0, 1, 2, 3, 4],
  "periods_per_day": 8,
  "shift_mode": "SINGLE",
  "grades": [{ "id": "G1", "name": "الأول الابتدائي", "code": "G1", "order": 1, "daily_period_limits": {} }],
  "sections": [{ "id": "SEC_1_1", "grade_id": "G1", "name": "1/1", "code": "1/1", "shift": "FIRST", "daily_period_limits": {} }],
  "subjects": [{ "id": "SUB_1", "name": "عربي", "code": "عربي", "double_period_policy": "FREE" }],
  "teachers": [{
    "id": "TCH_1",
    "name": "string",
    "code": "string",
    "subject_ids": ["SUB_1"],
    "max_daily_periods": 6,
    "max_weekly_periods": 24,
    "max_consecutive_periods": 6,
    "force_double_periods": false,
    "work_pattern": { "day_rules": {}, "daily_period_rules": [], "placement_rules": [] }
  }],
  "availabilities": [],
  "assignments": [{ "section_ids": ["SEC_1_1"], "subject_id": "SUB_1", "teacher_id": "TCH_1", "weekly_periods": 6 }]
}

نص بيانات المدرسة:
${rawSchoolText}`;
}

function normalizeDayLimitsMap(raw: any): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const dayNum = Number(k);
    const val = Number(v);
    if (Number.isInteger(dayNum) && dayNum >= 0 && dayNum <= 6 && Number.isFinite(val) && val > 0) {
      out[String(dayNum)] = Math.round(val);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeDayRulesMap(raw: any): Record<string, any> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    const dayNum = Number(k);
    if (Number.isInteger(dayNum) && dayNum >= 0 && dayNum <= 6 && typeof v === "string") {
      out[String(dayNum)] = v;
    }
  }
  return out;
}

export function normalizeAiExtractedSchoolJson(candidate: any): any {
  if (!candidate || typeof candidate !== "object") return candidate;
  const allSectionIds: string[] = Array.isArray(candidate.sections)
    ? candidate.sections.map((sec: any) => String(sec?.id || "")).filter(Boolean)
    : [];

  const expanded: any[] = [];
  if (Array.isArray(candidate.assignments)) {
    let idx = 1;
    for (const rawAsgn of candidate.assignments) {
      if (!rawAsgn || typeof rawAsgn !== "object") continue;
      const wp = Number(rawAsgn.weekly_periods) || 1;
      let targetSecs: string[] = [];
      if (Array.isArray(rawAsgn.section_ids)) {
        targetSecs = rawAsgn.section_ids.map((x: any) => String(x)).filter(Boolean);
      } else if (rawAsgn.section_id === "ALL") {
        targetSecs = allSectionIds;
      } else if (rawAsgn.section_id) {
        targetSecs = [String(rawAsgn.section_id)];
      }
      for (const secId of targetSecs) {
        expanded.push({
          id: rawAsgn.id && targetSecs.length === 1 ? String(rawAsgn.id) : `ASG_AI_${idx++}`,
          section_id: secId,
          subject_id: String(rawAsgn.subject_id || ""),
          teacher_id: String(rawAsgn.teacher_id || ""),
          weekly_periods: wp,
        });
      }
    }
  }

  // If AI happened to emit an auxiliary shifts array, translate its grade_ids + limits onto grades & sections
  const secondShiftGradeIds = new Set<string>();
  const shiftLimitsByGrade = new Map<string, Record<string, number>>();
  if (Array.isArray(candidate.shifts)) {
    for (let idx = 0; idx < candidate.shifts.length; idx++) {
      const sh = candidate.shifts[idx];
      if (!sh || typeof sh !== "object") continue;
      const isSecond =
        sh.id === "EVENING" ||
        sh.id === "SECOND" ||
        /مسائ|ثان/.test(String(sh.name || "")) ||
        (idx === 1 && candidate.shifts.length > 1);
      const limits = normalizeDayLimitsMap(sh.daily_period_limits);
      if (Array.isArray(sh.grade_ids)) {
        for (const gid of sh.grade_ids.map(String)) {
          if (isSecond) secondShiftGradeIds.add(gid);
          if (limits) shiftLimitsByGrade.set(gid, limits);
        }
      }
    }
  }

  const normalizedGrades = Array.isArray(candidate.grades)
    ? candidate.grades.map((g: any) => {
        const mergedLimits = {
          ...(shiftLimitsByGrade.get(String(g?.id || "")) || {}),
          ...(normalizeDayLimitsMap(g?.daily_period_limits) || {}),
        };
        return {
          ...g,
          ...(Object.keys(mergedLimits).length > 0 ? { daily_period_limits: mergedLimits } : {}),
        };
      })
    : candidate.grades;

  const normalizedSections = Array.isArray(candidate.sections)
    ? candidate.sections.map((sec: any) => {
        const gid = String(sec?.grade_id || "");
        const inferredShift: "FIRST" | "SECOND" =
          sec?.shift === "SECOND" || sec?.shift === "EVENING" || secondShiftGradeIds.has(gid)
            ? "SECOND"
            : "FIRST";
        const mergedLimits = {
          ...(shiftLimitsByGrade.get(gid) || {}),
          ...(normalizeDayLimitsMap(sec?.daily_period_limits) || {}),
        };
        return {
          ...sec,
          shift: inferredShift,
          ...(Object.keys(mergedLimits).length > 0 ? { daily_period_limits: mergedLimits } : {}),
        };
      })
    : candidate.sections;

  const hasSecondShift =
    candidate.shift_mode === "TWO_SHIFTS" ||
    secondShiftGradeIds.size > 0 ||
    (Array.isArray(normalizedSections) && normalizedSections.some((s: any) => s.shift === "SECOND"));

  const normalizedTeachers = Array.isArray(candidate.teachers)
    ? candidate.teachers.map((t: any) => {
        const wp: TeacherWorkPattern | undefined = t?.work_pattern
          ? {
              day_rules: normalizeDayRulesMap(t.work_pattern.day_rules),
              daily_period_rules: Array.isArray(t.work_pattern.daily_period_rules)
                ? (t.work_pattern.daily_period_rules as DailyPeriodRule[])
                : [],
              placement_rules: Array.isArray(t.work_pattern.placement_rules)
                ? (t.work_pattern.placement_rules as DailyPlacementRule[])
                : [],
            }
          : undefined;
        return {
          ...t,
          max_consecutive_periods:
            typeof t?.max_consecutive_periods === "number" && t.max_consecutive_periods > 0
              ? t.max_consecutive_periods
              : 6,
          ...(wp ? { work_pattern: wp } : {}),
        };
      })
    : candidate.teachers;

  const { shifts: _omitAuxShifts, ...restCandidate } = candidate;

  return {
    ...restCandidate,
    shift_mode: hasSecondShift ? "TWO_SHIFTS" : "SINGLE",
    grades: normalizedGrades,
    sections: normalizedSections,
    teachers: normalizedTeachers,
    assignments: expanded,
  };
}

export function enrichExtractedSchool(school: SchoolData): SchoolData {
  const teachersWithSubjects = school.teachers.map((t) => {
    const inferred = new Set<string>(t.subject_ids || []);
    for (const a of school.assignments) {
      if (a.teacher_id === t.id && a.subject_id) inferred.add(a.subject_id);
    }
    return {
      ...t,
      subject_ids: Array.from(inferred),
    };
  });
  const hasSecondShiftSection = school.sections.some((s) => s.shift === "SECOND");
  return {
    ...school,
    shift_mode: school.shift_mode === "TWO_SHIFTS" || hasSecondShiftSection ? "TWO_SHIFTS" : "SINGLE",
    teachers: teachersWithSubjects,
  };
}

function normArName(s: string): string {
  return String(s || "")
    .replace(/^(?:أ\.|أ\/|أستاذة|أستاذ|مستر|ميس|الأستاذة|الأستاذ|المعلمة|المعلم)\s+/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeTeacherRulesInto(targetSchool: SchoolData, donorSchool: SchoolData): SchoolData {
  const teachers = targetSchool.teachers.map((t) => {
    const tNorm = normArName(t.name);
    const donor = donorSchool.teachers.find((d) => normArName(d.name) === tNorm);
    if (!donor) return t;

    const mergedDayRules: Record<string, any> = {
      ...(donor.work_pattern?.day_rules || {}),
      ...(t.work_pattern?.day_rules || {}),
    };
    for (const [k, v] of Object.entries(donor.work_pattern?.day_rules || {})) {
      if (v === "MANDATORY_OFF") mergedDayRules[String(k)] = "MANDATORY_OFF";
    }

    const existingPr: DailyPlacementRule[] = [...(t.work_pattern?.placement_rules || [])];
    for (const pr of donor.work_pattern?.placement_rules || []) {
      const dup = existingPr.some(
        (x) =>
          x.placement_type === pr.placement_type &&
          (x.day ?? null) === (pr.day ?? null) &&
          (x.n_periods ?? 1) === (pr.n_periods ?? 1)
      );
      if (!dup) existingPr.push(pr);
    }

    const existingDpr: DailyPeriodRule[] = [...(t.work_pattern?.daily_period_rules || [])];
    for (const dpr of donor.work_pattern?.daily_period_rules || []) {
      const dup = existingDpr.some((x) => x.day === dpr.day && x.rule_type === dpr.rule_type);
      if (!dup) existingDpr.push(dpr);
    }

    return {
      ...t,
      force_double_periods: Boolean(t.force_double_periods || donor.force_double_periods),
      work_pattern: {
        day_rules: mergedDayRules,
        daily_period_rules: existingDpr,
        placement_rules: existingPr,
      },
    };
  });

  const grades = targetSchool.grades.map((g) => {
    const donorG = donorSchool.grades.find(
      (dg) => dg.id === g.id || dg.order === g.order || normArName(dg.name) === normArName(g.name)
    );
    const mergedLimits: Record<string, number> = {
      ...(donorG?.daily_period_limits || {}),
      ...(g.daily_period_limits || {}),
    };
    return Object.keys(mergedLimits).length > 0 ? { ...g, daily_period_limits: mergedLimits } : g;
  });

  const sections: Section[] = targetSchool.sections.map((s) => {
    const donorS = donorSchool.sections.find((ds) => ds.code === s.code || ds.id === s.id);
    const mergedLimits: Record<string, number> = {
      ...(donorS?.daily_period_limits || {}),
      ...(s.daily_period_limits || {}),
    };
    const mergedShift: "FIRST" | "SECOND" | undefined =
      s.shift === "SECOND" || donorS?.shift === "SECOND" ? "SECOND" : s.shift || donorS?.shift;
    return {
      ...s,
      ...(mergedShift ? { shift: mergedShift } : {}),
      ...(Object.keys(mergedLimits).length > 0 ? { daily_period_limits: mergedLimits } : {}),
    };
  });

  const hasTwoShifts =
    targetSchool.shift_mode === "TWO_SHIFTS" ||
    donorSchool.shift_mode === "TWO_SHIFTS" ||
    sections.some((s) => s.shift === "SECOND");

  return {
    ...targetSchool,
    shift_mode: hasTwoShifts ? "TWO_SHIFTS" : "SINGLE",
    grades,
    sections,
    teachers,
  };
}

/**
 * Cross-checks Gemini LLM extraction against our deterministic unstructured & table parsers.
 * Guarantees Gemini never silently drops deficit teachers ("س1", "س2", "س3", "س دراسات"),
 * subjects (like "دين"), two-shift setups, missing note assignments, or teacher off-day/placement constraints,
 * while preserving any extra rules/shifts/subjects understood by Gemini.
 */
export function reconcileAiWithDeterministicSchool(
  aiSchool: SchoolData,
  rawText: string
): { school: SchoolData; notes: string[] } {
  const detUnstructured = parseUnstructuredArabicSchoolText(rawText);
  const detTable = /\|[^\n]+\|/.test(rawText) ? parseSchoolText(rawText) : null;
  const detSchool =
    detUnstructured?.school && detUnstructured.school.assignments.length > 0
      ? detUnstructured.school
      : detTable?.school && detTable.school.assignments.length > 0 && detTable.school.sections.length > 0
        ? detTable.school
        : null;

  if (!detSchool) {
    return { school: enrichExtractedSchool(aiSchool), notes: [] };
  }

  const aiTotalPeriods = aiSchool.assignments.reduce((s, a) => s + (a.weekly_periods || 0), 0);
  const detTotalPeriods = detSchool.assignments.reduce((s, a) => s + (a.weekly_periods || 0), 0);
  const aiOffCount = aiSchool.teachers.reduce(
    (s, t) => s + Object.values(t.work_pattern?.day_rules || {}).filter((v) => v === "MANDATORY_OFF").length,
    0
  );
  const detOffCount = detSchool.teachers.reduce(
    (s, t) => s + Object.values(t.work_pattern?.day_rules || {}).filter((v) => v === "MANDATORY_OFF").length,
    0
  );
  const aiHasDeficitMarkers = aiSchool.teachers.some(
    (t) => t.name.includes("شاغر") || t.name.includes("عجز") || /(?:^|\s)س\s*(?:\d*|[\u0600-\u06FF]+)/.test(t.name)
  );
  const detHasDeficitMarkers = detSchool.teachers.some((t) => t.name.includes("شاغر") || t.name.includes("عجز"));

  const missingStructuralData =
    detSchool.subjects.length > aiSchool.subjects.length ||
    detSchool.teachers.length > aiSchool.teachers.length ||
    detSchool.sections.length > aiSchool.sections.length ||
    detSchool.days.length > aiSchool.days.length ||
    detTotalPeriods > aiTotalPeriods ||
    (detHasDeficitMarkers && !aiHasDeficitMarkers);

  if (missingStructuralData) {
    const preferredName =
      aiSchool.name && aiSchool.name.length >= 4 && aiSchool.name !== "مدرسة جديدة"
        ? aiSchool.name
        : detSchool.name;
    const combined = enrichExtractedSchool(
      mergeTeacherRulesInto(
        {
          ...detSchool,
          name: preferredName,
        },
        aiSchool
      )
    );
    return {
      school: combined,
      notes: [
        `تم الدمج والتحقق التبادلي بين Gemini والمحرك الحتمي لضمان عدم إسقاط أي مادة أو خانة شاغرة أو قيد (${combined.sections.length} فصول، ${combined.teachers.length} معلماً، ${combined.assignments.reduce((s, a) => s + (a.weekly_periods || 0), 0)} حصة).`,
      ],
    };
  }

  // Gemini kept full structure — supplement any off-days, shifts, or daily limits detected locally that AI missed
  const supplemented = enrichExtractedSchool(mergeTeacherRulesInto(aiSchool, detSchool));
  const extraNotes: string[] = [];
  if (detOffCount > aiOffCount || (detSchool.shift_mode === "TWO_SHIFTS" && aiSchool.shift_mode !== "TWO_SHIFTS")) {
    extraNotes.push("تم استكمال قيود الإجازات ونظام الفترات والتحقق من اكتمال النصاب بدقة.");
  }
  return { school: supplemented, notes: extraNotes };
}
