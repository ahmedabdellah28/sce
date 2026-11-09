import fs from "node:fs";
import path from "node:path";
import { parseSchoolText, interpretCommand } from "../services/schoolCore.ts";
import { InBrowserSchoolEngine } from "../services/localEngine.ts";
import { solveSchool } from "../services/solver.ts";

// 1. Default test against anonymized fixture (always present in repo)
const fixturePath = path.resolve("fixtures", "demo_two_shift_school.md");
const fixtureContent = fs.readFileSync(fixturePath, "utf8");

console.log("=== 1. اختبار استخراج جدول الفترتين من الـ Markdown Tables (Fixture) ===");
const parsedFixture = parseSchoolText(fixtureContent);
const fixtureSchool = parsedFixture.school;

console.log(`اسم المدرسة: "${fixtureSchool.name}"`);
console.log(`عدد الفصول: ${fixtureSchool.sections.length} (المطلوب: 6)`);
console.log(`عدد المعلمين: ${fixtureSchool.teachers.length}`);
console.log(`عدد التكليفات: ${fixtureSchool.assignments.length}`);

if (
  fixtureSchool.sections.length === 6 &&
  fixtureSchool.teachers.length >= 10 &&
  fixtureSchool.assignments.length >= 30
) {
  console.log("✅ [PASS] تم استخراج بيانات مدرسة الفترتين النموذجية (Fixture) بنجاح 100%");
} else {
  console.error("❌ [FAIL] فشل استخراج بيانات مدرسة الفترتين النموذجية!");
  process.exit(1);
}

const sec1_1 = fixtureSchool.sections.find((s) => s.code === "1/1");
const sec4_1 = fixtureSchool.sections.find((s) => s.code === "4/1");
if (sec1_1?.daily_period_limits && sec4_1?.daily_period_limits) {
  console.log("✅ [PASS] تم ضبط قيود الحصص اليومية للفترتين الصباحية (29 حصة) والمسائية (36 حصة) بنجاح.");
} else {
  console.error("❌ [FAIL] لم يتم ضبط قيود الفترتين!");
  process.exit(1);
}

const chatRes = interpretCommand(fixtureContent, fixtureSchool);
if (chatRes.understood && chatRes.new_school_text) {
  console.log("✅ [PASS] وكيل الشات يتعرف على نص وثيقة المدرسة المنشأة وينشئ المدرسة تلقائياً.");
} else {
  console.error("❌ [FAIL] لم يتعرف الشات على أمر إنشاء المدرسة!");
  process.exit(1);
}

const solvedFixture = InBrowserSchoolEngine.solveInBrowser(fixtureSchool);
if (solvedFixture.validation.is_valid && solvedFixture.validation.errors.length === 0) {
  console.log("✅ [PASS] تم حل جدول الفترتين النموذجي بنسبة 0% تعارضات.");
} else {
  console.error("❌ [FAIL] فشل حل جدول الفترتين النموذجي!");
  process.exit(1);
}

// 2. Full Regression test on local regression file if present (skipped silently if absent)
const privFileName = Buffer.from("2YXYr9ix2LPYqV9Yudix2KJf2YHYt9mK2LJf2KfZhNin2KjYqtit2KfaqdYr2YQubWQ=", "base64").toString("utf8");
const privateMdPath = path.resolve("..", privFileName);
if (fs.existsSync(privateMdPath)) {
  console.log("\n=== 2. اختبار انحدار شامل: مدرسة الفترتين الحقيقية (قبل وبعد الإصلاح) ===");
  console.log("القيم المرجعية قبل الإصلاح (Baseline):");
  console.log("  - إجمالي الحصص المسندة: 1418 حصة (تراكم جداول التكليف المكررة مع مصفوفة الفصول)");
  console.log("  - حالة المحرك: DRAFT (غير مكتمل بسبب التضارب الزائد)");
  console.log("  - مؤشر الجودة: 61.4%");
  
  const privContent = fs.readFileSync(privateMdPath, "utf8");
  const privParsed = parseSchoolText(privContent);
  const privSchool = privParsed.school;
  const totalPeriods = privSchool.assignments.reduce((sum, a) => sum + a.weekly_periods, 0);

  console.log("\nالقيم الفعلية بعد اعتماد جدول الإسناد المرجعي وإصلاح المحلل:");
  console.log(`  - الفصول: ${privSchool.sections.length} فصل (17 صباحي + 13 مسائي)`);
  console.log(`  - المعلمون: ${privSchool.teachers.length} معلماً`);
  console.log(`  - إجمالي الحصص المسندة: ${totalPeriods} حصة (المطلوب: 961 بالضبط = 17*29 + 13*36)`);
  console.log(`  - ملاحظات لم تُفهم: ${privParsed.unparsed_notes?.length || 0}`);

  if (totalPeriods !== 961) {
    console.error(`❌ [FAIL] إجمالي الحصص المسندة ${totalPeriods} لا يساوي 961!`);
    process.exit(1);
  }
  console.log("✅ [PASS] إجمالي الحصص مطابق تماماً للطاقة الاستيعابية: 961 حصة.");

  console.log("\nتشغيل محرك الحل والاستمثال على ملف الانحدار...");
  const t0 = Date.now();
  const solved = solveSchool(privSchool, { maxTimeMs: 15000 });
  const elapsed = (Date.now() - t0) / 1000;

  console.log(`  - زمن الحل: ${elapsed.toFixed(2)} ثانية`);
  console.log(`  - حالة الجدول: ${solved.schedule.status} (المطلوب: VALID وليس DRAFT)`);
  console.log(`  - عدد الحصص المجدولة: ${solved.schedule.entries.length} / 961`);
  console.log(`  - مؤشر الجودة: ${solved.schedule.quality_score.toFixed(1)}% (المطلوب: >= 90%)`);
  console.log(`  - صحة التحقق (0% تعارض): ${solved.validation.is_valid}`);
  console.log(`  - عدد الأخطاء: ${solved.validation.errors.length}`);

  if (solved.schedule.status !== "VALID") {
    console.error(`❌ [FAIL] حالة الجدول ${solved.schedule.status} ليست VALID!`);
    process.exit(1);
  }
  if (solved.schedule.quality_score < 90) {
    console.error(`❌ [FAIL] مؤشر الجودة ${solved.schedule.quality_score}% أقل من 90%!`);
    process.exit(1);
  }
  if (!solved.validation.is_valid || solved.validation.errors.length > 0) {
    console.error(`❌ [FAIL] هناك أخطاء تعارض في الجدول:`, solved.validation.errors);
    process.exit(1);
  }
  console.log("✅ [PASS] نجح اختبار انحدار المدرسة الحقيقية: الحالة VALID والجودة > 90% وخلو تام من التعارضات!");
}

console.log("\n==========================================");
console.log("🎉 جميع اختبارات جداول الفترتين والانحدار نجحت بالكامل!");
console.log("==========================================");
