import { Type, createPartFromFunctionResponse, type FunctionDeclaration, type FunctionCall, type Part } from "@google/genai";
import { Schedule, SchoolData, TimetableEntry } from "../types.ts";
import {
  Op,
  applyOps,
  describeRule,
  generateSchoolMarkdown,
  interpretCommand,
  resolveSection,
  resolveTeacher,
  validateSchoolCapacity,
} from "./schoolCore.ts";
import { parseSchoolText } from "./schoolCore.ts";
import { validateSchoolDataSchema } from "./apiKeyManager.ts";
import {
  enrichExtractedSchool,
  normalizeAiExtractedSchoolJson,
  reconcileAiWithDeterministicSchool,
} from "./schoolImportHelper.ts";
import { parseUnstructuredArabicSchoolText } from "./unstructuredParser.ts";
import { InBrowserSchoolEngine } from "./localEngine.ts";
import { tryApplyDailyPeriodsChatCommand } from "../presets/commonPresets.ts";
import {
  AgentUiActionType,
  GeminiFailureInfo,
  analyzeTeacherFairness,
  applyFairTeacherDistribution,
  buildLiveAgentContextDigest,
  sanitizePlacementRuleConflicts,
  tryExecuteExtendedAgentAction,
} from "./agentMemoryEngine.ts";

export function classifyGeminiError(err: unknown, modelAttempted?: string): GeminiFailureInfo {
  const anyErr = err as any;
  const noticesStr = Array.isArray(anyErr?.notices) ? anyErr.notices.join(" | ") : "";
  const rawMsg = [anyErr?.message || String(err || ""), noticesStr].filter(Boolean).join(" | ");
  const low = rawMsg.toLowerCase();
  const statusCode = anyErr?.status || anyErr?.statusCode || (rawMsg.match(/(400|401|403|404|429|500|502|503|504)/)?.[1] ? Number(rawMsg.match(/(400|401|403|404|429|500|502|503|504)/)![1]) : undefined);
  const mdlLabel = modelAttempted || "gemini";

  if (!err || /no_key|no gemini client|لا يوجد مفتاح|جميع مفاتيح/.test(low)) {
    if (/429|تبريد|تجاوز الحصة|انتهاء الحصة|quota|rate/.test(low)) {
      return {
        error_origin: "api_request",
        http_status: 429,
        model_attempted: mdlLabel,
        reason_ar: "انتهى حد الطلبات / الحصة المسموحة لمفتاح الـ API (HTTP 429 Quota/Cooldown).",
      };
    }
    if (/400|401|403|غير صالح|مرفوض|invalid/.test(low)) {
      return {
        error_origin: "api_request",
        http_status: statusCode || 403,
        model_attempted: mdlLabel,
        reason_ar: "مفتاح الـ API نفسه غير صالح أو مرفوض الصلاحيات.",
      };
    }
    return {
      error_origin: "no_key",
      http_status: "NO_KEY",
      model_attempted: mdlLabel,
      reason_ar: "لا يوجد مفتاح Gemini API مفعّل حالياً (على الخادم أو في المتصفح).",
    };
  }

  if (statusCode === 429 || /429|resource_exhausted|quota|rate limit|تبريد|تجاوز الحصة/.test(low)) {
    return {
      error_origin: "api_request",
      http_status: 429,
      model_attempted: mdlLabel,
      reason_ar: "مشكلة في ريكويست وحصة الـ API: تم تجاوز حد الاستخدام أو انتهت كوتا المفتاح (HTTP 429).",
    };
  }

  if (statusCode === 401 || statusCode === 403 || /401|403|permission_denied|unauthenticated|api_key_invalid|api key not valid|غير صالح|مرفوض/.test(low)) {
    return {
      error_origin: "api_request",
      http_status: statusCode || 403,
      model_attempted: mdlLabel,
      reason_ar: `مشكلة في مفتاح أو طلب الـ API: المفتاح غير صالح أو مرفوض (${statusCode || 403}).`,
    };
  }

  if (statusCode === 400 || /invalid_argument/.test(low)) {
    return {
      error_origin: "api_request",
      http_status: 400,
      model_attempted: mdlLabel,
      reason_ar: "مشكلة في صياغة ريكويست أو مفتاح الـ API (HTTP 400 Bad Request / Invalid Key).",
    };
  }

  if (/fetch failed|failed to fetch|enotfound|econnrefused|network|econnreset|etimedout/.test(low)) {
    return {
      error_origin: "api_request",
      http_status: "NETWORK",
      model_attempted: mdlLabel,
      reason_ar: "مشكلة في إرسال ريكويست الـ API عبر الشبكة إلى خوادم Google (تحقق من الاتصال).",
    };
  }

  if (statusCode === 503 || statusCode === 502 || statusCode === 504 || /503|unavailable|high demand|overloaded/.test(low)) {
    return {
      error_origin: "model",
      http_status: statusCode || 503,
      model_attempted: mdlLabel,
      reason_ar: `مشكلة من الموديل نفسه (${mdlLabel}): خادم الموديل مزدحم حالياً أو غير متاح مؤقتاً (HTTP ${statusCode || 503}).`,
    };
  }

  if (statusCode === 404 || /404|no longer available|not found/.test(low)) {
    return {
      error_origin: "model",
      http_status: 404,
      model_attempted: mdlLabel,
      reason_ar: `مشكلة من الموديل نفسه (${mdlLabel}): هذا الإصدار من الموديل غير متاح أو أوقفته Google (HTTP 404).`,
    };
  }

  if (/timeout|aborted|timeouterror|this operation was aborted/.test(low)) {
    return {
      error_origin: "model",
      http_status: "TIMEOUT",
      model_attempted: mdlLabel,
      reason_ar: `مشكلة من الموديل نفسه (${mdlLabel}): استغرق الموديل وقتاً أطول من المهلة المسموحة دون رد.`,
    };
  }

  if (/without calling any tool|empty/.test(low)) {
    return {
      error_origin: "model",
      http_status: "MODEL_BEHAVIOR",
      model_attempted: mdlLabel,
      reason_ar: `مشكلة في استجابة الموديل نفسه (${mdlLabel}): أعاد رداً غير مكتمل أو لم يستدعِ الأداة المطلوبة.`,
    };
  }

  return {
    error_origin: statusCode && statusCode >= 500 ? "model" : "api_request",
    http_status: statusCode || "ERR",
    model_attempted: mdlLabel,
    reason_ar: statusCode && statusCode >= 500
      ? `مشكلة من خادم الموديل (${mdlLabel}): ${rawMsg.slice(0, 110)}`
      : `خطأ في طلب الـ API: ${rawMsg.slice(0, 110)}`,
  };
}
import { answerSchoolQuestion } from "./schoolAssistant.ts";

