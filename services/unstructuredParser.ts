import type {
  SchoolData,
  Grade,
  Section,
  Subject,
  Teacher,
  TeachingAssignment,
} from "../types.ts";
import { normAr, sanitizeSchool } from "./schoolCore.ts";

interface SubjectDef {
  canonical: string;
  code: string;
  patterns: RegExp[];
  doublePolicy?: "FREE" | "DOUBLE_REQUIRED" | "SINGLE_ONLY";
}

const KNOWN_SUBJECTS: SubjectDef[] = [
  // Specific / numbered / multi-word subjects first to prevent false prefix capture
  // Match عربي 2 ONLY when '2' is NOT followed by / or \ (so 'عربي 2/1' matches 'عربي', not 'عربي2')
  { canonical: "عربي2", code: "عربي2", patterns: [/عرب[يى]\s*2(?!\s*[/\\])|لغ[ةه]\s*عربي[ةه]\s*2(?!\s*[/\\])/] },
  { canonical: "نشاط 1", code: "نشاط 1", patterns: [/نشاط\s*1/] },
  { canonical: "نشاط 2", code: "نشاط 2", patterns: [/نشاط\s*2/] },
  // Language & Advanced Level specializations before generic English
  { canonical: "Connect Plus", code: "Connect+", patterns: [/connect\s*plus|كونكت\s*بلس/i] },
  { canonical: "المستوى الرفيع", code: "مستوى رفيع", patterns: [/(?:ال)?مستو[ىي]\s*(?:ال)?رفيع|advanced\s*level/i] },
  { canonical: "لغة ثانية", code: "لغة ثانية", patterns: [/لغ[ةه]\s*(?:اجنبي[ةه]\s*)?ثاني[ةه]|فرنساو[يى]|فرنس[يى]|المان[يى]|ايطال[يى]|french|german/i] },
  // Physical Education before Math (so رياضة بدنية never captures رياضيات)
  { canonical: "ألعاب", code: "ألعاب", patterns: [/(?:^|\s)(?:ال)?العاب(?:\s|$|[،.()])|تربي[ةه]\s*رياضي[ةه]|تربي[ةه]\s*بدني[ةه]|بدني[ةه]|رياض[ةه]\s*بدني[ةه]|(?:^|\s)pe(?:\s|$)/i] },
  // Al-Azhar Sharia & Arabic branches
  { canonical: "قرآن كريم", code: "قرآن", patterns: [/قران(?:\s*كريم)?|تجويد/] },
  { canonical: "فقه", code: "فقه", patterns: [/(?:^|\s)(?:ال)?فقه(?:\s|$|[،.()])/] },
  { canonical: "تفسير وحديث", code: "تفسير وحديث", patterns: [/تفسير\s*و\s*حديث|اصول\s*(?:ال)?دين/] },
  { canonical: "تفسير", code: "تفسير", patterns: [/(?:^|\s)(?:ال)?تفسير(?:\s|$|[،.()])/] },
  { canonical: "حديث", code: "حديث", patterns: [/(?:^|\s)(?:ال)?حديث(?:\s*الشريف|\s*وعلومه)?(?:\s|$|[،.()])/] },
  { canonical: "توحيد", code: "توحيد", patterns: [/توحيد(?:\s*وسير[ةه]|\s*وعقيد[ةه])?|عقيد[ةه]/] },
  { canonical: "ثقافة إسلامية", code: "ثقافة إسلامية", patterns: [/(?:ال)?ثقاف[ةه]\s*(?:ال)?اسلامي[ةه]|فرائض|مواريث/] },
  { canonical: "نحو وصرف", code: "نحو وصرف", patterns: [/نحو\s*و\s*صرف/] },
  { canonical: "نحو", code: "نحو", patterns: [/(?:^|\s)(?:ال)?نحو(?:\s|$|[،.()])/] },
  { canonical: "صرف", code: "صرف", patterns: [/(?:^|\s)(?:ال)?صرف(?:\s|$|[،.()])/] },
  { canonical: "بلاغة", code: "بلاغة", patterns: [/(?:^|\s)(?:ال)?بلاغ[ةه](?:\s|$|[،.()])/] },
  { canonical: "أدب ونصوص", code: "أدب ونصوص", patterns: [/ادب\s*و?نصوص|مطالع[ةه]\s*و?نصوص|مطالع[ةه]/] },
  { canonical: "عروض", code: "عروض", patterns: [/عروض(?:\s*و?قافي[ةه])?/] },
  // Core Arabic / Religion / English / Math
  { canonical: "عربي", code: "عربي", patterns: [/(?:^|\s)(?:لغ[ةه]\s*)?عرب[يى](?:\s|$|[،.()])/] },
  { canonical: "دين", code: "دين", patterns: [/تربي[ةه]\s*ديني[ةه]|تربي[ةه]\s*اسلامي[ةه]|(?:^|\s)دين(?:\s*اسلام[يى]|\s*مسيح[يى])?(?:\s|$|[،.()])/] },
  { canonical: "انجليزي", code: "انجليزي", patterns: [/انجليز[يى]|انجلش|لغ[ةه]\s*انجليزي[ةه]|english|connect/i] },
  { canonical: "رياضيات", code: "رياضيات", patterns: [/رياضيات|رياض[ةه](?!\s*بدني[ةه])|حساب|جبر|هندس[ةه]|math(?:ematics)?/i] },
  // Secondary Sciences & Humanities + Primary New Curriculum
  { canonical: "العلوم المتكاملة", code: "علوم متكاملة", patterns: [/(?:ال)?علوم\s*(?:ال)?متكامل[ةه]|integrated\s*science/i] },
  { canonical: "فيزياء", code: "فيزياء", patterns: [/فيزيا[ء]?|physics/i] },
  { canonical: "كيمياء", code: "كيمياء", patterns: [/كيميا[ء]?|chemistry/i] },
  { canonical: "أحياء", code: "أحياء", patterns: [/احيا[ء]|biology/i] },
  { canonical: "جيولوجيا", code: "جيولوجيا", patterns: [/جيولوجيا|علوم\s*بيئ[ةه]|geology/i] },
  { canonical: "علوم", code: "علوم", patterns: [/(?:^|\s)(?:ال)?علوم(?:\s|$|[،.()])|science|ساينس/i] },
  { canonical: "تاريخ", code: "تاريخ", patterns: [/(?:^|\s)(?:ال)?تاريخ(?:\s|$|[،.()])|history/i] },
  { canonical: "جغرافيا", code: "جغرافيا", patterns: [/جغرافيا|geography/i] },
  { canonical: "فلسفة ومنطق", code: "فلسفة", patterns: [/فلسف[ةه](?:\s*و?منطق)?|منطق|philosophy/i] },
  { canonical: "علم نفس", code: "علم نفس", patterns: [/علم\s*(?:ال)?نفس|اجتماع|psychology/i] },
  { canonical: "إحصاء", code: "إحصاء", patterns: [/احصا[ء]|statistics/i] },
  { canonical: "تربية وطنية", code: "وطنية", patterns: [/(?:ال)?تربي[ةه]\s*(?:ال)?وطني[ةه]|وطني[ةه]|civics/i] },
  { canonical: "دراسات", code: "دراسات", patterns: [/(?:ال)?دراسات(?:\s*اجتماعي[ةه])?|social/i] },
  { canonical: "اكتشف", code: "اكتشف", patterns: [/متعدد\s*(?:ال)?تخصصات|اكتشف|discover/i] },
  { canonical: "القيم", code: "قيم", patterns: [/قيم\s*و?احترام\s*الاخر|(?:^|\s)(?:ال)?قيم(?:\s|$|[،.()])/] },
  { canonical: "توكاتسو", code: "توكاتسو", patterns: [/توكاتسو|tokkatsu/i] },
  { canonical: "حاسب آلي", code: "حاسب", patterns: [/(?:ال)?حاسب(?:\s*ال[يى]|\s*آل[يى])?|كمبيوتر|تكنولوجيا|\bict\b|computer/i] },
  { canonical: "رسم", code: "رسم", patterns: [/(?:^|\s)(?:ال)?رسم(?:\s|$|[،.():])|تربي[ةه]\s*فني[ةه]|فني[ةه]|\bart\b/i] },
  { canonical: "موسيقى", code: "موسيقى", patterns: [/موسيق[ىي]|music/i] },
  { canonical: "مهارات", code: "مهارات", patterns: [/مهارات(?:\s*مهني[ةه])?/] },
];

