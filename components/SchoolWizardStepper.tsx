import React, { useState, useMemo, useEffect, useCallback } from "react";
import { DAY_NAMES_AR, type SchoolData, type Grade, type Section, type Subject, type Teacher, type TeachingAssignment } from "../types.js";
import {
  ALL_SCHOOL_PRESETS,
  createSchoolFromPreset,
  getSubjectsForStageAndType,
  buildDefaultGradesForStage,
  STAGE_LABELS_AR,
  subjectsMatchEquivalent,
  syncSchoolPeriodsPerDay,
  EDU_TYPE_LABELS_AR,
  type CatalogStage,
  type CatalogEduType,
  type CatalogSubjectItem,
} from "../presets/commonPresets.js";
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

  // Stage & Education Type Subject Catalog browser state (Step 1)
  const [selectedStage, setSelectedStage] = useState<CatalogStage>(() => {
    const metaStage = school.metadata?.stage;
    if (metaStage === "PRIMARY" || metaStage === "PREPARATORY" || metaStage === "SECONDARY") return metaStage;
    return school.grades.length >= 6 ? "PRIMARY" : "PREPARATORY";
  });
  const [selectedEduType, setSelectedEduType] = useState<CatalogEduType>(() => {
    if (school.metadata?.school_type === "EXPERIMENTAL_LANGUAGE") return "LANGUAGE";
    return "GENERAL";
  });
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<string[]>([]);
  const [quickCustomSubjectName, setQuickCustomSubjectName] = useState<string>("");

  // Multi-line paste input for Step 4 (Teachers)
  const [bulkTeachersText, setBulkTeachersText] = useState("");
  const [bulkSubjectId, setBulkSubjectId] = useState<string>("");
  const [showBulkTeacherModal, setShowBulkTeacherModal] = useState(false);
  const [expandedExtraTeacherId, setExpandedExtraTeacherId] = useState<string | null>(null);

  // Step 5 (Teacher-Centric Assignment Studio)
  const [selectedAssignTeacherId, setSelectedAssignTeacherId] = useState<string>("");
  const [selectedAssignSubjectId, setSelectedAssignSubjectId] = useState<string>("");
  const [showAllSubjectsForTeacher, setShowAllSubjectsForTeacher] = useState<boolean>(false);

  // Infer teacher specialty subjects from explicit subject_ids or existing assignments
  const getTeacherSubjectIds = useCallback((t: Teacher): string[] => {
    if (t.subject_ids && t.subject_ids.length > 0) return t.subject_ids;
    const inferred = new Set<string>();
    for (const a of school.assignments) {
      if (a.teacher_id === t.id && a.subject_id) inferred.add(a.subject_id);
    }
    return Array.from(inferred);
  }, [school.assignments]);

  const activeAssignTeacher = useMemo(() => {
    return school.teachers.find((t) => t.id === selectedAssignTeacherId) || school.teachers[0] || null;
  }, [school.teachers, selectedAssignTeacherId]);

  const activeTeacherSubjIds = useMemo(() => {
    if (!activeAssignTeacher) return [];
    return getTeacherSubjectIds(activeAssignTeacher);
  }, [activeAssignTeacher, getTeacherSubjectIds]);

  const effectiveAssignSubjectId = useMemo(() => {
    if (selectedAssignSubjectId && school.subjects.some((sub) => sub.id === selectedAssignSubjectId)) {
      if (showAllSubjectsForTeacher || activeTeacherSubjIds.length === 0 || activeTeacherSubjIds.includes(selectedAssignSubjectId)) {
        return selectedAssignSubjectId;
      }
    }
    return activeTeacherSubjIds[0] || school.subjects[0]?.id || "";
  }, [selectedAssignSubjectId, school.subjects, showAllSubjectsForTeacher, activeTeacherSubjIds]);

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
      queueMicrotask(() => triggerAutoSave(next));
      return next;
    });
  }, [triggerAutoSave]);

  // ---------------------------------------------------------------------------
  // STEP 1 HANDLERS: Working Days, Stage & Subject Catalog Browser
  // ---------------------------------------------------------------------------
  const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5]; // السبت -> الجمعة

  const displayedCatalogSubjects = useMemo(() => {
    return getSubjectsForStageAndType(selectedStage, selectedEduType);
  }, [selectedStage, selectedEduType]);

  // Reset selection checkboxes when switching stage or education type
  useEffect(() => {
    setSelectedCatalogIds([]);
  }, [selectedStage, selectedEduType]);

  const handleToggleWorkingDay = (day: number) => {
    updateSchool((prev) => {
      const exists = prev.days.includes(day);
      if (exists && prev.days.length <= 1) return prev; // keep at least 1 active day
      const nextDays = exists
        ? prev.days.filter((d) => d !== day)
        : [...prev.days, day];
      nextDays.sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b));
      return { ...prev, days: nextDays };
    });
  };

  const handleSetWorkingWeekPreset = (daysPreset: number[]) => {
    updateSchool((prev) => ({ ...prev, days: daysPreset }));
  };

  const isCatalogSubjectInSchool = useCallback((item: CatalogSubjectItem) => {
    return school.subjects.some(
      (s) =>
        s.id === item.id ||
        subjectsMatchEquivalent(s.name, item.name, item.aliases) ||
        (s.code && subjectsMatchEquivalent(s.code, item.name, item.aliases))
    );
  }, [school.subjects]);

  const handleAddCatalogSubjects = (items: CatalogSubjectItem[]) => {
    if (items.length === 0) return;
    updateSchool((prev) => {
      const currentList = [...prev.subjects];
      const toAdd: Subject[] = [];
      for (const item of items) {
        const alreadyExists = currentList.some(
          (s) =>
            s.id === item.id ||
            subjectsMatchEquivalent(s.name, item.name, item.aliases) ||
            (s.code && subjectsMatchEquivalent(s.code, item.name, item.aliases))
        );
        if (alreadyExists) continue;
        const createdSubj: Subject = {
          id: item.id,
          name: item.name,
          code: item.code,
          before_break: Boolean(item.before_break),
          double_period_policy:
            item.double_policy === "DOUBLE_REQUIRED"
              ? "DOUBLE_REQUIRED"
              : item.double_policy === "SINGLE_ONLY"
              ? "SINGLE_ONLY"
              : "FREE",
        };
        currentList.push(createdSubj);
        toAdd.push(createdSubj);
      }
      if (toAdd.length === 0) return prev;
      return { ...prev, subjects: [...prev.subjects, ...toAdd] };
    });
  };

  const handleToggleCatalogCheckbox = (id: string) => {
    setSelectedCatalogIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAllCatalog = () => {
    const allIds = displayedCatalogSubjects.filter((s) => !isCatalogSubjectInSchool(s)).map((s) => s.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedCatalogIds.includes(id));
    setSelectedCatalogIds(allSelected ? [] : allIds);
  };

  const handleQuickAddCustomSubject = () => {
    const cleanName = quickCustomSubjectName.trim();
    if (!cleanName) return;
    updateSchool((prev) => {
      if (prev.subjects.some((s) => s.name.trim().toLowerCase() === cleanName.toLowerCase())) {
        return prev;
      }
      const newSubj: Subject = {
        id: `subj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        name: cleanName,
        code: cleanName.slice(0, 8),
        double_period_policy: "FREE",
        before_break: false,
      };
      return { ...prev, subjects: [...prev.subjects, newSubj] };
    });
    setQuickCustomSubjectName("");
  };

  const handleApplyStageGrades = (stage: CatalogStage) => {
    const nextGrades = buildDefaultGradesForStage(stage);
    updateSchool((prev) => {
      const nextSections: Section[] = [];
      const counts: Record<string, number> = {};
      nextGrades.forEach((g) => {
        counts[g.id] = 1;
        nextSections.push({
          id: `sec_${g.id}_1`,
          grade_id: g.id,
          name: `${g.order}/1`,
          code: `${g.order}/1`,
          shift: "FIRST",
        });
      });
      setSectionsCountByGrade(counts);
      return {
        ...prev,
        grades: nextGrades,
        sections: prev.sections.length === 0 ? nextSections : prev.sections,
        metadata: { ...prev.metadata, stage },
      };
    });
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
    const defaultSubj = school.subjects[0]?.id;
    const newTeacher: Teacher = {
      id: `tch_${Date.now().toString(36)}`,
      name: `معلم ${newIdx}`,
      code: `م-${newIdx}`,
      subject_ids: defaultSubj ? [defaultSubj] : [],
      max_daily_periods: 7,
      max_weekly_periods: 24,
      max_consecutive_periods: 2,
    };
    updateSchool((prev) => ({
      ...prev,
      teachers: [...prev.teachers, newTeacher],
    }));
  };

  const handleToggleTeacherSubject = (teacherId: string, subjectId: string) => {
    updateSchool((prev) => ({
      ...prev,
      teachers: prev.teachers.map((t) => {
        if (t.id !== teacherId) return t;
        const current = getTeacherSubjectIds(t);
        const exists = current.includes(subjectId);
        const next = exists ? current.filter((id) => id !== subjectId) : [...current, subjectId];
        return { ...t, subject_ids: next };
      }),
    }));
  };

  const handleSetPrimaryTeacherSubject = (teacherId: string, subjectId: string) => {
    updateSchool((prev) => ({
      ...prev,
      teachers: prev.teachers.map((t) => {
        if (t.id !== teacherId) return t;
        const current = getTeacherSubjectIds(t).filter((id) => id !== subjectId);
        return { ...t, subject_ids: subjectId ? [subjectId, ...current] : current };
      }),
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
            subject_ids: bulkSubjectId ? [bulkSubjectId] : [],
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

      // 1. Group teachers by explicit subject_ids first, then name/code affinity
      const getTeachersForSubject = (subj: Subject): Teacher[] => {
        const explicit = prev.teachers.filter((t) => t.subject_ids?.includes(subj.id));
        if (explicit.length > 0) return explicit;

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
            subject_ids: [subj.id],
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

  const getSubjectDefaultPeriodsForSection = (sectionId: string, subjectId: string): number => {
    const existing = school.assignments.find((a) => a.section_id === sectionId && a.subject_id === subjectId);
    if (existing && existing.weekly_periods > 0) return existing.weekly_periods;
    const sec = school.sections.find((secItem) => secItem.id === sectionId);
    if (sec) {
      const sameGradeAsgn = school.assignments.find((a) => {
        const otherSec = school.sections.find((sItem) => sItem.id === a.section_id);
        return otherSec?.grade_id === sec.grade_id && a.subject_id === subjectId && a.weekly_periods > 0;
      });
      if (sameGradeAsgn) return sameGradeAsgn.weekly_periods;
    }
    const anySubjAsgn = school.assignments.find((a) => a.subject_id === subjectId && a.weekly_periods > 0);
    return anySubjAsgn?.weekly_periods || 4;
  };

  const handleToggleTeacherSectionAssignment = (teacherId: string, sectionId: string, subjectId: string) => {
    updateSchool((prev) => {
      const existingIdx = prev.assignments.findIndex(
        (a) => a.section_id === sectionId && a.subject_id === subjectId
      );
      if (existingIdx >= 0) {
        const cur = prev.assignments[existingIdx];
        if (cur.teacher_id === teacherId) {
          // Unassign teacher (keep slot unassigned with teacher_id: "")
          const next = [...prev.assignments];
          next[existingIdx] = { ...cur, teacher_id: "" };
          return { ...prev, assignments: next };
        } else {
          // Reassign section+subject to selected teacher
          const next = [...prev.assignments];
          next[existingIdx] = { ...cur, teacher_id: teacherId };
          return { ...prev, assignments: next };
        }
      } else {
        const defaultPeriods = getSubjectDefaultPeriodsForSection(sectionId, subjectId);
        return {
          ...prev,
          assignments: [
            ...prev.assignments,
            {
              id: `asgn_${sectionId}_${subjectId}`,
              section_id: sectionId,
              subject_id: subjectId,
              teacher_id: teacherId,
              weekly_periods: defaultPeriods,
            },
          ],
        };
      }
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
      <div className="bg-[#FAFAF9] px-3.5 py-2.5 border-b border-[#E7E5E4] space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-extrabold text-[#1C1917]">
            خطوات إعداد المدرسة (6 خطوات)
          </span>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#0F766E] bg-[#CCFBF1]/70 border border-[#14B8A6]/50 px-2 py-0.5 rounded-lg">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#0F766E]" aria-hidden="true" />
              حفظ تلقائي: {lastSavedTime}
            </span>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="bg-white hover:bg-[#E7E5E4] text-[#57534E] hover:text-[#1C1917] border border-[#E7E5E4] px-2.5 py-0.5 rounded-lg text-[11px] font-bold transition cursor-pointer"
              >
                إغلاق ✕
              </button>
            )}
          </div>
        </div>

        {/* Compact Stepper Navigation Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
          {WIZARD_STEPS.map((step) => {
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setCurrentStep(step.id)}
                className={`py-1.5 px-2 rounded-lg text-start transition flex items-center gap-1.5 border cursor-pointer ${
                  isActive
                    ? "bg-[#0F766E] border-[#0F766E] text-white shadow-2xs"
                    : isCompleted
                    ? "bg-[#CCFBF1]/50 border-[#14B8A6]/50 text-[#0F766E] hover:bg-[#CCFBF1]"
                    : "bg-white border-[#E7E5E4] text-[#57534E] hover:text-[#1C1917]"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black shrink-0 ${
                    isActive
                      ? "bg-white text-[#0F766E]"
                      : isCompleted
                      ? "bg-[#0F766E] text-white"
                      : "bg-[#FAFAF9] text-[#57534E] border border-[#E7E5E4]"
                  }`}
                >
                  {isCompleted ? "✓" : step.id}
                </span>
                <span className="text-[11px] font-extrabold truncate">{step.title}</span>
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
            <div className="bg-white p-4 rounded-xl border border-[#E7E5E4] space-y-4">
              <h2 className="text-sm font-extrabold text-[#1C1917] flex items-center gap-2">
                <span>🏫</span>
                بيانات المدرسة وأيام العمل
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-extrabold text-[#1C1917] block mb-1">اسم المدرسة:</label>
                  <input
                    type="text"
                    value={school.name}
                    onChange={(e) => updateSchool((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full border border-[#E7E5E4] rounded-lg px-3 py-2 text-xs font-bold bg-white text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    placeholder="اسم المدرسة..."
                  />
                </div>
                <div>
                  <label className="text-xs font-extrabold text-[#1C1917] block mb-1">العام الدراسي:</label>
                  <input
                    type="text"
                    value={school.academic_year}
                    onChange={(e) => updateSchool((prev) => ({ ...prev, academic_year: e.target.value }))}
                    className="w-full border border-[#E7E5E4] rounded-lg px-3 py-2 text-xs font-bold bg-white text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    placeholder="2026/2027"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-extrabold text-[#1C1917] block mb-1">نظام الفترات:</label>
                  <select
                    value={school.shift_mode || "SINGLE"}
                    onChange={(e) =>
                      updateSchool((prev) => ({
                        ...prev,
                        shift_mode: e.target.value as "SINGLE" | "TWO_SHIFTS",
                      }))
                    }
                    className="w-full border border-[#E7E5E4] rounded-lg px-3 py-2 text-xs font-bold bg-white text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                  >
                    <option value="SINGLE">فترة واحدة (كاملة)</option>
                    <option value="TWO_SHIFTS">فترتان (صباحي / مسائي)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-extrabold text-[#1C1917] block mb-1">عدد الحصص اليومية الافتراضي:</label>
                  <input
                    type="number"
                    min={4}
                    max={10}
                    value={school.periods_per_day}
                    onChange={(e) =>
                      updateSchool((prev) => syncSchoolPeriodsPerDay(prev, Number(e.target.value) || 7))
                    }
                    className="w-full border border-[#E7E5E4] rounded-lg px-3 py-2 text-xs font-bold bg-white text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                  />
                </div>
              </div>

              {/* Working Days Selector */}
              <div className="pt-2 border-t border-[#E7E5E4] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold text-[#1C1917]">أيام العمل في الأسبوع:</span>
                    <span className="text-[11px] font-bold bg-[#CCFBF1] text-[#0F766E] px-2 py-0.5 rounded-full tabular-nums">
                      {school.days.length} أيام
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSetWorkingWeekPreset([0, 1, 2, 3, 4])}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                        school.days.length === 5 && !school.days.includes(6) && !school.days.includes(5)
                          ? "bg-[#CCFBF1] text-[#0F766E] border-[#14B8A6]"
                          : "bg-[#FAFAF9] text-[#57534E] border-[#E7E5E4] hover:text-[#1C1917]"
                      }`}
                    >
                      الأحد ← الخميس (5 أيام)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetWorkingWeekPreset([6, 0, 1, 2, 3, 4])}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                        school.days.length === 6 && school.days.includes(6) && !school.days.includes(5)
                          ? "bg-[#CCFBF1] text-[#0F766E] border-[#14B8A6]"
                          : "bg-[#FAFAF9] text-[#57534E] border-[#E7E5E4] hover:text-[#1C1917]"
                      }`}
                    >
                      السبت ← الخميس (6 أيام)
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {WEEKDAY_ORDER.map((dayNum) => {
                    const isActive = school.days.includes(dayNum);
                    return (
                      <button
                        key={dayNum}
                        type="button"
                        onClick={() => handleToggleWorkingDay(dayNum)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                          isActive
                            ? "bg-[#0F766E] text-white border-[#0F766E] shadow-2xs"
                            : "bg-[#FAFAF9] text-[#57534E] border-[#E7E5E4] hover:bg-slate-100"
                        }`}
                      >
                        {isActive ? "✓ " : ""}{DAY_NAMES_AR[dayNum]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Stage & Edu-Type Subject Catalog Browser */}
            <div className="bg-white p-4 rounded-xl border border-[#E7E5E4] space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-xs sm:text-sm font-extrabold text-[#1C1917] flex items-center gap-1.5">
                    <span>📚</span>
                    عرض وإضافة المواد الدراسية حسب المرحلة ونوع التعليم
                  </h3>
                  <p className="text-[11px] text-[#57534E] mt-0.5">
                    اختر المرحلة ونوع التعليم لاستعراض المواد، ثم حدّد الكل أو أضف ما يناسب مدرستك دون مسح بياناتك الحالية
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleApplyStageGrades(selectedStage)}
                  className="bg-[#FAFAF9] hover:bg-[#CCFBF1]/50 text-[#0F766E] border border-[#14B8A6] text-[11px] font-extrabold px-2.5 py-1 rounded-lg transition cursor-pointer shrink-0"
                  title="ضبط صفوف المدرسة لتطابق هذه المرحلة"
                >
                  اعتماد صفوف {STAGE_LABELS_AR[selectedStage]} ({selectedStage === "PRIMARY" ? 6 : 3} صفوف)
                </button>
              </div>

              {/* Stage & Education Type Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FAFAF9] p-3 rounded-xl border border-[#E7E5E4]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-extrabold text-[#57534E] me-1">المرحلة:</span>
                  {(["PRIMARY", "PREPARATORY", "SECONDARY"] as CatalogStage[]).map((stageKey) => (
                    <button
                      key={stageKey}
                      type="button"
                      onClick={() => setSelectedStage(stageKey)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition cursor-pointer ${
                        selectedStage === stageKey
                          ? "bg-[#0F766E] text-white border-[#0F766E] shadow-2xs"
                          : "bg-white text-[#1C1917] border-[#E7E5E4] hover:border-[#14B8A6]"
                      }`}
                    >
                      {stageKey === "PRIMARY" ? "ابتدائي" : stageKey === "PREPARATORY" ? "إعدادي" : "ثانوي"}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-extrabold text-[#57534E] me-1">النظام:</span>
                  {(["GENERAL", "LANGUAGE", "AZHAR"] as CatalogEduType[]).map((eduKey) => (
                    <button
                      key={eduKey}
                      type="button"
                      onClick={() => setSelectedEduType(eduKey)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border transition cursor-pointer ${
                        selectedEduType === eduKey
                          ? "bg-[#6D28D9] text-white border-[#6D28D9] shadow-2xs"
                          : "bg-white text-[#1C1917] border-[#E7E5E4] hover:border-[#8B5CF6]"
                      }`}
                    >
                      {EDU_TYPE_LABELS_AR[eduKey]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bulk Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-extrabold text-[#1C1917]">
                  مواد {STAGE_LABELS_AR[selectedStage]} ({EDU_TYPE_LABELS_AR[selectedEduType]}) — {displayedCatalogSubjects.length} مادة
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleToggleSelectAllCatalog}
                    className="bg-[#FAFAF9] hover:bg-[#E7E5E4] text-[#1C1917] border border-[#E7E5E4] text-[11px] font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
                  >
                    {displayedCatalogSubjects.some((s) => !isCatalogSubjectInSchool(s)) && displayedCatalogSubjects.filter((s) => !isCatalogSubjectInSchool(s)).every((s) => selectedCatalogIds.includes(s.id))
                      ? "إلغاء تحديد الكل"
                      : "تحديد الكل"}
                  </button>
                  {selectedCatalogIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const chosen = displayedCatalogSubjects.filter((s) => selectedCatalogIds.includes(s.id));
                        handleAddCatalogSubjects(chosen);
                        setSelectedCatalogIds([]);
                      }}
                      className="bg-[#0F766E] hover:bg-[#115E59] text-white text-[11px] font-extrabold px-3 py-1 rounded-lg shadow-2xs transition cursor-pointer"
                    >
                      + إضافة المحدد ({selectedCatalogIds.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleAddCatalogSubjects(displayedCatalogSubjects)}
                    className="bg-[#CCFBF1] hover:bg-[#99F6E4] text-[#0F766E] border border-[#14B8A6] text-[11px] font-extrabold px-3 py-1 rounded-lg transition cursor-pointer"
                  >
                    + إضافة كل القائمة للمدرسة
                  </button>
                </div>
              </div>

              {/* Subject Checklist Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {displayedCatalogSubjects.map((item) => {
                  const alreadyAdded = isCatalogSubjectInSchool(item);
                  const isChecked = selectedCatalogIds.includes(item.id);
                  return (
                    <div
                      key={`${selectedStage}_${selectedEduType}_${item.id}`}
                      className={`p-2.5 rounded-xl border transition flex items-center justify-between gap-2 ${
                        alreadyAdded
                          ? "bg-[#CCFBF1]/35 border-[#14B8A6]"
                          : isChecked
                          ? "bg-[#EDE9FE]/50 border-[#8B5CF6]"
                          : "bg-[#FAFAF9] border-[#E7E5E4] hover:border-[#14B8A6]"
                      }`}
                    >
                      <label className="flex items-center gap-2 min-w-0 cursor-pointer flex-1">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={alreadyAdded}
                          onChange={() => handleToggleCatalogCheckbox(item.id)}
                          className="w-4 h-4 rounded border-[#D6D3D1] text-[#0F766E] focus:ring-[#0F766E] cursor-pointer disabled:opacity-40 shrink-0"
                        />
                        <span className="text-xs font-extrabold text-[#1C1917] truncate" title={item.name}>
                          {item.name}{item.gradeHint ? ` (${item.gradeHint})` : ""}
                        </span>
                      </label>
                      {alreadyAdded ? (
                        <span className="text-[10px] font-extrabold bg-[#CCFBF1] text-[#0F766E] px-2 py-0.5 rounded-full shrink-0">
                          مضافة ✓
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAddCatalogSubjects([item])}
                          className="text-[11px] font-extrabold bg-[#0F766E] hover:bg-[#115E59] text-white px-2.5 py-0.5 rounded-lg transition shrink-0 cursor-pointer"
                        >
                          + إضافة
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Quick Custom Subject Adder */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E7E5E4]">
                <input
                  type="text"
                  value={quickCustomSubjectName}
                  onChange={(e) => setQuickCustomSubjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleQuickAddCustomSubject();
                    }
                  }}
                  placeholder="إضافة مادة مخصصة..."
                  className="flex-1 min-w-[220px] border border-[#E7E5E4] rounded-lg px-3 py-1.5 text-xs font-bold bg-white text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                />
                <button
                  type="button"
                  onClick={handleQuickAddCustomSubject}
                  disabled={!quickCustomSubjectName.trim()}
                  className="bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-45 text-white text-xs font-extrabold px-3 py-1.5 rounded-lg transition cursor-pointer"
                >
                  + إضافة مادة مخصصة
                </button>
              </div>

              {/* Current School Subjects Summary Chips */}
              <div className="bg-[#FAFAF9] p-3 rounded-xl border border-[#E7E5E4] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-[#1C1917]">
                    مواد المدرسة المضافة حالياً ({school.subjects.length}):
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="text-[11px] font-extrabold text-[#0F766E] hover:underline cursor-pointer"
                  >
                    ضبط قواعد المواد ←
                  </button>
                </div>
                {school.subjects.length === 0 ? (
                  <p className="text-[11px] text-[#57534E]">
                    لم تتم إضافة مواد بعد — اختر المرحلة والنظام أعلاه وأضف المواد المطلوبة.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {school.subjects.map((subj) => (
                      <span
                        key={subj.id}
                        className="inline-flex items-center gap-1.5 bg-white border border-[#E7E5E4] text-[#1C1917] text-[11px] font-bold px-2.5 py-1 rounded-lg"
                      >
                        <span>{subj.name}</span>
                        <button
                          type="button"
                          onClick={() => handleToggleSubject(subj.id, false)}
                          className="text-[#57534E] hover:text-[#BE123C] font-black cursor-pointer"
                          title="حذف المادة"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
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
                <p className="text-[11px] text-[#57534E]">
                  تعديل اسم المادة، وتفعيل شروط الحصص قبل الفسحة والحصص المزدوجة
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
                            className="w-full border border-[#D6D3D1] rounded-lg px-2.5 py-1.5 text-xs font-bold bg-white text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
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
                        <div className="text-xs font-black text-[#1C1917]">{grade.name}</div>
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
                    <div className="flex items-center justify-end text-[10px] text-[#57534E] mt-1">
                      <span className="font-bold text-[#0F766E]">
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
        {/* STEP 4: Teachers & Specialty Assignment (Clean, No Codes)         */}
        {/* ================================================================= */}
        {currentStep === 4 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3.5 rounded-xl border border-[#E7E5E4]">
              <div>
                <h2 className="text-xs sm:text-sm font-extrabold text-[#1C1917] flex items-center gap-2">
                  <span>هيئة التدريس ({school.teachers.length} معلماً)</span>
                </h2>
                <p className="text-xs text-[#57534E] mt-0.5">
                  أضف اسم المعلم واختر المادة التي يدرّسها وحدد نصابه الأسبوعي (الرموز التقنية مخفية وتُدار تلقائياً)
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!bulkSubjectId && school.subjects[0]) setBulkSubjectId(school.subjects[0].id);
                    setShowBulkTeacherModal(true);
                  }}
                  className="bg-[#FFFFFF] hover:bg-[#FAFAF9] text-[#1C1917] border border-[#E7E5E4] text-xs font-extrabold px-3 py-2 rounded-xl flex items-center gap-1.5 transition cursor-pointer"
                >
                  <span>لصق قائمة أسماء</span>
                </button>

                <button
                  type="button"
                  onClick={handleAddSingleTeacher}
                  className="bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-extrabold px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
                >
                  <span>+ إضافة معلم</span>
                </button>
              </div>
            </div>

            {/* Clean 3-Column Teachers Table: Name | Specialty Subject(s) | Weekly Quota */}
            <div className="bg-white rounded-xl border border-[#E7E5E4] overflow-hidden shadow-2xs">
              <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-start text-xs border-collapse">
                  <thead className="sticky top-0 bg-[#FAFAF9] text-[#1C1917] border-b border-[#E7E5E4] font-extrabold z-10">
                    <tr>
                      <th className="p-3 text-start min-w-[180px]">اسم المعلم</th>
                      <th className="p-3 text-start min-w-[260px]">المادة / التخصص</th>
                      <th className="p-3 text-center w-32">النصاب الأسبوعي</th>
                      <th className="p-3 text-center w-20">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E7E5E4]">
                    {school.teachers.map((tch) => {
                      const tSubjIds = getTeacherSubjectIds(tch);
                      const primarySubjId = tSubjIds[0] || "";
                      return (
                        <tr key={tch.id} className="hover:bg-[#FAFAF9] transition">
                          <td className="p-2.5">
                            <input
                              type="text"
                              value={tch.name}
                              onChange={(e) => handleUpdateTeacher(tch.id, { name: e.target.value })}
                              className="w-full border border-[#D6D3D1] rounded-lg px-3 py-1.5 text-xs font-bold bg-white text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                              placeholder="اسم المعلم..."
                            />
                          </td>
                          <td className="p-2">
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1.5">
                                <select
                                  value={primarySubjId}
                                  onChange={(e) => handleSetPrimaryTeacherSubject(tch.id, e.target.value)}
                                  className="flex-1 min-w-0 border border-[#D6D3D1] rounded-lg px-2.5 py-1.5 text-xs font-bold bg-white text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                                >
                                  <option value="">(اختر المادة الرئيسية...)</option>
                                  {school.subjects.map((sub) => (
                                    <option key={sub.id} value={sub.id}>
                                      {sub.name}
                                    </option>
                                  ))}
                                </select>
                                {school.subjects.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedExtraTeacherId((prev) => (prev === tch.id ? null : tch.id))
                                    }
                                    className={`px-2 py-1.5 rounded-lg text-[10.5px] font-bold border transition shrink-0 cursor-pointer ${
                                      expandedExtraTeacherId === tch.id
                                        ? "bg-[#1C1917] text-white border-[#1C1917]"
                                        : "bg-[#FAFAF9] text-[#57534E] border-[#E7E5E4] hover:border-[#14B8A6] hover:text-[#0F766E]"
                                    }`}
                                    title="إضافة مادة إضافية لهذا المعلم"
                                  >
                                    + تخصص
                                  </button>
                                )}
                              </div>
                              {/* Show active extra subjects cleanly as removable chips */}
                              {tSubjIds.filter((id) => id !== primarySubjId).length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {school.subjects
                                    .filter((sub) => sub.id !== primarySubjId && tSubjIds.includes(sub.id))
                                    .map((sub) => (
                                      <button
                                        key={sub.id}
                                        type="button"
                                        onClick={() => handleToggleTeacherSubject(tch.id, sub.id)}
                                        className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#CCFBF1] text-[#0F766E] border border-[#14B8A6] hover:bg-[#FFF1F2] hover:text-[#BE123C] hover:border-[#FB7185] transition cursor-pointer"
                                        title="انقر لإزالة التخصص الإضافي"
                                      >
                                        {sub.name} ×
                                      </button>
                                    ))}
                                </div>
                              )}
                              {/* Expanded picker only for the teacher being edited */}
                              {expandedExtraTeacherId === tch.id && (
                                <div className="flex flex-wrap gap-1 p-2 rounded-lg bg-[#FAFAF9] border border-[#E7E5E4]">
                                  {school.subjects
                                    .filter((sub) => sub.id !== primarySubjId)
                                    .map((sub) => {
                                      const isExtra = tSubjIds.includes(sub.id);
                                      return (
                                        <button
                                          key={sub.id}
                                          type="button"
                                          onClick={() => handleToggleTeacherSubject(tch.id, sub.id)}
                                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition cursor-pointer ${
                                            isExtra
                                              ? "bg-[#0F766E] text-white border-[#0F766E]"
                                              : "bg-white text-[#57534E] border-[#E7E5E4] hover:border-[#14B8A6]"
                                          }`}
                                        >
                                          {isExtra ? `✓ ${sub.name}` : `+ ${sub.name}`}
                                        </button>
                                      );
                                    })}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-2.5 text-center">
                            <input
                              type="number"
                              min={1}
                              max={36}
                              value={tch.max_weekly_periods || 24}
                              onChange={(e) =>
                                handleUpdateTeacher(tch.id, { max_weekly_periods: Number(e.target.value) || 24 })
                              }
                              className="w-20 border border-[#D6D3D1] rounded-lg px-2 py-1.5 text-xs font-bold text-center bg-white text-[#1C1917] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                            />
                          </td>
                          <td className="p-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteTeacher(tch.id)}
                              className="min-w-[32px] min-h-[32px] text-[#BE123C] hover:bg-[#FFF1F2] border border-transparent hover:border-[#FB7185] px-2 py-1 rounded-lg text-xs font-bold transition cursor-pointer"
                              title="حذف المعلم"
                              aria-label={`حذف ${tch.name}`}
                            >
                              حذف
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bulk Add Modal with Specialty Subject Selector */}
            {showBulkTeacherModal && (
              <div className="fixed inset-0 bg-[#1C1917]/60 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl border border-[#E7E5E4] max-w-lg w-full p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-[#E7E5E4] pb-2.5">
                    <h3 className="text-sm font-extrabold text-[#1C1917]">
                      إضافة عدة معلمين دفعة واحدة
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowBulkTeacherModal(false)}
                      className="text-[#57534E] hover:text-[#1C1917] font-bold px-2 py-1 cursor-pointer"
                      aria-label="إغلاق"
                    >
                      ✕
                    </button>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[#1C1917] block mb-1.5">
                      اختر المادة لهؤلاء المعلمين (اختياري):
                    </label>
                    <select
                      value={bulkSubjectId}
                      onChange={(e) => setBulkSubjectId(e.target.value)}
                      className="w-full border border-[#D6D3D1] rounded-xl px-3 py-2 text-xs font-bold bg-white text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    >
                      <option value="">(بدون تحديد مسبق)</option>
                      {school.subjects.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {sub.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[#1C1917] block mb-1.5">
                      الصق قائمة الأسماء هنا (اسم في كل سطر):
                    </label>
                    <textarea
                      rows={7}
                      value={bulkTeachersText}
                      onChange={(e) => setBulkTeachersText(e.target.value)}
                      placeholder="اسم في كل سطر..."
                      className="w-full border border-[#D6D3D1] rounded-xl p-3 text-xs font-bold bg-white text-[#1C1917] placeholder:font-normal placeholder:text-[#A8A29E] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowBulkTeacherModal(false)}
                      className="bg-[#FAFAF9] hover:bg-[#E7E5E4] border border-[#E7E5E4] text-[#1C1917] text-xs font-bold px-4 py-2 rounded-xl cursor-pointer"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkAddTeachers}
                      className="bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-extrabold px-5 py-2 rounded-xl shadow-2xs cursor-pointer"
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
        {/* STEP 5: Smart Teacher-Centric Assignment Studio                   */}
        {/* ================================================================= */}
        {currentStep === 5 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3.5 rounded-xl border border-[#E7E5E4]">
              <div>
                <h2 className="text-xs sm:text-sm font-extrabold text-[#1C1917]">
                  إسناد الفصول والحصص للمعلمين
                </h2>
                <p className="text-xs text-[#57534E] mt-0.5">
                  اختر المعلم، ثم اضغط على الفصول التي يدرّسها — تُحتسب الحصص والنصاب تلقائياً
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleGenerateSpecialistTeachers}
                  className="bg-[#FFFFFF] hover:bg-[#FAFAF9] text-[#1C1917] border border-[#E7E5E4] text-xs font-extrabold px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition cursor-pointer"
                  title="إنشاء معلمين متخصصين لكل مادة وإسناد الحصص لهم فوراً"
                >
                  <span>إنشاء متخصصين تلقائياً</span>
                </button>

                <button
                  type="button"
                  onClick={handleAutoBalanceTeachers}
                  className="bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-extrabold px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
                >
                  <span>توزيع متوازن تلقائي</span>
                </button>
              </div>
            </div>

            {/* Capacity Status Bar */}
            <div
              className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs font-bold ${
                capacityValidation.errors.length === 0
                  ? "bg-[#CCFBF1]/45 border-[#14B8A6] text-[#0F766E]"
                  : "bg-[#FFF1F2] border-[#FB7185] text-[#BE123C]"
              }`}
            >
              <span>
                إجمالي الحصص المسندة: {capacityValidation.total_assigned} من أصل {capacityValidation.total_capacity} حصة سعة المدرسة
              </span>
              <span>
                {capacityValidation.errors.length === 0
                  ? "✓ السعة الأسبوعية متطابقة 100%"
                  : capacityValidation.errors[0]}
              </span>
            </div>

            {/* Two-Column Teacher-Centric Studio */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Teachers List with Live Quota Progress */}
              <div className="lg:col-span-4 bg-white rounded-xl border border-[#E7E5E4] p-3 space-y-2 max-h-[500px] overflow-y-auto">
                <div className="text-xs font-extrabold text-[#1C1917] pb-1.5 border-b border-[#E7E5E4] flex items-center justify-between">
                  <span>هيئة التدريس ({school.teachers.length})</span>
                  <span className="text-[11px] font-bold text-[#57534E]">الحصص / النصاب</span>
                </div>

                {school.teachers.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#57534E]">
                    لا يوجد معلمون بعد. ارجع للخطوة 4 لإضافتهم أو اضغط "إنشاء متخصصين تلقائياً".
                  </div>
                ) : (
                  school.teachers.map((tch) => {
                    const isSelected = activeAssignTeacher?.id === tch.id;
                    const assignedSum = school.assignments
                      .filter((a) => a.teacher_id === tch.id)
                      .reduce((sum, a) => sum + (Number(a.weekly_periods) || 0), 0);
                    const maxQuota = tch.max_weekly_periods || 24;
                    const overQuota = assignedSum > maxQuota;
                    const tSubjNames = getTeacherSubjectIds(tch)
                      .map((sid) => school.subjects.find((sub) => sub.id === sid)?.name)
                      .filter(Boolean)
                      .join("، ");

                    return (
                      <button
                        key={tch.id}
                        type="button"
                        onClick={() => {
                          setSelectedAssignTeacherId(tch.id);
                          const firstSubj = getTeacherSubjectIds(tch)[0];
                          if (firstSubj) setSelectedAssignSubjectId(firstSubj);
                        }}
                        className={`w-full text-start p-2.5 rounded-xl border transition cursor-pointer space-y-1.5 ${
                          isSelected
                            ? "bg-[#CCFBF1]/50 border-[#14B8A6] shadow-2xs"
                            : "bg-[#FAFAF9] border-[#E7E5E4] hover:bg-white hover:border-[#D6D3D1]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-xs text-[#1C1917] truncate">{tch.name}</span>
                          <span
                            className={`text-[11px] font-black px-2 py-0.5 rounded-full tabular-nums shrink-0 ${
                              overQuota
                                ? "bg-[#FFF1F2] text-[#BE123C] border border-[#FB7185]"
                                : assignedSum > 0
                                ? "bg-[#CCFBF1] text-[#0F766E]"
                                : "bg-[#E7E5E4] text-[#57534E]"
                            }`}
                          >
                            {assignedSum} / {maxQuota}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#57534E] truncate">
                          {tSubjNames || "لم يُحدد تخصص بعد"}
                        </div>
                        <div className="w-full h-1.5 bg-[#E7E5E4] rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${overQuota ? "bg-[#BE123C]" : "bg-[#0F766E]"}`}
                            style={{ width: `${Math.min(100, Math.round((assignedSum / Math.max(1, maxQuota)) * 100))}%` }}
                          />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Selected Teacher Section Picker */}
              <div className="lg:col-span-8 bg-white rounded-xl border border-[#E7E5E4] p-4 space-y-4">
                {activeAssignTeacher ? (
                  <>
                    {/* Teacher Quota Summary Header */}
                    {(() => {
                      const tchAsgns = school.assignments.filter((a) => a.teacher_id === activeAssignTeacher.id);
                      const tchTotal = tchAsgns.reduce((sum, a) => sum + (Number(a.weekly_periods) || 0), 0);
                      const maxQuota = activeAssignTeacher.max_weekly_periods || 24;
                      const remaining = maxQuota - tchTotal;

                      return (
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E7E5E4]">
                          <div>
                            <h3 className="text-sm font-extrabold text-[#1C1917]">
                              إسناد فصول: {activeAssignTeacher.name}
                            </h3>
                            <p className="text-xs text-[#57534E] mt-0.5 tabular-nums">
                              المُسند حالياً: <strong className="text-[#1C1917]">{tchTotal}</strong> حصة من أصل <strong className="text-[#1C1917]">{maxQuota}</strong>{" "}
                              {remaining >= 0 ? `(المتبقي المتاح: ${remaining} حصة)` : `(تجاوز النصاب بـ ${Math.abs(remaining)} حصة!)`}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-[#57534E]">النصاب:</label>
                            <input
                              type="number"
                              min={1}
                              max={36}
                              value={maxQuota}
                              onChange={(e) =>
                                handleUpdateTeacher(activeAssignTeacher.id, {
                                  max_weekly_periods: Number(e.target.value) || 24,
                                })
                              }
                              className="w-16 border border-[#D6D3D1] rounded-lg px-2 py-1 text-xs font-bold text-center bg-white text-[#1C1917] tabular-nums"
                            />
                          </div>
                        </div>
                      );
                    })()}

                    {/* Subject Selector (Defaults to teacher's chosen specialty subjects) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#1C1917]">المادة المُسندة:</span>
                        <button
                          type="button"
                          onClick={() => setShowAllSubjectsForTeacher(!showAllSubjectsForTeacher)}
                          className="text-[11px] font-bold text-[#0F766E] hover:underline cursor-pointer"
                        >
                          {showAllSubjectsForTeacher ? "عرض تخصص المعلم فقط" : "إظهار كل مواد المدرسة"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(showAllSubjectsForTeacher || activeTeacherSubjIds.length === 0
                          ? school.subjects
                          : school.subjects.filter((sub) => activeTeacherSubjIds.includes(sub.id))
                        ).map((sub) => {
                          const isCur = effectiveAssignSubjectId === sub.id;
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() => setSelectedAssignSubjectId(sub.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                                isCur
                                  ? "bg-[#0F766E] text-white border-[#0F766E]"
                                  : "bg-[#FAFAF9] text-[#1C1917] border-[#E7E5E4] hover:border-[#14B8A6]"
                              }`}
                            >
                              {sub.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sections Grid grouped by Grade with Auto-filled Periods & +/- Stepper */}
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-[#1C1917]">
                        اختر الفصول (تُملأ الحصص تلقائياً حسب نصاب المادة في كل صف):
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[260px] overflow-y-auto p-1">
                        {school.sections.map((sec) => {
                          const asgn = school.assignments.find(
                            (a) => a.section_id === sec.id && a.subject_id === effectiveAssignSubjectId
                          );
                          const isAssignedToThis = asgn?.teacher_id === activeAssignTeacher.id;
                          const assignedOtherTeacher =
                            asgn?.teacher_id && asgn.teacher_id !== activeAssignTeacher.id
                              ? school.teachers.find((t) => t.id === asgn.teacher_id)
                              : null;
                          const periodsVal = asgn?.weekly_periods || getSubjectDefaultPeriodsForSection(sec.id, effectiveAssignSubjectId);

                          return (
                            <div
                              key={sec.id}
                              className={`p-2.5 rounded-xl border transition flex flex-col justify-between gap-2 ${
                                isAssignedToThis
                                  ? "bg-[#CCFBF1]/55 border-[#14B8A6] shadow-2xs"
                                  : assignedOtherTeacher
                                  ? "bg-[#FAFAF9] border-[#E7E5E4] opacity-80"
                                  : "bg-white border-[#E7E5E4] hover:border-[#14B8A6]"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleTeacherSectionAssignment(
                                    activeAssignTeacher.id,
                                    sec.id,
                                    effectiveAssignSubjectId
                                  )
                                }
                                className="w-full text-start cursor-pointer"
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-extrabold text-xs text-[#1C1917]">{sec.name}</span>
                                  <span className={`text-xs font-black ${isAssignedToThis ? "text-[#0F766E]" : "text-[#57534E]"}`}>
                                    {isAssignedToThis ? "✓" : "+"}
                                  </span>
                                </div>
                                {assignedOtherTeacher && (
                                  <div className="text-[10px] text-[#57534E] truncate mt-0.5">
                                    مع: {assignedOtherTeacher.name}
                                  </div>
                                )}
                              </button>

                              {isAssignedToThis && (
                                <div className="flex items-center justify-between pt-1 border-t border-[#14B8A6]/40">
                                  <span className="text-[11px] font-bold text-[#0F766E]">الحصص:</span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleUpdateAssignmentPeriods(sec.id, effectiveAssignSubjectId, Math.max(1, periodsVal - 1))
                                      }
                                      className="w-7 h-7 bg-white border border-[#14B8A6] rounded text-xs font-black text-[#0F766E] cursor-pointer"
                                      aria-label="تقليل حصة"
                                    >
                                      −
                                    </button>
                                    <span className="w-6 text-center text-xs font-black text-[#1C1917] tabular-nums">
                                      {periodsVal}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleUpdateAssignmentPeriods(sec.id, effectiveAssignSubjectId, Math.min(12, periodsVal + 1))
                                      }
                                      className="w-7 h-7 bg-white border border-[#14B8A6] rounded text-xs font-black text-[#0F766E] cursor-pointer"
                                      aria-label="زيادة حصة"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Active chat constraints tip */}
                    <div className="p-2.5 rounded-xl bg-[#EDE9FE]/60 border border-[#8B5CF6]/40 text-xs text-[#6D28D9] flex items-center gap-2">
                      <span aria-hidden="true">✦</span>
                      <span>الشروط الخاصة (مثل إجازة يوم معين أو حصص أولى وأخيرة) يمكن طلبها مباشرة لاحقاً من <strong>وكيل الجداول الذكي</strong>.</span>
                    </div>
                  </>
                ) : (
                  <div className="p-8 text-center text-xs text-[#57534E]">
                    اختر معلماً من القائمة لإسناد الفصول والحصص له.
                  </div>
                )}
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
