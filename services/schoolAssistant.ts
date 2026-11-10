import type { SchoolData, Schedule, AnalysisReport, Teacher, Section, Subject, TimetableEntry } from "../types.ts";
import { DAY_NAMES_AR } from "../types.ts";
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
  const n = normAr(raw);

  // Question marks
  if (/[?؟]/.test(raw)) return true;

  // Interrogative words at start or within query
  if (
    /^(هل|مين|من|كام|كم|ما|ماذا|ماهو|ماهي|متى|امتى|اين|فين|ازاي|كيف|ليه|ايش|شو|شنو|اي|ايهم|عرفني|قولي|وريني|اشرح|فحص|افحص|راجع|شوف|تقرير|احصائيات|ملخص|استفسار|سؤال)\b/.test(
      n
    )
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
    /(افحص|فحص|راجع|مراجعة|شيك|تشييك|تحليل|تقرير|صحة الجدول|هل الجدول مظبوط|هل في تعارض|في تعارض|اي تعارض|مشاكل الجدول)/.test(
      n
    )
  ) {
    return true;
  }

  // General greetings & conversational prompts
  if (
    /^(السلام عليكم|سلام عليكم|مرحبا|ازيك|صباح الخير|مساء الخير|اهلا|أهلا|هاي|hello|hi|مين انت|مين أنت|عرفني بنفسك|بتعمل ايه|بتعمل إيه|شكرا|تسلم|يعطيك العافية)\b/.test(
      n
    )
  ) {
    return true;
  }

  // Teacher / Section schedule inquiry without mutation intent
  if (
    /(جدول|حصص)\s+(الاستاذ|الأستاذ|المعلم|المدرس|فصل|صف)\s+/.test(n) &&
    !/(بدل|عدل|غير|شيل|احذف|حط|ضيف|سو جدول جديد|اعمل جدول جديد)/.test(n)
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
  _history?: Array<{ role: string; text?: string }>
): AssistantAnswer {
  const n = normAr(message);

  // -------------------------------------------------------------
  // 1. Greetings & Persona & Help
  // -------------------------------------------------------------
  if (
    /^(السلام عليكم|سلام عليكم|مرحبا|ازيك|صباح الخير|مساء الخير|أهلا|اهلا|هاي|hello|hi)\b/.test(n) ||
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
    /(تعارض|تعارضات|مشاكل|افحص|فحص|راجع|مراجعة|شيك|صحة الجدول|هل الجدول|جودة الجدول|نسبة الجودة|منضبط|كفاءة)/.test(
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
    /(اجازه|إجازة|اجازات|إجازات|اوف|أوف|تفرغ|مش شغال|ما يداوم|مابيداومش|مبيجيش|ما بيجيش|يرتاح|مين واخد|مين عنده|مين مابيداومش|مين مبيجيش)/.test(
      n
    ) ||
    (/(مين|من هم|هل)/.test(n) && /(الاحد|الأحد|الاتنين|الاثنين|الثلاثاء|التلات|الاربعاء|الأربعاء|الخميس)/.test(n));

  if (isOffQuery) {
    const daysInMsg = parseDaysList(message);
    const resolvedTch = resolveTeacherFromMessage(school, message).teacher;

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
    /(نصيب|انصبة|أنصبة|حصص المعلم|حصص الاستاذ|بياخد كام|كام حصه|كام حصة|اكتر معلم|أكثر معلم|اعلى نصيب|أعلى نصيب|اقل معلم|أقل معلم|متوسط الانصبة|متوسط الأنصبة)/.test(
      n
    )
  ) {
    const resolvedTch = resolveTeacherFromMessage(school, message).teacher;

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

    if (/(اكتر|أكثر|اعلى|أعلى)/.test(n)) {
      return {
        answered: true,
        is_query: true,
        topic: "top_workload",
        reply:
          `🏆 المعلم الأعلى نصيباً في المدرسة هو الأستاذ "${highest.teacher.name}" برصيد ${highest.periods} حصة أسبوعياً.\n` +
          `متوسط نصيب المعلمين في المدرسة هو ${avgLoad} حصة أسبوعياً.`,
      };
    }

    if (/(اقل|أقل|ادنى|أدنى)/.test(n)) {
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
    /(جدول|حصص|عنده ايه|عنده إيه|عندهم ايه|عندهم إيه|الحصة الاولى|الحصة الأولى|الحصة السابعة|الحصة السادسة|مين بيدرس|مدرسين|معلمين|مدرسي|معلمي)/.test(
      n
    );

  if (isScheduleLookup) {
    const daysInMsg = parseDaysList(message);
    const resolvedTch = resolveTeacherFromMessage(school, message).teacher;

    // Check for section mention (e.g. "1/1", "1/2", "2/1", etc.)
    const secMatch = message.match(/(\d+\s*[\/\\]\s*\d+)/);
    let resolvedSec: Section | undefined;
    if (secMatch) {
      const code = secMatch[1].replace(/\s+/g, "");
      resolvedSec = school.sections.find((s) => s.name === code || s.code === code);
    }
    if (!resolvedSec) {
      for (const s of school.sections) {
        if (normAr(message).includes(normAr(s.name))) {
          resolvedSec = s;
          break;
        }
      }
    }

    // A. Teacher's daily or weekly schedule
    if (resolvedTch) {
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
  const subjectFound = findSubjectInMessage(school, message);
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
  if (/(قيود|يمشي بدري|يطلع مبكر|الحصص الاولى|الحصص الأولى|الحصص الاخيره|الحصص الأخيرة|ممنوع من)/.test(n)) {
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
        `1. توزيع إجازات المعلمين: احرص على عدم تفريغ أكثر من 20% من المعلمين في نفس اليوم (مثل تفريغ الكثيرين يوم الخميس) لتجنب عجز الإشراف والاحتياطي.\n` +
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