const DAY_KEYWORDS: Array<{ day: number; regex: RegExp }> = [
  { day: 6, regex: /السبت|سبت/ },
  { day: 0, regex: /الاحد|احد/ },
  { day: 1, regex: /الاثنين|اتنين|اثنين/ },
  { day: 2, regex: /الثلاثاء|التلات|تلات|ثلاثاء/ },
  { day: 3, regex: /الاربعاء|الاربع|اربع/ },
  { day: 4, regex: /الخميس|خميس/ },
];

function extractDayNumbers(fragment: string): number[] {
  const n = normAr(fragment);
  const found: number[] = [];
  for (const dk of DAY_KEYWORDS) {
    if (dk.regex.test(n)) found.push(dk.day);
  }
  return found;
}

function extractSectionsFromText(
  fragment: string,
  allSections: Section[],
  grades: Grade[]
): Section[] {
  const n = normAr(fragment);
  const matched: Section[] = [];
  const addSec = (sec: Section) => {
    if (!matched.some((m) => m.id === sec.id)) matched.push(sec);
  };

  // 1. Range syntax: "1/1 لحد 1/4" or "1/1 إلى 1/4"
  const rangeMatch = n.match(/([1-6])\s*[/\\]\s*([1-9])\s*(?:لحد|الى|حت[ىي]|-)\s*([1-6])\s*[/\\]\s*([1-9])/);
  if (rangeMatch) {
    const g1 = Number(rangeMatch[1]);
    const s1 = Number(rangeMatch[2]);
    const g2 = Number(rangeMatch[3]);
    const s2 = Number(rangeMatch[4]);
    if (g1 === g2 && s2 >= s1) {
      for (let sn = s1; sn <= s2; sn++) {
        const target = allSections.find((sec) => sec.name === `${g1}/${sn}`);
        if (target) addSec(target);
      }
    }
  }

  // 2. Explicit section codes like 1/1, 2\1, 3/2
  const secMatches = Array.from(n.matchAll(/\b([1-6])\s*[/\\]\s*([1-9])\b/g));
  for (const m of secMatches) {
    const code = `${m[1]}/${m[2]}`;
    const found = allSections.find((s) => s.name === code || s.code === code);
    if (found) addSec(found);
  }

  if (matched.length > 0) return matched;

  // 3. Explicit all-school phrases (ONLY when no specific section codes were listed)
  if (/(?:(?:لـ?\s*)?(?:ال)?تمن\s*فصول|(?:لـ?\s*)?(?:ال)?ثمان(?:ي[ةه])?\s*فصول|8\s*فصول|كل\s*الفصول|لكل\s*فصل\s*من\s*(?:الـ?\s*\d+|الفصول))/.test(n)) {
    allSections.forEach(addSec);
    return matched;
  }

  // 4. Whole-grade phrases when no explicit sections were listed
  if (/(?:اول[ىي]|لاول[ىي])/.test(n)) {
    const g = grades.find((gr) => gr.order === 1);
    if (g) allSections.filter((s) => s.grade_id === g.id).forEach(addSec);
  }
  if (/(?:تاني[ةه]|ثاني[ةه]|لتاني[ةه])/.test(n)) {
    const g = grades.find((gr) => gr.order === 2);
    if (g) allSections.filter((s) => s.grade_id === g.id).forEach(addSec);
  }
  if (/(?:تالت[ةه]|ثالث[ةه]|لتالت[ةه])/.test(n)) {
    const g = grades.find((gr) => gr.order === 3);
    if (g) allSections.filter((s) => s.grade_id === g.id).forEach(addSec);
  }

  return matched;
}

