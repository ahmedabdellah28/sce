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
import { normAr, parseDaysList, parseRuleText } from "./arabicRules.ts";
import {
  applyOps,
  findTeachersInMessage,
  resolveTeacherFromMessage,
  findSubjectInMessage,
  generateSchoolMarkdown,
  type Op,
} from "./schoolCore.ts";
import {
  findMatchingSubjectInSchool,
  getOrderedSchoolDays,
  getSectionDayPeriods,
} from "../presets/commonPresets.ts";
import { solveSchool } from "./solver.ts";

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

  // 0. Pending Advisory Proposal Confirmation ("أيوه نفذه" / "تمام" / "أديهم للأول" / "أديهم لرفعت")
  const lastAiMsg = Array.isArray(history)
    ? [...history].reverse().find((h) => h.role === "ai" && !h.isError)
    : undefined;
  if (lastAiMsg && lastAiMsg.text) {
    const offProposal = lastAiMsg.text.match(/هل تحب أنفذ إجازة يوم\s+([^\n]+?)\s+للأستاذ\s+([^\n؟]+?)\s+الآن/);
    if (offProposal && /^(?:ايوه|أيوه|نعم|تمام|ماشي|موافق|اكيد|أكيد|طبعا|طبعاً|نفذ|نفذه|اعملها|طبقه|يلا|اوكي|ok)(?:\s|$)/.test(n)) {
      const propDays = parseDaysList(offProposal[1]);
      const propTeacher = school.teachers.find((t) => normAr(t.name) === normAr(offProposal[2].trim()));
      if (propTeacher && propDays.length > 0) {
        const ops: Op[] = [{ op: "set_teacher_days", teacher: propTeacher.name, off_days: propDays }];
        const resOps = applyOps(school, ops);
        if (resOps.changed || resOps.changes.length > 0) {
          return {
            handled: true,
            reply:
              `✓ تم تنفيذ التعديل كما طلبت:\n` +
              resOps.changes.map((c) => `✓ ${c}`).join("\n") +
              `\nوجاري إعادة توزيع الجدول بضمان 0% تعارضات.`,
            updated_school: resOps.school,
            updated_markdown: generateSchoolMarkdown(resOps.school, resOps.changes),
            should_solve: true,
            applied_changes: resOps.changes,
          };
        }
      }
    }

    const assignProposal = lastAiMsg.text.match(/تحب أسند الـ\s*(\d+)\s*حصص\s*\(([^)]+?)(?:\s+لفصل\s+([^\s)]+))?\)\s*لأي منهم/);
    if (assignProposal && /(?:اديه|أديه|اسند|خليه|اختار|الأول|الاول|للاول|التاني|الثاني|للتاني|للثاني|التالت|الثالث|للتالت|للثالث)/.test(n)) {
      const periodsCount = Number(assignProposal[1]);
      const subjName = assignProposal[2].trim();
      const secCode = assignProposal[3]?.trim();
      let chosenTeacher = findTeachersInMessage(school, message)[0];
      if (!chosenTeacher) {
        const candidates = [...lastAiMsg.text.matchAll(/^\d+\.\s*\*\*([^*]+)\*\*/gm)].map((m) => m[1].trim());
        const pickIdx = /(?:الأول|الاول|للاول)/.test(n) ? 0 : /(?:الثاني|التاني|للثاني|للتاني)/.test(n) ? 1 : /(?:الثالث|التالت|للثالث|للتالت)/.test(n) ? 2 : -1;
        if (pickIdx >= 0 && candidates[pickIdx]) {
          chosenTeacher = school.teachers.find((t) => normAr(t.name) === normAr(candidates[pickIdx]));
        }
      }
      if (chosenTeacher && secCode) {
        const ops: Op[] = [
          { op: "set_assignment", section: secCode, subject: subjName, teacher: chosenTeacher.name, periods: periodsCount },
        ];
        const resOps = applyOps(school, ops);
        if (resOps.changed || resOps.changes.length > 0) {
          return {
            handled: true,
            reply:
              `✓ تم إسناد ${periodsCount} حصص (${subjName}) لفصل ${secCode} للأستاذ "${chosenTeacher.name}" بنجاح.\n` +
              `وجاري إعادة بناء وتوزيع الجدول الآن.`,
            updated_school: resOps.school,
            updated_markdown: generateSchoolMarkdown(resOps.school, resOps.changes),
            should_solve: true,
            applied_changes: resOps.changes,
          };
        }
      }
    }

    const fairProposal = /هل تحب أطبّق التوزيع العادل للمعلمين/.test(lastAiMsg.text);
    if (fairProposal && /^(?:ايوه|أيوه|نعم|تمام|ماشي|موافق|اكيد|أكيد|طبعا|طبعاً|نفذ|نفذه|اعملها|طبقه|يلا|اوكي|ok)(?:\s|$)/.test(n)) {
      const fairRes = applyFairTeacherDistribution(school, "both");
      if (fairRes.changed) {
        return {
          handled: true,
          reply: fairRes.reply,
          updated_school: fairRes.school,
          updated_markdown: generateSchoolMarkdown(fairRes.school, fairRes.changes),
          should_solve: true,
          applied_changes: fairRes.changes,
        };
      }
    }
  }

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

    // Clarification Guard: Prevent blind mass pinning on vague prompts like "ثبّت حصة العربي"
    const wantsAllExplicitly = /(?:^|\s)(?:كل|الكل|جميع|كامل)(?:\s|$)/.test(n);
    const matchingPre = schedule.entries.filter((e) => {
      const matchSec = !resolved.section || e.section_id === resolved.section.id;
      const matchTch = !resolved.teacher || e.teacher_id === resolved.teacher.id;
      const matchSub = !resolved.subject || e.subject_id === resolved.subject.id;
      const matchDay = targetDay === undefined || e.day === targetDay;
      const matchPeriod = targetPeriod === undefined || e.period === targetPeriod;
      return matchSec && matchTch && matchSub && matchDay && matchPeriod;
    });

    if (
      pinVal &&
      !wantsAllExplicitly &&
      !resolved.section &&
      !resolved.teacher &&
      (targetDay === undefined || targetPeriod === undefined) &&
      matchingPre.length > 6
    ) {
      const distinctSections = new Set(matchingPre.map((e) => e.section_id)).size;
      const firstSecName = school.sections.find((s) => s.id === matchingPre[0].section_id)?.name || "1/1";
      const firstDayName = DAY_NAMES_AR[matchingPre[0].day] || "الأحد";
      const targetTopic = resolved.subject ? `لمادة "${resolved.subject.name}"` : "في الجدول";
      return {
        handled: true,
        reply:
          `🤔 يوجد ${matchingPre.length} حصة ${targetTopic} موزعة على ${distinctSections} فصول. أي حصة أو فصل تقصد تثبيتها تحديداً؟\n` +
          `• للتثبيت الدقيق اكتب مثلاً: "ثبّت حصة ${resolved.subject?.name || "المادة"} لفصل ${firstSecName} يوم ${firstDayName} الحصة ${matchingPre[0].period}"\n` +
          `• أو اكتب: "ثبّت كل حصص ${resolved.subject?.name || "الجدول"}" لتثبيتها جميعاً دفعة واحدة.`,
        should_solve: false,
        applied_changes: [],
      };
    }

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

  // 8. Clear explicit teacher placement constraint ("الغي قيود الأستاذ فلان" / "امسح قيد يوم الاحد لفلان")
  if (/(?:الغ|الغاء|الغي|احذف|حذف|امسح|ازل|شيل).*(?:قيد|قيود)/.test(n)) {
    const tMatches = findTeachersInMessage(school, message);
    if (tMatches.length === 1) {
      const target = tMatches[0];
      const dayMatches = parseDaysList(message.replace(target.name, " "));
      const existingRules = target.work_pattern?.placement_rules || [];
      if (existingRules.length > 0) {
        const nextRules =
          dayMatches.length > 0
            ? existingRules.filter((r) => r.day === null || r.day === undefined || !dayMatches.includes(Number(r.day)))
            : [];
        const removedCount = existingRules.length - nextRules.length;
        if (removedCount > 0) {
          const updatedSchool: SchoolData = {
            ...school,
            teachers: school.teachers.map((t) =>
              t.id === target.id && t.work_pattern
                ? { ...t, work_pattern: { ...t.work_pattern, placement_rules: nextRules } }
                : t
            ),
          };
          const scopeLabel = dayMatches.length > 0 ? dayMatches.map((d) => DAY_NAMES_AR[d] || d).join(" و") : "جميع الأيام";
          const change = `حذف ${removedCount} قيد/قيود حصص للمعلم ${target.name} (${scopeLabel})`;
          return {
            handled: true,
            reply: `✓ تم ${change}، وجاري إعادة بناء الجدول تلقائياً.`,
            updated_school: updatedSchool,
            updated_markdown: generateSchoolMarkdown(updatedSchool, [change]),
            should_solve: true,
            applied_changes: [change],
          };
        }
      }
    }
  }

  // 9. Explicit period cancellation / exclusion ("ممدوح كساب الغاء الحصة الاولى يوم الاحد" / "بلاش الحصص الاولى")
  // Intercepts before legacy schoolCore heuristics (e.g. teacher named "بدري" matching "يمشي بدري" or plural "الحصص الاولى")
  const hasCancelOrNegVerb =
    /(?:^|\s)(?:الغاء|الغي|الغ|احذف|حذف|شيل|شيله|شيلله|شل|ازل|ازاله|كنسل|فرغ|فرغله|فرغلها|تجنب|بلاش|ممنوع|بدون|معندوش|معندهاش|معفي|معفاه|لا|متديش|ماتديش|ماتديلوش|مياخدش|ماياخدش|متاخدش|ماتاخدش)(?:\s|$)/.test(
      n
    );
  const hasOffKeyword = /(?:اجاز[ةهت]|اوف|أوف|تفرغ|راح[ةه])/.test(n);
  const hasExplicitPeriodSlot =
    /(?:الحص[ةه]\s*(?:ال)?(?:اول[يى]|ثاني[ةه]|تاني[ةه]|ثالث[ةه]|تالت[ةه]|رابع[ةه]|خامس[ةه]|سادس[ةه]|سابع[ةه]|ثامن[ةه]|تامن[ةه]|اخير[ةه]|\d{1,2})|(?:اول[يى]|اخير[ةه])\s*(?:حص[ةه]|حصص|حصتين)|(?:ال)?حصص\s*(?:ال)?(?:اول[يى]|اخير[ةه]))/.test(
      n
    );
  if (hasCancelOrNegVerb && !hasOffKeyword && hasExplicitPeriodSlot && !/\d+\s*[\/\\]\s*\d+/.test(n)) {
    const tMatches = findTeachersInMessage(school, message);
    const targetTeacher = tMatches.length === 1 ? tMatches[0] : resolveTeacherFromMessage(school, message).teacher;
    if (targetTeacher) {
      const strippedBody = message
        .replace(new RegExp(targetTeacher.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), " ")
        .trim();
      const parsed = parseRuleText(strippedBody, getOrderedSchoolDays(school));
      if (parsed.rules.length > 0) {
        const ops: Op[] = parsed.rules.map((r) => ({
          op: "add_placement_rule" as const,
          teacher: targetTeacher.name,
          day: r.day,
          type: r.type,
          n: r.n,
          periods: r.periods,
          hard: r.hard,
        }));
        const resOps = applyOps(school, ops);
        if (resOps.changed || resOps.changes.length > 0) {
          const cleanSchool = sanitizePlacementRuleConflicts(resOps.school, ops);
          const appliedChanges = resOps.changes;
          return {
            handled: true,
            reply:
              `✓ تم تنفيذ التعديل المطلوب بنجاح وتحديث وثيقة المدرسة (.md):\n` +
              appliedChanges.map((c) => `✓ ${c}`).join("\n") +
              `\nوجاري إعادة بناء وتوزيع الجدول تلقائياً بضمان 0% تعارضات.`,
            updated_school: cleanSchool,
            updated_markdown: generateSchoolMarkdown(cleanSchool, appliedChanges),
            should_solve: true,
            applied_changes: appliedChanges,
          };
        }
      }
    }
  }

  // 9B. Single-Teacher Complex / Compound Rule Handler (prevents schoolCore isLastSlots/isFirstSlots from dropping off_days or day_counts)
  const hasExplicitGradeScope =
    /(?:اول[يى]|ثاني[ةه]|تاني[ةه]|ثالث[ةه]|تالت[ةه]|رابع[ةه]|خامس[ةه]|سادس[ةه])\s*(?:ابتدائي|اعدادي|ثانوي)|الصف\s+(?:ال)?(?:اول|ثاني|ثالث|رابع|خامس|سادس)/.test(
      n
    ) && !/(?:استاذ|مس|كابتن|معلم|مدرس|شيخ)/.test(n);
  if (!/(?:بدل|استبدل|شيل.*وحط|مع بعض)/.test(n) && !hasExplicitGradeScope) {
    const cleanMsgForTeachers = message
      .replace(/(?:يمشوا|بيمشوا|يمشي|بيمشي|يطلع|بيطلع|يروح|بيروح)\s+بدري/g, " ")
      .replace(/\b[1-6]\s*[\/\\]\s*[1-9]\b/g, " ");
    const singleTeachers = findTeachersInMessage(school, cleanMsgForTeachers);
    if (singleTeachers.length === 1) {
      const targetTeacher = singleTeachers[0];
      const strippedBody = message
        .replace(new RegExp(targetTeacher.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), " ")
        .trim();
      const parsed = parseRuleText(strippedBody, getOrderedSchoolDays(school));
      const hasCompoundRules =
        (parsed.off_days.length > 0 && (parsed.rules.length > 0 || parsed.day_counts.length > 0)) ||
        (parsed.day_counts.length > 0 && parsed.rules.length > 0);
      if (hasCompoundRules) {
        const ops: Op[] = [];
        if (parsed.off_days.length > 0) {
          ops.push({ op: "set_teacher_days", teacher: targetTeacher.name, off_days: parsed.off_days });
        }
        for (const r of parsed.rules) {
          const dayCap = parsed.day_counts.find((dc) => dc.day === r.day && dc.type === "MAX")?.count;
          const nAdj = (r.type === "FIRST_N" || r.type === "LAST_N") && dayCap && (r.n || 4) > dayCap ? dayCap : r.n;
          ops.push({
            op: "add_placement_rule",
            teacher: targetTeacher.name,
            day: r.day,
            type: r.type,
            n: nAdj,
            periods: r.periods,
            hard: r.hard,
          });
        }
        for (const dc of parsed.day_counts) {
          ops.push({
            op: "set_daily_count",
            teacher: targetTeacher.name,
            day: dc.day,
            count: dc.count,
            rule_type: dc.type,
            hard: true,
          });
        }
        if (ops.length > 0) {
          const resOps = applyOps(school, ops);
          if (resOps.changed || resOps.changes.length > 0) {
            const cleanSchool = sanitizePlacementRuleConflicts(resOps.school, ops);
            const appliedChanges = resOps.changes;
            return {
              handled: true,
              reply:
                `✓ تم تنفيذ التعديلات المركّبة بنجاح وتحديث وثيقة المدرسة (.md):\n` +
                appliedChanges.map((c) => `✓ ${c}`).join("\n") +
                `\nوجاري إعادة بناء وتوزيع الجدول تلقائياً بضمان 0% تعارضات.`,
              updated_school: cleanSchool,
              updated_markdown: generateSchoolMarkdown(cleanSchool, appliedChanges),
              should_solve: true,
              applied_changes: appliedChanges,
            };
          }
        }
      }
    }
  }

  // 10. Compound Multi-Teacher Rule Dispatcher (e.g. "خلي الحصة الأخيرة يوم الأحد لناصر وبلاش لبدري وريا")
  if (!/(?:بدل|استبدل|شيل.*وحط|مع بعض)/.test(n)) {
    const multiTeachers = findTeachersInMessage(school, message.replace(/\b[1-6]\s*[\/\\]\s*[1-9]\b/g, " "));
    if (multiTeachers.length >= 2) {
      const sortedMatches = [...multiTeachers].sort(
        (a, b) => message.indexOf(a.name) - message.indexOf(b.name)
      );
      const contrastSplit = message.split(/(?=\s+(?:وبلاش|بلاش|وما|ماعدا|وليس|دون|بدون|واما|أما)\s+)/);
      const baseClause = contrastSplit[0] || message;
      let sharedStrip = baseClause;
      for (const t of sortedMatches) {
        sharedStrip = sharedStrip.replace(new RegExp(t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), " ");
      }
      const baseParsed = parseRuleText(sharedStrip, getOrderedSchoolDays(school));

      const allOps: Op[] = [];
      for (let idx = 0; idx < contrastSplit.length; idx++) {
        const seg = contrastSplit[idx].trim();
        const segTeachers = findTeachersInMessage(school, seg);
        if (segTeachers.length === 0) continue;

        let segBody = seg;
        for (const t of segTeachers) {
          segBody = segBody.replace(new RegExp(t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), " ");
        }
        const segNorm = normAr(segBody);
        const isSegNeg = /^(?:و\s*)?(?:بلاش|لا|ممنوع|بدون|دون|ماعدا|ليس)/.test(segNorm);
        let segParsed = parseRuleText(segBody, getOrderedSchoolDays(school));

        // Inherit slot/day from baseClause when trailing contrast says "وبلاش لبدري وريا"
        if (segParsed.rules.length === 0 && isSegNeg && baseParsed.rules.length > 0) {
          const inverted = baseParsed.rules.map((r) => {
            if (r.type === "LAST_N" || r.type === "HAS_LAST") return { ...r, type: "AVOID_LAST" as const };
            if (r.type === "FIRST_N") return { ...r, type: "AVOID_FIRST" as const };
            if (r.type === "EXACT_PERIODS") return { ...r, type: "AVOID_PERIODS" as const };
            return r;
          });
          segParsed = { ...baseParsed, rules: inverted };
        }

        for (const tch of segTeachers) {
          if (segParsed.off_days.length > 0) {
            allOps.push({ op: "set_teacher_days", teacher: tch.name, off_days: segParsed.off_days });
          }
          for (const r of segParsed.rules) {
            allOps.push({
              op: "add_placement_rule",
              teacher: tch.name,
              day: r.day,
              type: r.type,
              n: r.n,
              periods: r.periods,
              hard: r.hard,
            });
          }
          for (const dc of segParsed.day_counts) {
            allOps.push({
              op: "set_daily_count",
              teacher: tch.name,
              day: dc.day,
              count: dc.count,
              rule_type: dc.type,
              hard: true,
            });
          }
        }
      }

        if (allOps.length > 0) {
        const resOps = applyOps(school, allOps);
        if (resOps.changed || resOps.changes.length > 0) {
          const cleanSchool = sanitizePlacementRuleConflicts(resOps.school, allOps);
          const appliedChanges = resOps.changes;
          return {
            handled: true,
            reply:
              `✓ تم تنفيذ التعديلات المتعددة للمعلمين بنجاح وتحديث وثيقة المدرسة (.md):\n` +
              appliedChanges.map((c) => `✓ ${c}`).join("\n") +
              `\nوجاري إعادة بناء وتوزيع الجدول تلقائياً بضمان 0% تعارضات.`,
            updated_school: cleanSchool,
            updated_markdown: generateSchoolMarkdown(cleanSchool, appliedChanges),
            should_solve: true,
            applied_changes: appliedChanges,
          };
        }
      }
    }
  }

  // 11. Fair / Balanced Teacher Distribution ("عايز توزيع عادل للمعلمين" / "وازن أنصبة المعلمين" / "التوزيع بالتساوي")
  if (
    /(?:توزيع\s*عادل|عدال[ةه]\s*(?:التوزيع|المعلمين|الحصص|الانصب[ةه])|بالتساوي\s*(?:علي|بين)\s*المعلمين|(?:وز[ّ]?ع|اعمل|طبق|خلي|عايز|اريد|اضبط|سو|سوي).*(?:توزيع\s*متوازن|توازن|عادل|عدال[ةه]|موازن[ةه])|(?:وازن|موازن[ةه]|ساوي)\s*(?:بين\s*)?(?:انصب[ةه]|حصص|المعلمين))/.test(
      n
    )
  ) {
    const wantsQuotasOnly = /(?:انصب[ةه]|نصاب|زملاء|التخصص|الماده|ماده)/.test(n) && !/(?:يومي|الايام|تتابع|حصص ورا بعض)/.test(n);
    const wantsDailyOnly = /(?:يومي|الايام|تتابع|حصص ورا بعض|الحصه الاولي|الاخيره)/.test(n) && !/(?:انصب[ةه]|نصاب|ساوي بين)/.test(n);
    const mode: "daily" | "quotas" | "both" = wantsQuotasOnly ? "quotas" : wantsDailyOnly ? "daily" : "both";
    const subjectFilter = resolved.subject;
    const fairRes = applyFairTeacherDistribution(school, mode, subjectFilter?.id);
    if (fairRes.changed) {
      return {
        handled: true,
        reply: fairRes.reply,
        updated_school: fairRes.school,
        updated_markdown: generateSchoolMarkdown(fairRes.school, fairRes.changes),
        should_solve: true,
        applied_changes: fairRes.changes,
      };
    }
    return {
      handled: true,
      reply:
        `✅ توزيع المعلمين في "${school.name}" متوازن بالفعل ضمن الحدود الممكنة دون الإخلال بشروط الإجازات والفصول!\n` +
        fairRes.reportSummary,
      should_solve: false,
      applied_changes: [],
    };
  }

  return null;
}

