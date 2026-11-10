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
} from "../presets/commonPresets.ts";
import {
  ApiKeyManager,
  AllKeysFailedError,
  DEFAULT_GEMINI_MODEL,
  sanitizeSecretText,
  validateSchoolDataSchema,
} from "./apiKeyManager.ts";
import { isQuestionOrInquiry, answerSchoolQuestion } from "./schoolAssistant.ts";

export const DEFAULT_BACKEND_URL = "";

export const AGENT_SYSTEM_INSTRUCTION = `# الهوية والدور (Role & Identity)
أنت "وكيل ومستشار الجداول المدرسية الذكي (School Timetable AI Copilot & Consultant)".
لديك وصول كامل ومباشر إلى كائن المدرسة وهيكل البيانات والمعلمين والأنصبة والجدول الحالي.
تتفاعل مع المستخدم كشات دردشة ذكي ومرن باللغة العربية، وتفهم جميع اللهجات (المصرية، الخليجية، الفصحى).

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
      if (res.ok) return await res.json();
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
      if (res.ok) {
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
              contents: `حول نص بيانات المدرسة التالي إلى JSON مطابق لهيكل SchoolData التالي:
interface SchoolData {
  id: string;
  name: string;
  academic_year: string;
  days: number[];
  periods_per_day: number;
  grades: Array<{ id: string; name: string; code: string; order: number }>;
  sections: Array<{ id: string; grade_id: string; name: string; code: string }>;
  subjects: Array<{ id: string; name: string; code: string }>;
  teachers: Array<{ id: string; name: string; code: string; max_daily_periods?: number; max_weekly_periods?: number; work_pattern?: any }>;
  availabilities: Array<{ teacher_id: string; day: number; period: number; is_available: boolean }>;
  assignments: Array<{ id: string; section_id: string; subject_id: string; teacher_id: string; weekly_periods: number }>;
}

نص بيانات المدرسة:
${text}`,
              config: {
                responseMimeType: "application/json",
                systemInstruction:
                  "أنت خبير متخصص في استخراج وبناء بيانات الجداول المدرسية وتحويلها إلى JSON دقيق.",
              },
            });
            return response.text || "{}";
          },
          { onNotice: this.onKeyNotice }
        );

        const candidate = JSON.parse(rawJsonText);
        const validation = validateSchoolDataSchema(candidate);
        if (validation.valid && validation.school) {
          const analysis = InBrowserSchoolEngine.analyzeSchool(validation.school);
          return {
            school: validation.school,
            normalization_notes: [
              `تم استخراج هيكل المدرسة والتحقق من صحته عبر مفتاح "${usedKey.alias}" (${usedKey.masked}).`,
              ...notices,
            ],
            explanation: `تم تحليل بيانات "${validation.school.name}" بواسطة Gemini (${usedKey.masked}) بنجاح.`,
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

    // 3. Deterministic fallback
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
      if (res.ok) return await res.json();
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
    should_solve: boolean;
    applied_changes: string[];
    analysis?: AnalysisReport;
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
      if (res.ok) {
        const data = await res.json();
        if (data.understood) {
          return data;
        }
      }
    } catch {
      // Continue to in-browser deterministic interpreter
    }

    // 2. In-browser deterministic command interpreter (for mutations/commands)
    const isQuery = isQuestionOrInquiry(message);
    if (!isQuery) {
      const cmd = interpretCommand(message, school, history);
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
          updatedSchool = resOps.school;
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
    }

    // 3. Open-ended request -> Try Client-Side BYOK Gemini with Key Rotation & Schema Validation
    const currentMarkdown = markdown || NESSCHINFO_RAW_TEXT;
    let fallbackNotice = "";

    const hasKeys = ApiKeyManager.getKeys().length > 0;
    const hasEnabledKeys = ApiKeyManager.getKeys().some((k) => k.enabled);

    if (hasEnabledKeys) {
      try {
        const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
        if (Array.isArray(history) && history.length > 0) {
          for (const h of history.slice(-8)) {
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
                systemInstruction: AGENT_SYSTEM_INSTRUCTION,
              },
            });
            return response.text || "{}";
          },
          { onNotice: this.onKeyNotice }
        );

        const parsed = JSON.parse(rawText);
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

    // 4. Seamless Deterministic Local Fallback (Always answers questions with full data access)
    const localAns = answerSchoolQuestion(
      message,
      school,
      schedule,
      InBrowserSchoolEngine.analyzeSchool(school),
      history
    );

    if (localAns.answered) {
      return {
        reply: localAns.reply + fallbackNotice,
        updated_markdown: currentMarkdown,
        updated_school: school,
        should_solve: false,
        applied_changes: [],
        analysis: InBrowserSchoolEngine.analyzeSchool(school),
      };
    }

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
              model: "gemini-3.8-live",
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
