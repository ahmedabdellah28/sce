import type { SchoolData, Grade, Section, Subject, Teacher, TeachingAssignment } from "../types.ts";

export interface SchoolTemplateResult {
  school: SchoolData;
  raw_text: string;
}

/**
 * Creates a clean blank school template for full custom configuration.
 */
export function createBlankSchoolTemplate(
  name: string = "مدرسة جديدة",
  periodsPerDay: number = 7
): SchoolTemplateResult {
  const schoolId = "sch_" + Date.now().toString(36);
  const gradeId = "g_1";
  const sectionId = "sec_1";

  const grades: Grade[] = [{ id: gradeId, name: "الصف الأول", code: "G1", order: 1 }];
  const sections: Section[] = [{ id: sectionId, grade_id: gradeId, name: "فصل 1/1", code: "1/1" }];

  const subjects: Subject[] = [
    { id: "sub_ar", name: "لغة عربية", code: "AR", priority: 1 },
    { id: "sub_ma", name: "رياضيات", code: "MA", priority: 2 },
    { id: "sub_en", name: "لغة إنجليزية", code: "EN", priority: 3 },
    { id: "sub_sc", name: "علوم", code: "SC", priority: 4 },
    { id: "sub_so", name: "دراسات اجتماعية", code: "SO", priority: 5 },
    { id: "sub_pe", name: "تربية رياضية", code: "PE", priority: 6 },
    { id: "sub_art", name: "تربية فنية", code: "ART", priority: 7 },
  ];

  const teachers: Teacher[] = [
    {
      id: "tch_1",
      name: "معلم اللغة العربية",
      code: "T1",
      max_daily_periods: 4,
      work_pattern: { day_rules: {}, daily_period_rules: [], placement_rules: [] },
    },
    {
      id: "tch_2",
      name: "معلم الرياضيات",
      code: "T2",
      max_daily_periods: 4,
      work_pattern: { day_rules: {}, daily_period_rules: [], placement_rules: [] },
    },
    {
      id: "tch_3",
      name: "معلم اللغة الإنجليزية",
      code: "T3",
      max_daily_periods: 4,
      work_pattern: { day_rules: {}, daily_period_rules: [], placement_rules: [] },
    },
    {
      id: "tch_4",
      name: "معلم العلوم والدراسات",
      code: "T4",
      max_daily_periods: 4,
      work_pattern: { day_rules: {}, daily_period_rules: [], placement_rules: [] },
    },
    {
      id: "tch_5",
      name: "معلم الأنشطة",
      code: "T5",
      max_daily_periods: 4,
      work_pattern: { day_rules: {}, daily_period_rules: [], placement_rules: [] },
    },
  ];

  const assignments: TeachingAssignment[] = [
    { id: "as_1", section_id: sectionId, subject_id: "sub_ar", teacher_id: "tch_1", weekly_periods: 7 },
    { id: "as_2", section_id: sectionId, subject_id: "sub_ma", teacher_id: "tch_2", weekly_periods: 6 },
    { id: "as_3", section_id: sectionId, subject_id: "sub_en", teacher_id: "tch_3", weekly_periods: 5 },
    { id: "as_4", section_id: sectionId, subject_id: "sub_sc", teacher_id: "tch_4", weekly_periods: 4 },
    { id: "as_5", section_id: sectionId, subject_id: "sub_so", teacher_id: "tch_4", weekly_periods: 4 },
    { id: "as_6", section_id: sectionId, subject_id: "sub_pe", teacher_id: "tch_5", weekly_periods: 5 },
    { id: "as_7", section_id: sectionId, subject_id: "sub_art", teacher_id: "tch_5", weekly_periods: 4 },
  ];

  const school: SchoolData = {
    id: schoolId,
    name,
    academic_year: "2025/2026",
    days: [0, 1, 2, 3, 4],
    periods_per_day: periodsPerDay,
    grades,
    sections,
    subjects,
    teachers,
    availabilities: [],
    assignments,
  };

  const raw_text = `# ${name}
المرحلة: تعليم أساسي
العام الدراسي: 2025/2026
أيام الدراسة: الأحد إلى الخميس
عدد الحصص اليومية: ${periodsPerDay} حصص

## الفصول:
- الصف الأول: فصل 1/1

## المواد والمعلمون والأنصبة:
- لغة عربية: معلم اللغة العربية (فصل 1/1 : 7 حصص)
- رياضيات: معلم الرياضيات (فصل 1/1 : 6 حصص)
- لغة إنجليزية: معلم اللغة الإنجليزية (فصل 1/1 : 5 حصص)
- علوم: معلم العلوم والدراسات (فصل 1/1 : 4 حصص)
- دراسات اجتماعية: معلم العلوم والدراسات (فصل 1/1 : 4 حصص)
- تربية رياضية: معلم الأنشطة (فصل 1/1 : 5 حصص)
- تربية فنية: معلم الأنشطة (فصل 1/1 : 4 حصص)
`;

  return { school, raw_text };
}

