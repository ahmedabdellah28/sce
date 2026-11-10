import { getDemoSchool, InBrowserSchoolEngine } from "../services/localEngine.ts";
import { solveSchool } from "../services/solver.ts";
import { parseSchoolText } from "../services/schoolCore.ts";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assert(condition: any, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`✓ PASS: ${msg}`);
}

async function runExportTests() {
  console.log("======================================================================");
  console.log("🎨 RUNNING PDF & EXCEL EXPORT QUALITY & COLOR VERIFICATION TESTS");
  console.log("======================================================================\n");

  // 1. Solve Demo Prep School
  const demoSchool = getDemoSchool();
  console.log(`Solving ${demoSchool.name}...`);
  const resDemo = solveSchool(demoSchool, { maxTimeMs: 10000 });
  assert(resDemo.validation.is_valid, "Demo Prep School solved with 0 hard collisions");

  // 2. Palette Verification
  assert(InBrowserSchoolEngine.EXPORT_PALETTE.length >= 10, "EXPORT_PALETTE has at least 10 high-contrast colors");
  for (let i = 0; i < InBrowserSchoolEngine.EXPORT_PALETTE.length; i++) {
    const pal = InBrowserSchoolEngine.EXPORT_PALETTE[i];
    assert(/^#[0-9A-Fa-f]{6}$/.test(pal.bg), `Palette[${i}] bg is valid 6-hex: ${pal.bg}`);
    assert(/^#[0-9A-Fa-f]{6}$/.test(pal.border), `Palette[${i}] border is valid 6-hex: ${pal.border}`);
    assert(/^#[0-9A-Fa-f]{6}$/.test(pal.text), `Palette[${i}] text is valid 6-hex: ${pal.text}`);
    assert(/^#[0-9A-Fa-f]{6}$/.test(pal.excelBg), `Palette[${i}] excelBg is valid 6-hex: ${pal.excelBg}`);
    assert(/^#[0-9A-Fa-f]{6}$/.test(pal.excelText), `Palette[${i}] excelText is valid 6-hex: ${pal.excelText}`);
  }

  // 3. Test PDF Exports in All Modes
  console.log("\n--- Testing PDF / Printable HTML Exports ---");
  const pdfMaster = InBrowserSchoolEngine.exportPrintablePDF(demoSchool, resDemo.schedule, "master");
  assert(pdfMaster.includes("<!DOCTYPE html>"), "PDF Master has <!DOCTYPE html>");
  assert(pdfMaster.includes("family=Cairo"), "PDF Master includes Cairo Arabic font");
  assert(pdfMaster.includes("الجدول العام الشامل للمدرسة"), "PDF Master title is correct");
  assert(!pdfMaster.includes("palette-legend") && !pdfMaster.includes("دليل ألوان الفصول"), "PDF Master omits clutter color legend bar");
  assert(!pdfMaster.includes("وزارة التربية والتعليم والتعليم الفني") && !pdfMaster.includes("جمهورية مصر العربية"), "PDF Master omits cluttered ministry header");
  assert(!pdfMaster.includes("يعتمد مدير المدرسة"), "PDF Master omits top signatures clutter");
  assert(!pdfMaster.includes('class="cell-sub"'), "PDF Master cells show section code ONLY (no subject name)");
  assert(pdfMaster.includes("master-sheet") && pdfMaster.includes("fitMasterToSinglePage") && pdfMaster.includes("break-inside: avoid"), "PDF Master enforces single-page fit");
  assert(pdfMaster.includes("background:"), "PDF Master includes section color backgrounds");

  const pdfSections = InBrowserSchoolEngine.exportPrintablePDF(demoSchool, resDemo.schedule, "sections");
  assert(pdfSections.includes("جدول حصص الفصل:"), "PDF Sections includes class cards");
  assert(pdfSections.includes("خط القص"), "PDF Sections includes scissor cutting line (✂)");
  assert(pdfSections.includes("border-top: 5px solid"), "PDF Sections cards have prominent colored accent borders");

  const pdfTeachers = InBrowserSchoolEngine.exportPrintablePDF(demoSchool, resDemo.schedule, "teachers");
  assert(pdfTeachers.includes("جدول المعلم:"), "PDF Teachers includes teacher cards");
  assert(pdfTeachers.includes("النصاب:"), "PDF Teachers cards display teacher workload");
  assert(pdfTeachers.includes("خط القص"), "PDF Teachers includes scissor cutting line");
  assert(pdfTeachers.includes("MANDATORY_OFF"), "PDF Teachers displays mandatory off badges");

  const pdfAll = InBrowserSchoolEngine.exportPrintablePDF(demoSchool, resDemo.schedule, "all");
  assert(pdfAll.includes("page-break"), "PDF Comprehensive includes clean print page breaks");
  assert(pdfAll.length > 50000, `PDF Comprehensive generated complete output (${pdfAll.length} bytes)`);

  // 4. Test Native Excel XML Workbook Export
  console.log("\n--- Testing Native XML SpreadsheetML Excel Export ---");
  const excelXml = InBrowserSchoolEngine.exportExcelWorkbook(demoSchool, resDemo.schedule);
  assert(excelXml.includes('<?xml version="1.0" encoding="UTF-8"?>'), "Excel XML has correct declaration");
  assert(excelXml.includes('progid="Excel.Sheet"'), "Excel XML has Office Spreadsheet identifier");
  assert(excelXml.includes('xmlns="urn:schemas-microsoft-com:office:spreadsheet"'), "Excel XML has SpreadsheetML schema");

  // Check custom styles
  for (let sIdx = 0; sIdx < demoSchool.sections.length; sIdx++) {
    assert(excelXml.includes(`ss:ID="SecStyle_${sIdx}"`), `Excel XML includes SecStyle_${sIdx}`);
  }
  assert(excelXml.includes('ss:ID="SummaryHeaderStyle"'), "Excel XML includes SummaryHeaderStyle");
  assert(excelXml.includes('ss:ID="SummaryTotalStyle"'), "Excel XML includes SummaryTotalStyle");

  // Check Worksheets
  assert(excelXml.includes('ss:Name="الجدول العام الشامل"'), "Excel Sheet 1: الجدول العام الشامل present");
  assert(excelXml.includes('ss:Name="جداول الفصول"'), "Excel Sheet 2: جداول الفصول present");
  assert(excelXml.includes('ss:Name="جداول المعلمين"'), "Excel Sheet 3: جداول المعلمين present");
  assert(excelXml.includes('ss:Name="أنصبة وإحصائيات المدرسة"'), "Excel Sheet 4: أنصبة وإحصائيات المدرسة present");

  // Check Content Integrity
  assert(excelXml.includes("&#10;"), "Excel XML uses &#10; for clean multi-line cell formatting");
  assert(excelXml.includes("الإجمالي العام"), "Excel Sheet 4 has summary totals row");
  assert(excelXml.includes("متوسط نصاب المعلم:"), "Excel Sheet 4 has average workload calculation");
  assert(!excelXml.includes("NaN"), "Excel XML has no NaN values");
  assert(!excelXml.includes("undefined"), "Excel XML has no undefined values");

  // 5. Test with Model School Fixture (and optional local file if present)
  console.log("\n--- Testing Exports with Model School Fixture ---");
  const modelMdPath = path.resolve(__dirname, "../fixtures/demo_model_school.md");
  const modelText = fs.readFileSync(modelMdPath, "utf-8");
  const modelSchool = parseSchoolText(modelText).school;
  const modelSolved = solveSchool(modelSchool, { maxTimeMs: 10000 });
  assert(modelSolved.validation.is_valid, "Model School Fixture solved with 0 hard collisions");

  const modelPdf = InBrowserSchoolEngine.exportPrintablePDF(modelSchool, modelSolved.schedule, "all");
  assert(modelPdf.includes(modelSchool.name), `Model PDF includes school name: ${modelSchool.name}`);
  assert(!modelPdf.includes("palette-legend"), "Model PDF cleanly omits palette legend");

  const modelExcel = InBrowserSchoolEngine.exportExcelWorkbook(modelSchool, modelSolved.schedule);
  assert(modelExcel.includes(modelSchool.name), `Model Excel includes school name: ${modelSchool.name}`);
  assert(modelExcel.includes(`SecStyle_0`), "Model Excel includes SecStyle_0");

  console.log("\n======================================================================");
  console.log("🎉 ALL PDF & EXCEL EXPORT QUALITY & COLOR TESTS PASSED (100%)");
  console.log("======================================================================");
}

runExportTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
