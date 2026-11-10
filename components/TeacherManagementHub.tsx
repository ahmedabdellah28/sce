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

export default function TeacherManagementHub({
  school,
  onUpdateSchool,
  onSolveSchool,
  selectedTeacherId: externalSelectedId,
  onSelectTeacherId,
}: TeacherManagementHubProps) {
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

  // Inline Add Teacher State (Name + Subject + Weekly Quota — no code shown to user)
  const [showAddTeacherBox, setShowAddTeacherBox] = useState(false);
  const [newTeacherNameInput, setNewTeacherNameInput] = useState("");
  const [newTeacherSubjectId, setNewTeacherSubjectId] = useState<string>(() => school.subjects[0]?.id || "");
  const [newTeacherQuota, setNewTeacherQuota] = useState<number>(24);

  // Active Subject in Assignment Studio
  const [activeSubjectId, setActiveSubjectId] = useState<string>("");
  const [showAllSubjects, setShowAllSubjects] = useState<boolean>(false);
  const [actionSuccessNotice, setActionSuccessNotice] = useState<string | null>(null);

  // Helper: infer teacher specialty from explicit subject_ids or existing assignments
  function getTeacherSubjectIds(t: Teacher): string[] {
    if (t.subject_ids && t.subject_ids.length > 0) return t.subject_ids;
    const inferred = new Set<string>();
    for (const a of school.assignments) {
      if (a.teacher_id === t.id && a.subject_id) inferred.add(a.subject_id);
    }
    return Array.from(inferred);
  }

  const selectedTeacherSubjIds = useMemo(() => {
    if (!selectedTeacher) return [];
    return getTeacherSubjectIds(selectedTeacher);
  }, [selectedTeacher, school.assignments]);

  const effectiveSubjectId = useMemo(() => {
    if (activeSubjectId && school.subjects.some((s) => s.id === activeSubjectId)) {
      if (showAllSubjects || selectedTeacherSubjIds.length === 0 || selectedTeacherSubjIds.includes(activeSubjectId)) {
        return activeSubjectId;
      }
    }
    return selectedTeacherSubjIds[0] || school.subjects[0]?.id || "";
  }, [activeSubjectId, school.subjects, showAllSubjects, selectedTeacherSubjIds]);

  // Filtered teachers list (search by name or specialty subject)
  const filteredTeachers = useMemo(() => {
    const q = normAr(searchQuery.trim());
    if (!q) return school.teachers;
    return school.teachers.filter((t) => {
      if (normAr(t.name).includes(q)) return true;
      const subjNames = getTeacherSubjectIds(t)
        .map((sid) => school.subjects.find((sub) => sub.id === sid)?.name || "")
        .join(" ");
      return normAr(subjNames).includes(q);
    });
  }, [school.teachers, school.subjects, school.assignments, searchQuery]);

  // Map each teacher to their assigned periods, assignments, and sections
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

  function getSubjectDefaultPeriodsForSection(sectionId: string, subjectId: string): number {
    const existing = school.assignments.find((a) => a.section_id === sectionId && a.subject_id === subjectId);
    if (existing && existing.weekly_periods > 0) return existing.weekly_periods;
    const sec = school.sections.find((s) => s.id === sectionId);
    if (sec) {
      const sameGradeAsgn = school.assignments.find((a) => {
        const otherSec = school.sections.find((sItem) => sItem.id === a.section_id);
        return otherSec?.grade_id === sec.grade_id && a.subject_id === subjectId && a.weekly_periods > 0;
      });
      if (sameGradeAsgn) return sameGradeAsgn.weekly_periods;
    }
    const anySubjAsgn = school.assignments.find((a) => a.subject_id === subjectId && a.weekly_periods > 0);
    return anySubjAsgn?.weekly_periods || 4;
  }

  function handleAddNewTeacher() {
    const clean = newTeacherNameInput.trim();
    if (!clean) return;
    if (school.teachers.some((t) => normAr(t.name) === normAr(clean))) {
      setActionSuccessNotice(`المعلم "${clean}" مسجل بالفعل.`);
      return;
    }

    const subjId = newTeacherSubjectId || school.subjects[0]?.id;
    const newId = `TCH_${Date.now().toString(36)}_${school.teachers.length + 1}`;
    const autoCode = clean.split(" ")[0] || `م${school.teachers.length + 1}`;
    const newTeacher: Teacher = {
      id: newId,
      name: clean,
      code: autoCode,
      subject_ids: subjId ? [subjId] : [],
      max_daily_periods: 7,
      max_weekly_periods: Math.max(1, newTeacherQuota || 24),
      max_consecutive_periods: 2,
      work_pattern: { day_rules: {}, daily_period_rules: [], placement_rules: [] },
    };

    const updatedSchool: SchoolData = {
      ...school,
      teachers: [...school.teachers, newTeacher],
    };

    onUpdateSchool(updatedSchool, `تمت إضافة "${clean}" وتحديد مادته بنجاح.`);
    setNewTeacherNameInput("");
    setShowAddTeacherBox(false);
    handleSelectTeacher(newTeacher.id);
    if (subjId) setActiveSubjectId(subjId);
  }

  function handleUpdateTeacherSpecialty(teacherId: string, subjectId: string) {
    const updatedTeachers = school.teachers.map((t) => {
      if (t.id !== teacherId) return t;
      const cur = getTeacherSubjectIds(t);
      const exists = cur.includes(subjectId);
      const next = exists ? cur.filter((id) => id !== subjectId) : [...cur, subjectId];
      return { ...t, subject_ids: next };
    });
    onUpdateSchool({ ...school, teachers: updatedTeachers }, "تم تحديث تخصص المعلم.");
  }

  function handleUpdateTeacherQuota(teacherId: string, quota: number) {
    const cleanQuota = Math.max(1, Math.min(36, quota || 24));
    const updatedTeachers = school.teachers.map((t) =>
      t.id === teacherId ? { ...t, max_weekly_periods: cleanQuota } : t
    );
    onUpdateSchool({ ...school, teachers: updatedTeachers });
  }

  function handleToggleSectionAssignment(sectionId: string) {
    if (!selectedTeacher || !effectiveSubjectId) return;
    const updatedAssignments = [...school.assignments];
    const existingIdx = updatedAssignments.findIndex(
      (a) => a.section_id === sectionId && a.subject_id === effectiveSubjectId
    );

    const secName = school.sections.find((s) => s.id === sectionId)?.name || sectionId;
    const subName = school.subjects.find((s) => s.id === effectiveSubjectId)?.name || effectiveSubjectId;

    if (existingIdx >= 0) {
      const cur = updatedAssignments[existingIdx];
      if (cur.teacher_id === selectedTeacher.id) {
        updatedAssignments[existingIdx] = { ...cur, teacher_id: "" };
        setActionSuccessNotice(`تم إلغاء إسناد فصل ${secName} (${subName}) من ${selectedTeacher.name}.`);
      } else {
        updatedAssignments[existingIdx] = { ...cur, teacher_id: selectedTeacher.id };
        setActionSuccessNotice(`تم إسناد فصل ${secName} (${subName}) إلى ${selectedTeacher.name}.`);
      }
    } else {
      const defaultPeriods = getSubjectDefaultPeriodsForSection(sectionId, effectiveSubjectId);
      updatedAssignments.push({
        id: `ASG_${Date.now().toString(36)}_${updatedAssignments.length + 1}`,
        section_id: sectionId,
        subject_id: effectiveSubjectId,
        teacher_id: selectedTeacher.id,
        weekly_periods: defaultPeriods,
      });
      setActionSuccessNotice(`تم إسناد فصل ${secName} (${subName} - ${defaultPeriods} حصص) إلى ${selectedTeacher.name}.`);
    }

    onUpdateSchool({ ...school, assignments: updatedAssignments });
  }

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

    onUpdateSchool(
      { ...school, assignments: updatedAssignments },
      removed ? "تم حذف التكليف." : "تم تحديث عدد الحصص."
    );
  }

  function handleRemoveAssignment(assignmentId: string) {
    const updatedAssignments = school.assignments.filter((a) => a.id !== assignmentId);
    onUpdateSchool({ ...school, assignments: updatedAssignments }, "تم حذف الإسناد.");
  }

  function handleClearDayOffRule(teacherId: string, dayStr: string) {
    const updatedTeachers = school.teachers.map((t) => {
      if (t.id !== teacherId) return t;
      const dayRules = { ...(t.work_pattern?.day_rules || {}) };
      delete dayRules[dayStr];
      return {
        ...t,
        work_pattern: {
          daily_period_rules: t.work_pattern?.daily_period_rules || [],
          placement_rules: t.work_pattern?.placement_rules || [],
          ...t.work_pattern,
          day_rules: dayRules,
        },
      };
    });
    onUpdateSchool({ ...school, teachers: updatedTeachers }, "تمت إزالة شرط الإجازة.");
  }

  function handleDeleteTeacher(teacherId: string) {
    const tch = school.teachers.find((t) => t.id === teacherId);
    if (!tch) return;
    const updatedSchool: SchoolData = {
      ...school,
      teachers: school.teachers.filter((t) => t.id !== teacherId),
      assignments: school.assignments.filter((a) => a.teacher_id !== teacherId),
    };
    onUpdateSchool(updatedSchool, `تم حذف المعلم "${tch.name}".`);
  }

  const activeLoad = selectedTeacher ? teacherLoadMap.get(selectedTeacher.id) : null;
  const totalWeeklyQuota = activeLoad?.totalPeriods || 0;
  const maxNormalWeekly = selectedTeacher?.max_weekly_periods || 24;
  const loadPercentage = Math.min(100, Math.round((totalWeeklyQuota / Math.max(1, maxNormalWeekly)) * 100));
  const overQuota = totalWeeklyQuota > maxNormalWeekly;

  const activeOffDays = selectedTeacher
    ? Object.entries(selectedTeacher.work_pattern?.day_rules || {})
        .filter(([, rule]) => rule === "MANDATORY_OFF")
        .map(([dStr]) => dStr)
    : [];

  return (
    <div className="space-y-4">
      {/* Top Action Bar */}
      <div className="bg-white rounded-xl border border-[#E7E5E4] p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-[#1C1917]">
              هيئة التدريس وإسناد الفصول
            </h2>
            <p className="text-xs text-[#57534E] mt-0.5">
              أضف المعلم وحدد مادته ونصابه، ثم اختر الفصول بضغطة واحدة — وتُدار أي شروط إضافية عبر وكيل الشات الذكي
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!newTeacherSubjectId && school.subjects[0]) setNewTeacherSubjectId(school.subjects[0].id);
                setShowAddTeacherBox(!showAddTeacherBox);
              }}
              className="bg-[#FFFFFF] hover:bg-[#FAFAF9] text-[#1C1917] border border-[#E7E5E4] text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition cursor-pointer"
            >
              <span>+ إضافة معلم جديد</span>
            </button>
            {onSolveSchool && (
              <button
                type="button"
                onClick={onSolveSchool}
                className="bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-xs"
              >
                <span>⚡</span>
                <span>تحديث وتوزيع الجدول</span>
              </button>
            )}
          </div>
        </div>

        {/* Inline Add Teacher Box (Name + Specialty Subject + Quota) */}
        {showAddTeacherBox && (
          <div className="mt-3 p-3.5 bg-[#CCFBF1]/35 border border-[#14B8A6] rounded-xl grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
            <div className="sm:col-span-5">
              <label className="text-[11px] font-bold text-[#1C1917] block mb-1">اسم المعلم:</label>
              <input
                type="text"
                value={newTeacherNameInput}
                onChange={(e) => setNewTeacherNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddNewTeacher();
                }}
                placeholder="مثال: أ. أحمد محمود"
                className="w-full bg-white border border-[#D6D3D1] rounded-lg px-3 py-2 text-xs font-bold text-[#1C1917] placeholder:text-[#57534E] focus:outline-hidden focus:ring-2 focus:ring-[#0F766E]"
                autoFocus
              />
            </div>

            <div className="sm:col-span-3">
              <label className="text-[11px] font-bold text-[#1C1917] block mb-1">المادة / التخصص:</label>
              <select
                value={newTeacherSubjectId}
                onChange={(e) => setNewTeacherSubjectId(e.target.value)}
                className="w-full bg-white border border-[#D6D3D1] rounded-lg px-2.5 py-2 text-xs font-bold text-[#1C1917] focus:outline-hidden focus:ring-2 focus:ring-[#0F766E]"
              >
                {school.subjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="text-[11px] font-bold text-[#1C1917] block mb-1">النصاب:</label>
              <input
                type="number"
                min={1}
                max={36}
                value={newTeacherQuota}
                onChange={(e) => setNewTeacherQuota(Math.max(1, Number(e.target.value) || 24))}
                className="w-full bg-white border border-[#D6D3D1] rounded-lg px-2.5 py-2 text-xs font-bold text-center text-[#1C1917] tabular-nums"
              />
            </div>

            <div className="sm:col-span-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleAddNewTeacher}
                className="flex-1 bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold px-3 py-2 rounded-lg transition cursor-pointer"
              >
                إضافة
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddTeacherBox(false);
                  setNewTeacherNameInput("");
                }}
                className="bg-white hover:bg-[#FAFAF9] border border-[#E7E5E4] text-[#57534E] text-xs font-bold px-2.5 py-2 rounded-lg transition cursor-pointer"
                aria-label="إلغاء"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Action feedback notice */}
        {actionSuccessNotice && (
          <div className="mt-3 p-2.5 bg-[#CCFBF1]/50 border border-[#14B8A6] text-[#0F766E] text-xs rounded-xl font-bold flex items-center justify-between">
            <span>✓ {actionSuccessNotice}</span>
            <button
              type="button"
              onClick={() => setActionSuccessNotice(null)}
              aria-label="إغلاق الإشعار"
              className="text-[#0F766E] hover:text-[#115E59] text-xs font-bold px-2 py-1 rounded cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Main Grid: Start Column (Teachers Search & Selector) | End Column (Assignment Studio) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Teachers Directory (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-[#E7E5E4] p-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#1C1917] flex items-center justify-between">
              <span>قائمة المعلمين</span>
              <span className="text-xs text-[#57534E] tabular-nums">({filteredTeachers.length})</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث بالاسم أو المادة..."
                className="w-full bg-[#FAFAF9] border border-[#D6D3D1] rounded-lg px-3 py-2 pe-8 text-xs text-[#1C1917] placeholder:text-[#57534E] focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#0F766E]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="مسح البحث"
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 text-[#57534E] hover:text-[#1C1917] text-xs cursor-pointer p-1"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5 max-h-[520px] overflow-y-auto pe-0.5">
            {filteredTeachers.map((t) => {
              const load = teacherLoadMap.get(t.id);
              const periods = load?.totalPeriods || 0;
              const maxQ = t.max_weekly_periods || 24;
              const isSelected = selectedTeacher?.id === t.id;
              const tSubjNames = getTeacherSubjectIds(t)
                .map((sid) => school.subjects.find((sub) => sub.id === sid)?.name)
                .filter(Boolean)
                .join("، ");
              const offDaysCount = Object.values(t.work_pattern?.day_rules || {}).filter(
                (r) => r === "MANDATORY_OFF"
              ).length;

              return (
                <div
                  key={t.id}
                  onClick={() => handleSelectTeacher(t.id)}
                  className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between gap-2 text-xs ${
                    isSelected
                      ? "bg-[#CCFBF1]/55 border-[#14B8A6] shadow-2xs font-bold"
                      : "bg-[#FAFAF9] border-[#E7E5E4] hover:bg-white hover:border-[#D6D3D1]"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-[#1C1917] truncate">{t.name}</span>
                      {offDaysCount > 0 && (
                        <span className="text-[10px] bg-[#EDE9FE] text-[#6D28D9] px-1.5 py-0.2 rounded-full font-bold whitespace-nowrap">
                          {offDaysCount} شرط
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#57534E] mt-0.5 truncate">
                      {tSubjNames || "غير محدد التخصص"} • {load?.sections.length || 0} فصول
                    </div>
                  </div>

                  <div className="text-end shrink-0 ps-1">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${
                        periods > maxQ
                          ? "bg-[#FFF1F2] text-[#BE123C] border border-[#FB7185]"
                          : periods > 0
                          ? "bg-[#CCFBF1] text-[#0F766E]"
                          : "bg-[#E7E5E4] text-[#57534E]"
                      }`}
                    >
                      {periods} / {maxQ}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Teacher Assignment Studio (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {selectedTeacher ? (
            <>
              {/* Teacher Profile + Specialty + Quota + Active Chat Constraints */}
              <div className="bg-white rounded-xl border border-[#E7E5E4] p-4 shadow-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E7E5E4] pb-3">
                  <div>
                    <h3 className="text-base font-extrabold text-[#1C1917]">
                      {selectedTeacher.name}
                    </h3>
                    <p className="text-xs text-[#57534E] mt-0.5 tabular-nums">
                      المُسند: <strong className="text-[#1C1917]">{totalWeeklyQuota}</strong> حصة عبر{" "}
                      <strong className="text-[#1C1917]">{activeLoad?.sections.length || 0}</strong> فصول —{" "}
                      {maxNormalWeekly - totalWeeklyQuota >= 0
                        ? `المتبقي من النصاب: ${maxNormalWeekly - totalWeeklyQuota} حصة`
                        : `تجاوز النصاب بـ ${totalWeeklyQuota - maxNormalWeekly} حصة!`}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs font-bold text-[#57534E]">النصاب:</label>
                      <input
                        type="number"
                        min={1}
                        max={36}
                        value={maxNormalWeekly}
                        onChange={(e) => handleUpdateTeacherQuota(selectedTeacher.id, Number(e.target.value))}
                        className="w-16 bg-white border border-[#D6D3D1] rounded-lg px-2 py-1 text-xs font-extrabold text-center text-[#1C1917] tabular-nums"
                      />
                    </div>
                    <div className="w-20 h-2 bg-[#FAFAF9] rounded-full overflow-hidden border border-[#E7E5E4]">
                      <div
                        className={`h-full transition-all duration-300 ${overQuota ? "bg-[#BE123C]" : "bg-[#0F766E]"}`}
                        style={{ width: `${Math.min(100, loadPercentage)}%` }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteTeacher(selectedTeacher.id)}
                      className="text-xs font-bold text-[#BE123C] hover:bg-[#FFF1F2] px-2.5 py-1.5 rounded-lg border border-transparent hover:border-[#FB7185] transition cursor-pointer"
                      title="حذف المعلم"
                    >
                      حذف
                    </button>
                  </div>
                </div>

                {/* Specialty Subject Selection */}
                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-[#1C1917] block">التخصص / المواد التي يدرّسها:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {school.subjects.map((sub) => {
                      const hasSub = selectedTeacherSubjIds.includes(sub.id);
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => handleUpdateTeacherSpecialty(selectedTeacher.id, sub.id)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition cursor-pointer ${
                            hasSub
                              ? "bg-[#CCFBF1] text-[#0F766E] border-[#14B8A6]"
                              : "bg-[#FAFAF9] text-[#57534E] border-[#E7E5E4] hover:border-[#D6D3D1]"
                          }`}
                        >
                          {hasSub ? `✓ ${sub.name}` : `+ ${sub.name}`}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Active Constraints from AI Chat + Tip */}
                <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                  {activeOffDays.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-bold text-[#6D28D9]">الشروط المطبقة من الوكيل:</span>
                      {activeOffDays.map((dStr) => (
                        <span
                          key={dStr}
                          className="inline-flex items-center gap-1.5 bg-[#EDE9FE] text-[#6D28D9] text-xs font-bold px-2.5 py-1 rounded-lg"
                        >
                          <span>إجازة: {DAY_NAMES_AR[Number(dStr)]}</span>
                          <button
                            type="button"
                            onClick={() => handleClearDayOffRule(selectedTeacher.id, dStr)}
                            className="hover:text-[#BE123C] font-black cursor-pointer"
                            aria-label={`إلغاء إجازة ${DAY_NAMES_AR[Number(dStr)]}`}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="w-full p-2.5 rounded-xl bg-[#EDE9FE]/55 border border-[#8B5CF6]/35 text-xs text-[#6D28D9] flex items-center gap-2">
                      <span aria-hidden="true">✦</span>
                      <span>
                        لإضافة إجازات أو شروط حصص أولى وأخيرة لهذا المعلم، اطلب ذلك مباشرة من <strong>وكيل الجداول الذكي</strong> في الشات.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 1-Click Section Picker with Auto-Filled Periods */}
              <div className="bg-white rounded-xl border border-[#E7E5E4] p-4 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E7E5E4] pb-2.5">
                  <div>
                    <h4 className="text-sm font-extrabold text-[#1C1917]">
                      تعيين الفصول والحصص
                    </h4>
                    <p className="text-xs text-[#57534E]">
                      اضغط على الفصل لإسناده أو إلغائه — تُملأ عدد الحصص تلقائياً ويمكنك تعديلها
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAllSubjects(!showAllSubjects)}
                    className="text-xs font-bold text-[#0F766E] hover:underline cursor-pointer"
                  >
                    {showAllSubjects ? "عرض تخصص المعلم فقط" : "اختيار أي مادة أخرى"}
                  </button>
                </div>

                {/* Subject Pills */}
                <div className="flex flex-wrap gap-1.5">
                  {(showAllSubjects || selectedTeacherSubjIds.length === 0
                    ? school.subjects
                    : school.subjects.filter((sub) => selectedTeacherSubjIds.includes(sub.id))
                  ).map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setActiveSubjectId(sub.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                        effectiveSubjectId === sub.id
                          ? "bg-[#0F766E] text-white border-[#0F766E]"
                          : "bg-[#FAFAF9] text-[#1C1917] border-[#E7E5E4] hover:border-[#14B8A6]"
                      }`}
                    >
                      {sub.name}
                    </button>
                  ))}
                </div>

                {/* Sections Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[260px] overflow-y-auto p-1">
                  {school.sections.map((sec) => {
                    const asgn = school.assignments.find(
                      (a) => a.section_id === sec.id && a.subject_id === effectiveSubjectId
                    );
                    const isAssignedToThis = asgn?.teacher_id === selectedTeacher.id;
                    const assignedOther =
                      asgn?.teacher_id && asgn.teacher_id !== selectedTeacher.id
                        ? school.teachers.find((t) => t.id === asgn.teacher_id)
                        : null;
                    const pCount = asgn?.weekly_periods || getSubjectDefaultPeriodsForSection(sec.id, effectiveSubjectId);

                    return (
                      <div
                        key={sec.id}
                        className={`p-2.5 rounded-xl border transition flex flex-col justify-between gap-2 ${
                          isAssignedToThis
                            ? "bg-[#CCFBF1]/55 border-[#14B8A6] shadow-2xs"
                            : assignedOther
                            ? "bg-[#FAFAF9] border-[#E7E5E4] opacity-85"
                            : "bg-white border-[#E7E5E4] hover:border-[#14B8A6]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleToggleSectionAssignment(sec.id)}
                          className="w-full text-start cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-extrabold text-xs text-[#1C1917]">{sec.name}</span>
                            <span className={`text-xs font-black ${isAssignedToThis ? "text-[#0F766E]" : "text-[#57534E]"}`}>
                              {isAssignedToThis ? "✓" : "+"}
                            </span>
                          </div>
                          {assignedOther && (
                            <div className="text-[10px] text-[#57534E] truncate mt-0.5">
                              مع: {assignedOther.name}
                            </div>
                          )}
                        </button>

                        {isAssignedToThis && asgn && (
                          <div className="flex items-center justify-between pt-1 border-t border-[#14B8A6]/40">
                            <span className="text-[11px] font-bold text-[#0F766E]">الحصص:</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleAdjustAssignmentPeriods(asgn.id, -1)}
                                className="w-7 h-7 bg-white border border-[#14B8A6] rounded text-xs font-black text-[#0F766E] cursor-pointer"
                                aria-label="تقليل حصة"
                              >
                                −
                              </button>
                              <span className="w-6 text-center text-xs font-black text-[#1C1917] tabular-nums">
                                {pCount}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleAdjustAssignmentPeriods(asgn.id, 1)}
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

              {/* Active Assignments Table */}
              <div className="bg-white rounded-xl border border-[#E7E5E4] p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-[#E7E5E4] pb-2">
                  <h4 className="text-xs font-extrabold text-[#1C1917]">
                    التكليفات المسندة لـ {selectedTeacher.name} ({activeLoad?.assignments.length || 0})
                  </h4>
                  <span className="text-xs font-bold text-[#57534E] tabular-nums">
                    المجموع: {totalWeeklyQuota} حصة
                  </span>
                </div>

                {activeLoad && activeLoad.assignments.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-start border-collapse">
                      <thead>
                        <tr className="bg-[#FAFAF9] border-b border-[#E7E5E4] text-[#57534E] font-bold">
                          <th className="p-2.5 text-start">المادة</th>
                          <th className="p-2.5 text-start">الفصل</th>
                          <th className="p-2.5 text-center">الحصص الأسبوعية</th>
                          <th className="p-2.5 text-center">حذف</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E7E5E4]">
                        {activeLoad.assignments.map((asg) => {
                          const sub = school.subjects.find((s) => s.id === asg.subject_id);
                          const sec = school.sections.find((s) => s.id === asg.section_id);

                          return (
                            <tr key={asg.id} className="hover:bg-[#FAFAF9] transition">
                              <td className="p-2.5 font-bold text-[#1C1917]">
                                {sub?.name || asg.subject_id}
                              </td>
                              <td className="p-2.5">
                                <span className="bg-[#FAFAF9] border border-[#E7E5E4] text-[#1C1917] font-bold px-2 py-0.5 rounded text-xs">
                                  {sec?.name || asg.section_id}
                                </span>
                              </td>
                              <td className="p-2.5 text-center">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleAdjustAssignmentPeriods(asg.id, -1)}
                                    className="w-8 h-8 bg-[#FAFAF9] hover:bg-[#E7E5E4] border border-[#E7E5E4] rounded text-[#1C1917] font-bold flex items-center justify-center cursor-pointer"
                                    aria-label="تقليل حصة"
                                    title="تقليل حصة"
                                  >
                                    −
                                  </button>
                                  <span className="font-extrabold text-[#1C1917] w-6 text-center tabular-nums">
                                    {asg.weekly_periods}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleAdjustAssignmentPeriods(asg.id, 1)}
                                    className="w-8 h-8 bg-[#FAFAF9] hover:bg-[#E7E5E4] border border-[#E7E5E4] rounded text-[#1C1917] font-bold flex items-center justify-center cursor-pointer"
                                    aria-label="زيادة حصة"
                                    title="زيادة حصة"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td className="p-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveAssignment(asg.id)}
                                  className="text-[#BE123C] hover:bg-[#FFF1F2] font-bold text-xs px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                                  title="حذف هذا التكليف"
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
                ) : (
                  <div className="py-6 text-center text-xs text-[#57534E] bg-[#FAFAF9] rounded-xl border border-dashed border-[#E7E5E4]">
                    لا توجد فصول مسندة حالياً لهذا المعلم. اختر الفصول من الأعلى لإسنادها.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-white rounded-xl border border-[#E7E5E4] p-8 text-center text-xs text-[#57534E]">
              اختر معلماً من القائمة لإسناد الفصول والحصص له.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
