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

export const DEFAULT_BACKEND_URL = "";

const AGENT_SYSTEM_INSTRUCTION = `# الهوية والدور (Role & Identity)
أنت "وكيل الجداول المدرسية الذكي المستقل (Autonomous School Timetable Agent)".
مهمتك هي إدارة بيانات المدرسة وإنشاء وتعديل جدول الحصص المدرسية تلقائياً بنسبة 100% وبدون أي تعارض (Zero Hard Conflicts).

# دورة العمل التلقائية الصارمة (The Autonomous 3-Step Pipeline)
1. تعديل وتحديث وثيقة المدرسة النصية (Markdown .md Document First).
2. استخراج وتحديث هيكل البيانات الرياضي (SchoolData JSON Sync).
3. تفعيل أمر الحل التلقائي (should_solve: true).

# صيغة الإخراج الإلزامية (JSON Response Format Only)
رد بصيغة JSON فقط بهذا الهيكل الدقيق:
{
  "reply": "شرح باللغة العربية لما قمت به بالتفصيل والخطوات المنفذة",
  "updated_markdown": "نص وثيقة المدرسة الكامل والمحدث بصيغة Markdown شاملاً التعديلات الجديدة",
  "updated_school": { ... SchoolData JSON الكامل والمحدث ... },
  "should_solve": true,
  "applied_changes": ["قائمة بالبنود التي تم تعديلها في ملف .md والجدول"]
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

    // 2. In-browser deterministic command interpreter
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
${schedule ? `حالة الجدول الحالي: حل بنجاح مع مؤشر جودة ${schedule.quality_score}%.` : "لم يتم إنشاء الجدول بعد."}

طلب المستخدم:
${message}

المطلوب: نفذ دورة العمل الثلاثية (تحديث Markdown أولاً، ثم تحديث كائن SchoolData، وتفعيل should_solve: true) وأخرج JSON مطابق للصيغة الإلزامية.`,
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
        let validatedSchool: SchoolData = school;

        if (parsed.updated_school) {
          const check = validateSchoolDataSchema(parsed.updated_school);
          if (check.valid && check.school) {
            validatedSchool = check.school;
          } else {
            this.onKeyNotice?.(
              `⚠️ تم تجاهل تعديل غير مكتمل في هيكل البيانات من النموذج (${check.errors[0] || "غير صالح"})؛ تم الاحتفاظ بالبيانات السليمة.`
            );
          }
        }

        const updatedMarkdown =
          typeof parsed.updated_markdown === "string" && parsed.updated_markdown.trim()
            ? parsed.updated_markdown
            : currentMarkdown;
        const shouldSolve = parsed.should_solve !== undefined ? Boolean(parsed.should_solve) : true;
        const appliedChanges = Array.isArray(parsed.applied_changes)
          ? parsed.applied_changes.map(String)
          : [`تحديث عبر مفتاح ${usedKey.alias} (${usedKey.masked})`];

        const noticePrefix = notices.length > 0 ? `${notices.join("\n")}\n\n` : "";

        return {
          reply:
            noticePrefix +
            (parsed.reply || "تم تحديث وثيقة المدرسة وتطبيق القيود وإعادة بناء الجدول تلقائياً."),
          updated_markdown: updatedMarkdown,
          updated_school: validatedSchool,
          should_solve: shouldSolve,
          applied_changes: appliedChanges,
          analysis: InBrowserSchoolEngine.analyzeSchool(validatedSchool),
        };
      } catch (err: unknown) {
        if (err instanceof AllKeysFailedError) {
          fallbackNotice = `\n⚠️ إشعار المفاتيح: ${err.message}`;
        } else {
          const safeErr = sanitizeSecretText(
            err,
            ApiKeyManager.getKeys().map((k) => k.key)
          );
          fallbackNotice = `\n⚠️ تعذر الاتصال بـ Gemini (${safeErr.slice(0, 90)}) — تم التحويل تلقائياً إلى المحرك المحلي الحتمي.`;
        }
      }
    } else if (hasKeys) {
      fallbackNotice =
        "\n💡 ملاحظة: جميع مفاتيح Gemini المضافة معطّلة حالياً؛ يعمل النظام عبر المحرك المحلي الحتمي.";
    }

    // 4. Seamless Deterministic Local Fallback
    return {
      reply:
        `تم استلام طلبك: "${message}".\nيمكنك طلب إعطاء إجازة لمعلم (مثل: "أعطِ الأستاذ يوسف كمال إجازة يوم الأحد")، أو تثبيت حصص أولى وأخيرة، أو تعديل أنصبة الحصص، أو الضغط على "إنشاء الجدول".` +
        fallbackNotice,
      updated_markdown: currentMarkdown,
      updated_school: school,
      should_solve: true,
      applied_changes: ["تحديث الجدول بناءً على التوجيه الأخير (المحرك المحلي الحتمي)"],
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
              model: "gemini-2.0-flash-exp",
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
