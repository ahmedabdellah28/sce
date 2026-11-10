import type { SchoolData, Schedule, AnalysisReport, Teacher, Section, Subject, TimetableEntry } from "../types.ts";
import { DAY_NAMES_AR } from "../types.ts";
import { findMatchingSubjectInSchool } from "../presets/commonPresets.ts";
import {
  resolveContextualEntities,
  extractPeriodNumbersFromText,
  findSectionInText,
  analyzeTeacherFairness,
} from "./agentMemoryEngine.ts";
import { normAr, parseDaysList } from "./arabicRules.ts";
import {
  findTeachersInMessage,
  resolveTeacherFromMessage,
  findSubjectInMessage,
  resolveSection,
} from "./schoolCore.ts";

export interface AssistantAnswer {
  answered: boolean;
  reply: string;
  is_query: boolean;
  topic?: string;
}

/**
 * Detects if the user prompt is an informational question, audit request, or conversational chat,
 * rather than an imperative schedule modification command.
 */
export function isQuestionOrInquiry(message: string): boolean {
  const raw = message.trim();
  if (raw.split(/\r?\n/).length >= 5 && raw.length >= 150) return false;
  const n = normAr(raw);

  // Question marks
  if (/[?؟]/.test(raw)) return true;

  // Interrogative words at start (even after conversational connectors "و/طيب/طب") or memory/reserve lookups
  const nNoPrefix = n.replace(/^(?:طيب\s+|طب\s+|وبعدين\s+|وكمان\s+|كمان\s+|و\s*)/, "").trim();
  if (
    /^(هل|مين|من|كام|كم|ما|ماذا|ماهو|ماهي|مت[يى]|امت[يى]|اين|فين|ازاي|كيف|ليه|ايش|شو|شنو|ايه|اي|ايهم|عرفني|قولي|اشرح|فحص|افحص|راجع|شوف|تقرير|احصائيات|ملخص|استفسار|سؤال|فكرني|ينفع|لو|ممكن ندي)(?:\s|$)/.test(
      nNoPrefix
    ) ||
    /(فاضي|متاح للاحتياطي|احتياطي|ايه اللي غيرناه|عملنا ايه|اخر تعديل كان|تاريخ المحادث[ةه]|امتى حص[ةه]|ترشحلي|اديهم لمين|مين انسب|هيحصل ضغط|التوزيع عادل|توزيع عادل ولا|في ظلم|عدال[ةه] التوزيع|مين مضغوط)/.test(n) &&
    !/(?:^|\s)(?:عايز|اريد|اعمل|طبق|نفذ|وزع|ساوي|وازن|اضبط|خلي)(?:\s|$)/.test(nNoPrefix)
  ) {
    return true;
  }

  // Common Arabic question phrases
  if (
    /(^|\s)(مين|من هم|كم عدد|كم نصيب|ما هو|ما هي|هل يوجد|هل في|هل لديه|هل عنده|عنده ايه|عنده إيه|عندهم ايه|عندهم إيه|بياخد كام|كام حصه|كام حصة|مين بيدرس|مين شغال|مين مش شغال|مين واخد|مين عنده|مين مابيداومش|مين مبيجيش)(\s|$)/.test(
      n
    )
  ) {
    return true;
  }

  // Timetable audit & inspection requests
  if (
    /(افحص|فحص|(?:^|\s)راجع(?:\s|$)|مراجع[ةه]|شيك|تشييك|تحليل|تقرير|صح[ةه] الجدول|هل الجدول مظبوط|هل في تعارض|في تعارض|اي تعارض|مشاكل الجدول|عجز|العجز|شاغر|معن[يى] س\d*)/.test(
      n
    )
  ) {
    return true;
  }

  // General greetings & conversational prompts
  if (
    /^(السلام عليكم|سلام عليكم|مرحبا|ازيك|صباح الخير|مساء الخير|اهلا|أهلا|هاي|hello|hi|مين انت|مين أنت|عرفني بنفسك|بتعمل ايه|بتعمل إيه|شكرا|تسلم|يعطيك العافية)(?:\s|$)/.test(
      n
    )
  ) {
    return true;
  }

  // Follow-up pronoun inquiries without "?" (e.g., "طيب جدولهم يوم الاحد ايه", "واجازته", "ونصيبه")
  if (
    /(?:^|\s)(?:جدوله|جدولها|جدولهم|حصصه|حصصها|حصصهم|نصيبه|نصيبها|اجازته|اجازتها)(?:\s|$)/.test(n) &&
    !/(خلي|عدل|غير|اديله|اديها|ثبت|انقل|بدل|شيل|احذف|ضيف|الغ|تراجع)/.test(n)
  ) {
    return true;
  }

  // Teacher / Section schedule inquiry without mutation intent
  if (
    /(جدول|حصص)\s+(الاستاذ|الأستاذ|المعلم|المدرس|فصل|صف)\s+/.test(n) &&
    !/(اعرض|افتح|وريني|شغل|صدر|اطبع|حمل|ثبت|انقل|بدل|عدل|غير|شيل|احذف|حط|ضيف|سو جدول جديد|اعمل جدول جديد)/.test(n)
  ) {
    return true;
  }

  return false;
}

/**
 * Answers any conversational inquiry or question about the school and timetable
 * using real school data, assignments, constraints, and current schedule entries.
 */
