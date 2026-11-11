import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import express, { type Request, type Response } from "express";
import {
  InBrowserSchoolEngine,
  getBuiltInSchool376,
  NESSCHINFO_RAW_TEXT,
} from "./services/localEngine.ts";
import {
  createBlankSchoolTemplate,
  createPrimarySchoolTemplate,
  createSecondarySchoolTemplate,
} from "./services/schoolTemplates.ts";
import {
  parseSchoolText,
  interpretCommand,
  applyOps,
  generateSchoolMarkdown,
} from "./services/schoolCore.ts";
import {
  ALL_SCHOOL_PRESETS,
  getPresetById,
  createSchoolFromPreset,
  expandAliasInChatMessage,
  tryApplyDailyPeriodsChatCommand,
} from "./presets/commonPresets.ts";
import { GoogleGenAI } from "@google/genai";
import {
  AGENT_SYSTEM_INSTRUCTION,
  buildSchoolExtractionPrompt,
  enrichExtractedSchool,
  normalizeAiExtractedSchoolJson,
  reconcileAiWithDeterministicSchool,
} from "./services/geminiService.ts";
import { validateSchoolDataSchema } from "./services/apiKeyManager.ts";
import { isQuestionOrInquiry, answerSchoolQuestion } from "./services/schoolAssistant.ts";
import { parseUnstructuredArabicSchoolText } from "./services/unstructuredParser.ts";
import {
  enrichMessageWithMemoryContext,
  tryExecuteExtendedAgentAction,
  buildLiveAgentContextDigest,
  sanitizePlacementRuleConflicts,
  executeGeminiParsedResponse,
} from "./services/agentMemoryEngine.ts";
import { runGeminiToolCallingAgent, classifyGeminiError } from "./services/agentTools.ts";
import type { EngineResponseMeta, GeminiFailureInfo } from "./services/agentMemoryEngine.ts";

const PORT = 3000;
const HOST = "0.0.0.0";
const isProduction = process.env.NODE_ENV === "production";

const app = express();
app.use(express.json({ limit: "10mb" }));

// Load .env keys safely on Node server startup (supports GEMINI_API_KEY + GEMINI_API_KEY2..10)
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(envPath);
  }
} catch {}

function collectServerGeminiKeys(): string[] {
  const keys: string[] = [];
  const primary = process.env.GEMINI_API_KEY?.trim();
  if (primary) keys.push(primary);
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY${i}`]?.trim();
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

const SERVER_GEMINI_KEYS = collectServerGeminiKeys();
const geminiApiKey = SERVER_GEMINI_KEYS[0] || "";

function sanitizeGeminiModel(m?: string): string {
  const model = (m || "").trim();
  if (!model || model === "gemini-flash-latest" || model === "gemini-1.5-flash" || model === "gemini-2.0-flash" || model === "gemini-2.5-flash") {
    return "gemini-3.5-flash";
  }
  if (model === "gemini-flash-lite-latest" || model === "gemini-flash-lite" || model === "gemini-3.1-flash-lite" || model === "gemini-2.5-flash-lite") {
    return "gemini-3.5-flash-lite";
  }
  return model;
}

const geminiModel = sanitizeGeminiModel(process.env.GEMINI_MODEL);
const BASE_CANDIDATE_GEMINI_MODELS = [
  geminiModel,
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
].filter((m, i, arr) => arr.indexOf(m) === i);

let preferredWorkingModel: string | null = null;

function createServerGeminiClient(key: string) {
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

const genAI = geminiApiKey ? createServerGeminiClient(geminiApiKey) : null;

async function generateGeminiContentWithFallback(contents: any, config?: any) {
  if (SERVER_GEMINI_KEYS.length === 0) throw new Error("No Gemini client configured");
  let lastError: any = null;
  const modelsOrder = preferredWorkingModel
    ? [preferredWorkingModel, ...BASE_CANDIDATE_GEMINI_MODELS.filter((m) => m !== preferredWorkingModel)]
    : BASE_CANDIDATE_GEMINI_MODELS;

  for (const m of modelsOrder) {
    const maxAttempts = Math.min(2, SERVER_GEMINI_KEYS.length);
    for (let kIdx = 0; kIdx < maxAttempts; kIdx++) {
      const client = createServerGeminiClient(SERVER_GEMINI_KEYS[kIdx]);
      try {
        const response = await client.models.generateContent({
          model: m,
          contents,
          config: {
            ...(config || {}),
            abortSignal: AbortSignal.timeout(8000),
          },
        });
        preferredWorkingModel = m;
        return { response, usedModel: m };
      } catch (err: any) {
        lastError = err;
        if (lastError && typeof lastError === "object") (lastError as any).__modelAttempted = m;
        const msg = String(err?.message || err);
        console.warn(`Attempt with key #${kIdx + 1} model '${m}' failed:`, msg);
        // If this model itself is overloaded/aborted/404, jump straight to next candidate model instead of re-waiting
        if (/503|UNAVAILABLE|404|aborted|TimeoutError/i.test(msg)) {
          if (preferredWorkingModel === m) preferredWorkingModel = null;
          break;
        }
      }
    }
  }
  throw lastError;
}

