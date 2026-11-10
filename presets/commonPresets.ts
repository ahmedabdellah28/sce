import {
  DAY_NAMES_AR,
  type Grade,
  type Section,
  type Subject,
  type Teacher,
  type TeachingAssignment,
  type SchoolData,
} from "../types.js";

/**
 * Catalog of Common School Presets (قيم شائعة قابلة للتعديل).
 * 
 * Strict Privacy & Architecture Rules:
 * - NO real teacher names or personal data.
 * - Every subject has:
 *    - Standard ID (id)
 *    - Synonyms / Aliases (aliases)
 *    - Customizable Display Name (name)
 *    - Exact Weekly Quota (periods)
 * - Mathematical Invariant:
 *    For every preset and every grade: Sum of subject quotas === Weekly Shift Capacity.
 */

export interface PresetSubject {
  id: string;               // معرّف قياسي، مثل: "arabic", "math"
  name: string;             // اسم العرض الافتراضي القابل للتعديل
  code: string;             // رمز المادة المختصر
  aliases: string[];        // مرادفات وتسميات شائعة
  periods: number;          // النصاب الأسبوعي (عدد الحصص)
  priority?: number;        // أولوية التسكين (1 الأعلى)
  before_break?: boolean;   // تفضيل قبل الفسحة
  double_policy?: "DOUBLE_REQUIRED" | "SINGLE_ONLY" | "PREFER_DOUBLE" | "FREE";
  max_daily?: number;
  category: "CORE" | "LANG" | "ACTIVITY" | "TECH";
}

export interface PresetShift {
  name: string;
  days: number[];                           // [0, 1, 2, 3, 4]
  periods_by_day: Record<string, number>;  // {"0": 7, "1": 7, ...}
  weekly_capacity: number;                  // sum of daily periods
}

export interface PresetGrade {
  grade_number: number;
  name: string;
  code: string;
  shift_name: string;
  subjects: PresetSubject[];
  weekly_total: number;
}

export interface SchoolPreset {
  id: string;
  name: string;
  label: string;
  school_type: "GOVERNMENT_GENERAL" | "EXPERIMENTAL_LANGUAGE"; // حكومي عام / تجريبي لغات
  stage: "PRIMARY" | "PREPARATORY" | "SECONDARY";               // ابتدائي / إعدادي / ثانوي
  shift_system: "SINGLE_SHIFT" | "TWO_SHIFTS";                  // فترة واحدة / فترتان
  description: string;                                          // "قيم شائعة قابلة للتعديل"
  days: number[];
  shifts: PresetShift[];
  grades: PresetGrade[];
  rules: {
    break_after_period?: number;
    max_consecutive_same?: number;
  };
}

// ---------------------------------------------------------------------------
// 1. Primary: Government General - Single Shift (35 periods)
// ---------------------------------------------------------------------------
const primaryGovSingleShift: PresetShift = {
  name: "الفترة الكاملة",
  days: [0, 1, 2, 3, 4],
  periods_by_day: { "0": 7, "1": 7, "2": 7, "3": 7, "4": 7 },
  weekly_capacity: 35,
};

const primaryGovLowerSubjects: PresetSubject[] = [
  { id: "arabic", name: "اللغة العربية", code: "عربي", aliases: ["عربي", "لغة عربية", "عربى", "العربي"], periods: 10, priority: 1, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "math", name: "الرياضيات", code: "رياضيات", aliases: ["حساب", "رياضيات", "Math"], periods: 7, priority: 2, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "english", name: "اللغة الإنجليزية", code: "إنجليزي", aliases: ["انجليزي", "لغة انجليزية", "English"], periods: 5, priority: 3, category: "LANG" },
  { id: "religion", name: "التربية الدينية", code: "دين", aliases: ["دين", "تربية اسلامية", "تربية دينية", "دين مسيحي"], periods: 5, priority: 4, before_break: true, category: "CORE" },
  { id: "tokkatsu", name: "أنشطة التوكاتسو", code: "توكاتسو", aliases: ["توكاتسو", "ريادة"], periods: 1, category: "ACTIVITY" },
  { id: "pe", name: "التربية الرياضية والبدنية", code: "ألعاب", aliases: ["العاب", "رياضة بدنية", "تربية رياضية", "العاب قوى"], periods: 4, category: "ACTIVITY" },
  { id: "art", name: "التربية الفنية والموسيقية", code: "فنية", aliases: ["رسم", "فنية", "تربية فنية", "موسيقى"], periods: 3, category: "ACTIVITY" },
]; // Sum = 10 + 7 + 5 + 5 + 1 + 4 + 3 = 35

const primaryGovUpperSubjects: PresetSubject[] = [
  { id: "arabic", name: "اللغة العربية", code: "عربي", aliases: ["عربي", "لغة عربية", "عربى", "العربي"], periods: 9, priority: 1, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "math", name: "الرياضيات", code: "رياضيات", aliases: ["حساب", "رياضيات", "Math"], periods: 6, priority: 2, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "english", name: "اللغة الإنجليزية", code: "إنجليزي", aliases: ["انجليزي", "لغة انجليزية", "English"], periods: 4, priority: 3, category: "LANG" },
  { id: "science", name: "العلوم", code: "علوم", aliases: ["علوم", "Science"], periods: 3, priority: 4, category: "CORE" },
  { id: "social", name: "الدراسات الاجتماعية", code: "دراسات", aliases: ["دراسات", "دراسات اجتماعية"], periods: 3, priority: 5, category: "CORE" },
  { id: "religion", name: "التربية الدينية", code: "دين", aliases: ["دين", "تربية اسلامية", "تربية دينية", "دين مسيحي"], periods: 4, priority: 6, before_break: true, category: "CORE" },
  { id: "ict", name: "تكنولوجيا المعلومات والاتصالات ICT", code: "حاسب", aliases: ["تكنولوجيا", "حاسب الي", "ICT", "حاسوب"], periods: 1, category: "TECH" },
  { id: "skills", name: "المهارات المهنية", code: "مهارات", aliases: ["مهارات مهنية", "مجالات"], periods: 1, category: "TECH" },
  { id: "pe", name: "التربية الرياضية والبدنية", code: "ألعاب", aliases: ["العاب", "تربية رياضية"], periods: 2, category: "ACTIVITY" },
  { id: "art", name: "التربية الفنية", code: "رسم", aliases: ["رسم", "فنية", "تربية فنية"], periods: 1, category: "ACTIVITY" },
  { id: "music", name: "التربية الموسيقية والأنشطة", code: "موسيقى", aliases: ["موسيقى", "انشطة", "تربية موسيقية"], periods: 1, category: "ACTIVITY" },
]; // Sum = 9 + 6 + 4 + 3 + 3 + 4 + 1 + 1 + 2 + 1 + 1 = 35

export const PRESET_PRIMARY_GOV_SINGLE: SchoolPreset = {
  id: "preset_primary_gov_single",
  name: "المرحلة الابتدائية — حكومي عام (فترة واحدة - 35 حصة)",
  label: "ابتدائي حكومي عام (35 حصة)",
  school_type: "GOVERNMENT_GENERAL",
  stage: "PRIMARY",
  shift_system: "SINGLE_SHIFT",
  description: "قيم شائعة قابلة للتعديل: 7 حصص يومياً (35 حصة أسبوعياً) للصفوف 1 إلى 6، تشمل تكنولوجيا المعلومات والمهارات والأنشطة.",
  days: [0, 1, 2, 3, 4],
  shifts: [primaryGovSingleShift],
  grades: [
    { grade_number: 1, name: "الصف الأول الابتدائي", code: "G1", shift_name: "الفترة الكاملة", subjects: primaryGovLowerSubjects, weekly_total: 35 },
    { grade_number: 2, name: "الصف الثاني الابتدائي", code: "G2", shift_name: "الفترة الكاملة", subjects: primaryGovLowerSubjects, weekly_total: 35 },
    { grade_number: 3, name: "الصف الثالث الابتدائي", code: "G3", shift_name: "الفترة الكاملة", subjects: primaryGovLowerSubjects, weekly_total: 35 },
    { grade_number: 4, name: "الصف الرابع الابتدائي", code: "G4", shift_name: "الفترة الكاملة", subjects: primaryGovUpperSubjects, weekly_total: 35 },
    { grade_number: 5, name: "الصف الخامس الابتدائي", code: "G5", shift_name: "الفترة الكاملة", subjects: primaryGovUpperSubjects, weekly_total: 35 },
    { grade_number: 6, name: "الصف السادس الابتدائي", code: "G6", shift_name: "الفترة الكاملة", subjects: primaryGovUpperSubjects, weekly_total: 35 },
  ],
  rules: { break_after_period: 3, max_consecutive_same: 2 },
};

// ---------------------------------------------------------------------------
// 2. Primary: Government General - Two Shifts (Morning 29, Evening 36)
// ---------------------------------------------------------------------------
const primaryGovMorningShift: PresetShift = {
  name: "الفترة الصباحية (صفوف 1-3)",
  days: [0, 1, 2, 3, 4],
  periods_by_day: { "0": 6, "1": 6, "2": 6, "3": 6, "4": 5 },
  weekly_capacity: 29,
};

const primaryGovEveningShift: PresetShift = {
  name: "الفترة المسائية (صفوف 4-6)",
  days: [0, 1, 2, 3, 4],
  periods_by_day: { "0": 7, "1": 8, "2": 7, "3": 7, "4": 7 },
  weekly_capacity: 36,
};

const primaryTwoShiftMorningSubjects: PresetSubject[] = [
  { id: "arabic", name: "اللغة العربية", code: "عربي", aliases: ["عربي", "لغة عربية"], periods: 9, priority: 1, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "math", name: "الرياضيات", code: "رياضيات", aliases: ["حساب", "رياضيات"], periods: 7, priority: 2, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "english", name: "اللغة الإنجليزية", code: "إنجليزي", aliases: ["انجليزي", "لغة انجليزية"], periods: 5, priority: 3, category: "LANG" },
  { id: "religion", name: "التربية الدينية", code: "دين", aliases: ["دين", "تربية اسلامية"], periods: 5, priority: 4, before_break: true, category: "CORE" },
  { id: "tokkatsu", name: "أنشطة التوكاتسو", code: "توكاتسو", aliases: ["توكاتسو"], periods: 1, category: "ACTIVITY" },
  { id: "pe", name: "التربية الرياضية والبدنية", code: "ألعاب", aliases: ["العاب", "تربية بدنية"], periods: 2, category: "ACTIVITY" },
]; // Sum = 9 + 7 + 5 + 5 + 1 + 2 = 29

const primaryTwoShiftEveningSubjects: PresetSubject[] = [
  { id: "arabic", name: "اللغة العربية", code: "عربي", aliases: ["عربي", "لغة عربية"], periods: 9, priority: 1, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "math", name: "الرياضيات", code: "رياضيات", aliases: ["حساب", "رياضيات"], periods: 6, priority: 2, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "english", name: "اللغة الإنجليزية", code: "إنجليزي", aliases: ["انجليزي", "لغة انجليزية"], periods: 4, priority: 3, category: "LANG" },
  { id: "science", name: "العلوم", code: "علوم", aliases: ["علوم"], periods: 3, priority: 4, category: "CORE" },
  { id: "social", name: "الدراسات الاجتماعية", code: "دراسات", aliases: ["دراسات"], periods: 3, priority: 5, category: "CORE" },
  { id: "religion", name: "التربية الدينية", code: "دين", aliases: ["دين", "تربية اسلامية"], periods: 4, priority: 6, before_break: true, category: "CORE" },
  { id: "ict", name: "تكنولوجيا المعلومات ICT", code: "تكنولوجيا", aliases: ["تكنولوجيا", "ICT", "حاسب"], periods: 1, category: "TECH" },
  { id: "skills", name: "المهارات المهنية", code: "مهارات", aliases: ["مهارات", "مهارات مهنية"], periods: 1, category: "TECH" },
  { id: "pe", name: "التربية الرياضية", code: "ألعاب", aliases: ["العاب", "تربية رياضية"], periods: 2, category: "ACTIVITY" },
  { id: "art", name: "التربية الفنية", code: "فنية", aliases: ["رسم", "تربية فنية"], periods: 2, category: "ACTIVITY" },
  { id: "music", name: "الموسيقى والأنشطة", code: "موسيقى", aliases: ["موسيقى", "انشطة"], periods: 1, category: "ACTIVITY" },
]; // Sum = 9 + 6 + 4 + 3 + 3 + 4 + 1 + 1 + 2 + 2 + 1 = 36

