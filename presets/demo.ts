import type { SchoolData, Section, Subject, Teacher, TeachingAssignment } from "../types.ts";

export const DEMO_SCHOOL_RAW_TEXT = `مدرسة النور الإعدادية النموذجية
المرحلة الاعدادي
الاحد للخميس 
الاحد 8 حصص باقي الايام 7 حصص 
الصف الاول 3 فصول 
الثاني فصلين 
الثالث فصلين 
اللغة العربية :
سلمى مراد 
3/1 : 7 
3/2 : 11

هدى كمال 
1/1 : 8 
1/2 : 7 
3/1 : 3

منى سالم 
1/3 : 11
1/1 : 3 
1/2 : 4 

كريم فؤاد 
2/1 : 7
2/2 : 7 
3/1 : 1 

ياسر نبيل (الاربع والخميس)
2/1 : 4  
2/2 : 4 
الانجليزي 
طارق منصور 
1/1 : 5 
1/2 : 5 
3/2 : 6 
التفاصيل "يرجى اعطاءه الحصة الرابعة 3 ايام والحصة الاخيرة يومين"
ماجد الأنصاري 
2/1 : 6
2/2 : 6
3/1 : 6
تفاصيل "الاحد والاثنين والثلاثاء اول حصص واربع وخميس اخر حصص" 
وليد شوقي (الاحد والثلاثاء )
1/3 : 5 
الاحد : الحصص الاولى والثانية 
الثلاثاء : الحصص الاولى والثانية والثالثة 
الدراسات :
سامح توفيق 
2/1 : 4 
2/2 : 4 
3/1 : 4 
3/2 : 4 
التفاصيل "يفضل وضعه اول اربع حصص في ثلاث ايام ويومين اخر حصص"
ندى إبراهيم (الاحد والاثنين والثلاثاء )
1/1 : 4 
1/2 : 4
1/3 : 4 
العلوم :
مريم عادل :
1/1 : 4
1/2 : 4 
1/3 : 4
2/1 : 4 
3/1 : 4
3/2 : 4 
شيماء جلال (الحد والثلاثاء )
2/2 : 4 
التفاصيل "الاحد الحصص الاولى والثانية والثلاثاء السادسة والسابعة"
رياضيات :
إيمان محمود (كل يوم عدا الاحد)
2/1 : 6
3/1 : 6
3/2 : 6
حازم صادق (كل الايام ما عدا الثلاثاء )
1/3 : 6 
2/2 : 6
دعاء سمير (كل الايام عدا الاحد)
1/1 : 6
1/2 : 6
تربية رياضية 
أيمن حمدي (اثنين وخميس)
كل الفصول 
التفاصيل "الاثنين الحصص الاولية و الخميس الحصص الاخيرة" 
مجالات 
شريف زكي (حد واثنين واربعاء)
حصة لكل من 1/1 و 1/2 و 1/3 و 2/1 و 2/2 
وحصتين لكل من 3/1 و 3/2 
تفاصيل "يرجى اعطاءه من الحصص الاولى يومين والحصة الاخيرة يوم الاربع"
حاسب الي 
رامي فريد (حد وثلاثاء وخميس )
حصتين لكل من 1/1 و 1/2 و 1/3 و 2/1 و 2/2 
حصة واحدة لكل من 3/1 و 3/2 
تربية فنيه 
تامر وصفي (اثنين وثلاثاء واربعاء )
حصة لكل فصل 
التفاصيل "الحصة الاولى يوم الاثنين و ثلاث حصص في كل من الثلاثاء والاربعاء"
مكتبة 
وائل رؤوف (الاحد فقط)
1/1 : 1
1/2 : 1
1/3 : 1`;

