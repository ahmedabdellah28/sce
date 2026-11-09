import React, { useState, useMemo, useEffect, useCallback } from "react";
import type { SchoolData, Grade, Section, Subject, Teacher, TeachingAssignment } from "../types.js";
import { ALL_SCHOOL_PRESETS, getPresetById, createSchoolFromPreset, type SchoolPreset } from "../presets/commonPresets.js";
import { generateSchoolMarkdown, validateSchoolCapacity } from "../services/schoolCore.js";
import { InBrowserSchoolEngine } from "../services/localEngine.js";

export interface SchoolWizardStepperProps {
  initialSchool: SchoolData | null;
  onSaveSchool: (updatedSchool: SchoolData, updatedMarkdown: string) => void;
  onSolveAndOpenTimetable: (schoolToSolve: SchoolData) => void;
  onCancel?: () => void;
}

export type WizardStepId = 1 | 2 | 3 | 4 | 5 | 6;

interface StepInfo {
  id: WizardStepId;
  title: string;
  shortDesc: string;
  icon: string;
}

const WIZARD_STEPS: StepInfo[] = [
  { id: 1, title: "المرحلة والنظام", shortDesc: "المرحلة، الفترات، والنموذج", icon: "🏫" },
  { id: 2, title: "المواد الدراسية", shortDesc: "المواد، الأنصبة، والقواعد", icon: "📚" },
  { id: 3, title: "الفصول والشعب", shortDesc: "المولّد الشبكي للفصول", icon: "👥" },
  { id: 4, title: "هيئة التدريس", shortDesc: "المعلمون ولصق الأسماء", icon: "👨‍🏫" },
  { id: 5, title: "مصفوفة الإسناد", shortDesc: "إسناد المواد للمعلمين", icon: "🧩" },
  { id: 6, title: "التوليد والتحقق", shortDesc: "فحص الجدوى وبناء الجدول", icon: "✨" },
];

