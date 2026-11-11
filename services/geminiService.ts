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
  executeGeminiParsedResponse,
  type AgentUiActionType,
  type EngineResponseMeta,
  type GeminiFailureInfo,
} from "./agentMemoryEngine.ts";
import { runGeminiToolCallingAgent, classifyGeminiError } from "./agentTools.ts";
import {
  buildSchoolExtractionPrompt,
  normalizeAiExtractedSchoolJson,
  enrichExtractedSchool,
  reconcileAiWithDeterministicSchool,
} from "./schoolImportHelper.ts";

export {
  buildSchoolExtractionPrompt,
  normalizeAiExtractedSchoolJson,
  enrichExtractedSchool,
  reconcileAiWithDeterministicSchool,
};

export const DEFAULT_BACKEND_URL = "";

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

2. وضع الأوامر والتعديلات المهيكلة (Structured Ops Tool Calling):
   - عند طلب أي تعديل على المدرسة أو المعلمين أو الحصص أو القيود، أعد مصفوفة "ops" بالعمليات الحتمية الدقيقة بدلاً من إعادة كتابة كائن المدرسة الضخم (اترك "updated_school": null عندما تستخدم "ops"):
     • إجازة/أوف معلم: { "op": "set_teacher_days", "teacher": "الاسم", "off_days": [0..6] } أو { "op": "set_teacher_days", "teacher": "الاسم", "allow_days": [3] } (حيث السبت=6، الأحد=0، الاثنين=1، الثلاثاء=2، الأربعاء=3، الخميس=4).
     • قيد موقع حصة لمعلم: { "op": "add_placement_rule", "teacher": "الاسم", "day": 0 أو null لكل الأيام, "type": "AVOID_FIRST"|"AVOID_LAST"|"AVOID_PERIODS"|"FIRST_N"|"LAST_N"|"EXACT_PERIODS"|"HAS_LAST", "n": 2, "periods": [1,2], "hard": true|false }.
     • حد يومي لمعلم: { "op": "set_daily_count", "teacher": "الاسم", "day": 3, "count": 2, "rule_type": "MAX"|"EXACT"|"MIN", "hard": true }.
     • حدود التتابع/يومي للمعلم: { "op": "set_teacher_limits", "teacher": "الاسم", "max_consecutive": 2, "max_daily": 5, "max_weekly": 20 }.
     • إسناد/تعديل حصة فصل: { "op": "set_assignment", "section": "1/1", "subject": "التربية الدينية", "teacher": "الاسم", "periods": 3 }.
     • تبديل/إضافة/حذف معلم أو فصل: { "op": "add_teacher"|"remove_teacher"|"replace_teacher"|"swap_teachers"|"add_section"|"remove_section", ... }.
     • سياسة المزدوجة أو الفسحة: { "op": "set_double_policy", "subject": "...", "policy": "REQUIRED"|"SINGLE"|"FREE" } أو { "op": "set_subject_rule", "subject": "...", "before_break": true }.

3. وضع الشات الفعلي والاستيضاح (Clarification & Advisory Dialogue):
   - إذا كان الطلب غامضاً أو يؤثر على نطاق واسع بدون تحديد (مثل "ثبّت حصة العربي" دون فصل أو يوم)، لا تنفذ عمياء؛ اسأل المستخدم سؤالاً توضيحياً لطيفاً مع خيارات واضحة وضع "should_solve": false, "ops": [].
   - إذا سأل المستخدم استشارة ("ينفع ندي فلان إجازة؟"، "ترشحلي مين؟") احسب الأرقام من بيانات المدرسة واشرح الرأي التربوي واعرض التنفيذ عند موافقته.