export const PRESET_PRIMARY_GOV_TWO_SHIFTS: SchoolPreset = {
  id: "preset_primary_gov_two_shifts",
  name: "المرحلة الابتدائية — حكومي عام فترتان (صباحي 29 حصة / مسائي 36 حصة)",
  label: "ابتدائي حكومي فترتان (29/36 حصة)",
  school_type: "GOVERNMENT_GENERAL",
  stage: "PRIMARY",
  shift_system: "TWO_SHIFTS",
  description: "قيم شائعة قابلة للتعديل للمدارس ذات الكثافات ونظام الفترتين: صفوف 1-3 صباحي (29 حصة)، صفوف 4-6 مسائي (36 حصة مع يوم 8 حصص).",
  days: [0, 1, 2, 3, 4],
  shifts: [primaryGovMorningShift, primaryGovEveningShift],
  grades: [
    { grade_number: 1, name: "الصف الأول الابتدائي", code: "G1", shift_name: "الفترة الصباحية (صفوف 1-3)", subjects: primaryTwoShiftMorningSubjects, weekly_total: 29 },
    { grade_number: 2, name: "الصف الثاني الابتدائي", code: "G2", shift_name: "الفترة الصباحية (صفوف 1-3)", subjects: primaryTwoShiftMorningSubjects, weekly_total: 29 },
    { grade_number: 3, name: "الصف الثالث الابتدائي", code: "G3", shift_name: "الفترة الصباحية (صفوف 1-3)", subjects: primaryTwoShiftMorningSubjects, weekly_total: 29 },
    { grade_number: 4, name: "الصف الرابع الابتدائي", code: "G4", shift_name: "الفترة المسائية (صفوف 4-6)", subjects: primaryTwoShiftEveningSubjects, weekly_total: 36 },
    { grade_number: 5, name: "الصف الخامس الابتدائي", code: "G5", shift_name: "الفترة المسائية (صفوف 4-6)", subjects: primaryTwoShiftEveningSubjects, weekly_total: 36 },
    { grade_number: 6, name: "الصف السادس الابتدائي", code: "G6", shift_name: "الفترة المسائية (صفوف 4-6)", subjects: primaryTwoShiftEveningSubjects, weekly_total: 36 },
  ],
  rules: { break_after_period: 3, max_consecutive_same: 2 },
};

// ---------------------------------------------------------------------------
// 3. Primary: Experimental Language Schools (تجريبي لغات - 35 حصة)
// ---------------------------------------------------------------------------
const primaryLangLowerSubjects: PresetSubject[] = [
  { id: "arabic", name: "اللغة العربية", code: "عربي", aliases: ["عربي", "لغة عربية"], periods: 8, priority: 1, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "math", name: "Mathematics (الرياضيات بالإنجليزية)", code: "Math", aliases: ["Math", "الرياضيات بالإنجليزية", "رياضيات لغات"], periods: 7, priority: 2, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "english", name: "English Connect Plus (مستوى رفيع)", code: "Connect+", aliases: ["Connect Plus", "كونكت بلس", "مستوى رفيع انجليزي", "English High Level"], periods: 7, priority: 3, category: "LANG" },
  { id: "religion", name: "التربية الدينية", code: "دين", aliases: ["دين", "تربية اسلامية", "دين مسيحي"], periods: 5, priority: 4, before_break: true, category: "CORE" },
  { id: "tokkatsu", name: "أنشطة التوكاتسو", code: "توكاتسو", aliases: ["توكاتسو"], periods: 1, category: "ACTIVITY" },
  { id: "pe", name: "التربية الرياضية والبدنية", code: "ألعاب", aliases: ["العاب", "PE"], periods: 4, category: "ACTIVITY" },
  { id: "art", name: "التربية الفنية", code: "Art", aliases: ["رسم", "Art", "فنية"], periods: 3, category: "ACTIVITY" },
]; // Sum = 8 + 7 + 7 + 5 + 1 + 4 + 3 = 35

const primaryLangUpperSubjects: PresetSubject[] = [
  { id: "arabic", name: "اللغة العربية", code: "عربي", aliases: ["عربي", "لغة عربية"], periods: 7, priority: 1, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "math", name: "Mathematics (الرياضيات بالإنجليزية)", code: "Math", aliases: ["Math", "الرياضيات لغات"], periods: 6, priority: 2, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "english", name: "English Connect Plus (مستوى رفيع)", code: "Connect+", aliases: ["Connect Plus", "مستوى رفيع", "English Advanced"], periods: 6, priority: 3, category: "LANG" },
  { id: "science", name: "Science (العلوم بالإنجليزية)", code: "Science", aliases: ["Science", "العلوم لغات", "ساينس"], periods: 4, priority: 4, category: "CORE" },
  { id: "social", name: "الدراسات الاجتماعية", code: "دراسات", aliases: ["دراسات", "Social Studies"], periods: 3, priority: 5, category: "CORE" },
  { id: "religion", name: "التربية الدينية", code: "دين", aliases: ["دين", "تربية دينية"], periods: 3, priority: 6, before_break: true, category: "CORE" },
  { id: "ict", name: "تكنولوجيا المعلومات ICT", code: "ICT", aliases: ["ICT", "تكنولوجيا لغات"], periods: 1, category: "TECH" },
  { id: "skills", name: "المهارات المهنية", code: "مهارات", aliases: ["مهارات مهنية"], periods: 1, category: "TECH" },
  { id: "pe", name: "التربية الرياضية", code: "PE", aliases: ["العاب", "PE"], periods: 2, category: "ACTIVITY" },
  { id: "art", name: "التربية الفنية", code: "Art", aliases: ["Art", "رسم"], periods: 1, category: "ACTIVITY" },
  { id: "second_lang", name: "لغة أجنبية ثانية (استكشافية)", code: "لغة ثانية", aliases: ["فرنساوي", "ألماني", "لغة ثانية", "French", "German"], periods: 1, category: "LANG" },
]; // Sum = 7 + 6 + 6 + 4 + 3 + 3 + 1 + 1 + 2 + 1 + 1 = 35

export const PRESET_PRIMARY_LANG_SINGLE: SchoolPreset = {
  id: "preset_primary_lang_single",
  name: "المرحلة الابتدائية — تجريبي رسمي لغات (فترة واحدة - 35 حصة)",
  label: "ابتدائي تجريبي لغات (35 حصة)",
  school_type: "EXPERIMENTAL_LANGUAGE",
  stage: "PRIMARY",
  shift_system: "SINGLE_SHIFT",
  description: "قيم شائعة قابلة للتعديل للمدارس الرسمية للغات (تجريبي): تدريس Mathematics و Science بالإنجليزية، ومنهج Connect Plus الموسع.",
  days: [0, 1, 2, 3, 4],
  shifts: [primaryGovSingleShift],
  grades: [
    { grade_number: 1, name: "الصف الأول الابتدائي لغات", code: "G1", shift_name: "الفترة الكاملة", subjects: primaryLangLowerSubjects, weekly_total: 35 },
    { grade_number: 2, name: "الصف الثاني الابتدائي لغات", code: "G2", shift_name: "الفترة الكاملة", subjects: primaryLangLowerSubjects, weekly_total: 35 },
    { grade_number: 3, name: "الصف الثالث الابتدائي لغات", code: "G3", shift_name: "الفترة الكاملة", subjects: primaryLangLowerSubjects, weekly_total: 35 },
    { grade_number: 4, name: "الصف الرابع الابتدائي لغات", code: "G4", shift_name: "الفترة الكاملة", subjects: primaryLangUpperSubjects, weekly_total: 35 },
    { grade_number: 5, name: "الصف الخامس الابتدائي لغات", code: "G5", shift_name: "الفترة الكاملة", subjects: primaryLangUpperSubjects, weekly_total: 35 },
    { grade_number: 6, name: "الصف السادس الابتدائي لغات", code: "G6", shift_name: "الفترة الكاملة", subjects: primaryLangUpperSubjects, weekly_total: 35 },
  ],
  rules: { break_after_period: 3, max_consecutive_same: 2 },
};

// ---------------------------------------------------------------------------
// 4. Preparatory: Government General (نظام 35 حصة / 7 حصص يومياً)
// ---------------------------------------------------------------------------
const prepGovSingleShift: PresetShift = {
  name: "الفترة الكاملة (إعدادي 35)",
  days: [0, 1, 2, 3, 4],
  periods_by_day: { "0": 7, "1": 7, "2": 7, "3": 7, "4": 7 },
  weekly_capacity: 35,
};

const prepGovSubjects35: PresetSubject[] = [
  { id: "arabic", name: "اللغة العربية والخط", code: "عربي", aliases: ["عربي", "لغة عربية", "خط", "قراءة"], periods: 8, priority: 1, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "math", name: "الرياضيات (جبر وهندسة)", code: "رياضيات", aliases: ["رياضيات", "جبر", "هندسة"], periods: 6, priority: 2, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "english", name: "اللغة الإنجليزية", code: "إنجليزي", aliases: ["انجليزي", "English"], periods: 5, priority: 3, category: "LANG" },
  { id: "science", name: "العلوم", code: "علوم", aliases: ["علوم", "Science"], periods: 4, priority: 4, category: "CORE" },
  { id: "social", name: "الدراسات الاجتماعية", code: "دراسات", aliases: ["دراسات", "تاريخ", "جغرافيا"], periods: 4, priority: 5, category: "CORE" },
  { id: "religion", name: "التربية الدينية", code: "دين", aliases: ["دين", "تربية اسلامية"], periods: 3, priority: 6, before_break: true, category: "CORE" },
  { id: "computer", name: "الكمبيوتر وتكنولوجيا المعلومات", code: "حاسب", aliases: ["حاسب", "كمبيوتر", "حاسب الي"], periods: 2, category: "TECH" },
  { id: "art", name: "التربية الفنية", code: "فنية", aliases: ["رسم", "فنية", "تربية فنية"], periods: 2, category: "ACTIVITY" },
  { id: "pe", name: "التربية الرياضية", code: "ألعاب", aliases: ["العاب", "رياضة بدنية"], periods: 1, category: "ACTIVITY" },
]; // Sum = 8 + 6 + 5 + 4 + 4 + 3 + 2 + 2 + 1 = 35

