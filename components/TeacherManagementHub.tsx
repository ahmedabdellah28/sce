import React, { useState, useMemo } from "react";
import {
  DAY_NAMES_AR,
  type SchoolData,
  type Teacher,
  type Section,
  type TeachingAssignment,
} from "../types.ts";
import { normAr } from "../services/schoolCore.ts";

interface TeacherManagementHubProps {
  school: SchoolData;
  onUpdateSchool: (newSchool: SchoolData, summaryMessage?: string) => void;
  onSolveSchool?: () => void;
  selectedTeacherId?: string;
  onSelectTeacherId?: (teacherId: string) => void;
}

const COMMON_EGYPTIAN_SUBJECTS = [
  { name: "اللغة العربية", defaultPeriods: 6, code: "عربي", color: "bg-blue-50 text-blue-700 border-blue-200" },
  { name: "الرياضيات", defaultPeriods: 5, code: "رياضيات", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { name: "العلوم", defaultPeriods: 4, code: "علوم", color: "bg-amber-50 text-amber-700 border-amber-200" },
  { name: "الدراسات الاجتماعية", defaultPeriods: 3, code: "دراسات", color: "bg-purple-50 text-purple-700 border-purple-200" },
  { name: "اللغة الإنجليزية", defaultPeriods: 4, code: "إنجليزي", color: "bg-rose-50 text-rose-700 border-rose-200" },
  { name: "التربية الدينية", defaultPeriods: 2, code: "دين", color: "bg-teal-50 text-teal-700 border-teal-200" },
  { name: "الحاسب الآلي", defaultPeriods: 2, code: "حاسب", color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  { name: "التربية الفنية", defaultPeriods: 2, code: "رسم", color: "bg-pink-50 text-pink-700 border-pink-200" },
  { name: "التربية الرياضية", defaultPeriods: 2, code: "ألعاب", color: "bg-orange-50 text-orange-700 border-orange-200" },
];

export default function TeacherManagementHub({
  school,
  onUpdateSchool,
  onSolveSchool,
  selectedTeacherId: externalSelectedId,
  onSelectTeacherId,
}: TeacherManagementHubProps) {
  // Search & Selection State
  const [searchQuery, setSearchQuery] = useState("");
  const [internalSelectedTeacherId, setInternalSelectedTeacherId] = useState<string>(() => {
    return externalSelectedId || school.teachers[0]?.id || "";
  });

  const activeTeacherId = externalSelectedId || internalSelectedTeacherId;

  const selectedTeacher = useMemo(() => {
    return school.teachers.find((t) => t.id === activeTeacherId) || school.teachers[0] || null;
  }, [school.teachers, activeTeacherId]);

  function handleSelectTeacher(id: string) {
    setInternalSelectedTeacherId(id);
    if (onSelectTeacherId) onSelectTeacherId(id);
  }

  // Quick Assignment Studio State
  const [selectedSubjectName, setSelectedSubjectName] = useState("اللغة العربية");
  const [customSubjectInput, setCustomSubjectInput] = useState("");
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [weeklyPeriods, setWeeklyPeriods] = useState<number>(6);
  const [actionSuccessNotice, setActionSuccessNotice] = useState<string | null>(null);

  // New Teacher Inline State
  const [newTeacherNameInput, setNewTeacherNameInput] = useState("");
  const [showAddTeacherBox, setShowAddTeacherBox] = useState(false);

  // Filtered teachers list by name or code
  const filteredTeachers = useMemo(() => {
    const q = normAr(searchQuery.trim());
    if (!q) return school.teachers;
    return school.teachers.filter(
      (t) => normAr(t.name).includes(q) || normAr(t.code || "").includes(q)
    );
  }, [school.teachers, searchQuery]);

  // Map each teacher to their assigned periods and sections
  const teacherLoadMap = useMemo(() => {
    const map = new Map<string, { totalPeriods: number; assignments: TeachingAssignment[]; sections: Section[] }>();
    for (const t of school.teachers) {
      map.set(t.id, { totalPeriods: 0, assignments: [], sections: [] });
    }
    for (const asg of school.assignments) {
      const entry = map.get(asg.teacher_id);
      if (entry) {
        entry.totalPeriods += Number(asg.weekly_periods) || 0;
        entry.assignments.push(asg);
        const sec = school.sections.find((s) => s.id === asg.section_id);
        if (sec && !entry.sections.some((s) => s.id === sec.id)) {
          entry.sections.push(sec);
        }
      }
    }
    return map;
  }, [school.teachers, school.assignments, school.sections]);

  // All available subjects in the school + standard common subjects
  const allSubjectSuggestions = useMemo(() => {
    const names = new Set<string>();
    for (const s of school.subjects) names.add(s.name);
    for (const s of COMMON_EGYPTIAN_SUBJECTS) names.add(s.name);
    return Array.from(names);
  }, [school.subjects]);

  // When subject changes, suggest optimal period count
  function handleChooseSubject(subName: string) {
    setSelectedSubjectName(subName);
    const standard = COMMON_EGYPTIAN_SUBJECTS.find((s) => normAr(s.name) === normAr(subName));
    if (standard) {
      setWeeklyPeriods(standard.defaultPeriods);
    } else {
      // Look if existing assignment has period count
      const existing = school.assignments.find((a) => {
        const sub = school.subjects.find((s) => s.id === a.subject_id);
        return sub && normAr(sub.name) === normAr(subName);
      });
      if (existing) {
        setWeeklyPeriods(existing.weekly_periods);
      }
    }
  }

  // Toggle section selection
  function toggleSection(secId: string) {
    setSelectedSectionIds((prev) =>
      prev.includes(secId) ? prev.filter((id) => id !== secId) : [...prev, secId]
    );
  }

  function selectAllSections() {
    setSelectedSectionIds(school.sections.map((s) => s.id));
  }

  function selectGradeSections(gradePrefix: string) {
    setSelectedSectionIds(
      school.sections
        .filter((s) => s.name.startsWith(`${gradePrefix}/`) || s.code.startsWith(`${gradePrefix}/`) || s.grade_id.includes(gradePrefix))
        .map((s) => s.id)
    );
  }

  function clearSectionSelection() {
    setSelectedSectionIds([]);
  }

  // Add new teacher directly
  function handleAddNewTeacher() {
    const raw = newTeacherNameInput.trim();
    if (!raw) return;
    const clean = raw.replace(/^(?:ال)?(?:[أإآا]?ستاذ|[أإآا]?ستاذه|معلم|معلمه|مدرس|مدرسه|مستر|أ\.)\s+/, "").trim();
    if (!clean) return;

    if (school.teachers.some((t) => normAr(t.name) === normAr(clean))) {
      setActionSuccessNotice(`المعلم "${clean}" موجود بالفعل.`);
      return;
    }

    const newTeacher: Teacher = {
      id: `TCH_${school.teachers.length + 1}_${Date.now().toString(36)}`,
      name: clean,
      code: clean.split(" ")[0] || clean,
      work_pattern: { day_rules: {}, daily_period_rules: [], placement_rules: [] },
    };

    const updatedSchool: SchoolData = {
      ...school,
      teachers: [...school.teachers, newTeacher],
    };

    onUpdateSchool(updatedSchool, `تمت إضافة المعلم "${clean}" بنجاح.`);
    setNewTeacherNameInput("");
    setShowAddTeacherBox(false);
    handleSelectTeacher(newTeacher.id);
  }

  // Execute Batch Assignment for current selected teacher
  function handleExecuteAssignment() {
    if (!selectedTeacher) return;
    const targetSubject = (customSubjectInput.trim() || selectedSubjectName).trim();
    if (!targetSubject) {
      setActionSuccessNotice("يرجى اختيار أو كتابة اسم المادة.");
      return;
    }
    if (selectedSectionIds.length === 0) {
      setActionSuccessNotice("يرجى تحديد فصل واحد على الأقل لإسناده للمعلم.");
      return;
    }

    // Ensure subject exists in school.subjects
    let updatedSubjects = [...school.subjects];
    let subjectObj = updatedSubjects.find((s) => normAr(s.name) === normAr(targetSubject));
    if (!subjectObj) {
      subjectObj = {
        id: `SUB_${Date.now().toString(36)}_${updatedSubjects.length + 1}`,
        name: targetSubject,
        code: targetSubject.slice(0, 4),
      };
      updatedSubjects.push(subjectObj);
    }

    // Create or update assignments for each selected section
    const updatedAssignments = [...school.assignments];
    let addedCount = 0;
    let modifiedCount = 0;

    for (const secId of selectedSectionIds) {
      const existingIdx = updatedAssignments.findIndex(
        (a) => a.teacher_id === selectedTeacher.id && a.section_id === secId && a.subject_id === subjectObj!.id
      );

      if (existingIdx >= 0) {
        updatedAssignments[existingIdx] = {
          ...updatedAssignments[existingIdx],
          weekly_periods: weeklyPeriods,
        };
        modifiedCount++;
      } else {
        updatedAssignments.push({
          id: `ASG_${Date.now().toString(36)}_${updatedAssignments.length + 1}`,
          teacher_id: selectedTeacher.id,
          section_id: secId,
          subject_id: subjectObj.id,
          weekly_periods: weeklyPeriods,
        });
        addedCount++;
      }
    }

    const updatedSchool: SchoolData = {
      ...school,
      subjects: updatedSubjects,
      assignments: updatedAssignments,
    };

    const secNames = selectedSectionIds
      .map((id) => school.sections.find((s) => s.id === id)?.name || id)
      .join("، ");

    const msg = `تم إسناد مادة "${targetSubject}" (${weeklyPeriods} حصص) للمعلم "${selectedTeacher.name}" في فصول: [${secNames}].`;
    setActionSuccessNotice(msg);
    onUpdateSchool(updatedSchool, msg);

    // Reset selection after success
    setSelectedSectionIds([]);
  }

  // Adjust periods for an existing assignment
  function handleAdjustAssignmentPeriods(assignmentId: string, delta: number) {
    if (!school) return;
    let removed = false;
    const updatedAssignments = school.assignments
      .map((a) => {
        if (a.id !== assignmentId) return a;
        const next = Math.max(0, (a.weekly_periods || 0) + delta);
        if (next === 0) {
          removed = true;
          return null;
        }
        return { ...a, weekly_periods: next };
      })
      .filter(Boolean) as TeachingAssignment[];

    const updatedSchool: SchoolData = {
      ...school,
      assignments: updatedAssignments,
    };

    const msg = removed ? "تم حذف التكليف بنجاح." : "تم تعديل نصاب الحصص.";
    onUpdateSchool(updatedSchool, msg);
  }

  // Remove single assignment
  function handleRemoveAssignment(assignmentId: string) {
    if (!school) return;
    const updatedAssignments = school.assignments.filter((a) => a.id !== assignmentId);
    const updatedSchool: SchoolData = {
      ...school,
      assignments: updatedAssignments,
    };
    onUpdateSchool(updatedSchool, "تم حذف التكليف.");
  }

  // Toggle Day Off for the selected teacher
  function handleToggleSelectedTeacherDay(day: number) {
    if (!selectedTeacher) return;
    const wp = selectedTeacher.work_pattern || { day_rules: {}, daily_period_rules: [], placement_rules: [] };
    const current = wp.day_rules?.[String(day)] || "ALLOWED";
    const next: "ALLOWED" | "MANDATORY_OFF" = current === "MANDATORY_OFF" ? "ALLOWED" : "MANDATORY_OFF";

    const updatedTeachers = school.teachers.map((t) => {
      if (t.id !== selectedTeacher.id) return t;
      return {
        ...t,
        work_pattern: {
          ...wp,
          day_rules: { ...(wp.day_rules || {}), [String(day)]: next },
        },
      };
    });

    const updatedSchool: SchoolData = {
      ...school,
      teachers: updatedTeachers,
    };

    onUpdateSchool(
      updatedSchool,
      `المعلم "${selectedTeacher.name}": يوم ${DAY_NAMES_AR[day]} ${next === "MANDATORY_OFF" ? "إجازة" : "متاح"}.`
    );
  }

  // Toggle Double Period Preference
  function handleToggleDoublePeriod(pref: "FREE" | "DOUBLE_REQUIRED" | "SINGLE_ONLY") {
    if (!selectedTeacher) return;
    const wp = selectedTeacher.work_pattern || { day_rules: {}, daily_period_rules: [], placement_rules: [] };

    const updatedTeachers = school.teachers.map((t) => {
      if (t.id !== selectedTeacher.id) return t;
      return {
        ...t,
        force_double_periods: pref === "DOUBLE_REQUIRED",
        work_pattern: {
          ...wp,
          double_period_policy: pref,
        },
      };
    });

    const updatedSchool: SchoolData = {
      ...school,
      teachers: updatedTeachers,
    };

    onUpdateSchool(
      updatedSchool,
      `المعلم "${selectedTeacher.name}": سياسة الحصص المزدوجة (${pref === "DOUBLE_REQUIRED" ? "إجبارية" : pref === "SINGLE_ONLY" ? "ممنوعة" : "حرة"}).`
    );
  }

  // Selected teacher stats
  const activeLoad = selectedTeacher ? teacherLoadMap.get(selectedTeacher.id) : null;
  const totalWeeklyQuota = activeLoad?.totalPeriods || 0;
  const maxNormalWeekly = selectedTeacher?.max_weekly_periods || 24;
  const loadPercentage = Math.min(100, Math.round((totalWeeklyQuota / maxNormalWeekly) * 100));

  return (
    <div className="space-y-4">
      {/* Top Banner & Fast Actions */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">👥</span>
              <h2 className="text-base font-extrabold text-slate-900">
                إدارة المعلمين والتكليفات الذكية
              </h2>
              <span className="bg-blue-100 text-blue-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                {school.teachers.length} معلماً مسجلاً
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              بحث واكمال تلقائي ذكي، إسناد المواد والفصول والحصص بنقرة واحدة، وضبط أيام العمل والإجازات.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddTeacherBox((v) => !v)}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
            >
              <span>➕</span>
              <span>إضافة معلم جديد</span>
            </button>
            {onSolveSchool && (
              <button
                onClick={onSolveSchool}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
              >
                <span>⚡</span>
                <span>تحديث وتوزيع الجدول</span>
              </button>
            )}
          </div>
        </div>

        {/* Inline Add Teacher Box */}
        {showAddTeacherBox && (
          <div className="mt-3 p-3 bg-blue-50/70 border border-blue-200 rounded-lg flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="flex-1">
              <input
                type="text"
                value={newTeacherNameInput}
                onChange={(e) => setNewTeacherNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddNewTeacher();
                }}
                placeholder="اكتب اسم المعلم (مثال: أستاذ محمود السيد، مس إيمان)..."
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAddNewTeacher}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-1.5 rounded-lg transition cursor-pointer"
              >
                تأكيد الإضافة
              </button>
              <button
                onClick={() => {
                  setShowAddTeacherBox(false);
                  setNewTeacherNameInput("");
                }}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* Action feedback notice */}
        {actionSuccessNotice && (
          <div className="mt-2.5 p-2 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-lg font-bold flex items-center justify-between">
            <span>✅ {actionSuccessNotice}</span>
            <button
              onClick={() => setActionSuccessNotice(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Main Grid: Left Column (Teachers Search & Selector) | Right Column (Selected Teacher Studio) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Teachers Directory & Search (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
              <span>🔍 البحث السريع عن المعلم</span>
              <span className="text-[11px] text-slate-400">({filteredTeachers.length})</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="اكتب اسم أو كود المعلم..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Teacher quick create prompt if search has no results */}
          {filteredTeachers.length === 0 && searchQuery.trim().length > 1 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-center space-y-2">
              <p className="text-xs text-amber-800">
                لم يتم العثور على معلم باسم &quot;{searchQuery}&quot;
              </p>
              <button
                onClick={() => {
                  setNewTeacherNameInput(searchQuery);
                  handleAddNewTeacher();
                }}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer"
              >
                ➕ إضافة &quot;{searchQuery}&quot; كمعلم جديد
              </button>
            </div>
          )}

          {/* Teachers Scroll List */}
          <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-0.5">
            {filteredTeachers.map((t) => {
              const load = teacherLoadMap.get(t.id);
              const periods = load?.totalPeriods || 0;
              const isSelected = selectedTeacher?.id === t.id;
              const offDaysCount = Object.values(t.work_pattern?.day_rules || {}).filter(
                (r) => r === "MANDATORY_OFF"
              ).length;

              return (
                <div
                  key={t.id}
                  onClick={() => handleSelectTeacher(t.id)}
                  className={`p-2.5 rounded-lg border transition cursor-pointer flex items-center justify-between text-xs ${
                    isSelected
                      ? "bg-blue-50/80 border-blue-500 shadow-2xs font-bold"
                      : "bg-slate-50/60 border-slate-200 hover:bg-slate-100/80 hover:border-slate-300"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900 truncate">{t.name}</span>
                      {offDaysCount > 0 && (
                        <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded-full font-bold whitespace-nowrap">
                          {offDaysCount} أوف
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>كود: {t.code || t.name.split(" ")[0]}</span>
                      <span>•</span>
                      <span>{load?.sections.length || 0} فصول</span>
                    </div>
                  </div>

                  <div className="text-left shrink-0 pl-1">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        periods >= 24
                          ? "bg-rose-100 text-rose-800"
                          : periods > 18
                          ? "bg-amber-100 text-amber-800"
                          : periods > 0
                          ? "bg-blue-100 text-blue-800"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {periods} حصة
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Teacher Hub & Quick Assignment Studio (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {selectedTeacher ? (
            <>
              {/* Teacher Header & Workload Bar */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-extrabold text-slate-900">
                        الأستاذ/ة: {selectedTeacher.name}
                      </h3>
                      <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded-md font-mono">
                        {selectedTeacher.code || selectedTeacher.name.split(" ")[0]}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      مسند إليه حالياً {totalWeeklyQuota} حصة عبر {activeLoad?.sections.length || 0} فصول مختلفة.
                    </p>
                  </div>

                  {/* Workload Pill */}
                  <div className="flex items-center gap-2">
                    <div className="text-left">
                      <div className="text-xs font-bold text-slate-700">النصاب الأسبوعي</div>
                      <div className="text-xs text-slate-500">
                        {totalWeeklyQuota} من {maxNormalWeekly} حصة ({loadPercentage}%)
                      </div>
                    </div>
                    <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                      <div
                        className={`h-full transition-all duration-300 ${
                          loadPercentage > 100
                            ? "bg-rose-500"
                            : loadPercentage >= 80
                            ? "bg-emerald-500"
                            : "bg-blue-500"
                        }`}
                        style={{ width: `${Math.min(100, loadPercentage)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Days of Week & Availability Controls for this Teacher */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">أيام الحضور والإجازات للمعلم:</span>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-slate-500">الحصص المزدوجة:</span>
                      <button
                        onClick={() => handleToggleDoublePeriod("DOUBLE_REQUIRED")}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                          selectedTeacher.work_pattern?.double_period_policy === "DOUBLE_REQUIRED"
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        إجبارية
                      </button>
                      <button
                        onClick={() => handleToggleDoublePeriod("FREE")}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                          !selectedTeacher.work_pattern?.double_period_policy ||
                          selectedTeacher.work_pattern?.double_period_policy === "FREE"
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        حرة
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {school.days.map((d) => {
                      const isOff = selectedTeacher.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF";
                      return (
                        <button
                          key={d}
                          onClick={() => handleToggleSelectedTeacherDay(d)}
                          className={`p-2 rounded-lg border text-xs font-bold transition flex flex-col items-center justify-center gap-1 cursor-pointer ${
                            isOff
                              ? "bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100"
                              : "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                          }`}
                        >
                          <span>{DAY_NAMES_AR[d]}</span>
                          <span className="text-[10px] font-medium">
                            {isOff ? "إجازة ✗" : "متاح ✓"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Smart Quick Assignment Studio ("استوديو الإسناد السريع") */}
              <div className="bg-white rounded-xl border border-blue-200 shadow-xs p-4 space-y-4">
                <div className="flex items-center gap-2 border-b border-blue-100 pb-2.5">
                  <span className="text-base">⚡</span>
                  <h4 className="text-sm font-extrabold text-blue-950">
                    استوديو الإسناد السريع للمعلم: {selectedTeacher.name}
                  </h4>
                </div>

                {/* Step 1: Subject Selection with Egyptian Standard Autocomplete Chips */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-800 flex items-center justify-between">
                    <span>1. اختر أو اكتب المادة الدراسية:</span>
                    <span className="text-[11px] text-blue-600 font-normal">
                      المختارة حالياً: <b className="font-bold">{customSubjectInput || selectedSubjectName}</b>
                    </span>
                  </label>

                  {/* Standard Egyptian Quick Subject Chips */}
                  <div className="flex flex-wrap gap-1.5">
                    {COMMON_EGYPTIAN_SUBJECTS.map((sub) => {
                      const isSelected =
                        !customSubjectInput && normAr(selectedSubjectName) === normAr(sub.name);
                      return (
                        <button
                          key={sub.name}
                          type="button"
                          onClick={() => {
                            setCustomSubjectInput("");
                            handleChooseSubject(sub.name);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                            isSelected
                              ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                              : `${sub.color} hover:opacity-80`
                          }`}
                        >
                          {sub.name} ({sub.defaultPeriods}ح)
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom Subject Autocomplete Input */}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={customSubjectInput}
                      onChange={(e) => {
                        setCustomSubjectInput(e.target.value);
                        if (e.target.value) handleChooseSubject(e.target.value);
                      }}
                      list="school-subjects-list"
                      placeholder="أو اكتب اسم مادة مخصصة (مثال: لغة فرنسية، دراسات، نشاط)..."
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                    <datalist id="school-subjects-list">
                      {allSubjectSuggestions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {/* Step 2: Target Sections Selection (Multi-select Pills) */}
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <label className="text-xs font-bold text-slate-800">
                      2. حدد الفصول المستهدفة ({selectedSectionIds.length} فصول محددة):
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={selectAllSections}
                        className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-bold cursor-pointer"
                      >
                        الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => selectGradeSections("1")}
                        className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-bold cursor-pointer"
                      >
                        أولى
                      </button>
                      <button
                        type="button"
                        onClick={() => selectGradeSections("2")}
                        className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-bold cursor-pointer"
                      >
                        ثانية
                      </button>
                      <button
                        type="button"
                        onClick={() => selectGradeSections("3")}
                        className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-bold cursor-pointer"
                      >
                        ثالثة
                      </button>
                      {selectedSectionIds.length > 0 && (
                        <button
                          type="button"
                          onClick={clearSectionSelection}
                          className="text-[11px] text-rose-600 hover:text-rose-800 px-1 font-bold cursor-pointer"
                        >
                          مسح
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-8 gap-1.5 max-h-40 overflow-y-auto p-1 bg-slate-50 rounded-lg border border-slate-200">
                    {school.sections.map((sec) => {
                      const isSelected = selectedSectionIds.includes(sec.id);
                      // Check if already assigned this subject to this section
                      const alreadyAssigned = activeLoad?.assignments.some((a) => a.section_id === sec.id);

                      return (
                        <button
                          key={sec.id}
                          type="button"
                          onClick={() => toggleSection(sec.id)}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition flex flex-col items-center justify-center cursor-pointer ${
                            isSelected
                              ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                              : alreadyAssigned
                              ? "bg-blue-50/70 border-blue-200 text-blue-800 hover:bg-blue-100"
                              : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                          }`}
                        >
                          <span>{sec.name}</span>
                          {alreadyAssigned && !isSelected && (
                            <span className="text-[9px] text-blue-600">مسند سابقاً</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Step 3: Weekly Periods Count & Multiplier Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center bg-blue-50/50 p-3 rounded-lg border border-blue-100">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-800">
                      3. عدد الحصص الأسبوعية لكل فصل:
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setWeeklyPeriods((v) => Math.max(1, v - 1))}
                        className="w-7 h-7 bg-white border border-slate-300 hover:bg-slate-100 rounded-md text-xs font-bold flex items-center justify-center cursor-pointer"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min="1"
                        max="12"
                        value={weeklyPeriods}
                        onChange={(e) => setWeeklyPeriods(Math.max(1, Number(e.target.value) || 1))}
                        className="w-14 bg-white border border-slate-300 rounded-md text-center py-1 text-xs font-extrabold text-blue-900"
                      />
                      <button
                        type="button"
                        onClick={() => setWeeklyPeriods((v) => v + 1)}
                        className="w-7 h-7 bg-white border border-slate-300 hover:bg-slate-100 rounded-md text-xs font-bold flex items-center justify-center cursor-pointer"
                      >
                        +
                      </button>

                      {/* Quick period buttons */}
                      <div className="flex items-center gap-1 mr-2">
                        {[2, 3, 4, 5, 6].map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setWeeklyPeriods(p)}
                            className={`w-6 h-6 rounded text-[11px] font-bold cursor-pointer ${
                              weeklyPeriods === p
                                ? "bg-blue-600 text-white"
                                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Summary & Execute Button */}
                  <div className="text-left space-y-1.5">
                    <div className="text-xs text-slate-600">
                      الإجمالي المضاف:{" "}
                      <span className="font-extrabold text-blue-700">
                        {selectedSectionIds.length} فصول × {weeklyPeriods} حصص ={" "}
                        {selectedSectionIds.length * weeklyPeriods} حصة
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleExecuteAssignment}
                      disabled={selectedSectionIds.length === 0}
                      className={`w-full py-2 px-4 rounded-lg text-xs font-extrabold transition flex items-center justify-center gap-1.5 shadow-2xs ${
                        selectedSectionIds.length > 0
                          ? "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                          : "bg-slate-200 text-slate-400 cursor-not-allowed"
                      }`}
                    >
                      <span>🚀</span>
                      <span>إسناد الحصص للمعلم ({selectedTeacher.name})</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Assignments List for this Teacher */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📋</span>
                    <h4 className="text-xs font-extrabold text-slate-900">
                      التكليفات الحالية المسندة للأستاذ/ة {selectedTeacher.name} (
                      {activeLoad?.assignments.length || 0} تكليف)
                    </h4>
                  </div>
                  <span className="text-xs font-bold text-slate-600">
                    مجموع الحصص: {totalWeeklyQuota} حصة
                  </span>
                </div>

                {activeLoad && activeLoad.assignments.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-right border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                          <th className="p-2.5">المادة</th>
                          <th className="p-2.5">الفصل</th>
                          <th className="p-2.5 text-center">الحصص الأسبوعية</th>
                          <th className="p-2.5 text-center">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeLoad.assignments.map((asg) => {
                          const sub = school.subjects.find((s) => s.id === asg.subject_id);
                          const sec = school.sections.find((s) => s.id === asg.section_id);

                          return (
                            <tr key={asg.id} className="hover:bg-slate-50/80 transition">
                              <td className="p-2.5 font-bold text-slate-900">
                                {sub?.name || asg.subject_id}
                              </td>
                              <td className="p-2.5">
                                <span className="bg-slate-100 text-slate-800 font-bold px-2 py-0.5 rounded text-xs">
                                  {sec?.name || asg.section_id}
                                </span>
                              </td>
                              <td className="p-2.5 text-center">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleAdjustAssignmentPeriods(asg.id, -1)}
                                    className="w-5 h-5 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 font-bold flex items-center justify-center cursor-pointer"
                                    title="تقليل حصة"
                                  >
                                    −
                                  </button>
                                  <span className="font-extrabold text-slate-900 w-6 text-center">
                                    {asg.weekly_periods}
                                  </span>
                                  <button
                                    onClick={() => handleAdjustAssignmentPeriods(asg.id, 1)}
                                    className="w-5 h-5 bg-slate-100 hover:bg-slate-200 rounded text-slate-700 font-bold flex items-center justify-center cursor-pointer"
                                    title="زيادة حصة"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td className="p-2.5 text-center">
                                <button
                                  onClick={() => handleRemoveAssignment(asg.id)}
                                  className="text-rose-600 hover:text-rose-800 font-bold text-xs p-1 hover:bg-rose-50 rounded transition cursor-pointer"
                                  title="حذف هذا التكليف"
                                >
                                  🗑️ حذف
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-slate-400 bg-slate-50/50 rounded-lg border border-dashed border-slate-200">
                    لا توجد أي تكليفات مسندة لهذا المعلم بعد. استخدم &quot;استوديو الإسناد السريع&quot; أعلاه
                    لإسناد المواد والفصول.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
              اختر معلماً من القائمة الجانبية أو اضغط على &quot;إضافة معلم جديد&quot; للبدء.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