/**
 * Creates a standard Primary School Template (6 grades/sections, 30-35 periods per week).
 */
export function createPrimarySchoolTemplate(
  name: string = "مدرسة النور الابتدائية المشتركة"
): SchoolTemplateResult {
  const schoolId = "sch_prim_" + Date.now().toString(36);

  const grades: Grade[] = [
    { id: "g_p1", name: "الصف الأول", code: "G1", order: 1 },
    { id: "g_p2", name: "الصف الثاني", code: "G2", order: 2 },
    { id: "g_p3", name: "الصف الثالث", code: "G3", order: 3 },
    { id: "g_p4", name: "الصف الرابع", code: "G4", order: 4 },
    { id: "g_p5", name: "الصف الخامس", code: "G5", order: 5 },
    { id: "g_p6", name: "الصف السادس", code: "G6", order: 6 },
  ];

  const sections: Section[] = [
    { id: "sec_p1", grade_id: "g_p1", name: "فصل 1/1", code: "1/1" },
    { id: "sec_p2", grade_id: "g_p2", name: "فصل 2/1", code: "2/1" },
    { id: "sec_p3", grade_id: "g_p3", name: "فصل 3/1", code: "3/1" },
    { id: "sec_p4", grade_id: "g_p4", name: "فصل 4/1", code: "4/1" },
    { id: "sec_p5", grade_id: "g_p5", name: "فصل 5/1", code: "5/1" },
    { id: "sec_p6", grade_id: "g_p6", name: "فصل 6/1", code: "6/1" },
  ];

  const subjects: Subject[] = [
    { id: "sub_ar", name: "لغة عربية", code: "AR", priority: 1 },
    { id: "sub_ma", name: "رياضيات", code: "MA", priority: 2 },
    { id: "sub_en", name: "لغة إنجليزية", code: "EN", priority: 3 },
    { id: "sub_sc", name: "علوم", code: "SC", priority: 4 },
    { id: "sub_so", name: "دراسات اجتماعية", code: "SO", priority: 5 },
    { id: "sub_re", name: "تربية دينية", code: "RE", priority: 6 },
    { id: "sub_pe", name: "تربية رياضية", code: "PE", priority: 7 },
    { id: "sub_art", name: "تربية فنية", code: "ART", priority: 8 },
  ];

  const teachers: Teacher[] = [
    { id: "tp_1", name: "أحمد عبد الله (عربي)", code: "T1", max_daily_periods: 5 },
    { id: "tp_2", name: "فاطمة إبراهيم (عربي)", code: "T2", max_daily_periods: 5 },
    { id: "tp_3", name: "سامح مصطفى (رياضيات)", code: "T3", max_daily_periods: 5 },
    { id: "tp_4", name: "منى فاروق (رياضيات)", code: "T4", max_daily_periods: 5 },
    { id: "tp_5", name: "هاني يوسف (إنجليزي)", code: "T5", max_daily_periods: 5 },
    { id: "tp_6", name: "رشا كمال (علوم ودراسات)", code: "T6", max_daily_periods: 5 },
    { id: "tp_7", name: "محمود حسن (أنشطة ورياضة)", code: "T7", max_daily_periods: 5 },
  ];

  const assignments: TeachingAssignment[] = [];
  // Distribute 35 periods per section
  sections.forEach((sec, idx) => {
    const isLower = idx < 3;
    assignments.push(
      { id: `as_${sec.id}_ar`, section_id: sec.id, subject_id: "sub_ar", teacher_id: isLower ? "tp_1" : "tp_2", weekly_periods: 8 },
      { id: `as_${sec.id}_ma`, section_id: sec.id, subject_id: "sub_ma", teacher_id: isLower ? "tp_3" : "tp_4", weekly_periods: 7 },
      { id: `as_${sec.id}_en`, section_id: sec.id, subject_id: "sub_en", teacher_id: "tp_5", weekly_periods: 5 },
      { id: `as_${sec.id}_sc`, section_id: sec.id, subject_id: "sub_sc", teacher_id: "tp_6", weekly_periods: 4 },
      { id: `as_${sec.id}_so`, section_id: sec.id, subject_id: "sub_so", teacher_id: "tp_6", weekly_periods: 4 },
      { id: `as_${sec.id}_re`, section_id: sec.id, subject_id: "sub_re", teacher_id: isLower ? "tp_1" : "tp_2", weekly_periods: 3 },
      { id: `as_${sec.id}_pe`, section_id: sec.id, subject_id: "sub_pe", teacher_id: "tp_7", weekly_periods: 2 },
      { id: `as_${sec.id}_art`, section_id: sec.id, subject_id: "sub_art", teacher_id: "tp_7", weekly_periods: 2 }
    );
  });

  const school: SchoolData = {
    id: schoolId,
    name,
    academic_year: "2025/2026",
    days: [0, 1, 2, 3, 4],
    periods_per_day: 7,
    grades,
    sections,
    subjects,
    teachers,
    availabilities: [],
    assignments,
  };

  const raw_text = `# ${name}
المرحلة: ابتدائية (6 فصول)
العام الدراسي: 2025/2026
أيام الدراسة: الأحد إلى الخميس (7 حصص يومياً = 35 حصة لكل فصل)

## الفصول:
- 1/1 ، 2/1 ، 3/1 ، 4/1 ، 5/1 ، 6/1

## أنصبة المعلمين والمواد:
- أحمد عبد الله: لغة عربية ودين للصفوف 1/1 و 2/1 و 3/1
- فاطمة إبراهيم: لغة عربية ودين للصفوف 4/1 و 5/1 و 6/1
- سامح مصطفى: رياضيات للصفوف 1/1 و 2/1 و 3/1
- منى فاروق: رياضيات للصفوف 4/1 و 5/1 و 6/1
- هاني يوسف: لغة إنجليزية لكل الفصول (5 حصص لكل فصل)
- رشا كمال: علوم ودراسات اجتماعية لكل الفصول
- محمود حسن: تربية رياضية وتربية فنية
`;

  return { school, raw_text };
}

