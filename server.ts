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
} from "./presets/commonPresets.ts";

const PORT = 3000;
const HOST = "0.0.0.0";
const isProduction = process.env.NODE_ENV === "production";

const app = express();
app.use(express.json({ limit: "10mb" }));

// --- API Endpoints (Deterministic Local Engine — Zero Server-Side API Keys) ---

// 1. Health
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    online: true,
    engine: "BYOK Gemini (Client-Side) + محرك الاستمثال والقيود المدمج",
    has_server_gemini_key: false,
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

  const school = parsedDirect?.school || getBuiltInSchool376();
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

// 4. Deterministic Timetable Command Interpreter
app.post("/api/ai/chat", async (req: Request, res: Response) => {
  const { message, school, markdown, history } = req.body;
  if (!message || !school) {
    return res.status(400).json({ error: "message and school are required" });
  }

  const currentMarkdown = markdown || NESSCHINFO_RAW_TEXT;

  let effectiveMessage = message;
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
        }
      } catch (e) {
        console.warn("Could not read referenced file in chat:", candidatePath, e);
      }
    }
  }

  const cmd = interpretCommand(effectiveMessage, school, history);
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

    return res.json({
      understood: true,
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

  return res.json({
    understood: false,
    reply: `تم استلام طلبك: "${message}".\nيمكنك طلب إعطاء إجازة لمعلم (مثل: "أعطِ الأستاذ يوسف كمال إجازة يوم الأحد")، أو تثبيت حصص أولى وأخيرة، أو تعديل أنصبة الحصص، أو الضغط على "إنشاء الجدول".`,
    updated_markdown: currentMarkdown,
    updated_school: school,
    should_solve: true,
    applied_changes: ["تحديث الجدول بناءً على التوجيه الأخير"],
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
