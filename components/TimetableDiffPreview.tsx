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

  const summaryParts: string[] = [];
  if (diff.moved.length > 0) summaryParts.push(`نقل ${diff.moved.length}`);
  if (diff.added.length > 0) summaryParts.push(`إضافة ${diff.added.length}`);
  if (diff.removed.length > 0) summaryParts.push(`إلغاء ${diff.removed.length}`);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-[#EDE9FE]/65 border border-[#8B5CF6]/45 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-[#6D28D9] font-extrabold">
        <span className="inline-block w-2 h-2 rounded-full bg-[#8B5CF6] shrink-0" aria-hidden="true" />
        <span>معاينة التعديلات على الجدول</span>
        {summaryParts.length > 0 && (
          <span className="text-[11px] font-bold bg-[#FFFFFF] text-[#6D28D9] border border-[#8B5CF6]/30 px-2 py-0.5 rounded-md tabular-nums">
            {summaryParts.join(" · ")}
          </span>
        )}
        <span className="text-[11px] font-semibold text-[#57534E] tabular-nums">
          ({diff.unchanged_count} ثابتة)
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onApply}
          className="bg-[#0F766E] hover:bg-[#115E59] text-white font-extrabold text-[11px] px-2.5 py-1 rounded-lg shadow-2xs transition flex items-center gap-1 cursor-pointer"
        >
          <span>✓</span>
          <span>تأكيد</span>
        </button>

        <button
          type="button"
          onClick={onDiscard}
          className="bg-[#FFFFFF] hover:bg-[#FAFAF9] text-[#1C1917] border border-[#E7E5E4] font-bold text-[11px] px-2.5 py-1 rounded-lg transition cursor-pointer"
        >
          تراجع
        </button>
      </div>
    </div>
  );
}