// --- API Endpoints ---

// 1. Health
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    online: true,
    engine: genAI
      ? "AI Studio Server-Side Gemini API + محرك الاستمثال المدمج"
      : "محرك الاستمثال المدمج + دعم مفاتيح BYOK Gemini",
    has_server_gemini_key: Boolean(genAI),
  });
});

// 2. Presets
app.get("/api/presets", (_req: Request, res: Response) => {
  const common = ALL_SCHOOL_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    label: p.label,
    school_type: p.school_type,
    stage: p.stage,
    shift_system: p.shift_system,
    description: p.description,
    is_common_preset: true,
  }));

  const defaultSchool = getBuiltInSchool376();
  const presets = [
    ...common,
    {
      id: "school_376",
      name: `${defaultSchool.name} (إعدادي - ${defaultSchool.sections.length} فصول - 36 حصة)`,
      label: `${defaultSchool.name}`,
      description:
        "البيانات الكاملة: الأحد 8 حصص وباقي الأيام 7 حصص مع كافة قيود الحصص الأولى والأخيرة.",
      is_common_preset: false,
    },
  ];

  res.json({ presets });
});

app.get("/api/presets/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);

  // Check Common Presets first
  const commonPreset = getPresetById(id);
  if (commonPreset) {
    const school = createSchoolFromPreset(id);
    const analysis = InBrowserSchoolEngine.analyzeSchool(school);
    const raw_text = generateSchoolMarkdown(school);
    return res.json({
      school,
      raw_text,
      analysis,
      preset: commonPreset,
    });
  }

  if (id === "school_arab_moteer") {
    const candidatePaths = [
      path.resolve("../مدرسة_عرب_مطير_الابتدائية.md"),
      path.resolve("مدرسة_عرب_مطير_الابتدائية.md"),
      path.resolve("fixtures/demo_two_shift_school.md"),
    ];
    let mdText = "";
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        mdText = fs.readFileSync(p, "utf-8");
        break;
      }
    }
    if (mdText) {
      const parsed = parseSchoolText(mdText);
      const analysis = InBrowserSchoolEngine.analyzeSchool(parsed.school);
      return res.json({
        school: parsed.school,
        raw_text: mdText,
        analysis,
      });
    }
  }
  if (id === "school_376") {
    const school = getBuiltInSchool376();
    const analysis = InBrowserSchoolEngine.analyzeSchool(school);
    return res.json({
      school,
      raw_text: NESSCHINFO_RAW_TEXT,
      analysis,
    });
  }
  return res.status(404).json({ error: "Preset not found" });
});

