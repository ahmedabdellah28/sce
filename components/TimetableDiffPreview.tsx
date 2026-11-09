import React from "react";
import type { TimetableDiffReport } from "../services/diffEngine.js";

export interface TimetableDiffPreviewProps {
  diff: TimetableDiffReport;
  onApply: () => void;
  onDiscard: () => void;
}

export default function TimetableDiffPreview({
  diff,
  onApply,
  onDiscard,
}: TimetableDiffPreviewProps) {
  if (!diff || !diff.has_changes) return null;

  return (
    <div className="bg-white rounded-2xl border-2 border-blue-500 shadow-md p-4 space-y-3 animate-fade-in text-start">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔍</span>
          <div>
            <h3 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-2">
              معاينة التعديلات المقترحة بأقل تغيير (Dry-run Diff)
              <span className="text-[10px] bg-blue-100 text-blue-900 px-2 py-0.5 rounded-full font-bold">
                تثبيت الحصص السليمة
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              تم احتساب التعديلات بتجربة جافة على نسخة مؤقتة مع الحفاظ على {diff.unchanged_count} حصة ثابتة
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs px-3 py-1.5 rounded-xl transition"
          >
            ↩️ تراجع وإلغاء
          </button>

          <button
            type="button"
            onClick={onApply}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs px-4 py-1.5 rounded-xl shadow-xs transition flex items-center gap-1.5"
          >
            <span>✅</span>
            <span>تطبيق التعديلات الآن</span>
          </button>
        </div>
      </div>

      {/* Changes Summary Pills */}
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
        {diff.moved.length > 0 && (
          <span className="bg-blue-50 text-blue-900 border border-blue-300 px-2.5 py-1 rounded-lg flex items-center gap-1">
            <span>↔️</span>
            <span>تم نقل {diff.moved.length} حصة</span>
          </span>
        )}

        {diff.added.length > 0 && (
          <span className="bg-emerald-50 text-emerald-900 border border-emerald-300 px-2.5 py-1 rounded-lg flex items-center gap-1">
            <span>➕</span>
            <span>تم إضافة {diff.added.length} حصة</span>
          </span>
        )}

        {diff.removed.length > 0 && (
          <span className="bg-rose-50 text-rose-900 border border-rose-300 px-2.5 py-1 rounded-lg flex items-center gap-1">
            <span>➖</span>
            <span>تم إلغاء {diff.removed.length} حصة</span>
          </span>
        )}

        <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg font-bold ms-auto text-[11px]">
          {diff.unchanged_count} حصة مستقرة دون تغيير
        </span>
      </div>

      {/* Changes Detailed List */}
      <div className="max-h-48 overflow-y-auto space-y-1.5 pe-1">
        {diff.moved.map((item, idx) => (
          <div
            key={`move_${idx}`}
            className="p-2 rounded-lg bg-blue-50/60 border border-blue-200 text-[11px] text-blue-950 flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-blue-700">[نقل]</span>
              <span className="font-bold">{item.subject_name}</span>
              <span className="text-slate-600">({item.section_name})</span>
              <span className="text-slate-500">• {item.teacher_name}</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-bold text-slate-600 dir-ltr">
              <span className="bg-white border rounded px-1.5 py-0.5">يوم {item.from?.day} ح{item.from?.period}</span>
              <span>➔</span>
              <span className="bg-blue-600 text-white rounded px-1.5 py-0.5">يوم {item.to?.day} ح{item.to?.period}</span>
            </div>
          </div>
        ))}

        {diff.added.map((item, idx) => (
          <div
            key={`add_${idx}`}
            className="p-2 rounded-lg bg-emerald-50/60 border border-emerald-200 text-[11px] text-emerald-950 flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-emerald-700">[إضافة +]</span>
              <span className="font-bold">{item.subject_name}</span>
              <span className="text-slate-600">({item.section_name})</span>
              <span className="text-slate-500">• {item.teacher_name}</span>
            </div>
            <span className="text-[10px] font-bold bg-emerald-600 text-white rounded px-1.5 py-0.5">
              يوم {item.to?.day} ح{item.to?.period}
            </span>
          </div>
        ))}

        {diff.removed.map((item, idx) => (
          <div
            key={`rem_${idx}`}
            className="p-2 rounded-lg bg-rose-50/60 border border-rose-200 text-[11px] text-rose-950 flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-rose-700">[إلغاء -]</span>
              <span className="font-bold">{item.subject_name}</span>
              <span className="text-slate-600">({item.section_name})</span>
              <span className="text-slate-500">• {item.teacher_name}</span>
            </div>
            <span className="text-[10px] font-bold bg-rose-600 text-white rounded px-1.5 py-0.5">
              يوم {item.from?.day} ح{item.from?.period}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