export const PRESET_PREP_GOV_35: SchoolPreset = {
  id: "preset_prep_gov_35",
  name: "المرحلة الإعدادية — حكومي عام (فترة واحدة - 35 حصة)",
  label: "إعدادي حكومي عام (35 حصة)",
  school_type: "GOVERNMENT_GENERAL",
  stage: "PREPARATORY",
  shift_system: "SINGLE_SHIFT",
  description: "قيم شائعة قابلة للتعديل للمرحلة الإعدادية: 7 حصص يومياً (35 حصة)، توزيع متوازن للغات والعلوم والأنشطة والحاسب.",
  days: [0, 1, 2, 3, 4],
  shifts: [prepGovSingleShift],
  grades: [
    { grade_number: 1, name: "الصف الأول الإعدادي", code: "G1", shift_name: "الفترة الكاملة (إعدادي 35)", subjects: prepGovSubjects35, weekly_total: 35 },
    { grade_number: 2, name: "الصف الثاني الإعدادي", code: "G2", shift_name: "الفترة الكاملة (إعدادي 35)", subjects: prepGovSubjects35, weekly_total: 35 },
    { grade_number: 3, name: "الصف الثالث الإعدادي", code: "G3", shift_name: "الفترة الكاملة (إعدادي 35)", subjects: prepGovSubjects35, weekly_total: 35 },
  ],
  rules: { break_after_period: 3, max_consecutive_same: 2 },
};

// ---------------------------------------------------------------------------
// 5. Preparatory: Government General (نظام 36 حصة - الأحد 8 حصص والباقي 7 كما في مدرسة 376)
// ---------------------------------------------------------------------------
const prepGovShift36: PresetShift = {
  name: "فترة الإعدادي 36 حصة",
  days: [0, 1, 2, 3, 4],
  periods_by_day: { "0": 8, "1": 7, "2": 7, "3": 7, "4": 7 },
  weekly_capacity: 36,
};

const prepGovSubjects36: PresetSubject[] = [
  { id: "arabic", name: "اللغة العربية والخط", code: "عربي", aliases: ["عربي", "لغة عربية"], periods: 8, priority: 1, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "math", name: "الرياضيات (جبر وهندسة)", code: "رياضيات", aliases: ["رياضيات", "جبر", "هندسة"], periods: 6, priority: 2, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "english", name: "اللغة الإنجليزية", code: "إنجليزي", aliases: ["انجليزي", "English"], periods: 5, priority: 3, category: "LANG" },
  { id: "science", name: "العلوم", code: "علوم", aliases: ["علوم"], periods: 4, priority: 4, category: "CORE" },
  { id: "social", name: "الدراسات الاجتماعية", code: "دراسات", aliases: ["دراسات"], periods: 4, priority: 5, category: "CORE" },
  { id: "religion", name: "التربية الدينية", code: "دين", aliases: ["دين", "تربية اسلامية"], periods: 3, priority: 6, before_break: true, category: "CORE" },
  { id: "computer", name: "الكمبيوتر وتكنولوجيا المعلومات", code: "حاسب", aliases: ["حاسب", "كمبيوتر"], periods: 2, category: "TECH" },
  { id: "art", name: "التربية الفنية", code: "فنية", aliases: ["رسم", "فنية"], periods: 2, category: "ACTIVITY" },
  { id: "pe", name: "التربية الرياضية", code: "ألعاب", aliases: ["العاب", "رياضة بدنية"], periods: 2, category: "ACTIVITY" },
]; // Sum = 8 + 6 + 5 + 4 + 4 + 3 + 2 + 2 + 2 = 36

export const PRESET_PREP_GOV_36: SchoolPreset = {
  id: "preset_prep_gov_36",
  name: "المرحلة الإعدادية — حكومي عام (نظام 36 حصة - الأحد 8 وباقي الأيام 7)",
  label: "إعدادي حكومي (36 حصة - نموذج 376)",
  school_type: "GOVERNMENT_GENERAL",
  stage: "PREPARATORY",
  shift_system: "SINGLE_SHIFT",
  description: "قيم شائعة قابلة للتعديل: الأحد 8 حصص وباقي الأيام 7 حصص (إجمالي 36 حصة أسبوعياً لكل فصل).",
  days: [0, 1, 2, 3, 4],
  shifts: [prepGovShift36],
  grades: [
    { grade_number: 1, name: "الصف الأول الإعدادي", code: "G1", shift_name: "فترة الإعدادي 36 حصة", subjects: prepGovSubjects36, weekly_total: 36 },
    { grade_number: 2, name: "الصف الثاني الإعدادي", code: "G2", shift_name: "فترة الإعدادي 36 حصة", subjects: prepGovSubjects36, weekly_total: 36 },
    { grade_number: 3, name: "الصف الثالث الإعدادي", code: "G3", shift_name: "فترة الإعدادي 36 حصة", subjects: prepGovSubjects36, weekly_total: 36 },
  ],
  rules: { break_after_period: 4, max_consecutive_same: 2 },
};

// ---------------------------------------------------------------------------
// 6. Preparatory: Experimental Language (تجريبي لغات - 35 حصة)
// ---------------------------------------------------------------------------
const prepLangSubjects35: PresetSubject[] = [
  { id: "arabic", name: "اللغة العربية", code: "عربي", aliases: ["عربي", "لغة عربية"], periods: 6, priority: 1, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "math", name: "Mathematics (جبر وهندسة لغات)", code: "Math", aliases: ["Math", "Mathematics", "رياضيات لغات"], periods: 6, priority: 2, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "english", name: "English Advanced Level (مستوى رفيع)", code: "AL", aliases: ["English AL", "مستوى رفيع انجليزي", "Advanced Level"], periods: 5, priority: 3, category: "LANG" },
  { id: "science", name: "Science (العلوم بالإنجليزية)", code: "Science", aliases: ["Science", "ساينس"], periods: 4, priority: 4, category: "CORE" },
  { id: "social", name: "الدراسات الاجتماعية", code: "دراسات", aliases: ["دراسات"], periods: 4, priority: 5, category: "CORE" },
  { id: "second_lang", name: "اللغة الأجنبية الثانية (French / German)", code: "لغة ثانية", aliases: ["فرنساوي", "ألماني", "لغة ثانية", "French", "German"], periods: 3, priority: 6, category: "LANG" },
  { id: "religion", name: "التربية الدينية", code: "دين", aliases: ["دين", "تربية اسلامية"], periods: 2, priority: 7, before_break: true, category: "CORE" },
  { id: "computer", name: "Computer & Information Tech", code: "Computer", aliases: ["كمبيوتر", "حاسب", "Computer"], periods: 2, category: "TECH" },
  { id: "art", name: "التربية الفنية", code: "Art", aliases: ["رسم", "Art", "فنية"], periods: 2, category: "ACTIVITY" },
  { id: "pe", name: "التربية الرياضية", code: "PE", aliases: ["العاب", "PE"], periods: 1, category: "ACTIVITY" },
]; // Sum = 6 + 6 + 5 + 4 + 4 + 3 + 2 + 2 + 2 + 1 = 35

export const PRESET_PREP_LANG_35: SchoolPreset = {
  id: "preset_prep_lang_35",
  name: "المرحلة الإعدادية — تجريبي رسمي لغات (فترة واحدة - 35 حصة)",
  label: "إعدادي تجريبي لغات (35 حصة)",
  school_type: "EXPERIMENTAL_LANGUAGE",
  stage: "PREPARATORY",
  shift_system: "SINGLE_SHIFT",
  description: "قيم شائعة قابلة للتعديل للمدارس الإعدادية للغات: تدريس Math و Science بالإنجليزية، ولغة ثانية (فرنسي/ألماني 3 حصص)، وإنجليزي متقدم.",
  days: [0, 1, 2, 3, 4],
  shifts: [prepGovSingleShift],
  grades: [
    { grade_number: 1, name: "الصف الأول الإعدادي لغات", code: "G1", shift_name: "الفترة الكاملة (إعدادي 35)", subjects: prepLangSubjects35, weekly_total: 35 },
    { grade_number: 2, name: "الصف الثاني الإعدادي لغات", code: "G2", shift_name: "الفترة الكاملة (إعدادي 35)", subjects: prepLangSubjects35, weekly_total: 35 },
    { grade_number: 3, name: "الصف الثالث الإعدادي لغات", code: "G3", shift_name: "الفترة الكاملة (إعدادي 35)", subjects: prepLangSubjects35, weekly_total: 35 },
  ],
  rules: { break_after_period: 3, max_consecutive_same: 2 },
};

// ---------------------------------------------------------------------------
// 7. Secondary: Government General (نظام 35 حصة / 7 حصص يومياً)
// ---------------------------------------------------------------------------
const secGovShift35: PresetShift = {
  name: "فترة الثانوي العام",
  days: [0, 1, 2, 3, 4],
  periods_by_day: { "0": 7, "1": 7, "2": 7, "3": 7, "4": 7 },
  weekly_capacity: 35,
};

const secGovSubjects35: PresetSubject[] = [
  { id: "arabic", name: "اللغة العربية", code: "عربي", aliases: ["عربي", "لغة عربية"], periods: 7, priority: 1, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "english", name: "اللغة الأجنبية الأولى (الإنجليزية)", code: "إنجليزي", aliases: ["انجليزي", "English"], periods: 6, priority: 2, category: "LANG" },
  { id: "second_lang", name: "اللغة الأجنبية الثانية (فرنسي/ألماني/إيطالي)", code: "لغة ثانية", aliases: ["فرنساوي", "ألماني", "إيطالي", "لغة ثانية"], periods: 4, priority: 3, category: "LANG" },
  { id: "math", name: "الرياضيات البحتة والتطبيقية", code: "رياضيات", aliases: ["رياضيات", "ميكانيكا", "جبر وتفاضل"], periods: 7, priority: 4, double_policy: "PREFER_DOUBLE", category: "CORE" },
  { id: "science_integrated", name: "العلوم المتكاملة / الفيزياء والكيمياء", code: "علوم", aliases: ["فيزياء", "كيمياء", "احياء", "علوم متكاملة"], periods: 5, priority: 5, category: "CORE" },
  { id: "humanities", name: "التاريخ والجغرافيا والفلسفة", code: "إنسانيات", aliases: ["تاريخ", "جغرافيا", "فلسفة"], periods: 4, priority: 6, category: "CORE" },
  { id: "civics_pe", name: "التربية الوطنية والتربية الرياضية", code: "وطنية وبدنية", aliases: ["وطنية", "تربية وطنية", "تربية رياضية"], periods: 2, category: "ACTIVITY" },
]; // Sum = 7 + 6 + 4 + 7 + 5 + 4 + 2 = 35

export const PRESET_SEC_GOV_35: SchoolPreset = {
  id: "preset_sec_gov_35",
  name: "المرحلة الثانوية العامة — حكومي عام (فترة واحدة - 35 حصة)",
  label: "ثانوي عام حكومي (35 حصة)",
  school_type: "GOVERNMENT_GENERAL",
  stage: "SECONDARY",
  shift_system: "SINGLE_SHIFT",
  description: "قيم شائعة قابلة للتعديل للمرحلة الثانوية: 7 حصص يومياً (35 حصة)، تشمل اللغتين الأولى والثانية والرياضيات والعلوم المتكاملة.",
  days: [0, 1, 2, 3, 4],
  shifts: [secGovShift35],
  grades: [
    { grade_number: 1, name: "الصف الأول الثانوي", code: "S1", shift_name: "فترة الثانوي العام", subjects: secGovSubjects35, weekly_total: 35 },
    { grade_number: 2, name: "الصف الثاني الثانوي", code: "S2", shift_name: "فترة الثانوي العام", subjects: secGovSubjects35, weekly_total: 35 },
    { grade_number: 3, name: "الصف الثالث الثانوي", code: "S3", shift_name: "فترة الثانوي العام", subjects: secGovSubjects35, weekly_total: 35 },
  ],
  rules: { break_after_period: 3, max_consecutive_same: 2 },
};