/**
 * Creates a standard Secondary School Template (6 sections, 35 periods per week).
 */
export function createSecondarySchoolTemplate(
  name: string = "مدرسة الأمل الثانوية العامة"
): SchoolTemplateResult {
  const schoolId = "sch_sec_" + Date.now().toString(36);

  const grades: Grade[] = [
    { id: "g_s1", name: "الصف الأول الثانوي", code: "S1", order: 1 },
    { id: "g_s2", name: "الصف الثاني الثانوي", code: "S2", order: 2 },
    { id: "g_s3", name: "الصف الثالث الثانوي", code: "S3", order: 3 },
  ];

  const sections: Section[] = [
    { id: "sec_s1_1", grade_id: "g_s1", name: "فصل 1/1 ثانوى", code: "1/1" },
    { id: "sec_s1_2", grade_id: "g_s1", name: "فصل 1/2 ثانوى", code: "1/2" },
    { id: "sec_s2_1", grade_id: "g_s2", name: "فصل 2/1 علمي", code: "2/1" },
    { id: "sec_s2_2", grade_id: "g_s2", name: "فصل 2/2 أدبي", code: "2/2" },
    { id: "sec_s3_1", grade_id: "g_s3", name: "فصل 3/1 علمي", code: "3/1" },
    { id: "sec_s3_2", grade_id: "g_s3", name: "فصل 3/2 أدبي", code: "3/2" },
  ];

  const subjects: Subject[] = [
    { id: "sub_ar", name: "اللغة العربية", code: "AR", priority: 1 },
    { id: "sub_en", name: "اللغة الإنجليزية", code: "EN", priority: 2 },
    { id: "sub_fr", name: "اللغة الثانية (فرنسي)", code: "FR", priority: 3 },
    { id: "sub_ma", name: "الرياضيات البحتة والتطبيقية", code: "MA", priority: 4 },
    { id: "sub_ph", name: "الفيزياء والكيمياء", code: "SCI", priority: 5 },
    { id: "sub_hi", name: "التاريخ والجغرافيا", code: "HUM", priority: 6 },
    { id: "sub_pe", name: "التربية الوطنية والرياضية", code: "PE", priority: 7 },
  ];

  const teachers: Teacher[] = [
    { id: "ts_1", name: "أ. طارق عبد العظيم (لغة عربية)", code: "TS1" },
    { id: "ts_2", name: "أ. عصام رضوان (لغة عربية)", code: "TS2" },
    { id: "ts_3", name: "أ. خالد النجار (لغة إنجليزية)", code: "TS3" },
    { id: "ts_4", name: "أ. مدحت الشريف (رياضيات)", code: "TS4" },
    { id: "ts_5", name: "أ. سمير خليل (فيزياء وكيمياء)", code: "TS5" },
    { id: "ts_6", name: "أ. أشرف البنا (تاريخ وجغرافيا)", code: "TS6" },
    { id: "ts_7", name: "أ. ميرفت زكي (لغة فرنسية)", code: "TS7" },
  ];

  const assignments: TeachingAssignment[] = [];
  sections.forEach((sec, idx) => {
    assignments.push(
      { id: `as_s_${sec.id}_ar`, section_id: sec.id, subject_id: "sub_ar", teacher_id: idx % 2 === 0 ? "ts_1" : "ts_2", weekly_periods: 7 },
      { id: `as_s_${sec.id}_en`, section_id: sec.id, subject_id: "sub_en", teacher_id: "ts_3", weekly_periods: 6 },
      { id: `as_s_${sec.id}_fr`, section_id: sec.id, subject_id: "sub_fr", teacher_id: "ts_7", weekly_periods: 4 },
      { id: `as_s_${sec.id}_ma`, section_id: sec.id, subject_id: "sub_ma", teacher_id: "ts_4", weekly_periods: 7 },
      { id: `as_s_${sec.id}_ph`, section_id: sec.id, subject_id: "sub_ph", teacher_id: "ts_5", weekly_periods: 5 },
      { id: `as_s_${sec.id}_hi`, section_id: sec.id, subject_id: "sub_hi", teacher_id: "ts_6", weekly_periods: 4 },
      { id: `as_s_${sec.id}_pe`, section_id: sec.id, subject_id: "sub_pe", teacher_id: "ts_6", weekly_periods: 2 }
    );
  });

  const school: SchoolData = {
    id: schoolId,
    name,
    academic_year: "2025/2026",
    days: [0, 1, 2, 3, 4],
    periods_per_day: 7,
    grades,
    sections,
    subjects,
    teachers,
    availabilities: [],
    assignments,
  };

  const raw_text = `# ${name}
المرحلة: ثانوية عامة (6 فصول)
العام الدراسي: 2025/2026
أيام الدراسة: الأحد إلى الخميس (7 حصص يومياً = 35 حصة لكل فصل)

## الفصول:
- 1/1 ثانوى ، 1/2 ثانوى ، 2/1 علمي ، 2/2 أدبي ، 3/1 علمي ، 3/2 أدبي

## المواد والأنصبة:
- أ. طارق عبد العظيم & أ. عصام رضوان: اللغة العربية (7 حصص لكل فصل)
- أ. خالد النجار: اللغة الإنجليزية (6 حصص لكل فصل)
- أ. ميرفت زكي: اللغة الفرنسية (4 حصص لكل فصل)
- أ. مدحت الشريف: الرياضيات (7 حصص لكل فصل)
- أ. سمير خليل: الفيزياء والكيمياء (5 حصص لكل فصل)
- أ. أشرف البنا: التاريخ والجغرافيا والوطنية (6 حصص لكل فصل)
`;

  return { school, raw_text };
}
