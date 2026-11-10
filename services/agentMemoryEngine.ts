import type {
  SchoolData,
  Schedule,
  Teacher,
  Section,
  Subject,
  TimetableEntry,
  Grade,
} from "../types.ts";
import { DAY_NAMES_AR } from "../types.ts";
import { normAr, parseDaysList } from "./arabicRules.ts";
import {
  findTeachersInMessage,
  resolveTeacherFromMessage,
  findSubjectInMessage,
  generateSchoolMarkdown,
} from "./schoolCore.ts";
import {
  findMatchingSubjectInSchool,
  getOrderedSchoolDays,
  getSectionDayPeriods,
} from "../presets/commonPresets.ts";

export interface ChatMessageRecord {
  role: "user" | "ai";
  text: string;
  changes?: string[];
  isError?: boolean;
  retryPrompt?: string;
  timestamp?: string;
}

export interface SchoolUndoSnapshot {
  school: SchoolData;
  schedule: Schedule | null;
  label: string;
  timestamp: string;
}

export interface ConversationContext {
  lastFocus?: "teacher" | "section" | "subject";
  lastTeacher?: Teacher;
  lastSection?: Section;
  lastSubject?: Subject;
  lastDay?: number;
  lastPeriod?: number;
  recentChanges: string[];
  recentUserRequests: string[];
}

export type AgentUiActionType =
  | "export_pdf_all"
  | "export_pdf_master"
  | "export_pdf_sections"
  | "export_pdf_teachers"
  | "export_excel"
  | "view_master"
  | "view_section"
  | "view_teacher";

export interface ExtendedAgentActionResult {
  handled: boolean;
  reply: string;
  updated_school?: SchoolData;
  updated_schedule?: Schedule;
  updated_markdown?: string;
  should_solve: boolean;
  applied_changes: string[];
  ui_action?: AgentUiActionType;
  ui_target_id?: string;
}

export const DEFAULT_CHAT_WELCOME_MESSAGE: ChatMessageRecord = {
  role: "ai",
  text:
    "مرحباً بك! أنا وكيل الجداول المدرسية الذكي.\n\n" +
    "أتذكر تفاصيل محادثاتنا السابقة لكل مدرسة وأملك وصولاً كاملاً لبيانات المدرسة والجدول:\n" +
    "• إدارة الإجازات، التبديلات، الحصص اليومية، والقيود بالعامية أو الفصحى (ويمكنك المتابعة بالضمائر مثل: اديله، نصيبه، تراجع).\n" +
    "• تثبيت أو نقل حصص معينة، والبحث عن معلمي الاحتياطي في أي حصة.\n" +
    "• إضافة/حذف فصول أو مواد أو تصدير PDF وExcel مباشرة.",
  timestamp: "الآن",
};

const ARABIC_PERIOD_ORDINALS: Array<{ rx: RegExp; period: number }> = [
  { rx: /(?:الحص[ةه]\s*)?(?:الاول[يى]|1\b|الأولى|اول[يى])/, period: 1 },
  { rx: /(?:الحص[ةه]\s*)?(?:الثاني[ةه]|التاني[ةه]|2\b)/, period: 2 },
  { rx: /(?:الحص[ةه]\s*)?(?:الثالث[ةه]|التالت[ةه]|3\b)/, period: 3 },
  { rx: /(?:الحص[ةه]\s*)?(?:الرابع[ةه]|4\b)/, period: 4 },
  { rx: /(?:الحص[ةه]\s*)?(?:الخامس[ةه]|5\b)/, period: 5 },
  { rx: /(?:الحص[ةه]\s*)?(?:السادس[ةه]|6\b)/, period: 6 },
  { rx: /(?:الحص[ةه]\s*)?(?:السابع[ةه]|7\b)/, period: 7 },
  { rx: /(?:الحص[ةه]\s*)?(?:الثامن[ةه]|التامن[ةه]|8\b)/, period: 8 },
  { rx: /(?:الحص[ةه]\s*)?(?:التاسع[ةه]|9\b)/, period: 9 },
  { rx: /(?:الحص[ةه]\s*)?(?:العاشر[ةه]|10\b)/, period: 10 },
];

export function findSectionInText(school: SchoolData, text: string): Section | undefined {
  const secMatch = text.match(/(\d+\s*[\/\\]\s*\d+)/);
  if (secMatch) {
    const code = secMatch[1].replace(/\s+/g, "").replace(/\\/g, "/");
    const exact = school.sections.find(
      (s) => s.name.replace(/\\/g, "/") === code || (s.code || "").replace(/\\/g, "/") === code
    );
    if (exact) return exact;
  }
  const n = normAr(text);
  for (const s of school.sections) {
    if (s.name && n.includes(normAr(s.name))) return s;
  }
  return undefined;
}

