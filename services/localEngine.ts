/**
 * Complete All-in-One School Timetable Engine for Google AI Studio.
 * Allows the entire project (Presets, Arabic NLP Parser, Smart Normalizer,
 * Deterministic Constraint Solver, Zero-Trust Validator, and PDF/Excel Exporter)
 * to run in ONE SINGLE PLACE inside Google AI Studio without needing any external server!
 */

import {
  type SchoolData,
  type Schedule,
  type AnalysisReport,
  DAY_NAMES_AR,
} from "../types.ts";
import { solveSchool, type SolverOptions } from "./solver.ts";
import { DEMO_SCHOOL_RAW_TEXT, getDemoSchool } from "../presets/demo.ts";
import { validateSchoolDataSchema } from "./apiKeyManager.ts";
import {
  getOrderedSchoolDays,
  getSectionDayPeriods,
  getDayMaxPeriods,
  getTeacherDayPeriods,
} from "../presets/commonPresets.ts";

// ============================================================================
// 1. BUILT-IN SCHOOL PRESETS (Graceful Private Preset + Public Demo Fallback)
// ============================================================================

let _privateRawText: string | null = null;
let _privateSchoolGetter: (() => SchoolData) | null = null;

try {
  const globFn = (import.meta as any).glob;
  if (typeof globFn === "function") {
    const mods = globFn("../presets/*.private.ts", { eager: true }) as Record<string, any>;
    const mod = Object.values(mods)[0];
    if (mod) {
      if (typeof mod.PRIVATE_SCHOOL376_RAW_TEXT === "string") {
        _privateRawText = mod.PRIVATE_SCHOOL376_RAW_TEXT;
      }
      if (typeof mod.getPrivateSchool376 === "function") {
        _privateSchoolGetter = mod.getPrivateSchool376;
      }
    }
  }
} catch {}

if (!_privateSchoolGetter && typeof window === "undefined") {
  try {
    const privPath = "../presets/" + "school376.private.ts";
    const mod = await import(/* @vite-ignore */ privPath);
    if (mod) {
      if (typeof mod.PRIVATE_SCHOOL376_RAW_TEXT === "string") {
        _privateRawText = mod.PRIVATE_SCHOOL376_RAW_TEXT;
      }
      if (typeof mod.getPrivateSchool376 === "function") {
        _privateSchoolGetter = mod.getPrivateSchool376;
      }
    }
  } catch {
    // Private preset not present in public repo; gracefully fall back to demo preset
  }
}

export const NESSCHINFO_RAW_TEXT: string = _privateRawText || DEMO_SCHOOL_RAW_TEXT;

export function getBuiltInSchool376(): SchoolData {
  if (_privateSchoolGetter) {
    return _privateSchoolGetter();
  }
  return getDemoSchool();
}
export { DEMO_SCHOOL_RAW_TEXT, getDemoSchool };

// ============================================================================
// 3. BUILT-IN ANALYZER, CONSTRAINT SOLVER & PDF/EXCEL EXPORTER
// ============================================================================

export class InBrowserSchoolEngine {
  static analyzeSchool(school: SchoolData): AnalysisReport {
    const section_reports = school.sections.map((sec) => {
      const asgs = school.assignments.filter((a) => a.section_id === sec.id);
      const assigned = asgs.reduce((s, a) => s + a.weekly_periods, 0);
      const expected = school.days.reduce(
        (s, d) => s + (sec.daily_period_limits?.[String(d)] ?? school.periods_per_day),
        0
      );
      return {
        section_id: sec.id,
        section_name: sec.name,
        assigned_periods: assigned,
        expected_periods: expected,
        difference: assigned - expected,
        is_balanced: assigned === expected || Boolean(sec.is_partial_attendance),
        subjects_count: asgs.length,
      };
    });

    const teacher_reports = school.teachers.map((tch) => {
      const asgs = school.assignments.filter((a) => a.teacher_id === tch.id);
      const wl = asgs.reduce((s, a) => s + a.weekly_periods, 0);
      const active_days: string[] = [];
      const off_days: string[] = [];
      for (const d of school.days) {
        const isOff = tch.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF";
        if (isOff) off_days.push(DAY_NAMES_AR[d]);
        else active_days.push(DAY_NAMES_AR[d]);
      }
      const rules_summary: string[] = [];
      for (const dpr of tch.work_pattern?.daily_period_rules || []) {
        rules_summary.push(`${DAY_NAMES_AR[dpr.day]}: ${dpr.count} حصص`);
      }
      for (const pr of tch.work_pattern?.placement_rules || []) {
        const dName = pr.day !== null && pr.day !== undefined ? DAY_NAMES_AR[pr.day] : "كل الأيام";
        rules_summary.push(
          `${dName}: ${pr.placement_type === "FIRST_N" ? "أول" : "آخر"} ${pr.n_periods || 2} حصص`
        );
      }
      const availSlots = active_days.length * school.periods_per_day;
      return {
        teacher_id: tch.id,
        teacher_name: tch.name,
        weekly_periods: wl,
        available_slots: availSlots,
        active_days,
        off_days,
        utilization_percent: Math.round((wl / Math.max(1, availSlots)) * 100),
        rules_summary,
      };
    });

    const day_bottlenecks = school.days.map((d) => {
      const req = school.sections.reduce(
        (s, sec) => s + (sec.daily_period_limits?.[String(d)] ?? school.periods_per_day),
        0
      );
      const activeTch = school.teachers.filter(
        (t) => t.work_pattern?.day_rules?.[String(d)] !== "MANDATORY_OFF"
      ).length;
      return {
        day: DAY_NAMES_AR[d],
        required_lessons: req,
        active_teachers_count: activeTch,
        sections_count: school.sections.length,
        status: activeTch >= school.sections.length + 2 ? "ممتاز" : activeTch >= school.sections.length ? "مقبول (مضغوط)" : "حرج (نقص معلمين)",
      };
    });

    const errors: Array<{ constraint_code: string; severity: string; message: string }> = [];
    for (const tr of teacher_reports) {
      if (tr.weekly_periods > tr.available_slots) {
        errors.push({
          constraint_code: "FEAS_TCH_OVERLOAD",
          severity: "ERROR",
          message: `المعلم '${tr.teacher_name}' مسند إليه ${tr.weekly_periods} حصة بينما المتاح في أيام عمله ${tr.available_slots} حصة فقط.`,
        });
      }
    }

    return {
      is_feasible: errors.length === 0,
      total_sections: school.sections.length,
      total_teachers: school.teachers.length,
      total_subjects: school.subjects.length,
      total_assignments: school.assignments.length,
      total_weekly_periods: school.assignments.reduce((s, a) => s + a.weekly_periods, 0),
      errors,
      warnings: [],
      diagnostic_report: errors.length === 0 ? "جميع الفحوصات الرياضية المسبقة سليمة 100%." : errors.map((e) => e.message).join("\n"),
      section_reports,
      teacher_reports,
      day_bottlenecks,
    };
  }