const DAY_AR: Record<number, string> = {
  6: "السبت",
  0: "الأحد",
  1: "الاثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
};

export const AI_TOOL_AGENT_SYSTEM_INSTRUCTION = `# الهوية والدور (Autonomous Timetable Tool Agent)
أنت "وكيل الجداول المدرسية الذكي" وتعمل كوكيل فعلي مزوّد بأدوات حتمية (Function Calling Tools) متصلة مباشرة بقاعدة بيانات المدرسة والمحرك الرياضي للجدول (0% تعارضات).

# قواعد العمل الصارمة:
1. استخدم الأدوات المتاحة لك دائماً للاستعلام عن البيانات أو المحاكاة أو تنفيذ التعديلات — لا تخمن أرقاماً ولا تعدّل بيانات من الذاكرة فقط.
2. أسماء الأيام بالأرقام: السبت=6، الأحد=0، الاثنين=1، الثلاثاء=2، الأربعاء=3، الخميس=4.
3. الترتيب الصحيح للأولويات:
   - لا تدّعِ أبداً أنك نفذت تعديلاً (مثل تغيير اسم المدرسة أو إجازة أو قيد أو توزيع) بدون استدعاء أداة التعديل أولاً (\`apply_school_modifications\` أو \`run_domain_command\` أو \`apply_fair_distribution\`).
   - لتغيير اسم المدرسة استدعِ \`apply_school_modifications\` مع \`ops: [{ op: "set_school_name", name: "الاسم الجديد" }]\`.
   - لإضافة معلم جديد واستبدال معلم أو خانة شاغرة به (مثل "أضف معلم علي كمال واستبدل س3 به" أو "شيل س1 وحط X"): استدعِ \`apply_school_modifications\` مع \`ops: [{ op: "replace_teacher", teacher: "س3", replacement: "علي كمال" }]\` (تضيف المعلم وتنقل جميع حصص س3 إليه تلقائياً).
   - للاستفسارات والحسابات الدقيقة وجداول المعلمين/الفصول: استدعِ \`get_school_overview\` أو \`query_teacher_details\` أو \`query_section_details\` أو \`ask_exact_school_math\`.
   - لمعرفة احتياط/بديل لحصة محددة: استدعِ \`find_substitute_teacher\`.
   - لتقييم عدالة التوزيع: استدعِ \`analyze_fairness\`. ولتنفيذ التوزيع العادل فعلياً عند طلب المستخدم أو تأكيده: استدعِ \`apply_fair_distribution\`.
   - لأسئلة "ماذا لو / هل ينفع": استدعِ \`simulate_what_if\` فقط دون تعديل المدرسة، واعرض النتيجة بوضوح واسأل المستخدم إذا كان يريد التنفيذ.
   - للتعديلات المهيكلة (إجازات، قواعد الحصص، أولى/أخيرة، منع حصة مثل "الغاء الحصة الاولى"، حد يومي/تتابع، مزدوج/فردي، إسناد، إضافة/حذف/تبديل معلم أو فصل أو مادة، اسم المدرسة): استدعِ \`apply_school_modifications\` بالأوبس المناسبة.
   - للتثبيت أو التبديل أو النقل بين الخلايا أو الحذف/النصيب بصفوف أو تعديل عدد حصص صف يوم معين أو التراجع: استدعِ \`run_domain_command\` بنص واضح محدد.
   - لطلبات التصدير (PDF / Excel) أو فتح شاشة معينة: استدعِ \`trigger_app_action\`. ولا تستدعِ \`trigger_solve\` أبداً في الاستفسارات أو تغيير اسم المدرسة أو التعديلات البسيطة إلا إذا طلب المستخدم صراحةً بناء/إعادة توليد الجدول كله.
   - إذا أرسل المستخدم وصفاً كاملاً أو شبه كامل لمدرسة جديدة (صفوف، فصول، فترات صباحية/مسائية، معلمون، مواد، أنصبة، شواغر، إجازات، قيود) — حتى لو كان بالعامية أو غير منظم — **يجب استدعاء import_school_from_text أولاً** وتمرير هيكل school_data_json المستخرج بعناية شاملة (أو النص لاستكماله) بحيث تضع كل معلومة في مكانها الصحيح (shift_mode, shifts, grades, sections, daily_period_limits, subjects, teachers, work_pattern, assignments)، ثم مراجعة الملخص العائد وتكملة أي قيد إضافي عبر apply_school_modifications.
4. للطلبات الغامضة جداً التي قد تغير عشرات الحصص دون تحديد (مثل "ثبت حصة العربي" دون فصل أو يوم أو معلم، أو "انقل حصة" دون تحديد أي حصة): لا تنفذ تعديلاً؛ اسأل المستخدم سؤالاً توضيحياً قصيراً محدداً بالخيارات المتاحة من بيانات المدرسة.
5. في الصياغات العربية انتبه للنفي دائماً:
   - "الغاء/منع/عدم/إعفاء الحصة الأولى يوم X" تعني \`AVOID_FIRST\` (وليس \`FIRST_N\`).
   - "الغاء/منع الحصة الأخيرة" تعني \`AVOID_LAST\`.
   - "س / س1 / س2 / س عربي" هي خانات شاغرة مؤقتة تُسمى "خانات شاغرة" ولا تستخدم كلمة "عجز".
6. بعد انتهاء استدعاء الأدوات، لخص للمستخدم ما حدث بلغة عربية واضحة وطبيعية ومختصرة، ووضح إن كان سيعاد بناء الجدول تلقائياً أم لا.`;