// ---------------------------------------------------------------------------
// All Available Presets Catalog
// ---------------------------------------------------------------------------
export const ALL_SCHOOL_PRESETS: SchoolPreset[] = [
  PRESET_PRIMARY_GOV_SINGLE,
  PRESET_PRIMARY_GOV_TWO_SHIFTS,
  PRESET_PRIMARY_LANG_SINGLE,
  PRESET_PREP_GOV_35,
  PRESET_PREP_GOV_36,
  PRESET_PREP_LANG_35,
  PRESET_SEC_GOV_35,
];

export function getPresetById(id: string): SchoolPreset | undefined {
  return ALL_SCHOOL_PRESETS.find((p) => p.id === id);
}

/**
 * Creates a fully validated, anonymous SchoolData structure from a preset.
 * Contains ZERO personal data: teachers are generic placeholders (e.g. "معلم رياضيات (G1-1)").
 */
export function createSchoolFromPreset(
  presetId: string,
  options?: {
    schoolName?: string;
    sectionsPerGrade?: number;
  }
): SchoolData {
  const preset = getPresetById(presetId);
  if (!preset) {
    throw new Error(`Preset not found: ${presetId}`);
  }

  const sectionsCount = options?.sectionsPerGrade || 1;
  const schoolName = options?.schoolName || `${preset.label} (نموذج افتراضي)`;

  const grades: Grade[] = preset.grades.map((g) => ({
    id: `grade_${g.grade_number}`,
    name: g.name,
    code: g.code,
    order: g.grade_number,
  }));

  const sections: Section[] = [];
  preset.grades.forEach((g) => {
    const shift =
      g.shift_name.includes("ثانية") || g.shift_name.includes("مسائي")
        ? "SECOND"
        : "FIRST";
    for (let s = 1; s <= sectionsCount; s++) {
      const sectionName =
        sectionsCount === 1 ? `${g.name}` : `${g.name} (${s})`;
      const sectionCode =
        sectionsCount === 1 ? `${g.code}` : `${g.code}/${s}`;
      sections.push({
        id: `sec_${g.grade_number}_${s}`,
        grade_id: `grade_${g.grade_number}`,
        name: sectionName,
        code: sectionCode,
        shift: shift as "FIRST" | "SECOND",
      });
    }
  });

  const subjectMap = new Map<string, Subject>();
  preset.grades.forEach((g) => {
    g.subjects.forEach((s) => {
      if (!subjectMap.has(s.id)) {
        subjectMap.set(s.id, {
          id: s.id,
          name: s.name,
          code: s.code,
          priority: s.priority,
          before_break: s.before_break,
          double_period_policy:
            s.double_policy === "DOUBLE_REQUIRED"
              ? "DOUBLE_REQUIRED"
              : s.double_policy === "SINGLE_ONLY"
              ? "SINGLE_ONLY"
              : "FREE",
        });
      }
    });
  });
  const subjects = Array.from(subjectMap.values());

  const teachers: Teacher[] = [];
  const assignments: TeachingAssignment[] = [];

  preset.grades.forEach((g) => {
    const gradeSections = sections.filter(
      (s) => s.grade_id === `grade_${g.grade_number}`
    );
    g.subjects.forEach((subj) => {
      gradeSections.forEach((sec, idx) => {
        const teacherName = `معلم ${subj.name} (${g.code}-${idx + 1})`;
        const teacherId = `tch_${subj.id}_${g.grade_number}_${idx + 1}`;
        if (!teachers.some((t) => t.id === teacherId)) {
          teachers.push({
            id: teacherId,
            name: teacherName,
            code: `م-${subj.code}${idx + 1}`,
            max_daily_periods: 7,
            max_weekly_periods: 24,
          });
        }
        assignments.push({
          id: `asgn_${sec.id}_${subj.id}`,
          section_id: sec.id,
          subject_id: subj.id,
          teacher_id: teacherId,
          weekly_periods: subj.periods,
          priority: subj.priority,
        });
      });
    });
  });

  const maxDaily = Math.max(
    ...preset.shifts.flatMap((s) => Object.values(s.periods_by_day)),
    7
  );

  return {
    id: `school_${preset.id}`,
    name: schoolName,
    academic_year: "2026/2027",
    shift_mode: preset.shift_system === "TWO_SHIFTS" ? "TWO_SHIFTS" : "SINGLE",
    days: preset.days,
    periods_per_day: maxDaily,
    grades,
    sections,
    subjects,
    teachers,
    availabilities: [],
    assignments,
    pinned_entries: [],
    rules: {
      break_after_period: preset.rules.break_after_period || 3,
      max_consecutive_same_teacher_section:
        preset.rules.max_consecutive_same || 2,
      no_section_gaps: true,
      minimize_teacher_gaps: true,
    },
    metadata: {
      preset_id: preset.id,
      school_type: preset.school_type,
      stage: preset.stage,
      description: preset.description,
      is_preset: true,
    },
  };
}


// ---------------------------------------------------------------------------
// Interactive Stage & Education Type Subject Catalog (عام / لغات / أزهر)
// Updated from official MOE Egypt & Al-Azhar Al-Sharif curricula
// ---------------------------------------------------------------------------
export type CatalogStage = "PRIMARY" | "PREPARATORY" | "SECONDARY";
export type CatalogEduType = "GENERAL" | "LANGUAGE" | "AZHAR";

export interface CatalogSubjectItem {
  id: string;
  name: string;
  code: string;
  defaultPeriods: number;
  before_break?: boolean;
  double_policy?: "FREE" | "DOUBLE_REQUIRED" | "SINGLE_ONLY" | "PREFER_DOUBLE";
  category: "CORE" | "LANG" | "ACTIVITY" | "TECH" | "SHARIA";
  gradeHint?: string;
  aliases?: string[];
}

export const STAGE_LABELS_AR: Record<CatalogStage, string> = {
  PRIMARY: "المرحلة الابتدائية",
  PREPARATORY: "المرحلة الإعدادية",
  SECONDARY: "المرحلة الثانوية",
};

export const EDU_TYPE_LABELS_AR: Record<CatalogEduType, string> = {
  GENERAL: "عام",
  LANGUAGE: "لغات",
  AZHAR: "أزهر",
};