  /**
   * Real constraint solver (see services/solver.ts). Every rule is read from the SchoolData;
   * the returned validation comes from an independent zero-trust validator.
   */
  static solveInBrowser(school: SchoolData, options: SolverOptions = {}): {
    schedule: Schedule;
    validation: { is_valid: boolean; errors: any[]; warnings: any[] };
    metrics: any;
  } {
    const res = solveSchool(school, options);
    return { schedule: res.schedule, validation: res.validation, metrics: res.metrics };
  }
  // ==========================================================================
  // SECTION PALETTE FOR PDF & EXCEL EXPORTS
  // High-contrast, elegant pastel palette matching Arabic school timetable cards
  // ==========================================================================
  static EXPORT_PALETTE = [
    { bg: "#DBEAFE", border: "#93C5FD", text: "#1E3A8A", excelBg: "#DBEAFE", excelText: "#1E3A8A" }, // أزرق سماوي
    { bg: "#D1FAE5", border: "#6EE7B7", text: "#065F46", excelBg: "#D1FAE5", excelText: "#065F46" }, // أخضر زمردي
    { bg: "#FEF3C7", border: "#FCD34D", text: "#92400E", excelBg: "#FEF3C7", excelText: "#92400E" }, // كهرماني دافئ
    { bg: "#EDE9FE", border: "#C4B5FD", text: "#5B21B6", excelBg: "#EDE9FE", excelText: "#5B21B6" }, // بنفسجي هادئ
    { bg: "#FFE4E6", border: "#FDA4AF", text: "#9F1239", excelBg: "#FFE4E6", excelText: "#9F1239" }, // وردي زاهي
    { bg: "#E0F2FE", border: "#7DD3FC", text: "#075985", excelBg: "#E0F2FE", excelText: "#075985" }, // سماوي بحري
    { bg: "#FCE7F3", border: "#F9A8D4", text: "#831843", excelBg: "#FCE7F3", excelText: "#831843" }, // زهري باستيل
    { bg: "#ECFCCB", border: "#BEF264", text: "#3F6212", excelBg: "#ECFCCB", excelText: "#3F6212" }, // ليموني منعش
    { bg: "#FFEDD5", border: "#FDBA74", text: "#9A3412", excelBg: "#FFEDD5", excelText: "#9A3412" }, // برتقالي مرجاني
    { bg: "#F3E8FF", border: "#D8B4FE", text: "#6B21A8", excelBg: "#F3E8FF", excelText: "#6B21A8" }, // أرجواني ملكي
    { bg: "#CCFBF1", border: "#5EEAD4", text: "#115E59", excelBg: "#CCFBF1", excelText: "#115E59" }, // فيروزي مائي
    { bg: "#FEE2E2", border: "#FCA5A5", text: "#991B1B", excelBg: "#FEE2E2", excelText: "#991B1B" }, // قرمزي ناعم
  ];

  /**
   * Professional Printable Arabic RTL HTML/PDF Exporter
   * Formats:
   * - Master Timetable in A3 Landscape with section color badges & legend
   * - Section Cards (2 cards per A4 page with colored header & scissor cutting line ✂)
   * - Teacher Cards (2 cards per A4 page with color-coded section assignments & cutting line ✂)
   * - Official Ministry and School Accreditation Header
   */
  static exportPrintablePDF(school: SchoolData, schedule: Schedule, mode: string = "all") {
    const escapeHtml = (str: any) => {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    };

    const getSecName = (id: string) => escapeHtml(school.sections.find((s) => s.id === id)?.name || id);
    const getSubName = (id: string) => escapeHtml(school.subjects.find((s) => s.id === id)?.name || id);
    const getTchName = (id: string) => escapeHtml(school.teachers.find((t) => t.id === id)?.name || id);

    // Deterministic Python EntityColorRegistry (colors.py): Golden-Ratio HSL distribution
    const hslToHex = (hDeg: number, sPct: number, lPct: number): string => {
      const h = (((hDeg % 360) + 360) % 360) / 360;
      const s = sPct / 100;
      const l = lPct / 100;
      const hue2rgb = (p: number, q: number, t: number) => {
        let tt = t;
        if (tt < 0) tt += 1;
        if (tt > 1) tt -= 1;
        if (tt < 1 / 6) return p + (q - p) * 6 * tt;
        if (tt < 1 / 2) return q;
        if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
        return p;
      };
      let r: number;
      let g: number;
      let b: number;
      if (s === 0) {
        r = g = b = l;
      } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }
      const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0").toUpperCase();
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    };

    const generatePythonPalette = (idx: number, offsetAngle: number = 0) => {
      const hue = (idx * 137.50776405 + offsetAngle) % 360;
      return {
        bg: hslToHex(hue, 80, 93),
        border: hslToHex(hue, 75, 54),
        text: hslToHex(hue, 90, 17),
      };
    };