export const AGENT_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_school_overview",
    description:
      "قراءة ملخص المدرسة الكامل: الاسم، أيام الدراسة، الفصول، قائمة المعلمين مع أنصبتهم وإجازاتهم، المواد، الشواغر المؤقتة (س1/س2)، وحالة الجدول الحالي.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "query_teacher_details",
    description:
      "استعلام دقيق عن معلم معين: نصيبه الأسبوعي، فصوله ومواده، أيام إجازته الإجبارية، قيود الحصص (الأولى/الأخيرة/التتابع)، وجدوله في يوم محدد أو الأسبوع.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        teacher_name: { type: Type.STRING, description: "اسم المعلم أو جزء واضح منه" },
        day: { type: Type.INTEGER, description: "رقم اليوم اختياري (6=السبت، 0=الأحد، 1=الاثنين، 2=الثلاثاء، 3=الأربعاء، 4=الخميس)" },
      },
      required: ["teacher_name"],
    },
  },
  {
    name: "query_section_details",
    description: "استعلام دقيق عن فصل دراسي (مثل 1/1 أو 2/3): مواده، معلميه، عدد حصصه، وجدوله اليومي.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        section_code: { type: Type.STRING, description: "رمز الفصل مثل 1/1 أو 2/2" },
        day: { type: Type.INTEGER, description: "رقم اليوم اختياري (6، 0، 1، 2، 3، 4)" },
      },
      required: ["section_code"],
    },
  },
  {
    name: "find_substitute_teacher",
    description: "البحث عن أنسب المعلمين المتاحين كاحتياط/بديل لحصة محددة (غير غائبين إجبارياً وليس لديهم حصة في نفس التوقيت).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        day: { type: Type.INTEGER, description: "رقم اليوم (6، 0، 1، 2، 3، 4)" },
        period: { type: Type.INTEGER, description: "رقم الحصة (1..8)" },
        subject_name: { type: Type.STRING, description: "اسم المادة إن وجد لترتيب معلمي التخصص أولاً" },
        exclude_teacher: { type: Type.STRING, description: "اسم المعلم الغائب المراد استبعاده" },
      },
      required: ["day", "period"],
    },
  },
  {
    name: "analyze_fairness",
    description: "فحص وتحليل عدالة توزيع الأنصبة والفجوات والضغط اليومي بين المعلمين في المدرسة والجدول الحالي.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "simulate_what_if",
    description: "محاكاة أثر سيناريو افتراضي (ماذا لو / هل ينفع) دون تعديل المدرسة الفعلية.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        scenario_description: { type: Type.STRING, description: "وصف السيناريو المطلوب اختباره" },
      },
      required: ["scenario_description"],
    },
  },
  {
    name: "ask_exact_school_math",
    description: "استدعاء المساعد الحسابي الحتمي للإجابة بأرقام دقيقة 100% عن أسئلة المعلمين، الحصص، الشواغر، الفحص والتعارضات.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: { type: Type.STRING, description: "نص السؤال بالعربية" },
      },
      required: ["question"],
    },
  },
  {
    name: "apply_school_modifications",
    description:
      "تنفيذ تعديل واحد أو مجموعة تعديلات مهيكلة على بيانات المدرسة بشكل حتمي عبر مصفوفة ops. يجب استخدام هذا للقيود والإجازات والأنصبة والمعلمين والفصول والمواد.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ops: {
          type: Type.ARRAY,
          description: "مصفوفة العمليات المطلوب تنفيذها بالترتيب",
          items: {
            type: Type.OBJECT,
            properties: {
              op: {
                type: Type.STRING,
                description:
                  "نوع العملية: set_school_name | add_section | remove_section | add_teacher | remove_teacher | rename_teacher | swap_teachers | replace_teacher | set_teacher_days | add_placement_rule | clear_placement_rules | set_daily_count | set_teacher_limits | set_double_policy | set_assignment | assign_teacher | add_subject | set_subject_rule | set_school_rule | set_periods | set_days",
              },
              name: { type: Type.STRING },
              teacher: { type: Type.STRING },
              new_name: { type: Type.STRING },
              teacher_a: { type: Type.STRING },
              teacher_b: { type: Type.STRING },
              replacement: { type: Type.STRING },
              reassign_to: { type: Type.STRING },
              copy_rules: { type: Type.BOOLEAN },
              section: { type: Type.STRING },
              code: { type: Type.STRING },
              copy_from: { type: Type.STRING },
              subject: { type: Type.STRING },
              periods: { type: Type.INTEGER },
              periods_list: { type: Type.ARRAY, items: { type: Type.INTEGER }, description: "يُستخدم مع EXACT_PERIODS أو AVOID_PERIODS" },
              day: { type: Type.INTEGER, description: "رقم اليوم أو اتركه فارغاً لكل الأيام" },
              off_days: { type: Type.ARRAY, items: { type: Type.INTEGER } },
              work_days: { type: Type.ARRAY, items: { type: Type.INTEGER } },
              allow_days: { type: Type.ARRAY, items: { type: Type.INTEGER } },
              days: { type: Type.ARRAY, items: { type: Type.INTEGER } },
              type: {
                type: Type.STRING,
                description: "AVOID_FIRST | AVOID_LAST | AVOID_PERIODS | FIRST_N | LAST_N | EXACT_PERIODS | EDGES | HAS_LAST",
              },
              n: { type: Type.INTEGER },
              hard: { type: Type.BOOLEAN },
              count: { type: Type.INTEGER },
              rule_type: { type: Type.STRING, description: "EXACT | MAX | MIN" },
              max_daily: { type: Type.INTEGER },
              max_weekly: { type: Type.INTEGER },
              max_consecutive: { type: Type.INTEGER },
              target_days: { type: Type.INTEGER },
              policy: { type: Type.STRING, description: "REQUIRED | SINGLE | PREFER | FREE" },
              before_break: { type: Type.BOOLEAN },
              break_after_period: { type: Type.INTEGER },
              daily_periods_count: { type: Type.INTEGER },
            },
            required: ["op"],
          },
        },
      },
      required: ["ops"],
    },
  },
  {
    name: "apply_fair_distribution",
    description: "تنفيذ إعادة التوزيع العادل للمعلمين (موازنة الأنصبة حسب الرغبة + توزيع الحصص بعدالة يومية بدون فجوات وبضمان 0% تعارض).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        rebalance_quotas: { type: Type.BOOLEAN, description: "هل يتم أيضاً توازن أنصبة المعلمين لنفس المادة بين الفصول؟ (true افتراضياً)" },
      },
    },
  },
  {
    name: "run_domain_command",
    description:
      "تنفيذ أوامر متخصصة على الجدول أو النصوص عبر المحرك المحلي الحتمي: تثبيت/فك تثبيت خلية، نقل أو تبديل حصة بين فترتين، تغيير عدد حصص صف في يوم، التراجع، أو تفسير طلبات مركبة معقدة.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command_text: { type: Type.STRING, description: "نص الأمر الدقيق بالعربية واضحاً ومحدداً" },
      },
      required: ["command_text"],
    },
  },
  {
    name: "import_school_from_text",
    description:
      "إنشاء أو استبدال بيانات المدرسة كاملة انطلاقاً من وصف نصي (عامية أو فصحى) أو هيكل JSON مستخرج بذكاء: يدعم الفترات الصباحية/المسائية (TWO_SHIFTS)، حدود الحصص اليومية (daily_period_limits)، الصفوف والفصول، المواد، المعلمين، الخانات الشاغرة (س1/س عربي)، الإجازات، وقواعد التتابع والأولى/الأخيرة.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        school_data_json: {
          type: Type.STRING,
          description:
            "اختياري (مفضل عند استخراج مدرسة من وصف عامي/حر): سلسلة JSON صالحة لهيكل SchoolData تحتوي name, days, periods_per_day, shift_mode, shifts, grades, sections, subjects, teachers, assignments",
        },
        raw_text: {
          type: Type.STRING,
          description: "النص الأصلي لوصف المدرسة للتحقق والتدقيق المتقاطع (يُستخدم نص رسالة المستخدم تلقائياً عند تركه فارغاً).",
        },
      },
    },
  },
  {
    name: "trigger_app_action",
    description: "توجيه واجهة التطبيق لتنفيذ إجراء مباشر مثل تصدير PDF/Excel، تغيير العرض، إعادة توليد الجدول، أو التراجع.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            "export_master_pdf | export_comprehensive_pdf | export_sections_pdf | export_teachers_pdf | export_excel | switch_view | trigger_solve | open_wizard",
        },
        target_id: { type: Type.STRING, description: "اختياري: master | sections | teachers | editor | constraints عند switch_view" },
      },
      required: ["action"],
    },
  },
];

