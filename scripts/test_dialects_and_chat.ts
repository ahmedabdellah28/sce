import { interpretCommand, applyOps, schoolToMarkdown } from "../services/schoolCore.ts";
import { InBrowserSchoolEngine } from "../services/localEngine.ts";
import type { SchoolData } from "../types.ts";

function createMockSchool(): SchoolData {
  return {
    id: "sch_test_dialect",
    name: "مدرسة الاختبار التجريبية",
    academic_year: "2025/2026",
    shift_mode: "SINGLE",
    days: [0, 1, 2, 3, 4],
    periods_per_day: 7,
    grades: [{ id: "G_1", name: "الصف الأول", code: "G1", order: 1 }],
    sections: [
      { id: "SEC_1_1", grade_id: "G_1", name: "1/1", code: "1/1" },
      { id: "SEC_1_2", grade_id: "G_1", name: "1/2", code: "1/2" },
    ],
    subjects: [
      { id: "SUB_AR", name: "اللغة العربية", code: "عربي" },
      { id: "SUB_MATH", name: "الرياضيات", code: "حساب" },
      { id: "SUB_ENG", name: "اللغة الإنجليزية", code: "انجليزي" },
    ],
    teachers: [
      {
        id: "TCH_1",
        name: "كمال",
        code: "كمال",
        work_pattern: { day_rules: {}, daily_period_rules: [], placement_rules: [] },
      },
      {
        id: "TCH_2",
        name: "يوسف كمال",
        code: "يوسف",
        work_pattern: { day_rules: {}, daily_period_rules: [], placement_rules: [] },
      },
      {
        id: "TCH_3",
        name: "محمود حسن",
        code: "محمود",
        work_pattern: { day_rules: {}, daily_period_rules: [], placement_rules: [] },
      },
    ],
    assignments: [
      { id: "ASG_1", section_id: "SEC_1_1", subject_id: "SUB_AR", teacher_id: "TCH_1", weekly_periods: 6 },
      { id: "ASG_2", section_id: "SEC_1_2", subject_id: "SUB_MATH", teacher_id: "TCH_2", weekly_periods: 5 },
      { id: "ASG_3", section_id: "SEC_1_1", subject_id: "SUB_ENG", teacher_id: "TCH_3", weekly_periods: 4 },
    ],
    availabilities: [],
    rules: { break_after_period: 3 },
  };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, title: string, details?: any) {
  if (condition) {
    console.log(`✅ [PASS] ${title}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${title}`);
    if (details) console.error("   Details:", details);
    failed++;
  }
}