/**
 * Removes contradictory placement_rules on the same teacher & day when a newly
 * applied rule overrides the opposite polarity (e.g., AVOID_FIRST vs FIRST_N).
 */
export function sanitizePlacementRuleConflicts(
  school: SchoolData,
  ops: ReadonlyArray<{ op?: string; teacher?: string; type?: string; day?: number | number[] | null; periods?: unknown }>
): SchoolData {
  const placementOps = (ops || []).filter((o) => o?.op === "add_placement_rule" && o.teacher && o.type);
  if (placementOps.length === 0) return school;

  return {
    ...school,
    teachers: school.teachers.map((teacher) => {
      if (!teacher.work_pattern?.placement_rules?.length) return teacher;
      let rules = [...teacher.work_pattern.placement_rules];
      let modified = false;

      for (const op of placementOps) {
        if (normAr(teacher.name) !== normAr(op.teacher || "")) continue;
        const opDays: Array<number | null> =
          op.day === undefined || op.day === null
            ? [null]
            : Array.isArray(op.day)
              ? op.day.map(Number)
              : [Number(op.day)];

        const sameDay = (rDay: number | null | undefined, d: number | null) =>
          d === null ? true : (rDay ?? null) === d;

        for (const d of opDays) {
          if (op.type === "AVOID_FIRST") {
            const before = rules.length;
            rules = rules.filter((r) => !(sameDay(r.day, d) && r.placement_type === "FIRST_N"));
            if (rules.length !== before) modified = true;
          } else if (op.type === "FIRST_N") {
            const before = rules.length;
            rules = rules.filter((r) => !(sameDay(r.day, d) && r.placement_type === "AVOID_FIRST"));
            if (rules.length !== before) modified = true;
          } else if (op.type === "AVOID_LAST") {
            const before = rules.length;
            rules = rules.filter((r) => !(sameDay(r.day, d) && r.placement_type === "LAST_N"));
            if (rules.length !== before) modified = true;
          } else if (op.type === "LAST_N") {
            const before = rules.length;
            rules = rules.filter((r) => !(sameDay(r.day, d) && r.placement_type === "AVOID_LAST"));
            if (rules.length !== before) modified = true;
          } else if (op.type === "AVOID_PERIODS" && Array.isArray(op.periods) && op.periods.length > 0) {
            const blocked = new Set((op.periods as unknown[]).map(Number));
            rules = rules.flatMap((r) => {
              if (!sameDay(r.day, d)) return [r];
              if (r.placement_type === "EXACT_PERIODS" && Array.isArray(r.exact_periods)) {
                const kept = r.exact_periods.filter((p) => !blocked.has(p));
                if (kept.length !== r.exact_periods.length) modified = true;
                return kept.length > 0 ? [{ ...r, exact_periods: kept }] : [];
              }
              if (r.placement_type === "FIRST_N" && (r.n_periods ?? 1) === 1 && blocked.has(1)) {
                modified = true;
                return [];
              }
              return [r];
            });
          }
        }
      }

      if (!modified) return teacher;
      return {
        ...teacher,
        work_pattern: {
          ...teacher.work_pattern,
          placement_rules: rules,
        },
      };
    }),
  };
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

/**
 * Executes structured `ops` returned by Gemini LLM deterministically via `applyOps`
 * (with conflict cleanup), falling back safely to validated `updated_school` or Q&A text.
 */
export function executeGeminiParsedResponse(
  school: SchoolData,
  currentMarkdown: string,
  parsed: any,
  validateSchoolSchemaFn?: (candidate: any) => { valid: boolean; school?: SchoolData }
): {
  reply: string;
  updated_markdown: string;
  updated_school: SchoolData;
  should_solve: boolean;
  applied_changes: string[];
} {
  const opsList: Op[] = Array.isArray(parsed?.ops) ? parsed.ops : [];
  if (opsList.length > 0) {
    const resOps = applyOps(school, opsList);
    if (resOps.changed || resOps.changes.length > 0) {
      const cleanSchool = sanitizePlacementRuleConflicts(resOps.school, opsList);
      const changes = resOps.changes;
      const baseReply = typeof parsed?.reply === "string" && parsed.reply.trim()
        ? parsed.reply.trim()
        : "✓ تم تنفيذ التعديل المطلوب بنجاح:";
      const hasChecklist = changes.every((c) => baseReply.includes(c));
      return {
        reply: hasChecklist
          ? baseReply
          : `${baseReply}\n${changes.map((c) => `✓ ${c}`).join("\n")}\nوجاري إعادة توزيع الجدول بضمان 0% تعارضات.`,
        updated_markdown: generateSchoolMarkdown(cleanSchool, changes),
        updated_school: cleanSchool,
        should_solve: true,
        applied_changes: changes,
      };
    }
  }

  const isMutation = parsed?.should_solve === true && Boolean(parsed?.updated_school);
  let nextSchool = school;
  let validMutation = isMutation;
  if (isMutation && validateSchoolSchemaFn) {
    const check = validateSchoolSchemaFn(parsed.updated_school);
    if (check.valid && check.school) {
      nextSchool = check.school;
    } else {
      validMutation = false;
    }
  } else if (isMutation && parsed?.updated_school) {
    nextSchool = parsed.updated_school;
  }

  const updatedMarkdown =
    validMutation && typeof parsed?.updated_markdown === "string" && parsed.updated_markdown.trim()
      ? parsed.updated_markdown
      : validMutation
        ? generateSchoolMarkdown(nextSchool, Array.isArray(parsed?.applied_changes) ? parsed.applied_changes.map(String) : [])
        : currentMarkdown;

  return {
    reply: String(parsed?.reply || "").trim() || "تم استلام طلبك.",
    updated_markdown: updatedMarkdown,
    updated_school: validMutation ? nextSchool : school,
    should_solve: validMutation,
    applied_changes: validMutation && Array.isArray(parsed?.applied_changes) ? parsed.applied_changes.map(String) : [],
  };
}

function isVacancyTeacherName(name: string): boolean {
  const n = normAr(name);
  return name.includes("شاغر") || /^(?:استاذ\s+)?س\s*\d*(?:\s|$)/.test(n);
}

/**
 * Analyzes teacher workload & daily schedule fairness (weekly quotas across subject colleagues,
 * daily min/max spread across active days, and first/last period balance).
 */
export function analyzeTeacherFairness(
  school: SchoolData,
  schedule?: Schedule | null
): {
  subjectGaps: Array<{ subjectName: string; minTeacher: string; minLoad: number; maxTeacher: string; maxLoad: number; gap: number }>;
  dailyImbalances: Array<{ teacherName: string; minDayCount: number; maxDayCount: number; spread: number; weekly: number; activeDaysCount: number }>;
  reportLines: string[];
} {
  const orderedDays = getOrderedSchoolDays(school);
  const teacherWeekly = new Map<string, number>();
  for (const t of school.teachers) teacherWeekly.set(t.id, 0);
  for (const a of school.assignments) {
    teacherWeekly.set(a.teacher_id, (teacherWeekly.get(a.teacher_id) || 0) + a.weekly_periods);
  }

  // 1. Weekly quota gaps per subject among non-vacant teachers
  const subjectGaps: Array<{ subjectName: string; minTeacher: string; minLoad: number; maxTeacher: string; maxLoad: number; gap: number }> = [];
  for (const sub of school.subjects) {
    const subjTeachers = new Map<string, number>();
    for (const a of school.assignments) {
      if (a.subject_id !== sub.id) continue;
      const t = school.teachers.find((x) => x.id === a.teacher_id);
      if (!t || isVacancyTeacherName(t.name)) continue;
      subjTeachers.set(t.id, teacherWeekly.get(t.id) || 0);
    }
    if (subjTeachers.size >= 2) {
      const entries = [...subjTeachers.entries()]
        .map(([tid, load]) => ({ name: school.teachers.find((x) => x.id === tid)?.name || tid, load }))
        .sort((a, b) => a.load - b.load);
      const low = entries[0];
      const high = entries[entries.length - 1];
      const gap = high.load - low.load;
      if (gap >= 3) {
        subjectGaps.push({
          subjectName: sub.name,
          minTeacher: low.name,
          minLoad: low.load,
          maxTeacher: high.name,
          maxLoad: high.load,
          gap,
        });
      }
    }
  }
  subjectGaps.sort((a, b) => b.gap - a.gap);

  // 2. Daily load spread across teacher active working days
  const dailyImbalances: Array<{ teacherName: string; minDayCount: number; maxDayCount: number; spread: number; weekly: number; activeDaysCount: number }> = [];
  if (schedule && schedule.entries.length > 0) {
    for (const t of school.teachers) {
      if (isVacancyTeacherName(t.name)) continue;
      const activeDays = orderedDays.filter((d) => t.work_pattern?.day_rules?.[String(d)] !== "MANDATORY_OFF");
      if (activeDays.length < 2) continue;
      const counts = activeDays.map(
        (d) => schedule.entries.filter((e) => e.teacher_id === t.id && e.day === d).length
      );
      const weekly = counts.reduce((s, c) => s + c, 0);
      if (weekly === 0) continue;
      const minD = Math.min(...counts);
      const maxD = Math.max(...counts);
      const spread = maxD - minD;
      if (spread >= 2 || maxD >= 5) {
        dailyImbalances.push({
          teacherName: t.name,
          minDayCount: minD,
          maxDayCount: maxD,
          spread,
          weekly,
          activeDaysCount: activeDays.length,
        });
      }
    }
    dailyImbalances.sort((a, b) => b.spread - a.spread || b.maxDayCount - a.maxDayCount);
  }

  const reportLines: string[] = [];
  if (subjectGaps.length > 0) {
    reportLines.push(
      "• تفاوت الأنصبة الأسبوعية بين زملاء التخصص:",
      ...subjectGaps.slice(0, 4).map(
        (g) => `  - ${g.subjectName}: الأعلى أ/ ${g.maxTeacher} (${g.maxLoad} ح) مقابل الأقل أ/ ${g.minTeacher} (${g.minLoad} ح) [فارق ${g.gap} حصص]`
      )
    );
  } else {
    reportLines.push("• الأنصبة الأسبوعية بين زملاء كل تخصص متقاربة ولا يوجد تفاوت كبير.");
  }

  if (dailyImbalances.length > 0) {
    reportLines.push(
      "• تباين التوزيع اليومي في الجدول الحالي (أعلى يوم مقابل أقل يوم):",
      ...dailyImbalances.slice(0, 5).map(
        (d) => `  - أ/ ${d.teacherName} (${d.weekly}ح على ${d.activeDaysCount} أيام): من ${d.minDayCount} إلى ${d.maxDayCount} حصص يومياً (فارق ${d.spread})`
      )
    );
  } else if (schedule && schedule.entries.length > 0) {
    reportLines.push("• التوزيع اليومي لحصص المعلمين متقارب (أقصى فارق ≤ 1 حصة بين الأيام).");
  }

  return { subjectGaps, dailyImbalances, reportLines };
}

/**
 * Applies fair teacher distribution across two verified, 0-conflict dimensions:
 * 1) Rebalancing whole section-subject assignments between colleagues of the same subject when gap >= 4,
 * 2) Tightening daily max caps & consecutive limits (`max_daily_periods`, `max_consecutive_periods <= 3`,
 *    `minimize_teacher_gaps: true`) verified via `solveSchool`.
 */
export function applyFairTeacherDistribution(
  school: SchoolData,
  mode: "daily" | "quotas" | "both",
  subjectIdFilter?: string
): {
  changed: boolean;
  school: SchoolData;
  changes: string[];
  reply: string;
  reportSummary: string;
} {
  let working: SchoolData = JSON.parse(JSON.stringify(school));
  const changes: string[] = [];
  const orderedDays = getOrderedSchoolDays(working);
  const schoolMaxDaily = Math.max(1, working.periods_per_day || 6);

  // Step A: Balance weekly assignments across non-vacant colleagues of the same subject
  if (mode === "quotas" || mode === "both") {
    const teacherLoad = (s: SchoolData, tid: string) =>
      s.assignments.filter((a) => a.teacher_id === tid).reduce((acc, a) => acc + a.weekly_periods, 0);

    const targetSubjects = subjectIdFilter
      ? working.subjects.filter((sub) => sub.id === subjectIdFilter)
      : working.subjects;

    for (const sub of targetSubjects) {
      for (let round = 0; round < 6; round++) {
        const colleagues = working.teachers.filter(
          (t) =>
            !isVacancyTeacherName(t.name) &&
            working.assignments.some((a) => a.teacher_id === t.id && a.subject_id === sub.id)
        );
        if (colleagues.length < 2) break;
        const sorted = [...colleagues].sort((a, b) => teacherLoad(working, a.id) - teacherLoad(working, b.id));
        const lowT = sorted[0];
        const highT = sorted[sorted.length - 1];
        const lowLoad = teacherLoad(working, lowT.id);
        const highLoad = teacherLoad(working, highT.id);
        const gap = highLoad - lowLoad;
        if (gap < 4) break;

        // Candidate transferable assignment from highT for `sub.id` that shrinks the gap without inverting it badly
        const candidates = working.assignments
          .filter((a) => a.teacher_id === highT.id && a.subject_id === sub.id && a.weekly_periods <= gap - 1)
          .sort((a, b) => a.weekly_periods - b.weekly_periods);

        let movedThisRound = false;
        for (const asgn of candidates) {
          const maxWLow = lowT.max_weekly_periods || 24;
          if (lowLoad + asgn.weekly_periods > maxWLow) continue;
          const testSchool: SchoolData = {
            ...working,
            assignments: working.assignments.map((a) =>
              a.id === asgn.id ? { ...a, teacher_id: lowT.id } : a
            ),
            teachers: working.teachers.map((t) =>
              t.id === lowT.id && !(t.subject_ids || []).includes(sub.id)
                ? { ...t, subject_ids: [...(t.subject_ids || []), sub.id] }
                : t
            ),
          };
          const check = solveSchool(testSchool, { maxTimeMs: 700, polishMs: 120 });
          if (check.validation.is_valid && check.metrics.unplaced_lessons === 0) {
            const secName = working.sections.find((s) => s.id === asgn.section_id)?.name || asgn.section_id;
            working = testSchool;
            changes.push(
              `موازنة ${sub.name}: نقل فصل ${secName} (${asgn.weekly_periods} حصة) من أ/ ${highT.name} (${highLoad}←${highLoad - asgn.weekly_periods}) إلى أ/ ${lowT.name} (${lowLoad}←${lowLoad + asgn.weekly_periods})`
            );
            movedThisRound = true;
            break;
          }
        }
        if (!movedThisRound) break;
      }
    }
  }

  // Step B: Fair Daily Spread & Consecutive Load Balance (strict feasibility guard)
  let dailyBalancedCount = 0;
  if (mode === "daily" || mode === "both") {
    const tightCaps = new Map<string, number>();
    const prevCaps = new Map<string, number | null | undefined>();
    const prevConsec = new Map<string, number | undefined>();

    working = {
      ...working,
      rules: {
        ...(working.rules || {}),
        minimize_teacher_gaps: true,
      },
      teachers: working.teachers.map((t) => {
        if (isVacancyTeacherName(t.name)) return t;
        const w = working.assignments.filter((a) => a.teacher_id === t.id).reduce((s, a) => s + a.weekly_periods, 0);
        const activeCount = Math.max(
          1,
          orderedDays.filter((d) => t.work_pattern?.day_rules?.[String(d)] !== "MANDATORY_OFF").length
        );
        if (w <= 0 || activeCount < 2) return t;

        const avgCeil = Math.ceil(w / activeCount);
        const targetCap = Math.min(
          t.max_daily_periods || schoolMaxDaily,
          Math.max(2, avgCeil + (t.force_double_periods ? 1 : 0))
        );
        const targetConsec = Math.min(t.max_consecutive_periods || 3, 3);
        const capImproved = !t.max_daily_periods || targetCap < t.max_daily_periods;
        const consecImproved = !t.max_consecutive_periods || t.max_consecutive_periods > targetConsec;

        if (capImproved || consecImproved) {
          prevCaps.set(t.id, t.max_daily_periods);
          prevConsec.set(t.id, t.max_consecutive_periods);
          tightCaps.set(t.id, targetCap);
          dailyBalancedCount++;
          return {
            ...t,
            max_daily_periods: targetCap,
            max_consecutive_periods: targetConsec,
            work_pattern: t.work_pattern
              ? { ...t.work_pattern, minimize_gaps: true }
              : { day_rules: {}, daily_period_rules: [], placement_rules: [], minimize_gaps: true },
          };
        }
        return t;
      }),
    };

    if (dailyBalancedCount > 0) {
      let check = solveSchool(working, { maxTimeMs: 1200, polishMs: 250 });
      // Auto-relax by +1 if any tight daily cap blocks feasibility
      let relaxRound = 0;
      while ((!check.validation.is_valid || check.metrics.unplaced_lessons > 0) && relaxRound < 3) {
        relaxRound++;
        working = {
          ...working,
          teachers: working.teachers.map((t) => {
            const c = tightCaps.get(t.id);
            if (c === undefined) return t;
            const nextC = Math.min(prevCaps.get(t.id) || schoolMaxDaily, c + 1);
            tightCaps.set(t.id, nextC);
            return { ...t, max_daily_periods: nextC };
          }),
        };
        check = solveSchool(working, { maxTimeMs: 1200, polishMs: 250 });
      }
      if (!check.validation.is_valid || check.metrics.unplaced_lessons > 0) {
        // Safe rollback of daily tightening if external constraints conflict
        working = {
          ...working,
          teachers: working.teachers.map((t) =>
            prevCaps.has(t.id)
              ? { ...t, max_daily_periods: prevCaps.get(t.id) ?? undefined, max_consecutive_periods: prevConsec.get(t.id) }
              : t
          ),
        };
        dailyBalancedCount = 0;
      } else {
        changes.push(
          `ضبط التوزيع اليومي المتوازن لـ ${dailyBalancedCount} معلماً (الحد اليومي متناسب مع النصاب + حد التتابع ≤ 3 + تقليل الفجوات)`
        );
      }
    }
  }

  const finalCheck = analyzeTeacherFairness(working, solveSchool(working, { maxTimeMs: 1200, polishMs: 300 }).schedule);
  const reportSummary = finalCheck.reportLines.join("\n");

  if (changes.length === 0) {
    return { changed: false, school, changes: [], reply: "", reportSummary };
  }

  return {
    changed: true,
    school: working,
    changes,
    reply:
      `⚖️ تم تطبيق **التوزيع العادل والمتوازن للمعلمين** بضمان 0% تعارضات:\n` +
      changes.map((c) => `✓ ${c}`).join("\n") +
      `\n\n📊 حالة التوازن بعد الضبط:\n${reportSummary}\n\nوجاري إعادة عرض الجدول المحدّث.`,
    reportSummary,
  };
}