export function getDemoSchool(): SchoolData {
  const days = [0, 1, 2, 3, 4];
  const dailyLimits = { "0": 8, "1": 7, "2": 7, "3": 7, "4": 7 };
  const grades = [
    { id: "G_1", name: "الصف الأول الإعدادي", code: "G1", order: 1, daily_period_limits: dailyLimits },
    { id: "G_2", name: "الصف الثاني الإعدادي", code: "G2", order: 2, daily_period_limits: dailyLimits },
    { id: "G_3", name: "الصف الثالث الإعدادي", code: "G3", order: 3, daily_period_limits: dailyLimits },
  ];
  const sections: Section[] = [
    { id: "SEC_1_1", name: "1/1", code: "1/1", grade_id: "G_1", daily_period_limits: dailyLimits },
    { id: "SEC_1_2", name: "1/2", code: "1/2", grade_id: "G_1", daily_period_limits: dailyLimits },
    { id: "SEC_1_3", name: "1/3", code: "1/3", grade_id: "G_1", daily_period_limits: dailyLimits },
    { id: "SEC_2_1", name: "2/1", code: "2/1", grade_id: "G_2", daily_period_limits: dailyLimits },
    { id: "SEC_2_2", name: "2/2", code: "2/2", grade_id: "G_2", daily_period_limits: dailyLimits },
    { id: "SEC_3_1", name: "3/1", code: "3/1", grade_id: "G_3", daily_period_limits: dailyLimits },
    { id: "SEC_3_2", name: "3/2", code: "3/2", grade_id: "G_3", daily_period_limits: dailyLimits },
  ];
  const subjects: Subject[] = [
    { id: "SUB_AR", name: "اللغة العربية", code: "عربي", allow_consecutive: true, max_daily_occurrences: 3 },
    { id: "SUB_AR_2", name: "اللغة العربية (2)", code: "عربي 2", allow_consecutive: true, max_daily_occurrences: 2 },
    { id: "SUB_AR_3", name: "اللغة العربية (3)", code: "عربي 3", allow_consecutive: true, max_daily_occurrences: 2 },
    { id: "SUB_EN", name: "اللغة الإنجليزية", code: "إنجليزي", allow_consecutive: true, max_daily_occurrences: 3 },
    { id: "SUB_SOC", name: "الدراسات الاجتماعية", code: "دراسات", allow_consecutive: true, max_daily_occurrences: 2 },
    { id: "SUB_SCI", name: "العلوم", code: "علوم", allow_consecutive: true, max_daily_occurrences: 2 },
    { id: "SUB_MATH", name: "الرياضيات", code: "رياضيات", allow_consecutive: true, max_daily_occurrences: 2 },
    { id: "SUB_PE", name: "التربية الرياضية", code: "ألعاب", allow_consecutive: false, max_daily_occurrences: 1 },
    { id: "SUB_MAJ", name: "مجالات", code: "مجالات", allow_consecutive: false, max_daily_occurrences: 1 },
    { id: "SUB_COMP", name: "حاسب آلي", code: "حاسب", allow_consecutive: true, max_daily_occurrences: 2 },
    { id: "SUB_ART", name: "تربية فنية", code: "رسم", allow_consecutive: false, max_daily_occurrences: 1 },
    { id: "SUB_LIB", name: "مكتبة", code: "مكتبة", allow_consecutive: false, max_daily_occurrences: 1 },
  ];

  const teachers: Teacher[] = [
    {
      id: "TCH_RYA",
      name: "سلمى مراد",
      code: "سلمى",
      force_double_periods: true,
      preferred_last_period: 8,
      work_pattern: {
        day_rules: {},
        daily_period_rules: [],
        placement_rules: [{ day: 0, placement_type: "LAST_N", n_periods: 4, is_hard: false, weight: 10 }],
      },
    },
    {
      id: "TCH_NAGLAA",
      name: "هدى كمال",
      code: "هدى",
      force_double_periods: true,
      preferred_last_period: 8,
      work_pattern: {
        day_rules: {},
        daily_period_rules: [],
        placement_rules: [{ day: 0, placement_type: "LAST_N", n_periods: 4, is_hard: false, weight: 10 }],
      },
    },
    {
      id: "TCH_SAFIA",
      name: "منى سالم",
      code: "منى",
      force_double_periods: true,
      preferred_last_period: 7,
      work_pattern: {
        day_rules: {},
        daily_period_rules: [],
        placement_rules: [{ day: 3, placement_type: "LAST_N", n_periods: 3, is_hard: false, weight: 10 }],
      },
    },
    {
      id: "TCH_LEITHY",
      name: "كريم فؤاد",
      code: "كريم",
      force_double_periods: true,
      preferred_last_period: 8,
      work_pattern: {
        day_rules: {},
        daily_period_rules: [],
        placement_rules: [{ day: 0, placement_type: "LAST_N", n_periods: 3, is_hard: false, weight: 10 }],
      },
    },
    {
      id: "TCH_YOUSSEF",
      name: "ياسر نبيل",
      code: "ياسر",
      preferred_last_period: 7,
      work_pattern: {
        target_working_days: 2,
        day_rules: { "0": "MANDATORY_OFF", "1": "MANDATORY_OFF", "2": "MANDATORY_OFF" },
        daily_period_rules: [
          { day: 3, rule_type: "EXACT", count: 4, is_hard: true, weight: 10 },
          { day: 4, rule_type: "EXACT", count: 4, is_hard: true, weight: 10 },
        ],
        placement_rules: [{ day: 4, placement_type: "LAST_N", n_periods: 4, is_hard: false, weight: 10 }],
      },
    },
    {
      id: "TCH_NASSER",
      name: "طارق منصور",
      code: "طارق",
      force_double_periods: true,
      preferred_last_period: 8,
      work_pattern: {
        day_rules: {},
        daily_period_rules: [],
        placement_rules: [
          { day: null, placement_type: "LAST_N", n_periods: 4, is_hard: true, weight: 10 },
        ],
      },
    },
    {
      id: "TCH_OREINY",
      name: "ماجد الأنصاري",
      code: "ماجد",
      force_double_periods: true,
      work_pattern: {
        day_rules: {},
        daily_period_rules: [],
        placement_rules: [
          { day: 0, placement_type: "FIRST_N", n_periods: 4, is_hard: true, weight: 10 },
          { day: 1, placement_type: "FIRST_N", n_periods: 4, is_hard: true, weight: 10 },
          { day: 2, placement_type: "FIRST_N", n_periods: 4, is_hard: true, weight: 10 },
          { day: 3, placement_type: "LAST_N", n_periods: 4, is_hard: false, weight: 9 },
          { day: 4, placement_type: "LAST_N", n_periods: 4, is_hard: false, weight: 9 },
        ],
      },
    },
    {
      id: "TCH_M_FATHY",
      name: "وليد شوقي",
      code: "وليد",
      work_pattern: {
        target_working_days: 2,
        day_rules: { "1": "MANDATORY_OFF", "3": "MANDATORY_OFF", "4": "MANDATORY_OFF" },
        daily_period_rules: [
          { day: 0, rule_type: "EXACT", count: 2, is_hard: true, weight: 10 },
          { day: 2, rule_type: "EXACT", count: 3, is_hard: true, weight: 10 },
        ],
        placement_rules: [
          { day: 0, placement_type: "FIRST_N", n_periods: 2, is_hard: true, weight: 10 },
          { day: 2, placement_type: "FIRST_N", n_periods: 3, is_hard: true, weight: 10 },
        ],
      },
    },
    {
      id: "TCH_M_RABIE",
      name: "سامح توفيق",
      code: "سامح",
      force_double_periods: true,
      work_pattern: {
        day_rules: {},
        daily_period_rules: [],
        placement_rules: [
          { day: 1, placement_type: "LAST_N", n_periods: 3, is_hard: false, weight: 10 },
        ],
      },
    },
    {
      id: "TCH_SAMAR",
      name: "ندى إبراهيم",
      code: "ندى",
      work_pattern: {
        target_working_days: 3,
        day_rules: { "3": "MANDATORY_OFF", "4": "MANDATORY_OFF" },
        daily_period_rules: [],
        placement_rules: [],
      },
    },
    {
      id: "TCH_RANIA",
      name: "مريم عادل",
      code: "مريم",
      force_double_periods: true,
      work_pattern: {
        day_rules: {},
        daily_period_rules: [],
        placement_rules: [{ day: 0, placement_type: "LAST_N", n_periods: 3, is_hard: false, weight: 10 }],
      },
    },
    {
      id: "TCH_HAGER",
      name: "شيماء جلال",
      code: "شيماء",
      work_pattern: {
        target_working_days: 2,
        day_rules: { "1": "MANDATORY_OFF", "3": "MANDATORY_OFF", "4": "MANDATORY_OFF" },
        daily_period_rules: [
          { day: 0, rule_type: "EXACT", count: 2, is_hard: true, weight: 10 },
          { day: 2, rule_type: "EXACT", count: 2, is_hard: true, weight: 10 },
        ],
        placement_rules: [
          { day: 0, placement_type: "FIRST_N", n_periods: 2, is_hard: true, weight: 10 },
          { day: 2, placement_type: "LAST_N", n_periods: 2, is_hard: true, weight: 10 },
        ],
      },
    },
    {
      id: "TCH_AMAL",
      name: "إيمان محمود",
      code: "إيمان",
      force_double_periods: true,
      work_pattern: {
        day_rules: { "0": "MANDATORY_OFF" },
        daily_period_rules: [],
        placement_rules: [],
      },
    },
    {
      id: "TCH_HOSSAM",
      name: "حازم صادق",
      code: "حازم",
      force_double_periods: true,
      work_pattern: {
        day_rules: { "2": "MANDATORY_OFF" },
        daily_period_rules: [],
        placement_rules: [],
      },
    },
    {
      id: "TCH_LAMIAA",
      name: "دعاء سمير",
      code: "دعاء",
      force_double_periods: true,
      work_pattern: {
        day_rules: { "0": "MANDATORY_OFF" },
        daily_period_rules: [],
        placement_rules: [],
      },
    },
    {
      id: "TCH_M_NAGAH",
      name: "أيمن حمدي",
      code: "أيمن",
      work_pattern: {
        target_working_days: 2,
        day_rules: { "0": "MANDATORY_OFF", "2": "MANDATORY_OFF", "3": "MANDATORY_OFF" },
        daily_period_rules: [],
        placement_rules: [
          { day: 1, placement_type: "FIRST_N", n_periods: 4, is_hard: false, weight: 9 },
          { day: 4, placement_type: "LAST_N", n_periods: 4, is_hard: false, weight: 9 },
        ],
      },
    },
    {
      id: "TCH_ADEL",
      name: "شريف زكي",
      code: "شريف",
      work_pattern: {
        target_working_days: 3,
        day_rules: { "2": "MANDATORY_OFF", "4": "MANDATORY_OFF" },
        daily_period_rules: [],
        placement_rules: [
          { day: 0, placement_type: "FIRST_N", n_periods: 4, is_hard: false, weight: 9 },
          { day: 1, placement_type: "FIRST_N", n_periods: 4, is_hard: false, weight: 9 },
          { day: 3, placement_type: "LAST_N", n_periods: 3, is_hard: false, weight: 10 },
        ],
      },
    },
    {
      id: "TCH_AMR",
      name: "رامي فريد",
      code: "رامي",
      work_pattern: {
        target_working_days: 3,
        day_rules: { "1": "MANDATORY_OFF", "3": "MANDATORY_OFF" },
        daily_period_rules: [],
        placement_rules: [],
      },
    },
    {
      id: "TCH_A_RABIE",
      name: "تامر وصفي",
      code: "تامر",
      work_pattern: {
        target_working_days: 3,
        day_rules: { "0": "MANDATORY_OFF", "4": "MANDATORY_OFF" },
        daily_period_rules: [
          { day: 1, rule_type: "EXACT", count: 1, is_hard: true, weight: 10 },
          { day: 2, rule_type: "EXACT", count: 3, is_hard: true, weight: 10 },
          { day: 3, rule_type: "EXACT", count: 3, is_hard: true, weight: 10 },
        ],
        placement_rules: [
          { day: 1, placement_type: "FIRST_N", n_periods: 1, is_hard: false, weight: 10 },
          { day: 3, placement_type: "LAST_N", n_periods: 3, is_hard: false, weight: 10 },
        ],
      },
    },
    {
      id: "TCH_OSSAMA",
      name: "وائل رؤوف",
      code: "وائل",
      work_pattern: {
        target_working_days: 1,
        day_rules: { "1": "MANDATORY_OFF", "2": "MANDATORY_OFF", "3": "MANDATORY_OFF", "4": "MANDATORY_OFF" },
        daily_period_rules: [{ day: 0, rule_type: "EXACT", count: 3, is_hard: true, weight: 10 }],
        placement_rules: [],
      },
    },
  ];

  const assignments: TeachingAssignment[] = [
    // 1/1
    { id: "ASG_1_1_AR1", section_id: "SEC_1_1", subject_id: "SUB_AR", teacher_id: "TCH_NAGLAA", weekly_periods: 8 },
    { id: "ASG_1_1_AR2", section_id: "SEC_1_1", subject_id: "SUB_AR_2", teacher_id: "TCH_SAFIA", weekly_periods: 3 },
    { id: "ASG_1_1_EN", section_id: "SEC_1_1", subject_id: "SUB_EN", teacher_id: "TCH_NASSER", weekly_periods: 5 },
    { id: "ASG_1_1_SOC", section_id: "SEC_1_1", subject_id: "SUB_SOC", teacher_id: "TCH_SAMAR", weekly_periods: 4 },
    { id: "ASG_1_1_SCI", section_id: "SEC_1_1", subject_id: "SUB_SCI", teacher_id: "TCH_RANIA", weekly_periods: 4 },
    { id: "ASG_1_1_MATH", section_id: "SEC_1_1", subject_id: "SUB_MATH", teacher_id: "TCH_LAMIAA", weekly_periods: 6 },
    { id: "ASG_1_1_MAJ", section_id: "SEC_1_1", subject_id: "SUB_MAJ", teacher_id: "TCH_ADEL", weekly_periods: 1 },
    { id: "ASG_1_1_COMP", section_id: "SEC_1_1", subject_id: "SUB_COMP", teacher_id: "TCH_AMR", weekly_periods: 2 },
    { id: "ASG_1_1_ART", section_id: "SEC_1_1", subject_id: "SUB_ART", teacher_id: "TCH_A_RABIE", weekly_periods: 1 },
    { id: "ASG_1_1_LIB", section_id: "SEC_1_1", subject_id: "SUB_LIB", teacher_id: "TCH_OSSAMA", weekly_periods: 1 },
    { id: "ASG_1_1_PE", section_id: "SEC_1_1", subject_id: "SUB_PE", teacher_id: "TCH_M_NAGAH", weekly_periods: 1 },

    // 1/2
    { id: "ASG_1_2_AR1", section_id: "SEC_1_2", subject_id: "SUB_AR", teacher_id: "TCH_NAGLAA", weekly_periods: 7 },
    { id: "ASG_1_2_AR2", section_id: "SEC_1_2", subject_id: "SUB_AR_2", teacher_id: "TCH_SAFIA", weekly_periods: 4 },
    { id: "ASG_1_2_EN", section_id: "SEC_1_2", subject_id: "SUB_EN", teacher_id: "TCH_NASSER", weekly_periods: 5 },
    { id: "ASG_1_2_SOC", section_id: "SEC_1_2", subject_id: "SUB_SOC", teacher_id: "TCH_SAMAR", weekly_periods: 4 },
    { id: "ASG_1_2_SCI", section_id: "SEC_1_2", subject_id: "SUB_SCI", teacher_id: "TCH_RANIA", weekly_periods: 4 },
    { id: "ASG_1_2_MATH", section_id: "SEC_1_2", subject_id: "SUB_MATH", teacher_id: "TCH_LAMIAA", weekly_periods: 6 },
    { id: "ASG_1_2_MAJ", section_id: "SEC_1_2", subject_id: "SUB_MAJ", teacher_id: "TCH_ADEL", weekly_periods: 1 },
    { id: "ASG_1_2_COMP", section_id: "SEC_1_2", subject_id: "SUB_COMP", teacher_id: "TCH_AMR", weekly_periods: 2 },
    { id: "ASG_1_2_ART", section_id: "SEC_1_2", subject_id: "SUB_ART", teacher_id: "TCH_A_RABIE", weekly_periods: 1 },
    { id: "ASG_1_2_LIB", section_id: "SEC_1_2", subject_id: "SUB_LIB", teacher_id: "TCH_OSSAMA", weekly_periods: 1 },
    { id: "ASG_1_2_PE", section_id: "SEC_1_2", subject_id: "SUB_PE", teacher_id: "TCH_M_NAGAH", weekly_periods: 1 },

    // 1/3
    { id: "ASG_1_3_AR", section_id: "SEC_1_3", subject_id: "SUB_AR", teacher_id: "TCH_SAFIA", weekly_periods: 11 },
    { id: "ASG_1_3_EN", section_id: "SEC_1_3", subject_id: "SUB_EN", teacher_id: "TCH_M_FATHY", weekly_periods: 5 },
    { id: "ASG_1_3_SOC", section_id: "SEC_1_3", subject_id: "SUB_SOC", teacher_id: "TCH_SAMAR", weekly_periods: 4 },
    { id: "ASG_1_3_SCI", section_id: "SEC_1_3", subject_id: "SUB_SCI", teacher_id: "TCH_RANIA", weekly_periods: 4 },
    { id: "ASG_1_3_MATH", section_id: "SEC_1_3", subject_id: "SUB_MATH", teacher_id: "TCH_HOSSAM", weekly_periods: 6 },
    { id: "ASG_1_3_MAJ", section_id: "SEC_1_3", subject_id: "SUB_MAJ", teacher_id: "TCH_ADEL", weekly_periods: 1 },
    { id: "ASG_1_3_COMP", section_id: "SEC_1_3", subject_id: "SUB_COMP", teacher_id: "TCH_AMR", weekly_periods: 2 },
    { id: "ASG_1_3_ART", section_id: "SEC_1_3", subject_id: "SUB_ART", teacher_id: "TCH_A_RABIE", weekly_periods: 1 },
    { id: "ASG_1_3_LIB", section_id: "SEC_1_3", subject_id: "SUB_LIB", teacher_id: "TCH_OSSAMA", weekly_periods: 1 },
    { id: "ASG_1_3_PE", section_id: "SEC_1_3", subject_id: "SUB_PE", teacher_id: "TCH_M_NAGAH", weekly_periods: 1 },

    // 2/1
    { id: "ASG_2_1_AR1", section_id: "SEC_2_1", subject_id: "SUB_AR", teacher_id: "TCH_LEITHY", weekly_periods: 7 },
    { id: "ASG_2_1_AR2", section_id: "SEC_2_1", subject_id: "SUB_AR_2", teacher_id: "TCH_YOUSSEF", weekly_periods: 4 },
    { id: "ASG_2_1_EN", section_id: "SEC_2_1", subject_id: "SUB_EN", teacher_id: "TCH_OREINY", weekly_periods: 6 },
    { id: "ASG_2_1_SOC", section_id: "SEC_2_1", subject_id: "SUB_SOC", teacher_id: "TCH_M_RABIE", weekly_periods: 4 },
    { id: "ASG_2_1_SCI", section_id: "SEC_2_1", subject_id: "SUB_SCI", teacher_id: "TCH_RANIA", weekly_periods: 4 },
    { id: "ASG_2_1_MATH", section_id: "SEC_2_1", subject_id: "SUB_MATH", teacher_id: "TCH_AMAL", weekly_periods: 6 },
    { id: "ASG_2_1_MAJ", section_id: "SEC_2_1", subject_id: "SUB_MAJ", teacher_id: "TCH_ADEL", weekly_periods: 1 },
    { id: "ASG_2_1_COMP", section_id: "SEC_2_1", subject_id: "SUB_COMP", teacher_id: "TCH_AMR", weekly_periods: 2 },
    { id: "ASG_2_1_ART", section_id: "SEC_2_1", subject_id: "SUB_ART", teacher_id: "TCH_A_RABIE", weekly_periods: 1 },
    { id: "ASG_2_1_PE", section_id: "SEC_2_1", subject_id: "SUB_PE", teacher_id: "TCH_M_NAGAH", weekly_periods: 1 },

    // 2/2
    { id: "ASG_2_2_AR1", section_id: "SEC_2_2", subject_id: "SUB_AR", teacher_id: "TCH_LEITHY", weekly_periods: 7 },
    { id: "ASG_2_2_AR2", section_id: "SEC_2_2", subject_id: "SUB_AR_2", teacher_id: "TCH_YOUSSEF", weekly_periods: 4 },
    { id: "ASG_2_2_EN", section_id: "SEC_2_2", subject_id: "SUB_EN", teacher_id: "TCH_OREINY", weekly_periods: 6 },
    { id: "ASG_2_2_SOC", section_id: "SEC_2_2", subject_id: "SUB_SOC", teacher_id: "TCH_M_RABIE", weekly_periods: 4 },
    { id: "ASG_2_2_SCI", section_id: "SEC_2_2", subject_id: "SUB_SCI", teacher_id: "TCH_HAGER", weekly_periods: 4 },
    { id: "ASG_2_2_MATH", section_id: "SEC_2_2", subject_id: "SUB_MATH", teacher_id: "TCH_HOSSAM", weekly_periods: 6 },
    { id: "ASG_2_2_MAJ", section_id: "SEC_2_2", subject_id: "SUB_MAJ", teacher_id: "TCH_ADEL", weekly_periods: 1 },
    { id: "ASG_2_2_COMP", section_id: "SEC_2_2", subject_id: "SUB_COMP", teacher_id: "TCH_AMR", weekly_periods: 2 },
    { id: "ASG_2_2_ART", section_id: "SEC_2_2", subject_id: "SUB_ART", teacher_id: "TCH_A_RABIE", weekly_periods: 1 },
    { id: "ASG_2_2_PE", section_id: "SEC_2_2", subject_id: "SUB_PE", teacher_id: "TCH_M_NAGAH", weekly_periods: 1 },

    // 3/1
    { id: "ASG_3_1_AR1", section_id: "SEC_3_1", subject_id: "SUB_AR", teacher_id: "TCH_RYA", weekly_periods: 7 },
    { id: "ASG_3_1_AR2", section_id: "SEC_3_1", subject_id: "SUB_AR_2", teacher_id: "TCH_NAGLAA", weekly_periods: 3 },
    { id: "ASG_3_1_AR3", section_id: "SEC_3_1", subject_id: "SUB_AR_3", teacher_id: "TCH_LEITHY", weekly_periods: 1 },
    { id: "ASG_3_1_EN", section_id: "SEC_3_1", subject_id: "SUB_EN", teacher_id: "TCH_OREINY", weekly_periods: 6 },
    { id: "ASG_3_1_SOC", section_id: "SEC_3_1", subject_id: "SUB_SOC", teacher_id: "TCH_M_RABIE", weekly_periods: 4 },
    { id: "ASG_3_1_SCI", section_id: "SEC_3_1", subject_id: "SUB_SCI", teacher_id: "TCH_RANIA", weekly_periods: 4 },
    { id: "ASG_3_1_MATH", section_id: "SEC_3_1", subject_id: "SUB_MATH", teacher_id: "TCH_AMAL", weekly_periods: 6 },
    { id: "ASG_3_1_MAJ", section_id: "SEC_3_1", subject_id: "SUB_MAJ", teacher_id: "TCH_ADEL", weekly_periods: 2 },
    { id: "ASG_3_1_COMP", section_id: "SEC_3_1", subject_id: "SUB_COMP", teacher_id: "TCH_AMR", weekly_periods: 1 },
    { id: "ASG_3_1_ART", section_id: "SEC_3_1", subject_id: "SUB_ART", teacher_id: "TCH_A_RABIE", weekly_periods: 1 },
    { id: "ASG_3_1_PE", section_id: "SEC_3_1", subject_id: "SUB_PE", teacher_id: "TCH_M_NAGAH", weekly_periods: 1 },

    // 3/2
    { id: "ASG_3_2_AR", section_id: "SEC_3_2", subject_id: "SUB_AR", teacher_id: "TCH_RYA", weekly_periods: 11 },
    { id: "ASG_3_2_EN", section_id: "SEC_3_2", subject_id: "SUB_EN", teacher_id: "TCH_NASSER", weekly_periods: 6 },
    { id: "ASG_3_2_SOC", section_id: "SEC_3_2", subject_id: "SUB_SOC", teacher_id: "TCH_M_RABIE", weekly_periods: 4 },
    { id: "ASG_3_2_SCI", section_id: "SEC_3_2", subject_id: "SUB_SCI", teacher_id: "TCH_RANIA", weekly_periods: 4 },
    { id: "ASG_3_2_MATH", section_id: "SEC_3_2", subject_id: "SUB_MATH", teacher_id: "TCH_AMAL", weekly_periods: 6 },
    { id: "ASG_3_2_MAJ", section_id: "SEC_3_2", subject_id: "SUB_MAJ", teacher_id: "TCH_ADEL", weekly_periods: 2 },
    { id: "ASG_3_2_COMP", section_id: "SEC_3_2", subject_id: "SUB_COMP", teacher_id: "TCH_AMR", weekly_periods: 1 },
    { id: "ASG_3_2_ART", section_id: "SEC_3_2", subject_id: "SUB_ART", teacher_id: "TCH_A_RABIE", weekly_periods: 1 },
    { id: "ASG_3_2_PE", section_id: "SEC_3_2", subject_id: "SUB_PE", teacher_id: "TCH_M_NAGAH", weekly_periods: 1 },
  ];

  const availabilities = [];
  for (const t of teachers) {
    for (const d of [1, 2, 3, 4]) {
      availabilities.push({ teacher_id: t.id, day: d, period: 8, is_available: false });
    }
  }

  return {
    id: "SCH_DEMO",
    name: "مدرسة النور الإعدادية النموذجية",
    academic_year: "2025/2026",
    shift_mode: "SINGLE",
    days,
    periods_per_day: 8,
    grades,
    sections,
    subjects,
    teachers,
    availabilities,
    assignments,
  };
}