export default function SchoolWizardStepper({
  initialSchool,
  onSaveSchool,
  onSolveAndOpenTimetable,
  onCancel,
}: SchoolWizardStepperProps) {
  // Current active step (1 to 6)
  const [currentStep, setCurrentStep] = useState<WizardStepId>(1);

  // Initialize working school data
  const [school, setSchool] = useState<SchoolData>(() => {
    if (initialSchool) return JSON.parse(JSON.stringify(initialSchool));
    // Default fallback to first common preset
    return createSchoolFromPreset(ALL_SCHOOL_PRESETS[0].id, {
      schoolName: "مدرسة المستقبل للتعليم الأساسي",
      sectionsPerGrade: 1,
    });
  });

  // Track auto-save time
  const [lastSavedTime, setLastSavedTime] = useState<string>(() =>
    new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  );

  // Preset category filter for Step 1
  const [presetCategoryFilter, setPresetCategoryFilter] = useState<"ALL" | "GOVERNMENT_GENERAL" | "EXPERIMENTAL_LANGUAGE">("ALL");

  // Multi-line paste input for Step 4 (Teachers)
  const [bulkTeachersText, setBulkTeachersText] = useState("");
  const [showBulkTeacherModal, setShowBulkTeacherModal] = useState(false);

  // Quick section count per grade state for Step 3 (Sections Generator)
  const [sectionsCountByGrade, setSectionsCountByGrade] = useState<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const g of school.grades) {
      counts[g.id] = school.sections.filter((s) => s.grade_id === g.id).length || 1;
    }
    return counts;
  });

  // Capacity validation calculation
  const capacityValidation = useMemo(() => {
    return validateSchoolCapacity(school);
  }, [school]);

  // Feasibility analysis calculation
  const analysisReport = useMemo(() => {
    return InBrowserSchoolEngine.analyzeSchool(school);
  }, [school]);

  // Auto-save debounced effect
  const triggerAutoSave = useCallback((updatedSchool: SchoolData) => {
    const md = generateSchoolMarkdown(updatedSchool);
    onSaveSchool(updatedSchool, md);
    setLastSavedTime(
      new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    );
  }, [onSaveSchool]);

  const updateSchool = useCallback((updater: (prev: SchoolData) => SchoolData) => {
    setSchool((prev) => {
      const next = updater(prev);
      triggerAutoSave(next);
      return next;
    });
  }, [triggerAutoSave]);

  // ---------------------------------------------------------------------------
  // STEP 1 HANDLERS: Stage, Preset & System
  // ---------------------------------------------------------------------------
  const handleApplyPreset = (preset: SchoolPreset) => {
    const newSchool = createSchoolFromPreset(preset.id, {
      schoolName: school.name || preset.label,
      sectionsPerGrade: 1,
    });
    setSchool(newSchool);
    // Update grade section counters
    const counts: Record<string, number> = {};
    for (const g of newSchool.grades) counts[g.id] = 1;
    setSectionsCountByGrade(counts);
    triggerAutoSave(newSchool);
  };

  // ---------------------------------------------------------------------------
  // STEP 2 HANDLERS: Subjects & Quotas
  // ---------------------------------------------------------------------------
  const handleToggleSubject = (subjectId: string, enabled: boolean) => {
    updateSchool((prev) => {
      if (!enabled) {
        // Remove assignments for this subject
        return {
          ...prev,
          subjects: prev.subjects.filter((s) => s.id !== subjectId),
          assignments: prev.assignments.filter((a) => a.subject_id !== subjectId),
        };
      }
      return prev;
    });
  };

  const handleUpdateSubjectName = (subjectId: string, newName: string) => {
    updateSchool((prev) => ({
      ...prev,
      subjects: prev.subjects.map((s) => (s.id === subjectId ? { ...s, name: newName } : s)),
    }));
  };

  const handleUpdateSubjectCode = (subjectId: string, newCode: string) => {
    updateSchool((prev) => ({
      ...prev,
      subjects: prev.subjects.map((s) => (s.id === subjectId ? { ...s, code: newCode } : s)),
    }));
  };

  const handleUpdateSubjectRules = (
    subjectId: string,
    rules: { before_break?: boolean; double_period_policy?: "FREE" | "DOUBLE_REQUIRED" | "SINGLE_ONLY" }
  ) => {
    updateSchool((prev) => ({
      ...prev,
      subjects: prev.subjects.map((s) => (s.id === subjectId ? { ...s, ...rules } : s)),
    }));
  };

  const handleAddCustomSubject = () => {
    const newId = `subj_${Date.now().toString(36)}`;
    const newSubject: Subject = {
      id: newId,
      name: "مادة جديدة",
      code: "جديد",
      double_period_policy: "FREE",
      before_break: false,
    };
    updateSchool((prev) => ({
      ...prev,
      subjects: [...prev.subjects, newSubject],
    }));
  };

  // ---------------------------------------------------------------------------
  // STEP 3 HANDLERS: Sections Grid Generator
  // ---------------------------------------------------------------------------
  const handleRegenerateSectionsGrid = () => {
    updateSchool((prev) => {
      const nextSections: Section[] = [];
      const isTwoShifts = prev.shift_mode === "TWO_SHIFTS";

      prev.grades.forEach((g, gIdx) => {
        const count = Math.max(1, sectionsCountByGrade[g.id] || 1);
        // In two-shift systems, grades 1-3 morning (FIRST), 4-6 evening (SECOND)
        const shift: "FIRST" | "SECOND" = isTwoShifts && gIdx >= 3 ? "SECOND" : "FIRST";

        for (let i = 1; i <= count; i++) {
          const secCode = `${g.order || gIdx + 1}/${i}`;
          const secName = `${g.name} (${i})`;
          nextSections.push({
            id: `sec_${g.id}_${i}`,
            grade_id: g.id,
            name: secName,
            code: secCode,
            shift,
          });
        }
      });

      // Synchronize assignments for newly generated sections
      const nextAssignments: TeachingAssignment[] = [];
      for (const sec of nextSections) {
        // Carry over existing assignments or create template assignments from subjects
        for (const subj of prev.subjects) {
          const existing = prev.assignments.find(
            (a) => a.section_id === sec.id && a.subject_id === subj.id
          );
          if (existing) {
            nextAssignments.push(existing);
          } else {
            // Find default periods for this subject from other sections in same grade
            const siblingAsgn = prev.assignments.find(
              (a) =>
                a.subject_id === subj.id &&
                prev.sections.find((s) => s.id === a.section_id)?.grade_id === sec.grade_id
            );
            const periods = siblingAsgn?.weekly_periods || 4;
            const teacherId = siblingAsgn?.teacher_id || prev.teachers[0]?.id || "tch_1";

            nextAssignments.push({
              id: `asgn_${sec.id}_${subj.id}`,
              section_id: sec.id,
              subject_id: subj.id,
              teacher_id: teacherId,
              weekly_periods: periods,
            });
          }
        }
      }

      return {
        ...prev,
        sections: nextSections,
        assignments: nextAssignments,
      };
    });
  };

  // ---------------------------------------------------------------------------
  // STEP 4 HANDLERS: Teachers & Bulk Paste
  // ---------------------------------------------------------------------------
  const handleAddSingleTeacher = () => {
    const newIdx = school.teachers.length + 1;
    const newTeacher: Teacher = {
      id: `tch_${Date.now().toString(36)}`,
      name: `معلم ${newIdx}`,
      code: `م-${newIdx}`,
      max_daily_periods: 7,
      max_weekly_periods: 24,
      max_consecutive_periods: 2,
    };
    updateSchool((prev) => ({
      ...prev,
      teachers: [...prev.teachers, newTeacher],
    }));
  };

  const handleUpdateTeacher = (teacherId: string, fields: Partial<Teacher>) => {
    updateSchool((prev) => ({
      ...prev,
      teachers: prev.teachers.map((t) => (t.id === teacherId ? { ...t, ...fields } : t)),
    }));
  };

  const handleDeleteTeacher = (teacherId: string) => {
    updateSchool((prev) => ({
      ...prev,
      teachers: prev.teachers.filter((t) => t.id !== teacherId),
      assignments: prev.assignments.filter((a) => a.teacher_id !== teacherId),
    }));
  };

  const handleBulkAddTeachers = () => {
    const lines = bulkTeachersText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return;

    updateSchool((prev) => {
      const existingNames = new Set(prev.teachers.map((t) => t.name.trim()));
      const addedTeachers: Teacher[] = [];

      lines.forEach((name, idx) => {
        if (!existingNames.has(name)) {
          const tId = `tch_${Date.now().toString(36)}_${idx}`;
          const code = name.length <= 4 ? name : name.slice(0, 3);
          addedTeachers.push({
            id: tId,
            name,
            code,
            max_daily_periods: 7,
            max_weekly_periods: 24,
            max_consecutive_periods: 2,
          });
          existingNames.add(name);
        }
      });

      return {
        ...prev,
        teachers: [...prev.teachers, ...addedTeachers],
      };
    });

    setBulkTeachersText("");
    setShowBulkTeacherModal(false);
  };

  // ---------------------------------------------------------------------------
  // STEP 5 HANDLERS: Assignment Matrix
  // ---------------------------------------------------------------------------
  const handleAssignTeacher = (sectionId: string, subjectId: string, teacherId: string) => {
    updateSchool((prev) => {
      const existingIdx = prev.assignments.findIndex(
        (a) => a.section_id === sectionId && a.subject_id === subjectId
      );
      if (existingIdx >= 0) {
        const nextAsgns = [...prev.assignments];
        nextAsgns[existingIdx] = { ...nextAsgns[existingIdx], teacher_id: teacherId };
        return { ...prev, assignments: nextAsgns };
      } else {
        const newAsgn: TeachingAssignment = {
          id: `asgn_${sectionId}_${subjectId}`,
          section_id: sectionId,
          subject_id: subjectId,
          teacher_id: teacherId,
          weekly_periods: 4, // Default fallback
        };
        return { ...prev, assignments: [...prev.assignments, newAsgn] };
      }
    });
  };

  const handleUpdateAssignmentPeriods = (sectionId: string, subjectId: string, periods: number) => {
    updateSchool((prev) => {
      const existingIdx = prev.assignments.findIndex(
        (a) => a.section_id === sectionId && a.subject_id === subjectId
      );
      if (existingIdx >= 0) {
        const nextAsgns = [...prev.assignments];
        nextAsgns[existingIdx] = { ...nextAsgns[existingIdx], weekly_periods: periods };
        return { ...prev, assignments: nextAsgns };
      }
      return prev;
    });
  };

  const handleAutoBalanceTeachers = () => {
    if (school.teachers.length === 0) return;

    updateSchool((prev) => {
      const teacherWorkload: Record<string, number> = {};
      prev.teachers.forEach((t) => (teacherWorkload[t.id] = 0));

      // 1. Group teachers by subject affinity (checking name or code)
      const getTeachersForSubject = (subj: Subject): Teacher[] => {
        const sName = subj.name.toLowerCase();
        const sCode = subj.code.toLowerCase();
        const matching = prev.teachers.filter((t) => {
          const tName = t.name.toLowerCase();
          const tCode = t.code.toLowerCase();
          return (
            tName.includes(sName) ||
            tName.includes(sCode) ||
            sName.includes(tName) ||
            (sCode.length >= 2 && tCode.includes(sCode))
          );
        });
        return matching.length > 0 ? matching : prev.teachers;
      };

      const updatedAsgns = prev.assignments.map((asgn) => {
        const subj = prev.subjects.find((s) => s.id === asgn.subject_id);
        const candidates = subj ? getTeachersForSubject(subj) : prev.teachers;

        // Pick candidate with minimum current load who hasn't exceeded weekly max
        let bestTeacherId = candidates[0].id;
        let minLoad = Infinity;

        for (const t of candidates) {
          const load = teacherWorkload[t.id] || 0;
          const maxWeekly = t.max_weekly_periods || 24;
          // Prefer teachers below their max weekly quota
          const effectiveLoad = load >= maxWeekly ? load + 100 : load;
          if (effectiveLoad < minLoad) {
            minLoad = effectiveLoad;
            bestTeacherId = t.id;
          }
        }

        teacherWorkload[bestTeacherId] = (teacherWorkload[bestTeacherId] || 0) + asgn.weekly_periods;
        return { ...asgn, teacher_id: bestTeacherId };
      });

      return { ...prev, assignments: updatedAsgns };
    });
  };

  const handleGenerateSpecialistTeachers = () => {
    updateSchool((prev) => {
      // Create dedicated specialist teachers for each subject based on sections count
      const newTeachers: Teacher[] = [];
      const newAssignments: TeachingAssignment[] = [];
      let teacherIndex = 1;

      // Group assignments by subject
      prev.subjects.forEach((subj) => {
        const subjAsgns = prev.assignments.filter((a) => a.subject_id === subj.id);
        const totalPeriods = subjAsgns.reduce((sum, a) => sum + a.weekly_periods, 0);

        // Workload calculation: for subjects with before_break or strict constraints, limit to at most 10 periods
        const maxCapacityPerTeacher = subj.before_break ? 10 : 20;
        const neededTeachers = Math.max(1, Math.ceil(totalPeriods / maxCapacityPerTeacher));
        const subjTeachers: Teacher[] = [];

        for (let i = 1; i <= neededTeachers; i++) {
          const tId = `tch_${subj.id}_${i}`;
          const tName = neededTeachers === 1 ? `معلم ${subj.name}` : `معلم ${subj.name} (${i})`;
          const teacherObj: Teacher = {
            id: tId,
            name: tName,
            code: `م-${subj.code}${i}`,
            max_daily_periods: 7,
            max_weekly_periods: 24,
            max_consecutive_periods: 2,
          };
          newTeachers.push(teacherObj);
          subjTeachers.push(teacherObj);
          teacherIndex++;
        }

        // Assign sections evenly among this subject's specialist teachers
        subjAsgns.forEach((asgn, aIdx) => {
          const assignedTeacher = subjTeachers[aIdx % subjTeachers.length];
          newAssignments.push({
            ...asgn,
            teacher_id: assignedTeacher.id,
          });
        });
      });

      return {
        ...prev,
        teachers: newTeachers,
        assignments: newAssignments,
      };
    });
  };

  // ---------------------------------------------------------------------------
  // STEP 6: Final Solve & Transition
  // ---------------------------------------------------------------------------
  const handleFinalSolve = () => {
    onSolveAndOpenTimetable(school);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      {/* ------------------------------------------------------------------- */}
      {/* HEADER: Title, Stepper Tabs & Auto-Save Indicator                    */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-slate-900 text-white p-4 border-b border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🧙‍♂️</span>
            <div>
              <h1 className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2">
                معالج إعداد وتعديل المدرسة (6 خطوات)
                <span className="text-[10px] bg-blue-600/60 text-blue-200 border border-blue-400/30 px-2 py-0.5 rounded-full font-bold">
                  قابلة للتنقل في أي وقت
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                تعديل المرحلة، المواد، الفصول، المعلمين، الإسناد، والتحقق الرياضي التام
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-700/50 px-2.5 py-1 rounded-lg">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>تم الحفظ تلقائياً: {lastSavedTime}</span>
            </div>

            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-1 rounded-lg text-xs font-bold transition"
              >
                إغلاق المعالج ✕
              </button>
            )}
          </div>
        </div>

        {/* Stepper Navigation Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
          {WIZARD_STEPS.map((step) => {
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;

            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setCurrentStep(step.id)}
                className={`py-2 px-2.5 rounded-xl text-start transition flex items-center gap-2 border ${
                  isActive
                    ? "bg-blue-600 border-blue-400 text-white shadow-sm ring-1 ring-blue-300/40"
                    : isCompleted
                    ? "bg-slate-800/90 border-slate-700 text-slate-300 hover:bg-slate-700/80"
                    : "bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800/40"
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                    isActive
                      ? "bg-white text-blue-700"
                      : isCompleted
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {isCompleted ? "✓" : step.id}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-black truncate">{step.title}</div>
                  <div className="text-[10px] text-slate-400 truncate opacity-80">{step.shortDesc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* BODY: Active Step Content                                           */}
      {/* ------------------------------------------------------------------- */}
      <div className="p-5 flex-1 min-h-[420px] bg-slate-50/50">
        {/* ================================================================= */}
        {/* STEP 1: Stage, System & Presets                                   */}
        {/* ================================================================= */}
        {currentStep === 1 && (
          <div className="space-y-5">
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
              <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <span>🏫</span>
                بيانات المدرسة الأساسية
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-extrabold text-slate-700 block mb-1">اسم المدرسة:</label>
                  <input
                    type="text"
                    value={school.name}
                    onChange={(e) => updateSchool((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="مثال: مدرسة المستقبل الابتدائية"
                  />
                </div>
                <div>
                  <label className="text-xs font-extrabold text-slate-700 block mb-1">العام الدراسي:</label>
                  <input
                    type="text"
                    value={school.academic_year}
                    onChange={(e) => updateSchool((prev) => ({ ...prev, academic_year: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="2026/2027"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="text-xs font-extrabold text-slate-700 block mb-1">نظام الفترات:</label>
                  <select
                    value={school.shift_mode || "SINGLE"}
                    onChange={(e) =>
                      updateSchool((prev) => ({
                        ...prev,
                        shift_mode: e.target.value as "SINGLE" | "TWO_SHIFTS",
                      }))
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="SINGLE">فترة واحدة (كاملة - 35 حصة أسبوعياً)</option>
                    <option value="TWO_SHIFTS">فترتان (صباحي 29 حصة / مسائي 36 حصة)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-extrabold text-slate-700 block mb-1">عدد الحصص اليومية الافتراضي:</label>
                  <input
                    type="number"
                    min={5}
                    max={8}
                    value={school.periods_per_day}
                    onChange={(e) =>
                      updateSchool((prev) => ({ ...prev, periods_per_day: Number(e.target.value) || 7 }))
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Presets Catalog */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                    <span>📚</span>
                    بدء من نموذج قياسي (قيم شائعة قابلة للتعديل)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    اختر نموذجاً لاستيراد المواد والأنصبة والصفوف الرياضية المتوازنة فوراً دون لمس بياناتك
                  </p>
                </div>

                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setPresetCategoryFilter("ALL")}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                      presetCategoryFilter === "ALL" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    الكل ({ALL_SCHOOL_PRESETS.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresetCategoryFilter("GOVERNMENT_GENERAL")}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                      presetCategoryFilter === "GOVERNMENT_GENERAL"
                        ? "bg-blue-600 text-white shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    حكومي عام
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresetCategoryFilter("EXPERIMENTAL_LANGUAGE")}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                      presetCategoryFilter === "EXPERIMENTAL_LANGUAGE"
                        ? "bg-emerald-600 text-white shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    تجريبي لغات
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                {ALL_SCHOOL_PRESETS.filter(
                  (p) => presetCategoryFilter === "ALL" || p.school_type === presetCategoryFilter
                ).map((preset) => (
                  <div
                    key={preset.id}
                    className="p-3 rounded-xl border border-slate-200 hover:border-blue-400 bg-slate-50/50 hover:bg-blue-50/30 transition flex flex-col justify-between text-start"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-extrabold text-slate-900">{preset.name}</span>
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full shrink-0 ${
                            preset.school_type === "GOVERNMENT_GENERAL"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {preset.school_type === "GOVERNMENT_GENERAL" ? "حكومي عام" : "تجريبي لغات"}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-2">
                        {preset.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-200/60">
                      <span className="text-[10px] font-bold text-slate-500">
                        {preset.grades.length} صفوف • {preset.shifts[0]?.weekly_capacity || 35} حصة
                      </span>
                      <button
                        type="button"
                        onClick={() => handleApplyPreset(preset)}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-extrabold px-3 py-1 rounded-lg transition shadow-2xs"
                      >
                        تطبيق هذا النموذج ↶
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* STEP 2: Subjects & Quotas                                         */}
        {/* ================================================================= */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3.5 rounded-xl border border-slate-200">
              <div>
                <h2 className="text-xs sm:text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <span>📚</span>
                  إدارة المواد الدراسية والقواعد الخاصة
                </h2>
                <p className="text-[11px] text-slate-500">
                  تعديل اسم المادة ورمزها، تفعيلها، وضبط شروط الحصص قبل الفسحة والحصص المزدوجة
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddCustomSubject}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition shadow-2xs"
              >
                <span>➕</span>
                <span>إضافة مادة مخصصة</span>
              </button>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 border-b font-extrabold">
                      <th className="p-3 text-start">اسم المادة</th>
                      <th className="p-3 text-start w-24">الرمز</th>
                      <th className="p-3 text-start">سياسة الحصص المزدوجة</th>
                      <th className="p-3 text-center w-28">قبل الفسحة؟</th>
                      <th className="p-3 text-center w-24">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {school.subjects.map((subj) => (
                      <tr key={subj.id} className="hover:bg-slate-50/70 transition">
                        <td className="p-2.5">
                          <input
                            type="text"
                            value={subj.name}
                            onChange={(e) => handleUpdateSubjectName(subj.id, e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="p-2.5">
                          <input
                            type="text"
                            value={subj.code}
                            onChange={(e) => handleUpdateSubjectCode(subj.id, e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold text-center bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="p-2.5">
                          <select
                            value={subj.double_period_policy || "FREE"}
                            onChange={(e) =>
                              handleUpdateSubjectRules(subj.id, {
                                double_period_policy: e.target.value as any,
                              })
                            }
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="FREE">تلقائي حر (مفردة أو مزدوجة)</option>
                            <option value="DOUBLE_REQUIRED">مزدوجة إجبارية (حصتين معاً)</option>
                            <option value="SINGLE_ONLY">مفردة فقط (حصة واحدة يومياً)</option>
                          </select>
                        </td>
                        <td className="p-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(subj.before_break)}
                            onChange={(e) =>
                              handleUpdateSubjectRules(subj.id, { before_break: e.target.checked })
                            }
                            className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                            title="تسكين حصص هذه المادة قبل الفسحة"
                          />
                        </td>
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleSubject(subj.id, false)}
                            className="text-rose-600 hover:text-rose-800 font-bold px-2 py-1 hover:bg-rose-50 rounded transition"
                            title="حذف هذه المادة"
                          >
                            🗑️ حذف
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* STEP 3: Sections Grid Generator                                   */}
        {/* ================================================================= */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-xs sm:text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <span>👥</span>
                    المولّد الشبكي للفصول والشعب
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    حدد عدد فصول كل صف، واضغط (توليد شبكة الفصول) لبناء الفصول وتسميتها تلقائياً
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleRegenerateSectionsGrid}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold px-4 py-2 rounded-xl transition shadow-2xs flex items-center gap-1.5"
                >
                  <span>⚡</span>
                  <span>توليد شبكة الفصول وتحديثها</span>
                </button>
              </div>

              {/* Grade Steppers Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                {school.grades.map((grade) => {
                  const count = sectionsCountByGrade[grade.id] || 1;
                  return (
                    <div key={grade.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-black text-slate-800">{grade.name}</div>
                        <div className="text-[10px] text-slate-500">رمز الصف: {grade.code}</div>
                      </div>

                      <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg p-1">
                        <button
                          type="button"
                          onClick={() =>
                            setSectionsCountByGrade((prev) => ({
                              ...prev,
                              [grade.id]: Math.max(1, count - 1),
                            }))
                          }
                          className="w-7 h-7 bg-slate-100 hover:bg-slate-200 rounded font-black text-xs text-slate-700"
                        >
                          -
                        </button>
                        <span className="w-8 text-center text-xs font-black">{count}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSectionsCountByGrade((prev) => ({
                              ...prev,
                              [grade.id]: Math.min(10, count + 1),
                            }))
                          }
                          className="w-7 h-7 bg-slate-100 hover:bg-slate-200 rounded font-black text-xs text-slate-700"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Generated Sections Preview */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-extrabold text-slate-900">
                  الفصول الحالية المسجلة ({school.sections.length} فصول):
                </h3>
                <span className="text-[11px] font-bold text-slate-500">
                  إجمالي الطاقة الاستيعابية: {capacityValidation.total_capacity} حصة أسبوعياً
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {school.sections.map((sec) => (
                  <div key={sec.id} className="p-2.5 rounded-lg border border-slate-200 bg-white text-start">
                    <div className="text-xs font-black text-slate-900 truncate">{sec.name}</div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                      <span>كود: {sec.code}</span>
                      <span className="font-bold text-blue-600">
                        {sec.shift === "SECOND" ? "مسائي" : "صباحي"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* STEP 4: Teachers & Bulk Paste                                     */}
        {/* ================================================================= */}
        {currentStep === 4 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3.5 rounded-xl border border-slate-200">
              <div>
                <h2 className="text-xs sm:text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <span>👨‍🏫</span>
                  هيئة التدريس ({school.teachers.length} معلماً)
                </h2>
                <p className="text-[11px] text-slate-500">
                  تعديل بيانات المعلمين وأنصبتهم، أو لصق قائمة أسماء المعلمين دفعة واحدة
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowBulkTeacherModal(true)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition shadow-2xs"
                >
                  <span>📋</span>
                  <span>لصق قائمة أسماء دفعة واحدة</span>
                </button>

                <button
                  type="button"
                  onClick={handleAddSingleTeacher}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition shadow-2xs"
                >
                  <span>➕</span>
                  <span>إضافة معلم</span>
                </button>
              </div>
            </div>

            {/* Teachers Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
              <div className="overflow-x-auto max-h-[380px]">
                <table className="w-full text-start text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700 border-b font-extrabold">
                    <tr>
                      <th className="p-2.5 text-start">اسم المعلم</th>
                      <th className="p-2.5 text-start w-28">الرمز المختصر</th>
                      <th className="p-2.5 text-center w-28">أقصى حصص/يوم</th>
                      <th className="p-2.5 text-center w-28">نصاب الأسبوع</th>
                      <th className="p-2.5 text-center w-28">أقصى تتابع</th>
                      <th className="p-2.5 text-center w-20">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {school.teachers.map((tch) => (
                      <tr key={tch.id} className="hover:bg-slate-50/70 transition">
                        <td className="p-2">
                          <input
                            type="text"
                            value={tch.name}
                            onChange={(e) => handleUpdateTeacher(tch.id, { name: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={tch.code}
                            onChange={(e) => handleUpdateTeacher(tch.id, { code: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold text-center bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="number"
                            min={1}
                            max={8}
                            value={tch.max_daily_periods || 7}
                            onChange={(e) =>
                              handleUpdateTeacher(tch.id, { max_daily_periods: Number(e.target.value) || 7 })
                            }
                            className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-center bg-white"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="number"
                            min={1}
                            max={36}
                            value={tch.max_weekly_periods || 24}
                            onChange={(e) =>
                              handleUpdateTeacher(tch.id, { max_weekly_periods: Number(e.target.value) || 24 })
                            }
                            className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-center bg-white"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="number"
                            min={1}
                            max={4}
                            value={tch.max_consecutive_periods || 2}
                            onChange={(e) =>
                              handleUpdateTeacher(tch.id, { max_consecutive_periods: Number(e.target.value) || 2 })
                            }
                            className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-center bg-white"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteTeacher(tch.id)}
                            className="text-rose-600 hover:text-rose-800 p-1 rounded hover:bg-rose-50"
                            title="حذف المعلم"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bulk Add Modal */}
            {showBulkTeacherModal && (
              <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5 space-y-4">
                  <div className="flex items-center justify-between border-b pb-2.5">
                    <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                      <span>📋</span>
                      إضافة عدة معلمين دفعة واحدة (سطر لكل معلم)
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowBulkTeacherModal(false)}
                      className="text-slate-400 hover:text-slate-600 font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">
                      الصق قائمة الأسماء هنا (اسم في كل سطر):
                    </label>
                    <textarea
                      rows={8}
                      value={bulkTeachersText}
                      onChange={(e) => setBulkTeachersText(e.target.value)}
                      placeholder={"أحمد محمود\nسيد عبد العال\nمنى إبراهيم\nحسام حسن"}
                      className="w-full border border-slate-300 rounded-xl p-3 text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t">
                    <button
                      type="button"
                      onClick={() => setShowBulkTeacherModal(false)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-4 py-2 rounded-xl"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkAddTeachers}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold px-5 py-2 rounded-xl shadow-2xs"
                    >
                      إضافة الأسماء الآن
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* STEP 5: Assignment Matrix                                         */}
        {/* ================================================================= */}
        {currentStep === 5 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3.5 rounded-xl border border-slate-200">
              <div>
                <h2 className="text-xs sm:text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <span>🧩</span>
                  مصفوفة إسناد المواد للمعلمين
                </h2>
                <p className="text-[11px] text-slate-500">
                  إسناد كل حصة لمعلم محدد، أو استخدام التوزيع التلقائي الذكي المتوازن
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleGenerateSpecialistTeachers}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition shadow-2xs"
                  title="إنشاء معلمين متخصصين لكل مادة وإسناد الحصص لهم فوراً"
                >
                  <span>⚡</span>
                  <span>معلمون متخصصون تلقائياً</span>
                </button>

                <button
                  type="button"
                  onClick={handleAutoBalanceTeachers}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition shadow-2xs"
                >
                  <span>⚖️</span>
                  <span>توزيع متوازن على المعلمين الحاليين</span>
                </button>
              </div>
            </div>

            {/* Matrix Capacity Status Bar */}
            <div
              className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold ${
                capacityValidation.errors.length === 0
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{capacityValidation.errors.length === 0 ? "✅" : "⚠️"}</span>
                <span>
                  إجمالي الحصص المسندة: {capacityValidation.total_assigned} من أصل {capacityValidation.total_capacity} حصة سعة المدرسة
                </span>
              </div>
              <span className="text-[11px]">
                {capacityValidation.errors.length === 0
                  ? "السعة الأسبوعية متطابقة 100% مع الفصول"
                  : capacityValidation.errors[0]}
              </span>
            </div>

            {/* Matrix Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
              <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-start text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 text-slate-800 border-b font-extrabold z-10">
                    <tr>
                      <th className="p-2.5 text-start bg-slate-100 border-e w-32 sticky start-0 z-20">الفصل</th>
                      {school.subjects.map((subj) => (
                        <th key={subj.id} className="p-2 text-center min-w-[140px] border-e">
                          <div>{subj.name}</div>
                          <div className="text-[10px] text-slate-500 font-normal">({subj.code})</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {school.sections.map((sec) => (
                      <tr key={sec.id} className="hover:bg-slate-50/70 transition">
                        <td className="p-2.5 font-black text-slate-800 bg-slate-50 border-e sticky start-0 z-10 truncate">
                          {sec.name}
                        </td>
                        {school.subjects.map((subj) => {
                          const asgn = school.assignments.find(
                            (a) => a.section_id === sec.id && a.subject_id === subj.id
                          );
                          const periods = asgn?.weekly_periods || 0;
                          const currentTeacherId = asgn?.teacher_id || "";

                          return (
                            <td key={subj.id} className="p-2 border-e text-center">
                              <div className="flex flex-col gap-1 items-center">
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={1}
                                    max={12}
                                    value={periods}
                                    onChange={(e) =>
                                      handleUpdateAssignmentPeriods(sec.id, subj.id, Number(e.target.value) || 0)
                                    }
                                    className="w-10 text-center border border-slate-200 rounded px-1 py-0.5 text-xs font-black bg-white"
                                    title="عدد الحصص الأسبوعية"
                                  />
                                  <span className="text-[10px] text-slate-500">حصة</span>
                                </div>

                                <select
                                  value={currentTeacherId}
                                  onChange={(e) => handleAssignTeacher(sec.id, subj.id, e.target.value)}
                                  className="w-full border border-slate-200 rounded px-1.5 py-1 text-[11px] font-bold bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 truncate"
                                >
                                  <option value="">(اختر المعلم)</option>
                                  {school.teachers.map((tch) => (
                                    <option key={tch.id} value={tch.id}>
                                      {tch.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* STEP 6: Feasibility Check & Solve                                 */}
        {/* ================================================================= */}
        {currentStep === 6 && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl">✨</span>
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900">
                    التحقق الرياضي والجدوى قبل إنشاء الجدول النهائي
                  </h2>
                  <p className="text-xs text-slate-500">
                    تم فحص جميع قيود الحصص، طاقة الفصول، أنصبة المعلمين، وتوزيع المواد
                  </p>
                </div>
              </div>

              {/* Status Metrics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <div className="text-[11px] text-slate-500 font-bold">إجمالي الفصول</div>
                  <div className="text-lg font-black text-slate-900 mt-0.5">{school.sections.length}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <div className="text-[11px] text-slate-500 font-bold">هيئة التدريس</div>
                  <div className="text-lg font-black text-slate-900 mt-0.5">{school.teachers.length}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <div className="text-[11px] text-slate-500 font-bold">الحصص المسندة</div>
                  <div className="text-lg font-black text-blue-700 mt-0.5">{capacityValidation.total_assigned}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <div className="text-[11px] text-slate-500 font-bold">حالة الجدوى</div>
                  <div
                    className={`text-lg font-black mt-0.5 ${
                      analysisReport.is_feasible ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {analysisReport.is_feasible ? "قابلة للحل ✓" : "تحتاج مراجعة ✕"}
                  </div>
                </div>
              </div>

              {/* Validation Warnings or Success */}
              {capacityValidation.errors.length > 0 ? (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-xs text-rose-800">
                  <div className="font-extrabold">⚠️ تنبيهات السعة والتحقق:</div>
                  {capacityValidation.errors.map((err, i) => (
                    <div key={i}>• {err}</div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2">
                  <span>✅</span>
                  <span>
                    جميع البيانات متطابقة بنسبة 100%! الحصص المسندة ({capacityValidation.total_assigned}) تطابق السعة الكاملة. الجدول جاهز للتوليد الآن.
                  </span>
                </div>
              )}

              {/* Final Solve Call to Action */}
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep(5)}
                  className="text-xs font-bold text-slate-600 hover:text-slate-900 px-3 py-2"
                >
                  ← العودة لمصفوفة الإسناد
                </button>

                <button
                  type="button"
                  onClick={handleFinalSolve}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-sm px-8 py-3 rounded-xl shadow-lg hover:shadow-xl transition flex items-center gap-2"
                >
                  <span>✨</span>
                  <span>إنشاء الجدول المدرسي النهائي الآن</span>
                  <span>←</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* FOOTER: Next / Previous Step Actions                                */}
      {/* ------------------------------------------------------------------- */}
      <div className="p-3 bg-white border-t border-slate-200 flex items-center justify-between">
        <button
          type="button"
          disabled={currentStep === 1}
          onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1) as WizardStepId)}
          className={`px-4 py-2 rounded-xl text-xs font-extrabold transition ${
            currentStep === 1
              ? "text-slate-300 cursor-not-allowed"
              : "text-slate-700 hover:bg-slate-100 border border-slate-300"
          }`}
        >
          ← الخطوة السابقة
        </button>

        <div className="text-xs font-bold text-slate-500">
          الخطوة {currentStep} من 6: {WIZARD_STEPS[currentStep - 1].title}
        </div>

        {currentStep < 6 ? (
          <button
            type="button"
            onClick={() => setCurrentStep((prev) => Math.min(6, prev + 1) as WizardStepId)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl text-xs font-extrabold transition shadow-2xs"
          >
            الخطوة التالية →
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFinalSolve}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-xl text-xs font-extrabold transition shadow-2xs"
          >
            إنشاء الجدول النهائي ✨
          </button>
        )}
      </div>
    </div>
  );
}