function detectSubject(fragment: string): SubjectDef | null {
  const n = normAr(fragment);
  for (const def of KNOWN_SUBJECTS) {
    for (const rx of def.patterns) {
      if (rx.test(n)) return def;
    }
  }
  return null;
}

function extractPeriodsCount(fragment: string, fallback: number = 1): number {
  // Remove subject numbers ("نشاط 1", "نشاط 2", "عربي 2") before matching period count
  const cleaned = normAr(fragment).replace(/نشاط\s*\d+|عرب[يى]\s*2(?!\s*[/\\])/g, "");
  const mNum =
    cleaned.match(/\((\d+)\s*حص[ةهص]?(?:\s*بس)?/) ||
    cleaned.match(/(\d+)\s*حص[ةهص]/) ||
    cleaned.match(/بواقع\s*(\d+)/);
  if (mNum) return Math.max(1, Math.min(15, Number(mNum[1])));
  if (/حص[ةه]\s*واحد[ةه]|بيد[يى]\s*حص[ةه]/.test(cleaned)) return 1;
  return fallback;
}

/**
 * Deterministic parser for unstructured, conversational Arabic school descriptions.
 * Serves as an instant local parser / fallback when Gemini API is unavailable (503/no keys).
 */
export function parseUnstructuredArabicSchoolText(rawText: string): {
  school: SchoolData;
  notes: string[];
} | null {
  if (!rawText || rawText.trim().length < 25) return null;
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const fullNorm = normAr(rawText);

  // 1. Discover Sections across entire document
  const secSet = new Set<string>();
  for (const m of rawText.matchAll(/\b([1-6])\s*[/\\]\s*([1-9])\b/g)) {
    secSet.add(`${m[1]}/${m[2]}`);
  }
  if (secSet.size === 0) return null;

  // 2. School Name & Academic Year
  let schoolName = "مدرسة جديدة";
  const nameLine = lines.find((l) => /(?:مدرسة|معهد)\s+/.test(l)) || lines[0];
  if (nameLine) {
    const nmMatch = nameLine.match(/(مدرسة|معهد)\s+([^\n،.(]+)/);
    if (nmMatch) {
      schoolName =
        nmMatch[1] + " " +
        nmMatch[2]
          .replace(/(?:للعام\s*الدراسي.*|عايزين.*|التي\s*تضم.*|\d{4}\/\d{4}.*)/g, "")
          .trim();
    }
  }
  const yearMatch = rawText.match(/(202\d\s*[-/]\s*202\d)/);
  const academicYear = yearMatch ? yearMatch[1].replace(/\s+/g, "") : "2025/2026";

  // 3. Days & Daily Periods & Grade Exceptions
  let days: number[] = [0, 1, 2, 3, 4];
  if (/من\s*السبت\s*(?:ل|الى|حت[ىي])\s*الخميس/.test(fullNorm) || (/السبت/.test(fullNorm) && /6\s*ايام|ست[ةه]\s*ايام/.test(fullNorm))) {
    days = [6, 0, 1, 2, 3, 4];
  }
  const genPdMatch = fullNorm.match(/الحصص\s*(?:اليومي[ةه]|في\s*اليوم)\s*(\d+)|(\d+)\s*حصص\s*(?:يوميا|في\s*اليوم)/);
  const periodsPerDay = genPdMatch ? Math.max(4, Math.min(10, Number(genPdMatch[1] || genPdMatch[2]))) : 6;

  // Global max consecutive
  const consecMatch = fullNorm.match(/تتابع\s*الحصص.*?(?:عن\s*)?(\d+)/);
  const globalMaxConsec = consecMatch ? Number(consecMatch[1]) : 6;

  // Build Grades & Sections
  const sortedSecCodes = Array.from(secSet).sort((a, b) => {
    const [ga, sa] = a.split("/").map(Number);
    const [gb, sb] = b.split("/").map(Number);
    return ga !== gb ? ga - gb : sa - sb;
  });

  const stageWord = /ابتدائي/.test(fullNorm) ? "الابتدائي" : /ثانوي/.test(fullNorm) ? "الثانوي" : "الإعدادي";
  const gradeNames: Record<number, string> = {
    1: `الأول ${stageWord}`,
    2: `الثاني ${stageWord}`,
    3: `الثالث ${stageWord}`,
    4: `الرابع ${stageWord}`,
    5: `الخامس ${stageWord}`,
    6: `السادس ${stageWord}`,
  };

  const gradeMap = new Map<number, Grade>();
  const sections: Section[] = [];

  // Extract per-grade / per-shift daily period limits from natural Arabic descriptions
  const gradeLimitsMap = new Map<number, Record<string, number>>();
  const ensureGradeLimits = (g: number) => {
    if (!gradeLimitsMap.has(g)) gradeLimitsMap.set(g, {});
    return gradeLimitsMap.get(g)!;
  };
  const gradeWordMap: Array<{ g: number; rx: RegExp }> = [
    { g: 1, rx: /اول[ىي]|الصف\s*الاول|صف\s*1|سنه\s*اول[ىي]/ },
    { g: 2, rx: /تاني[ةه]|ثان[يى]|الصف\s*الثان[يى]|سنه\s*تاني[ةه]/ },
    { g: 3, rx: /تالت[ةه]|ثالث[ةه]|الصف\s*الثالث|سنه\s*تالت[ةه]/ },
    { g: 4, rx: /رابع[ةه]|الصف\s*الرابع|سنه\s*رابع[ةه]/ },
    { g: 5, rx: /خامس[ةه]|الصف\s*الخامس|سنه\s*خامس[ةه]/ },
    { g: 6, rx: /سادس[ةه]|الصف\s*السادس|سنه\s*سادس[ةه]/ },
  ];

  for (const rawL of lines) {
    const ln = normAr(rawL);
    // Only treat as schedule structure line if it mentions periods per day and NOT a single teacher assignment
    if (!/حص[ةهص]/.test(ln)) continue;
    const isStructLine = /(?:صباح[يى]|مسائ[يى]|ما\s*عدا|باقي\s*الايام|كل\s*يوم|يوميا|في\s*اليوم|بياخدوا|عندهم\s*\d+\s*حص)/.test(ln);
    if (!isStructLine) continue;

    const targetGrades: number[] = [];
    if (/صباح[يى]/.test(ln)) targetGrades.push(1, 2, 3);
    if (/مسائ[يى]/.test(ln)) targetGrades.push(4, 5, 6);
    for (const gw of gradeWordMap) {
      if (gw.rx.test(ln) && !targetGrades.includes(gw.g)) targetGrades.push(gw.g);
    }
    if (targetGrades.length === 0) continue;

    const baseM = ln.match(/(\d+)\s*حص[ةهص]?\s*(?:يوميا|في\s*اليوم|كل\s*يوم|طوال\s*الاسبوع|عادي)/) || ln.match(/^[^\d]*(\d+)\s*حص/);
    const baseCap = baseM ? Number(baseM[1]) : null;
    if (baseCap && baseCap >= 4 && baseCap <= 10) {
      for (const g of targetGrades) {
        const lim = ensureGradeLimits(g);
        for (const d of days) lim[String(d)] = baseCap;
      }
    }

    // Parse specific day exceptions like "ما عدا الخميس 5" or "الاثنين 8 حصص"
    const dayExceptionMatches = Array.from(
      ln.matchAll(/(?:ما\s*عدا|ال?خميس|ال?احد|ال?اثنين|ال?اتنين|ال?ثلاثاء|ال?تلات|ال?اربعاء|ال?سبت)\s*(?:يوم\s*)?(ال?سبت|ال?احد|ال?اثنين|ال?اتنين|ال?ثلاثاء|ال?تلات|ال?اربعاء|ال?خميس)?[^\d]{0,12}(\d+)\s*حص/g)
    );
    for (const dm of dayExceptionMatches) {
      const ds = extractDayNumbers(dm[0]);
      const cnt = Number(dm[2]);
      if (cnt >= 1 && cnt <= 10) {
        for (const g of targetGrades) {
          const lim = ensureGradeLimits(g);
          for (const d of ds) lim[String(d)] = cnt;
        }
      }
    }
  }

  // Backward-compatible fallback for single line mentioning أولى والخميس
  if (!gradeLimitsMap.has(1)) {
    const thursdayReducedMatch = fullNorm.match(/(?:اول[ىي]|الصف\s*الاول).*?(?:الخميس|خميس).*?(\d+)\s*حص/);
    if (thursdayReducedMatch) {
      ensureGradeLimits(1)["4"] = Number(thursdayReducedMatch[1]);
    }
  }

  let effectiveSchoolPeriodsPerDay = periodsPerDay;
  for (const lim of gradeLimitsMap.values()) {
    for (const v of Object.values(lim)) {
      if (v > effectiveSchoolPeriodsPerDay) effectiveSchoolPeriodsPerDay = v;
    }
  }

  for (const code of sortedSecCodes) {
    const gNum = Number(code.split("/")[0]);
    const gLim = gradeLimitsMap.get(gNum);
    if (!gradeMap.has(gNum)) {
      gradeMap.set(gNum, {
        id: `G_${gNum}`,
        name: gradeNames[gNum] || `الصف ${gNum}`,
        code: `G${gNum}`,
        order: gNum,
        daily_period_limits: gLim && Object.keys(gLim).length > 0 ? { ...gLim } : undefined,
      });
    }
    const gr = gradeMap.get(gNum)!;
    sections.push({
      id: `SEC_${code.replace("/", "_")}`,
      grade_id: gr.id,
      name: code,
      code,
      shift: /فترتين|صباح[يى].*مسائ[يى]|مسائ[يى].*صباح[يى]/.test(fullNorm) ? (gNum >= 4 ? "SECOND" : "FIRST") : undefined,
      daily_period_limits: gr.daily_period_limits ? { ...gr.daily_period_limits } : undefined,
    });
  }
  const grades = Array.from(gradeMap.values()).sort((a, b) => a.order - b.order);

  // 4. Parse Teachers, Subjects & Assignments line by line
  const subjectMap = new Map<string, Subject>();
  const teacherMap = new Map<string, Teacher>();
  const assignments: TeachingAssignment[] = [];

  const getOrCreateSubject = (def: SubjectDef): Subject => {
    const existing = subjectMap.get(def.canonical);
    if (existing) return existing;
    const sub: Subject = {
      id: `SUB_${subjectMap.size + 1}`,
      name: def.canonical,
      code: def.code,
      double_period_policy: def.doublePolicy || "FREE",
    };
    subjectMap.set(def.canonical, sub);
    return sub;
  };

  const formatTeacherDisplayName = (rawName: string): { displayName: string; isDeficit: boolean; matchKey: string } => {
    const clean = rawName.trim();
    const nClean = normAr(clean);
    const isDeficit = /^(?:س\s*\d+|س\s+[\u0600-\u06FF]+|عجز(?:\s+|$))/.test(nClean) || nClean === "س";
    const sanitized = clean.replace(/\(?\s*عجز\s*\)?/g, "").replace(/\s+/g, " ").trim() || clean;
    const displayName = sanitized.replace(/\s*\(?\s*شاغر\s*\)?/g, "").replace(/\s+/g, " ").trim() || clean;
    return { displayName, isDeficit, matchKey: nClean };
  };

  const getOrCreateTeacher = (name: string): Teacher => {
    const { displayName, isDeficit, matchKey } = formatTeacherDisplayName(name);
    const existing = teacherMap.get(matchKey);
    if (existing) return existing;
    const t: Teacher = {
      id: `TCH_${teacherMap.size + 1}`,
      name: displayName,
      code: isDeficit ? displayName.replace(/\s+/g, "-") : displayName.split(" ")[0],
      subject_ids: [],
      max_daily_periods: periodsPerDay,
      max_weekly_periods: 24,
      max_consecutive_periods: globalMaxConsec,
      force_double_periods: false,
      work_pattern: { day_rules: {}, daily_period_rules: [], placement_rules: [] },
    };
    teacherMap.set(matchKey, t);
    return t;
  };

  const addAssignment = (teacher: Teacher, subject: Subject, sec: Section, periods: number) => {
    if (!teacher.subject_ids) teacher.subject_ids = [];
    if (!teacher.subject_ids.includes(subject.id)) teacher.subject_ids.push(subject.id);

    const existing = assignments.find(
      (a) => a.section_id === sec.id && a.subject_id === subject.id && a.teacher_id === teacher.id
    );
    if (existing) {
      existing.weekly_periods = periods;
      return;
    }
    assignments.push({
      id: `ASG_${assignments.length + 1}`,
      section_id: sec.id,
      subject_id: subject.id,
      teacher_id: teacher.id,
      weekly_periods: periods,
    });
  };

  let activeHeadingSubject: SubjectDef | null = null;

  for (const rawLine of lines) {
    const lineNorm = normAr(rawLine);

    const colonPos = rawLine.indexOf(":");
    const beforeColon = colonPos > 0 ? rawLine.slice(0, colonPos).trim() : "";
    const afterColon = colonPos > 0 ? rawLine.slice(colonPos + 1).trim() : "";
    const normBeforeColon = normAr(beforeColon).replace(/^(?:[-•*]\s*)?(?:استاذ|مس|كابتن|د\.|أ\.|معلم)\s+/, "");
    const isDeficitBeforeColon =
      colonPos > 0 &&
      colonPos < 35 &&
      (/^(?:س\s*\d+|س\s+[\u0600-\u06FF]+|عجز(?:\s|$))/.test(normBeforeColon) || normBeforeColon === "س");
    const isHeaderPrefix = /^(?:الفصول|الشعب|المواد|الحصص|المواعيد|القيود|الشروط|بيانات|معلومات|جدول|ملاحظات|ايام|الايام)/.test(normAr(beforeColon));
    const isColonTeacherFormat =
      colonPos > 0 &&
      colonPos < 35 &&
      !isHeaderPrefix &&
      Boolean(afterColon) &&
      (isDeficitBeforeColon || (!detectSubject(beforeColon) && Boolean(detectSubject(afterColon))));

    const isBareDeficitStart = /^(?:[-•*]\s*)?(?:س\s*\d+|س\s+[\u0600-\u06FF]+|عجز\s+[\u0600-\u06FF]+)/.test(lineNorm) && (/(?:1\s*[/\\]\s*\d|\d+\s*حص)/.test(lineNorm) || isColonTeacherFormat);
    const isTeacherLine = isColonTeacherFormat || isBareDeficitStart || /(?:^|\s)(?:استاذ|مس|كابتن|معلم|بيد[يى]|بتد[يى]|ماسك|معاه|معاها|واخد|واخد[ةه]|بتاخد)(?:\s|$)/.test(lineNorm);
    if (!isTeacherLine) {
      const headingSub = detectSubject(rawLine);
      if (headingSub) activeHeadingSubject = headingSub;
      continue;
    }

    let defaultSubjDef: SubjectDef | null = activeHeadingSubject;
    let bodyLine = rawLine;
    const colonIdx = rawLine.indexOf(":");
    if (colonIdx > 0 && colonIdx < 35 && !isDeficitBeforeColon) {
      const prefix = rawLine.slice(0, colonIdx);
      if (!/(?:^|\s)(?:استاذ|مس|كابتن|معلم|معاه|معاها|بتاخد|بيد[يى])(?:\s|$)/.test(normAr(prefix))) {
        const subBefore = detectSubject(prefix);
        if (subBefore) {
          defaultSubjDef = subBefore;
          bodyLine = rawLine.slice(colonIdx + 1).trim();
        }
      }
    }

    // Extract Teacher Name and strip it from the assignment body so surnames (like "عز الدين" or "دراسات") don't confuse subject detection
    const tNameMatch = bodyLine.match(
      /^(?:[-•*]\s*)?(?:استاذ|أستاذ|مس|كابتن|د\.|أ\.|معلم(?:\s+نشاط\s+\d+)?)\s+(.+?)\s+(?=(?:بيدي|بتدي|ماسك|ماسكه|معاه|معاها|واخد|واخدة|بتاخد|عنده|عندها|بواقع|حصة))/i
    );
    const bareDeficitMatch = !tNameMatch && !isColonTeacherFormat
      ? bodyLine.match(/^(?:[-•*]\s*)?(س\s*(?:\d+|(?:[\u0600-\u06FF]+)(?:\s+[\u0600-\u06FF]+)?)|عجز\s+[\u0600-\u06FF]+)(?=\s+(?:بيدي|بتدي|ماسك|معاه|واخد|عنده|[1-6]\s*[/\\]\s*[1-9]|كل\s*الفصول|\d+\s*حص))/i)
      : null;
    let teacherName = "";
    let bodyWithoutTeacherPrefix = bodyLine;
    if (tNameMatch) {
      if (/^(?:[-•*]\s*)?معلم\s+(نشاط\s+\d+)/.test(bodyLine)) {
        const nMatch = bodyLine.match(/معلم\s+(نشاط\s+\d+)/);
        teacherName = nMatch ? nMatch[1].trim() : tNameMatch[1].trim();
      } else {
        teacherName = tNameMatch[1].trim();
      }
      bodyWithoutTeacherPrefix = bodyLine.slice(tNameMatch[0].length).trim();
    } else if (/^(?:[-•*]\s*)?معلم\s+(نشاط\s+\d+)/.test(bodyLine)) {
      const nMatch = bodyLine.match(/^(?:[-•*]\s*)?معلم\s+(نشاط\s+\d+)/);
      if (nMatch) {
        teacherName = nMatch[1].trim();
        bodyWithoutTeacherPrefix = bodyLine.slice(nMatch[0].length).trim();
      }
    } else if (bareDeficitMatch) {
      teacherName = bareDeficitMatch[1].trim();
      bodyWithoutTeacherPrefix = bodyLine.slice(bareDeficitMatch[0].length).trim();
    }

    if (!teacherName && isColonTeacherFormat) {
      teacherName = beforeColon.replace(/^(?:[-•*]\s*)?(?:استاذ|أستاذ|مس|كابتن|د\.|أ\.|معلم)\s*/i, "").trim();
      bodyWithoutTeacherPrefix = afterColon;
    }
    if (!teacherName) continue;
    const teacherMeta = formatTeacherDisplayName(teacherName);
    if (teacherMeta.isDeficit) {
      const subjFromDeficitLabel = detectSubject(teacherName);
      if (subjFromDeficitLabel) defaultSubjDef = subjFromDeficitLabel;
    }
    const teacher = getOrCreateTeacher(teacherName);

    // Extract Constraints carefully (handles explicit off-days AND work-days including "(بتيجي ...)" / "(شغال ...)")
    const onlyDaysMatch =
      lineNorm.match(/(?:مبتداومش\s*(?:غير|الا)|مبيجيش\s*(?:غير|الا)|لا يعمل\s*(?:غير|الا)|مبيشتغلش\s*(?:غير|الا)|يعني\s*شغال[ةه]?|شغال[ةه]?)\s+([^.!،()\n]+?)(?:بس|فقط)/) ||
      lineNorm.match(/\(\s*(?:بتيجي|بيجي|شغال[ةه]?|تعمل|يعمل|يداوم|تداوم)\s+([^)!\n]+?)\s*\)/);

    if (onlyDaysMatch) {
      const workDays = extractDayNumbers(onlyDaysMatch[1]);
      if (workDays.length > 0 && workDays.length < days.length) {
        teacher.work_pattern!.target_working_days = workDays.length;
        teacher.work_pattern!.target_working_days_is_hard = true;
        for (const d of days) {
          if (!workDays.includes(d)) {
            teacher.work_pattern!.day_rules[String(d)] = "MANDATORY_OFF";
          }
        }
      }
    } else {
      const offMatch = lineNorm.match(
        /(?:اجازته|اجازتها|واخد\s*اجاز[ةه]|واخد[ةه]\s*اجاز[ةه]|عند[هة]\s*اجاز[ةه])\s+([^.!،()\n]+?)(?=\s*(?:يعني|وحصصه|ومعاه|،|\(|$))/
      );
      if (offMatch) {
        const offDays = extractDayNumbers(offMatch[1]);
        for (const d of offDays) {
          teacher.work_pattern!.day_rules[String(d)] = "MANDATORY_OFF";
        }
      }
    }

    // Daily MAX/EXACT period limits (e.g. "مينفعش تاخد غير حصتين يوم الاربع")
    const maxDayLimitMatch = lineNorm.match(/(?:مينفعش\s*تاخد\s*غير|بحد\s*اقص[ىي]|لا\s*تزيد\s*عن)\s*(حصتين|\d+\s*حص[ةهص]?)\s*(?:في\s*)?يوم\s+([\u0600-\u06FF]+)/);
    if (maxDayLimitMatch) {
      const cnt = maxDayLimitMatch[1].includes("حصتين") ? 2 : Number(maxDayLimitMatch[1].replace(/\D+/g, "")) || 2;
      const limitDays = extractDayNumbers(maxDayLimitMatch[2]);
      for (const ld of limitDays) {
        teacher.work_pattern!.daily_period_rules.push({
          day: ld,
          rule_type: "MAX",
          count: cnt,
          is_hard: true,
          weight: 10,
        });
      }
    }

    const isStrongPlacement = /مينفعش|دايما|ممنوع|لازم/.test(lineNorm);
    if (/الحصص\s*الاخير[ةه]|الحصص\s*المتأخر[ةه]|الحصص\s*المتاخر[ةه]|في\s*الاخر/.test(lineNorm)) {
      teacher.work_pattern!.placement_rules.push({
        day: null,
        placement_type: "LAST_N",
        n_periods: 2,
        exact_periods: [],
        is_hard: false,
        weight: isStrongPlacement ? 9 : 6,
      });
    } else if (/اول\s*حصتين|الحصص\s*الاول[ىي]/.test(lineNorm)) {
      teacher.work_pattern!.placement_rules.push({
        day: null,
        placement_type: "FIRST_N",
        n_periods: 2,
        exact_periods: [],
        is_hard: false,
        weight: isStrongPlacement ? 9 : 6,
      });
    }
    if (/متتحطش\s*في\s*الاول|ممنوع.*الاول|مش\s*في\s*الاول/.test(lineNorm)) {
      teacher.work_pattern!.placement_rules.push({
        day: null,
        placement_type: "AVOID_FIRST",
        n_periods: 1,
        exact_periods: [],
        is_hard: true,
        weight: 9,
      });
    }
    if (/مزدوج[ةه]?/.test(lineNorm)) {
      teacher.force_double_periods = true;
    }

    // Inspect parenthetical deficit/gap notes BEFORE stripping them (e.g., "فصل 1/1 فاضله 3 حصص دين ممكن نديهم لـ س3")
    const noteMatch = bodyWithoutTeacherPrefix.match(/\(ملاحظ[ةه]:([^)]+)\)/);
    if (noteMatch) {
      const noteBody = noteMatch[1];
      const noteNorm = normAr(noteBody);
      const gapMatch = noteNorm.match(/فصل\s*([1-6]\s*[/\\]\s*[1-9])\s*(?:فاضل[هة]?|ناقص[هة]?)\s*(\d+)\s*حص[ةهص]?\s+([\u0600-\u06FF]+).*?(?:لـ?\s*|نديهم\s*لـ?\s*)(س\s*(?:\d+|[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+)?)|[\u0600-\u06FF]+)/);
      if (gapMatch) {
        const gapSecCode = gapMatch[1].replace(/\s+/g, "").replace("\\", "/");
        const gapPeriods = Number(gapMatch[2]);
        const gapSubj = detectSubject(gapMatch[3]);
        const targetTeacherRaw = gapMatch[4].trim();
        const gapSec = sections.find((s) => s.name === gapSecCode);
        if (gapSec && gapSubj && gapPeriods > 0) {
          const subjObj = getOrCreateSubject(gapSubj);
          const targetTch = getOrCreateTeacher(targetTeacherRaw);
          addAssignment(targetTch, subjObj, gapSec, gapPeriods);
        }
      }
    }

    // Clean assignment body
    const cleanAsgnBody = bodyWithoutTeacherPrefix
      .replace(/\(ملاحظة:[^)]+\)/g, "")
      .replace(/(?:بس خد بالك|واخد اجازة|واخدة اجازة|عنده اجازة|اجازته|اجازتها|مبتداومش|برضه|وياريت|والالعاب دايما).*/g, "");

    const correctedBody = cleanAsgnBody.includes("لأ ثواني،")
      ? cleanAsgnBody.split("لأ ثواني،").slice(-1)[0]
      : cleanAsgnBody;

    const clauses = correctedBody.split(/(?:\s+(?:وبيدي|وبتدي|وكمان|ومعاه|ومعاها)\s+|\s*[+،]\s*(?=(?:عرب|لغ[ةه]|دين|تربي|رياض|حساب|انجليز|علوم|دراسات|توكاتسو|تكنولوج|مهارات|العاب|موسيق|رسم|فني)))/i);
    let currentSubjDef = defaultSubjDef;

    for (const clause of clauses) {
      const clauseSubj = detectSubject(clause);
      if (clauseSubj) currentSubjDef = clauseSubj;
      if (!currentSubjDef) continue;

      const subjectObj = getOrCreateSubject(currentSubjDef);

      const secPeriodPairs = Array.from(
        clause.matchAll(/(?:فصل\s*)?([1-6]\s*[/\\]\s*[1-9])\s*\((\d+)\s*حص[ةهص]?[^)]*\)/g)
      );

      if (secPeriodPairs.length > 0) {
        for (const pair of secPeriodPairs) {
          const code = pair[1].replace(/\s+/g, "").replace("\\", "/");
          const pCount = Number(pair[2]);
          const sec = sections.find((s) => s.name === code);
          if (sec) addAssignment(teacher, subjectObj, sec, pCount);
        }
        const sharedCountMatch = clause.match(/\((\d+)\s*حص[ةهص]?\s*(?:لكل|في)\s*(?:كل\s*)?(?:ال)?فصل/);
        if (sharedCountMatch) {
          const sharedP = Number(sharedCountMatch[1]);
          const secsInClause = extractSectionsFromText(clause, sections, grades);
          for (const sec of secsInClause) {
            if (!assignments.some((a) => a.section_id === sec.id && a.subject_id === subjectObj.id && a.teacher_id === teacher.id)) {
              addAssignment(teacher, subjectObj, sec, sharedP);
            }
          }
        }
      } else {
        const secs = extractSectionsFromText(clause, sections, grades);
        const pCount = extractPeriodsCount(clause, 1);
        for (const sec of secs) {
          addAssignment(teacher, subjectObj, sec, pCount);
        }
      }
    }
  }

  // Enforce hard LAST_N / FIRST_N when strong phrasing was used AND mathematically fits active days
  for (const t of teacherMap.values()) {
    const activeDaysCount = days.filter((d) => t.work_pattern?.day_rules?.[String(d)] !== "MANDATORY_OFF").length;
    const totalPeriods = assignments.filter((a) => a.teacher_id === t.id).reduce((s, a) => s + a.weekly_periods, 0);
    for (const rule of t.work_pattern?.placement_rules || []) {
      if ((rule.placement_type === "LAST_N" || rule.placement_type === "FIRST_N") && rule.weight >= 9) {
        const maxWindowSlots = activeDaysCount * (rule.n_periods || 2);
        if (totalPeriods > 0 && totalPeriods <= maxWindowSlots) {
          rule.is_hard = true;
        }
      }
    }
  }

  const rawSchool: SchoolData = {
    id: "sch_unstructured_" + Date.now().toString(36),
    name: schoolName,
    academic_year: academicYear,
    days,
    shift_mode: sections.some((s) => s.shift === "SECOND") && sections.some((s) => s.shift === "FIRST") ? "TWO_SHIFTS" : "SINGLE",
    periods_per_day: effectiveSchoolPeriodsPerDay,
    grades,
    sections,
    subjects: Array.from(subjectMap.values()),
    teachers: Array.from(teacherMap.values()),
    availabilities: [],
    assignments,
    rules: {
      max_consecutive_same_teacher_section: 2,
      no_section_gaps: true,
      minimize_teacher_gaps: true,
    },
  };

  if (rawSchool.teachers.length === 0 || rawSchool.assignments.length === 0) {
    return null;
  }

  const sanitized = sanitizeSchool(rawSchool).school;
  return {
    school: sanitized,
    notes: [
      `تم تحليل النص الحر واستخراج "${sanitized.name}" (${sanitized.sections.length} فصول، ${sanitized.teachers.length} معلماً، ${sanitized.assignments.length} تكليفاً) بواسطة المحلل اللغوي العربي المدمج.`,
    ],
  };
}