# صيغة الإخراج الإلزامية (JSON Response Format)
رد بصيغة JSON فقط بهذا الهيكل:
{
  "reply": "الإجابة الوافية أو شرح التعديلات باللغة العربية",
  "ops": [],
  "updated_markdown": null,
  "updated_school": null,
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
  async parseRawText(
    text: string,
    options?: { preferAi?: boolean }
  ): Promise<{
    school: SchoolData;
    normalization_notes: string[];
    unparsed_notes?: string[];
    explanation: string;
    analysis: AnalysisReport;
    engine_source?: EngineResponseMeta;
  }> {
    const hasEnabledKeys = ApiKeyManager.getKeys().some((k) => k.enabled);
    const hasMarkdownTables = /\|[^\n]+\|/.test(text);
    const preferAi = options?.preferAi !== false;
    let serverFailure: GeminiFailureInfo | undefined;

    // 1. Server / Local parser (tries Server Gemini first on freeform prompts)
    try {
      const res = await fetch(`${this.backendUrl}/api/ai/parse`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          text,
          has_client_key: hasEnabledKeys,
          prefer_ai: preferAi,
        }),
      });
      if (res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json();
        if (res.ok && !data.needs_client_ai) {
          return data;
        }
        if (data.server_failure) {
          serverFailure = data.server_failure;
        }
      }
    } catch {
      // Continue to in-browser check
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
        engine_source: {
          source: "local_engine",
          via: "local_fallback",
          model_used: "نموذج محفوظ",
        },
      };
    }

    // 2. Deterministic Markdown Table parser ONLY when structured tables exist (avoid bypassing AI on freeform prompts!)
    const parsed = hasMarkdownTables ? parseSchoolText(text) : null;
    if (
      hasMarkdownTables &&
      parsed?.school &&
      parsed.school.sections.length > 0 &&
      parsed.school.teachers.length > 0 &&
      parsed.school.assignments.length > 0
    ) {
      const analysis = InBrowserSchoolEngine.analyzeSchool(parsed.school);
      return {
        school: parsed.school,
        normalization_notes: parsed.parseNotes || [],
        unparsed_notes: parsed.unparsed_notes || [],
        explanation: `تم استخراج وتحليل بيانات "${parsed.school.name}" (${parsed.school.sections.length} فصول، ${parsed.school.teachers.length} معلمين، ${parsed.school.assignments.length} تكليفات) بنجاح.`,
        analysis,
        engine_source: {
          source: "local_engine",
          via: "local_fallback",
          model_used: "محلل الجداول المنظمة",
        },
      };
    }

    // 3. AI-FIRST PRIORITY: Client-Side BYOK Gemini with Auto-Rotation & Schema Validation
    let clientFailure: GeminiFailureInfo | undefined = serverFailure;
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
                  "أنت خبير متخصص في استخراج وبناء بيانات الجداول المدرسية وتحويلها إلى JSON دقيق يضع كل معلومة وقيد وفترة في مكانها الصحيح.",
              },
            });
            return response.text || "{}";
          },
          { onNotice: this.onKeyNotice }
        );

        const cleanedJson = String(rawJsonText || "{}")
          .replace(/```json\s*/gi, "")
          .replace(/```\s*/g, "")
          .trim();
        const jsonMatch = cleanedJson.match(/\{[\s\S]*\}/);
        const candidate = normalizeAiExtractedSchoolJson(JSON.parse(jsonMatch ? jsonMatch[0] : cleanedJson));
        const validation = validateSchoolDataSchema(candidate);
        if (validation.valid && validation.school) {
          const enriched = enrichExtractedSchool(validation.school);
          const reconciled = reconcileAiWithDeterministicSchool(enriched, text);
          const finalSchool = reconciled.school;
          const analysis = InBrowserSchoolEngine.analyzeSchool(finalSchool);
          return {
            school: finalSchool,
            normalization_notes: [
              `تم فهم وتحليل بيانات المدرسة عبر Gemini (${usedKey.alias} · ${usedKey.masked}).`,
              ...reconciled.notes,
              ...notices,
            ],
            explanation: `تم فهم وتحليل بيانات "${finalSchool.name}" عبر Gemini AI بنجاح.`,
            analysis,
            engine_source: {
              source: "gemini_api",
              via: "browser_byok",
              model_used: DEFAULT_GEMINI_MODEL,
              tool_calls_used: [],
            },
          };
        } else {
          clientFailure = classifyGeminiError(
            new Error(validation.errors[0] || "AI schema invalid"),
            DEFAULT_GEMINI_MODEL
          );
          this.onKeyNotice?.(
            `⚠️ مخرجات الذكاء الاصطناعي لم تطابق الهيكل المطلوب (${validation.errors[0] || "غير مكتمل"}). تم التحويل للمحرك المحلي الحتمي.`
          );
        }
      } catch (err: unknown) {
        clientFailure = classifyGeminiError(err, DEFAULT_GEMINI_MODEL);
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
    } else if (!clientFailure) {
      clientFailure = classifyGeminiError("NO_KEY", DEFAULT_GEMINI_MODEL);
    }

    // 4. Deterministic unstructured Arabic prose fallback (handles freeform notes offline & on API failure)
    const unstructured = parseUnstructuredArabicSchoolText(text);
    if (unstructured) {
      return {
        school: unstructured.school,
        normalization_notes: unstructured.notes,
        unparsed_notes: [],
        explanation: unstructured.notes[0],
        analysis: InBrowserSchoolEngine.analyzeSchool(unstructured.school),
        engine_source: {
          source: "local_engine",
          via: "local_fallback",
          model_used: "المحرك المحلي",
          failure: clientFailure,
        },
      };
    }

    // 5. Final fallback
    const fallbackParsed = parsed || parseSchoolText(text);
    const hasParsedSchool =
      fallbackParsed?.school &&
      fallbackParsed.school.sections.length > 0 &&
      fallbackParsed.school.assignments.length > 0;

    if (!hasParsedSchool && preferAi) {
      throw new Error(
        `تعذر تحليل النص واستخراج المدرسة عبر Gemini (${clientFailure?.reason_ar || "الخدمة غير متاحة"})، كما لم يحتوِ النص على جداول أو تكليفات واضحة للمحرك المحلي. يرجى التحقق من مفتاح Gemini API أو صياغة الفصول والمعلمين بوضوح.`
      );
    }

    const school = hasParsedSchool ? fallbackParsed.school : getBuiltInSchool376();
    return {
      school,
      normalization_notes: fallbackParsed?.parseNotes || [],
      unparsed_notes: fallbackParsed?.unparsed_notes || [],
      explanation: "تم تحليل البيانات باستخدام المحرك المحلي المدمج.",
      analysis: InBrowserSchoolEngine.analyzeSchool(school),
      engine_source: {
        source: "local_engine",
        via: "local_fallback",
        model_used: "المحرك المحلي",
        failure: clientFailure,
      },
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
    history?: Array<{ role: "user" | "ai" | "model"; text: string }>,
    options?: { requireGeminiFirst?: boolean; forceLocalFallback?: boolean }
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
    needs_api_or_local_choice?: boolean;
    engine_source?: EngineResponseMeta;
  }> {
    const hasKeys = ApiKeyManager.getKeys().length > 0;
    const hasEnabledKeys = ApiKeyManager.getKeys().some((k) => k.enabled);

    let serverFailure: GeminiFailureInfo | undefined;

    // 1. Try Backend Server API (runs Server Gemini Tool Agent first if configured, or local .md file loader)
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
          has_client_key: hasEnabledKeys,
          require_gemini: Boolean(options?.requireGeminiFirst && !options?.forceLocalFallback),
          force_local_fallback: Boolean(options?.forceLocalFallback),
        }),
      });
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json();
        if (data.understood) {
          return data;
        }
        if (data.server_failure) {
          serverFailure = data.server_failure;
        }
      }
    } catch {
      // Offline / static browser mode continues directly below
    }

    const currentMarkdown = markdown || NESSCHINFO_RAW_TEXT;

    // 2. Fast deterministic path for huge Markdown tables, OR unstructured prose ONLY when forcing local fallback / offline with no Gemini keys
    if (message.trim().split(/\r?\n/).length >= 5 && message.trim().length >= 150) {
      const hasMarkdownTables = /\|[^\n]+\|/.test(message);
      if (hasMarkdownTables) {
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
            engine_source: {
              source: "local_engine",
              via: "local_fallback",
              model_used: "محلل الجداول المنظمة",
            },
          };
        }
      }
      if (options?.forceLocalFallback || (!hasEnabledKeys && !options?.requireGeminiFirst)) {
        const unstructuredFull = parseUnstructuredArabicSchoolText(message);
        if (unstructuredFull) {
          return {
            reply: `✓ ${unstructuredFull.notes[0]}\nجاري تحديث الجدول وإعادة التوزيع الآن.`,
            updated_markdown: generateSchoolMarkdown(unstructuredFull.school, unstructuredFull.notes),
            updated_school: unstructuredFull.school,
            should_solve: true,
            applied_changes: unstructuredFull.notes,
            analysis: InBrowserSchoolEngine.analyzeSchool(unstructuredFull.school),
            engine_source: {
              source: "local_engine",
              via: "local_fallback",
              model_used: "المحرك المحلي",
              failure: serverFailure,
            },
          };
        }
      }
    }

    // 3. AI-FIRST PRIORITY: Client-Side BYOK Gemini Tool-Calling Agent when browser key is active
    let fallbackNotice = "";
    let byokFailure: GeminiFailureInfo | undefined = serverFailure;
    if (hasEnabledKeys && !options?.forceLocalFallback) {
      try {
        const toolRes = await runGeminiToolCallingAgent({
          message,
          school,
          markdown: currentMarkdown,
          schedule: schedule || null,
          history: Array.isArray(history) ? history : [],
          generateTurn: async (contents, config) => {
            const { result, notices } = await ApiKeyManager.executeWithRotation(
              async (client) => {
                const response = await client.models.generateContent({
                  model: DEFAULT_GEMINI_MODEL,
                  contents,
                  config: {
                    systemInstruction: config.systemInstruction,
                    tools: config.tools,
                    maxOutputTokens: config.maxOutputTokens || 4096,
                  },
                });
                return {
                  text: response.text || "",
                  functionCalls: response.functionCalls,
                  modelContent: response.candidates?.[0]?.content as any,
                  usedModel: DEFAULT_GEMINI_MODEL,
                };
              },
              { onNotice: this.onKeyNotice }
            );
            return { ...result, notices };
          },
        });
        if (toolRes.handled) {
          return {
            reply: toolRes.reply,
            updated_markdown: toolRes.updated_markdown,
            updated_school: toolRes.updated_school,
            updated_schedule: toolRes.updated_schedule || null,
            should_solve: toolRes.should_solve,
            applied_changes: toolRes.applied_changes,
            ui_action: toolRes.ui_action,
            ui_target_id: toolRes.ui_target_id,
            engine_source: {
              source: "gemini_api",
              via: "browser_byok",
              model_used: toolRes.used_model || DEFAULT_GEMINI_MODEL,
              tool_calls_used: toolRes.tool_calls_used,
            },
            analysis: InBrowserSchoolEngine.analyzeSchool(toolRes.updated_school),
          };
        }
        byokFailure = toolRes.failure_info || classifyGeminiError("empty response from model", DEFAULT_GEMINI_MODEL);
      } catch (err: unknown) {
        const safeErrObj =
          err instanceof AllKeysFailedError
            ? err
            : sanitizeSecretText(
                err,
                ApiKeyManager.getKeys().map((k) => k.key)
              );
        byokFailure = classifyGeminiError(safeErrObj, DEFAULT_GEMINI_MODEL);
        if (err instanceof AllKeysFailedError) {
          fallbackNotice = `\n⚠️ إشعار المفاتيح: ${err.message}`;
        } else {
          fallbackNotice = `\n⚠️ تعذر الاتصال بـ Gemini (${String(safeErrObj).slice(0, 90)}) — تم التحويل تلقائياً إلى المحرك المحلي.`;
        }
      }
    } else if (!hasEnabledKeys && !byokFailure) {
      byokFailure = classifyGeminiError(
        hasKeys ? "جميع مفاتيح Gemini المضافة معطّلة حالياً" : "No Gemini client configured",
        DEFAULT_GEMINI_MODEL
      );
    }

    // Strict Gemini-First Mode for Interactive UI: Ask user to add new API key or proceed with lower-precision local engine
    if (options?.requireGeminiFirst && !options?.forceLocalFallback) {
      const failInfo = byokFailure || classifyGeminiError("No Gemini client configured", DEFAULT_GEMINI_MODEL);
      return {
        reply:
          `⚠️ تعذر الحصول على رد من وكيل Gemini:\n${failInfo.reason_ar}\n\n` +
          `يمكنك **إضافة مفتاح API جديد** لإعادة المحاولة بالذكاء الاصطناعي الكامل، أو اختيار **الإكمال بالمحرك المحلي (أقل دقة)**.`,
        updated_markdown: currentMarkdown,
        updated_school: school,
        should_solve: false,
        applied_changes: [],
        needs_api_or_local_choice: true,
        engine_source: {
          source: "gemini_failed",
          via: "none",
          model_used: failInfo.model_attempted,
          failure: failInfo,
        },
        analysis: InBrowserSchoolEngine.analyzeSchool(school),
      };
    }

    const disabledKeysNotice = !hasEnabledKeys && hasKeys ? "\n💡 ملاحظة: جميع مفاتيح Gemini المضافة معطّلة حالياً؛ يعمل النظام عبر المحرك المحلي." : "";
    const localMeta: EngineResponseMeta = {
      source: "local_engine",
      via: "local_fallback",
      model_used: "المحرك المحلي",
      failure: byokFailure,
    };

    // 4. Deterministic Local Engine Fallback (works 100% offline with zero keys)
    if (message.trim().split(/\r?\n/).length >= 5 && message.trim().length >= 150) {
      const parsedFallback = parseSchoolText(message);
      if (parsedFallback.school && parsedFallback.school.sections.length >= 2 && parsedFallback.school.assignments.length >= 4) {
        const msgChange = `استيراد مدرسة "${parsedFallback.school.name}" (${parsedFallback.school.sections.length} فصول، ${parsedFallback.school.teachers.length} معلماً)`;
        return {
          reply: `✓ تم ${msgChange} بنجاح، وجاري توليد الجدول فوراً.${fallbackNotice}${disabledKeysNotice}`,
          updated_markdown: generateSchoolMarkdown(parsedFallback.school, [msgChange]),
          updated_school: parsedFallback.school,
          should_solve: true,
          applied_changes: [msgChange],
          analysis: InBrowserSchoolEngine.analyzeSchool(parsedFallback.school),
          engine_source: localMeta,
        };
      }
      const unstructuredFallback = parseUnstructuredArabicSchoolText(message);
      if (unstructuredFallback) {
        return {
          reply: `✓ ${unstructuredFallback.notes[0]}\nجاري تحديث الجدول وإعادة التوزيع الآن.${fallbackNotice}${disabledKeysNotice}`,
          updated_markdown: generateSchoolMarkdown(unstructuredFallback.school, unstructuredFallback.notes),
          updated_school: unstructuredFallback.school,
          should_solve: true,
          applied_changes: unstructuredFallback.notes,
          analysis: InBrowserSchoolEngine.analyzeSchool(unstructuredFallback.school),
          engine_source: localMeta,
        };
      }
    }

    const isQuery = isQuestionOrInquiry(message);
    const ctxMessage = enrichMessageWithMemoryContext(message, school, history);
    if (!isQuery) {
      const extAction = tryExecuteExtendedAgentAction(ctxMessage, school, schedule, history);
      if (extAction && extAction.handled) {
        const nextSchool = extAction.updated_school || school;
        return {
      engine_source: localMeta,
          reply: extAction.reply + fallbackNotice,
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
      engine_source: localMeta,
          updated_school: periodCmd.school,
          updated_markdown: generateSchoolMarkdown(periodCmd.school, periodCmd.appliedChanges),
          applied_changes: periodCmd.appliedChanges,
          should_solve: true,
          reply: periodCmd.reply + fallbackNotice,
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
      engine_source: localMeta,
          reply: reply + fallbackNotice,
          updated_markdown: updatedMarkdown,
          updated_school: updatedSchool,
          should_solve: shouldSolve,
          applied_changes: appliedChanges,
          analysis: InBrowserSchoolEngine.analyzeSchool(updatedSchool),
        };
      }

      if (message.trim().length >= 120) {
        const unstructured = parseUnstructuredArabicSchoolText(message);
        if (unstructured) {
          return {
      engine_source: localMeta,
            reply: `✓ ${unstructured.notes[0]}\nجاري تحديث الجدول وإعادة التوزيع الآن.` + fallbackNotice,
            updated_markdown: generateSchoolMarkdown(unstructured.school, unstructured.notes),
            updated_school: unstructured.school,
            should_solve: true,
            applied_changes: unstructured.notes,
            analysis: InBrowserSchoolEngine.analyzeSchool(unstructured.school),
          };
        }
      }
    }

    const preAnalysis = InBrowserSchoolEngine.analyzeSchool(school);
    const localAns = answerSchoolQuestion(message, school, schedule, preAnalysis, history);
    if (localAns.answered) {
      return {
      engine_source: localMeta,
        reply: localAns.reply + fallbackNotice,
        updated_markdown: currentMarkdown,
        updated_school: school,
        should_solve: false,
        applied_changes: [],
        analysis: preAnalysis,
      };
    }

    return {
      engine_source: localMeta,
      reply:
        `أهلاً بك! بخصوص استفسارك عن مدرسة "${school.name}":\n` +
        `المدرسة تضم ${school.sections.length} فصول و${school.teachers.length} معلماً بإجمالي ${school.assignments.reduce((s, a) => s + a.weekly_periods, 0)} حصة أسبوعياً.\n` +
        `يمكنك سؤالي عن أنصبة أي معلم، أي يوم إجازة، جداول الفصول، أو طلب أي تعديل وسأنفذه فوراً.` +
        (fallbackNotice || disabledKeysNotice),
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
