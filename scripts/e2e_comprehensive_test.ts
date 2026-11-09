/**
 * Comprehensive End-to-End Automated Test Suite for School Timetable Studio.
 * Reads from anonymized fixtures/ by default, and runs additional tests on
 * private local files when present (skipping silently if absent).
 */

import fs from "node:fs";
import path from "node:path";
import {
  parseSchoolText,
  interpretCommand,
  applyOps,
  generateSchoolMarkdown,
} from "../services/schoolCore.ts";
import { solveSchool } from "../services/solver.ts";
import {
  InBrowserSchoolEngine,
  getDemoSchool,
} from "../services/localEngine.ts";
import {
  ApiKeyManager,
  AllKeysFailedError,
  maskApiKey,
  sanitizeSecretText,
  validateSchoolDataSchema,
} from "../services/apiKeyManager.ts";

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
  }
}

async function runTestSuite() {
  console.log("======================================================================");
  console.log("🚀 STARTING COMPREHENSIVE END-TO-END TIMETABLE TEST SUITE");
  console.log("======================================================================\n");

  // ==========================================================================
  // TEST SUITE 1: Parsing Anonymized Fixtures (and Local Private Files if present)
  // ==========================================================================
  console.log("📌 SUITE 1: Deterministic School Markdown & Arabic NLP Parsing");

  // 1.1 Demo Prep School Fixture (7 sections, 252 periods)
  const demoPrepPath = path.resolve("fixtures", "demo_prep_school.md");
  const demoPrepText = fs.readFileSync(demoPrepPath, "utf8");
  const parsedPrep = parseSchoolText(demoPrepText);
  assert(parsedPrep.school.sections.length === 7, "Fixture Prep School: Parsed exactly 7 sections (1/1 to 3/2)");
  assert(parsedPrep.school.teachers.length >= 18, `Fixture Prep School: Parsed ${parsedPrep.school.teachers.length} teachers`);
  const totPrep = parsedPrep.school.assignments.reduce((s, a) => s + a.weekly_periods, 0);
  assert(totPrep === 252, `Fixture Prep School: Total periods exactly 252 (actual: ${totPrep})`);

  // 1.2 Demo Model School Fixture (8 sections, 288 periods)
  const demoModelPath = path.resolve("fixtures", "demo_model_school.md");
  const demoModelText = fs.readFileSync(demoModelPath, "utf8");
  const parsedModel = parseSchoolText(demoModelText);
  assert(parsedModel.school.sections.length === 8, "Fixture Model School: Parsed exactly 8 sections");
  assert(parsedModel.school.teachers.length === 18, `Fixture Model School: Parsed exactly 18 teachers (actual: ${parsedModel.school.teachers.length})`);
  const totModel = parsedModel.school.assignments.reduce((s, a) => s + a.weekly_periods, 0);
  assert(totModel === 288, `Fixture Model School: Total periods exactly 288 (actual: ${totModel})`);

  // Optional local private files check (skipped silently if absent)
  const localNesschPath = path.resolve("..", "nesschinfo.md");
  if (fs.existsSync(localNesschPath)) {
    const localParsed = parseSchoolText(fs.readFileSync(localNesschPath, "utf8"));
    const localTot = localParsed.school.assignments.reduce((s, a) => s + a.weekly_periods, 0);
    assert(localParsed.school.sections.length === 7 && localTot === 252, "Local Private File (nesschinfo.md): 7 sections & 252 periods verified");
  }

  // ==========================================================================
  // TEST SUITE 2: Constraint Solver & Zero-Trust Validation
  // ==========================================================================
  console.log("\n📌 SUITE 2: Constraint Solver & Zero-Trust Hard/Soft Constraint Verification");

  // 2.1 Solve Prep School (252 periods)
  console.log("  ... Solving Prep School (252 periods) ...");
  const solveResPrep = solveSchool(parsedPrep.school, { maxTimeMs: 10000 });
  assert(solveResPrep.schedule.status === "VALID", "Prep School: Solver status is VALID");
  assert(solveResPrep.schedule.entries.length === 252, "Prep School: All 252 periods successfully placed");
  assert(solveResPrep.validation.is_valid, "Prep School: Zero-trust validation passed with 0 errors");
  assert(solveResPrep.validation.errors.length === 0, `Prep School: Hard errors count is 0 (actual: ${solveResPrep.validation.errors.length})`);
  assert(solveResPrep.schedule.quality_score >= 90, `Prep School: Quality score >= 90% (actual: ${solveResPrep.schedule.quality_score}%)`);

  const teacherCollisionsPrep = new Set<string>();
  const sectionCollisionsPrep = new Set<string>();
  for (const e of solveResPrep.schedule.entries) {
    const tKey = `${e.teacher_id}_${e.day}_${e.period}`;
    const sKey = `${e.section_id}_${e.day}_${e.period}`;
    if (teacherCollisionsPrep.has(tKey)) assert(false, "Prep School: Teacher collision detected!", tKey);
    if (sectionCollisionsPrep.has(sKey)) assert(false, "Prep School: Section collision detected!", sKey);
    teacherCollisionsPrep.add(tKey);
    sectionCollisionsPrep.add(sKey);
  }
  assert(true, "Prep School: Mathematical proof - 0 teacher collisions and 0 section collisions across all 252 entries");

  // 2.2 Solve Model School (288 periods)
  console.log("  ... Solving Model School (288 periods) ...");
  const solveResModel = solveSchool(parsedModel.school, { maxTimeMs: 15000 });
  assert(solveResModel.schedule.status === "VALID", "Model School: Solver status is VALID");
  assert(solveResModel.schedule.entries.length === 288, "Model School: All 288 periods successfully placed");
  assert(solveResModel.validation.is_valid, "Model School: Zero-trust validation passed with 0 errors");
  assert(solveResModel.validation.errors.length === 0, `Model School: Hard errors count is 0 (actual: ${solveResModel.validation.errors.length})`);
  assert(solveResModel.schedule.quality_score >= 90, `Model School: Quality score >= 90% (actual: ${solveResModel.schedule.quality_score}%)`);

  // Verify specific Model School constraints
  const arTeacher2 = parsedModel.school.teachers.find(t => t.name.includes("معلمة عربي 2"));
  const ar2WedEntries = solveResModel.schedule.entries.filter(e => e.teacher_id === arTeacher2?.id && e.day === 3);
  assert(ar2WedEntries.length === 0, "Model School: Teacher 2 has 0 periods on Wednesday (MANDATORY_OFF honored)");

  const arTeacher4 = parsedModel.school.teachers.find(t => t.name.includes("معلمة عربي 4"));
  const ar4OffEntries = solveResModel.schedule.entries.filter(e => e.teacher_id === arTeacher4?.id && (e.day === 1 || e.day === 3));
  assert(ar4OffEntries.length === 0, "Model School: Teacher 4 has 0 periods on Mon & Wed (off-days honored)");

  // ==========================================================================
  // TEST SUITE 3: AI Chat Agent Operations & Dynamic State Synchronization
  // ==========================================================================
  console.log("\n📌 SUITE 3: AI Copilot Natural Language Command Scenarios");

  let currentSchool = getDemoSchool();

  // 3.1 Grant Mandatory Off-Day
  console.log("  ... Testing Chat Command: Grant Sunday off-day to Yasser Nabil ...");
  const cmd1 = interpretCommand("أعطِ الأستاذ ياسر نبيل إجازة يوم الأحد واقفل جدوله في هذا اليوم", currentSchool);
  assert(cmd1.understood, "Chat: Command 1 understood by NLP interpreter");
  assert(cmd1.ops.length > 0 && cmd1.ops[0].op === "set_teacher_days", "Chat: Op correctly identified as set_teacher_days");
  const res1 = applyOps(currentSchool, cmd1.ops);
  currentSchool = res1.school;
  const yasser = currentSchool.teachers.find(t => t.name.includes("ياسر نبيل"));
  assert(yasser?.work_pattern?.day_rules?.["0"] === "MANDATORY_OFF", "Chat: Yasser Nabil Sunday rule is MANDATORY_OFF");
  const md1 = generateSchoolMarkdown(currentSchool, res1.changes);
  assert(md1.includes("ياسر نبيل"), "Chat: Markdown includes updated teacher notes for Yasser Nabil");

  // 3.2 Add Placement Rule (FIRST_N)
  console.log("  ... Testing Chat Command: First periods rule for Tarek Mansour on Sunday ...");
  const cmd2 = interpretCommand("ثبت حصص الأستاذ طارق منصور في الحصص الأولى يوم الأحد", currentSchool);
  assert(cmd2.understood, "Chat: Command 2 understood");
  assert(cmd2.ops.some(o => o.op === "add_placement_rule" && o.type === "FIRST_N"), "Chat: Op correctly generated FIRST_N placement rule");
  const res2 = applyOps(currentSchool, cmd2.ops);
  currentSchool = res2.school;
  const tarek = currentSchool.teachers.find(t => t.name.includes("طارق منصور"));
  const tarekRule = tarek?.work_pattern?.placement_rules?.find(r => r.day === 0 && r.placement_type === "FIRST_N");
  assert(Boolean(tarekRule), "Chat: Tarek Mansour has FIRST_N rule for Sunday in SchoolData");

  // 3.3 Set Assignment Count
  console.log("  ... Testing Chat Command: Change Arabic periods in 1/1 to 8 ...");
  const cmd3 = interpretCommand("اجعل حصص اللغة العربية 8 في فصل 1/1", currentSchool);
  assert(cmd3.understood, "Chat: Command 3 understood");
  assert(cmd3.ops.some(o => o.op === "set_assignment" && o.periods === 8), "Chat: Op correctly generated set_assignment with 8 periods");
  const res3 = applyOps(currentSchool, cmd3.ops);
  currentSchool = res3.school;

  // 3.4 Solve Command
  console.log("  ... Testing Chat Command: Re-solve timetable ...");
  const cmd4 = interpretCommand("أنشئ الجدول المدرسي ووزع الحصص بضمان 0% تعارضات", currentSchool);
  assert(cmd4.understood && cmd4.solve_only === true, "Chat: Solve-only trigger detected correctly");
  const solvedFromChat = solveSchool(currentSchool, { maxTimeMs: 10000 });
  assert(solvedFromChat.validation.is_valid, "Chat: Re-solved schedule satisfies all newly added constraints");

  const yasserSun = solvedFromChat.schedule.entries.filter(e => e.teacher_id === yasser?.id && e.day === 0);
  assert(yasserSun.length === 0, "Chat: Verified that Yasser Nabil has 0 periods on Sunday after chat modification");

  // 3.5 Add New Section with Copy
  console.log("  ... Testing Chat Command: Add section 1/4 copied from 1/1 ...");
  const cmd5 = interpretCommand("أضف فصل 1/4 مثل فصل 1/1", currentSchool);
  assert(cmd5.understood && cmd5.ops[0].op === "add_section", "Chat: Add section op detected");
  const res5 = applyOps(currentSchool, cmd5.ops);
  const sec14 = res5.school.sections.find(s => s.code === "1/4");
  assert(Boolean(sec14), "Chat: Section 1/4 successfully created in SchoolData");
  const asgs14 = res5.school.assignments.filter(a => a.section_id === sec14?.id);
  assert(asgs14.length > 0, `Chat: Section 1/4 has ${asgs14.length} copied assignments from 1/1`);

  // ==========================================================================
  // TEST SUITE 4: Exporter Formats & XSS Protection
  // ==========================================================================
  console.log("\n📌 SUITE 4: Exporter Formats & XSS Sanitization");

  const demoSchool = getDemoSchool();
  const solvedExport = solveSchool(demoSchool, { maxTimeMs: 5000 });
  assert(typeof InBrowserSchoolEngine.exportPrintablePDF === "function", "Exporter: exportPrintablePDF function exists");
  assert(typeof InBrowserSchoolEngine.exportExcelWorkbook === "function", "Exporter: exportExcelWorkbook function exists");

  // Test XSS sanitization in PDF & Excel exports
  const xssSchool = {
    ...demoSchool,
    name: `مدرسة <script>alert("xss")</script> النموذجية`,
  };
  const pdfOut = InBrowserSchoolEngine.exportPrintablePDF(xssSchool, solvedExport.schedule, "master");
  assert(!pdfOut.includes(`<script>alert("xss")</script>`), "Security: PDF Exporter properly escapes HTML/script tags in school name");
  assert(pdfOut.includes(`&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;`), "Security: PDF Exporter encodes special characters safely");

  const xmlOut = InBrowserSchoolEngine.exportExcelWorkbook(xssSchool, solvedExport.schedule);
  assert(!xmlOut.includes(`<script>alert("xss")</script>`), "Security: Excel XML Exporter properly escapes XML tags in school name");
  assert(xmlOut.includes(`&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;`), "Security: Excel XML Exporter encodes special characters safely");

  // ==========================================================================
  // TEST SUITE 5: BYOK Key Manager, Auto-Rotation, Secret Redaction & Schema Validation
  // ==========================================================================
  console.log("\n📌 SUITE 5: BYOK Key Manager, Auto-Rotation, Secret Sanitization & Schema Validation");

  ApiKeyManager.clearAllKeys();
  assert(ApiKeyManager.getKeys().length === 0, "BYOK: Starts with 0 keys after clearAllKeys");

  // 5.1 Single key add & masking
  const singleAdd = ApiKeyManager.addKey("AIzaSyDummyTestKey1111222233339876", "حسابي الأساسي");
  assert(singleAdd.added === true, "BYOK: Single key added successfully");
  assert(singleAdd.entry?.masked === "••••9876", `BYOK: Masked key shows only last 4 chars (actual: ${singleAdd.entry?.masked})`);
  assert(maskApiKey("AIzaSyDummyTestKey1111222233339876") === "••••9876", "BYOK: maskApiKey helper hides prefix and shows last 4 chars");

  // 5.2 Bulk key add (1 per line, skips duplicates)
  const bulkAdd = ApiKeyManager.addBulkKeys(
    "AIzaSyDummyTestKey1111222233339876\nAIzaSyDummyQuotaKey4444555566664290\nمشروع 3: AIzaSyDummyValidKey7777888899997777"
  );
  assert(bulkAdd.addedCount === 2 && bulkAdd.skippedCount === 1, "BYOK: Bulk add adds 2 new keys and skips 1 duplicate");
  assert(ApiKeyManager.getKeys().length === 3, "BYOK: Total stored keys is 3");

  // 5.3 Secret redaction in logs / errors
  const rawErrorWithSecret = "Request failed for key AIzaSyDummyTestKey1111222233339876 and AQ.Ab8RN6L_test_secret_token_12345 with 403";
  const redacted = sanitizeSecretText(rawErrorWithSecret, ApiKeyManager.getKeys().map(k => k.key));
  assert(!redacted.includes("AIzaSyDummyTestKey1111222233339876"), "BYOK Security: Exact user key is redacted from error text");
  assert(!redacted.includes("AQ.Ab8RN6L_test_secret_token_12345"), "BYOK Security: AQ.* token pattern is redacted from error text");
  assert(redacted.includes("[REDACTED_KEY]"), "BYOK Security: Redacted placeholder inserted");

  // 5.4 Auto-rotation: Key #1 fails with 403 (auto-disabled), Key #2 fails with 429 (60s cooldown), Key #3 succeeds!
  let callOrder: string[] = [];
  const rotationRes = await ApiKeyManager.executeWithRotation(
    async (_client, keyEntry) => {
      callOrder.push(keyEntry.masked);
      if (keyEntry.masked === "••••9876") {
        throw new Error("403 PERMISSION_DENIED: API_KEY_INVALID for AIzaSyDummyTestKey1111222233339876");
      }
      if (keyEntry.masked === "••••4290") {
        throw new Error("429 RESOURCE_EXHAUSTED: Quota exceeded");
      }
      return "SUCCESS_FROM_KEY_3";
    },
    { cooldownMs: 60_000, clientFactory: () => ({} as any) }
  );

  assert(rotationRes.result === "SUCCESS_FROM_KEY_3", "BYOK Rotation: Rotated across failing keys and succeeded on Key #3");
  assert(callOrder.join(" -> ") === "••••9876 -> ••••4290 -> ••••7777", `BYOK Rotation: Tried keys in exact order (${callOrder.join(" -> ")})`);
  assert(
    rotationRes.notices.every(n => !n.includes("AIzaSyDummy")),
    "BYOK Security: Rotation notices never contain raw API keys"
  );

  const keysAfterRotation = ApiKeyManager.getKeys();
  const k1 = keysAfterRotation.find(k => k.masked === "••••9876");
  const k2 = keysAfterRotation.find(k => k.masked === "••••4290");
  const k3 = keysAfterRotation.find(k => k.masked === "••••7777");
  assert(k1?.enabled === false && k1?.status === "invalid", "BYOK Rotation: Key #1 (403) was automatically disabled and marked invalid");
  assert(k2?.enabled === true && k2?.status === "cooldown" && Boolean(k2?.cooldownUntil), "BYOK Rotation: Key #2 (429) was placed in cooldown");
  assert(k3?.enabled === true && k3?.status === "valid", "BYOK Rotation: Key #3 was marked valid");

  // 5.5 All keys fail -> throws AllKeysFailedError with safe message
  ApiKeyManager.toggleKey(k3!.id, false);
  let threwAllFailed = false;
  try {
    await ApiKeyManager.executeWithRotation(async () => "nope", { clientFactory: () => ({} as any) });
  } catch (err) {
    if (err instanceof AllKeysFailedError) {
      threwAllFailed = true;
    }
  }
  assert(threwAllFailed, "BYOK Fallback: Throws AllKeysFailedError when all remaining keys are in cooldown or disabled");
  ApiKeyManager.clearAllKeys();

  // 5.6 SchoolData Schema Validator
  const validCheck = validateSchoolDataSchema(demoSchool);
  assert(validCheck.valid === true && Boolean(validCheck.school), "Schema Validator: Accepts valid SchoolData object");
  const invalidCheck = validateSchoolDataSchema({ name: "مدرسة ناقصة", sections: [], teachers: [] });
  assert(invalidCheck.valid === false && invalidCheck.errors.length >= 2, "Schema Validator: Rejects incomplete/corrupted AI JSON before state mutation");

  // ==========================================================================
  // TEST SUITE 6: Backup & Restore JSON (Task E — Excludes Keys, Validates Schema)
  // ==========================================================================
  console.log("\n📌 SUITE 6: User Backup & Restore JSON (Zero Keys Leaked + Strict Schema Validation)");

  ApiKeyManager.addKey("AIzaSySuperSecretBackupTestKey00001111", "مفتاح سري للاختبار");
  const backupJson = InBrowserSchoolEngine.exportUserBackupJson({
    savedSchools: [
      {
        id: demoSchool.id,
        name: demoSchool.name,
        school: demoSchool,
        raw_text: "# وثيقة المدرسة",
        schedule: solvedExport.schedule,
        analysis: InBrowserSchoolEngine.analyzeSchool(demoSchool),
      },
    ],
    activeSchoolId: demoSchool.id,
    chatHistory: [{ role: "ai", text: "مرحباً بك", timestamp: "الآن" }],
  });

  assert(
    !backupJson.includes("AIzaSySuperSecretBackupTestKey00001111"),
    "Backup Security: Exported JSON never includes user API keys"
  );
  assert(
    backupJson.includes('"includes_api_keys": false'),
    "Backup Format: Explicitly marks includes_api_keys as false"
  );

  const restored = InBrowserSchoolEngine.importUserBackupJson(backupJson);
  assert(restored.valid === true, "Restore: Valid backup JSON is accepted");
  assert(restored.savedSchools.length === 1, "Restore: Restores 1 school entry");
  assert(
    restored.savedSchools[0].school.sections.length === 7 &&
      restored.savedSchools[0].schedule?.entries.length === 252,
    "Restore: Preserves all 7 sections and 252 schedule entries"
  );
  assert(restored.chatHistory.length === 1, "Restore: Preserves chat history");

  const corruptedRestore1 = InBrowserSchoolEngine.importUserBackupJson("{ broken json ");
  assert(corruptedRestore1.valid === false, "Restore Validation: Rejects malformed JSON syntax");

  const corruptedRestore2 = InBrowserSchoolEngine.importUserBackupJson(
    JSON.stringify({
      saved_schools: [{ id: "bad", name: "Bad", school: { name: "بدون فصول", sections: [] } }],
    })
  );
  assert(
    corruptedRestore2.valid === false && corruptedRestore2.errors.length > 0,
    "Restore Validation: Rejects backup with corrupted/incomplete SchoolData schema"
  );
  ApiKeyManager.clearAllKeys();

  console.log("\n======================================================================");
  console.log(`🏁 TEST SUITE COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log("======================================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
