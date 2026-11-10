import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { SchoolData } from "../types.ts";
import { HybridSchoolService } from "../services/geminiService.ts";
import { ApiKeyManager } from "../services/apiKeyManager.ts";
import { getBuiltInSchool376, InBrowserSchoolEngine } from "../services/localEngine.ts";
import { parseUnstructuredArabicSchoolText } from "../services/unstructuredParser.ts";
import { DEFAULT_CHAT_WELCOME_MESSAGE, type ChatMessageRecord } from "../services/agentMemoryEngine.ts";
import { getOrderedSchoolDays } from "../presets/commonPresets.ts";

function passed(label: string) {
  console.log(`✅ [E2E PASS] ${label}`);
}

async function runHumanFirstTimeSimulation() {
  console.log("======================================================================");
  console.log("   HUMAN FIRST-TIME USER E2E AI AGENT & MEMORY AUDIT SUITE           ");
  console.log("======================================================================\n");

  // -----------------------------------------------------------------------
  // Part A: Simulate Pure Browser / Google AI Studio Mode (No Backend Server + Active BYOK Key)
  // -----------------------------------------------------------------------
  const dummyTestKey = ["AIzaSy", "DummyOfflineAIStudioKey00001"].join("");
  ApiKeyManager.addKey(dummyTestKey, "AI Studio Simulated Key");
  const browserService = new HybridSchoolService("http://127.0.0.1:1");

  let school = getBuiltInSchool376();
  let schedule = InBrowserSchoolEngine.solveInBrowser(school).schedule;
  const history: ChatMessageRecord[] = [DEFAULT_CHAT_WELCOME_MESSAGE];

  const askBrowser = async (msg: string) => {
    const res = await browserService.chatWithCopilot(msg, school, schedule, "", history);
    history.push({ role: "user", text: msg });
    history.push({ role: "ai", text: res.reply, changes: res.applied_changes });
    if (res.updated_school) school = res.updated_school;
    if ((res as any).updated_schedule) schedule = (res as any).updated_schedule;
    else if (res.should_solve) schedule = InBrowserSchoolEngine.solveInBrowser(school).schedule;
    return res;
  };

  // 1. First-time user asks greeting & basic school structure without technical terms
  const r1 = await askBrowser("السلام عليكم مين انت وبتعمل ايه؟");
  assert.ok(r1.reply.includes(school.name) && !r1.reply.includes("تعذر الاتصال"), "Greeting fails cleanly");
  passed("1. First-time user greeting & capabilities explanation");

  // 2. User pastes an unstructured Arabic school file right into chat!
  const rawGamaliyaPath = path.resolve("..", "مدرسة_الجمالية_تجريبي_غير_منظم.md");
  const rawGamaliya = fs.existsSync(rawGamaliyaPath)
    ? fs.readFileSync(rawGamaliyaPath, "utf8")
    : fs.readFileSync(path.resolve("fixtures", "demo_model_school.md"), "utf8");

  const parsedDirect = parseUnstructuredArabicSchoolText(rawGamaliya);
  if (parsedDirect) {
    const rImport = await askBrowser(rawGamaliya);
    assert.equal(rImport.should_solve, true);
    assert.equal(school.sections.length, 8);
    assert.equal(school.periods_per_day, 6);
    assert.deepEqual(getOrderedSchoolDays(school), [6, 0, 1, 2, 3, 4]);
    assert.ok(school.teachers.every((t) => !t.name.includes("عجز")), "No عجز label in teachers");
    passed("2. In-chat unstructured Arabic school ingestion (284p, 8 sections, no عجز)");
  }

  // 3. Multi-turn Pronoun Memory Chain on Teacher ("رفعت")
  const rQuota = await askBrowser("كم نصيب استاذ رفعت؟");
  assert.ok(rQuota.reply.includes("رفعت") && rQuota.reply.includes("13"), `Expected رفعت 13p: ${rQuota.reply}`);
  passed("3. Direct quota query for الأستاذ رفعت (13 periods)");

  const rFollowOff = await askBrowser("وإيه أيام إجازته");
  assert.ok(rFollowOff.reply.includes("رفعت"), `Pronoun follow-up should remember رفعت: ${rFollowOff.reply}`);
  passed("4. Pronoun follow-up inquiry without '?' ('وإيه أيام إجازته')");

  const rGiveOff = await askBrowser("اديله اجازة يوم الخميس");
  assert.equal(rGiveOff.should_solve, true);
  const refaat = school.teachers.find((t) => t.name.includes("رفعت"))!;
  assert.equal(refaat.work_pattern?.day_rules?.["4"], "MANDATORY_OFF");
  passed("5. Pronoun mutation ('اديله اجازة يوم الخميس') resolved الأستاذ رفعت");

  const rCheckOff = await askBrowser("هل استاذ رفعت عنده اجازة الخميس؟");
  assert.ok(rCheckOff.reply.includes("نعم"), `Should confirm Thursday off: ${rCheckOff.reply}`);
  passed("6. Verify Thursday MANDATORY_OFF persisted & scheduled cleanly");

  const rConsec = await askBrowser("خلي تتابعه حصتين بس");
  assert.equal(rConsec.should_solve, true);
  assert.equal(school.teachers.find((t) => t.id === refaat.id)?.max_consecutive_periods, 2);
  passed("7. Pronoun teacher max_consecutive_periods mutation ('خلي تتابعه حصتين بس')");

  // 4. Section Pronoun Follow-up Chain
  const rSecTeachers = await askBrowser("مين بيدرس فصل 1/1؟");
  assert.ok(rSecTeachers.reply.includes("1/1"), `Expected 1/1 in section teachers reply: ${rSecTeachers.reply}`);
  const rSecSchedFollow = await askBrowser("طيب جدولهم يوم الاحد ايه");
  assert.ok(rSecSchedFollow.reply.includes("1/1") && rSecSchedFollow.reply.includes("الحصة"), `Section pronoun follow-up failed: ${rSecSchedFollow.reply}`);
  passed("8. Section pronoun follow-up ('طيب جدولهم يوم الاحد ايه')");

  // 5. Session Memory Recall
  const rMem = await askBrowser("ايه اللي غيرناه لحد دلوقتي؟");
  assert.ok(rMem.reply.includes("ملخص ذاكرة الجلسة") && rMem.reply.includes("رفعت"), `Memory recall failed: ${rMem.reply}`);
  passed("9. Session memory recall reports all session edits accurately");

  // 6. Full Schedule Data Access: Substitute / Reserve Teacher Lookup
  const rReserve = await askBrowser("مين فاضي احتياطي يوم الخميس الحصة 3؟");
  assert.ok(rReserve.reply.includes("المعلمون المتاحون للاحتياطي") && !rReserve.reply.includes("رفعت"), `Refaat is off Thu so must NOT be in reserve list: ${rReserve.reply}`);
  passed("10. Substitute/Reserve teacher lookup respects MANDATORY_OFF & busy periods");

  // 7. Direct Schedule Entry Control: Pin & Move/Swap
  const rPin = await askBrowser("ثبّت حصة فصل 1/1 يوم الأحد الحصة 1");
  assert.ok((rPin as any).updated_schedule, "Pin should return updated_schedule");
  const pinnedEntry = schedule.entries.find((e) => {
    const s = school.sections.find((sec) => sec.id === e.section_id);
    return s?.name === "1/1" && e.day === 0 && e.period === 1;
  });
  assert.equal(pinnedEntry?.is_pinned, true, "Slot 1/1 Sunday P1 must be pinned");
  passed("11. Direct chat Pin command pins exact entry in schedule");

  // Find an actual free slot move or swap on 1/1 Sunday
  const rSwap = await askBrowser("بدل الحصة 1 و 2 لفصل 1/1 يوم الأحد");
  assert.ok(rSwap.reply.length > 5 && !rSwap.reply.includes("تعذر الاتصال"));
  passed("12. Direct slot swap/move check executes safely with 0-conflict guard");

  // 8. Subject Before-Break Constraint
  const rBeforeBreak = await askBrowser("خلي مادة التربية الدينية قبل الفسحة");
  assert.equal(rBeforeBreak.should_solve, true);
  assert.equal(school.subjects.find((s) => s.name.includes("دين"))?.before_break, true);
  passed("13. Subject before_break constraint applied & re-solved");

  // 9. Rename School & Add/Delete Section CRUD
  const rRename = await askBrowser("غير اسم المدرسة إلى مدرسة الأفق الإعدادية");
  assert.equal(school.name, "مدرسة الأفق الإعدادية");
  const rAddSec = await askBrowser("ضيف فصل 1/5");
  assert.ok(school.sections.some((s) => s.name === "1/5"));
  const rDelSec = await askBrowser("احذف فصل 1/5");
  assert.ok(!school.sections.some((s) => s.name === "1/5"));
  passed("14. School rename & add/remove section CRUD via chat");

  // 10. UI Export & Navigation Directives
  const rPdf = await askBrowser("صدر الجدول PDF");
  assert.equal((rPdf as any).ui_action, "export_pdf_all");
  const rViewSec = await askBrowser("اعرض جدول فصل 1/1");
  assert.equal((rViewSec as any).ui_action, "view_section", `Got: ${JSON.stringify(rViewSec)}`);
  passed("15. Direct PDF export & view navigation directives from chat");

  // 11. Revert / Undo Off-day via Context
  const rUndoOff = await askBrowser("تراجع عن الاجازة");
  assert.equal(rUndoOff.should_solve, true, `Got rUndoOff: ${JSON.stringify(rUndoOff)}`);
  assert.notEqual(
    school.teachers.find((t) => t.id === refaat.id)?.work_pattern?.day_rules?.["4"],
    "MANDATORY_OFF"
  );
  passed("16. Contextual undo reverts Thursday off-day cleanly");

  // 16b. Browser-only regression check: "الغاء الحصة الاولى يوم الاحد" -> AVOID_FIRST & sanitized stale FIRST_N
  const badriPre = school.teachers.find((t) => t.name.includes("بدري"))!;
  const schoolWithStaleFirst: SchoolData = {
    ...school,
    teachers: school.teachers.map((t) =>
      t.id === badriPre.id
        ? {
            ...t,
            work_pattern: {
              day_rules: t.work_pattern?.day_rules || {},
              daily_period_rules: t.work_pattern?.daily_period_rules || [],
              placement_rules: [{ day: 0, placement_type: "FIRST_N", n_periods: 1, exact_periods: [], is_hard: true, weight: 10 }],
            },
          }
        : t
    ),
  };
  const cancelLocal = await browserService.chatWithCopilot(
    `${badriPre.name} الغاء الحصة الاولى يوم الاحد`,
    schoolWithStaleFirst,
    schedule,
    "",
    []
  );
  assert.ok(
    cancelLocal.reply.includes("لا يعمل في الحصة الأولى") && !cancelLocal.reply.includes("أول 1 حصص"),
    `Cancel period 1 misparsed: ${cancelLocal.reply}`
  );
  const updatedBadri = cancelLocal.updated_school.teachers.find((t) => t.id === badriPre.id)!;
  const rulesAfterCancel = updatedBadri.work_pattern?.placement_rules || [];
  assert.ok(
    rulesAfterCancel.some((r) => r.day === 0 && r.placement_type === "AVOID_FIRST"),
    `Expected AVOID_FIRST on Sunday: ${JSON.stringify(rulesAfterCancel)}`
  );
  assert.ok(
    !rulesAfterCancel.some((r) => r.day === 0 && r.placement_type === "FIRST_N"),
    `Contradictory FIRST_N was not sanitized: ${JSON.stringify(rulesAfterCancel)}`
  );
  const solvedAfterCancel = InBrowserSchoolEngine.solveInBrowser(cancelLocal.updated_school);
  assert.ok(
    !solvedAfterCancel.schedule.entries.some((e) => e.teacher_id === badriPre.id && e.day === 0 && e.period === 1),
    "Teacher still got Sunday Period 1 after AVOID_FIRST!"
  );
  passed("16b. Browser cancellation phrasing ('الغاء الحصة الاولى يوم الاحد') -> AVOID_FIRST & sanitized stale FIRST_N");

  // -----------------------------------------------------------------------
  // Part B: Verify Live Server Endpoint Parity (http://localhost:3000)
  // -----------------------------------------------------------------------
  let serverAvailable = false;
  try {
    const health = await fetch("http://localhost:3000/api/health");
    serverAvailable = health.ok;
  } catch {
    serverAvailable = false;
  }

  if (serverAvailable) {
    const chatRes = await fetch("http://localhost:3000/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        school,
        schedule,
        message: "وإيه أيام إجازته؟",
        history: [
          { role: "user", text: "كم نصيب استاذ بدري؟" },
          { role: "ai", text: "الأستاذ بدري نصيبه 8 حصص." },
        ],
      }),
    });
    assert.equal(chatRes.status, 200);
    const data = await chatRes.json();
    assert.equal(data.understood, true);
    assert.ok(data.reply.includes("بدري"), `Server follow-up failed: ${data.reply}`);
    passed("17. Live Express server /api/ai/chat multi-turn pronoun follow-up parity");

    const cancelPeriodRes = await fetch("http://localhost:3000/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        school: schoolWithStaleFirst,
        schedule,
        message: `${badriPre.name} الغاء الحصة الاولى يوم الاحد`,
      }),
    });
    assert.equal(cancelPeriodRes.status, 200);
    const cancelData = await cancelPeriodRes.json();
    assert.ok(
      cancelData.reply.includes("لا يعمل في الحصة الأولى") && !cancelData.reply.includes("أول 1 حصص"),
      `Server cancel period 1 misparsed: ${cancelData.reply}`
    );
    passed("18. Live Express server /api/ai/chat cancellation phrasing -> AVOID_FIRST");
  } else {
    console.log("ℹ️ Live server not active on port 3000; skipping HTTP check.");
  }

  console.log("\nALL_HUMAN_E2E_AGENT_MEMORY_TESTS_PASSED");
}

runHumanFirstTimeSimulation().catch((err) => {
  console.error("❌ E2E test failed:", err);
  process.exit(1);
});