export function extractPeriodNumbersFromText(text: string): number[] {
  const found: number[] = [];
  const cleaned = text.replace(/\b[1-6]\s*[\/\\]\s*[1-9]\b/g, " ");
  const norm = normAr(cleaned);

  // Check explicit "الحصة X" digits first
  for (const m of cleaned.matchAll(/(?:الحص[ةه]|حص[ةه])\s*(\d{1,2})\b/g)) {
    const v = Number(m[1]);
    if (v >= 1 && v <= 10 && !found.includes(v)) found.push(v);
  }
  for (const m of cleaned.matchAll(/\b([1-9]|10)\s*و\s*([1-9]|10)\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a >= 1 && a <= 10 && !found.includes(a)) found.push(a);
    if (b >= 1 && b <= 10 && !found.includes(b)) found.push(b);
  }
  if (found.length > 0) return found;

  for (const item of ARABIC_PERIOD_ORDINALS) {
    if (item.rx.test(norm) && !found.includes(item.period)) {
      found.push(item.period);
    }
  }
  return found;
}

/**
 * Extracts active entities and recent session changes from chat history (newest to oldest).
 */
export function extractConversationContext(
  school: SchoolData,
  history?: ReadonlyArray<{ role: string; text?: string; changes?: string[]; isError?: boolean }>
): ConversationContext {
  const ctx: ConversationContext = {
    recentChanges: [],
    recentUserRequests: [],
  };
  if (!Array.isArray(history) || history.length === 0) return ctx;

  // Collect chronological summaries first
  for (const h of history) {
    if (h.isError) continue;
    if (h.role === "user" && h.text?.trim()) {
      ctx.recentUserRequests.push(h.text.trim());
    }
    if (Array.isArray(h.changes) && h.changes.length > 0) {
      ctx.recentChanges.push(...h.changes);
    }
  }
  ctx.recentUserRequests = ctx.recentUserRequests.slice(-8);
  ctx.recentChanges = ctx.recentChanges.slice(-12);

  // Resolve newest referenced entities (skipping the generic welcome message at index 0 if needed)
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (!h || h.isError) continue;
    if (i === 0 && h.role === "ai" && (h.text || "").includes("أنا وكيل الجداول المدرسية الذكي")) {
      continue;
    }
    const scanText = [h.text || "", ...(h.changes || [])].join(" ").trim();
    if (!scanText) continue;

    if (!ctx.lastTeacher) {
      const cleanScan = scanText.replace(/\b[1-6]\s*[\/\\]\s*[1-9]\b/g, " ");
      const tMatches = findTeachersInMessage(school, cleanScan);
      // Only treat AI text as focusing on a teacher if it is not a multi-teacher summary/reserve table
      const isMultiTeacherList = h.role === "ai" && !(Array.isArray(h.changes) && h.changes.length > 0) && tMatches.length > 2;
      if (tMatches.length > 0 && !isMultiTeacherList) ctx.lastTeacher = tMatches[0];
      if (tMatches.length > 0 && !isMultiTeacherList && !ctx.lastFocus) ctx.lastFocus = "teacher";
    }
    const sec = findSectionInText(school, scanText);
    if (sec) {
      if (!ctx.lastSection) ctx.lastSection = sec;
      if (!ctx.lastFocus && h.role === "user") ctx.lastFocus = "section";
    }
    if (!ctx.lastFocus && h.role === "user") {
      const cleanUserScan = scanText.replace(/\b[1-6]\s*[\/\\]\s*[1-9]\b/g, " ");
      if (findTeachersInMessage(school, cleanUserScan).length > 0) ctx.lastFocus = "teacher";
    }
    if (!ctx.lastSubject) {
      const sub = findSubjectInMessage(school, scanText) || findMatchingSubjectInSchool(school.subjects, scanText);
      if (sub) ctx.lastSubject = sub;
    }
    if (ctx.lastDay === undefined) {
      const days = parseDaysList(scanText);
      if (days.length > 0) ctx.lastDay = days[0];
    }
    if (ctx.lastPeriod === undefined) {
      const ps = extractPeriodNumbersFromText(scanText);
      if (ps.length > 0) ctx.lastPeriod = ps[0];
    }

    if (ctx.lastTeacher && ctx.lastSection && ctx.lastSubject && ctx.lastDay !== undefined) {
      break;
    }
  }

  return ctx;
}

const TEACHER_PRONOUN_RX =
  /(?:اديله|اديها|خليه|خليها|اعطيه|اعطيها|عطه|عطها|(?:^|\s)(?:اجازته|اجازتها|حصصه|حصصها|جدوله|جدولها|نصيبه|نصيبها|تتابعه|تتابعها|عنده|عندها|عليه|عليها|معاه|معاها|له|لها|هو|هي)(?:\s|$)|المعلم ده|المدرس ده|المعلمة دي|الاستاذ ده|الأستاذ ده)/;
