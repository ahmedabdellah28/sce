/**
 * Client Service for School Timetable Studio.
 * - Uses the deterministic local engine (schoolCore + solver) first for instant, 0-conflict execution.
 * - When an unstructured text or open-ended prompt requires Gemini LLM, executes directly from the
 *   browser via Bring-Your-Own-Key (BYOK) ApiKeyManager with automatic key rotation, 60s cooldown on
 *   429/503, auto-disabling on 400/403, strict SchoolData schema validation, and secret sanitization.
 * - If all keys fail or no keys are configured, falls back seamlessly to the deterministic local engine.
 */

import { Modality, type LiveServerMessage } from "@google/genai";
import type { SchoolData, Schedule, AnalysisReport } from "../types.ts";
import {
  InBrowserSchoolEngine,
  getBuiltInSchool376,
  NESSCHINFO_RAW_TEXT,
} from "./localEngine.ts";
import {
  parseSchoolText,
  interpretCommand,
  applyOps,
  generateSchoolMarkdown,
} from "./schoolCore.ts";
import {
  ALL_SCHOOL_PRESETS,
  getPresetById,
  createSchoolFromPreset,
  expandAliasInChatMessage,
  tryApplyDailyPeriodsChatCommand,
} from "../presets/commonPresets.ts";
import {
  ApiKeyManager,
  AllKeysFailedError,
  DEFAULT_GEMINI_MODEL,
  sanitizeSecretText,
  validateSchoolDataSchema,
} from "./apiKeyManager.ts";
import { isQuestionOrInquiry, answerSchoolQuestion } from "./schoolAssistant.ts";
import { parseUnstructuredArabicSchoolText } from "./unstructuredParser.ts";
import {
  enrichMessageWithMemoryContext,
  tryExecuteExtendedAgentAction,
  buildLiveAgentContextDigest,
  sanitizePlacementRuleConflicts,
  type AgentUiActionType,
} from "./agentMemoryEngine.ts";

export const DEFAULT_BACKEND_URL = "";

