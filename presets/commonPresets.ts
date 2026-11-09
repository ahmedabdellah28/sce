import type {
  Grade,
  Section,
  Subject,
  Teacher,
  TeachingAssignment,
  SchoolData,
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
