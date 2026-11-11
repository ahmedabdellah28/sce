/**
 * SCE - School Assistant Patch (Direct drop-in replacement for services/schoolAssistant.ts parts)
 * Compatible with types.ts and all imports.
 */

import type { SchoolData, Schedule, AnalysisReport, Teacher, Section, Subject, TimetableEntry } from "../types.ts";
import { DAY_NAMES_AR } from "../types.ts";
import { normAr } from "./arabicRules.ts";
import { resolveContextualEntities, analyzeTeacherFairness } from "./agentMemoryEngine.ts";

export interface AssistantAnswer {
  answered: boolean;
  reply: string;
  is_query: boolean;
  topic?: string;
}

/**
 * دالة التحقق من استعلامات وأسئلة المستخدم (محدثة بالكامل)
 * تحل مشكلة اعتبار النصوص الطويلة (>=5 أسطر / 150 حرفاً) أوامر تعديل،
 * وتتعرف على أسئلة المحاكاة (ماذا لو، هل يمكن) والأسئلة الاستشارية.
 */
export function isQuestionOrInquiry(message: string): boolean {
  const raw = (message || "").trim();
  if (!raw) return false;

  const n = normAr(raw);

  // 1. فحص أسئلة المحاكاة والافتراض (What-If) - تمنع اعتبارها أوامر تعديل قسرية
  if (
    /^(?:ماذا\s+لو|لو\s+اننا|لو\s+نقلنا|لو\s+بدلنا|لو\s+غيرنا|هل\s+لو|هل\s+يمكن|هل\s+ينفع|هل\s+يصلح|هل\s+يحدث\s+تعارض|جرب\s+تشوف)/.test(n) ||
    /(?:هل\s+سيحدث\s+تعارض|هل\s+يتعارض|ما\s+رايك\s+لو|ايه\s+اللي\s+يحصل\s+لو)/.test(n)
  ) {
    return true;
  }

  // 2. علامة الاستفهام الصريحة
  if (/[؟?]/.test(raw)) return true;

  // 3. أدوات الاستفهام في البداية
  const nNoPrefix = n.replace(/^(?:من\s+|في\s+|يا\s+|عزيزي\s+|استاذ\s+|لو\s+سمحت\s+|ممكن\s+)+/, "").trim();
  if (
    /^(?:هل|من|ما|ماذا|كيف|كم|أين|اين|متى|متي|لماذا|أيعقل|ايعقل|أيمكن|ايمكن|عرض|أظهر|اظهر|أرني|ارني|وريني|شوف|جدول|ما\s+هو|ما\s+هي|ما\s+رايك)\b/.test(nNoPrefix)
  ) {
    return true;
  }

  // 4. استعلامات الإحصائيات والفحص والتحليل وعدالة التوزيع
  if (
    /(?:احصائيات|إحصائيات|تقرير|عدالة|تحليل|توزيع|نصاب|شاغر|شاغرة|احتياط|احتياطي|فراغ|فراغات|تفرغ|تفرغات|تعارض|تعارضات|اقترح|اقتراح|نصيحة|توصية)/.test(nNoPrefix)
  ) {
    return true;
  }

  // 5. التحيات والمجاملات
  if (/^(?:مرحبا|اهلا|السلام\s+عليكم|صباح\s+الخير|مساء\s+الخير|شكرا|hi|hello)\b/.test(nNoPrefix)) {
    return true;
  }

  return false;
}