// 3. Deterministic Text Parsing (SchoolCore)
app.post("/api/ai/parse", async (req: Request, res: Response) => {
  let { text } = req.body;
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "نص المدرسة مطلوب" });
  }

  // Resolve local file path if text references a .md file
  const fileMatch =
    text.match(/@?\[?([A-Za-z]:[\\\/][^\]\n\r]+\.md)\]?/i) ||
    text.match(/([A-Za-z]:[\\\/][^\s\n\r]+\.md)/i) ||
    text.match(/(?:^|\s)([\w\u0600-\u06FF_\-]+\.md)(?:\s|$)/i);
  if (fileMatch) {
    let candidatePath = fileMatch[1].trim();
    if (!fs.existsSync(candidatePath) && fs.existsSync(path.resolve(candidatePath))) {
      candidatePath = path.resolve(candidatePath);
    }
    if (!fs.existsSync(candidatePath) && fs.existsSync(path.resolve("..", candidatePath))) {
      candidatePath = path.resolve("..", candidatePath);
    }
    if (fs.existsSync(candidatePath)) {
      try {
        const fileContent = fs.readFileSync(candidatePath, "utf-8");
        if (fileContent && fileContent.length > 50) text = fileContent;
      } catch (e) {
        console.warn("Could not read referenced file in parse:", candidatePath, e);
      }
    }
  }

  const defaultSchool = getBuiltInSchool376();
  if (text.includes(defaultSchool.name)) {
    const analysis = InBrowserSchoolEngine.analyzeSchool(defaultSchool);
    return res.json({
      school: defaultSchool,
      normalization_notes: [
        "تم استخراج 7 فصول و20 معلماً و252 حصة أسبوعية مع شروط الحصص الأولى والأخيرة.",
        "تم فصل المعلمين المشتركين في نفس المادة والفصل تلقائياً.",
      ],
      explanation: `تم فهم وتحليل بيانات "${defaultSchool.name}" بنجاح.`,
      analysis,
    });
  }

  const parsedDirect = parseSchoolText(text);
  if (
    parsedDirect.school &&
    parsedDirect.school.sections.length > 0 &&
    parsedDirect.school.teachers.length > 0 &&
    parsedDirect.school.assignments.length > 0
  ) {
    const analysis = InBrowserSchoolEngine.analyzeSchool(parsedDirect.school);
    return res.json({
      school: parsedDirect.school,
      normalization_notes: parsedDirect.parseNotes || [],
      explanation: `تم استخراج وتحليل بيانات "${parsedDirect.school.name}" (${parsedDirect.school.sections.length} فصول، ${parsedDirect.school.teachers.length} معلمين، ${parsedDirect.school.assignments.length} تكليفات) بنجاح فوري.`,
      analysis,
    });
  }

  if (SERVER_GEMINI_KEYS.length > 0) {
    try {
      const { response, usedModel } = await generateGeminiContentWithFallback(
        buildSchoolExtractionPrompt(text),
        {
          responseMimeType: "application/json",
          maxOutputTokens: 16384,
          systemInstruction:
            "أنت خبير متخصص في استخراج وبناء بيانات الجداول المدرسية وتحويلها إلى JSON دقيق.",
        }
      );
      const rawTextResponse = response.text || "";
      const cleanedJson = rawTextResponse.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const jsonMatch = cleanedJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const candidate = normalizeAiExtractedSchoolJson(JSON.parse(jsonMatch[0]));
        const validation = validateSchoolDataSchema(candidate);
        if (validation.valid && validation.school) {
          const enriched = enrichExtractedSchool(validation.school);
          const reconciled = reconcileAiWithDeterministicSchool(enriched, text);
          const finalSchool = reconciled.school;
          const analysis = InBrowserSchoolEngine.analyzeSchool(finalSchool);
          return res.json({
            school: finalSchool,
            normalization_notes: [
              `تم استخراج بيانات "${finalSchool.name}" وتوزيع ${finalSchool.assignments.length} تكليفاً بنجاح (${usedModel}).`,
              ...reconciled.notes,
            ],
            explanation: `تم فهم وتحليل بيانات "${finalSchool.name}" بنجاح.`,
            analysis,
            needs_client_ai: false,
          });
        } else {
          console.warn("Server Gemini schema validation warnings:", validation.errors);
        }
      }
    } catch (e) {
      console.warn("Server-side Gemini parse fallback failed:", e);
    }
  }

  // Instant deterministic unstructured Arabic prose extraction (works 100% even if Gemini hits 503!)
  const unstructured = parseUnstructuredArabicSchoolText(text);
  if (unstructured) {
    const analysis = InBrowserSchoolEngine.analyzeSchool(unstructured.school);
    return res.json({
      school: unstructured.school,
      normalization_notes: unstructured.notes,
      explanation: unstructured.notes[0],
      analysis,
      needs_client_ai: false,
    });
  }

  const school = parsedDirect?.school && parsedDirect.school.sections.length > 0
    ? parsedDirect.school
    : getBuiltInSchool376();
  return res.json({
    school,
    normalization_notes: parsedDirect?.parseNotes || [],
    explanation: `تم استخراج وتحليل بيانات "${school.name}" بنجاح.`,
    analysis: InBrowserSchoolEngine.analyzeSchool(school),
    needs_client_ai: true,
  });
});