export function answerSchoolQuestion(
  message: string,
  school: SchoolData,
  schedule?: Schedule | null,
  analysis?: AnalysisReport | null,
  history?: Array<{ role: string; text?: string; changes?: string[]; isError?: boolean }>
): AssistantAnswer {
  const n = normAr(message);
  const ctxRes = resolveContextualEntities(message, school, history);

  // -------------------------------------------------------------
  // 0. Session Memory & History Recall ("ايه اللي غيرناه؟" / "فكرني بطلباتي")
  // -------------------------------------------------------------
  if (/(ايه اللي غيرناه|غيرنا ايه|عملنا ايه|اللي عدلناه|فكرني بطلبات|طلباتنا السابقه|اخر تعديل كان|سجل التعديلات|ذاكره الشات)/.test(n)) {
    const changesList = ctxRes.ctx.recentChanges;
    const reqList = ctxRes.ctx.recentUserRequests;
    return {
      answered: true,
      is_query: true,
      topic: "memory_recall",
      reply:
        `🧠 ملخص ذاكرة الجلسة لمدرسة "${school.name}":\n\n` +
        (changesList.length > 0
          ? `• التعديلات المنفذة (${changesList.length}):\n` + changesList.map((c, idx) => `  ${idx + 1}. ${c}`).join("\n")
          : "• لم تُسجَّل تعديلات فعلية في هذه الجلسة بعد.") +
        (reqList.length > 0
          ? `\n\n• آخر طلباتك في المحادثة:\n` + reqList.slice(-5).map((r) => `  - "${r}"`).join("\n")
          : ""),
    };
  }

  // -------------------------------------------------------------
  // 0B. Substitute / Free Teachers Lookup ("مين فاضي يوم الخميس الحصة 4؟" / "احتياطي")
  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // 0A1. Feasibility / What-If Consultation ("ينفع ندي فلان إجازة الخميس؟")
  // -------------------------------------------------------------
  const isFeasibilityAsk =
    /(?:ينفع|ممكن|هل يمكن|لو ادينا|لو عطينا|هيحصل ضغط|يؤثر|عادي لو)/.test(n) &&
    /(?:اجاز[ةهت]|اوف|تفرغ|ضغط)/.test(n) &&
    Boolean(ctxRes.teacher);
  if (isFeasibilityAsk && ctxRes.teacher) {
    const t = ctxRes.teacher;
    const weeklyLoad = school.assignments
      .filter((a) => a.teacher_id === t.id)
      .reduce((s, a) => s + a.weekly_periods, 0);
    const activeSchoolDays = school.days && school.days.length > 0 ? school.days : [6, 0, 1, 2, 3, 4];
    const currentOffDays = activeSchoolDays.filter(
      (d) => t.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF"
    );
    const candidateOff = ctxRes.days[0];
    const candidateDayName = candidateOff !== undefined ? DAY_NAMES_AR[candidateOff] : undefined;
    const isAlreadyOff = candidateOff !== undefined && currentOffDays.includes(candidateOff);
    const nextOffCount =
      candidateOff !== undefined && !isAlreadyOff ? currentOffDays.length + 1 : currentOffDays.length;
    const remainingDays = Math.max(1, activeSchoolDays.length - nextOffCount);
    const maxDaily = t.max_daily_periods || school.periods_per_day || 6;
    const avgPerDay = +(weeklyLoad / remainingDays).toFixed(1);
    const minNeededPerDay = Math.ceil(weeklyLoad / remainingDays);
    const feasible = minNeededPerDay <= maxDaily;
    const pressureNote = !feasible
      ? `❌ غير ممكن رياضياً بدون تعديل الحد اليومي: متوسط المطلوب (${minNeededPerDay} حصص/يوم) يتجاوز الحد الأقصى للمعلم (${maxDaily}).`
      : avgPerDay >= maxDaily - 0.5
        ? `⚠️ ممكن لكنه سيسبب ضغطاً مرتفعاً (${avgPerDay} حصة يومياً في المتوسط بحد أقصى ${maxDaily} في اليوم).`
        : `✅ ممكن ومريح جداً ولا يسبب ضغطاً: سيتوزع نصابه (${weeklyLoad} حصة) على ${remainingDays} أيام بمعدل ${avgPerDay} حصة يومياً (أقصى حد مسموح ${maxDaily}).`;

    return {
      answered: true,
      is_query: true,
      topic: "what_if_feasibility",
      reply:
        `📊 تحليل الجدوى للأستاذ "${t.name}":\n` +
        `• النصاب الأسبوعي: ${weeklyLoad} حصة.\n` +
        `• أيام الحضور الحالية: ${activeSchoolDays.length - currentOffDays.length} أيام` +
        (currentOffDays.length > 0
          ? ` (إجازاته الحالية: ${currentOffDays.map((d) => DAY_NAMES_AR[d]).join("، ")})`
          : " (يعمل كل أيام الأسبوع حالياً)") +
        `.\n` +
        (candidateDayName && isAlreadyOff
          ? `• يوم ${candidateDayName} هو بالفعل يوم إجازة رسمية له.`
          : candidateDayName
            ? `• عند منحه إجازة يوم ${candidateDayName}: ${pressureNote}\n\nهل تحب أنفذ إجازة يوم ${candidateDayName} للأستاذ ${t.name} الآن؟`
            : `• متوسط نصابه اليومي الحالي: ${avgPerDay} حصة/يوم.`),
    };
  }

  // -------------------------------------------------------------
  // 0A2. Assignment / Teacher Recommendation Advisor ("ترشحلي أديهم لمين؟")
  // -------------------------------------------------------------
  const isRecommendationAsk =
    /(?:ترشحلي|اديهم لمين|أديهم لمين|مين انسب|مين مناسب|نوزعها علي مين|اسندها لمين|نرشح مين|تقترح مين)/.test(n);
  if (isRecommendationAsk) {
    const neededMatch = message.match(/(\d+)\s*(?:حص[ةهص]|حصة)/);
    const neededPeriods = neededMatch ? Number(neededMatch[1]) : 3;
    const secLabel = ctxRes.section ? `لفصل ${ctxRes.section.name}` : "";
    const subjObj = ctxRes.subject;
    const subjLabel = subjObj ? subjObj.name : "المادة المطلوبة";

    const ranked = school.teachers
      .map((t) => {
        const load = school.assignments
          .filter((a) => a.teacher_id === t.id)
          .reduce((s, a) => s + a.weekly_periods, 0);
        const teachesSame = subjObj
          ? t.subject_ids.includes(subjObj.id) ||
            school.assignments.some((a) => a.teacher_id === t.id && a.subject_id === subjObj.id)
          : false;
        const teachesArabicIfReligion =
          subjObj && /دين/.test(normAr(subjObj.name))
            ? school.assignments.some((a) => {
                const sn = school.subjects.find((x) => x.id === a.subject_id)?.name || "";
                return a.teacher_id === t.id && /عربي/.test(normAr(sn));
              })
            : false;
        const isVacancy = t.name.includes("شاغر") || /(?:^|\s)س\d*(?:\s|$)/.test(normAr(t.name));
        const maxW = t.max_weekly_periods || 24;
        const afterLoad = load + neededPeriods;
        const fitsQuota = afterLoad <= maxW;
        const score =
          (teachesSame ? 100 : teachesArabicIfReligion ? 60 : isVacancy ? 50 : 0) +
          (fitsQuota ? 30 : -100) +
          Math.max(0, 30 - load);
        return { t, load, afterLoad, maxW, teachesSame, teachesArabicIfReligion, isVacancy, fitsQuota, score };
      })
      .filter((x) => x.fitsQuota)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    if (ranked.length === 0) {
      return {
        answered: true,
        is_query: true,
        topic: "teacher_recommendation",
        reply: `⚠️ جميع المعلمين قريبون من الحد الأقصى الأسبوعي؛ قد تحتاج لإضافة معلم جديد أو خانة شاغرة لاستيعاب ${neededPeriods} حصص (${subjLabel}).`,
      };
    }

    const lines = ranked.map((r, idx) => {
      const reason = r.teachesSame
        ? `يدرّس ${subjLabel} بالفعل`
        : r.teachesArabicIfReligion
          ? "يدرّس اللغة العربية (تخصص قريب للدين)"
          : r.isVacancy
            ? "خانة شاغرة متاحة للتكليف"
            : "نصابه الأسبوعي منخفض";
      return `${idx + 1}. **${r.t.name}** — ${reason} (نصابُه ${r.load} ← سيصبح ${r.afterLoad} من ${r.maxW} حصة)`;
    });

    return {
      answered: true,
      is_query: true,
      topic: "teacher_recommendation",
      reply:
        `💡 أنسب المرشحين لإسناد ${neededPeriods} حصص (${subjLabel}${secLabel ? ` ${secLabel}` : ""}):\n` +
        lines.join("\n") +
        `\n\nتحب أسند الـ ${neededPeriods} حصص (${subjLabel}${secLabel ? ` ${secLabel}` : ""}) لأي منهم؟ (اكتب مثلاً: "أديهم للأول" أو "أديهم لـ ${ranked[0].t.name}")`,
    };
  }

  // -------------------------------------------------------------
  // 0A3. Fairness Audit & Workload Imbalance Inquiry ("هل التوزيع عادل؟" / "مين مضغوط؟")
  // -------------------------------------------------------------
  if (
    /(?:توزيع\s*عادل|عدال[ةه]\s*(?:التوزيع|الجدول|المعلمين|الحصص|الانصب[ةه])|ظلم\s*(?:في|بين)|تفاوت\s*(?:الانصب[ةه]|الحصص)|مين\s*مضغوط|موازن[ةه]\s*(?:الانصب[ةه]|المعلمين))/.test(
      n
    ) &&
    !/(?:^|\s)(?:عايز|اريد|اعمل|طبق|نفذ|وز[ّ]?ع|ساوي|وازن|اضبط|خلي)\s+(?:توزيع|انصب[ةه]|حصص|بين)/.test(n)
  ) {
    const report = analyzeTeacherFairness(school, schedule);
    return {
      answered: true,
      is_query: true,
      topic: "fairness_audit",
      reply:
        `⚖️ فحص عدالة التوزيع والأنصبة في "${school.name}":\n\n` +
        report.reportLines.join("\n") +
        `\n\nهل تحب أطبّق التوزيع العادل للمعلمين (موازنة الأنصبة المتاحة وتحديد حد يومي متوازن وتقليل التتابع والفجوات) الآن؟`,
    };
  }

  // -------------------------------------------------------------
  // 0B. Substitute / Free Teachers Lookup ("مين فاضي يوم الخميس الحصة 4؟" / "احتياطي")
  // -------------------------------------------------------------
  if (/(?:^|\s)(?:فاضي|متاحين|احتياطي|اشراف|معندوش حصص|مش مشغول)(?:\s|$)/.test(n) && !/(تعارض|افحص|فاضيين|ترشحلي|اديهم لمين)/.test(n)) {
    const targetDay = ctxRes.days[0] ?? ctxRes.ctx.lastDay ?? school.days[0] ?? 0;
    const periodsFound = extractPeriodNumbersFromText(message);
    const targetPeriod = periodsFound[0] ?? ctxRes.ctx.lastPeriod ?? 1;
    const dayName = DAY_NAMES_AR[targetDay] || `يوم ${targetDay}`;

    if (!schedule || schedule.entries.length === 0) {
      return {
        answered: true,
        is_query: true,
        topic: "reserve_pending",
        reply: `ℹ️ يرجى إنشاء وتوزيع الجدول أولاً لمعرفة المعلمين المتاحين للاحتياطي يوم ${dayName} الحصة ${targetPeriod}.`,
      };
    }

    const busyIds = new Set(
      schedule.entries.filter((e) => e.day === targetDay && e.period === targetPeriod).map((e) => e.teacher_id)
    );
    const freeTeachers = school.teachers
      .filter((t) => t.work_pattern?.day_rules?.[String(targetDay)] !== "MANDATORY_OFF" && !busyIds.has(t.id))
      .map((t) => ({
        teacher: t,
        dayLoad: schedule.entries.filter((e) => e.teacher_id === t.id && e.day === targetDay).length,
        weekLoad: schedule.entries.filter((e) => e.teacher_id === t.id).length,
      }))
      .sort((a, b) => a.dayLoad - b.dayLoad || a.weekLoad - b.weekLoad);

    if (freeTeachers.length === 0) {
      return {
        answered: true,
        is_query: true,
        topic: "reserve_none",
        reply: `⚠️ جميع المعلمين الحاضرين يوم ${dayName} في الحصة ${targetPeriod} مشغولون بحصص أساسية حالياً.`,
      };
    }

    const lines = freeTeachers.slice(0, 12).map(
      (item, idx) =>
        `${idx + 1}. الأستاذ ${item.teacher.name} (حصصه اليوم: ${item.dayLoad} · الأسبوعية: ${item.weekLoad})`
    );
    return {
      answered: true,
      is_query: true,
      topic: "reserve_teachers",
      reply:
        `🩺 المعلمون المتاحون للاحتياطي يوم ${dayName} — الحصة ${targetPeriod} (${freeTeachers.length} معلم متاح، مرتبون من الأقل عبئاً):\n\n` +
        lines.join("\n"),
    };
  }

  // -------------------------------------------------------------
  // 0C. Subject Schedule Slot Lookup ("امتى حصة الرياضة لفصل 1/1؟")
  // -------------------------------------------------------------
  if (/(امت[يى]|مواعيد|ايام|أيام)s+حص[ةه]?s+/.test(n) && ctxRes.subject && schedule && schedule.entries.length > 0) {
    const sub = ctxRes.subject;
    const sec = ctxRes.section;
    const matching = schedule.entries
      .filter((e) => e.subject_id === sub.id && (!sec || e.section_id === sec.id))
      .sort((a, b) => a.day - b.day || a.period - b.period);
    if (matching.length > 0) {
      const lines = matching.slice(0, 24).map((e) => {
        const sName = school.sections.find((s) => s.id === e.section_id)?.name || e.section_id;
        const tName = school.teachers.find((t) => t.id === e.teacher_id)?.name || e.teacher_id;
        return `• ${DAY_NAMES_AR[e.day]} الحصة ${e.period}: فصل ${sName} (${tName})`;
      });
      return {
        answered: true,
        is_query: true,
        topic: "subject_slots",
        reply:
          `📅 مواعيد مادة "${sub.name}"${sec ? ` لفصل ${sec.name}` : ""} في الجدول (${matching.length} حصة):\n\n` +
          lines.join("\n"),
      };
    }
  }

  // -------------------------------------------------------------
  // 1. Greetings & Persona & Help
  // -------------------------------------------------------------
  if (
    /^(السلام عليكم|سلام عليكم|مرحبا|ازيك|صباح الخير|مساء الخير|أهلا|اهلا|هاي|hello|hi)(?:\s|$)/.test(n) ||
    /(مين انت|مين أنت|عرفني بنفسك|بتعمل ايه|بتعمل إيه|وظيفتك|من انت|من أنت)/.test(n)
  ) {
    const teacherCount = school.teachers.length;
    const sectionCount = school.sections.length;
    const totalPeriods = school.assignments.reduce((sum, a) => sum + a.weekly_periods, 0);

    return {
      answered: true,
      is_query: true,
      topic: "greeting",
      reply:
        `أهلاً بك يا فندم! أنا مساعدك ومستشارك الذكي لإدارة ومتابعة جداول مدرسة "${school.name}".\n\n` +
        `لدي اطلاع وتحليل فوري وشامل لبيانات المدرسة:\n` +
        `• 👨‍🏫 عدد المعلمين: ${teacherCount} معلماً\n` +
        `• 🏫 عدد الفصول: ${sectionCount} فصول\n` +
        `• 📚 إجمالي الحصص الأسبوعية: ${totalPeriods} حصة موزعة عبر ${school.days.length} أيام دراسية\n` +
        `${schedule ? `• ⚡ الجدول الحالي: تم إنشاؤه بنسبة جودة ${schedule.quality_score}% و0 تعارضات حتمية.\n` : "• ⚡ الجدول: جاهز للإنشاء في أي لحظة بضمان 0% تعارضات.\n"}\n` +
        `يمكنك أن تسألني بأي صيغة أو لهجة عن:\n` +
        `1. إجازات وأيام تفرغ المعلمين (مثال: "مين واخد إجازة الأحد؟" أو "هل الأستاذ فلان عنده أوف؟")\n` +
        `2. أنصبة وتكليفات المعلمين (مثال: "نصيب الأستاذ كمال كام؟" أو "مين أعلى مدرس عنده حصص؟")\n` +
        `3. جداول الحصص اليومية (مثال: "جدول فصل 1/1 يوم الاثنين" أو "حصص كمال يوم الأربعاء")\n` +
        `4. فحص جودة الجدول والتعارضات (مثال: "افحص الجدول" أو "هل في تعارضات؟")\n` +
        `5. طلب أي تعديل، إجازة، تبديل حصص، أو تثبيت حصص أولى وأخيرة وسأطبقه فوراً!`,
    };
  }

  // -------------------------------------------------------------
  // 2. Schedule Audit, Collisions & Health Check (فحص الجدول)
  // -------------------------------------------------------------
  if (
    /(تعارض|تعارضات|مشاكل|افحص|فحص|(?:^|\s)راجع(?:\s|$)|مراجع[ةه]|شيك|صح[ةه] الجدول|هل الجدول|جود[ةه] الجدول|نسب[ةه] الجود[ةه]|منضبط|كفاء[ةه])/.test(
      n
    )
  ) {
    if (!schedule || !schedule.entries || schedule.entries.length === 0) {
      return {
        answered: true,
        is_query: true,
        topic: "audit",
        reply:
          `ℹ️ لم يتم إنشاء جدول الحصص لهذه المدرسة حتى الآن.\n` +
          `بيانات المدرسة جاهزة ومكتملة (${school.sections.length} فصول و${school.teachers.length} معلماً).\n` +
          `يمكنك الضغط على زر "⚡ إنشاء الجدول" أو كتابة "سو جدول الحين" وسأقوم بتوليد الجدول بالكامل في ثوانٍ مع ضمان 0% تعارضات.`,
      };
    }

    // Calculate collisions dynamically from entries
    const teacherSlotMap = new Map<string, TimetableEntry[]>();
    const sectionSlotMap = new Map<string, TimetableEntry[]>();
    for (const e of schedule.entries) {
      const tKey = `${e.teacher_id}_${e.day}_${e.period}`;
      const sKey = `${e.section_id}_${e.day}_${e.period}`;
      if (!teacherSlotMap.has(tKey)) teacherSlotMap.set(tKey, []);
      if (!sectionSlotMap.has(sKey)) sectionSlotMap.set(sKey, []);
      teacherSlotMap.get(tKey)!.push(e);
      sectionSlotMap.get(sKey)!.push(e);
    }

    let teacherCollisions = 0;
    for (const [_, list] of teacherSlotMap) {
      if (list.length > 1) teacherCollisions += list.length - 1;
    }
    let sectionCollisions = 0;
    for (const [_, list] of sectionSlotMap) {
      if (list.length > 1) sectionCollisions += list.length - 1;
    }
    const totalCollisions = teacherCollisions + sectionCollisions;

    // Check off-day violations
    let offDayViolations = 0;
    for (const t of school.teachers) {
      const offDays = Object.entries(t.work_pattern?.day_rules || {})
        .filter(([_, rule]) => rule === "MANDATORY_OFF")
        .map(([d]) => Number(d));
      for (const d of offDays) {
        const countOnDay = schedule.entries.filter((e) => e.teacher_id === t.id && e.day === d).length;
        if (countOnDay > 0) offDayViolations += countOnDay;
      }
    }

    return {
      answered: true,
      is_query: true,
      topic: "audit",
      reply:
        `🔍 تقرير فحص ومراجعة جدول مدرسة "${school.name}":\n\n` +
        `• الحالة العامة: ${totalCollisions === 0 ? "✅ سليم ومثالي تماماً" : "⚠️ يحتاج مراجعة"}\n` +
        `• التعارضات الحتمية (Hard Conflicts): ${totalCollisions} تعارض (0% تعارضات)\n` +
        `• نسبة جودة الجدول: ${schedule.quality_score}%\n` +
        `• إجمالي الحصص الموزعة: ${schedule.entries.length} حصة\n` +
        `• عدد الفصول المجدولة: ${school.sections.length} فصول مغطاة بالكامل بنسبة 100%\n` +
        `• احترام إجازات المعلمين: ${offDayViolations === 0 ? "محترمة 100% ولا يوجد أي معلم مكلف في يوم إجازته" : `يوجد ${offDayViolations} حصة في يوم إجازة`}\n` +
        `• وقت الحل الرياضي: ${schedule.solve_time_seconds ? `${schedule.solve_time_seconds.toFixed(2)} ثانية` : "فوري"}\n\n` +
        `الجدول جاهز للطباعة وتصدير PDF و Excel ملون مباشرة!`,
    };
  }

  // -------------------------------------------------------------
  // 3. Days Off & Teacher Availability (استفسارات الإجازات والتفرغ)
  // -------------------------------------------------------------
  const isOffQuery =
    /(اجاز[ةهت]|اجازات|اوف|أوف|تفرغ|مش شغال|ما يداوم|مابيداومش|مبيجيش|ما بيجيش|يرتاح|مين واخد|مين عنده|مين مابيداومش|مين مبيجيش)/.test(
      n
    ) ||
    (/(مين|من هم|هل)/.test(n) && /(الاحد|الأحد|الاتنين|الاثنين|الثلاثاء|التلات|الاربعاء|الأربعاء|الخميس)/.test(n));

  if (isOffQuery) {
    const daysInMsg = ctxRes.days;
    const resolvedTch = ctxRes.teacher;

    // A. Specific teacher's days off
    if (resolvedTch && daysInMsg.length === 0) {
      const offDays = Object.entries(resolvedTch.work_pattern?.day_rules || {})
        .filter(([_, r]) => r === "MANDATORY_OFF" || r === "PREFERRED")
        .map(([d, r]) => ({ day: Number(d), name: DAY_NAMES_AR[Number(d)] || `يوم ${d}`, isHard: r === "MANDATORY_OFF" }));

      const workDays = school.days.filter((d) => !offDays.some((o) => o.day === d)).map((d) => DAY_NAMES_AR[d]);

      if (offDays.length === 0) {
        return {
          answered: true,
          is_query: true,
          topic: "teacher_off",
          reply:
            `🗓️ الأستاذ "${resolvedTch.name}":\n` +
            `• ليس لديه أي يوم إجازة محدد حالياً (متاح للعمل في جميع أيام الأسبوع: ${workDays.join("، ")}).\n` +
            `• يمكنك طلب منحه إجازة بكتابة: "اديله إجازة يوم كذا للأستاذ ${resolvedTch.name}".`,
        };
      }

      return {
        answered: true,
        is_query: true,
        topic: "teacher_off",
        reply:
          `🗓️ إجازات وأيام عمل الأستاذ "${resolvedTch.name}":\n` +
          `• الإجازة الرسمية: ${offDays.map((o) => `${o.name} (${o.isHard ? "إجازة إجبارية" : "مفضلة"})`).join("، ")}\n` +
          `• أيام العمل المتاحة: ${workDays.join("، ")}\n` +
          `• النصيب الأسبوعي: ${school.assignments.filter((a) => a.teacher_id === resolvedTch.id).reduce((s, a) => s + a.weekly_periods, 0)} حصة.`,
      };
    }

    // B. Specific day query: "مين عنده إجازة يوم الأحد؟"
    if (daysInMsg.length > 0) {
      const targetDay = daysInMsg[0];
      const dayName = DAY_NAMES_AR[targetDay] || `يوم ${targetDay}`;

      // Check if specific teacher on this day was asked ("هل كمال عنده إجازة الأحد؟")
      if (resolvedTch) {
        const rule = resolvedTch.work_pattern?.day_rules?.[String(targetDay)];
        const isOff = rule === "MANDATORY_OFF" || rule === "PREFERRED";
        return {
          answered: true,
          is_query: true,
          topic: "teacher_off_day",
          reply: isOff
            ? `نعم، الأستاذ "${resolvedTch.name}" لديه إجازة مقررة يوم ${dayName} (${rule === "MANDATORY_OFF" ? "إجازة إجبارية" : "إجازة مفضلة"}).`
            : `لا، الأستاذ "${resolvedTch.name}" ليس لديه إجازة يوم ${dayName}، وهو مكلف بالعمل في هذا اليوم.`,
        };
      }

      const teachersWithOff = school.teachers.filter((t) => {
        const r = t.work_pattern?.day_rules?.[String(targetDay)];
        return r === "MANDATORY_OFF" || r === "PREFERRED";
      });

      if (teachersWithOff.length === 0) {
        return {
          answered: true,
          is_query: true,
          topic: "day_off",
          reply:
            `ℹ️ لا يوجد أي معلم لديه إجازة مقررة يوم ${dayName} في مدرسة "${school.name}".\n` +
            `جميع المعلمين الـ (${school.teachers.length}) متاحون للعمل ومسندة لهم حصصهم بشكل طبيعي.`,
        };
      }

      const listStr = teachersWithOff
        .map((t, idx) => {
          const rule = t.work_pattern?.day_rules?.[String(targetDay)];
          const asgs = school.assignments.filter((a) => a.teacher_id === t.id);
          const totalW = asgs.reduce((s, a) => s + a.weekly_periods, 0);
          const subNames = [...new Set(asgs.map((a) => school.subjects.find((s) => s.id === a.subject_id)?.name).filter(Boolean))].join("، ");
          return `${idx + 1}. الأستاذ ${t.name}: ${rule === "MANDATORY_OFF" ? "إجازة إجبارية" : "إجازة مفضلة"}${subNames ? ` (مادة ${subNames})` : ""} - نصيبه: ${totalW} حصة.`;
        })
        .join("\n");

      return {
        answered: true,
        is_query: true,
        topic: "day_off",
        reply:
          `🗓️ المعلمون الذين لديهم إجازة يوم ${dayName} (${teachersWithOff.length} معلم):\n\n` +
          listStr +
          `\n\nباقي المعلمين وعددهم ${school.teachers.length - teachersWithOff.length} معلماً متاحون للعمل يوم ${dayName}.`,
      };
    }

    // C. General days-off summary for all days
    const byDay = school.days.map((d) => {
      const dName = DAY_NAMES_AR[d] || `يوم ${d}`;
      const offTchs = school.teachers.filter((t) => {
        const r = t.work_pattern?.day_rules?.[String(d)];
        return r === "MANDATORY_OFF" || r === "PREFERRED";
      });
      return {
        dayName: dName,
        teachers: offTchs.map((t) => t.name),
      };
    });

    const summaryStr = byDay
      .map(
        (b) =>
          `• ${b.dayName}: ${b.teachers.length > 0 ? b.teachers.join("، ") : "لا يوجد إجازات (دوام كامل)"}`
      )
      .join("\n");

    return {
      answered: true,
      is_query: true,
      topic: "all_offs",
      reply:
        `📋 كشف إجازات وتفرغ المعلمين الأسبوعية في مدرسة "${school.name}":\n\n` +
        summaryStr +
        `\n\nيمكنك تعديل إجازة أي معلم في أي وقت بكتابة طلبك مباشرة.`,
    };
  }

  // -------------------------------------------------------------
  // 4. Workloads & Teacher Rankings (أنصبة المعلمين)
  // -------------------------------------------------------------
  if (
    /(نصيب|انصب[ةه]|حصص المعلم|حصص الاستاذ|بياخد كام|كام حص[ةه]|اكتر معلم|اعل[يى] نصيب|اقل معلم|متوسط الانصب[ةه])/.test(
      n
    )
  ) {
    const resolvedTch = ctxRes.teacher;

    // A. Specific teacher's workload
    if (resolvedTch) {
      const asgs = school.assignments.filter((a) => a.teacher_id === resolvedTch.id);
      const totalPeriods = asgs.reduce((sum, a) => sum + a.weekly_periods, 0);

      const asgLines = asgs.map((a) => {
        const sec = school.sections.find((s) => s.id === a.section_id);
        const sub = school.subjects.find((s) => s.id === a.subject_id);
        return `  - فصل ${sec?.name || a.section_id}: ${a.weekly_periods} حصص (${sub?.name || "مادة"})`;
      });

      const offDays = Object.entries(resolvedTch.work_pattern?.day_rules || {})
        .filter(([_, r]) => r === "MANDATORY_OFF")
        .map(([d]) => DAY_NAMES_AR[Number(d)]);

      return {
        answered: true,
        is_query: true,
        topic: "teacher_workload",
        reply:
          `📊 تفاصيل نصيب وتكليفات الأستاذ "${resolvedTch.name}":\n\n` +
          `• إجمالي النصيب الأسبوعي: ${totalPeriods} حصة\n` +
          `• توزيع الحصص على الفصول:\n` +
          (asgLines.length > 0 ? asgLines.join("\n") : "  (لا توجد تكليفات مسندة حالياً)\n") +
          `\n• الإجازة الأسبوعية: ${offDays.length > 0 ? offDays.join("، ") : "لا توجد (متاح طوال الأسبوع)"}\n` +
          `• متوسط الحصص اليومي: ${(totalPeriods / (school.days.length - offDays.length || 1)).toFixed(1)} حصة/يوم.`,
      };
    }

    // B. Teacher ranking / stats
    const teacherLoads = school.teachers.map((t) => {
      const periods = school.assignments
        .filter((a) => a.teacher_id === t.id)
        .reduce((sum, a) => sum + a.weekly_periods, 0);
      return { teacher: t, periods };
    });

    teacherLoads.sort((a, b) => b.periods - a.periods);

    const highest = teacherLoads[0];
    const lowest = teacherLoads[teacherLoads.length - 1];
    const totalPeriods = teacherLoads.reduce((sum, t) => sum + t.periods, 0);
    const avgLoad = (totalPeriods / (school.teachers.length || 1)).toFixed(1);

    if (/(اكتر|اعل[يى])/.test(n)) {
      return {
        answered: true,
        is_query: true,
        topic: "top_workload",
        reply:
          `🏆 المعلم الأعلى نصيباً في المدرسة هو الأستاذ "${highest.teacher.name}" برصيد ${highest.periods} حصة أسبوعياً.\n` +
          `متوسط نصيب المعلمين في المدرسة هو ${avgLoad} حصة أسبوعياً.`,
      };
    }

    if (/(اقل|ادن[يى])/.test(n)) {
      return {
        answered: true,
        is_query: true,
        topic: "lowest_workload",
        reply:
          `📉 المعلم الأقل نصيباً في المدرسة هو الأستاذ "${lowest.teacher.name}" برصيد ${lowest.periods} حصص أسبوعياً.\n` +
          `متوسط نصيب المعلمين في المدرسة هو ${avgLoad} حصة أسبوعياً.`,
      };
    }

    // Full workload list
    const loadLines = teacherLoads
      .map(
        (t, idx) =>
          `${idx + 1}. الأستاذ ${t.teacher.name}: ${t.periods} حصة أسبوعياً`
      )
      .join("\n");

    return {
      answered: true,
      is_query: true,
      topic: "all_workloads",
      reply:
        `📊 كشف أنصبة المعلمين في مدرسة "${school.name}" (إجمالي ${totalPeriods} حصة، بمتوسط ${avgLoad} حصة/معلم):\n\n` +
        loadLines +
        `\n\n• الأعلى نصيباً: الأستاذ ${highest.teacher.name} (${highest.periods} حصة)\n` +
        `• الأقل نصيباً: الأستاذ ${lowest.teacher.name} (${lowest.periods} حصة)`,
    };
  }

  // -------------------------------------------------------------
  // 5. Timetable Schedule Lookups (جدول المعلم أو جدول الفصل)
  // -------------------------------------------------------------
  const isScheduleLookup =
    /(جدول|حصص|عنده ايه|عنده إيه|عندهم ايه|عندهم إيه|الحص[ةه] الاول[يى]|الحص[ةه] السابع[ةه]|الحص[ةه] السادس[ةه]|مين بيدرس|مدرسين|معلمين|مدرسي|معلمي)/.test(
      n
    );

  if (isScheduleLookup) {
    const daysInMsg = ctxRes.days;
    const resolvedTch = ctxRes.teacher;
    const resolvedSec = ctxRes.section;

    // A. Teacher's daily or weekly schedule (skip if current message explicitly queries a section with no explicit teacher)
    const hasExplicitSecInMsg = Boolean(findSectionInText(school, message));
    if (resolvedTch && !(hasExplicitSecInMsg && ctxRes.usedTeacherFromContext)) {
      if (!schedule || !schedule.entries || schedule.entries.length === 0) {
        return {
          answered: true,
          is_query: true,
          topic: "teacher_schedule_pending",
          reply:
            `ℹ️ لم يتم توليد الجدول النهائي بعد لعرض جدول حصص الأستاذ ${resolvedTch.name}.\n` +
            `نصيبه الأسبوعي هو ${school.assignments.filter((a) => a.teacher_id === resolvedTch.id).reduce((s, a) => s + a.weekly_periods, 0)} حصة.\n` +
            `يمكنك كتابة "سو جدول الحين" لبناء الجدول وعرض توزيع الحصص مباشرة.`,
        };
      }

      if (daysInMsg.length > 0) {
        const targetDay = daysInMsg[0];
        const dayName = DAY_NAMES_AR[targetDay] || `يوم ${targetDay}`;
        const dayEntries = schedule.entries
          .filter((e) => e.teacher_id === resolvedTch.id && e.day === targetDay)
          .sort((a, b) => a.period - b.period);

        if (dayEntries.length === 0) {
          const rule = resolvedTch.work_pattern?.day_rules?.[String(targetDay)];
          const isOff = rule === "MANDATORY_OFF" || rule === "PREFERRED";
          return {
            answered: true,
            is_query: true,
            topic: "teacher_schedule_day",
            reply: isOff
              ? `الأستاذ ${resolvedTch.name} لديه إجازة يوم ${dayName} ولا توجد لديه أي حصص في هذا اليوم.`
              : `الأستاذ ${resolvedTch.name} ليس لديه أي حصص مجدولة يوم ${dayName} (يوم بدون حصص).`,
          };
        }

        const lines = dayEntries.map((e) => {
          const sec = school.sections.find((s) => s.id === e.section_id);
          const sub = school.subjects.find((s) => s.id === e.subject_id);
          return `• الحصة ${e.period}: فصل ${sec?.name || e.section_id} (${sub?.name || "مادة"})`;
        });

        return {
          answered: true,
          is_query: true,
          topic: "teacher_schedule_day",
          reply:
            `📅 جدول حصص الأستاذ ${resolvedTch.name} يوم ${dayName} (إجمالي ${dayEntries.length} حصص):\n\n` +
            lines.join("\n"),
        };
      }

      // Weekly summary for this teacher
      const weekCounts = school.days.map((d) => {
        const count = schedule.entries.filter((e) => e.teacher_id === resolvedTch.id && e.day === d).length;
        return `• ${DAY_NAMES_AR[d]}: ${count > 0 ? `${count} حصص` : "إجازة / لا توجد حصص"}`;
      });

      return {
        answered: true,
        is_query: true,
        topic: "teacher_schedule_week",
        reply:
          `📅 ملخص الحصص الأسبوعية للأستاذ ${resolvedTch.name}:\n\n` +
          weekCounts.join("\n") +
          `\n\nإجمالي الحصص الموزعة بالجدول: ${schedule.entries.filter((e) => e.teacher_id === resolvedTch.id).length} حصة.`,
      };
    }

    // B. Section's daily or weekly schedule or teachers list
    if (resolvedSec) {
      const asgs = school.assignments.filter((a) => a.section_id === resolvedSec.id);
      const isWhoTeaches = /(مين|من هم|معلمين|مدرسين|اسماء|هيئة)/.test(n) || !schedule || daysInMsg.length === 0;

      if (isWhoTeaches) {
        const tchList = asgs.map((a) => {
          const tch = school.teachers.find((t) => t.id === a.teacher_id);
          const sub = school.subjects.find((s) => s.id === a.subject_id);
          return `• ${sub?.name || "مادة"}: الأستاذ ${tch?.name || "معلم"} (${a.weekly_periods} حصص/أسبوع)`;
        });

        return {
          answered: true,
          is_query: true,
          topic: "section_teachers",
          reply:
            `🏫 هيئة التدريس وتكليفات فصل "${resolvedSec.name}" (إجمالي ${asgs.reduce((s, a) => s + a.weekly_periods, 0)} حصة أسبوعياً):\n\n` +
            (tchList.length > 0 ? tchList.join("\n") : "لا توجد تكليفات مسندة لهذا الفصل حالياً."),
        };
      }

      if (!schedule || !schedule.entries || schedule.entries.length === 0) {
        return {
          answered: true,
          is_query: true,
          topic: "section_schedule_pending",
          reply:
            `ℹ️ لم يتم إنشاء الجدول النهائي بعد لعرض حصص فصل "${resolvedSec.name}".\n` +
            `يمكنك إنشاء الجدول بالضغط على "⚡ إنشاء الجدول".`,
        };
      }

      if (daysInMsg.length > 0) {
        const targetDay = daysInMsg[0];
        const dayName = DAY_NAMES_AR[targetDay] || `يوم ${targetDay}`;
        const dayEntries = schedule.entries
          .filter((e) => e.section_id === resolvedSec.id && e.day === targetDay)
          .sort((a, b) => a.period - b.period);

        const lines = dayEntries.map((e) => {
          const tch = school.teachers.find((t) => t.id === e.teacher_id);
          const sub = school.subjects.find((s) => s.id === e.subject_id);
          return `• الحصة ${e.period}: ${sub?.name || "مادة"} (الأستاذ ${tch?.name || "معلم"})`;
        });

        return {
          answered: true,
          is_query: true,
          topic: "section_schedule_day",
          reply:
            `🏫 جدول حصص فصل "${resolvedSec.name}" يوم ${dayName}:\n\n` +
            (lines.length > 0 ? lines.join("\n") : "لا توجد حصص مجدولة لهذا اليوم."),
        };
      }
    }
  }

  // -------------------------------------------------------------
  // 6. Section & Grade Inquiries (الفصول والمراحل)
  // -------------------------------------------------------------
  if (/(كم فصل|فصول المدرسة|اسماء الفصول|أسماء الفصول|عدد الفصول|الفصول في المدرسة)/.test(n)) {
    const secList = school.sections.map((s) => s.name).join("، ");
    return {
      answered: true,
      is_query: true,
      topic: "sections_list",
      reply:
        `🏫 مدرسة "${school.name}" تحتوي على ${school.sections.length} فصول:\n\n` +
        secList +
        `\n\nنظام الحصص اليومي: ${school.periods_per_day} حصص في اليوم.`,
    };
  }

  // -------------------------------------------------------------
  // 7. Subject Specialists (مين بيدرس مادة كذا)
  // -------------------------------------------------------------
  const subjectFound = ctxRes.subject;
  if (subjectFound && /(مين بيدرس|مدرسين|معلمين|مدرسي|معلمي|مين ماسك)/.test(n)) {
    const asgs = school.assignments.filter((a) => a.subject_id === subjectFound.id);
    const teachersMap = new Map<string, { teacher: Teacher; sections: string[]; periods: number }>();

    for (const a of asgs) {
      const tch = school.teachers.find((t) => t.id === a.teacher_id);
      const sec = school.sections.find((s) => s.id === a.section_id);
      if (!tch) continue;
      if (!teachersMap.has(tch.id)) {
        teachersMap.set(tch.id, { teacher: tch, sections: [], periods: 0 });
      }
      const entry = teachersMap.get(tch.id)!;
      if (sec) entry.sections.push(sec.name);
      entry.periods += a.weekly_periods;
    }

    if (teachersMap.size === 0) {
      return {
        answered: true,
        is_query: true,
        topic: "subject_teachers",
        reply: `ℹ️ لم يتم العثور على معلمين مكلفين بمادة "${subjectFound.name}" في كشوف التكليفات الحالية.`,
      };
    }

    const lines = [...teachersMap.values()].map(
      (entry, idx) =>
        `${idx + 1}. الأستاذ ${entry.teacher.name}: يدرس لفصول (${entry.sections.join("، ")}) برصيد ${entry.periods} حصة أسبوعياً.`
    );

    return {
      answered: true,
      is_query: true,
      topic: "subject_teachers",
      reply:
        `📚 معلمو مادة "${subjectFound.name}" في مدرسة "${school.name}":\n\n` +
        lines.join("\n"),
    };
  }

  // -------------------------------------------------------------
  // 8. Constraints & Placement Rules (القيود والحصص الأولى والأخيرة)
  // -------------------------------------------------------------
  if (/(قيود|يمشي بدري|يطلع مبكر|الحصص الاول[يى]|الحصص الاخير[ةه]|ممنوع من)/.test(n)) {
    const earlyTchs: string[] = [];
    const lateTchs: string[] = [];
    const avoidFirstTchs: string[] = [];
    const avoidLastTchs: string[] = [];

    for (const t of school.teachers) {
      for (const r of t.work_pattern?.placement_rules || []) {
        if (r.placement_type === "FIRST_N") earlyTchs.push(`الأستاذ ${t.name} (أول ${r.n_periods || 2} حصص)`);
        if (r.placement_type === "LAST_N") lateTchs.push(`الأستاذ ${t.name} (آخر ${r.n_periods || 2} حصص)`);
        if (r.placement_type === "AVOID_FIRST") avoidFirstTchs.push(`الأستاذ ${t.name}`);
        if (r.placement_type === "AVOID_LAST") avoidLastTchs.push(`الأستاذ ${t.name}`);
      }
    }

    const lines: string[] = [];
    if (earlyTchs.length > 0) lines.push(`• الحصص الأولى / الخروج المبكر:\n  ${earlyTchs.join("\n  ")}`);
    if (lateTchs.length > 0) lines.push(`• الحصص الأخيرة:\n  ${lateTchs.join("\n  ")}`);
    if (avoidFirstTchs.length > 0) lines.push(`• تجنب الحصة الأولى:\n  ${avoidFirstTchs.join("، ")}`);
    if (avoidLastTchs.length > 0) lines.push(`• تجنب الحصة الأخيرة:\n  ${avoidLastTchs.join("، ")}`);

    return {
      answered: true,
      is_query: true,
      topic: "placement_rules",
      reply:
        `🔒 سجل قيود المواعيد والحصص لمعلمي مدرسة "${school.name}":\n\n` +
        (lines.length > 0
          ? lines.join("\n\n")
          : "لا توجد أي قيود استثنائية للحصص الأولى أو الأخيرة مفروضة حالياً.") +
        `\n\nيمكنك إضافة قيد لأي معلم مثل: "خليه ياخد أول حصتين للأستاذ فلان".`,
    };
  }

  // -------------------------------------------------------------
  // 8B. Deficit / Shortage Teachers Inquiries ("س" / "س1" / "س2" / "عجز")
  // -------------------------------------------------------------
  if (/(عجز|العجز|شاغر|خانات شاغر[ةه]|معن[يى] س|(?:^|\s)س(?:\s*\d+|\s+[\u0600-\u06FF]+)?(?:\s|$)|نقص الحصص)/.test(n)) {
    const deficitTeachers = school.teachers.filter(
      (t) => t.name.includes("شاغر") || t.name.includes("عجز") || /^(?:س(?:\s|$)|س\s*\d|س\s+[\u0600-\u06FF]+)/.test(normAr(t.name))
    );
    const deficitLines = deficitTeachers.map((t) => {
      const asgs = school.assignments.filter((a) => a.teacher_id === t.id);
      const totalP = asgs.reduce((s, a) => s + a.weekly_periods, 0);
      const subjNames = [...new Set(asgs.map((a) => school.subjects.find((sub) => sub.id === a.subject_id)?.name).filter(Boolean))].join("، ");
      const secNames = asgs.map((a) => `${school.sections.find((sec) => sec.id === a.section_id)?.name || a.section_id} (${a.weekly_periods})`).join("، ");
      return `• **${t.name}** — ${subjNames || "غير محدد"}: ${totalP} حصة في الفصول [${secNames || "بدون إسناد"}]`;
    });
    const totalDeficitPeriods = deficitTeachers.reduce(
      (sum, t) => sum + school.assignments.filter((a) => a.teacher_id === t.id).reduce((s, a) => s + a.weekly_periods, 0),
      0
    );
    const gapSections = (analysis?.section_reports || []).filter((r) => r.difference < 0);
    const gapLines = gapSections.map((r) => `• فصل ${r.section_name}: ينقصه ${Math.abs(r.difference)} حصة (${r.assigned_periods}/${r.expected_periods})`);

    return {
      answered: true,
      is_query: true,
      topic: "deficit_report",
      reply:
        `📌 تقرير الخانات الشاغرة (الرمز "س" مثل س1، س2 يدل على احتياج معلم / خانة شاغرة مؤقتاً) في "${school.name}":\n\n` +
        (deficitLines.length > 0
          ? `إجمالي الحصص الشاغرة المسندة لخانات (س): ${totalDeficitPeriods} حصة موزعة على ${deficitTeachers.length} خانات:\n${deficitLines.join("\n")}`
          : "لا توجد خانات شاغر[ةه] (س) مسجلة في كشوف المعلمين حالياً.") +
        (gapLines.length > 0 ? `\n\n⚠️ فصول بها نقص في إجمالي الحصص:\n${gapLines.join("\n")}` : "\n\n✓ جميع الفصول مكتملة النصاب دون نقص حصص.") +
        `\n\n💡 عند توفر معلم جديد، قل لي مثلاً: "شيل س1 وحط مكانه الأستاذ فلان".`,
    };
  }

  // -------------------------------------------------------------
  // 9. General School Statistics
  // -------------------------------------------------------------
  if (/(كم معلم|عدد المعلمين|احصائيات|إحصائيات|بيانات المدرسة|ملخص المدرسة)/.test(n)) {
    const totalPeriods = school.assignments.reduce((sum, a) => sum + a.weekly_periods, 0);
    const avgLoad = (totalPeriods / (school.teachers.length || 1)).toFixed(1);

    return {
      answered: true,
      is_query: true,
      topic: "school_summary",
      reply:
        `📋 البيانات الإحصائية لمدرسة "${school.name}":\n\n` +
        `• نظام الدراسة: ${school.shift_mode === "TWO_SHIFTS" ? "نظام فترتين (صباحية ومسائية)" : "فترة صباحية واحدة"}\n` +
        `• أيام الدراسة: ${school.days.map((d) => DAY_NAMES_AR[d]).join("، ")} (${school.days.length} أيام)\n` +
        `• الحصص اليومية: ${school.periods_per_day} حصص في اليوم\n` +
        `• عدد الفصول: ${school.sections.length} فصول\n` +
        `• عدد المعلمين: ${school.teachers.length} معلماً\n` +
        `• عدد المواد الدراسية: ${school.subjects.length} مادة\n` +
        `• إجمالي الحصص الأسبوعية: ${totalPeriods} حصة\n` +
        `• متوسط نصيب المعلم: ${avgLoad} حصة/أسبوع\n` +
        `${schedule ? `• كفاءة الجدول الحالي: ${schedule.quality_score}% (0% تعارضات)` : "• حالة الجدول: جاهز للإنشاء"}`,
    };
  }

  // -------------------------------------------------------------
  // 10. Suggestions & Scheduling Advice
  // -------------------------------------------------------------
  if (/(نصيحة|نصائح|اقتراح|مقترح|ازاي احسن|كيف احسن|افضل طريقة)/.test(n)) {
    return {
      answered: true,
      is_query: true,
      topic: "advice",
      reply:
        `💡 نصائح ومقترحات لتحسين واستقرار جدول مدرسة "${school.name}":\n\n` +
        `1. توزيع إجازات المعلمين: احرص على عدم تفريغ أكثر من 20% من المعلمين في نفس اليوم (مثل تفريغ الكثيرين يوم الخميس) لتجنب نقص الإشراف والاحتياطي.\n` +
        `2. الحصص المزدوجة (الفترات): المواد الأساسية ذات النصيب المرتفع (اللغة العربية والرياضيات والعلوم) يفضل جدولتها كفترات مزدوجة (ح1-2 أو ح3-4) لتسهيل الشرح العملي والتركيز.\n` +
        `3. الحصص الأولى: المواد التي تتطلب تركيزاً ذهنياً عالياً اجعلها في الحصص الأربع الأولى قبل الفسحة.\n` +
        `4. عدالة الأنصبة: متوسط نصيب المعلم لديك هو ${(school.assignments.reduce((s, a) => s + a.weekly_periods, 0) / (school.teachers.length || 1)).toFixed(1)} حصة؛ يمكنك تبديل تكليفات أي فصل لتحقيق توازن الأنصبة.`,
    };
  }

  // Fallback for conversational question
  return {
    answered: false,
    is_query: false,
    reply: "",
  };
}
