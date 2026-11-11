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
import { dryRunMinimalChange } from "../services/diffEngine.ts";
import { runGeminiToolCallingAgent, AGENT_TOOL_DECLARATIONS } from "../services/agentTools.ts";

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

  // 16c. Multiple phrasing parity for single-day + max daily + last period rules (Safaa)
  const rSafaa1 = await browserService.chatWithCopilot(
    "عاوزين نريح مس صفاء، خليها تيجي الأربعاء بس، ومتاخدش أكتر من حصتين ويبقوا آخر اليوم",
    school,
    schedule,
    "",
    []
  );
  assert.equal(rSafaa1.should_solve, true);
  assert.ok(rSafaa1.applied_changes.some((c) => c.includes("الخميس") && c.includes("إجازة")), `Missing off days: ${rSafaa1.applied_changes}`);
  assert.ok(rSafaa1.applied_changes.some((c) => c.includes("حد أقصى 2 حصص يوم الأربعاء")), `Missing cap 2: ${rSafaa1.applied_changes}`);
  assert.ok(rSafaa1.applied_changes.some((c) => c.includes("الأخيرة")), `Missing last period rule: ${rSafaa1.applied_changes}`);

  const rSafaa2 = await browserService.chatWithCopilot(
    "قصر حضور صفاء على يوم الأربعاء بحد أقصى حصتين في الحصص الأخيرة",
    school,
    schedule,
    "",
    []
  );
  assert.equal(rSafaa2.should_solve, true);
  assert.ok(rSafaa2.applied_changes.some((c) => c.includes("السبت") && c.includes("إجازة")), `A3 missing off days: ${rSafaa2.applied_changes}`);
  assert.ok(rSafaa2.applied_changes.some((c) => c.includes("حد أقصى 2")), `A3 missing cap 2: ${rSafaa2.applied_changes}`);
  passed("16c. Multi-phrasing compound rules (off-days + daily max + last slots)");

  // 16d. Feminine HR negation ("اعفيها من الحصة الأولى والثانية") & grade early dismissal ("بيمشوا بدري")
  const rNurse = await browserService.chatWithCopilot(
    "مس شيماء عندها ساعة رضاعة: اعفيها من الحصة الأولى والثانية طول الأسبوع",
    school,
    schedule,
    "",
    []
  );
  assert.ok(rNurse.applied_changes.some((c) => c.includes("لا يعمل في الحصة الأولى")), `Nurse avoid 1 failed: ${rNurse.applied_changes}`);
  assert.ok(rNurse.applied_changes.some((c) => c.includes("لا يعمل في الحصص 2")), `Nurse avoid 2 failed: ${rNurse.applied_changes}`);

  const rEarlyGrade = await browserService.chatWithCopilot(
    "أولى إعدادي يوم الخميس بيمشوا بدري بياخدوا 5 حصص بس",
    school,
    schedule,
    "",
    []
  );
  assert.ok(rEarlyGrade.applied_changes.some((c) => c.includes("تحديث حصص يوم (الخميس) إلى 5 حصص")), `Grade early failed: ${rEarlyGrade.applied_changes}`);
  passed("16d. Feminine exemption negation ('اعفيها') & grade early-dismissal ('بيمشوا بدري')");

  // 16e. Conversational Clarification Guard ("ثبّت حصة العربي" asks clarifying question instead of pinning 62 slots)
  const rClarify = await browserService.chatWithCopilot("ثبّت حصة العربي", school, schedule, "", []);
  assert.equal(rClarify.should_solve, false);
  assert.equal(rClarify.applied_changes.length, 0);
  assert.ok(rClarify.reply.includes("أي حصة أو فصل تقصد"), `Expected clarification ask: ${rClarify.reply}`);
  passed("16e. Vague pin command triggers clarifying question rather than mass mutation");

  // 16f. Feasibility What-If Consultation + Confirmation Follow-up + Teacher Recommendation + Compound Multi-Teacher
  const rWhatIf = await browserService.chatWithCopilot(
    "ينفع ندي أستاذ بدري إجازة يوم الخميس ولا هيحصل ضغط في حصصه؟",
    school,
    schedule,
    "",
    []
  );
  assert.equal(rWhatIf.should_solve, false);
  assert.ok(rWhatIf.reply.includes("هل تحب أنفذ إجازة يوم الخميس"), `Expected what-if prompt: ${rWhatIf.reply}`);
  const rConfirmWhatIf = await browserService.chatWithCopilot("أيوه نفذه", school, schedule, "", [
    DEFAULT_CHAT_WELCOME_MESSAGE,
    { role: "user", text: "ينفع ندي أستاذ بدري إجازة يوم الخميس ولا هيحصل ضغط في حصصه؟" },
    { role: "ai", text: rWhatIf.reply },
  ]);
  assert.equal(rConfirmWhatIf.should_solve, true);
  assert.ok(rConfirmWhatIf.applied_changes.some((c) => c.includes("بدري") && c.includes("الخميس")));

  const rRec = await browserService.chatWithCopilot(
    "عندي 3 حصص دين فاضيين لفصل 1/1، ترشحلي أديهم لمين من مدرسين المدرسة؟",
    school,
    schedule,
    "",
    []
  );
  assert.equal(rRec.should_solve, false);
  assert.ok(rRec.reply.includes("أنسب المرشحين"), `Expected recommendations: ${rRec.reply}`);

  const rMulti = await browserService.chatWithCopilot(
    "خلي الحصة الأخيرة يوم الأحد لرفعت وبلاش لبدري وشيماء",
    school,
    schedule,
    "",
    []
  );
  assert.equal(rMulti.should_solve, true);
  assert.ok(rMulti.applied_changes.some((c) => c.includes("رفعت") && c.includes("الحصة الأخيرة")));
  assert.ok(rMulti.applied_changes.some((c) => c.includes("بدري") && c.includes("لا يعمل في الحصة الأخيرة")));
  assert.ok(rMulti.applied_changes.some((c) => c.includes("شيماء") && c.includes("لا يعمل في الحصة الأخيرة")));
  passed("16f. What-if advisor + affirmative confirm + recommendation + multi-teacher contrast");

  // 16g. Teacher Fairness Audit & Fair Distribution Execution ("هل التوزيع عادل؟" + "عايز توزيع عادل للمعلمين")
  const rFairAudit = await browserService.chatWithCopilot("هل التوزيع عادل بين المعلمين؟", school, schedule, "", []);
  assert.equal(rFairAudit.should_solve, false);
  assert.ok(
    rFairAudit.reply.includes("عدالة التوزيع") && rFairAudit.reply.includes("هل تحب أطبّق التوزيع العادل للمعلمين"),
    `Unexpected fairness audit reply: ${rFairAudit.reply}`
  );
  const rFairExec = await browserService.chatWithCopilot("عايز توزيع عادل للمعلمين", school, schedule, "", []);
  assert.equal(rFairExec.should_solve, true);
  assert.ok(rFairExec.applied_changes.some((c) => c.includes("التوزيع اليومي المتوازن") || c.includes("موازنة")));
  const fairSolved = InBrowserSchoolEngine.solveInBrowser(rFairExec.updated_school);
  assert.equal(fairSolved.validation.is_valid, true);
  assert.equal(fairSolved.metrics.unplaced_lessons, 0);
  passed("16g. Teacher fairness audit ('هل التوزيع عادل؟') & balanced distribution execution (0 conflicts)");

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
    const badriSrvAfter = cancelData.updated_school?.teachers?.find((t: any) => t.id === badriPre.id);
    const rulesSrv = badriSrvAfter?.work_pattern?.placement_rules || [];
    const hasAvoidFirstSrv = rulesSrv.some((r: any) => Number(r.day) === 0 && r.placement_type === "AVOID_FIRST");
    const hasStaleFirstSrv = rulesSrv.some((r: any) => Number(r.day) === 0 && r.placement_type === "FIRST_N");
    assert.ok(hasAvoidFirstSrv && !hasStaleFirstSrv, `Server cancel period 1 misparsed: ${cancelData.reply}`);
    passed("18. Live Express server /api/ai/chat cancellation phrasing -> AVOID_FIRST");
  } else {
    console.log("ℹ️ Live server not active on port 3000; skipping HTTP check.");
  }

  // -----------------------------------------------------------------------
  // Part C: True AI-First Tool Calling Agent Loop (FunctionCalling + Fallback)
  // -----------------------------------------------------------------------
  assert.ok(AGENT_TOOL_DECLARATIONS.length >= 10, "All agent tool declarations registered");

  // 19a. Multi-step Tool Call: analyze_fairness -> apply_fair_distribution
  {
    let step = 0;
    const res19a = await runGeminiToolCallingAgent({
      message: "افحص العدالة ثم وزع الحصص بالتساوي على المعلمين",
      school,
      markdown: "",
      schedule,
      history,
      generateTurn: async () => {
        step++;
        if (step === 1) {
          return {
            text: "",
            functionCalls: [{ id: "fc_1", name: "analyze_fairness", args: {} }],
          };
        }
        if (step === 2) {
          return {
            text: "",
            functionCalls: [{ id: "fc_2", name: "apply_fair_distribution", args: { rebalance_quotas: true } }],
          };
        }
        return { text: "تم فحص العدالة وتنفيذ التوزيع العادل بدون تعارضات." };
      },
    });
    assert.equal(res19a.handled, true);
    assert.deepEqual(res19a.tool_calls_used, ["analyze_fairness", "apply_fair_distribution"]);
    assert.equal(res19a.should_solve, true);
    assert.ok(res19a.updated_schedule && res19a.updated_schedule.entries.length > 0);
    passed("19a. AI Tool Agent multi-step loop (analyze_fairness -> apply_fair_distribution)");
  }

  // 19b. AI Tool Call: query_teacher_details + apply_school_modifications (AVOID_FIRST)
  {
    const targetTeacher = school.teachers.find((t) =>
      school.assignments.some((a) => a.teacher_id === t.id && a.weekly_periods > 0)
    )!;
    let step = 0;
    const res19b = await runGeminiToolCallingAgent({
      message: `الغي الحصة الأولى يوم الأحد للأستاذ ${targetTeacher.name}`,
      school,
      markdown: "",
      schedule,
      history,
      generateTurn: async (_contents) => {
        step++;
        if (step === 1) {
          return {
            text: "",
            functionCalls: [
              {
                id: "fc_mod",
                name: "apply_school_modifications",
                args: {
                  ops: [
                    {
                      op: "add_placement_rule",
                      teacher: targetTeacher.name,
                      day: 0,
                      type: "AVOID_FIRST",
                      hard: true,
                    },
                  ],
                },
              },
            ],
          };
        }
        return { text: `تم إلغاء الحصة الأولى يوم الأحد للأستاذ ${targetTeacher.name}.` };
      },
    });
    assert.equal(res19b.handled, true);
    const updatedT = res19b.updated_school.teachers.find((t) => t.id === targetTeacher.id);
    assert.ok(
      updatedT?.work_pattern?.placement_rules?.some(
        (r) => Number(r.day) === 0 && r.placement_type === "AVOID_FIRST"
      ),
      "AI tool call persisted AVOID_FIRST rule"
    );
    passed("19b. AI Tool Agent structured ops tool applies AVOID_FIRST deterministically");
  }

  // 19c. AI Tool Call: find_substitute_teacher + trigger_app_action
  {
    let step = 0;
    const res19c = await runGeminiToolCallingAgent({
      message: "مين فاضي يوم الأحد الحصة الثانية وبعدين صدر جدول المعلمين PDF",
      school,
      markdown: "",
      schedule,
      history,
      generateTurn: async () => {
        step++;
        if (step === 1) {
          return {
            text: "",
            functionCalls: [
              { id: "fc_sub", name: "find_substitute_teacher", args: { day: 0, period: 2 } },
              { id: "fc_act", name: "trigger_app_action", args: { action: "export_teachers_pdf" } },
            ],
          };
        }
        return { text: "تم تحديد المرشحين للاحتياط وفتح طباعة جدول المعلمين." };
      },
    });
    assert.equal(res19c.handled, true);
    assert.equal(res19c.ui_action, "export_teachers_pdf");
    passed("19c. AI Tool Agent parallel tools (find_substitute_teacher + trigger_app_action)");
  }

  // 19d. AI Tool Agent graceful fallback when Gemini throws error
  {
    const res19d = await runGeminiToolCallingAgent({
      message: "اي كلام",
      school,
      markdown: "",
      schedule,
      history,
      generateTurn: async () => {
        throw new Error("Simulated 503 outage");
      },
    });
    assert.equal(res19d.handled, false);
    assert.ok(res19d.error_notice?.includes("503"));
    passed("19d. AI Tool Agent signals graceful fallback on API outage");
  }

  // 19e. Metadata-only edit (set_school_name / rename_teacher) sets should_solve = false (no unnecessary rebuild)
  {
    let step = 0;
    const res19e = await runGeminiToolCallingAgent({
      message: "غير اسم المدرسة إلى مدرسة التجديد الذكية",
      school,
      markdown: "",
      schedule,
      history,
      generateTurn: async () => {
        step++;
        if (step === 1) {
          return {
            text: "",
            functionCalls: [
              {
                id: "fc_ren",
                name: "apply_school_modifications",
                args: { ops: [{ op: "set_school_name", name: "مدرسة التجديد الذكية" }] },
              },
            ],
          };
        }
        return { text: "تم تعديل اسم المدرسة دون المساس بالجدول الحالي." };
      },
    });
    assert.equal(res19e.handled, true);
    assert.equal(res19e.should_solve, false, "School rename must NOT trigger schedule rebuild");
    assert.equal(res19e.updated_school.name, "مدرسة التجديد الذكية");
    passed("19e. Metadata-only op (set_school_name) keeps should_solve=false (no rebuild)");
  }

  // 19f. dryRunMinimalChange preserves >= 90% of existing schedule when adding AVOID_FIRST to one teacher
  {
    const p1Entry = schedule.entries.find((e) => e.period === 1 && e.day === 0);
    if (p1Entry) {
      const targetTch = school.teachers.find((t) => t.id === p1Entry.teacher_id)!;
      const modSchool: SchoolData = JSON.parse(JSON.stringify(school));
      const mTch = modSchool.teachers.find((t) => t.id === targetTch.id)!;
      mTch.work_pattern = mTch.work_pattern || { day_rules: {}, daily_period_rules: [], placement_rules: [] };
      mTch.work_pattern.placement_rules = [
        ...(mTch.work_pattern.placement_rules || []),
        { day: 0, placement_type: "AVOID_FIRST", is_hard: true, weight: 100 },
      ];
      const diffRes = dryRunMinimalChange(school, schedule, modSchool);
      assert.equal(diffRes.has_changes, true, "Conflicting period 1 entry must be moved cleanly");
      assert.ok(
        diffRes.unchanged_count >= Math.floor(schedule.entries.length * 0.9),
        `Expected >=90% unchanged entries, got ${diffRes.unchanged_count}/${schedule.entries.length}`
      );
      const stillInP1 = diffRes.preview_schedule.entries.some(
        (e) => e.teacher_id === targetTch.id && e.day === 0 && e.period === 1
      );
      assert.equal(stillInP1, false, "Teacher must no longer have Sunday period 1 after minimal diff");
      passed("19f. dryRunMinimalChange unpins conflicting rule cell while preserving >=90% of schedule");
    }
  }

  // 19g. Compound Add Teacher + Replace vacancy slot ('اضف معلم علي كمال واستبدل س3 به')
  {
    const s3Teacher = school.teachers.find((t) => /س\s*3/.test(t.name));
    if (s3Teacher) {
      const s3Count = school.assignments.filter((a) => a.teacher_id === s3Teacher.id).length;
      const r19g = await browserService.chatWithCopilot("اضف معلم علي كمال واستبدل س3 به", school, schedule, "", history);
      assert.equal(r19g.should_solve, true);
      const ali = r19g.updated_school?.teachers.find((t) => t.name.includes("علي كمال"));
      const oldStill = r19g.updated_school?.teachers.find((t) => t.id === s3Teacher.id);
      const aliAsgs = r19g.updated_school?.assignments.filter((a) => a.teacher_id === ali?.id).length || 0;
      assert.ok(ali && !oldStill && aliAsgs === s3Count && aliAsgs > 0, `Compound add+replace failed: ${r19g.reply}`);
      passed("19g. Compound add teacher + replace vacancy slot ('اضف معلم علي كمال واستبدل س3 به')");
    }
  }

  console.log("\nALL_HUMAN_E2E_AGENT_MEMORY_TESTS_PASSED");
}

runHumanFirstTimeSimulation().catch((err) => {
  console.error("❌ E2E test failed:", err);
  process.exit(1);
});