function summarizeRulesText(school: SchoolData, teacherId: string): string {
  const t = school.teachers.find((x) => x.id === teacherId);
  if (!t?.work_pattern) return "بدون قيود";
  const offs = Object.entries(t.work_pattern.day_rules || {})
    .filter(([, v]) => v === "MANDATORY_OFF")
    .map(([d]) => DAY_AR[Number(d)] || d);
  const prs = (t.work_pattern.placement_rules || []).map((r) => describeRule(r));
  const parts: string[] = [];
  if (offs.length) parts.push(`إجازة: ${offs.join("، ")}`);
  if (prs.length) parts.push(`قيود: ${prs.join(" | ")}`);
  if (t.max_daily_periods) parts.push(`أقصى/يوم=${t.max_daily_periods}`);
  if (t.max_consecutive_periods) parts.push(`أقصى تتابع=${t.max_consecutive_periods}`);
  return parts.length ? parts.join(" — ") : "بدون قيود خاصة";
}

function normalizeGeminiOp(raw: Record<string, any>): Op | null {
  const opName = String(raw.op || "").trim();
  if (!opName) return null;
  const out: any = { ...raw, op: opName };
  if (opName === "add_placement_rule" && Array.isArray(raw.periods_list) && !raw.periods) {
    out.periods = raw.periods_list;
  }
  if (opName === "set_periods" && typeof raw.daily_periods_count === "number" && raw.periods === undefined) {
    out.periods = raw.daily_periods_count;
  }
  if (opName === "add_placement_rule" && out.day === undefined) {
    out.day = null;
  }
  return out as Op;
}

export interface ToolAgentExecutionResult {
  handled: boolean;
  reply: string;
  updated_school: SchoolData;
  updated_markdown: string;
  updated_schedule?: Schedule | null;
  should_solve: boolean;
  applied_changes: string[];
  ui_action?: AgentUiActionType;
  ui_target_id?: string;
  tool_calls_used: string[];
  used_model?: string;
  error_notice?: string;
  failure_info?: GeminiFailureInfo;
}

export type GeminiTurnGenerator = (
  contents: Array<{ role: string; parts: Array<any> }>,
  config: {
    systemInstruction: string;
    tools: Array<{ functionDeclarations: FunctionDeclaration[] }>;
    maxOutputTokens?: number;
  }
) => Promise<{
  text: string;
  functionCalls?: FunctionCall[];
  modelContent?: { role: string; parts: Part[] };
  usedModel?: string;
  notices?: string[];
}>;