    const sortedSectionsForColors = [...school.sections].sort((a, b) => {
      const ga = a.grade_id || "";
      const gb = b.grade_id || "";
      if (ga !== gb) return ga < gb ? -1 : 1;
      const na = a.name || "";
      const nb = b.name || "";
      if (na !== nb) return na < nb ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const secPaletteMap = new Map<string, { bg: string; border: string; text: string }>();
    sortedSectionsForColors.forEach((sec, idx) => {
      secPaletteMap.set(sec.id, generatePythonPalette(idx, 45.0));
    });

    const getSecPal = (secId: string) => {
      return secPaletteMap.get(secId) || { bg: "#DBEAFE", border: "#93C5FD", text: "#0F172A" };
    };

    const orderedDays = getOrderedSchoolDays(school);
    const getDayPeriods = (day: number) => getDayMaxPeriods(school, day, schedule.entries);

    // Active teachers only (mirrors pdf_exporter.py: no empty trailing teacher rows)
    const activeTeachers = school.teachers.filter((tch) =>
      schedule.entries.some((e) => e.teacher_id === tch.id)
    );
    const masterTeachers = activeTeachers.length > 0 ? activeTeachers : school.teachers;
    const numTch = masterTeachers.length;

    // Compact adaptive metrics to fit all teachers on ONE page (matching pdf_exporter.py)
    const rowPad = numTch > 35 ? "1px 1px" : numTch > 24 ? "2px 1px" : "3px 2px";
    const cellFont = numTch > 35 ? "8.5px" : numTch > 24 ? "9.5px" : "10.5px";
    const tchFont = numTch > 35 ? "9px" : numTch > 24 ? "10px" : "11px";

    const DAY_HEADER_COLORS = ["#1E3A8A", "#065F46", "#92400E", "#5B21B6", "#9D174D", "#1F2937"];

    let html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(school.name)} — جدول الحصص</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
      margin: 0;
      padding: 8px;
      color: #0F172A;
      background: #FFFFFF;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .clean-header {
      text-align: center;
      margin-bottom: 6px;
      padding-bottom: 4px;
    }
    .clean-header.master-hdr h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 900;
      color: #1E3A8A;
    }
    .clean-header.master-hdr h2 {
      margin: 2px 0 0;
      font-size: 11px;
      font-weight: 700;
      color: #4B5563;
    }
    .clean-header.card-hdr h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 900;
      color: #1F4E79;
    }
    .clean-header.card-hdr h2 {
      margin: 3px 0 0;
      font-size: 12px;
      font-weight: 700;
      color: #334155;
    }
    .master-sheet {
      width: 100%;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 6px;
      font-size: ${cellFont};
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .master-table th, .master-table td {
      border: 0.5px solid #9CA3AF;
      padding: ${rowPad};
      text-align: center;
      vertical-align: middle;
    }
    .master-table .th-sub {
      background: #F3F4F6 !important;
      color: #1F2937 !important;
      font-size: 9px;
      font-weight: 800;
    }
    .master-table .day-sep {
      border-inline-end: 1.5px solid #1F2937 !important;
    }
    .master-table .teacher-name-col {
      font-weight: 800;
      color: #111827;
      text-align: center;
      padding: ${rowPad};
      white-space: nowrap;
      font-size: ${tchFont};
      min-width: 112px;
    }
    .cell-sec {
      display: inline-block;
      direction: ltr;
      font-weight: 900;
      font-size: ${cellFont};
      line-height: 1.15;
    }
    .cell-off {
      background: #FFF1F2 !important;
      color: #DC2626 !important;
      font-size: 8.5px;
      font-weight: 800;
    }
    .cell-empty {
      background: #FFFFFF;
      color: #CBD5E1;
      font-weight: bold;
    }
    /* Section cards (matching Python pdf_exporter.py #1F4E79 / #D9E1F2 / #94A3B8) */
    .sec-table th, .sec-table td {
      border: 0.5px solid #94A3B8;
      padding: 6px 4px;
      text-align: center;
      vertical-align: middle;
    }
    .sec-table thead th {
      background: #1F4E79 !important;
      color: #F5F5F5 !important;
      font-weight: 800;
      font-size: 10.5px;
    }
    .sec-table .day-col {
      background: #D9E1F2 !important;
      color: #1E3A8A !important;
      font-weight: 800;
      font-size: 10.5px;
      width: 95px;
    }
    /* Teacher cards (matching Python pdf_exporter.py #166534 / #DCFCE7 / #86EFAC) */
    .tch-table th, .tch-table td {
      border: 0.5px solid #86EFAC;
      padding: 6px 4px;
      text-align: center;
      vertical-align: middle;
    }
    .tch-table thead th {
      background: #166534 !important;
      color: #F5F5F5 !important;
      font-weight: 800;
      font-size: 10.5px;
    }
    .tch-table .day-col {
      background: #DCFCE7 !important;
      color: #166534 !important;
      font-weight: 800;
      font-size: 10.5px;
      width: 95px;
    }
    .legend-title {
      font-size: 10.5px;
      font-weight: 800;
      color: #4B5563;
      text-align: center;
      margin: 4px 0 3px;
    }
    .legend-table {
      width: 90%;
      margin: 0 auto;
      border-collapse: collapse;
    }
    .legend-table td {
      border: 0.5px solid #94A3B8;
      padding: 2px 4px;
      text-align: center;
      font-size: 9px;
      font-weight: 800;
      color: #0F172A;
    }
    .page-break { page-break-after: always; break-after: page; }
    .card-container {
      border: 1px solid #CBD5E1;
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 10px;
      background: #FFFFFF;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .cut-line {
      border-top: 1.5px dashed #94A3B8;
      margin: 12px 0;
      text-align: center;
      position: relative;
      font-size: 11px;
      font-weight: 800;
      color: #64748B;
    }
    .cut-line span {
      background: #FFFFFF;
      padding: 0 14px;
      position: relative;
      top: -10px;
    }
    @media print {
      @page { size: A3 landscape; margin: 5mm; }
      body { margin: 0; padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="background:#f1f5f9;border:1px solid #cbd5e1;padding:8px 12px;margin-bottom:10px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:12px;font-weight:bold;">معاينة الطباعة (بنفس ألوان الإخراج في بايثون) — يمكنك حفظ الصفحة كملف PDF أو طباعتها مباشرة</span>
    <button onclick="fitMasterToSinglePage(); window.print();" style="background:#1F4E79;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-weight:bold;cursor:pointer;">طباعة / حفظ PDF</button>
  </div>`;

    const renderHeader = (subTitle: string, clsName: "master-hdr" | "card-hdr" = "card-hdr") => `
    <div class="clean-header ${clsName}">
      <h1>${escapeHtml(school.name)} — العام الدراسي ${escapeHtml(school.academic_year || "2025/2026")}</h1>
      <h2>${subTitle}</h2>
    </div>`;

    // 1. Master Timetable (Single Page A3 Landscape — Exact color parity with pdf_exporter.py & colors.py)
    if (mode === "all" || mode === "master") {
      html += `<div class="master-sheet">`;
      html += renderHeader(
        `الجدول العام الشامل للمدرسة (مخطط توزيع حصص المعلمين والفصول الأسبوعي - عدد المعلمين: ${masterTeachers.length})`,
        "master-hdr"
      );
      html += `<table class="master-table">
        <thead>
          <tr>
            <th rowspan="2" class="teacher-name-col" style="background:#1F2937 !important;color:#FFFFFF !important;">المعلم / اليوم</th>`;
      for (let dIdx = 0; dIdx < orderedDays.length; dIdx++) {
        const d = orderedDays[dIdx];
        const count = getDayPeriods(d);
        const dayColor = DAY_HEADER_COLORS[dIdx % DAY_HEADER_COLORS.length];
        html += `<th colspan="${count}" class="day-sep" style="background:${dayColor} !important;color:#FFFFFF !important;">${DAY_NAMES_AR[d]}</th>`;
      }
      html += `</tr><tr>`;
      for (const d of orderedDays) {
        const count = getDayPeriods(d);
        for (let p = 1; p <= count; p++) {
          const isLastP = p === count;
          html += `<th class="th-sub ${isLastP ? "day-sep" : ""}">${p}</th>`;
        }
      }
      html += `</tr></thead><tbody>`;

      masterTeachers.forEach((tch, tchIdx) => {
        const bgTch = tchIdx % 2 === 0 ? "#F9FAFB" : "#F3F4F6";
        html += `<tr><td class="teacher-name-col" style="background:${bgTch} !important;color:#111827 !important;">${escapeHtml(tch.name)}</td>`;
        for (const d of orderedDays) {
          const count = getDayPeriods(d);
          const isOff = tch.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF";
          for (let p = 1; p <= count; p++) {
            const isLastP = p === count;
            const sepClass = isLastP ? "day-sep" : "";
            const e = schedule.entries.find((x) => x.teacher_id === tch.id && x.day === d && x.period === p);
            if (e) {
              const pal = getSecPal(e.section_id);
              html += `<td class="${sepClass}" style="background:${pal.bg};color:#0F172A;"><span class="cell-sec" dir="ltr">${getSecName(e.section_id)}</span></td>`;
            } else if (isOff) {
              html += `<td class="cell-off ${sepClass}">----</td>`;
            } else {
              html += `<td class="cell-empty ${sepClass}"></td>`;
            }
          }
        }
        html += `</tr>`;
      });
      html += `</tbody></table>`;

      html += `</div>`;
      if (mode === "all") html += `<div class="page-break"></div>`;
    }

    // 2. Section Cards (2 cards per page — matching Python #1F4E79 / #D9E1F2 / #94A3B8)
    if (mode === "all" || mode === "compact_sections" || mode === "sections") {
      school.sections.forEach((sec, idx) => {
        const pal = getSecPal(sec.id);
        html += `<div class="card-container" style="border-top: 5px solid ${pal.border};">`;
        html += renderHeader(
          `جدول حصص الفصل: <span style="background:${pal.bg};border:1px solid ${pal.border};color:#0F172A;padding:1px 8px;border-radius:4px;font-size:12px;font-weight:900;" dir="ltr">${escapeHtml(sec.name)}</span>`,
          "card-hdr"
        );
        html += `<table class="sec-table">
          <thead>
            <tr>
              <th>اليوم / الحصة</th>`;
        const maxP = Math.max(...orderedDays.map((d) => getSectionDayPeriods(school, sec, d)));
        for (let p = 1; p <= maxP; p++) {
          html += `<th>الحصة ${p}</th>`;
        }
        html += `</tr></thead><tbody>`;
        for (const d of orderedDays) {
          const count = getSectionDayPeriods(school, sec, d);
          html += `<tr><td class="day-col">${DAY_NAMES_AR[d]}</td>`;
          for (let p = 1; p <= maxP; p++) {
            if (p > count) {
              html += `<td style="background:#F1F5F9;color:#94A3B8;font-weight:bold;">----</td>`;
              continue;
            }
            const e = schedule.entries.find((x) => x.section_id === sec.id && x.day === d && x.period === p);
            if (e) {
              html += `<td style="background:#FFFFFF;color:#0F172A;"><strong style="color:#0F172A;font-size:11px;">${getSubName(e.subject_id)}</strong><br><small style="color:#334155;font-weight:700;">(${getTchName(e.teacher_id)})</small></td>`;
            } else {
              html += `<td style="background:#FFFFFF;color:#64748B;font-weight:bold;">--</td>`;
            }
          }
          html += `</tr>`;
        }
        html += `</tbody></table>`;
        html += `</div>`;

        if (idx % 2 === 0 && idx < school.sections.length - 1) {
          html += `<div class="cut-line"><span>✂ ------------------------ خط القص ------------------------ ✂</span></div>`;
        } else if (idx % 2 === 1 && idx < school.sections.length - 1) {
          html += `<div class="page-break"></div>`;
        }
      });
      if (mode === "all") html += `<div class="page-break"></div>`;
    }

    // 3. Teacher Cards (2 cards per page — matching Python #166534 / #DCFCE7 / #86EFAC + #FFF1F2/#DC2626)
    if (mode === "all" || mode === "teachers") {
      school.teachers.forEach((tch, idx) => {
        const tchEntriesCount = schedule.entries.filter((e) => e.teacher_id === tch.id).length;
        html += `<div class="card-container" style="border-top: 5px solid #166534;">`;
        html += renderHeader(
          `جدول المعلم: <strong>${escapeHtml(tch.name)}</strong> ${tch.code ? `(${escapeHtml(tch.code)})` : ""} — النصاب: <span style="background:#DCFCE7;color:#166534;padding:1px 8px;border-radius:4px;border:1px solid #86EFAC;">${tchEntriesCount} حصة</span>`,
          "card-hdr"
        );
        html += `<table class="tch-table">
          <thead>
            <tr>
              <th>اليوم / الحصة</th>`;
        const maxP = Math.max(...orderedDays.map((d) => getTeacherDayPeriods(school, tch.id, d, schedule.entries)));
        for (let p = 1; p <= maxP; p++) {
          html += `<th>الحصة ${p}</th>`;
        }
        html += `</tr></thead><tbody>`;
        for (const d of orderedDays) {
          const count = getTeacherDayPeriods(school, tch.id, d, schedule.entries);
          const isOff = tch.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF";
          html += `<tr><td class="day-col">${DAY_NAMES_AR[d]}</td>`;
          if (isOff) {
            html += `<td colspan="${maxP}" class="cell-off" style="padding:6px;font-size:10px;">إجازة تفرغ أسبوعية معتمدة (MANDATORY_OFF) — ----</td>`;
          } else {
            for (let p = 1; p <= maxP; p++) {
              if (p > count) {
                html += `<td style="background:#F1F5F9;color:#94A3B8;font-weight:bold;">----</td>`;
                continue;
              }
              const e = schedule.entries.find((x) => x.teacher_id === tch.id && x.day === d && x.period === p);
              if (e) {
                const pal = getSecPal(e.section_id);
                html += `<td style="background:${pal.bg};"><span class="cell-sec" style="color:#0F172A;font-weight:900;" dir="ltr">${getSecName(e.section_id)}</span><br><small style="color:#334155;font-weight:700;">(${getSubName(e.subject_id)})</small></td>`;
              } else {
                html += `<td style="background:#FFFFFF;color:#64748B;font-weight:bold;">--</td>`;
              }
            }
          }
          html += `</tr>`;
        }
        html += `</tbody></table>`;
        html += `</div>`;

        if (idx % 2 === 0 && idx < school.teachers.length - 1) {
          html += `<div class="cut-line"><span>✂ ------------------------ خط القص ------------------------ ✂</span></div>`;
        } else if (idx % 2 === 1 && idx < school.teachers.length - 1) {
          html += `<div class="page-break"></div>`;
        }
      });
    }

    html += `
  <script>
    function fitMasterToSinglePage() {
      var sheet = document.querySelector('.master-sheet');
      if (!sheet) return;
      sheet.style.zoom = '1';
      // Guarantee single-page fit for A3 Landscape (~760px printable height)
      var maxPrintableH = 740;
      var actualH = sheet.scrollHeight;
      if (actualH > maxPrintableH) {
        var scale = Math.max(0.45, (maxPrintableH / actualH) * 0.96);
        sheet.style.zoom = scale.toFixed(3);
      }
    }
    window.addEventListener('beforeprint', fitMasterToSinglePage);
    if (document.readyState === 'complete') fitMasterToSinglePage();
    else window.addEventListener('load', fitMasterToSinglePage);
  </script>
</body></html>`;

    // Print execution: try hidden iframe to avoid popup-blockers
    if (typeof document !== "undefined") {
      try {
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "none";
        document.body.appendChild(iframe);
        const doc = iframe.contentWindow?.document || iframe.contentDocument;
        if (doc) {
          doc.open();
          doc.write(html);
          doc.close();
          setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setTimeout(() => {
              try { document.body.removeChild(iframe); } catch {}
            }, 3000);
          }, 400);
          return html;
        }
      } catch {}

      // Fallback: window.open
      try {
        const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
        if (win) {
          win.document.write(html);
          win.document.close();
        }
      } catch {}
    }

    return html;
  }

  /**
   * Professional Native XML SpreadsheetML Excel Exporter
   * Generates a multi-sheet .xls workbook directly opening in Microsoft Excel and Google Sheets:
   * - Sheet 1: الجدول العام الشامل
   * - Sheet 2: جداول الفصول
   * - Sheet 3: جداول المعلمين
   * - Sheet 4: أنصبة وإحصائيات المدرسة
   */
  static exportExcelWorkbook(school: SchoolData, schedule: Schedule) {
    const getSecName = (id: string) => school.sections.find((s) => s.id === id)?.name || id;
    const getSubName = (id: string) => school.subjects.find((s) => s.id === id)?.name || id;
    const getTchName = (id: string) => school.teachers.find((t) => t.id === id)?.name || id;

    const escapeXml = (str: any) => {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    };

    const orderedDays = getOrderedSchoolDays(school);
    const getDayPeriods = (day: number) => getDayMaxPeriods(school, day, schedule.entries);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="TitleStyle">
   <Font ss:FontName="Segoe UI" ss:Bold="1" ss:Size="14" ss:Color="#1E3A8A"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Font ss:FontName="Segoe UI" ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E3A8A" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
   </Borders>
  </Style>
  <Style ss:ID="SubHeaderStyle">
   <Font ss:FontName="Segoe UI" ss:Bold="1" ss:Size="10" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#334155" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
   </Borders>
  </Style>
  <Style ss:ID="TeacherColStyle">
   <Font ss:FontName="Segoe UI" ss:Bold="1" ss:Size="10" ss:Color="#0F172A"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
  </Style>
  <Style ss:ID="CellAssignedStyle">
   <Font ss:FontName="Segoe UI" ss:Bold="1" ss:Size="10" ss:Color="#1E3A8A"/>
   <Interior ss:Color="#EFF6FF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
  </Style>
  <Style ss:ID="CellOffStyle">
   <Font ss:FontName="Segoe UI" ss:Bold="1" ss:Size="9" ss:Color="#BE123C"/>
   <Interior ss:Color="#FFE4E6" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
  </Style>
  <Style ss:ID="CellEmptyStyle">
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#94A3B8"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
  </Style>
  <Style ss:ID="SummaryHeaderStyle">
   <Font ss:FontName="Segoe UI" ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
   </Borders>
  </Style>
  <Style ss:ID="SummaryTotalStyle">
   <Font ss:FontName="Segoe UI" ss:Bold="1" ss:Size="11" ss:Color="#0F172A"/>
   <Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#0F172A"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#0F172A"/>
   </Borders>
  </Style>
${school.sections
  .map((sec, idx) => {
    const pal = InBrowserSchoolEngine.EXPORT_PALETTE[idx % InBrowserSchoolEngine.EXPORT_PALETTE.length];
    return `  <Style ss:ID="SecStyle_${idx}">
   <Font ss:FontName="Segoe UI" ss:Bold="1" ss:Size="10" ss:Color="${pal.excelText}"/>
   <Interior ss:Color="${pal.excelBg}" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${pal.border}"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${pal.border}"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${pal.border}"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="${pal.border}"/>
   </Borders>
  </Style>`;
  })
  .join("\n")}
 </Styles>`;

    // --- Sheet 1: Master Timetable ---
    xml += `<Worksheet ss:Name="الجدول العام الشامل">
  <Table ss:DefaultColumnWidth="65" ss:DefaultRowHeight="24">
   <Column ss:Width="130"/>`;
    for (const d of orderedDays) {
      const count = getDayPeriods(d);
      for (let p = 1; p <= count; p++) xml += `<Column ss:Width="75"/>`;
    }

    // Title Row
    xml += `<Row ss:Height="30"><Cell ss:StyleID="TitleStyle" ss:MergeAcross="${
      orderedDays.reduce((s, d) => s + getDayPeriods(d), 0)
    }"><Data ss:Type="String">${escapeXml(school.name)} — الجدول العام الشامل (${escapeXml(school.academic_year || "2025/2026")})</Data></Cell></Row>`;

    // Day Header Row
    xml += `<Row ss:Height="26"><Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">المعلم / اليوم</Data></Cell>`;
    for (const d of orderedDays) {
      const count = getDayPeriods(d);
      xml += `<Cell ss:StyleID="HeaderStyle" ss:MergeAcross="${count - 1}"><Data ss:Type="String">${DAY_NAMES_AR[d]} (${count} حصص)</Data></Cell>`;
    }
    xml += `</Row>`;

    // Periods Header Row
    xml += `<Row ss:Height="22"><Cell ss:StyleID="SubHeaderStyle"><Data ss:Type="String">الحصة</Data></Cell>`;
    for (const d of orderedDays) {
      const count = getDayPeriods(d);
      for (let p = 1; p <= count; p++) {
        xml += `<Cell ss:StyleID="SubHeaderStyle"><Data ss:Type="String">ح ${p}</Data></Cell>`;
      }
    }
    xml += `</Row>`;

    // Teacher rows
    for (const tch of school.teachers) {
      xml += `<Row ss:Height="34"><Cell ss:StyleID="TeacherColStyle"><Data ss:Type="String">${escapeXml(tch.name)}</Data></Cell>`;
      for (const d of orderedDays) {
        const count = getDayPeriods(d);
        const isOff = tch.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF";
        for (let p = 1; p <= count; p++) {
          const e = schedule.entries.find((x) => x.teacher_id === tch.id && x.day === d && x.period === p);
          if (e) {
            const secIdx = school.sections.findIndex((s) => s.id === e.section_id);
            const styleId = secIdx >= 0 ? `SecStyle_${secIdx}` : "CellAssignedStyle";
            xml += `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${escapeXml(getSecName(e.section_id))}&#10;${escapeXml(getSubName(e.subject_id))}</Data></Cell>`;
          } else if (isOff) {
            xml += `<Cell ss:StyleID="CellOffStyle"><Data ss:Type="String">إجازة</Data></Cell>`;
          } else {
            xml += `<Cell ss:StyleID="CellEmptyStyle"><Data ss:Type="String">—</Data></Cell>`;
          }
        }
      }
      xml += `</Row>`;
    }
    xml += `</Table></Worksheet>`;

    // --- Sheet 2: Sections Timetables ---
    xml += `<Worksheet ss:Name="جداول الفصول">
  <Table ss:DefaultColumnWidth="80" ss:DefaultRowHeight="24">
   <Column ss:Width="90"/>`;
    const maxP = Math.max(...orderedDays.map((d) => getDayPeriods(d)));
    for (let p = 1; p <= maxP; p++) xml += `<Column ss:Width="95"/>`;

    school.sections.forEach((sec, idx) => {
      const secIdx = idx;
      xml += `<Row ss:Height="30"><Cell ss:StyleID="TitleStyle" ss:MergeAcross="${maxP}"><Data ss:Type="String">جدول فصل: ${escapeXml(sec.name)} — ${escapeXml(school.name)}</Data></Cell></Row>`;
      xml += `<Row ss:Height="24"><Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">اليوم / الحصة</Data></Cell>`;
      for (let p = 1; p <= maxP; p++) xml += `<Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">الحصة ${p}</Data></Cell>`;
      xml += `</Row>`;

      for (const d of orderedDays) {
        const count = getSectionDayPeriods(school, sec, d);
        xml += `<Row ss:Height="30"><Cell ss:StyleID="TeacherColStyle"><Data ss:Type="String">${DAY_NAMES_AR[d]}</Data></Cell>`;
        for (let p = 1; p <= maxP; p++) {
          if (p > count) {
            xml += `<Cell ss:StyleID="CellEmptyStyle"><Data ss:Type="String">—</Data></Cell>`;
            continue;
          }
          const e = schedule.entries.find((x) => x.section_id === sec.id && x.day === d && x.period === p);
          if (e) {
            const styleId = `SecStyle_${secIdx}`;
            xml += `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${escapeXml(getSubName(e.subject_id))}&#10;(${escapeXml(getTchName(e.teacher_id))})</Data></Cell>`;
          } else {
            xml += `<Cell ss:StyleID="CellEmptyStyle"><Data ss:Type="String">—</Data></Cell>`;
          }
        }
        xml += `</Row>`;
      }
      xml += `<Row ss:Height="20"></Row>`; // Spacer
    });
    xml += `</Table></Worksheet>`;

    // --- Sheet 3: Teachers Timetables ---
    xml += `<Worksheet ss:Name="جداول المعلمين">
  <Table ss:DefaultColumnWidth="85" ss:DefaultRowHeight="26">
   <Column ss:Width="95"/>`;
    for (let p = 1; p <= maxP; p++) xml += `<Column ss:Width="100"/>`;

    for (const tch of school.teachers) {
      const tchEntriesCount = schedule.entries.filter((e) => e.teacher_id === tch.id).length;
      xml += `<Row ss:Height="30"><Cell ss:StyleID="TitleStyle" ss:MergeAcross="${maxP}"><Data ss:Type="String">جدول المعلم: ${escapeXml(tch.name)} ${tch.code ? `(${escapeXml(tch.code)})` : ""} — النصاب: ${tchEntriesCount} حصة</Data></Cell></Row>`;
      xml += `<Row ss:Height="24"><Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">اليوم / الحصة</Data></Cell>`;
      for (let p = 1; p <= maxP; p++) xml += `<Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">الحصة ${p}</Data></Cell>`;
      xml += `</Row>`;

      for (const d of orderedDays) {
        const count = getTeacherDayPeriods(school, tch.id, d, schedule.entries);
        const isOff = tch.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF";
        xml += `<Row ss:Height="30"><Cell ss:StyleID="TeacherColStyle"><Data ss:Type="String">${DAY_NAMES_AR[d]}</Data></Cell>`;
        if (isOff) {
          xml += `<Cell ss:StyleID="CellOffStyle" ss:MergeAcross="${maxP - 1}"><Data ss:Type="String">إجازة تفرغ أسبوعية معتمدة (MANDATORY_OFF)</Data></Cell>`;
        } else {
          for (let p = 1; p <= maxP; p++) {
            if (p > count) {
              xml += `<Cell ss:StyleID="CellEmptyStyle"><Data ss:Type="String">—</Data></Cell>`;
              continue;
            }
            const e = schedule.entries.find((x) => x.teacher_id === tch.id && x.day === d && x.period === p);
            if (e) {
              const secIdx = school.sections.findIndex((s) => s.id === e.section_id);
              const styleId = secIdx >= 0 ? `SecStyle_${secIdx}` : "CellAssignedStyle";
              xml += `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${escapeXml(getSecName(e.section_id))}&#10;(${escapeXml(getSubName(e.subject_id))})</Data></Cell>`;
            } else {
              xml += `<Cell ss:StyleID="CellEmptyStyle"><Data ss:Type="String">—</Data></Cell>`;
            }
          }
        }
        xml += `</Row>`;
      }
      xml += `<Row ss:Height="20"></Row>`; // Spacer
    }
    xml += `</Table></Worksheet>`;

    // --- Sheet 4: Teacher Workloads & School Statistics ---
    xml += `<Worksheet ss:Name="أنصبة وإحصائيات المدرسة">
  <Table ss:DefaultColumnWidth="110" ss:DefaultRowHeight="26">
   <Column ss:Width="40"/>
   <Column ss:Width="160"/>
   <Column ss:Width="90"/>
   <Column ss:Width="110"/>
   <Column ss:Width="100"/>
   <Column ss:Width="180"/>
   <Column ss:Width="100"/>
   <Row ss:Height="32"><Cell ss:StyleID="TitleStyle" ss:MergeAcross="6"><Data ss:Type="String">كشف أنصبة وإحصائيات المعلمين والفصول — ${escapeXml(school.name)}</Data></Cell></Row>
   <Row ss:Height="26">
    <Cell ss:StyleID="SummaryHeaderStyle"><Data ss:Type="String">م</Data></Cell>
    <Cell ss:StyleID="SummaryHeaderStyle"><Data ss:Type="String">اسم المعلم</Data></Cell>
    <Cell ss:StyleID="SummaryHeaderStyle"><Data ss:Type="String">الكود</Data></Cell>
    <Cell ss:StyleID="SummaryHeaderStyle"><Data ss:Type="String">النصاب الفعلي</Data></Cell>
    <Cell ss:StyleID="SummaryHeaderStyle"><Data ss:Type="String">أيام العمل</Data></Cell>
    <Cell ss:StyleID="SummaryHeaderStyle"><Data ss:Type="String">الإجازات الأسبوعية</Data></Cell>
    <Cell ss:StyleID="SummaryHeaderStyle"><Data ss:Type="String">الحالة</Data></Cell>
   </Row>`;

    let totalLessons = 0;
    school.teachers.forEach((tch, i) => {
      const assignedCount = schedule.entries.filter((e) => e.teacher_id === tch.id).length;
      totalLessons += assignedCount;
      const offDaysList = orderedDays.filter((d) => tch.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF");
      const workDaysCount = orderedDays.length - offDaysList.length;
      const offDaysText = offDaysList.map((d) => DAY_NAMES_AR[d]).join("، ") || "لا يوجد (متاح دائماً)";
      const statusText = assignedCount > 0 ? "نشط" : "بدون حصص";

      xml += `<Row ss:Height="26">
    <Cell ss:StyleID="TeacherColStyle"><Data ss:Type="Number">${i + 1}</Data></Cell>
    <Cell ss:StyleID="TeacherColStyle"><Data ss:Type="String">${escapeXml(tch.name)}</Data></Cell>
    <Cell ss:StyleID="TeacherColStyle"><Data ss:Type="String">${escapeXml(tch.code || "")}</Data></Cell>
    <Cell ss:StyleID="CellAssignedStyle"><Data ss:Type="Number">${assignedCount}</Data></Cell>
    <Cell ss:StyleID="TeacherColStyle"><Data ss:Type="Number">${workDaysCount}</Data></Cell>
    <Cell ss:StyleID="TeacherColStyle"><Data ss:Type="String">${escapeXml(offDaysText)}</Data></Cell>
    <Cell ss:StyleID="TeacherColStyle"><Data ss:Type="String">${statusText}</Data></Cell>
   </Row>`;
    });

    // Summary Total Row
    const avgLoad = school.teachers.length > 0 ? (totalLessons / school.teachers.length).toFixed(1) : "0";
    xml += `<Row ss:Height="30">
    <Cell ss:StyleID="SummaryTotalStyle" ss:MergeAcross="2"><Data ss:Type="String">الإجمالي العام (${school.teachers.length} معلماً — ${school.sections.length} فصول)</Data></Cell>
    <Cell ss:StyleID="SummaryTotalStyle"><Data ss:Type="Number">${totalLessons}</Data></Cell>
    <Cell ss:StyleID="SummaryTotalStyle" ss:MergeAcross="2"><Data ss:Type="String">متوسط نصاب المعلم: ${avgLoad} حصة / أسبوع</Data></Cell>
   </Row>`;

    xml += `</Table></Worksheet>`;

    xml += `</Workbook>`;

    if (typeof window !== "undefined" && typeof document !== "undefined") {
      try {
        const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${school.name}_جدول_الحصص_المعتمد.xls`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } catch (err) {
        console.warn("Browser Excel download trigger failed:", err);
      }
    }

    return xml;
  }

  // ============================================================================
  // 4. USER DATA BACKUP & RESTORE JSON (Excludes API Keys, Validates Schema)
  // ============================================================================

  static exportUserBackupJson(payload: {
    savedSchools: Array<{
      id: string;
      name: string;
      school: SchoolData;
      raw_text: string;
      schedule?: Schedule | null;
      analysis?: AnalysisReport | null;
    }>;
    activeSchoolId?: string;
    chatHistory?: Array<{
      role: "user" | "ai";
      text: string;
      changes?: string[];
      timestamp?: string;
    }>;
  }): string {
    const cleanSchools = (payload.savedSchools || []).map((entry) => ({
      id: String(entry.id || entry.school?.id || `sch_${Date.now()}`),
      name: String(entry.name || entry.school?.name || "مدرسة"),
      school: entry.school,
      raw_text: String(entry.raw_text || ""),
      schedule: entry.schedule || null,
      analysis: entry.analysis || null,
    }));

    const backupObject = {
      app: "ai-timetable-studio",
      schema_version: 1,
      exported_at: new Date().toISOString(),
      includes_api_keys: false,
      active_school_id: payload.activeSchoolId || cleanSchools[0]?.id || "",
      saved_schools: cleanSchools,
      chat_history: Array.isArray(payload.chatHistory) ? payload.chatHistory : [],
    };

    const jsonString = JSON.stringify(backupObject, null, 2);

    if (typeof window !== "undefined" && typeof document !== "undefined") {
      try {
        const blob = new Blob([jsonString], { type: "application/json;charset=utf-8" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const dateStamp = new Date().toISOString().slice(0, 10);
        a.download = `نسخة_احتياطية_جداول_المدارس_${dateStamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } catch (err) {
        console.warn("Browser JSON backup download trigger failed:", err);
      }
    }

    return jsonString;
  }

  static importUserBackupJson(rawJsonText: string): {
    valid: boolean;
    errors: string[];
    savedSchools: Array<{
      id: string;
      name: string;
      school: SchoolData;
      raw_text: string;
      schedule: Schedule | null;
      analysis: AnalysisReport | null;
    }>;
    activeSchoolId: string;
    chatHistory: Array<{
      role: "user" | "ai";
      text: string;
      changes?: string[];
      timestamp?: string;
    }>;
  } {
    const errors: string[] = [];
    if (!rawJsonText || typeof rawJsonText !== "string" || !rawJsonText.trim()) {
      return {
        valid: false,
        errors: ["ملف النسخة الاحتياطية فارغ أو غير صالح."],
        savedSchools: [],
        activeSchoolId: "",
        chatHistory: [],
      };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawJsonText);
    } catch {
      return {
        valid: false,
        errors: ["تعذر قراءة ملف JSON: الصيغة غير سليمة (Syntax Error)."],
        savedSchools: [],
        activeSchoolId: "",
        chatHistory: [],
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return {
        valid: false,
        errors: ["محتوى الملف ليس كائن JSON صالحاً."],
        savedSchools: [],
        activeSchoolId: "",
        chatHistory: [],
      };
    }

    // Support either a full backup envelope (`saved_schools`) or a single SchoolData object
    const rawList: any[] = Array.isArray(parsed.saved_schools)
      ? parsed.saved_schools
      : parsed.sections && parsed.teachers && parsed.assignments
      ? [{ id: parsed.id, name: parsed.name, school: parsed, raw_text: "" }]
      : [];

    if (rawList.length === 0) {
      return {
        valid: false,
        errors: ["لا يحتوي الملف على أي مدارس صالحة للاستيراد (saved_schools فارغة أو مفقودة)."],
        savedSchools: [],
        activeSchoolId: "",
        chatHistory: [],
      };
    }

    const validatedSchools: Array<{
      id: string;
      name: string;
      school: SchoolData;
      raw_text: string;
      schedule: Schedule | null;
      analysis: AnalysisReport | null;
    }> = [];

    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i];
      const candidateSchool = item?.school || item;
      const check = validateSchoolDataSchema(candidateSchool);
      if (!check.valid || !check.school) {
        errors.push(`المدرسة رقم ${i + 1}: ${check.errors.join(" | ")}`);
        continue;
      }

      const validSchool = check.school;
      const validSchedule: Schedule | null =
        item?.schedule && Array.isArray(item.schedule.entries) ? item.schedule : null;
      const validAnalysis: AnalysisReport =
        item?.analysis && typeof item.analysis.is_feasible === "boolean"
          ? item.analysis
          : InBrowserSchoolEngine.analyzeSchool(validSchool);

      validatedSchools.push({
        id: typeof item?.id === "string" && item.id.trim() ? item.id.trim() : validSchool.id,
        name: typeof item?.name === "string" && item.name.trim() ? item.name.trim() : validSchool.name,
        school: validSchool,
        raw_text: typeof item?.raw_text === "string" ? item.raw_text : "",
        schedule: validSchedule,
        analysis: validAnalysis,
      });
    }

    if (validatedSchools.length === 0) {
      return {
        valid: false,
        errors: errors.length > 0 ? errors : ["لم تجتز أي مدرسة فحص سلامة البيانات."],
        savedSchools: [],
        activeSchoolId: "",
        chatHistory: [],
      };
    }

    const sanitizedHistory: Array<{
      role: "user" | "ai";
      text: string;
      changes?: string[];
      timestamp?: string;
    }> = [];

    if (Array.isArray(parsed.chat_history)) {
      for (const h of parsed.chat_history) {
        if (h && typeof h.text === "string" && (h.role === "user" || h.role === "ai")) {
          sanitizedHistory.push({
            role: h.role,
            text: h.text,
            changes: Array.isArray(h.changes) ? h.changes.map(String) : undefined,
            timestamp: typeof h.timestamp === "string" ? h.timestamp : undefined,
          });
        }
      }
    }

    const activeId =
      typeof parsed.active_school_id === "string" &&
      validatedSchools.some((s) => s.id === parsed.active_school_id)
        ? parsed.active_school_id
        : validatedSchools[0].id;

    return {
      valid: true,
      errors,
      savedSchools: validatedSchools,
      activeSchoolId: activeId,
      chatHistory: sanitizedHistory,
    };
  }
}