const CATALOG_MAP: Record<CatalogStage, Record<CatalogEduType, CatalogSubjectItem[]>> = {
  PRIMARY: {
    GENERAL: [
      { id: "arabic", name: "اللغة العربية", code: "عربي", defaultPeriods: 9, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "math", name: "الرياضيات", code: "رياضيات", defaultPeriods: 6, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "english", name: "اللغة الإنجليزية", code: "إنجليزي", defaultPeriods: 4, category: "LANG" },
      { id: "religion", name: "التربية الدينية", code: "دين", defaultPeriods: 4, before_break: true, category: "CORE" },
      { id: "multidisciplinary", name: "متعدد التخصصات (اكتشف)", code: "اكتشف", defaultPeriods: 3, category: "CORE", gradeHint: "صفوف 1-3" },
      { id: "values", name: "القيم واحترام الآخر", code: "قيم", defaultPeriods: 1, category: "ACTIVITY", gradeHint: "صفوف 1-3" },
      { id: "science", name: "العلوم", code: "علوم", defaultPeriods: 3, category: "CORE", gradeHint: "صفوف 4-6" },
      { id: "social", name: "الدراسات الاجتماعية", code: "دراسات", defaultPeriods: 3, category: "CORE", gradeHint: "صفوف 4-6" },
      { id: "ict", name: "تكنولوجيا المعلومات والاتصالات (ICT)", code: "ICT", defaultPeriods: 1, category: "TECH", gradeHint: "صفوف 4-6" },
      { id: "skills", name: "المهارات المهنية", code: "مهارات", defaultPeriods: 1, category: "TECH", gradeHint: "صفوف 4-6" },
      { id: "tokkatsu", name: "أنشطة التوكاتسو", code: "توكاتسو", defaultPeriods: 1, category: "ACTIVITY" },
      { id: "art", name: "التربية الفنية", code: "فنية", defaultPeriods: 1, category: "ACTIVITY" },
      { id: "music", name: "التربية الموسيقية", code: "موسيقى", defaultPeriods: 1, category: "ACTIVITY" },
      { id: "pe", name: "التربية البدنية والصحية", code: "بدنية", defaultPeriods: 2, category: "ACTIVITY" },
    ],
    LANGUAGE: [
      { id: "arabic", name: "اللغة العربية", code: "عربي", defaultPeriods: 7, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "math", name: "Mathematics (الرياضيات بالإنجليزية)", code: "Math", defaultPeriods: 6, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "english", name: "اللغة الإنجليزية (Connect)", code: "Connect", defaultPeriods: 4, category: "LANG" },
      { id: "connect_plus", name: "English Connect Plus (مستوى رفيع)", code: "Connect+", defaultPeriods: 3, category: "LANG" },
      { id: "religion", name: "التربية الدينية", code: "دين", defaultPeriods: 3, before_break: true, category: "CORE" },
      { id: "discover", name: "متعدد التخصصات (Discover)", code: "Discover", defaultPeriods: 3, category: "CORE", gradeHint: "صفوف 1-3" },
      { id: "values", name: "القيم واحترام الآخر", code: "قيم", defaultPeriods: 1, category: "ACTIVITY", gradeHint: "صفوف 1-3" },
      { id: "science", name: "Science (العلوم بالإنجليزية)", code: "Science", defaultPeriods: 4, category: "CORE", gradeHint: "صفوف 4-6" },
      { id: "social", name: "الدراسات الاجتماعية", code: "دراسات", defaultPeriods: 3, category: "CORE", gradeHint: "صفوف 4-6" },
      { id: "ict", name: "تكنولوجيا المعلومات والاتصالات (ICT)", code: "ICT", defaultPeriods: 1, category: "TECH", gradeHint: "صفوف 4-6" },
      { id: "skills", name: "المهارات المهنية", code: "مهارات", defaultPeriods: 1, category: "TECH", gradeHint: "صفوف 4-6" },
      { id: "second_lang", name: "لغة أجنبية ثانية (استكشافية)", code: "لغة ثانية", defaultPeriods: 1, category: "LANG" },
      { id: "tokkatsu", name: "أنشطة التوكاتسو", code: "توكاتسو", defaultPeriods: 1, category: "ACTIVITY" },
      { id: "art", name: "التربية الفنية (Art)", code: "Art", defaultPeriods: 1, category: "ACTIVITY" },
      { id: "music", name: "التربية الموسيقية", code: "موسيقى", defaultPeriods: 1, category: "ACTIVITY" },
      { id: "pe", name: "التربية البدنية والصحية (PE)", code: "PE", defaultPeriods: 2, category: "ACTIVITY" },
    ],
    AZHAR: [
      { id: "quran", name: "القرآن الكريم وتجويده", code: "قرآن", defaultPeriods: 6, before_break: true, category: "SHARIA" },
      { id: "islamic_studies", name: "التربية الإسلامية", code: "تربية إسلامية", defaultPeriods: 4, before_break: true, category: "SHARIA" },
      { id: "arabic", name: "اللغة العربية والخط العربي", code: "عربي", defaultPeriods: 8, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "math", name: "الرياضيات", code: "رياضيات", defaultPeriods: 6, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "english", name: "اللغة الإنجليزية", code: "إنجليزي", defaultPeriods: 4, category: "LANG" },
      { id: "english_al", name: "المستوى الرفيع إنجليزي", code: "مستوى رفيع", defaultPeriods: 2, category: "LANG", gradeHint: "نموذجي" },
      { id: "multidisciplinary", name: "متعدد التخصصات (اكتشف)", code: "اكتشف", defaultPeriods: 3, category: "CORE", gradeHint: "صفوف 1-3" },
      { id: "values", name: "القيم واحترام الآخر", code: "قيم", defaultPeriods: 1, category: "ACTIVITY", gradeHint: "صفوف 1-3" },
      { id: "science", name: "العلوم", code: "علوم", defaultPeriods: 3, category: "CORE", gradeHint: "صفوف 4-6" },
      { id: "social", name: "الدراسات الاجتماعية", code: "دراسات", defaultPeriods: 2, category: "CORE", gradeHint: "صفوف 4-6" },
      { id: "ict", name: "تكنولوجيا المعلومات (ICT) / الحاسب الآلي", code: "حاسب", defaultPeriods: 1, category: "TECH" },
      { id: "art", name: "التربية الفنية", code: "فنية", defaultPeriods: 1, category: "ACTIVITY" },
      { id: "pe", name: "التربية الرياضية", code: "رياضية", defaultPeriods: 1, category: "ACTIVITY" },
    ],
  },
  PREPARATORY: {
    GENERAL: [
      { id: "arabic", name: "اللغة العربية والخط العربي", code: "عربي", defaultPeriods: 8, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "math", name: "الرياضيات (جبر وهندسة وإحصاء)", code: "رياضيات", defaultPeriods: 6, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "english", name: "اللغة الإنجليزية", code: "إنجليزي", defaultPeriods: 5, category: "LANG" },
      { id: "science", name: "العلوم", code: "علوم", defaultPeriods: 4, category: "CORE" },
      { id: "social", name: "الدراسات الاجتماعية (تاريخ وجغرافيا)", code: "دراسات", defaultPeriods: 4, category: "CORE" },
      { id: "religion", name: "التربية الدينية", code: "دين", defaultPeriods: 3, before_break: true, category: "CORE" },
      { id: "computer", name: "الكمبيوتر وتكنولوجيا المعلومات (ICT)", code: "حاسب", defaultPeriods: 2, category: "TECH" },
      { id: "art", name: "التربية الفنية (الرسم)", code: "فنية", defaultPeriods: 2, category: "ACTIVITY" },
      { id: "pe", name: "التربية الرياضية", code: "رياضية", defaultPeriods: 1, category: "ACTIVITY" },
      { id: "activities", name: "الأنشطة والمجالات", code: "نشاط", defaultPeriods: 1, category: "ACTIVITY" },
    ],
    LANGUAGE: [
      { id: "arabic", name: "اللغة العربية والخط العربي", code: "عربي", defaultPeriods: 6, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "math", name: "Mathematics (جبر وهندسة لغات)", code: "Math", defaultPeriods: 6, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "english", name: "اللغة الإنجليزية (الأولى)", code: "English", defaultPeriods: 4, category: "LANG" },
      { id: "english_al", name: "English Advanced Level (المستوى الرفيع)", code: "AL", defaultPeriods: 3, category: "LANG" },
      { id: "science", name: "Science (العلوم بالإنجليزية)", code: "Science", defaultPeriods: 4, category: "CORE" },
      { id: "social", name: "الدراسات الاجتماعية", code: "دراسات", defaultPeriods: 4, category: "CORE" },
      { id: "second_lang", name: "اللغة الأجنبية الثانية (فرنسي/ألماني)", code: "لغة ثانية", defaultPeriods: 3, category: "LANG" },
      { id: "religion", name: "التربية الدينية", code: "دين", defaultPeriods: 2, before_break: true, category: "CORE" },
      { id: "computer", name: "Computer & ICT", code: "ICT", defaultPeriods: 2, category: "TECH" },
      { id: "art", name: "التربية الفنية (Art)", code: "Art", defaultPeriods: 2, category: "ACTIVITY" },
      { id: "pe", name: "التربية الرياضية (PE)", code: "PE", defaultPeriods: 1, category: "ACTIVITY" },
    ],
    AZHAR: [
      { id: "quran", name: "القرآن الكريم وتجويده", code: "قرآن", defaultPeriods: 4, before_break: true, category: "SHARIA" },
      { id: "fiqh", name: "الفقه (حنفي / شافعي / مالكي)", code: "فقه", defaultPeriods: 3, category: "SHARIA" },
      { id: "tafsir_hadith", name: "أصول الدين (التفسير والحديث)", code: "تفسير وحديث", defaultPeriods: 3, category: "SHARIA" },
      { id: "tawhid_sirah", name: "أصول الدين (التوحيد والسيرة النبوية)", code: "توحيد وسيرة", defaultPeriods: 2, category: "SHARIA" },
      { id: "islamic_culture", name: "الثقافة الإسلامية", code: "ثقافة إسلامية", defaultPeriods: 1, category: "SHARIA", gradeHint: "3 إعدادي" },
      { id: "nahw_sarf", name: "النحو والصرف", code: "نحو وصرف", defaultPeriods: 4, category: "CORE" },
      { id: "mutalaa_nusus", name: "المطالعة والنصوص والإنشاء والخط", code: "مطالعة ونصوص", defaultPeriods: 3, category: "CORE" },
      { id: "math", name: "الرياضيات (جبر وهندسة)", code: "رياضيات", defaultPeriods: 5, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "science", name: "العلوم", code: "علوم", defaultPeriods: 3, category: "CORE" },
      { id: "social", name: "الدراسات الاجتماعية", code: "دراسات", defaultPeriods: 3, category: "CORE" },
      { id: "english", name: "اللغة الإنجليزية", code: "إنجليزي", defaultPeriods: 4, category: "LANG" },
      { id: "english_al", name: "المستوى الرفيع إنجليزي", code: "مستوى رفيع", defaultPeriods: 2, category: "LANG", gradeHint: "نموذجي" },
      { id: "computer", name: "الحاسب الآلي", code: "حاسب", defaultPeriods: 1, category: "TECH" },
      { id: "art", name: "التربية الفنية والرياضية", code: "فنية ورياضية", defaultPeriods: 1, category: "ACTIVITY" },
    ],
  },
  SECONDARY: {
    GENERAL: [
      { id: "arabic", name: "اللغة العربية", code: "عربي", defaultPeriods: 6, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "english", name: "اللغة الأجنبية الأولى (الإنجليزية)", code: "إنجليزي", defaultPeriods: 5, category: "LANG" },
      { id: "second_lang", name: "اللغة الأجنبية الثانية", code: "لغة ثانية", defaultPeriods: 2, category: "LANG" },
      { id: "math", name: "الرياضيات (البحتة والتطبيقية)", code: "رياضيات", defaultPeriods: 6, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "integrated_science", name: "العلوم المتكاملة", code: "علوم متكاملة", defaultPeriods: 4, category: "CORE", gradeHint: "1 ثانوي" },
      { id: "physics", name: "الفيزياء", code: "فيزياء", defaultPeriods: 3, category: "CORE", gradeHint: "علمي 2-3" },
      { id: "chemistry", name: "الكيمياء", code: "كيمياء", defaultPeriods: 3, category: "CORE", gradeHint: "علمي 2-3" },
      { id: "biology", name: "الأحياء", code: "أحياء", defaultPeriods: 3, category: "CORE", gradeHint: "علمي علوم" },
      { id: "geology", name: "الجيولوجيا وعلوم البيئة", code: "جيولوجيا", defaultPeriods: 2, category: "CORE", gradeHint: "3 علمي علوم" },
      { id: "history", name: "التاريخ", code: "تاريخ", defaultPeriods: 2, category: "CORE" },
      { id: "geography", name: "الجغرافيا", code: "جغرافيا", defaultPeriods: 2, category: "CORE", gradeHint: "أدبي 2-3" },
      { id: "philosophy", name: "الفلسفة والمنطق", code: "فلسفة", defaultPeriods: 2, category: "CORE", gradeHint: "1 ثانوي" },
      { id: "psychology", name: "علم النفس والاجتماع", code: "علم نفس", defaultPeriods: 2, category: "CORE", gradeHint: "أدبي 2-3" },
      { id: "statistics", name: "الإحصاء", code: "إحصاء", defaultPeriods: 2, category: "CORE", gradeHint: "أدبي 3" },
      { id: "religion", name: "التربية الدينية", code: "دين", defaultPeriods: 2, before_break: true, category: "CORE" },
      { id: "civics", name: "التربية الوطنية", code: "وطنية", defaultPeriods: 1, category: "ACTIVITY" },
      { id: "computer", name: "الحاسب الآلي وتكنولوجيا المعلومات", code: "حاسب", defaultPeriods: 1, category: "TECH" },
      { id: "pe", name: "التربية الرياضية", code: "رياضية", defaultPeriods: 1, category: "ACTIVITY" },
    ],
    LANGUAGE: [
      { id: "arabic", name: "اللغة العربية", code: "عربي", defaultPeriods: 5, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "english", name: "English (اللغة الأجنبية الأولى)", code: "English", defaultPeriods: 5, category: "LANG" },
      { id: "english_al", name: "English Advanced Level (المستوى الرفيع)", code: "AL", defaultPeriods: 2, category: "LANG" },
      { id: "second_lang", name: "اللغة الأجنبية الثانية (French / German)", code: "لغة ثانية", defaultPeriods: 2, category: "LANG" },
      { id: "math", name: "Pure & Applied Mathematics", code: "Math", defaultPeriods: 6, double_policy: "PREFER_DOUBLE", category: "CORE" },
      { id: "integrated_science", name: "Integrated Sciences (العلوم المتكاملة)", code: "Integrated", defaultPeriods: 4, category: "CORE", gradeHint: "1 ثانوي" },
      { id: "physics", name: "Physics (الفيزياء لغات)", code: "Physics", defaultPeriods: 3, category: "CORE", gradeHint: "علمي 2-3" },
      { id: "chemistry", name: "Chemistry (الكيمياء لغات)", code: "Chemistry", defaultPeriods: 3, category: "CORE", gradeHint: "علمي 2-3" },
      { id: "biology", name: "Biology (الأحياء لغات)", code: "Biology", defaultPeriods: 3, category: "CORE", gradeHint: "علمي علوم" },
      { id: "geology", name: "Geology & Environmental Science", code: "Geology", defaultPeriods: 2, category: "CORE", gradeHint: "3 علمي علوم" },
      { id: "history", name: "التاريخ", code: "تاريخ", defaultPeriods: 2, category: "CORE" },
      { id: "geography", name: "الجغرافيا", code: "جغرافيا", defaultPeriods: 2, category: "CORE", gradeHint: "أدبي 2-3" },
      { id: "philosophy", name: "الفلسفة والمنطق", code: "فلسفة", defaultPeriods: 2, category: "CORE", gradeHint: "1 ثانوي" },
      { id: "psychology", name: "علم النفس والاجتماع", code: "علم نفس", defaultPeriods: 2, category: "CORE", gradeHint: "أدبي 2-3" },
      { id: "statistics", name: "Statistics (الإحصاء لغات)", code: "Statistics", defaultPeriods: 2, category: "CORE", gradeHint: "أدبي 3" },
      { id: "religion", name: "التربية الدينية", code: "دين", defaultPeriods: 2, before_break: true, category: "CORE" },
      { id: "civics", name: "التربية الوطنية", code: "وطنية", defaultPeriods: 1, category: "ACTIVITY" },
      { id: "computer", name: "Computer Science / ICT", code: "CS", defaultPeriods: 1, category: "TECH" },
      { id: "pe", name: "التربية الرياضية (PE)", code: "PE", defaultPeriods: 1, category: "ACTIVITY" },
    ],
    AZHAR: [
      { id: "quran", name: "القرآن الكريم وتجويده", code: "قرآن", defaultPeriods: 3, before_break: true, category: "SHARIA" },
      { id: "fiqh", name: "الفقه (حنفي / شافعي / مالكي)", code: "فقه", defaultPeriods: 3, category: "SHARIA" },
      { id: "tafsir", name: "التفسير وعلوم القرآن", code: "تفسير", defaultPeriods: 2, category: "SHARIA" },
      { id: "hadith", name: "الحديث وعلومه", code: "حديث", defaultPeriods: 2, category: "SHARIA" },
      { id: "tawhid", name: "التوحيد والعقيدة", code: "توحيد", defaultPeriods: 2, category: "SHARIA" },
      { id: "islamic_culture", name: "الثقافة الإسلامية / الفرائض والمواريث", code: "ثقافة ومواريث", defaultPeriods: 1, category: "SHARIA" },
      { id: "nahw", name: "النحو", code: "نحو", defaultPeriods: 3, category: "CORE" },
      { id: "sarf", name: "الصرف", code: "صرف", defaultPeriods: 2, category: "CORE" },
      { id: "balagha", name: "البلاغة", code: "بلاغة", defaultPeriods: 2, category: "CORE" },
      { id: "adab_nusus", name: "الأدب والنصوص والمطالعة والإنشاء", code: "أدب ونصوص", defaultPeriods: 3, category: "CORE" },
      { id: "arud", name: "العروض والقافية", code: "عروض", defaultPeriods: 1, category: "CORE" },
      { id: "english", name: "اللغة الأجنبية الأولى (الإنجليزية)", code: "إنجليزي", defaultPeriods: 4, category: "LANG" },
      { id: "second_lang", name: "اللغة الأجنبية الثانية (الفرنسية)", code: "فرنسية", defaultPeriods: 2, category: "LANG" },
      { id: "english_al", name: "المستوى الرفيع", code: "مستوى رفيع", defaultPeriods: 2, category: "LANG", gradeHint: "نموذجي" },
      { id: "math", name: "الرياضيات البحتة والتطبيقية", code: "رياضيات", defaultPeriods: 4, category: "CORE", gradeHint: "علمي" },
      { id: "physics", name: "الفيزياء", code: "فيزياء", defaultPeriods: 2, category: "CORE", gradeHint: "علمي" },
      { id: "chemistry", name: "الكيمياء", code: "كيمياء", defaultPeriods: 2, category: "CORE", gradeHint: "علمي" },
      { id: "biology", name: "الأحياء", code: "أحياء", defaultPeriods: 2, category: "CORE", gradeHint: "علمي" },
      { id: "history", name: "التاريخ", code: "تاريخ", defaultPeriods: 2, category: "CORE", gradeHint: "أدبي" },
      { id: "geography", name: "الجغرافيا", code: "جغرافيا", defaultPeriods: 2, category: "CORE", gradeHint: "أدبي" },
      { id: "philosophy_logic", name: "الفلسفة والمنطق", code: "فلسفة ومنطق", defaultPeriods: 2, category: "CORE" },
      { id: "computer", name: "الحاسب الآلي", code: "حاسب", defaultPeriods: 1, category: "TECH" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Unified Subject Alias & Canonical Matching Engine
// Links prompt-extracted subjects, manual additions, catalog & chat queries.
// ---------------------------------------------------------------------------
export const SUBJECT_SYNONYM_GROUPS: Array<{ group: string; aliases: string[] }> = [
  { group: "pe", aliases: ["تربية رياضية", "تربية بدنية", "تربية بدنية وصحية", "العاب", "ألعاب", "رياضة بدنية", "بدنية", "pe", "التربية الرياضية", "التربية البدنية والصحية", "التربية الرياضية والبدنية", "التربية الفنية والرياضية"] },
  { group: "art", aliases: ["تربية فنية", "التربية الفنية", "رسم", "الرسم", "فنية", "فنون", "art", "التربية الفنية (الرسم)", "التربية الفنية (Art)"] },
  { group: "music", aliases: ["موسيقى", "موسيقي", "تربية موسيقية", "التربية الموسيقية", "music"] },
  { group: "connect_plus", aliases: ["connect plus", "connect+", "كونكت بلس", "english connect plus"] },
  { group: "english_al", aliases: ["مستوى رفيع", "مستوى رفيع انجليزي", "المستوى الرفيع", "المستوى الرفيع إنجليزي", "english advanced level", "advanced level", "al"] },
  { group: "english", aliases: ["لغة انجليزية", "اللغة الإنجليزية", "انجليزي", "انجلش", "اللغة الأجنبية الأولى", "لغة اجنبية اولى", "english", "connect", "اللغة الإنجليزية (Connect)", "اللغة الإنجليزية (الأولى)"] },
  { group: "second_lang", aliases: ["لغة اجنبية ثانية", "اللغة الأجنبية الثانية", "لغة ثانية", "فرنساوي", "فرنسي", "الفرنسية", "ألماني", "الماني", "ايطالي", "اسباني", "french", "german", "second language"] },
  { group: "arabic", aliases: ["لغة عربية", "اللغة العربية", "عربي", "عربى", "اللغة العربية والخط العربي", "لغه عربيه", "arabic"] },
  { group: "math", aliases: ["رياضيات", "الرياضيات", "رياضة", "حساب", "جبر", "هندسة", "جبر وهندسة", "جبر وهندسة وإحصاء", "رياضيات بحتة", "رياضيات تطبيقية", "البحتة والتطبيقية", "ماث", "math", "mathematics", "pure & applied mathematics"] },
  { group: "integrated_science", aliases: ["العلوم المتكاملة", "علوم متكاملة", "integrated sciences", "integrated science", "integrated"] },
  { group: "science", aliases: ["علوم", "العلوم", "ساينس", "science"] },
  { group: "physics", aliases: ["فيزياء", "الفيزياء", "فيزيا", "physics"] },
  { group: "chemistry", aliases: ["كيمياء", "الكيمياء", "كيميا", "chemistry"] },
  { group: "biology", aliases: ["احياء", "الأحياء", "أحياء", "biology"] },
  { group: "geology", aliases: ["جيولوجيا", "الجيولوجيا", "الجيولوجيا وعلوم البيئة", "علوم البيئة", "geology", "geology & environmental science"] },
  { group: "social", aliases: ["دراسات", "الدراسات", "دراسات اجتماعية", "الدراسات الاجتماعية", "اجتماعيات", "social studies", "social"] },
  { group: "history", aliases: ["تاريخ", "التاريخ", "history"] },
  { group: "geography", aliases: ["جغرافيا", "الجغرافيا", "geography"] },
  { group: "philosophy_logic", aliases: ["فلسفة", "الفلسفة", "فلسفة ومنطق", "الفلسفة والمنطق", "منطق", "المنطق", "philosophy", "logic"] },
  { group: "psychology", aliases: ["علم نفس", "علم النفس", "علم النفس والاجتماع", "علم نفس واجتماع", "psychology"] },
  { group: "statistics", aliases: ["احصاء", "إحصاء", "الإحصاء", "statistics"] },
  { group: "civics", aliases: ["تربية وطنية", "التربية الوطنية", "وطنية", "civics"] },
  { group: "religion", aliases: ["تربية دينية", "التربية الدينية", "دين", "الدين", "دين اسلامي", "دين مسيحي", "تربية إسلامية", "التربية الإسلامية", "islamic studies", "religion"] },
  { group: "quran", aliases: ["قران", "قرآن", "قرآن كريم", "القرآن الكريم", "القرآن الكريم وتجويده", "تجويد", "quran"] },
  { group: "fiqh", aliases: ["فقه", "الفقه", "فقه حنفي", "فقه شافعي", "فقه مالكي", "fiqh"] },
  { group: "tafsir_hadith", aliases: ["تفسير وحديث", "التفسير والحديث", "أصول الدين (التفسير والحديث)"] },
  { group: "tawhid_sirah", aliases: ["توحيد وسيرة", "التوحيد والسيرة", "التوحيد والسيرة النبوية", "سيرة", "أصول الدين (التوحيد والسيرة النبوية)"] },
  { group: "tafsir", aliases: ["تفسير", "التفسير", "التفسير وعلوم القرآن", "tafsir"] },
  { group: "hadith", aliases: ["حديث", "الحديث", "الحديث الشريف", "الحديث وعلومه", "hadith"] },
  { group: "tawhid", aliases: ["توحيد", "التوحيد", "العقيدة", "التوحيد والعقيدة", "tawhid"] },
  { group: "islamic_culture", aliases: ["ثقافة اسلامية", "الثقافة الإسلامية", "فرائض ومواريث", "المواريث", "الثقافة الإسلامية / الفرائض والمواريث"] },
  { group: "nahw_sarf", aliases: ["نحو وصرف", "النحو والصرف"] },
  { group: "nahw", aliases: ["نحو", "النحو", "nahw"] },
  { group: "sarf", aliases: ["صرف", "الصرف", "sarf"] },
  { group: "balagha", aliases: ["بلاغة", "البلاغة", "balagha"] },
  { group: "adab_mutalaa", aliases: ["ادب ونصوص", "الأدب والنصوص", "مطالعة ونصوص", "المطالعة والنصوص والإنشاء والخط", "الأدب والنصوص والمطالعة والإنشاء", "مطالعة", "نصوص", "انشاء"] },
  { group: "arud", aliases: ["عروض", "العروض", "العروض والقافية"] },
  { group: "ict", aliases: ["حاسب", "حاسب الي", "الحاسب الآلي", "كمبيوتر", "الكمبيوتر", "تكنولوجيا المعلومات", "تكنولوجيا المعلومات والاتصالات", "ict", "computer", "computer science", "computer & ict", "الكمبيوتر وتكنولوجيا المعلومات (ICT)", "تكنولوجيا المعلومات (ICT) / الحاسب الآلي"] },
  { group: "multidisciplinary", aliases: ["متعدد التخصصات", "اكتشف", "متعدد التخصصات (اكتشف)", "متعدد التخصصات (Discover)", "discover"] },
  { group: "values", aliases: ["القيم", "القيم واحترام الآخر", "قيم واحترام الاخر"] },
  { group: "skills", aliases: ["مهارات", "المهارات المهنية", "مهارات مهنية"] },
  { group: "tokkatsu", aliases: ["توكاتسو", "أنشطة التوكاتسو", "انشطة التوكاتسو", "tokkatsu"] },
  { group: "activities", aliases: ["مجالات", "المجالات", "نشاط", "انشطة", "الأنشطة والمجالات", "أنشطة"] },
];

export function normalizeSubjectText(text: string): string {
  return String(text || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[()\[\]"'":：،,.\-–—/&+]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stripAlPrefixWords(normText: string): string {
  return normText
    .split(" ")
    .map((w) => (w.length > 3 && w.startsWith("ال") ? w.slice(2) : w))
    .join(" ");
}

function extractTrailingVariantNumber(normText: string): string | null {
  const m = normText.match(/(?:^|\s)([1-9])(?:\s|$)/);
  return m ? m[1] : null;
}

export function getSubjectSynonymGroup(nameOrCode: string): string | null {
  const norm = normalizeSubjectText(nameOrCode);
  if (!norm) return null;
  // Numbered subjects like "عربي 2" or "نشاط 1" or "نشاط 2" represent distinct school allocations
  if (/(?:عربي\s*2|نشاط\s*[12])/.test(norm)) {
    return null;
  }

  const stripped = stripAlPrefixWords(norm);
  // 1. Exact alias hit first (longest alias wins)
  const sortedEntries = SUBJECT_SYNONYM_GROUPS.flatMap((g) =>
    g.aliases.map((a) => ({
      group: g.group,
      aliasNorm: normalizeSubjectText(a),
      aliasStripped: stripAlPrefixWords(normalizeSubjectText(a)),
    }))
  ).sort((a, b) => b.aliasStripped.length - a.aliasStripped.length);

  for (const entry of sortedEntries) {
    if (norm === entry.aliasNorm || stripped === entry.aliasStripped) {
      return entry.group;
    }
  }
  // 2. Contained whole-phrase match (e.g. "Mathematics (الرياضيات بالإنجليزية)")
  const paddedNorm = ` ${norm} `;
  const paddedStripped = ` ${stripped} `;
  for (const entry of sortedEntries) {
    if (entry.aliasStripped.length < 3) continue;
    if (
      paddedNorm.includes(` ${entry.aliasNorm} `) ||
      paddedStripped.includes(` ${entry.aliasStripped} `)
    ) {
      return entry.group;
    }
  }
  return null;
}

export function subjectsMatchEquivalent(
  aNameOrCode: string,
  bNameOrCode: string,
  extraAliases?: string[]
): boolean {
  const normA = normalizeSubjectText(aNameOrCode);
  const normB = normalizeSubjectText(bNameOrCode);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const stripA = stripAlPrefixWords(normA);
  const stripB = stripAlPrefixWords(normB);
  if (stripA === stripB) return true;

  // Keep distinct numbered split subjects (e.g. "عربي2" vs "عربي", "نشاط 1" vs "نشاط 2") separate
  const numA = extractTrailingVariantNumber(normA);
  const numB = extractTrailingVariantNumber(normB);
  if (numA !== numB && (numA !== null || numB !== null)) return false;

  if (extraAliases && extraAliases.length > 0) {
    for (const al of extraAliases) {
      const nAl = normalizeSubjectText(al);
      if (normA === nAl || stripA === stripAlPrefixWords(nAl)) return true;
    }
  }

  const grpA = getSubjectSynonymGroup(aNameOrCode);
  const grpB = getSubjectSynonymGroup(bNameOrCode);
  return Boolean(grpA && grpB && grpA === grpB);
}

export function findMatchingSubjectInSchool(
  schoolSubjects: Subject[],
  messageOrQuery: string
): Subject | null {
  const msgNorm = normalizeSubjectText(messageOrQuery.replace(/\d+\s*[\/\\]\s*\d+/g, " "));
  if (!msgNorm) return null;
  const msgStripped = stripAlPrefixWords(msgNorm);
  const paddedMsg = ` ${msgNorm} `;
  const paddedMsgStripped = ` ${msgStripped} `;

  // 1. Direct match against existing school subject names / codes (longest name first)
  const byLength = [...schoolSubjects].sort((a, b) => b.name.length - a.name.length);
  for (const subj of byLength) {
    const sNorm = normalizeSubjectText(subj.name);
    const sStripped = stripAlPrefixWords(sNorm);
    if (
      (sNorm.length >= 2 && paddedMsg.includes(` ${sNorm} `)) ||
      (sStripped.length >= 2 && paddedMsgStripped.includes(` ${sStripped} `))
    ) {
      return subj;
    }
  }

  // 2. Match via unified synonym groups / aliases
  const sortedAliases = SUBJECT_SYNONYM_GROUPS.flatMap((g) =>
    g.aliases.map((a) => ({
      group: g.group,
      aliasNorm: normalizeSubjectText(a),
      aliasStripped: stripAlPrefixWords(normalizeSubjectText(a)),
    }))
  ).sort((a, b) => b.aliasStripped.length - a.aliasStripped.length);

  for (const item of sortedAliases) {
    if (
      paddedMsg.includes(` ${item.aliasNorm} `) ||
      paddedMsgStripped.includes(` ${item.aliasStripped} `)
    ) {
      const matched = schoolSubjects.find((s) => {
        const sg = getSubjectSynonymGroup(s.name) || getSubjectSynonymGroup(s.code);
        return sg === item.group;
      });
      if (matched) return matched;
    }
  }
  return null;
}

export function expandAliasInChatMessage(
  schoolSubjects: Subject[],
  message: string
): string {
  const matched = findMatchingSubjectInSchool(schoolSubjects, message);
  if (!matched) return message;
  const msgNorm = normalizeSubjectText(message);
  const subjNorm = normalizeSubjectText(matched.name);
  // If exact subject name is already present, leave untouched
  if (msgNorm.includes(subjNorm)) return message;

  const group = getSubjectSynonymGroup(matched.name) || getSubjectSynonymGroup(matched.code);
  if (!group) return message;
  const groupAliases = SUBJECT_SYNONYM_GROUPS.find((g) => g.group === group)?.aliases || [];
  const sortedAliases = [...groupAliases].sort((a, b) => b.length - a.length);
  for (const alias of sortedAliases) {
    const cleanAlias = normalizeSubjectText(alias);
    if (!cleanAlias) continue;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
    const rx = new RegExp(`(?:^|\\s)(?:ال)?${escaped}(?=\\s|$|[،.؟!])`, "i");
    if (rx.test(message)) {
      return message.replace(rx, (m) => (m.startsWith(" ") ? ` ${matched.name}` : matched.name));
    }
  }
  return message;
}

export function getSubjectsForStageAndType(
  stage: CatalogStage,
  eduType: CatalogEduType
): CatalogSubjectItem[] {
  const list = CATALOG_MAP[stage]?.[eduType] || [];
  return list.map((item) => {
    const grp = getSubjectSynonymGroup(item.name) || getSubjectSynonymGroup(item.code);
    const groupAliases = grp
      ? SUBJECT_SYNONYM_GROUPS.find((g) => g.group === grp)?.aliases || []
      : [];
    const mergedAliases = Array.from(new Set([...(item.aliases || []), ...groupAliases]));
    return { ...item, aliases: mergedAliases };
  });
}


export function buildDefaultGradesForStage(stage: CatalogStage): Grade[] {
  if (stage === "PRIMARY") {
    const names = [
      "الصف الأول الابتدائي",
      "الصف الثاني الابتدائي",
      "الصف الثالث الابتدائي",
      "الصف الرابع الابتدائي",
      "الصف الخامس الابتدائي",
      "الصف السادس الابتدائي",
    ];
    return names.map((name, i) => ({
      id: `grade_${i + 1}`,
      name,
      code: `G${i + 1}`,
      order: i + 1,
    }));
  }
  if (stage === "PREPARATORY") {
    const names = [
      "الصف الأول الإعدادي",
      "الصف الثاني الإعدادي",
      "الصف الثالث الإعدادي",
    ];
    return names.map((name, i) => ({
      id: `grade_${i + 1}`,
      name,
      code: `G${i + 1}`,
      order: i + 1,
    }));
  }
  const names = [
    "الصف الأول الثانوي",
    "الصف الثاني الثانوي",
    "الصف الثالث الثانوي",
  ];
  return names.map((name, i) => ({
    id: `grade_${i + 1}`,
    name,
    code: `S${i + 1}`,
    order: i + 1,
  }));
}


// ---------------------------------------------------------------------------
// Daily Periods Synchronization & Agent Natural-Language Period Adjustment
// ---------------------------------------------------------------------------
export function syncSchoolPeriodsPerDay(
  school: SchoolData,
  newPeriods: number,
  resetUniformLimits: boolean = false
): SchoolData {
  const oldPeriods = school.periods_per_day || 7;
  const nextP = Math.max(4, Math.min(10, Math.round(Number(newPeriods) || 7)));

  const cleanLimits = (limits?: Record<string, number>): Record<string, number> | undefined => {
    if (!limits || Object.keys(limits).length === 0) return limits;
    if (resetUniformLimits) return undefined;
    const nextLimits: Record<string, number> = {};
    for (const [k, v] of Object.entries(limits)) {
      if (v === oldPeriods || v > nextP) {
        if (v > nextP && v !== oldPeriods) nextLimits[k] = nextP;
      } else {
        nextLimits[k] = v;
      }
    }
    return Object.keys(nextLimits).length > 0 ? nextLimits : undefined;
  };

  const grades = (school.grades || []).map((g) => ({
    ...g,
    daily_period_limits: cleanLimits(g.daily_period_limits),
  }));

  const sections = (school.sections || []).map((s) => ({
    ...s,
    daily_period_limits: cleanLimits(s.daily_period_limits),
  }));

  const teachers = (school.teachers || []).map((t) => {
    if (
      t.max_daily_periods == null ||
      t.max_daily_periods === oldPeriods ||
      t.max_daily_periods > nextP
    ) {
      return { ...t, max_daily_periods: nextP };
    }
    return t;
  });

  return {
    ...school,
    periods_per_day: nextP,
    grades,
    sections,
    teachers,
  };
}

function extractDaysMentions(normText: string): number[] {
  const dayMap: Array<{ day: number; rx: RegExp }> = [
    { day: 6, rx: /(?:^|\s)(?:ال)?سبت(?:\s|$)/ },
    { day: 0, rx: /(?:^|\s)(?:ال)?احد(?:\s|$)/ },
    { day: 1, rx: /(?:^|\s)(?:ال)?(?:اثنين|اتنين)(?:\s|$)/ },
    { day: 2, rx: /(?:^|\s)(?:ال)?(?:ثلاثاء|تلات)(?:\s|$)/ },
    { day: 3, rx: /(?:^|\s)(?:ال)?اربع(?:اء)?(?:\s|$)/ },
    { day: 4, rx: /(?:^|\s)(?:ال)?خميس(?:\s|$)/ },
  ];
  return dayMap.filter((d) => d.rx.test(normText)).map((d) => d.day);
}

function extractPeriodCountNumber(normFragment: string): number | null {
  // Strip Arabic weekday names & section codes FIRST so "الأربعاء"/"أربع" never masquerades as 4 periods!
  const cleaned = normFragment
    .replace(/\d+\s*ايام|\b[1-3]\s*\/\s*[1-9]\b/g, " ")
    .replace(/(?:^|\s)(?:ال)?(?:سبت|احد|اثنين|اتنين|ثلاثاء|تلات|اربعاء|اربع|خميس)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ");
  const wordNumMap: Record<string, number> = {
    اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6,
    سبع: 7, سبعه: 7, تمن: 8, ثمان: 8, ثمانيه: 8, تسع: 9, عشر: 10,
  };
  for (const rx of [
    /(?:الحصص|حصص|اليومي[ةه]?|في\s*اليوم|لـ?|الي|بقي|بقى)\s*(\d{1,2})\s*(?:حص[ةهص])?/g,
    /(\d{1,2})\s*حص[ةهص]/g,
    /(?:^|\s)([4-9]|10)(?=\s|$)/g,
  ]) {
    for (const m of cleaned.matchAll(rx)) {
      const v = Number(m[1]);
      if (v >= 4 && v <= 10) return v;
    }
  }
  for (const [w, val] of Object.entries(wordNumMap)) {
    if (new RegExp(`(?:^|\\s)${w}(?:\\s|$)`).test(cleaned)) return val;
  }
  return null;
}

function resolveScopeSectionIds(school: SchoolData, rawText: string, normText: string): { ids: Set<string> | null; label: string } {
  const secCodeM = rawText.match(/\b([1-6])\s*[\/\\]\s*([1-9])\b/);
  if (secCodeM) {
    const code = `${secCodeM[1]}/${secCodeM[2]}`;
    const found = school.sections.find((s) => s.name === code || s.code === code);
    if (found) return { ids: new Set([found.id]), label: `فصل ${found.name}` };
  }
  if (/اول[ي]|الصف الاول/.test(normText)) {
    const g1 = school.grades.find((g) => g.order === 1);
    if (g1) return { ids: new Set(school.sections.filter((s) => s.grade_id === g1.id).map((s) => s.id)), label: g1.name };
  }
  if (/(?:تاني|ثاني)ه|الصف الثاني/.test(normText)) {
    const g2 = school.grades.find((g) => g.order === 2);
    if (g2) return { ids: new Set(school.sections.filter((s) => s.grade_id === g2.id).map((s) => s.id)), label: g2.name };
  }
  if (/(?:تالت|ثالث)ه|الصف الثالث/.test(normText)) {
    const g3 = school.grades.find((g) => g.order === 3);
    if (g3) return { ids: new Set(school.sections.filter((s) => s.grade_id === g3.id).map((s) => s.id)), label: g3.name };
  }
  return { ids: null, label: "جميع الفصول" };
}

export function tryApplyDailyPeriodsChatCommand(
  school: SchoolData,
  message: string
): { school: SchoolData; appliedChanges: string[]; reply: string } | null {
  const n = normalizeSubjectText(message);
  if (!n) return null;

  // Ignore teacher-specific or single-subject assignment commands (e.g., "اجعل حصص العربي في 1/1 سبع حصص")
  if (/(?:استاذ|مس|كابتن|معلم|مدرس|شيخ|اجازه|اوف|مزدوج|تفرغ|حضور|يداوم|تداوم|معفي|رضاع|لا يعمل|الحصص الاخيره|الحصص الاولي|اول حصص|اخر حصص)/.test(n)) {
    return null;
  }
  if (findMatchingSubjectInSchool(school.subjects, message) && /\b[1-6]\s*[\/\\]\s*[1-9]\b/.test(message)) {
    return null;
  }
  const hasExplicitGradeScope =
    /(?:اول[يى]|ثاني[ةه]|تاني[ةه]|ثالث[ةه]|تالت[ةه]|رابع[ةه]|خامس[ةه]|سادس[ةه])\s*(?:ابتدائي|اعدادي|ثانوي)|الصف\s+(?:ال)?(?:اول|ثاني|ثالث|رابع|خامس|سادس)/.test(
      n
    );
  const nWithoutEarlyAdverb = n.replace(/(?:يمشوا|بيمشوا|يمشي|بيمشي|يطلع|بيطلع|يروح|بيروح)\s+بدري/g, " ");
  const hasKnownTeacherMention =
    !hasExplicitGradeScope &&
    school.teachers.some((t) => {
      const tn = normalizeSubjectText(t.name).replace(/\s*\(شاغر\)/g, "").trim();
      if (tn.length < 3) return false;
      if (nWithoutEarlyAdverb.includes(tn)) return true;
      return tn
        .split(" ")
        .filter((w) => w.length >= 3 && !/^(?:سبت|احد|اثنين|اتنين|ثلاثاء|تلات|اربعاء|اربع|خميس|اولى|تانيه|ثانيه|تالته|ثالثه|عربي|دين|علوم|رسم|العاب)$/.test(w))
        .some((w) => new RegExp(`(?:^|\\s)${w}(?:\\s|$)`).test(nWithoutEarlyAdverb));
    });
  if (hasKnownTeacherMention) return null;

  const hasExceptionClause = /(?:ما عدا|الا |باستثناء)/.test(n);
  const parts = n.split(/(?:ما عدا|الا |باستثناء)/);
  const basePart = parts[0] || n;
  const excPart = parts.slice(1).join(" ");

  const hasDayRangePhrase = /من\s+(?:ال)?سبت\s+(?:ل|الى|حتي)\s+(?:ال)?خميس|من\s+(?:ال)?احد\s+(?:ل|الى|حتي)\s+(?:ال)?خميس|شغالين\s*\d+\s*ايام/.test(basePart);
  const baseExplicitDays = hasDayRangePhrase ? [] : extractDaysMentions(basePart);
  const hasExplicitDayOnlyInBase =
    baseExplicitDays.length > 0 && !/(?:عدد\s*الحصص|الحصص\s*اليومي[ةه]|يوميا|في\s*اليوم)/.test(basePart);
  const hasGlobalPeriodIntent =
    !hasExplicitDayOnlyInBase &&
    (/(?:عدد\s*الحصص|الحصص\s*اليومي[ةه]|حصص\s*(?:يومي[ةه]|يوميا|في\s*اليوم))/.test(basePart) ||
      (/(?:الحصص|حصص|اليوم الدراسي)/.test(basePart) && /(?:خلي|اجعل|غير|عدل|اضبط|ضبط|زود|قلل|بقي|بقى)/.test(basePart)));

  // Case A: Full week + global daily periods (+ optional "ما عدا ..." per-grade/per-day exception)
  if (hasDayRangePhrase || hasGlobalPeriodIntent) {
    let workingSchool = { ...school };
    const changes: string[] = [];

    // 1. Update working days if explicitly specified
    if (/من\s+(?:ال)?سبت\s+(?:ل|الى|حتي)\s+(?:ال)?خميس|6\s*ايام|سته\s*ايام/.test(basePart)) {
      workingSchool.days = [6, 0, 1, 2, 3, 4];
      changes.push("أيام الدراسة: 6 أيام (السبت ← الخميس)");
    } else if (/من\s+(?:ال)?احد\s+(?:ل|الى|حتي)\s+(?:ال)?خميس|5\s*ايام|خمسه?\s*ايام/.test(basePart)) {
      workingSchool.days = [0, 1, 2, 3, 4];
      changes.push("أيام الدراسة: 5 أيام (الأحد ← الخميس)");
    }

    // 2. Global daily period count from basePart (ignoring "X ايام")
    const basePeriods = extractPeriodCountNumber(basePart);
    if (basePeriods) {
      workingSchool = syncSchoolPeriodsPerDay(workingSchool, basePeriods, true);
      changes.push(`تحديث الحصص اليومية الافتراضية إلى ${basePeriods} حصص يومياً`);
    }

    // 3. Apply "ما عدا ..." exception clause if present (e.g., "ما عدا سنة اولى اعدادي يوم الخميس ... 5 حصص بس")
    if (hasExceptionClause && excPart) {
      const excDays = extractDaysMentions(excPart);
      const excPeriods = extractPeriodCountNumber(excPart);
      if (excDays.length > 0 && excPeriods) {
        const scope = resolveScopeSectionIds(workingSchool, message, excPart);
        workingSchool = {
          ...workingSchool,
          sections: workingSchool.sections.map((sec) => {
            if (scope.ids && !scope.ids.has(sec.id)) return sec;
            const nextLimits = { ...(sec.daily_period_limits || {}) };
            for (const d of excDays) nextLimits[String(d)] = excPeriods;
            return { ...sec, daily_period_limits: nextLimits };
          }),
        };
        const daysText = excDays.map((d) => DAY_NAMES_AR[d]).join("، ");
        changes.push(`استثناء (${scope.label}) يوم (${daysText}): ${excPeriods} حصص`);
      }
    }

    if (changes.length > 0) {
      return {
        school: workingSchool,
        appliedChanges: changes,
        reply: `✓ ${changes.join(" — ")}. جاري تحديث أعمدة الجدول وإعادة التوزيع الآن.`,
      };
    }
  }

  // Case B: Standalone single-day override ("خلي يوم الخميس 5 حصص" / "خلي يوم الخميس 5 حصص لأولى")
  if (!hasDayRangePhrase) {
    const targetDays = extractDaysMentions(n);
    const numVal = extractPeriodCountNumber(n);
    if (targetDays.length > 0 && numVal && /(?:الحصص|حصص|حصه)/.test(n)) {
      const scope = resolveScopeSectionIds(school, message, n);
      const updatedSections = school.sections.map((sec) => {
        if (scope.ids && !scope.ids.has(sec.id)) return sec;
        const nextLimits = { ...(sec.daily_period_limits || {}) };
        for (const d of targetDays) nextLimits[String(d)] = numVal;
        return { ...sec, daily_period_limits: nextLimits };
      });
      const updatedSchool: SchoolData = {
        ...school,
        sections: updatedSections,
      };
      const daysText = targetDays.map((d) => DAY_NAMES_AR[d]).join("، ");
      const changeMsg = `تحديث حصص يوم (${daysText}) إلى ${numVal} حصص لـ (${scope.label})`;
      return {
        school: updatedSchool,
        appliedChanges: [changeMsg],
        reply: `تم ${changeMsg}، وجاري تحديث أعمدة الجدول وإعادة التوزيع فوراً.`,
      };
    }
  }

  return null;
}

const CANONICAL_WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];

/** Returns active working days sorted canonically (Sat -> Sun -> ... -> Fri) with no duplicates. */
export function getOrderedSchoolDays(school: Pick<SchoolData, "days">): number[] {
  const rawDays = Array.isArray(school.days) && school.days.length > 0 ? school.days : [0, 1, 2, 3, 4];
  return Array.from(new Set(rawDays))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => CANONICAL_WEEK_ORDER.indexOf(a) - CANONICAL_WEEK_ORDER.indexOf(b));
}

/** Resolves effective daily periods for a section on day `d` (section limit -> grade limit -> school default). */
export function getSectionDayPeriods(
  school: Pick<SchoolData, "periods_per_day" | "grades">,
  sec: Pick<Section, "grade_id" | "daily_period_limits"> | undefined,
  day: number
): number {
  const base = Math.max(1, school.periods_per_day || 7);
  if (!sec) return base;
  const key = String(day);
  if (sec.daily_period_limits && sec.daily_period_limits[key] != null) {
    return Math.max(1, sec.daily_period_limits[key]);
  }
  const grade = school.grades?.find((g) => g.id === sec.grade_id);
  if (grade?.daily_period_limits && grade.daily_period_limits[key] != null) {
    return Math.max(1, grade.daily_period_limits[key]);
  }
  return base;
}

/** Resolves max period columns needed across all sections on day `d` (or scheduled entries). */
export function getDayMaxPeriods(
  school: Pick<SchoolData, "periods_per_day" | "grades" | "sections">,
  day: number,
  scheduleEntries?: ReadonlyArray<{ day: number; period: number }>
): number {
  const baseMax =
    !school.sections || school.sections.length === 0
      ? Math.max(1, school.periods_per_day || 7)
      : Math.max(...school.sections.map((sec) => getSectionDayPeriods(school, sec, day)));
  if (!scheduleEntries || scheduleEntries.length === 0) return baseMax;
  let maxScheduled = 0;
  for (const e of scheduleEntries) {
    if (e.day === day && e.period > maxScheduled) maxScheduled = e.period;
  }
  return Math.max(baseMax, maxScheduled);
}

/** Resolves max period columns needed for a specific teacher on day `d` based on assigned sections + entries. */
export function getTeacherDayPeriods(
  school: Pick<SchoolData, "periods_per_day" | "grades" | "sections" | "assignments">,
  teacherId: string,
  day: number,
  scheduleEntries?: ReadonlyArray<{ teacher_id: string; section_id: string; day: number; period: number }>
): number {
  const secIds = new Set<string>();
  for (const a of school.assignments || []) {
    if (a.teacher_id === teacherId) secIds.add(a.section_id);
  }
  let maxScheduled = 0;
  for (const e of scheduleEntries || []) {
    if (e.teacher_id === teacherId && e.day === day) {
      secIds.add(e.section_id);
      if (e.period > maxScheduled) maxScheduled = e.period;
    }
  }
  const relevantSections = (school.sections || []).filter((s) => secIds.has(s.id));
  if (relevantSections.length === 0) return Math.max(getDayMaxPeriods(school, day), maxScheduled);
  const secMax = Math.max(...relevantSections.map((s) => getSectionDayPeriods(school, s, day)));
  return Math.max(secMax, maxScheduled);
}