export function buildSchoolExtractionPrompt(rawSchoolText: string): string {
  return `أنت خبير استخراج بيانات الجداول المدرسية. حوّل النص التالي (ولو كان مكتوباً بالعامية أو غير منظم) إلى كائن JSON واحد فقط مطابق بدقة لهيكل SchoolData التالي:

قواعد الاستخراج الإلزامية:
1. اسم المدرسة (name): استخرج الاسم الدقيق من النص (مثل "مدرسة الجمالية الإعدادية").
2. أيام الدراسة (days): استخدم ترقيم النظام المعتمد حصراً:
   - السبت = 6
   - الأحد = 0
   - الاثنين = 1
   - الثلاثاء = 2
   - الأربعاء = 3
   - الخميس = 4
   مثال من السبت للخميس: [6, 0, 1, 2, 3, 4]. من الأحد للخميس: [0, 1, 2, 3, 4].
3. عدد الحصص اليومية (periods_per_day): العدد الافتراضي الأقصى يومياً. وإذا ذُكر يوم مخفف لصف معين (مثل "أولى إعدادي يوم الخميس 5 حصص فقط") ضع daily_period_limits على هذا الصف وفصوله: { "4": 5 }.
4. الفصول (sections): كل فصل له id فريد (مثل "SEC_1_1")، وgrade_id يطابق grade.id، وname وcode مثل "1/1".
5. المواد (subjects): استخرج كل مادة مذكورة باسم واضح وid فريد (مثل "SUB_AR") ولا تنس مادة الدين أو الأنشطة أو المواد الفرعية مثل (عربي2) إن وجدت، وكذلك التعليم العام واللغات (Math, Science, Connect Plus, المستوى الرفيع) والأزهر (القرآن الكريم، الفقه، التفسير، الحديث، التوحيد، النحو، الصرف، البلاغة) والثانوي (العلوم المتكاملة، الفيزياء، الكيمياء، الأحياء، الجيولوجيا، التاريخ، الجغرافيا، الفلسفة، الإحصاء) والابتدائي المطور (اكتشف، القيم، التوكاتسو، المهارات المهنية). إذا درّس المعلم الواحد أكثر من مادة (مثل: عربي + دين)، أضف المادتين وكل تكليفاتهما كاملة!
6. المعلمون والخانات الشاغرة (teachers): استخرج كل معلم مذكور باسمه:
   - **مهم جداً — الخانات الشاغرة ("س"، "س1"، "س2"، "س3"، "س دراسات")**: في المدارس المصرية الحرف "س" (سواء منفرداً أو متبوعاً برقم مثل "س1، س2، س3" أو متبوعاً باسم المادة مثل "س عربي، س دين، س دراسات، س رياضيات") يعني **خانة شاغرة / احتياج معلم** ويدرّس تلك المادة. احتفظ بكل منها كمعلم مستقل كامل التكليفات وسمّه بوضوح مثل "س1 (شاغر)"، "س عربي (شاغر)"، "س دين (شاغر)"، "س دراسات (شاغر)" بدون استخدام كلمة "عجز" ولا تحذفها أو تدمجها أبداً!
   - الإجازات وأيام العمل: سواء ذُكرت كإجازة ("واخد إجازة التلات والاربع والخميس") أو كأيام حضور ("بتيجي سبت واحد واتنين" / "لا يعمل غير الأربعاء")، ضع جميع أيام الغياب في work_pattern.day_rules كـ "MANDATORY_OFF".
   - حصص متأخرة / أخيرة: أضف في work_pattern.placement_rules: { "day": null, "placement_type": "LAST_N", "n_periods": 2, "is_hard": true }.
   - تجنب الحصة الأولى ("متتحطش في الأول"): أضف { "day": null, "placement_type": "AVOID_FIRST", "n_periods": 1, "is_hard": true }.
   - حد حصص يومي ("مينفعش تاخد غير حصتين يوم الاربع"): أضف في work_pattern.daily_period_rules: { "day": 3, "rule_type": "MAX", "count": 2, "is_hard": true, "weight": 10 }.
   - إذا ذُكر مزدوجة للمعلم ضع force_double_periods: true. إذا ذُكر حد التتابع العام (مثل 3 حصص) ضع max_consecutive_periods على كل معلم.
7. الإسنادات والملاحظات (assignments) — مهم جداً:
   - يمكنك وضع section_ids مصفوفة للفصول المتماثلة لنفس المعلم والمادة والعدد:
     { "teacher_id": "TCH_YASSER", "subject_id": "SUB_COMP", "section_ids": ["SEC_1_1","SEC_1_2","SEC_1_3","SEC_1_4","SEC_2_1","SEC_2_2","SEC_3_1","SEC_3_2"], "weekly_periods": 1 }
   - انتبه للملاحظات التكميلية مثل "(ملاحظة: فصل 1/1 فاضله 3 حصص دين ممكن نديهم لـ س3)" وقم بإضافة تكليفها حتى يكتمل نصاب كل فصل تماماً ولا تسقط أي مادة مثل الدين أو الأنشطة!

الهيكل المطلوب (JSON فقط):
{
  "id": "sch_ai_1",
  "name": "string",
  "academic_year": "2025/2026",
  "days": [6, 0, 1, 2, 3, 4],
  "periods_per_day": 6,
  "grades": [{ "id": "G1", "name": "الأول الإعدادي", "code": "G1", "order": 1, "daily_period_limits": {} }],
  "sections": [{ "id": "SEC_1_1", "grade_id": "G1", "name": "1/1", "code": "1/1", "daily_period_limits": {} }],
  "subjects": [{ "id": "SUB_1", "name": "عربي", "code": "عربي", "double_period_policy": "FREE" }],
  "teachers": [{
    "id": "TCH_1",
    "name": "string",
    "code": "string",
    "subject_ids": ["SUB_1"],
    "max_daily_periods": 6,
    "max_weekly_periods": 24,
    "max_consecutive_periods": 3,
    "force_double_periods": false,
    "work_pattern": { "day_rules": {}, "daily_period_rules": [], "placement_rules": [] }
  }],
  "availabilities": [],
  "assignments": [{ "section_ids": ["SEC_1_1"], "subject_id": "SUB_1", "teacher_id": "TCH_1", "weekly_periods": 6 }]
}

نص بيانات المدرسة:
${rawSchoolText}`;
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

  return {
    ...candidate,
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
  return {
    ...school,
    teachers: teachersWithSubjects,
  };
}

/**
 * Cross-checks Gemini LLM extraction against our deterministic unstructured Arabic parser.
 * Guarantees Gemini never silently drops deficit teachers ("س1", "س2", "س3", "س دراسات"),
 * subjects (like "دين"), missing note assignments, or teacher off-day/placement constraints.
 */
export function reconcileAiWithDeterministicSchool(
  aiSchool: SchoolData,
  rawText: string
): { school: SchoolData; notes: string[] } {
  const det = parseUnstructuredArabicSchoolText(rawText);
  if (!det) return { school: aiSchool, notes: [] };
  const detSchool = det.school;

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
  const aiHasDeficitMarkers = aiSchool.teachers.some((t) => t.name.includes("شاغر") || t.name.includes("عجز") || /(?:^|\s)س\s*(?:\d*|[\u0600-\u06FF]+)/.test(t.name));
  const detHasDeficitMarkers = detSchool.teachers.some((t) => t.name.includes("شاغر") || t.name.includes("عجز"));

  const missingSubjectsOrTeachers =
    detSchool.subjects.length > aiSchool.subjects.length ||
    detSchool.teachers.length > aiSchool.teachers.length ||
    detSchool.days.length > aiSchool.days.length ||
    detTotalPeriods > aiTotalPeriods ||
    detOffCount > aiOffCount ||
    (detHasDeficitMarkers && !aiHasDeficitMarkers);

  if (missingSubjectsOrTeachers) {
    return {
      school: {
        ...detSchool,
        name: aiSchool.name && aiSchool.name.length >= 4 && aiSchool.name !== "مدرسة جديدة" ? aiSchool.name : detSchool.name,
      },
      notes: [
        `تم استكمال البيانات والتأكد من عدم إسقاط أي مادة (مثل الدين) أو الخانات الشاغرة (س1/س2) أو قيود المعلمين (${detSchool.sections.length} فصول، ${detSchool.teachers.length} معلماً، ${detTotalPeriods} حصة).`,
      ],
    };
  }
  return { school: aiSchool, notes: [] };
}

export const AGENT_SYSTEM_INSTRUCTION = `# الهوية والدور (Role & Identity)
أنت "وكيل ومستشار الجداول المدرسية الذكي (School Timetable AI Copilot & Consultant)".
لديك وصول كامل ومباشر إلى كائن المدرسة وهيكل البيانات والمعلمين والأنصبة والجدول الحالي.
تتفاعل مع المستخدم كشات دردشة ذكي ومرن باللغة العربية، وتفهم جميع اللهجات (المصرية، الخليجية، الفصحى).
تفهم مصطلحات المدارس المصرية بدقة: "س" أو "س1" أو "س2" أو "س" متبوعة باسم المادة (مثل "س عربي" أو "س دين" أو "س دراسات") تعني خانة شاغرة مؤقتة (احتياج معلم غير معين حالياً) ويجب ذكرها وحساب حصصها بوضوح عند السؤال عن الشواغر أو الاحتياج أو الأنصبة، دون استخدام كلمة "عجز".

# أوضاع العمل التفاعلية (Operational Modes)
1. وضع الدردشة والإجابة والاستفسارات (Conversational & Q&A Mode):
   - عندما يسأل المستخدم أي سؤال عن المدرسة، المعلمين، الفصول، الحصص، الإجازات، الجدوى، أو يطلب فحصاً للجدول أو نصيحة، أو يحييك:
   - أجب بإجابة عربية وافية ودقيقة ومباشرة بناءً على أرقام وبيانات المدرسة والجدول المرفقة.
   - ضع "should_solve": false، و "applied_changes": [].

2. وضع الأوامر والتعديلات (Modification & Scheduling Mode):
   - عندما يطلب المستخدم تعديلاً صريحاً على الجدول أو المدرسة (مثل إعطاء إجازة، تبديل حصص، تعديل أنصبة، إضافة معلم، أو إنشاء/إعادة حل الجدول):
   - قم بتحديث وثيقة Markdown وكائن SchoolData، وضع "should_solve": true، واذكر البنود المعدلة في "applied_changes".

# صيغة الإخراج الإلزامية (JSON Response Format)
رد بصيغة JSON فقط بهذا الهيكل:
{
  "reply": "الإجابة الوافية أو شرح التعديلات باللغة العربية",
  "updated_markdown": "نص وثيقة المدرسة المحدث أو null إذا لم يكن هناك تعديل",
  "updated_school": { ... SchoolData المحدث أو null إذا لم يكن هناك تعديل ... },
  "should_solve": false,
  "applied_changes": []
}`;

export class HybridSchoolService {
  private backendUrl: string;
  private onKeyNotice?: (notice: string) => void;

  constructor(backendUrl: string = DEFAULT_BACKEND_URL, onKeyNotice?: (notice: string) => void) {
    this.backendUrl = backendUrl.replace(/\/$/, "");
    this.onKeyNotice = onKeyNotice;
  }

  setConfig(backendUrl: string) {
    this.backendUrl = backendUrl.replace(/\/$/, "");
  }

  setKeyNoticeHandler(handler?: (notice: string) => void) {
    this.onKeyNotice = handler;
  }

  private getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
    };
  }

  async checkBackendHealth(): Promise<{ online: boolean; engine?: string; hasKey?: boolean }> {
    const hasUserKeys = ApiKeyManager.getKeys().some((k) => k.enabled);
    try {
      const res = await fetch(`${this.backendUrl}/api/health`, { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        return {
          online: true,
          engine: data.engine,
          hasKey: hasUserKeys,
        };
      }
    } catch {
      // Offline / static browser mode works 100% locally
    }
    return {
      online: true,
      engine: "BYOK Gemini (Client-Side) + المحرك المحلي المدمج",
      hasKey: hasUserKeys,
    };
  }

  async listPresets(): Promise<Array<{ id: string; name: string; description: string; is_common_preset?: boolean; school_type?: string; stage?: string }>> {
    try {
      const res = await fetch(`${this.backendUrl}/api/presets`, { headers: this.getHeaders() });
      if (res.ok) {
        const data = await res.json();
        return data.presets || [];
      }
    } catch {
      // Fallback preset
    }
    const common = ALL_SCHOOL_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      is_common_preset: true,
      school_type: p.school_type,
      stage: p.stage,
    }));
    const defaultSchool = getBuiltInSchool376();
    return [
      ...common,
      {
        id: "school_376",
        name: `${defaultSchool.name} (إعدادي - ${defaultSchool.sections.length} فصول - 36 حصة)`,
        description:
          "البيانات الكاملة: الأحد 8 حصص وباقي الأيام 7 حصص مع كافة قيود الحصص الأولى والأخيرة.",
        is_common_preset: false,
      },
    ];
  }

  async loadPreset(
    presetId: string
  ): Promise<{ school: SchoolData; raw_text: string; analysis: AnalysisReport }> {
    try {
      const res = await fetch(`${this.backendUrl}/api/presets/${presetId}`, {
        headers: this.getHeaders(),
      });
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) return await res.json();
    } catch {
      // Fallback
    }

    const commonPreset = getPresetById(presetId);
    if (commonPreset) {
      const school = createSchoolFromPreset(presetId);
      const analysis = InBrowserSchoolEngine.analyzeSchool(school);
      const raw_text = generateSchoolMarkdown(school);
      return {
        school,
        raw_text,
        analysis,
      };
    }

    const school = getBuiltInSchool376();
    const analysis = InBrowserSchoolEngine.analyzeSchool(school);
    return {
      school,
      raw_text: NESSCHINFO_RAW_TEXT,
      analysis,
    };
  }

  /**
   * Parses raw school text:
   * 1. First attempts deterministic extraction via schoolCore (instant & offline-ready).
   * 2. If unstructured/freeform prompt and user has active BYOK Gemini keys, uses executeWithRotation
   *    and validates the returned SchoolData schema before accepting it.
   * 3. If all keys fail or none are configured, falls back cleanly to the deterministic local parser.
   */
  async parseRawText(text: string): Promise<{
    school: SchoolData;
    normalization_notes: string[];
    unparsed_notes?: string[];
    explanation: string;
    analysis: AnalysisReport;
  }> {
    // 1. Server / Local deterministic parser first
    try {
      const res = await fetch(`${this.backendUrl}/api/ai/parse`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ text }),
      });
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json();
        if (!data.needs_client_ai) {
          return data;
        }
      }
    } catch {
      // Continue to in-browser deterministic check
    }

    const parsed = parseSchoolText(text);
    if (
      parsed.school &&
      parsed.school.sections.length > 0 &&
      parsed.school.teachers.length > 0 &&
      parsed.school.assignments.length > 0
    ) {
      const analysis = InBrowserSchoolEngine.analyzeSchool(parsed.school);
      return {
        school: parsed.school,
        normalization_notes: parsed.parseNotes || [],
        unparsed_notes: parsed.unparsed_notes || [],
        explanation: `تم استخراج وتحليل بيانات "${parsed.school.name}" (${parsed.school.sections.length} فصول، ${parsed.school.teachers.length} معلمين، ${parsed.school.assignments.length} تكليفات) محلياً بنجاح.`,
        analysis,
      };
    }

    const defaultSchool = getBuiltInSchool376();
    if (text.includes(defaultSchool.name)) {
      const analysis = InBrowserSchoolEngine.analyzeSchool(defaultSchool);
      return {
        school: defaultSchool,
        normalization_notes: [
          "تم استخراج 7 فصول و20 معلماً و252 حصة أسبوعية مع شروط الحصص الأولى والأخيرة.",
          "تم فصل المعلمين المشتركين في نفس المادة والفصل تلقائياً.",
        ],
        explanation: `تم فهم وتحليل بيانات "${defaultSchool.name}" بنجاح.`,
        analysis,
      };
    }

    // 2. Try Client-Side BYOK Gemini with Auto-Rotation & Schema Validation
    const hasEnabledKeys = ApiKeyManager.getKeys().some((k) => k.enabled);
    if (hasEnabledKeys) {
      try {
        const { result: rawJsonText, usedKey, notices } = await ApiKeyManager.executeWithRotation(
          async (client) => {
            const response = await client.models.generateContent({
              model: DEFAULT_GEMINI_MODEL,
              contents: buildSchoolExtractionPrompt(text),
              config: {
                responseMimeType: "application/json",
                maxOutputTokens: 16384,
                systemInstruction:
                  "أنت خبير متخصص في استخراج وبناء بيانات الجداول المدرسية وتحويلها إلى JSON دقيق.",
              },
            });
            return response.text || "{}";
          },
          { onNotice: this.onKeyNotice }
        );

        const candidate = normalizeAiExtractedSchoolJson(JSON.parse(rawJsonText));
        const validation = validateSchoolDataSchema(candidate);
        if (validation.valid && validation.school) {
          const enriched = enrichExtractedSchool(validation.school);
          const reconciled = reconcileAiWithDeterministicSchool(enriched, text);
          const finalSchool = reconciled.school;
          const analysis = InBrowserSchoolEngine.analyzeSchool(finalSchool);
          return {
            school: finalSchool,
            normalization_notes: [
              `تم استخراج هيكل المدرسة والتحقق من صحته عبر مفتاح "${usedKey.alias}" (${usedKey.masked}).`,
              ...reconciled.notes,
              ...notices,
            ],
            explanation: `تم تحليل بيانات "${finalSchool.name}" بنجاح.`,
            analysis,
          };
        } else {
          this.onKeyNotice?.(
            `⚠️ مخرجات الذكاء الاصطناعي لم تطابق الهيكل المطلوب (${validation.errors[0] || "غير مكتمل"}). تم التحويل للمحرك المحلي الحتمي.`
          );
        }
      } catch (err: unknown) {
        if (err instanceof AllKeysFailedError) {
          this.onKeyNotice?.(err.message);
        } else {
          const safeMsg = sanitizeSecretText(
            err,
            ApiKeyManager.getKeys().map((k) => k.key)
          );
          console.warn("BYOK Gemini parse fallback:", safeMsg);
        }
      }
    }

    // 3. Deterministic unstructured Arabic prose fallback (handles human freeform notes offline & on 503!)
    const unstructured = parseUnstructuredArabicSchoolText(text);
    if (unstructured) {
      return {
        school: unstructured.school,
        normalization_notes: unstructured.notes,
        unparsed_notes: [],
        explanation: unstructured.notes[0],
        analysis: InBrowserSchoolEngine.analyzeSchool(unstructured.school),
      };
    }

    // 4. Final fallback
    const school =
      parsed?.school && parsed.school.sections.length > 0 ? parsed.school : getBuiltInSchool376();
    return {
      school,
      normalization_notes: parsed?.parseNotes || [],
      unparsed_notes: parsed?.unparsed_notes || [],
      explanation: "تم تحليل البيانات باستخدام المحرك المحلي المدمج.",
      analysis: InBrowserSchoolEngine.analyzeSchool(school),
    };
  }

  async analyzeSchool(
    school: SchoolData,
    schedule?: Schedule | null
  ): Promise<{
    school: SchoolData;
    normalization_notes: string[];
    analysis: AnalysisReport;
  }> {
    try {
      const res = await fetch(`${this.backendUrl}/api/analyze`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ school, schedule: schedule || null }),
      });
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) return await res.json();
    } catch {
      // Local fallback
    }
    return {
      school,
      normalization_notes: [],
      analysis: InBrowserSchoolEngine.analyzeSchool(school),
    };
  }

  /**
   * Autonomous Timetable Agent interaction:
   * 1. First runs the deterministic command interpreter (server or in-browser schoolCore) which handles
   *    all Arabic dialects (Egyptian/Gulf), day-offs, first/last periods, quota updates, teacher add/remove,
   *    period swaps, undo, and full .md imports with 100% precision.
   * 2. If the message is an open-ended natural language request not matched deterministically:
   *    - Attempts BYOK Gemini execution with automatic key rotation and strict SchoolData schema validation.
   *    - If all keys fail or no keys are configured, notifies the user clearly and continues seamlessly
   *      with the deterministic local engine.
   */
  async chatWithCopilot(
    message: string,
    school: SchoolData,
    schedule?: Schedule | null,
    markdown?: string,
    history?: Array<{ role: "user" | "ai" | "model"; text: string }>
  ): Promise<{
    reply: string;
    updated_markdown?: string | null;
    updated_school: SchoolData | null;
    updated_schedule?: Schedule | null;
    should_solve: boolean;
    applied_changes: string[];
    analysis?: AnalysisReport;
    ui_action?: AgentUiActionType;
    ui_target_id?: string;
  }> {
    // 1. Try server deterministic interpreter (which also resolves local .md file references in dev)
    try {
      const res = await fetch(`${this.backendUrl}/api/ai/chat`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          message,
          school,
          schedule: schedule || null,
          markdown: markdown || null,
          history: history || [],
        }),
      });
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json();
        if (data.understood) {
          return data;
        }
      }
    } catch {
      // Continue to in-browser deterministic interpreter
    }

    const currentMarkdown = markdown || NESSCHINFO_RAW_TEXT;
    // 2. In-browser deterministic command interpreter (for mutations/commands)
    const isQuery = isQuestionOrInquiry(message);
    const ctxMessage = enrichMessageWithMemoryContext(message, school, history);
    if (!isQuery) {
      // 2a. Full multi-line school import pasted directly into chat
      if (message.trim().split(/\r?\n/).length >= 5 && message.trim().length >= 150) {
        const hasMarkdownTables = /\|[^\n]+\|/.test(message);
        if (!hasMarkdownTables) {
          const unstructuredFull = parseUnstructuredArabicSchoolText(message);
          if (unstructuredFull) {
            return {
              reply: `✓ ${unstructuredFull.notes[0]}\nجاري تحديث الجدول وإعادة التوزيع الآن.`,
              updated_markdown: generateSchoolMarkdown(unstructuredFull.school, unstructuredFull.notes),
              updated_school: unstructuredFull.school,
              should_solve: true,
              applied_changes: unstructuredFull.notes,
              analysis: InBrowserSchoolEngine.analyzeSchool(unstructuredFull.school),
            };
          }
        }
        const parsedFull = parseSchoolText(message);
        if (parsedFull.school && parsedFull.school.sections.length >= 2 && parsedFull.school.assignments.length >= 4) {
          const msgChange = `استيراد مدرسة "${parsedFull.school.name}" (${parsedFull.school.sections.length} فصول، ${parsedFull.school.teachers.length} معلماً)`;
          return {
            reply: `✓ تم ${msgChange} بنجاح، وجاري توليد الجدول فوراً.`,
            updated_markdown: generateSchoolMarkdown(parsedFull.school, [msgChange]),
            updated_school: parsedFull.school,
            should_solve: true,
            applied_changes: [msgChange],
            analysis: InBrowserSchoolEngine.analyzeSchool(parsedFull.school),
          };
        }
        const unstructuredFallback = parseUnstructuredArabicSchoolText(message);
        if (unstructuredFallback) {
          return {
            reply: `✓ ${unstructuredFallback.notes[0]}\nجاري تحديث الجدول وإعادة التوزيع الآن.`,
            updated_markdown: generateSchoolMarkdown(unstructuredFallback.school, unstructuredFallback.notes),
            updated_school: unstructuredFallback.school,
            should_solve: true,
            applied_changes: unstructuredFallback.notes,
            analysis: InBrowserSchoolEngine.analyzeSchool(unstructuredFallback.school),
          };
        }
      }
      const extAction = tryExecuteExtendedAgentAction(ctxMessage, school, schedule, history);
      if (extAction && extAction.handled) {
        const nextSchool = extAction.updated_school || school;
        return {
          reply: extAction.reply,
          updated_markdown: extAction.updated_markdown || currentMarkdown,
          updated_school: extAction.updated_school || school,
          updated_schedule: extAction.updated_schedule || null,
          should_solve: extAction.should_solve,
          applied_changes: extAction.applied_changes,
          analysis: InBrowserSchoolEngine.analyzeSchool(nextSchool),
          ui_action: extAction.ui_action,
          ui_target_id: extAction.ui_target_id,
        };
      }
      const periodCmd = tryApplyDailyPeriodsChatCommand(school, ctxMessage);
      if (periodCmd) {
        return {
          updated_school: periodCmd.school,
          updated_markdown: generateSchoolMarkdown(periodCmd.school, periodCmd.appliedChanges),
          applied_changes: periodCmd.appliedChanges,
          should_solve: true,
          reply: periodCmd.reply,
          analysis: InBrowserSchoolEngine.analyzeSchool(periodCmd.school),
        };
      }
      const normalizedForCmd = /^(?:من فضلك\s+|لو سمحت\s+|ممكن\s+)?(?:حدث|تحديث|اعمل تحديث|اعد تحديث|جدد|ابني|إعادة بناء)\s*(?:ل)?(?:ال)?جدول/.test(ctxMessage.trim())
        ? "حل الجدول"
        : expandAliasInChatMessage(school.subjects, ctxMessage);
      const cmd = interpretCommand(normalizedForCmd, school, history);
      if (cmd.understood) {
        let updatedSchool = school;
        let updatedMarkdown = markdown || "";
        let appliedChanges: string[] = [];
        let shouldSolve = true;
        let reply = "";

        if (cmd.new_school_text) {
          const parsed = parseSchoolText(cmd.new_school_text);
          updatedSchool = parsed.school;
          appliedChanges = [
            `إنشاء مدرسة جديدة باسم "${updatedSchool.name}" (${updatedSchool.sections.length} فصول، ${updatedSchool.teachers.length} معلماً)`,
          ];
          updatedMarkdown = generateSchoolMarkdown(updatedSchool, appliedChanges);
          reply = `تم استيراد مدرسة "${updatedSchool.name}" بنجاح! تم بناء هيكل البيانات المكتمل، وجاري إنشاء الجدول تلقائياً.`;
        } else if (cmd.solve_only) {
          shouldSolve = true;
          appliedChanges = ["إعادة توزيع وإنشاء الجدول المدرسي بالكامل لضمان 0% تعارضات"];
          reply = `تم استلام طلبك لإنشاء وتوزيع الجدول المدرسي. جاري حل وتوليد الجدول الآن بأعلى دقة رياضية ومؤشر جودة مرتفع.`;
        } else if (cmd.ops.length > 0) {
          const resOps = applyOps(school, cmd.ops);
          updatedSchool = sanitizePlacementRuleConflicts(resOps.school, cmd.ops);
          appliedChanges = resOps.changes;
          updatedMarkdown = generateSchoolMarkdown(updatedSchool, appliedChanges);
          reply =
            appliedChanges.length > 0
              ? `تم تنفيذ التعديل المطلوب بنجاح وتحديث وثيقة المدرسة (.md):\n` +
                appliedChanges.map((c) => `✓ ${c}`).join("\n") +
                `\nوجاري إعادة بناء وتوزيع الجدول تلقائياً بضمان 0% تعارضات.`
              : `تم استلام طلبك وتحديث بيانات المدرسة وإعادة إنشاء الجدول.`;
        }

        return {
          reply,
          updated_markdown: updatedMarkdown,
          updated_school: updatedSchool,
          should_solve: shouldSolve,
          applied_changes: appliedChanges,
          analysis: InBrowserSchoolEngine.analyzeSchool(updatedSchool),
        };
      }

      // Also support pasting full unstructured Arabic school prose directly into chat in browser-only mode
      if (message.trim().length >= 120) {
        const unstructured = parseUnstructuredArabicSchoolText(message);
        if (unstructured) {
          return {
            reply: `✓ ${unstructured.notes[0]}\nجاري تحديث الجدول وإعادة التوزيع الآن.`,
            updated_markdown: generateSchoolMarkdown(unstructured.school, unstructured.notes),
            updated_school: unstructured.school,
            should_solve: true,
            applied_changes: unstructured.notes,
            analysis: InBrowserSchoolEngine.analyzeSchool(unstructured.school),
          };
        }
      }
    }

    // 3. Deterministic Local School Q&A Assistant FIRST (exact quotas, off-days, vacancies, schedules, audit)
    const preAnalysis = InBrowserSchoolEngine.analyzeSchool(school);
    const localAns = answerSchoolQuestion(message, school, schedule, preAnalysis, history);
    if (localAns.answered) {
      return {
        reply: localAns.reply,
        updated_markdown: currentMarkdown,
        updated_school: school,
        should_solve: false,
        applied_changes: [],
        analysis: preAnalysis,
      };
    }

    // 4. Open-ended conversational request or novel mutation -> Client-Side BYOK Gemini with Schema Validation
    let fallbackNotice = "";

    const hasKeys = ApiKeyManager.getKeys().length > 0;
    const hasEnabledKeys = ApiKeyManager.getKeys().some((k) => k.enabled);

    if (hasEnabledKeys) {
      try {
        const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
        if (Array.isArray(history) && history.length > 0) {
          for (const h of history.slice(-14)) {
            if (h && h.text && h.role) {
              contents.push({
                role: h.role === "user" ? "user" : "model",
                parts: [{ text: h.text }],
              });
            }
          }
        }

        contents.push({
          role: "user",
          parts: [
            {
              text: `وثيقة المدرسة الحالية بصيغة Markdown:
\`\`\`markdown
${currentMarkdown}
\`\`\`

كائن بيانات المدرسة الحالي (SchoolData JSON):
\`\`\`json
${JSON.stringify(school)}
\`\`\`
${schedule ? `حالة الجدول الحالي: حل بنجاح (${schedule.entries.length} حصة مجدولة، مؤشر جودة ${schedule.quality_score}%، 0 تعارضات).` : "لم يتم إنشاء الجدول بعد."}
${buildLiveAgentContextDigest(school, schedule, history)}

طلب أو سؤال المستخدم:
${message}

المطلوب:
إذا كان السؤال استفساراً أو طلباً للمعلومات أو محادثة، أجب بإجابة عربية وافية ودقيقة وضع "should_solve": false.
إذا كان الطلب تعديلاً في الجدول، نفذ التعديل وضع "should_solve": true واذكر التغييرات.`,
            },
          ],
        });

        const { result: rawText, usedKey, notices } = await ApiKeyManager.executeWithRotation(
          async (client) => {
            const response = await client.models.generateContent({
              model: DEFAULT_GEMINI_MODEL,
              contents,
              config: {
                responseMimeType: "application/json",
                maxOutputTokens: 16384,
                systemInstruction: AGENT_SYSTEM_INSTRUCTION,
              },
            });
            return response.text || "{}";
          },
          { onNotice: this.onKeyNotice }
        );

        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
        const noticePrefix = notices.length > 0 ? `${notices.join("\n")}\n\n` : "";

        if (parsed.reply) {
          const isMutation = parsed.should_solve === true && parsed.updated_school;
          let validatedSchool: SchoolData = school;

          if (isMutation) {
            const check = validateSchoolDataSchema(parsed.updated_school);
            if (check.valid && check.school) {
              validatedSchool = check.school;
            } else {
              this.onKeyNotice?.(
                `⚠️ تم تجاهل تعديل غير مكتمل في هيكل البيانات من النموذج؛ تم الاحتفاظ بالبيانات السليمة.`
              );
            }
          }

          const updatedMarkdown =
            isMutation && typeof parsed.updated_markdown === "string" && parsed.updated_markdown.trim()
              ? parsed.updated_markdown
              : currentMarkdown;

          const appliedChanges = isMutation && Array.isArray(parsed.applied_changes)
            ? parsed.applied_changes.map(String)
            : [];

          return {
            reply: noticePrefix + parsed.reply,
            updated_markdown: updatedMarkdown,
            updated_school: isMutation ? validatedSchool : school,
            should_solve: Boolean(isMutation),
            applied_changes: appliedChanges,
            analysis: InBrowserSchoolEngine.analyzeSchool(isMutation ? validatedSchool : school),
          };
        }
      } catch (err: unknown) {
        if (err instanceof AllKeysFailedError) {
          fallbackNotice = `\n⚠️ إشعار المفاتيح: ${err.message}`;
        } else {
          const safeErr = sanitizeSecretText(
            err,
            ApiKeyManager.getKeys().map((k) => k.key)
          );
          fallbackNotice = `\n⚠️ تعذر الاتصال بـ Gemini (${safeErr.slice(0, 90)}) — تم التحويل تلقائياً إلى المحرك المحلي.`;
        }
      }
    } else if (hasKeys) {
      fallbackNotice =
        "\n💡 ملاحظة: جميع مفاتيح Gemini المضافة معطّلة حالياً؛ يعمل النظام عبر المحرك المحلي.";
    }

    // 5. Fallback summary if no BYOK key or Gemini call could not answer

    return {
      reply:
        `أهلاً بك! بخصوص استفسارك عن مدرسة "${school.name}":\n` +
        `المدرسة تضم ${school.sections.length} فصول و${school.teachers.length} معلماً بإجمالي ${school.assignments.reduce((s, a) => s + a.weekly_periods, 0)} حصة أسبوعياً.\n` +
        `يمكنك سؤالي عن أنصبة أي معلم، أي يوم إجازة، جداول الفصول، أو طلب أي تعديل وسأنفذه فوراً.` +
        fallbackNotice,
      updated_markdown: currentMarkdown,
      updated_school: school,
      should_solve: false,
      applied_changes: [],
      analysis: InBrowserSchoolEngine.analyzeSchool(school),
    };
  }

  /**
   * Connects directly from the browser to Gemini Live API using the user's BYOK key (with rotation).
   */
  connectLiveSession(handlers: {
    onAudioChunk?: (base64Audio: string) => void;
    onInterrupted?: () => void;
    onError?: (err: any) => void;
    onOpen?: () => void;
    onClose?: () => void;
  }) {
    let activeSession: any = null;
    let closed = false;

    (async () => {
      try {
        const { result: session } = await ApiKeyManager.executeWithRotation(
          async (client) => {
            return await client.live.connect({
              model: "gemini-2.5-flash-native-audio-preview-09-2025",
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
                },
                systemInstruction:
                  "أنت المساعد الصوتي المباشر لاستوديو جداول الحصص المدرسية. تتحدث باللغة العربية بود ووضوح وتقدم استشارات سريعة حول تنظيم وتوزيع الحصص.",
              },
              callbacks: {
                onopen: () => {
                  if (!closed) handlers.onOpen?.();
                },
                onmessage: (message: LiveServerMessage) => {
                  if (closed) return;
                  for (const part of message.serverContent?.modelTurn?.parts ?? []) {
                    if (part.inlineData?.data && handlers.onAudioChunk) {
                      handlers.onAudioChunk(part.inlineData.data);
                    }
                  }
                  if (message.serverContent?.interrupted && handlers.onInterrupted) {
                    handlers.onInterrupted();
                  }
                },
                onerror: (err: any) => {
                  const safeMsg = sanitizeSecretText(
                    err,
                    ApiKeyManager.getKeys().map((k) => k.key)
                  );
                  handlers.onError?.(new Error(safeMsg));
                },
                onclose: () => {
                  handlers.onClose?.();
                },
              },
            });
          },
          { onNotice: this.onKeyNotice }
        );

        if (closed) {
          try {
            session.close();
          } catch {}
          return;
        }
        activeSession = session;
      } catch (err: unknown) {
        const safeMsg = sanitizeSecretText(
          err,
          ApiKeyManager.getKeys().map((k) => k.key)
        );
        handlers.onError?.(new Error(safeMsg));
        handlers.onClose?.();
      }
    })();

    return {
      sendAudio: (base64Audio: string) => {
        if (activeSession && !closed) {
          try {
            activeSession.sendRealtimeInput({
              audio: { data: base64Audio, mimeType: "audio/pcm;rate=16000" },
            });
          } catch {}
        }
      },
      sendText: (text: string) => {
        if (activeSession && !closed) {
          try {
            activeSession.sendRealtimeInput({ text });
          } catch {}
        }
      },
      close: () => {
        closed = true;
        if (activeSession) {
          try {
            activeSession.close();
          } catch {}
          activeSession = null;
        }
        handlers.onClose?.();
      },
    };
  }

  async solveSchedule(
    school: SchoolData,
    maxTimeSeconds: number = 15
  ): Promise<{
    school: SchoolData;
    schedule: Schedule;
    validation: { is_valid: boolean; errors: any[]; warnings: any[] };
    metrics: any;
    normalization_notes: string[];
    analysis: AnalysisReport;
  }> {
    try {
      const res = await fetch(`${this.backendUrl}/api/solve`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          school,
          max_time_seconds: maxTimeSeconds,
          random_seed: 42,
          auto_normalize: true,
        }),
      });
      if (res.ok) return await res.json();
    } catch {
      // Local solver fallback
    }

    const solved = InBrowserSchoolEngine.solveInBrowser(school);
    const analysis = InBrowserSchoolEngine.analyzeSchool(school);
    return {
      school,
      schedule: solved.schedule,
      validation: solved.validation,
      metrics: solved.metrics,
      normalization_notes: [],
      analysis,
    };
  }

  async downloadExport(
    type: "pdf" | "excel",
    school: SchoolData,
    schedule: Schedule,
    mode: string = "all"
  ) {
    if (type === "pdf") {
      InBrowserSchoolEngine.exportPrintablePDF(school, schedule, mode);
    } else {
      InBrowserSchoolEngine.exportExcelWorkbook(school, schedule);
    }
  }
}