async function runTests() {
  console.log("=== بدء اختبارات فهم اللهجات المصرية والخليجية وشات الذكاء الاصطناعي ===");
  const baseSchool = createMockSchool();

  // Test 1: Egyptian Off Day "اديله اجازة يوم التلات للأستاذ كمال"
  {
    const res = interpretCommand("اديله اجازة يوم التلات للأستاذ كمال", baseSchool);
    assert(res.understood, "1. فهم أمر الإجازة بالعامية المصرية (اديله اجازة يوم التلات)");
    assert(
      res.ops.some((o) => o.op === "set_teacher_days" && o.off_days?.includes(2)),
      "1.b استخراج يوم الثلاثاء (2) كيوم إجازة للأستاذ كمال",
      res.ops
    );
    const applied = applyOps(baseSchool, res.ops);
    const t = applied.school.teachers.find((x) => x.name === "كمال");
    assert(t?.work_pattern?.day_rules["2"] === "MANDATORY_OFF", "1.c تطبيق قيد الإجازة الإجبارية في work_pattern كمال");
  }

  // Test 2: Gulf Off Day "عطه اوف يوم الربوع للأستاذ كمال" (الربوع = Wednesday = 3)
  {
    const res = interpretCommand("عطه اوف يوم الربوع للأستاذ كمال", baseSchool);
    assert(res.understood, "2. فهم أمر الإجازة باللهجة الخليجية (عطه اوف يوم الربوع)");
    assert(
      res.ops.some((o) => o.op === "set_teacher_days" && o.off_days?.includes(3)),
      "2.b استخراج يوم الأربعاء/الربوع (3) كأوف للأستاذ كمال",
      res.ops
    );
    const applied = applyOps(baseSchool, res.ops);
    const t = applied.school.teachers.find((x) => x.name === "كمال");
    assert(t?.work_pattern?.day_rules["3"] === "MANDATORY_OFF", "2.c تطبيق قيد الإجازة الإجبارية يوم الربوع");
  }

  // Test 3: Egyptian "فضيله الخميس للأستاذ يوسف كمال"
  {
    const res = interpretCommand("فضيله الخميس للأستاذ يوسف كمال", baseSchool);
    assert(res.understood, "3. فهم أمر التفرغ بالعامية المصرية (فضيله الخميس)");
    assert(
      res.ops.some((o) => o.op === "set_teacher_days" && o.off_days?.includes(4)),
      "3.b استخراج يوم الخميس (4) كيوم تفرغ",
      res.ops
    );
  }

  // Test 4: Gulf "ما يداوم الاحد للأستاذ كمال"
  {
    const res = interpretCommand("ما يداوم الاحد للأستاذ كمال", baseSchool);
    assert(res.understood, "4. فهم النفي باللهجة الخليجية (ما يداوم الاحد)");
    assert(
      res.ops.some((o) => o.op === "set_teacher_days" && o.off_days?.includes(0)),
      "4.b استخراج يوم الأحد (0) كإجازة",
      res.ops
    );
  }

  // Test 5: Egyptian "مبيجيش يوم الاتنين للأستاذ كمال"
  {
    const res = interpretCommand("مبيجيش يوم الاتنين للأستاذ كمال", baseSchool);
    assert(res.understood, "5. فهم النفي بالعامية المصرية (مبيجيش يوم الاتنين)");
    assert(
      res.ops.some((o) => o.op === "set_teacher_days" && o.off_days?.includes(1)),
      "5.b استخراج يوم الاثنين (1) كإجازة",
      res.ops
    );
  }

  // Test 6: Egyptian placement "خليه ياخد اول حصتين للأستاذ كمال"
  {
    const res = interpretCommand("خليه ياخد اول حصتين للأستاذ كمال", baseSchool);
    assert(res.understood, "6. فهم تفضيل الحصص بالعامية المصرية (خليه ياخد اول حصتين)");
    assert(
      res.ops.some((o) => o.op === "add_placement_rule" && o.type === "FIRST_N" && o.n === 2),
      "6.b توليد قيد FIRST_N برقم 2 للأستاذ كمال",
      res.ops
    );
  }

  // Test 7: Gulf early leave "خله يطلع مبكر للأستاذ كمال"
  {
    const res = interpretCommand("خله يطلع مبكر للأستاذ كمال", baseSchool);
    assert(res.understood, "7. فهم الخروج المبكر باللهجة الخليجية (خله يطلع مبكر)");
    assert(
      res.ops.some((o) => o.op === "add_placement_rule" && o.type === "FIRST_N"),
      "7.b توليد قيد الحصص المبكرة",
      res.ops
    );
  }

  // Test 8: Swap teachers "بدل حصص كمال مع يوسف كمال"
  {
    const res = interpretCommand("بدل حصص كمال مع يوسف كمال", baseSchool);
    assert(res.understood, "8. فهم أمر تبديل الحصص (بدل حصص كمال مع يوسف كمال)");
    assert(
      res.ops.some((o) => o.op === "swap_teachers"),
      "8.b توليد عملية swap_teachers",
      res.ops
    );
    const applied = applyOps(baseSchool, res.ops);
    const asg1 = applied.school.assignments.find((a) => a.id === "ASG_1");
    const asg2 = applied.school.assignments.find((a) => a.id === "ASG_2");
    assert(asg1?.teacher_id === "TCH_2" && asg2?.teacher_id === "TCH_1", "8.c تم تبديل التكليفات بنجاح بين المعلمين");
  }

  // Test 9: Replace teacher "شيل كمال وحط مكانه احمد السيد"
  {
    const res = interpretCommand("شيل كمال وحط مكانه احمد السيد", baseSchool);
    assert(res.understood, "9. فهم أمر الاستبدال بالعامية (شيل كمال وحط مكانه احمد السيد)");
    assert(
      res.ops.some((o) => o.op === "replace_teacher"),
      "9.b توليد عملية replace_teacher",
      res.ops
    );
    const applied = applyOps(baseSchool, res.ops);
    assert(!applied.school.teachers.some((t) => t.name === "كمال"), "9.c تم حذف المعلم القديم كمال");
    const newT = applied.school.teachers.find((t) => t.name.includes("احمد"));
    assert(!!newT, "9.d تم إنشاء المعلم الجديد احمد السيد وإسناد الحصص له");
    const asg = applied.school.assignments.find((a) => a.id === "ASG_1");
    assert(asg?.teacher_id === newT?.id, "9.e تم نقل التكليف ASG_1 للمعلم الجديد");
  }

  // Test 10: Complete deletion "احذف أستاذ كمال خالص"
  {
    const res = interpretCommand("احذف أستاذ كمال خالص", baseSchool);
    assert(res.understood, "10. فهم أمر الحذف الكامل (احذف أستاذ كمال خالص)");
    assert(
      res.ops.some((o) => o.op === "remove_teacher"),
      "10.b توليد عملية remove_teacher",
      res.ops
    );
    const applied = applyOps(baseSchool, res.ops);
    assert(!applied.school.teachers.some((t) => t.name === "كمال"), "10.c تم حذف المعلم من قائمة المعلمين");
    assert(!applied.school.assignments.some((a) => a.teacher_id === "TCH_1"), "10.d تم حذف التكليفات المرتبطة بأمان");
  }

  // Test 11: Add teacher "ضيف مدرس جديد اسمه سامح لمادة الرياضيات"
  {
    const res = interpretCommand("ضيف مدرس جديد اسمه سامح لمادة الرياضيات", baseSchool);
    assert(res.understood, "11. فهم أمر إضافة معلم جديد (ضيف مدرس جديد اسمه سامح لمادة الرياضيات)");
    assert(
      res.ops.some((o) => o.op === "add_teacher" && o.name === "سامح"),
      "11.b توليد عملية add_teacher باسم سامح",
      res.ops
    );
    const applied = applyOps(baseSchool, res.ops);
    assert(applied.school.teachers.some((t) => t.name === "سامح"), "11.c تمت إضافة سامح لقائمة المعلمين");
  }

  // Test 12: Solve command Gulf dialect "سو جدول جديد الحين"
  {
    const res = interpretCommand("سو جدول جديد الحين", baseSchool);
    assert(res.understood && res.solve_only === true, "12. فهم أمر توليد الجدول بالخليجي (سو جدول جديد الحين)");
  }

  // Test 13: Timetable solver after mutations guaranteeing 0% hard collisions
  {
    // Apply Egyptian off-day + first periods, then solve
    const mut1 = interpretCommand("اديله اجازة يوم التلات للأستاذ كمال", baseSchool);
    const mut2 = interpretCommand("خليه ياخد اول حصتين للأستاذ يوسف كمال", baseSchool);
    const app1 = applyOps(baseSchool, [...mut1.ops, ...mut2.ops]);

    const solution = InBrowserSchoolEngine.solveInBrowser(app1.school);
    const hardCollisions = solution.validation.errors.length;
    assert(solution.schedule.entries.length > 0, "13.a تم حل وتوزيع الحصص بنجاح بعد تطبيق التعديلات اللهجية");
    assert(hardCollisions === 0, `13.b ضمان 0% تعارضات حتمية (عدد الأخطاء/التعارضات = ${hardCollisions})`);

    // Verify teacher Kamal has no periods on Tuesday (day 2)
    const kamalTuesdayEntries = solution.schedule.entries.filter(
      (e) => e.teacher_id === "TCH_1" && e.day === 2
    );
    assert(kamalTuesdayEntries.length === 0, `13.c الأستاذ كمال ليس لديه أي حصة يوم الثلاثاء (${kamalTuesdayEntries.length} حصص)`);
  }

  // Test 14: Multi-turn Revert / Undo "تراجع عن الاجازة"
  {
    // Step 1: User gives Kamal Tuesday off
    const step1 = interpretCommand("اديله اجازة يوم التلات للأستاذ كمال", baseSchool);
    const schoolWithOff = applyOps(baseSchool, step1.ops).school;
    assert(
      schoolWithOff.teachers.find((t) => t.name === "كمال")?.work_pattern?.day_rules["2"] === "MANDATORY_OFF",
      "14.a المعلم كمال لديه إجازة يوم الثلاثاء بالفعل"
    );

    // Step 2: User says "تراجع عن الاجازة" without mentioning Kamal's name
    const history = [
      { role: "user", text: "اديله اجازة يوم التلات للأستاذ كمال" },
      { role: "ai", text: "تم تطبيق الإجازة", changes: ["إجازة إجبارية للمعلم كمال: الثلاثاء"] },
    ];
    const step2 = interpretCommand("تراجع عن الاجازة", schoolWithOff, history);
    assert(step2.understood, "14.b فهم أمر التراجع عن الإجازة (تراجع عن الاجازة) بالاعتماد على سياق المحادثة");
    assert(
      step2.ops.some((o) => o.op === "set_teacher_days" && o.allow_days?.includes(2)),
      "14.c توليد عملية إلغاء إجازة الثلاثاء للأستاذ كمال",
      step2.ops
    );

    const reverted = applyOps(schoolWithOff, step2.ops);
    assert(
      reverted.school.teachers.find((t) => t.name === "كمال")?.work_pattern?.day_rules["2"] === undefined,
      "14.d تم إلغاء الإجازة الإجبارية وعودة يوم الثلاثاء كيوم عمل عادي للأستاذ كمال"
    );
  }

  // Test 15: Direct cancel "الغي الاجازة للأستاذ كمال"
  {
    const step1 = interpretCommand("اديله اجازة يوم التلات للأستاذ كمال", baseSchool);
    const schoolWithOff = applyOps(baseSchool, step1.ops).school;

    const res = interpretCommand("الغي الاجازة للأستاذ كمال", schoolWithOff);
    assert(res.understood, "15.a فهم أمر إلغاء الإجازة المباشر (الغي الاجازة للأستاذ كمال)");
    const reverted = applyOps(schoolWithOff, res.ops);
    assert(
      reverted.school.teachers.find((t) => t.name === "كمال")?.work_pattern?.day_rules["2"] === undefined,
      "15.b تم حذف إجازة الثلاثاء بنجاح"
    );
  }

  // Test 16: Double periods combined with max consecutive limit
  {
    const res = interpretCommand("اريد حصص المعلمين مزدوجة ولكن ليست متتالية اي منع اربع حصص لنفس الفصل", baseSchool);
    assert(res.understood, "16.a فهم السياسة المزدوجة مع منع تكرار الحصص (مزدوجة وليست متتالية)");
    assert(
      res.ops.some((o) => o.op === "set_double_policy" && o.policy === "REQUIRED"),
      "16.b توليد عملية set_double_policy للمدرسة كاملة",
      res.ops
    );
    assert(
      res.ops.some((o) => o.op === "set_school_rule" && o.max_consecutive_same_teacher_section === 3),
      "16.c توليد قيد set_school_rule بحد أقصى 3 حصص متتالية لنفس الفصل",
      res.ops
    );
    const applied = applyOps(baseSchool, res.ops);
    assert(
      applied.school.rules?.max_consecutive_same_teacher_section === 3,
      "16.d تم تطبيق قيد 3 حصص متتالية في كائن المدرسة"
    );
    assert(
      applied.school.teachers.every((t) => t.work_pattern?.double_period_policy === "DOUBLE_REQUIRED"),
      "16.e تم تطبيق سياسة الحصص المزدوجة الإجبارية لجميع معلمي المدرسة"
    );
  }

  // Test 17: Teacher action with unlisted/new teacher "عصام عبدالمجيد عمل يوم الخميس"
  {
    const res = interpretCommand("عصام عبدالمجيد عمل يوم الخميس", baseSchool);
    assert(res.understood, "17.a فهم تكليف عمل المعلم (عصام عبدالمجيد عمل يوم الخميس)");
    assert(
      res.ops.some((o) => o.op === "add_teacher" && o.name === "عصام عبدالمجيد"),
      "17.b التعرف الذكي وإضافة المعلم غير المسجل عصام عبدالمجيد",
      res.ops
    );
    assert(
      res.ops.some((o) => o.op === "set_teacher_days" && o.work_days?.includes(4)),
      "17.c تخصيص يوم الخميس (4) كيوم عمل للمعلم",
      res.ops
    );
    const applied = applyOps(baseSchool, res.ops);
    const newT = applied.school.teachers.find((t) => t.name === "عصام عبدالمجيد");
    assert(!!newT, "17.d المعلم أضيف بنجاح إلى المدرسة");
    assert(newT?.work_pattern?.target_working_days === 1, "17.e تم ضبط أيام العمل المستهدفة كيوم واحد (الخميس)");
  }

  console.log(`\n========================================`);
  console.log(`النتائج النهائية: ${passed} نجح | ${failed} فشل`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