const SECTION_PRONOUN_RX = /(?:الفصل ده|فصلهم|حصصهم|جدولهم|معلميهم|مدرسيهم|بيدرسهم|يديهم|(?:^|\s)لهم(?:\s|$))/;
const SUBJECT_PRONOUN_RX = /(?:المادة دي|الماده دي|حصصها|مدرسيها|معلميها|قبل الفسحة|قبل الفسحه)/;
const DAY_PRONOUN_RX = /(?:اليوم ده|نفس اليوم|في اليوم ده|(?:^|\s)(?:فيه|فيها)(?:\s|$))/;
const ELLIPTICAL_FOLLOWUP_RX = /^(?:و|طيب|طب|وبعدين|وكمان|كمان|طب و|طيب و)\s+/;

/**
 * Resolves entities in the current message, seamlessly inheriting missing pronoun targets from history.
 */
export function resolveContextualEntities(
  message: string,
  school: SchoolData,
  history?: ReadonlyArray<{ role: string; text?: string; changes?: string[]; isError?: boolean }>
): {
  teacher?: Teacher;
  section?: Section;
  subject?: Subject;
  days: number[];
  periods: number[];
  ctx: ConversationContext;
  usedTeacherFromContext: boolean;
  usedSectionFromContext: boolean;
  usedSubjectFromContext: boolean;
} {
  const n = normAr(message).replace(/[؟?!.,،:؛()\[\]"']/g, " ").replace(/\s+/g, " ").trim();
  const ctx = extractConversationContext(school, history);

  const messageNoSections = message.replace(/\b[1-6]\s*[\/\\]\s*[1-9]\b/g, " ");
  let teacher = resolveTeacherFromMessage(school, messageNoSections).teacher;
  if (teacher && /\d/.test(teacher.name) && !normAr(messageNoSections).includes(normAr(teacher.name))) { teacher = undefined; }
  let usedTeacherFromContext = false;
  let section = findSectionInText(school, message);
  let usedSectionFromContext = false;
  let subject = findSubjectInMessage(school, message) || findMatchingSubjectInSchool(school.subjects, message);
  let usedSubjectFromContext = false;
  let days = parseDaysList(message);
  const periods = extractPeriodNumbersFromText(message);

  const isFollowupTone = ELLIPTICAL_FOLLOWUP_RX.test(n);

  const hasSecPronoun = SECTION_PRONOUN_RX.test(n);
  const hasTchPronoun = TEACHER_PRONOUN_RX.test(n);
  if (!section && ctx.lastSection && (hasSecPronoun || (isFollowupTone && !hasTchPronoun && !teacher && ctx.lastFocus === "section"))) {
    section = ctx.lastSection;
    usedSectionFromContext = true;
  }
  if (!teacher && ctx.lastTeacher && (hasTchPronoun || (isFollowupTone && !hasSecPronoun && !section && !usedSectionFromContext))) {
    teacher = ctx.lastTeacher;
    usedTeacherFromContext = true;
  }
  if (!subject && ctx.lastSubject && SUBJECT_PRONOUN_RX.test(n)) {
    subject = ctx.lastSubject;
    usedSubjectFromContext = true;
  }
  if (days.length === 0 && ctx.lastDay !== undefined && DAY_PRONOUN_RX.test(n)) {
    days = [ctx.lastDay];
  }

  return {
    teacher,
    section,
    subject,
    days,
    periods,
    ctx,
    usedTeacherFromContext,
    usedSectionFromContext,
    usedSubjectFromContext,
  };
}

/**
 * Rewrites elliptical / pronoun follow-ups into explicit text so existing interpreters
 * (interpretCommand, tryApplyDailyPeriodsChatCommand) understand multi-turn requests natively.
 */
export function enrichMessageWithMemoryContext(
  message: string,
  school: SchoolData,
  history?: ReadonlyArray<{ role: string; text?: string; changes?: string[]; isError?: boolean }>
): string {
  const res = resolveContextualEntities(message, school, history);
  const parts: string[] = [message.trim()];
  const nMsg = normAr(message);
  const explicitTch = resolveTeacherFromMessage(school, message.replace(/\b[1-6]\s*[\/\\]\s*[1-9]\b/g, " ")).teacher;
  const explicitDays = parseDaysList(message);
  const isBareRevertOff = /(تراجع|الغي|الغ|كنسل|شيل).*(اجاز[ةهت]|اوف|تفرغ)/.test(nMsg) && !explicitTch;

  if (isBareRevertOff && Array.isArray(history)) {
    // Locate the most recent off-day grant in session history
    let revTch: Teacher | undefined;
    let revDay: number | undefined;
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      const scan = [h.text || "", ...(h.changes || [])].join(" ");
      if (/(اجاز[ةهت]|اوف|تفرغ)/.test(normAr(scan))) {
        const cleanScan = scan.replace(/\b[1-6]\s*[\/\\]\s*[1-9]\b/g, " ");
        const tMatches = findTeachersInMessage(school, cleanScan);
        const dMatches = parseDaysList(scan);
        if (tMatches.length > 0 && dMatches.length > 0) {
          revTch = tMatches[0];
          revDay = dMatches[0];
          break;
        }
      }
    }
    if (revTch) parts.push(`للمعلم ${revTch.name}`);
    else if (res.ctx.lastTeacher) parts.push(`للمعلم ${res.ctx.lastTeacher.name}`);
    if (explicitDays.length === 0 && revDay !== undefined) {
      parts.push(`يوم ${DAY_NAMES_AR[revDay]}`);
    }
  } else if (res.usedTeacherFromContext && res.teacher) {
    parts.push(`للمعلم ${res.teacher.name}`);
  }
  if (res.usedSectionFromContext && res.section) {
    parts.push(`لفصل ${res.section.name}`);
  }
  if (res.usedSubjectFromContext && res.subject) {
    parts.push(`لمادة ${res.subject.name}`);
  }
  return parts.join(" ");
}

/**
 * Extended deterministic agent command router covering constraints, direct schedule cell manipulation,
 * school CRUD, UI view navigation, and PDF/Excel export triggers.
 */
export function tryExecuteExtendedAgentAction(
  message: string,
  school: SchoolData,
  schedule: Schedule | null | undefined,
  history?: ReadonlyArray<{ role: string; text?: string; changes?: string[]; isError?: boolean }>
): ExtendedAgentActionResult | null {
  const n = normAr(message);
  if (!n) return null;

  const resolved = resolveContextualEntities(message, school, history);

  // 1. Direct Export & View Navigation UI Actions
  if (/(صدر|اطبع|طباعة|طباعه|حمل|تنزيل|اكسبورت|export)/.test(n)) {
    if (/(اكسيل|إكسيل|excel|xls)/.test(n)) {
      return {
        handled: true,
        reply: `✓ جاري تجهيز وتحميل ملف Excel الملون لمدرسة "${school.name}" (4 أوراق عمل شاملة).`,
        should_solve: false,
        applied_changes: ["تصدير جدول المدرسة إلى Excel ملون"],
        ui_action: "export_excel",
      };
    }
    if (/(بطاقات الفصول|جداول الفصول)/.test(n)) {
      return {
        handled: true,
        reply: `✓ جاري فتح معاينة الطباعة لبطاقات الفصول (${school.sections.length} فصول) بصيغة PDF.`,
        should_solve: false,
        applied_changes: ["فتح طباعة بطاقات الفصول PDF"],
        ui_action: "export_pdf_sections",
      };
    }
    if (/(بطاقات المعلمين|جداول المعلمين)/.test(n)) {
      return {
        handled: true,
        reply: `✓ جاري فتح معاينة الطباعة لبطاقات المعلمين بصيغة PDF.`,
        should_solve: false,
        applied_changes: ["فتح طباعة بطاقات المعلمين PDF"],
        ui_action: "export_pdf_teachers",
      };
    }
    if (/(الجدول العام|A3|a3)/.test(n) && /pdf/.test(n)) {
      return {
        handled: true,
        reply: `✓ جاري فتح معاينة الجدول العام الشامل (A3) للطباعة والحفظ بصيغة PDF.`,
        should_solve: false,
        applied_changes: ["فتح طباعة الجدول العام A3 PDF"],
        ui_action: "export_pdf_master",
      };
    }
    if (/pdf/.test(n)) {
      return {
        handled: true,
        reply: `✓ جاري تجهيز ملف PDF الشامل (الجدول العام + بطاقات الفصول + بطاقات المعلمين) بنفس ألوان بايثون.`,
        should_solve: false,
        applied_changes: ["فتح معاينة تصدير PDF الشامل"],
        ui_action: "export_pdf_all",
      };
    }
  }

  if (/^(?:اعرض|افتح|وريني|شغل)\s+جدول(?:\s|$)/.test(n)) {
    if (resolved.section) {
      return {
        handled: true,
        reply: `✓ تم الانتقال إلى عرض جدول فصل ${resolved.section.name}.`,
        should_solve: false,
        applied_changes: [],
        ui_action: "view_section",
        ui_target_id: resolved.section.id,
      };
    }
    if (resolved.teacher) {
      return {
        handled: true,
        reply: `✓ تم الانتقال إلى عرض جدول الأستاذ ${resolved.teacher.name}.`,
        should_solve: false,
        applied_changes: [],
        ui_action: "view_teacher",
        ui_target_id: resolved.teacher.id,
      };
    }
    if (/العام|المدرسة/.test(n)) {
      return {
        handled: true,
        reply: `✓ تم عرض الجدول العام الشامل للمدرسة.`,
        should_solve: false,
        applied_changes: [],
        ui_action: "view_master",
      };
    }
  }

  // 2. Rename School ("غير اسم المدرسة إلى ..." / "سمي المدرسة ...")
  const renameMatch = message.match(
    /(?:غير\s+اسم\s+المدرس[ةه]|سم[ّ]?ي\s+المدرس[ةه]|اجعل\s+اسم\s+المدرس[ةه])\s*(?:الى|إلى|لـ?|بـ?)?\s*[:\-]?\s*(.+)$/i
  );
  if (renameMatch && renameMatch[1]?.trim().length >= 2) {
    const newName = renameMatch[1].trim().replace(/^["']|["']$/g, "");
    const updatedSchool: SchoolData = { ...school, name: newName };
    const change = `تغيير اسم المدرسة إلى "${newName}"`;
    return {
      handled: true,
      reply: `✓ تم ${change} بنجاح.`,
      updated_school: updatedSchool,
      updated_markdown: generateSchoolMarkdown(updatedSchool, [change]),
      should_solve: false,
      applied_changes: [change],
    };
  }

  // 3. Direct Schedule Cell Manipulation (Pin / Unpin / Swap Slots / Move Slot)
  const isPinCmd = /(ثب[ّ]?ت|تثبيت|قفل|اقفل)/.test(n) && /(حص[ةه]|جدول|فصل)/.test(n);
  const isUnpinCmd = /(فك\s*(?:تثبيت|قفل)|الغي\s*تثبيت|شيل\s*التثبيت)/.test(n);
  if ((isPinCmd || isUnpinCmd) && schedule && schedule.entries.length > 0) {
    const pinVal = !isUnpinCmd;
    const targetDay = resolved.days[0];
    const targetPeriod = resolved.periods[0];
    let changedCount = 0;

    const nextEntries = schedule.entries.map((e) => {
      const matchSec = !resolved.section || e.section_id === resolved.section.id;
      const matchTch = !resolved.teacher || e.teacher_id === resolved.teacher.id;
      const matchSub = !resolved.subject || e.subject_id === resolved.subject.id;
      const matchDay = targetDay === undefined || e.day === targetDay;
      const matchPeriod = targetPeriod === undefined || e.period === targetPeriod;
      if (matchSec && matchTch && matchSub && matchDay && matchPeriod) {
        if (Boolean(e.is_pinned) !== pinVal) changedCount++;
        return { ...e, is_pinned: pinVal };
      }
      return e;
    });

    if (changedCount > 0 || (isUnpinCmd && (resolved.section || resolved.teacher))) {
      const scopeDesc = [
        resolved.section ? `فصل ${resolved.section.name}` : "",
        resolved.teacher ? `الأستاذ ${resolved.teacher.name}` : "",
        resolved.subject ? `مادة ${resolved.subject.name}` : "",
        targetDay !== undefined ? `يوم ${DAY_NAMES_AR[targetDay]}` : "",
        targetPeriod !== undefined ? `الحصة ${targetPeriod}` : "",
      ]
        .filter(Boolean)
        .join(" — ") || "الجدول";

      const actionLabel = pinVal
        ? `تثبيت ${changedCount} حصة (${scopeDesc})`
        : `فك تثبيت ${changedCount} حصة (${scopeDesc})`;

      return {
        handled: true,
        reply: `✓ تم ${actionLabel} في الجدول المعروض بنجاح.`,
        updated_schedule: { ...schedule, entries: nextEntries },
        should_solve: false,
        applied_changes: [actionLabel],
      };
    }
  }

  // Swap or Move two periods for a section on a day (or across days) in live schedule.entries
  const isMoveOrSwapSlot =
    /(انقل|حرك|نقل|بدل|مبادلة|بد[ّ]?ل)/.test(n) &&
    resolved.section &&
    resolved.periods.length >= 2 &&
    schedule &&
    schedule.entries.length > 0;

  if (isMoveOrSwapSlot && resolved.section && schedule) {
    const sec = resolved.section;
    const pFrom = resolved.periods[0];
    const pTo = resolved.periods[1];
    const dFrom = resolved.days[0] ?? getOrderedSchoolDays(school)[0] ?? 0;
    const dTo = resolved.days[1] ?? dFrom;

    const limitTo = getSectionDayPeriods(school, sec, dTo);
    if (pTo > limitTo) {
      return {
        handled: true,
        reply: `⚠️ تعذر النقل: يوم ${DAY_NAMES_AR[dTo]} لفصل ${sec.name} ينتهي عند الحصة ${limitTo}.`,
        should_solve: false,
        applied_changes: [],
      };
    }

    const entryA = schedule.entries.find(
      (e) => e.section_id === sec.id && e.day === dFrom && e.period === pFrom
    );
    const entryB = schedule.entries.find(
      (e) => e.section_id === sec.id && e.day === dTo && e.period === pTo
    );

    if (!entryA) {
      return {
        handled: true,
        reply: `ℹ️ لا توجد حصة مجدولة لفصل ${sec.name} يوم ${DAY_NAMES_AR[dFrom]} في الحصة ${pFrom}.`,
        should_solve: false,
        applied_changes: [],
      };
    }

    // Check hard conflicts before swapping/moving
    const tchA = school.teachers.find((t) => t.id === entryA.teacher_id);
    if (tchA?.work_pattern?.day_rules?.[String(dTo)] === "MANDATORY_OFF") {
      return {
        handled: true,
        reply: `⚠️ تعذر النقل: الأستاذ ${tchA.name} لديه إجازة رسمية يوم ${DAY_NAMES_AR[dTo]}.`,
        should_solve: false,
        applied_changes: [],
      };
    }
    const busyA = schedule.entries.find(
      (e) =>
        e.teacher_id === entryA.teacher_id &&
        e.day === dTo &&
        e.period === pTo &&
        e.entry_id !== entryB?.entry_id
    );
    if (busyA) {
      const busySec = school.sections.find((s) => s.id === busyA.section_id)?.name || busyA.section_id;
      return {
        handled: true,
        reply: `⚠️ تعذر النقل: الأستاذ ${tchA?.name || entryA.teacher_id} مشغول يوم ${DAY_NAMES_AR[dTo]} الحصة ${pTo} في فصل ${busySec}.`,
        should_solve: false,
        applied_changes: [],
      };
    }

    if (entryB) {
      const tchB = school.teachers.find((t) => t.id === entryB.teacher_id);
      if (tchB?.work_pattern?.day_rules?.[String(dFrom)] === "MANDATORY_OFF") {
        return {
          handled: true,
          reply: `⚠️ تعذر التبديل: الأستاذ ${tchB.name} لديه إجازة رسمية يوم ${DAY_NAMES_AR[dFrom]}.`,
          should_solve: false,
          applied_changes: [],
        };
      }
      const busyB = schedule.entries.find(
        (e) =>
          e.teacher_id === entryB.teacher_id &&
          e.day === dFrom &&
          e.period === pFrom &&
          e.entry_id !== entryA.entry_id
      );
      if (busyB) {
        const busySec = school.sections.find((s) => s.id === busyB.section_id)?.name || busyB.section_id;
        return {
          handled: true,
          reply: `⚠️ تعذر التبديل: الأستاذ ${tchB?.name || entryB.teacher_id} مشغول يوم ${DAY_NAMES_AR[dFrom]} الحصة ${pFrom} في فصل ${busySec}.`,
          should_solve: false,
          applied_changes: [],
        };
      }
    }

    const nextEntries: TimetableEntry[] = schedule.entries.map((e) => {
      if (e.entry_id === entryA.entry_id) {
        return { ...e, day: dTo, period: pTo, is_pinned: true };
      }
      if (entryB && e.entry_id === entryB.entry_id) {
        return { ...e, day: dFrom, period: pFrom, is_pinned: true };
      }
      return e;
    });

    const subA = school.subjects.find((s) => s.id === entryA.subject_id)?.name || entryA.subject_id;
    const change = entryB
      ? `تبديل الحصة ${pFrom} (${DAY_NAMES_AR[dFrom]}) مع الحصة ${pTo} (${DAY_NAMES_AR[dTo]}) لفصل ${sec.name}`
      : `نقل حصة ${subA} لفصل ${sec.name} من ${DAY_NAMES_AR[dFrom]} ح${pFrom} إلى ${DAY_NAMES_AR[dTo]} ح${pTo}`;

    return {
      handled: true,
      reply: `✓ تم ${change} بنجاح بدون أي تعارضات (تم تثبيت الموضع الجديد).`,
      updated_schedule: { ...schedule, entries: nextEntries },
      should_solve: false,
      applied_changes: [change],
    };
  }

  // 4. Subject Rules ("خلي الدين قبل الفسحة" / "خلي مادة الرياضيات مزدوجة" / "خلي الحاسب فردي")
  if (resolved.subject && /(قبل الفسح[ةه]|مزدوج[ةه]|فردي[ةه])/.test(n) && !resolved.teacher) {
    const sub = resolved.subject;
    const wantBeforeBreak = /قبل الفسح[ةه]/.test(n);
    const wantDouble = /مزدوج[ةه]/.test(n) && !/(الغ|الغي|مش|بلاش|بدون|منع)/.test(n);
    const wantSingle = /فردي[ةه]/.test(n) || (/(الغ|الغي|منع)/.test(n) && /مزدوج[ةه]/.test(n));

    const updatedSubjects = school.subjects.map((s) => {
      if (s.id !== sub.id) return s;
      return {
        ...s,
        before_break: wantBeforeBreak ? true : s.before_break,
        double_period_policy: wantDouble
          ? ("DOUBLE_REQUIRED" as const)
          : wantSingle
            ? ("SINGLE_ONLY" as const)
            : s.double_period_policy,
      };
    });
    const updatedSchool: SchoolData = { ...school, subjects: updatedSubjects };
    const descParts: string[] = [];
    if (wantBeforeBreak) descParts.push("قبل الفسحة");
    if (wantDouble) descParts.push("حصص مزدوجة إجبارية");
    if (wantSingle) descParts.push("حصص فردية فقط");
    const change = `ضبط سياسة مادة "${sub.name}" (${descParts.join("، ")})`;

    return {
      handled: true,
      reply: `✓ تم ${change}، وجاري إعادة بناء الجدول لتطبيق القيد الجديد.`,
      updated_school: updatedSchool,
      updated_markdown: generateSchoolMarkdown(updatedSchool, [change]),
      should_solve: true,
      applied_changes: [change],
    };
  }

  // 5. Teacher Specific Constraints (Max daily periods, Max consecutive, Double period toggle)
  if (resolved.teacher && /(تتابع|متتالي[ةه]|اقص[يى] حصص|حد اقص[يى]|مزدوج[ةه])/.test(n)) {
    const tch = resolved.teacher;
    const numM = message.match(/(\d+|حصتين|ثلاث|تلات|اربع|خمس|ست)/);
    let numVal = 0;
    if (numM) {
      const rawN = numM[1];
      const map: Record<string, number> = { حصتين: 2, ثلاث: 3, تلات: 3, اربع: 4, خمس: 5, ست: 6 };
      numVal = map[rawN] ?? Number(rawN);
    }

    const isConsec = /(تتابع|متتالي[ةه]|ورا بعض)/.test(n);
    const isDailyMax = /(يومي[ةه]|في اليوم)/.test(n);
    const isDouble = /مزدوج[ةه]/.test(n);
    const disableDouble = /(الغ|الغي|شيل|منع|مش|بدون)/.test(n);

    if ((isConsec || isDailyMax) && numVal >= 1 && numVal <= 8) {
      const updatedTeachers = school.teachers.map((t) => {
        if (t.id !== tch.id) return t;
        return {
          ...t,
          max_consecutive_periods: isConsec ? numVal : t.max_consecutive_periods,
          max_daily_periods: isDailyMax ? numVal : t.max_daily_periods,
        };
      });
      const updatedSchool: SchoolData = { ...school, teachers: updatedTeachers };
      const change = isConsec
        ? `تحديد الحد الأقصى لتتابع الحصص للأستاذ ${tch.name} إلى ${numVal} حصص`
        : `تحديد الحد الأقصى للحصص اليومية للأستاذ ${tch.name} إلى ${numVal} حصص`;
      return {
        handled: true,
        reply: `✓ تم ${change}، وجاري تحديث الجدول تلقائياً.`,
        updated_school: updatedSchool,
        updated_markdown: generateSchoolMarkdown(updatedSchool, [change]),
        should_solve: true,
        applied_changes: [change],
      };
    }

    if (isDouble) {
      const updatedTeachers = school.teachers.map((t) =>
        t.id === tch.id ? { ...t, force_double_periods: !disableDouble } : t
      );
      const updatedSchool: SchoolData = { ...school, teachers: updatedTeachers };
      const change = !disableDouble
        ? `تفعيل نظام الحصص المزدوجة للأستاذ ${tch.name}`
        : `إلغاء إلزامية الحصص المزدوجة للأستاذ ${tch.name}`;
      return {
        handled: true,
        reply: `✓ تم ${change}، وجاري إعادة التوزيع الآن.`,
        updated_school: updatedSchool,
        updated_markdown: generateSchoolMarkdown(updatedSchool, [change]),
        should_solve: true,
        applied_changes: [change],
      };
    }
  }

  // 6. Add / Remove Section ("ضيف فصل 1/5" / "احذف فصل 1/5")
  const secCodeMatch = message.match(/\b([1-6])\s*[\/\\]\s*([1-9])\b/);
  if (secCodeMatch && /(ضيف|اضف|أضف|انشئ|زود|احذف|شيل|امسح)\s+فصل/.test(n)) {
    const code = `${secCodeMatch[1]}/${secCodeMatch[2]}`;
    const gradeOrder = Number(secCodeMatch[1]);
    const isDelete = /(احذف|شيل|امسح)/.test(n);
    const existingSec = school.sections.find((s) => s.name === code || s.code === code);

    if (isDelete) {
      if (!existingSec) {
        return {
          handled: true,
          reply: `ℹ️ الفصل "${code}" غير موجود في المدرسة.`,
          should_solve: false,
          applied_changes: [],
        };
      }
      const updatedSchool: SchoolData = {
        ...school,
        sections: school.sections.filter((s) => s.id !== existingSec.id),
        assignments: school.assignments.filter((a) => a.section_id !== existingSec.id),
      };
      const change = `حذف فصل "${code}" وتكليفاته`;
      return {
        handled: true,
        reply: `✓ تم ${change} بنجاح، وجاري إعادة بناء الجدول.`,
        updated_school: updatedSchool,
        updated_markdown: generateSchoolMarkdown(updatedSchool, [change]),
        should_solve: true,
        applied_changes: [change],
      };
    } else if (!existingSec) {
      const targetGrade: Grade =
        school.grades.find((g) => g.order === gradeOrder) ||
        school.grades[0] || { id: `grade_${gradeOrder}`, name: `الصف ${gradeOrder}`, code: `G${gradeOrder}`, order: gradeOrder };
      const newSecId = `SEC_${gradeOrder}_${secCodeMatch[2]}_${Date.now().toString(36).slice(-3)}`;
      const newSec: Section = {
        id: newSecId,
        name: code,
        code,
        grade_id: targetGrade.id,
        shift: school.sections[0]?.shift || "FIRST",
      };
      const updatedSchool: SchoolData = {
        ...school,
        grades: school.grades.some((g) => g.id === targetGrade.id) ? school.grades : [...school.grades, targetGrade],
        sections: [...school.sections, newSec],
      };
      const change = `إضافة فصل جديد "${code}" تحت "${targetGrade.name}"`;
      return {
        handled: true,
        reply: `✓ تم ${change}. يمكنك الآن إسناد المواد له في الشات مثل: "اسند عربي 6 حصص لفصل ${code} للأستاذ فلان".`,
        updated_school: updatedSchool,
        updated_markdown: generateSchoolMarkdown(updatedSchool, [change]),
        should_solve: false,
        applied_changes: [change],
      };
    }
  }

  return null;
}

/**
 * Builds a concise live digest of schedule slots, teacher availability, constraints,
 * and conversation context for open-ended Gemini queries.
 */
export function buildLiveAgentContextDigest(
  school: SchoolData,
  schedule: Schedule | null | undefined,
  history?: ReadonlyArray<{ role: string; text?: string; changes?: string[] }>
): string {
  const ctx = extractConversationContext(school, history);
  const orderedDays = getOrderedSchoolDays(school);

  const teacherSummary = school.teachers.map((t) => {
    const load = school.assignments
      .filter((a) => a.teacher_id === t.id)
      .reduce((s, a) => s + a.weekly_periods, 0);
    const offs = Object.entries(t.work_pattern?.day_rules || {})
      .filter(([_, r]) => r === "MANDATORY_OFF")
      .map(([d]) => DAY_NAMES_AR[Number(d)] || d)
      .join("،");
    return `${t.name} (${load}ح${offs ? `، إجازة: ${offs}` : ""})`;
  });

  let freeGridText = "الجدول غير موزع بعد.";
  if (schedule && schedule.entries.length > 0) {
    const daySlots: string[] = [];
    for (const d of orderedDays) {
      const maxP = Math.max(1, school.periods_per_day || 7);
      const periodFree: string[] = [];
      for (let p = 1; p <= maxP; p++) {
        const busyIds = new Set(schedule.entries.filter((e) => e.day === d && e.period === p).map((e) => e.teacher_id));
        const freeTchs = school.teachers
          .filter((t) => t.work_pattern?.day_rules?.[String(d)] !== "MANDATORY_OFF" && !busyIds.has(t.id))
          .map((t) => t.name)
          .slice(0, 6);
        periodFree.push(`ح${p}: ${freeTchs.length > 0 ? freeTchs.join("، ") : "لا يوجد"}`);
      }
      daySlots.push(`- ${DAY_NAMES_AR[d]}: ${periodFree.join(" | ")}`);
    }
    freeGridText = daySlots.join("\n");
  }

  return [
    `سياق الجلسة النشط:`,
    `- آخر معلم مذكور: ${ctx.lastTeacher?.name || "لا يوجد"}`,
    `- آخر فصل مذكور: ${ctx.lastSection?.name || "لا يوجد"}`,
    `- آخر مادة مذكورة: ${ctx.lastSubject?.name || "لا يوجد"}`,
    `- آخر تعديلات الجلسة: ${ctx.recentChanges.slice(-5).join(" ؛ ") || "لا يوجد"}`,
    `ملخص المعلمين والأنصبة (${school.teachers.length}): ${teacherSummary.join(" | ")}`,
    `المعلمون المتاحون للاحتياطي (أول 6 لكل حصة):\n${freeGridText}`,
  ].join("\n");
}