export async function runGeminiToolCallingAgent(params: {
  message: string;
  school: SchoolData;
  markdown: string;
  schedule?: Schedule | null;
  history?: Array<{ role: "user" | "ai" | "model"; text: string }>;
  generateTurn: GeminiTurnGenerator;
  maxSteps?: number;
}): Promise<ToolAgentExecutionResult> {
  const { message, history = [], generateTurn, maxSteps = 6 } = params;
  let workingSchool: SchoolData = JSON.parse(JSON.stringify(params.school));
  let workingMarkdown = params.markdown || generateSchoolMarkdown(workingSchool);
  let workingSchedule: Schedule | null = params.schedule ? JSON.parse(JSON.stringify(params.schedule)) : null;
  const appliedChanges: string[] = [];
  let shouldSolve = false;
  let uiAction: AgentUiActionType | undefined;
  let uiTargetId: string | undefined;
  const toolCallsUsed: string[] = [];
  const allNotices: string[] = [];
  let lastUsedModel: string | undefined;

  const contents: Array<{ role: string; parts: Array<any> }> = [];
  for (const h of history.slice(-14)) {
    if (h?.text && h?.role) {
      contents.push({
        role: h.role === "user" ? "user" : "model",
        parts: [{ text: h.text }],
      });
    }
  }

  const compactTeacherList = workingSchool.teachers
    .map((t) => {
      const load = workingSchool.assignments
        .filter((a) => a.teacher_id === t.id)
        .reduce((s, a) => s + a.weekly_periods, 0);
      return `${t.name}(${load}ح)`;
    })
    .join("، ");
  const compactSections = workingSchool.sections.map((s) => s.code).join("، ");
  const compactSubjects = workingSchool.subjects.map((s) => s.name).join("، ");

  contents.push({
    role: "user",
    parts: [
      {
        text: `سياق المدرسة المختصر:
- الاسم: ${workingSchool.name}
- الأيام: ${workingSchool.days.map((d) => `${DAY_AR[d] || d}(${d})`).join("، ")}
- الفصول (${workingSchool.sections.length}): ${compactSections}
- المواد (${workingSchool.subjects.length}): ${compactSubjects}
- المعلمون (${workingSchool.teachers.length}): ${compactTeacherList}
- حالة الجدول: ${
          workingSchedule
            ? `متولد (${workingSchedule.entries.length} حصة، جودة ${workingSchedule.quality_score}%)`
            : "لم يتم توليده بعد"
        }
${buildLiveAgentContextDigest(workingSchool, workingSchedule, history)}

رسالة المستخدم الحالية:
${message}`,
      },
    ],
  });

  const executeSingleTool = (name: string, args: Record<string, any>): Record<string, unknown> => {
    toolCallsUsed.push(name);
    try {
      switch (name) {
        case "get_school_overview": {
          const analysis = InBrowserSchoolEngine.analyzeSchool(workingSchool);
          const teachersSummary = workingSchool.teachers.map((t) => {
            const load = workingSchool.assignments
              .filter((a) => a.teacher_id === t.id)
              .reduce((s, a) => s + a.weekly_periods, 0);
            return {
              name: t.name,
              weekly_periods: load,
              rules: summarizeRulesText(workingSchool, t.id),
            };
          });
          return {
            ok: true,
            school_name: workingSchool.name,
            days: workingSchool.days.map((d) => ({ id: d, name: DAY_AR[d] || String(d) })),
            periods_per_day: workingSchool.periods_per_day,
            break_after_period: workingSchool.rules?.break_after_period ?? null,
            sections: workingSchool.sections.map((s) => s.code),
            subjects: workingSchool.subjects.map((s) => ({
              name: s.name,
              double_policy: s.double_period_policy || "FREE",
              before_break: !!s.before_break,
            })),
            teachers: teachersSummary,
            total_assigned_periods: analysis.total_weekly_periods,
            vacancies_count: teachersSummary.filter((t) => /(?:شاغر|عجز|^س\d*$|^س\s+)/.test(t.name)).length,
            has_schedule: Boolean(workingSchedule),
            schedule_quality: workingSchedule?.quality_score ?? null,
          };
        }

        case "query_teacher_details": {
          const ref = String(args.teacher_name || "").trim();
          const res = resolveTeacher(workingSchool, ref);
          if (!res.teacher) {
            return { ok: false, error: res.error || `لم يتم العثور على معلم باسم "${ref}".` };
          }
          const t = res.teacher;
          const asgs = workingSchool.assignments
            .filter((a) => a.teacher_id === t.id)
            .map((a) => ({
              section: workingSchool.sections.find((s) => s.id === a.section_id)?.code || a.section_id,
              subject: workingSchool.subjects.find((s) => s.id === a.subject_id)?.name || a.subject_id,
              periods: a.weekly_periods,
            }));
          const dayFilter = typeof args.day === "number" ? args.day : null;
          const slots = workingSchedule
            ? workingSchedule.entries
                .filter((e) => e.teacher_id === t.id && (dayFilter === null || e.day === dayFilter))
                .sort((a, b) => a.day - b.day || a.period - b.period)
                .map((e) => ({
                  day: DAY_AR[e.day] || e.day,
                  day_id: e.day,
                  period: e.period,
                  section: workingSchool.sections.find((s) => s.id === e.section_id)?.code || e.section_id,
                  subject: workingSchool.subjects.find((s) => s.id === e.subject_id)?.name || e.subject_id,
                  pinned: !!e.is_pinned,
                }))
            : [];
          return {
            ok: true,
            teacher: t.name,
            total_weekly_periods: asgs.reduce((s, a) => s + a.periods, 0),
            rules: summarizeRulesText(workingSchool, t.id),
            assignments: asgs,
            schedule_slots: slots,
          };
        }

        case "query_section_details": {
          const code = String(args.section_code || "").trim();
          const res = resolveSection(workingSchool, code);
          if (!res.section) {
            return { ok: false, error: res.error || `لم يتم العثور على فصل "${code}".` };
          }
          const sec = res.section;
          const asgs = workingSchool.assignments
            .filter((a) => a.section_id === sec.id)
            .map((a) => ({
              subject: workingSchool.subjects.find((s) => s.id === a.subject_id)?.name || a.subject_id,
              teacher: workingSchool.teachers.find((t) => t.id === a.teacher_id)?.name || "غير مسند",
              periods: a.weekly_periods,
            }));
          const dayFilter = typeof args.day === "number" ? args.day : null;
          const slots = workingSchedule
            ? workingSchedule.entries
                .filter((e) => e.section_id === sec.id && (dayFilter === null || e.day === dayFilter))
                .sort((a, b) => a.day - b.day || a.period - b.period)
                .map((e) => ({
                  day: DAY_AR[e.day] || e.day,
                  period: e.period,
                  subject: workingSchool.subjects.find((s) => s.id === e.subject_id)?.name || e.subject_id,
                  teacher: workingSchool.teachers.find((t) => t.id === e.teacher_id)?.name || e.teacher_id,
                }))
            : [];
          return {
            ok: true,
            section: sec.code,
            total_periods: asgs.reduce((s, a) => s + a.periods, 0),
            assignments: asgs,
            schedule_slots: slots,
          };
        }

        case "find_substitute_teacher": {
          const day = Number(args.day);
          const period = Number(args.period);
          const subjHint = String(args.subject_name || "").trim();
          const excl = String(args.exclude_teacher || "").trim();
          if (!workingSchedule) {
            return { ok: false, error: "الجدول لم يتم توليده بعد، شغّل الحل أولاً لمعرفة المعلمين المتاحين." };
          }
          const candidates = workingSchool.teachers
            .filter((t) => !excl || !t.name.includes(excl))
            .filter((t) => !(/(?:شاغر|عجز|^س\d*$|^س\s+)/.test(t.name)))
            .filter((t) => t.work_pattern?.day_rules?.[String(day)] !== "MANDATORY_OFF")
            .filter((t) => !workingSchedule!.entries.some((e) => e.teacher_id === t.id && e.day === day && e.period === period))
            .map((t) => {
              const dayCount = workingSchedule!.entries.filter((e) => e.teacher_id === t.id && e.day === day).length;
              const teachesSubj =
                subjHint.length > 0 &&
                workingSchool.assignments.some(
                  (a) =>
                    a.teacher_id === t.id &&
                    (workingSchool.subjects.find((s) => s.id === a.subject_id)?.name || "").includes(subjHint)
                );
              return { teacher: t.name, day_periods_load: dayCount, teaches_same_subject: teachesSubj };
            })
            .sort((a, b) => Number(b.teaches_same_subject) - Number(a.teaches_same_subject) || a.day_periods_load - b.day_periods_load);
          return {
            ok: true,
            day: DAY_AR[day] || day,
            period,
            available_candidates: candidates.slice(0, 8),
          };
        }

        case "analyze_fairness": {
          const report = analyzeTeacherFairness(workingSchool, workingSchedule);
          return {
            ok: true,
            is_fair: report.subjectGaps.length === 0 && report.dailyImbalances.length === 0,
            subject_gaps: report.subjectGaps.slice(0, 6),
            daily_imbalances: report.dailyImbalances.slice(0, 6),
            report_lines: report.reportLines,
          };
        }

        case "simulate_what_if": {
          const scenario = String(args.scenario_description || message);
          const ans = answerSchoolQuestion(scenario, workingSchool, workingSchedule, InBrowserSchoolEngine.analyzeSchool(workingSchool), history);
          return {
            ok: true,
            answered: ans.answered,
            simulation_report: ans.answered ? ans.reply : "يرجى تحديد المعلم واليوم بدقة لمحاكاة التغيير.",
          };
        }

        case "ask_exact_school_math": {
          const q = String(args.question || message);
          const ans = answerSchoolQuestion(q, workingSchool, workingSchedule, InBrowserSchoolEngine.analyzeSchool(workingSchool), history);
          return {
            ok: true,
            answered: ans.answered,
            answer: ans.reply || "",
          };
        }

        case "apply_school_modifications": {
          const rawOps = Array.isArray(args.ops) ? args.ops : [];
          if (rawOps.length === 0) {
            return { ok: false, error: "مصفوفة ops فارغة." };
          }
          const normalizedOps: Op[] = [];
          let workingBeforeOps = workingSchool;
          const localChanges: string[] = [];

          for (const raw of rawOps) {
            // Handle school-wide set_double_policy when both teacher and subject are omitted
            if (raw.op === "set_double_policy" && !raw.teacher && !raw.subject && raw.policy) {
              const rawPol = String(raw.policy);
              const pol: "FREE" | "DOUBLE_REQUIRED" | "SINGLE_ONLY" =
                rawPol === "REQUIRED" || rawPol === "DOUBLE_REQUIRED"
                  ? "DOUBLE_REQUIRED"
                  : rawPol === "SINGLE" || rawPol === "SINGLE_ONLY"
                    ? "SINGLE_ONLY"
                    : "FREE";
              workingBeforeOps = {
                ...workingBeforeOps,
                subjects: workingBeforeOps.subjects.map((s) => ({ ...s, double_period_policy: pol })),
              };
              localChanges.push(`تعيين سياسة الحصص المزدوجة لجميع المواد إلى ${pol}`);
              continue;
            }
            const op = normalizeGeminiOp(raw);
            if (op) normalizedOps.push(op);
          }

          let finalSchool = workingBeforeOps;
          const errors: string[] = [];
          if (normalizedOps.length > 0) {
            const resOps = applyOps(workingBeforeOps, normalizedOps);
            finalSchool = sanitizePlacementRuleConflicts(resOps.school, normalizedOps);
            // Sync teacher.subject_ids after assignment/replacement ops
            for (const tch of finalSchool.teachers) {
              const assignedSubs = [
                ...new Set(finalSchool.assignments.filter((a) => a.teacher_id === tch.id).map((a) => a.subject_id)),
              ];
              if (assignedSubs.length > 0) {
                tch.subject_ids = [...new Set([...(tch.subject_ids || []), ...assignedSubs])];
              }
            }
            localChanges.push(...resOps.changes);
            errors.push(...resOps.errors);
          }

          if (localChanges.length > 0) {
            workingSchool = finalSchool;
            appliedChanges.push(...localChanges);
            workingMarkdown = generateSchoolMarkdown(workingSchool, appliedChanges);
            const metadataOnlyOps = new Set(["set_school_name", "rename_teacher", "add_subject", "note"]);
            const hasSchedulingImpact = rawOps.some((r: any) => {
              const name = String(r?.op || "");
              if (metadataOnlyOps.has(name)) return false;
              if (name === "add_teacher" && !r?.work_days?.length && !r?.off_days?.length) return false;
              return true;
            });
            if (hasSchedulingImpact) shouldSolve = true;
          }

          const cap = validateSchoolCapacity(workingSchool);
          return {
            ok: errors.length === 0 && localChanges.length > 0,
            applied_changes: localChanges,
            errors,
            capacity_ok: cap.errors.length === 0,
            capacity_errors: cap.errors,
            will_re_solve: shouldSolve,
          };
        }

        case "apply_fair_distribution": {
          const rebalanceQuotas = args.rebalance_quotas !== false;
          const res = applyFairTeacherDistribution(workingSchool, rebalanceQuotas ? "both" : "daily");
          workingSchool = res.school;
          const solved = InBrowserSchoolEngine.solveInBrowser(workingSchool);
          workingSchedule = solved.schedule;
          appliedChanges.push(...res.changes);
          workingMarkdown = generateSchoolMarkdown(workingSchool, appliedChanges);
          shouldSolve = true;
          return {
            ok: true,
            summary: res.reportSummary || res.reply,
            changes: res.changes,
            quality_score: solved.schedule.quality_score,
            entries_count: solved.schedule.entries.length,
          };
        }

        case "run_domain_command": {
          const cmdText = String(args.command_text || message).trim();
          const ext = tryExecuteExtendedAgentAction(cmdText, workingSchool, workingSchedule, history);
          if (ext?.handled) {
            if (ext.updated_school) workingSchool = ext.updated_school;
            if (ext.updated_markdown) workingMarkdown = ext.updated_markdown;
            if (ext.updated_schedule) workingSchedule = ext.updated_schedule;
            if (ext.should_solve) shouldSolve = true;
            if (ext.applied_changes.length) appliedChanges.push(...ext.applied_changes);
            if (ext.ui_action) uiAction = ext.ui_action;
            if (ext.ui_target_id) uiTargetId = ext.ui_target_id;
            return {
              ok: true,
              reply: ext.reply,
              applied_changes: ext.applied_changes,
              should_solve: ext.should_solve,
            };
          }
          const periodRes = tryApplyDailyPeriodsChatCommand(workingSchool, cmdText);
          if (periodRes) {
            workingSchool = periodRes.school;
            appliedChanges.push(...periodRes.appliedChanges);
            workingMarkdown = generateSchoolMarkdown(workingSchool, appliedChanges);
            shouldSolve = true;
            return { ok: true, applied_changes: periodRes.appliedChanges, should_solve: true };
          }
          const interp = interpretCommand(cmdText, workingSchool, history);
          if (interp.understood && interp.ops.length > 0) {
            const resOps = applyOps(workingSchool, interp.ops);
            workingSchool = sanitizePlacementRuleConflicts(resOps.school, interp.ops);
            appliedChanges.push(...resOps.changes);
            workingMarkdown = generateSchoolMarkdown(workingSchool, appliedChanges);
            shouldSolve = true;
            return {
              ok: resOps.errors.length === 0,
              applied_changes: resOps.changes,
              errors: resOps.errors,
              should_solve: true,
            };
          }
          return { ok: false, error: "لم يتطابق الأمر مع أمر محلي جاهز، استخدم apply_school_modifications أو اسأل المستخدم توضيحاً." };
        }

        case "import_school_from_text": {
          const rawText = String(args.raw_text || message || "").trim();
          let rawCandidate: unknown = args.school_data ?? null;
          if (!rawCandidate && typeof args.school_data_json === "string" && args.school_data_json.trim()) {
            const cleaned = args.school_data_json
              .replace(/```json\s*/gi, "")
              .replace(/```\s*/g, "")
              .trim();
            const match = cleaned.match(/\{[\s\S]*\}/);
            if (match) {
              rawCandidate = JSON.parse(match[0]);
            }
          }

          if (rawCandidate && typeof rawCandidate === "object") {
            const normalized = normalizeAiExtractedSchoolJson(rawCandidate);
            const validation = validateSchoolDataSchema(normalized);
            if (validation.valid && validation.school) {
              const enriched = enrichExtractedSchool(validation.school);
              const reconciled = reconcileAiWithDeterministicSchool(enriched, rawText);
              workingSchool = reconciled.school;
              workingSchedule = null;
              shouldSolve = true;
              const changeLabel = `بناء وتجهيز مدرسة "${workingSchool.name}" عبر Gemini (${workingSchool.sections.length} فصول، ${workingSchool.teachers.length} معلماً، ${workingSchool.assignments.reduce((s, a) => s + a.weekly_periods, 0)} حصة)`;
              appliedChanges.push(changeLabel, ...reconciled.notes);
              workingMarkdown = generateSchoolMarkdown(workingSchool, appliedChanges);
              return {
                ok: true,
                mode: "ai_structured_extraction_and_reconciliation",
                school_name: workingSchool.name,
                shift_mode: workingSchool.shift_mode || "SINGLE",
                first_shift_sections: workingSchool.sections.filter((s) => s.shift !== "SECOND").length,
                second_shift_sections: workingSchool.sections.filter((s) => s.shift === "SECOND").length,
                sections_count: workingSchool.sections.length,
                teachers_count: workingSchool.teachers.length,
                total_weekly_periods: workingSchool.assignments.reduce((s, a) => s + a.weekly_periods, 0),
                reconciliation_notes: reconciled.notes,
                digest: buildLiveAgentContextDigest(workingSchool, null, history),
                instruction:
                  "راجع الملخص مقارنةً بنص المستخدم؛ إذا بقي أي قيد أو إجازة أو معلم أو مادة ناقصة استدعِ apply_school_modifications الآن قبل الرد النهائي.",
              };
            }
            const fallbackUnstructured = parseUnstructuredArabicSchoolText(rawText);
            if (!fallbackUnstructured) {
              return {
                ok: false,
                validation_errors: validation.errors,
                hint: "هيكل JSON به نقص. أصلح الحقول الناقصة وأعد استدعاء import_school_from_text.",
              };
            }
          }

          const hasTables = /\|[^\n]+\|/.test(rawText);
          if (hasTables) {
            const parsedTable = parseSchoolText(rawText);
            if (parsedTable.school && parsedTable.school.sections.length > 0 && parsedTable.school.assignments.length > 0) {
              workingSchool = enrichExtractedSchool(parsedTable.school);
              workingSchedule = null;
              shouldSolve = true;
              const changeLabel = `استيراد مدرسة "${workingSchool.name}" من الجداول (${workingSchool.sections.length} فصول، ${workingSchool.teachers.length} معلماً)`;
              appliedChanges.push(changeLabel);
              workingMarkdown = generateSchoolMarkdown(workingSchool, appliedChanges);
              return {
                ok: true,
                mode: "markdown_table_parser",
                digest: buildLiveAgentContextDigest(workingSchool, null, history),
              };
            }
          }

          const unstructured = parseUnstructuredArabicSchoolText(rawText);
          if (unstructured) {
            workingSchool = enrichExtractedSchool(unstructured.school);
            workingSchedule = null;
            shouldSolve = true;
            appliedChanges.push(...unstructured.notes);
            workingMarkdown = generateSchoolMarkdown(workingSchool, appliedChanges);
            return {
              ok: true,
              mode: "unstructured_bootstrap_for_ai_review",
              notes: unstructured.notes,
              digest: buildLiveAgentContextDigest(workingSchool, null, history),
              instruction:
                "تم استخراج الهيكل الأساسي. راجع كافة تفاصيل نص المستخدم بدقة: إذا وجدت أي فترة إضافية، حد حصص يومي، إجازة معلم، خانة شاغرة، أو قيد موقع لم يظهر في الملخص فاستدعِ apply_school_modifications لإكماله فوراً.",
            };
          }

          return {
            ok: false,
            error: "النص حر ويتطلب استخراجاً ذكياً متكاملاً. مرّر school_data_json الكامل إلى import_school_from_text.",
          };
        }

        case "trigger_app_action": {
          const act = String(args.action || "").trim();
          if (act === "trigger_solve") {
            shouldSolve = true;
            appliedChanges.push("إعادة توليد وبناء الجدول المدرسي بضمان 0% تعارضات");
            return { ok: true, scheduled_solve: true };
          }
          uiAction = act as AgentUiActionType;
          if (args.target_id) uiTargetId = String(args.target_id);
          return { ok: true, ui_action: uiAction, ui_target_id: uiTargetId || null };
        }

        default:
          return { ok: false, error: `الأداة "${name}" غير معروفة.` };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  };

  try {
    for (let step = 0; step < maxSteps; step++) {
      const turn = await generateTurn(contents, {
        systemInstruction: AI_TOOL_AGENT_SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: AGENT_TOOL_DECLARATIONS }],
        maxOutputTokens: 4096,
      });
      if (turn.usedModel) lastUsedModel = turn.usedModel;
      if (turn.notices?.length) {
        allNotices.push(...turn.notices);
      }

      const fcs = turn.functionCalls;
      if (fcs && fcs.length > 0) {
        contents.push(
          turn.modelContent || {
            role: "model",
            parts: fcs.map((fc) => ({ functionCall: fc })),
          }
        );

        const responseParts: Part[] = [];
        for (const fc of fcs) {
          const fnName = fc.name || "";
          const resultObj = executeSingleTool(fnName, (fc.args as Record<string, any>) || {});
          responseParts.push(createPartFromFunctionResponse(fc.id || fnName, fnName, resultObj));
        }
        contents.push({ role: "user", parts: responseParts });
        continue;
      }

      const finalReply = (turn.text || "").trim();
      if (finalReply || appliedChanges.length > 0 || uiAction) {
        // Guard against LLM claiming an edit was performed without calling any mutating tool
        const claimsEdit =
          /(?:تم\s+(?:تغيير|تعديل|تنفيذ|إضافة|حذف|تحديث|تثبيت|إسناد)|تمت\s+إضافة|تم\s+تغيير)/.test(finalReply);
        if (claimsEdit && appliedChanges.length === 0 && !uiAction && step < maxSteps - 1) {
          contents.push({ role: "model", parts: [{ text: finalReply }] });
          contents.push({
            role: "user",
            parts: [
              {
                text: "تنبيه نظام: لم يتم استدعاء أي أداة تعديل فعلية بعد (applied_changes فارغة). إذا أردت تنفيذ التعديل في قاعدة البيانات، يجب استدعاء أداة مثل apply_school_modifications أو run_domain_command أو apply_fair_distribution الآن، ولا تقل 'تم' بدون استدعاء الأداة.",
              },
            ],
          });
          continue;
        }
        if (claimsEdit && appliedChanges.length === 0 && !uiAction) {
          return {
            handled: false,
            reply: "",
            updated_school: params.school,
            updated_markdown: params.markdown,
            should_solve: false,
            applied_changes: [],
            tool_calls_used: toolCallsUsed,
            used_model: lastUsedModel,
            error_notice: "Model claimed mutation without calling any tool.",
            failure_info: classifyGeminiError("Model claimed mutation without calling any tool", lastUsedModel),
          };
        }
        const prefix = allNotices.length > 0 ? `${allNotices.join("\n")}\n\n` : "";
        const fallbackSummary =
          appliedChanges.length > 0
            ? `✓ تم تنفيذ:\n${appliedChanges.map((c) => `• ${c}`).join("\n")}${shouldSolve ? "\nوجاري إعادة بناء الجدول بضمان 0% تعارضات." : ""}`
            : "تم تنفيذ الطلب بنجاح.";
        return {
          handled: true,
          reply: prefix + (finalReply || fallbackSummary),
          updated_school: workingSchool,
          updated_markdown: workingMarkdown,
          updated_schedule: workingSchedule,
          should_solve: shouldSolve,
          applied_changes: appliedChanges,
          ui_action: uiAction,
          ui_target_id: uiTargetId,
          tool_calls_used: toolCallsUsed,
          used_model: lastUsedModel,
        };
      }
      break;
    }
  } catch (err: any) {
    return {
      handled: false,
      reply: "",
      updated_school: params.school,
      updated_markdown: params.markdown,
      should_solve: false,
      applied_changes: [],
      tool_calls_used: toolCallsUsed,
      used_model: lastUsedModel,
      error_notice: err?.message || String(err),
      failure_info: classifyGeminiError(err, lastUsedModel),
    };
  }

  return {
    handled: false,
    reply: "",
    updated_school: params.school,
    updated_markdown: params.markdown,
    should_solve: false,
    applied_changes: [],
    tool_calls_used: toolCallsUsed,
    used_model: lastUsedModel,
    failure_info: classifyGeminiError("empty response from model", lastUsedModel),
  };
}