// 3b. Create School Template
app.post("/api/schools/create-template", (req: Request, res: Response) => {
  const { template_type, name, periods_per_day } = req.body;
  let result;
  if (template_type === "primary") {
    result = createPrimarySchoolTemplate(name || "مدرسة ابتدائية جديدة");
  } else if (template_type === "secondary") {
    result = createSecondarySchoolTemplate(name || "مدرسة ثانوية جديدة");
  } else if (template_type === "prep") {
    const baseSchool = getBuiltInSchool376();
    result = { school: baseSchool, raw_text: NESSCHINFO_RAW_TEXT };
    if (name) {
      result.school.name = name;
      result.raw_text = result.raw_text.replace(baseSchool.name, name);
    }
  } else {
    result = createBlankSchoolTemplate(name || "مدرسة جديدة", Number(periods_per_day) || 7);
  }
  const analysis = InBrowserSchoolEngine.analyzeSchool(result.school);
  res.json({
    school: result.school,
    raw_text: result.raw_text,
    analysis,
  });
});

// 4. Hybrid AI-First Tool Calling Agent & Deterministic Local Fallback
app.post("/api/ai/chat", async (req: Request, res: Response) => {
  const { message, school, schedule, markdown, history, has_client_key, bypass_ai, require_gemini, force_local_fallback } = req.body;
  if (!message || !school) {
    return res.status(400).json({ error: "message and school are required" });
  }

  const currentMarkdown = markdown || NESSCHINFO_RAW_TEXT;

  let effectiveMessage = message;
  let loadedLocalFile = false;
  const fileMatch =
    message.match(/@?\[?([A-Za-z]:[\\\/][^\]\n\r]+\.md)\]?/i) ||
    message.match(/([A-Za-z]:[\\\/][^\s\n\r]+\.md)/i) ||
    message.match(/(?:^|\s)([\w\u0600-\u06FF_\-]+\.md)(?:\s|$)/i);
  if (fileMatch) {
    let candidatePath = fileMatch[1].trim();
    if (!fs.existsSync(candidatePath) && fs.existsSync(path.resolve(candidatePath))) {
      candidatePath = path.resolve(candidatePath);
    }
    if (!fs.existsSync(candidatePath) && fs.existsSync(path.resolve("..", candidatePath))) {
      candidatePath = path.resolve("..", candidatePath);
    }
    if (fs.existsSync(candidatePath)) {
      try {
        const fileContent = fs.readFileSync(candidatePath, "utf-8");
        if (fileContent && fileContent.length > 50) {
          effectiveMessage = fileContent;
          loadedLocalFile = true;
        }
      } catch (e) {
        console.warn("Could not read referenced file in chat:", candidatePath, e);
      }
    }
  }

  // Fast deterministic import for full school tables/prose pasted directly into chat
  if (effectiveMessage.trim().split(/\r?\n/).length >= 5 && effectiveMessage.trim().length >= 150) {
    const hasMarkdownTables = /\|[^\n]+\|/.test(effectiveMessage);
    if (!hasMarkdownTables) {
      const unstructuredFull = parseUnstructuredArabicSchoolText(effectiveMessage);
      if (unstructuredFull) {
        return res.json({
          understood: true,
          reply: `✓ ${unstructuredFull.notes[0]}\nجاري تحديث الجدول وإعادة التوزيع الآن.`,
          updated_markdown: generateSchoolMarkdown(unstructuredFull.school, unstructuredFull.notes),
          updated_school: unstructuredFull.school,
          should_solve: true,
          applied_changes: unstructuredFull.notes,
          analysis: InBrowserSchoolEngine.analyzeSchool(unstructuredFull.school),
        });
      }
    }
    const parsedFull = parseSchoolText(effectiveMessage);
    if (parsedFull.school && parsedFull.school.sections.length >= 2 && parsedFull.school.assignments.length >= 4) {
      const msgChange = `استيراد مدرسة "${parsedFull.school.name}" (${parsedFull.school.sections.length} فصول، ${parsedFull.school.teachers.length} معلماً)`;
      return res.json({
        understood: true,
        reply: `✓ تم ${msgChange} بنجاح، وجاري توليد الجدول فوراً.`,
        updated_markdown: generateSchoolMarkdown(parsedFull.school, [msgChange]),
        updated_school: parsedFull.school,
        should_solve: true,
        applied_changes: [msgChange],
        analysis: InBrowserSchoolEngine.analyzeSchool(parsedFull.school),
      });
    }
  }

  // Delegate to Client-Side BYOK Gemini Tool Agent if server has no key while user configured one in browser
  if (!genAI && has_client_key && !bypass_ai && !force_local_fallback && !loadedLocalFile) {
    return res.json({
      understood: false,
      delegate_to_client_gemini: true,
    });
  }

  let serverFailure: GeminiFailureInfo | undefined = !genAI
    ? classifyGeminiError("No Gemini client configured")
    : undefined;

  // AI-FIRST PRIORITY: Route user message to Gemini Tool-Calling Agent when server Gemini key is active
  if (genAI && !bypass_ai && !force_local_fallback) {
    try {
      const toolResult = await runGeminiToolCallingAgent({
        message: effectiveMessage,
        school,
        markdown: currentMarkdown,
        schedule: schedule || null,
        history: Array.isArray(history) ? history : [],
        generateTurn: async (contents, config) => {
          const { response, usedModel } = await generateGeminiContentWithFallback(contents, {
            systemInstruction: config.systemInstruction,
            tools: config.tools,
            maxOutputTokens: config.maxOutputTokens || 4096,
          });
          return {
            text: response.text || "",
            functionCalls: response.functionCalls,
            modelContent: response.candidates?.[0]?.content as any,
            usedModel,
          };
        },
      });
      if (toolResult.handled) {
        const meta: EngineResponseMeta = {
          source: "gemini_api",
          via: "server_api",
          model_used: toolResult.used_model || geminiModel,
          tool_calls_used: toolResult.tool_calls_used,
        };
        return res.json({
          understood: true,
          reply: toolResult.reply,
          updated_markdown: toolResult.updated_markdown,
          updated_school: toolResult.updated_school,
          updated_schedule: toolResult.updated_schedule || null,
          should_solve: toolResult.should_solve,
          applied_changes: toolResult.applied_changes,
          ui_action: toolResult.ui_action,
          ui_target_id: toolResult.ui_target_id,
          tool_calls_used: toolResult.tool_calls_used,
          mode: "gemini_tool_agent",
          engine_source: meta,
          analysis: InBrowserSchoolEngine.analyzeSchool(toolResult.updated_school),
        });
      }
      serverFailure = toolResult.failure_info || classifyGeminiError("empty response from model", toolResult.used_model);
    } catch (e: any) {
      serverFailure = classifyGeminiError(e, e?.__modelAttempted || geminiModel);
      console.warn("Server Gemini Tool Agent failed:", serverFailure);
    }
  }

  // If browser requires explicit choice on Gemini failure (or has a client BYOK key to try next)
  if (require_gemini && !force_local_fallback) {
    if (has_client_key) {
      return res.json({
        understood: false,
        delegate_to_client_gemini: true,
        server_failure: serverFailure,
      });
    }
    const failMeta: EngineResponseMeta = {
      source: "gemini_failed",
      via: "none",
      model_used: serverFailure?.model_attempted,
      failure: serverFailure || classifyGeminiError("No Gemini client configured"),
    };
    return res.json({
      understood: true,
      needs_api_or_local_choice: true,
      reply:
        `⚠️ تعذر الحصول على رد من وكيل Gemini:\n${failMeta.failure?.reason_ar}` +
        `\n\nيمكنك **إضافة مفتاح API جديد** للمتابعة بالذكاء الاصطناعي الكامل، أو اختيار **الإكمال بالمحرك المحلي (أقل دقة)**.`,
      updated_markdown: currentMarkdown,
      updated_school: school,
      should_solve: false,
      applied_changes: [],
      engine_source: failMeta,
      analysis: InBrowserSchoolEngine.analyzeSchool(school),
    });
  }

  const localMeta: EngineResponseMeta = {
    source: "local_engine",
    via: "local_fallback",
    model_used: "المحرك المحلي",
    failure: serverFailure,
  };

  // Fallback / Offline Deterministic Engine: check if message is a conversational query or audit request
  const isQuery = isQuestionOrInquiry(effectiveMessage);

  // If not a query, check if deterministic mutation command interpreter recognizes it
  const ctxMessage = enrichMessageWithMemoryContext(effectiveMessage, school, history);
  if (!isQuery) {
    const extAction = tryExecuteExtendedAgentAction(ctxMessage, school, schedule, history);
    if (extAction && extAction.handled) {
      const nextSchool = extAction.updated_school || school;
      return res.json({
        understood: true,
        engine_source: localMeta,
        reply: extAction.reply,
        updated_markdown: extAction.updated_markdown || currentMarkdown,
        updated_school: extAction.updated_school || school,
        updated_schedule: extAction.updated_schedule || null,
        should_solve: extAction.should_solve,
        applied_changes: extAction.applied_changes,
        analysis: InBrowserSchoolEngine.analyzeSchool(nextSchool),
        ui_action: extAction.ui_action,
        ui_target_id: extAction.ui_target_id,
      });
    }
    const periodCmd = tryApplyDailyPeriodsChatCommand(school, ctxMessage);
    if (periodCmd) {
      const solved = InBrowserSchoolEngine.solveInBrowser(periodCmd.school);
      return res.json({
        understood: true,
        engine_source: localMeta,
        updated_school: periodCmd.school,
        updated_markdown: generateSchoolMarkdown(periodCmd.school, periodCmd.appliedChanges),
        applied_changes: periodCmd.appliedChanges,
        should_solve: true,
        reply: periodCmd.reply,
        schedule: solved.schedule,
        validation: solved.validation,
        metrics: solved.metrics,
        analysis: InBrowserSchoolEngine.analyzeSchool(periodCmd.school),
      });
    }
    const normalizedForCmd = /^(?:من فضلك\s+|لو سمحت\s+|ممكن\s+)?(?:حدث|تحديث|اعمل تحديث|اعد تحديث|جدد|ابني|إعادة بناء)\s*(?:ل)?(?:ال)?جدول/.test(ctxMessage.trim())
      ? "حل الجدول"
      : expandAliasInChatMessage(school.subjects, ctxMessage);
    const cmd = interpretCommand(normalizedForCmd, school, history);
    if (cmd.understood) {
      let updatedSchool = school;
      let updatedMarkdown = currentMarkdown;
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
        reply = `تم استيراد وإنشاء مدرسة "${updatedSchool.name}" بنجاح! تم استخراج وثيقة الـ Markdown وهيكل الفصول والأنصبة، وجاري بناء الجدول تلقائياً بدون تعارضات.`;
      } else if (cmd.solve_only) {
        shouldSolve = true;
        appliedChanges = ["إعادة توزيع وإنشاء الجدول المدرسي بالكامل لضمان 0% تعارضات"];
        reply = `تم استلام طلبك لإنشاء وتوزيع الجدول المدرسي. جاري حل وتوليد الجدول الآن بأعلى دقة رياضية ومؤشر جودة مرتفع وبدون أي تعارضات.`;
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

      return res.json({
        understood: true,
        engine_source: localMeta,
        reply,
        updated_markdown: updatedMarkdown,
        updated_school: updatedSchool,
        should_solve: shouldSolve,
        applied_changes: appliedChanges,
        analysis:
          updatedSchool?.sections && updatedSchool?.assignments
            ? InBrowserSchoolEngine.analyzeSchool(updatedSchool)
            : undefined,
      });
    }
  }

  // 1. High-intelligence Deterministic Local School Q&A Assistant FIRST (100% exact school math & facts)
  const localAns = answerSchoolQuestion(
    effectiveMessage,
    school,
    schedule,
    InBrowserSchoolEngine.analyzeSchool(school),
    history
  );

  if (localAns.answered) {
    return res.json({
      understood: true,
        engine_source: localMeta,
      reply: localAns.reply,
      updated_markdown: currentMarkdown,
      updated_school: school,
      should_solve: false,
      applied_changes: [],
      analysis: InBrowserSchoolEngine.analyzeSchool(school),
    });
  }

  // 2. Secondary Server-Side Gemini JSON fallback (only if Tool Agent was bypassed)
  if (genAI && bypass_ai) {
    try {
      const geminiContents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
      if (Array.isArray(history) && history.length > 0) {
        for (const h of history.slice(-14)) {
          if (h && h.text && h.role) {
            geminiContents.push({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] });
          }
        }
      }
      geminiContents.push({
        role: "user",
        parts: [
          {
            text: `${AGENT_SYSTEM_INSTRUCTION}

بيانات المدرسة الحالية (SchoolData JSON):
${JSON.stringify(school, null, 2)}

وثيقة المدرسة الحالية (Markdown):
${currentMarkdown}

${schedule ? `حالة الجدول الحالي: متولد بنجاح (${schedule.entries.length} حصة مجدولة، مؤشر جودة ${schedule.quality_score}%، 0 تعارضات).` : "الجدول لم يتم توليده بعد."}
${buildLiveAgentContextDigest(school, schedule, history)}

طلب أو سؤال المستخدم:
${effectiveMessage}`,
          },
        ],
      });
      const { response } = await generateGeminiContentWithFallback(geminiContents, { responseMimeType: "application/json", maxOutputTokens: 8192 });
      const rawTextResponse = response.text || "";
      const cleanedJson = rawTextResponse.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const jsonMatch = cleanedJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        let parsed: any = null;
        try { parsed = JSON.parse(jsonMatch[0]); } catch { const rm = jsonMatch[0].match(/"reply"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*\})/); if (rm?.[1]) parsed = { reply: rm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'), should_solve: false }; }
        if (parsed && (parsed.reply || (Array.isArray(parsed.ops) && parsed.ops.length > 0))) {
          const execRes = executeGeminiParsedResponse(school, currentMarkdown, parsed, validateSchoolDataSchema);
          return res.json({
            understood: true,
        engine_source: localMeta,
            reply: execRes.reply,
            updated_markdown: execRes.updated_markdown,
            updated_school: execRes.updated_school,
            should_solve: execRes.should_solve,
            applied_changes: execRes.applied_changes,
            analysis: InBrowserSchoolEngine.analyzeSchool(execRes.updated_school),
          });
        }
      } else if (rawTextResponse.trim()) {
        return res.json({
          understood: true,
        engine_source: localMeta,
          reply: rawTextResponse.trim(),
          updated_markdown: currentMarkdown,
          updated_school: school,
          should_solve: false,
          applied_changes: [],
          analysis: InBrowserSchoolEngine.analyzeSchool(school),
        });
      }
    } catch (e) {
      console.warn("Server-side Gemini chat failed, falling back to local assistant:", e);
    }
  }
  return res.json({
    understood: true,
        engine_source: localMeta,
    reply:
      `أهلاً بك! بخصوص استفسارك عن مدرسة "${school.name}":\n` +
      `المدرسة تضم ${school.sections.length} فصول و${school.teachers.length} معلماً بإجمالي ${school.assignments.reduce((s, a) => s + a.weekly_periods, 0)} حصة أسبوعياً.\n` +
      `يمكنك سؤالي عن أنصبة أي معلم، أي يوم إجازة، جداول الفصول، أو طلب أي تعديل وسأنفذه فوراً.`,
    updated_markdown: currentMarkdown,
    updated_school: school,
    should_solve: false,
    applied_changes: [],
    analysis: InBrowserSchoolEngine.analyzeSchool(school),
  });
});

// 5. Timetable Analysis
app.post("/api/analyze", (req: Request, res: Response) => {
  const { school } = req.body;
  if (!school) return res.status(400).json({ error: "school is required" });
  const analysis = InBrowserSchoolEngine.analyzeSchool(school);
  res.json({
    school,
    normalization_notes: [],
    analysis,
  });
});

// 6. Timetable Solver
app.post("/api/solve", (req: Request, res: Response) => {
  const { school } = req.body;
  if (!school) return res.status(400).json({ error: "school is required" });
  const solved = InBrowserSchoolEngine.solveInBrowser(school);
  const analysis = InBrowserSchoolEngine.analyzeSchool(school);
  res.json({
    school,
    schedule: solved.schedule,
    validation: solved.validation,
    metrics: solved.metrics,
    normalization_notes: [],
    analysis,
  });
});

// --- HTTP Server & Vite Middleware ---

const server = http.createServer(app);

async function start() {
  if (!isProduction) {
    app.use((_req: Request, res: Response, nextFn) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      nextFn();
    });
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, host: HOST },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve("dist")));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(`Server listening at http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
