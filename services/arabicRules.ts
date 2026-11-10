/**
 * Arabic text helpers: normalisation, day/section parsing and the teacher rule-phrase parser.
 * Pure TypeScript (no DOM / Node dependencies).
 *
 * The rule parser understands the phrases used in the real school documents, e.g.:
 *   "الاحد والاثنين والثلاثاء اول حصص واربع وخميس اخر حصص"
 *   "الاحد : الحصص الاولى والثانية"       "الثلاثاء السادسة والسابعة"
 *   "يرجى اعطاءه الحصة الرابعة 3 ايام والحصة الاخيرة يومين"
 *   "لا يعمل في الحصة الاولى والاخيرة"     "يوم الاخد تعمل من الحصة الرابعة"
 *   "(كل الايام عدا الاحد)"                  "(الاحد والثلاثاء فقط)"
 */

import type { DailyPlacementRule } from "../types.ts";

export function normAr(s: string): string {
  return (s || "")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/(?:^|\s)عبد\s+/g, " عبد")
    .replace(/(?:^|\s)ابو\s+/g, " ابو")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const DAY_ORDER_CYCLE = [6, 0, 1, 2, 3, 4, 5]; // Sat, Sun, Mon, Tue, Wed, Thu, Fri
export const DAY_LABEL: Record<number, string> = {
  0: "الأحد",
  1: "الاثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
  6: "السبت",
};

const DAY_WORDS: Record<string, number> = {
  احد: 0,
  حد: 0,
  اخد: 0,
  اثنين: 1,
  ثنين: 1,
  اتنين: 1,
  تنين: 1,
  ثلاثاء: 2,
  ثلاثا: 2,
  تلات: 2,
  تلاتاء: 2,
  ثلوث: 2,
  ثلوثا: 2,
  تلوت: 2,
  اربعاء: 3,
  اربع: 3,
  ربع: 3,
  ربوع: 3,
  ربوعا: 3,
  خميس: 4,
  جمعه: 5,
  سبت: 6,
};

/** Returns the day index for a single token, or null. Handles prefixes "ال" and "و". */
export function dayFromToken(raw: string): number | null {
  let t = normAr(raw).replace(/[^\u0621-\u064A0-9]/g, "");
  if (!t) return null;
  if (t === "واحد" || t === "واحده") return null;
  const cands = [t];
  if (t.startsWith("و")) cands.push(t.slice(1));
  for (const c of [...cands]) if (c.startsWith("ال")) cands.push(c.slice(2));
  for (const c of cands) if (c in DAY_WORDS) return DAY_WORDS[c];
  return null;
}

export function parseDayRange(text: string): number[] | null {
  const n = normAr(text).replace(/[→←\-–—]/g, " الي ");
  const toks = n.split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const a = dayFromToken(toks[i]);
    if (a === null) continue;
    let j = i + 1;
    // connectors: الي / ل / للخميس (ل + day) / حتي
    let b: number | null = null;
    while (j < toks.length && j <= i + 3) {
      const tk = toks[j];
      if (["الي", "حتي", "ل", "لل"].includes(tk)) {
        j++;
        continue;
      }
      if (tk.startsWith("لل") || (tk.startsWith("ل") && tk.length > 3)) {
        const stripped = tk.startsWith("لل") ? tk.slice(2) : tk.slice(1);
        b = dayFromToken(stripped) ?? dayFromToken("ال" + stripped);
        if (b !== null) break;
      }
      b = dayFromToken(tk);
      break;
    }
    if (b !== null && /(الي|حتي|للخميس|للاربع|للثلاث|للاثنين|للسبت|للجمعه|\sل\w)/.test(" " + n)) {
      const ia = DAY_ORDER_CYCLE.indexOf(a);
      const ib = DAY_ORDER_CYCLE.indexOf(b);
      if (ia >= 0 && ib >= 0 && ia !== ib) {
        const out: number[] = [];
        for (let k = ia; ; k = (k + 1) % 7) {
          out.push(DAY_ORDER_CYCLE[k]);
          if (k === ib) break;
        }
        return out;
      }
    }
  }
  return null;
}

/** All distinct days mentioned in the text, in order of appearance. */
export function parseDaysList(text: string): number[] {
  const out: number[] = [];
  const toks = normAr(text)
    .replace(/[^\u0621-\u064A0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const next = toks[i + 1] || "";
    const tk = toks[i].replace(/^و/, "");
    // "اربع حصص" is the number four, not Wednesday
    if ((tk === "اربع" || tk === "ربع") && /^(حصه|حصص|حصتين)/.test(next)) continue;
    const d = dayFromToken(toks[i]);
    if (d !== null && !out.includes(d)) out.push(d);
  }
  return out;
}

export function parseSectionCode(text: string): string | null {
  const m = normAr(text).match(/(\d{1,2})\s*[\/\\ـ\-–:]\s*(\d{1,2})/);
  if (!m) return null;
  return `${Number(m[1])}/${Number(m[2])}`;
}

export function findSectionCodes(text: string): string[] {
  const out: string[] = [];
  const re = /(\d{1,2})\s*[\/\\ـ]\s*(\d{1,2})/g;
  const n = normAr(text);
  let m: RegExpExecArray | null;
  while ((m = re.exec(n))) {
    const c = `${Number(m[1])}/${Number(m[2])}`;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

const NUM_WORDS: Record<string, number> = {
  واحد: 1,
  واحده: 1,
  حصه: 1,
  اثنين: 2,
  اتنين: 2,
  حصتين: 2,
  يومين: 2,
  فصلين: 2,
  ثلاث: 3,
  ثلاثه: 3,
  تلات: 3,
  تلاته: 3,
  اربع: 4,
  اربعه: 4,
  خمس: 5,
  خمسه: 5,
  ست: 6,
  سته: 6,
  سبع: 7,
  سبعه: 7,
  ثمان: 8,
  ثمانيه: 8,
  تمانيه: 8,
};

const ORD_WORDS: Record<string, number> = {
  اولي: 1,
  اوليه: 1,
  اول: 1,
  ثانيه: 2,
  ثاني: 2,
  ثالثه: 3,
  ثالث: 3,
  رابعه: 4,
  رابع: 4,
  خامسه: 5,
  خامس: 5,
  سادسه: 6,
  سادس: 6,
  سابعه: 7,
  سابع: 7,
  ثامنه: 8,
  ثامن: 8,
  تاسعه: 9,
  عاشره: 10,
};

export function numberFromWord(w: string): number | null {
  const t = normAr(w).replace(/^و/, "").replace(/^ال/, "");
  if (/^\d+$/.test(t)) return Number(t);
  if (t in NUM_WORDS) return NUM_WORDS[t];
  const t2 = normAr(w).replace(/^ال/, "");
  if (t2 in NUM_WORDS) return NUM_WORDS[t2];
  return null;
}

// ---------------------------------------------------------------------------
// Rule phrase parser
// ---------------------------------------------------------------------------

export interface CompactRule {
  day: number | null;
  type: DailyPlacementRule["placement_type"];
  n?: number;
  periods?: number[];
  hard: boolean;
  weight?: number;
}

export interface ParsedRuleText {
  rules: CompactRule[];
  off_days: number[];
  work_days: number[] | null;
  double?: "REQUIRED" | "SINGLE" | "PREFER" | "FREE";
  max_daily?: number;
  max_weekly?: number;
  max_consecutive?: number;
  day_counts: Array<{ day: number; count: number; type: "EXACT" | "MAX" | "MIN" }>;
  last_period_target?: number;
  target_days?: number;
  before_break?: boolean;
  subject_double?: "REQUIRED" | "SINGLE";
  global_max_consecutive_same?: number;
  understood: boolean;
  unparsed_clauses?: string[];
}

type Item =
  | { k: "DAY"; d: number }
  | { k: "ORD"; n: number; last?: boolean }
  | { k: "NUM"; n: number }
  | { k: "FIRST" }
  | { k: "LAST" }
  | { k: "SLOT"; plural: boolean }
  | { k: "DAYS" }
  | { k: "NEG" }
  | { k: "OFF" }
  | { k: "WORK" }
  | { k: "ONLY" }
  | { k: "EXCEPT" }
  | { k: "FROM" }
  | { k: "AND" }
  | { k: "OTHER"; t: string };

function tokenize(clause: string): Item[] {
  const n = normAr(clause)
    .replace(/[()"“”*_`~«»\[\]{}!؟?]/g, " ")
    .replace(/[،,؛;:\-–—•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const toks = n.split(" ").filter(Boolean);
  const items: Item[] = [];
  for (let i = 0; i < toks.length; i++) {
    let t = toks[i];
    const nextRaw = toks[i + 1] || "";
    if (t === "و") {
      items.push({ k: "AND" });
      continue;
    }
    // strip a leading "و" if the remainder is meaningful
    const bare = t.startsWith("و") && t.length > 2 ? t.slice(1) : t;
    const noAl = bare.replace(/^ال/, "");

    if (/^(حصه|حصص|حصتين|حصتان|فتره|فترات|الحصه|الحصص|الحصتين)$/.test(bare) || /^(حصه|حصص|حصتين|فتره|فترات)$/.test(noAl)) {
      if (noAl === "حصتين" || noAl === "حصتان") items.push({ k: "NUM", n: 2 });
      items.push({ k: "SLOT", plural: noAl === "حصص" || noAl === "فترات" || noAl === "حصتين" });
      continue;
    }
    if (
      [
        "لا", "ليس", "بدون", "مش", "غير", "معندوش", "معندهاش", "معندهمش", "معهوش",
        "ممنوع", "ممنوعه", "عدم", "فاضيه", "فاضي", "معفي", "معفاه", "معفاة", "معفيه", "معفيين",
        "اعفيها", "اعفيه", "اعفيهم", "تعفي", "يعفي", "اعفاء", "اعف",
        "لن", "ما", "بلاش", "مياخدش", "ماياخدش", "ماياخدوش", "متاخدش", "ماتاخدش", "متاخذش", "ماتاخذش",
        "ماتديلوش", "ماتديهوش", "ماتديهاش", "ماتديلهاش", "ماتعطيش", "ماياخذ", "ماياخذش",
        "متديش", "ماتديش", "متديلوش", "متديهوش", "متديهاش", "متديلهاش",
        "منع", "امنع", "تمنع", "استبعاد", "مستبعد", "استثني", "مستثني", "استثناء", "استثن", "تستثني",
        "الغاء", "الغي", "الغ", "الغائ", "حذف", "احذف", "شيل", "شيله", "شيلله", "شل",
        "ازل", "ازاله", "كنسل", "فرغ", "فرغله", "فرغلها", "تفريغ", "تجنب", "تتجنب", "ملغي", "ملغاه", "ملغيه",
        "مبيجيش", "مايجيش", "مبتجيش", "مابتجيش", "مابيداومش", "مبتداومش", "مابتداومش", "مايداوم", "مايحضر", "مابيحضرش", "مابيشاركش"
      ].includes(bare) ||
      bare.startsWith("ممنوع") ||
      /^(?:شيل|فرغ|احذف|الغ|اعف)(?:ل|لي|له|لها|هم|يها|يه|يهم)$/.test(bare) ||
      /^(ما|مش|مبي|مابي|مبت|مابت)(يجي|يداوم|يحضر|يجيش|يداومش|تداومش|تجيش|يحضرش|ياخدش|تاخدش|ياخذش)$/.test(bare)
    ) {
      items.push({ k: "NEG" });
      continue;
    }
    if (
      ["اجازه", "اجازات", "اوف", "أوف", "تفرغ", "راحه", "راحة", "فري", "استراحه", "معفي", "معفاه"].includes(noAl) ||
      noAl === "اجازه" || noAl === "اوف" || noAl === "راحه" || noAl === "تفرغ"
    ) {
      items.push({ k: "OFF" });
      continue;
    }
    if (["عدا", "الا", "ماعدا"].includes(bare)) {
      items.push({ k: "EXCEPT" });
      continue;
    }
    if (bare === "ما" && (toks[i + 1] === "عدا" || toks[i + 1] === "الا")) continue;
    if (/^(يعمل|تعمل|يعملون|عمل|دوام|يداوم|تداوم|حضور|يحضر|تحضر|يجي|تيجي)$/.test(bare)) {
      items.push({ k: "WORK" });
      continue;
    }
    if (bare === "فقط" || bare === "بس") {
      items.push({ k: "ONLY" });
      continue;
    }
    if (bare === "من" && /^(ال)?(حصه|فتره)/.test(nextRaw)) {
      items.push({ k: "FROM" });
      continue;
    }
    if (/^(ايام|يوم|الايام)$/.test(bare) || bare === "يومين") {
      if (bare === "يومين") items.push({ k: "NUM", n: 2 });
      items.push({ k: "DAYS" });
      continue;
    }
    if (noAl === "اخر" || noAl === "اخيره" || noAl === "اخيرا" || noAl === "الاخيره" || noAl === "اخيرتين" || noAl === "اخرين") {
      items.push({ k: "LAST" });
      continue;
    }
    if (noAl === "اول" || noAl === "اولين") {
      items.push({ k: "FIRST" });
      continue;
    }
    if (noAl === "اوليه" || noAl === "اولي") {
      // ordinal "اولى" (period 1); FIRST marker follows so plural forms ("الحصص الاولية") mean "first periods"
      items.push({ k: "ORD", n: 1 });
      items.push({ k: "FIRST" });
      continue;
    }
    if (noAl in ORD_WORDS) {
      items.push({ k: "ORD", n: ORD_WORDS[noAl] });
      continue;
    }
    // "اربع" / "ثلاث" ...: number if followed by slot / days word, else day
    const nextBare = nextRaw.replace(/^ال/, "");
    const followedBySlot = /^(حصه|حصص|حصتين|ايام|يوم|يومين|فتره)/.test(nextBare);
    const asNum = numberFromWord(bare);
    if (/^\d+$/.test(bare)) {
      items.push({ k: "NUM", n: Number(bare) });
      continue;
    }
    const hasAl = /^(و)?ال/.test(t);
    const isDayWord = dayFromToken(t) !== null;
    if (asNum !== null) {
      // "اثنين"/"الاثنين" is always Monday; "اربع" is four only when followed by a slot/day word and has no "ال"
      if (!isDayWord) {
        items.push({ k: "NUM", n: asNum });
        continue;
      }
      if (!hasAl && followedBySlot && noAl !== "اثنين" && noAl !== "اتنين") {
        items.push({ k: "NUM", n: asNum });
        continue;
      }
    }
    const d = dayFromToken(t);
    if (d !== null) {
      items.push({ k: "DAY", d });
      continue;
    }
    if (asNum !== null) {
      items.push({ k: "NUM", n: asNum });
      continue;
    }
    items.push({ k: "OTHER", t: bare });
  }
  return items;
}

const SOFT_WORDS = /(يرجي|يفضل|تفضيل|يرغب|اريد|ارغب|ياريت|يستحسن|افضل|يفضل)/;

export function parseRuleText(text: string, allDays: number[] = [0, 1, 2, 3, 4]): ParsedRuleText {
  const out: ParsedRuleText = {
    rules: [],
    off_days: [],
    work_days: null,
    day_counts: [],
    understood: false,
    unparsed_clauses: [],
  };
  const clauses = (text || "")
    .split(/[\n.؛;|]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  for (const clause of clauses) {
    const rulesCountBefore = out.rules.length;
    const offCountBefore = out.off_days.length;
    const workDaysBefore = out.work_days;
    const countsBefore = out.day_counts.length;
    parseClauseInto(clause, allDays, out);
    const understoodClause =
      out.rules.length > rulesCountBefore ||
      out.off_days.length > offCountBefore ||
      out.work_days !== workDaysBefore ||
      out.day_counts.length > countsBefore ||
      Boolean(out.max_daily || out.max_weekly || out.max_consecutive || out.double || out.before_break);
    if (!understoodClause) {
      // Ignore recognized availability notes (e.g. "لا موانع", "متاح طوال اليوم", shift info)
      const cleanNorm = normAr(clause).replace(/\(.*?\)/g, "").trim();
      const isShiftInfo = /^(صباحي|مسائي|مشترك|صباحي فقط|مسائي فقط|مشترك الفترتان)/.test(cleanNorm);
      const isFreeAvailability = /(لا موانع|بدون موانع|لا توجد موانع|متاح طوال اليوم|طوال الاسبوع|متاح دائما|متاح عاديا|لا يوجد موانع|متاح)/.test(normAr(clause));
      if (!isShiftInfo && !isFreeAvailability) {
        out.unparsed_clauses = out.unparsed_clauses || [];
        if (!out.unparsed_clauses.includes(clause)) {
          out.unparsed_clauses.push(clause);
        }
      } else {
        out.understood = true;
      }
    }
  }
  return out;
}

function addRule(out: ParsedRuleText, r: CompactRule) {
  const dup = out.rules.find(
    (x) => x.day === r.day && x.type === r.type && x.n === r.n && JSON.stringify(x.periods) === JSON.stringify(r.periods)
  );
  if (!dup) out.rules.push(r);
}

function parseClauseInto(clause: string, allDays: number[], out: ParsedRuleText) {
  let effectiveClause = clause;
  const nRaw = normAr(clause);

  // Pre-extract daily MAX count caps ("متاخدش اكتر من حصتين", "بحد اقصى حصتين", "مينفعش تاخد غير حصتين")
  // and strip the cap phrase so "حصتين" doesn't collide with placement NEG rules!
  const capRx = /(?:^|\s)(?:و\s*)?(?:ما\s*تاخدش|متاخدش|ما\s*ياخدش|مياخدش|مينفعش\s*تاخد\s*غير|مينفعش\s*ياخد\s*غير|لا\s*(?:تزيد|يزيد)\s*عن|بحد\s*اقصي|كحد\s*اقصي|حد\s*اقصي)\s*(?:اكتر\s*من|اكثر\s*من)?\s*(\d+|حصه\s*واحده|حصه|حصتين|حصتان|ثلاث\s*حصص|تلات\s*حصص|اربع\s*حصص|خمس\s*حصص|ست\s*حصص)(?=\s|$)/g;
  const capMatches = [...nRaw.matchAll(capRx)];
  if (capMatches.length > 0) {
    const capWordMap: Record<string, number> = {
      حصه: 1, "حصه واحده": 1, حصتين: 2, حصتان: 2,
      "ثلاث حصص": 3, "تلات حصص": 3, "اربع حصص": 4, "خمس حصص": 5, "ست حصص": 6,
    };
    const clauseDays = parseDaysList(clause);
    for (const cm of capMatches) {
      const rawCount = cm[1].trim();
      const count = /^\d+$/.test(rawCount) ? Number(rawCount) : (capWordMap[rawCount] ?? null);
      if (count !== null && count >= 1) {
        const targetCapDays = clauseDays.length > 0 ? clauseDays : allDays;
        for (const d of targetCapDays) {
          if (!out.day_counts.some((dc) => dc.day === d && dc.type === "MAX")) {
            out.day_counts.push({ day: d, count, type: "MAX" });
          }
        }
        out.understood = true;
      }
    }
    effectiveClause = normAr(clause).replace(capRx, " ").replace(/\s+/g, " ").trim();
  }

  // Pre-extract attendance restriction ("مبتداومش غير يوم الأربعاء بس" / "تيجي الأربعاء بس" / "قصر حضور على الأربعاء")
  const restrictedOnlyMatch = nRaw.match(
    /(?:(?:مبتداومش|مابتداومش|ما\s*بتداومش|لا\s*(?:يعمل|تعمل|يداوم|تداوم|يحضر|تحضر))\s*(?:غير|الا|سوي)\s*|(?:قصر|اقتصر)\s*(?:حضور|دوام|عمل)[^،.]*?علي\s*|(?:تيجي|يجي|تداوم|يداوم|تحضر|يحضر)\s+(?:في\s+)?)(?:يوم\s+)?(?:ال)?(?:سبت|احد|اثنين|اتنين|ثلاثاء|تلات|اربعاء|اربع|خميس)(?:\s*(?:،|و)\s*(?:ال)?(?:سبت|احد|اثنين|اتنين|ثلاثاء|تلات|اربعاء|اربع|خميس))*(?:\s+(?:بس|فقط))?/
  );
  const precedingRaw = restrictedOnlyMatch?.index ? nRaw.slice(0, restrictedOnlyMatch.index) : "";
  const negatedBeforeRestriction = /(?:^|\s)(?:ما|مش|لا|لم|لن)\s*$/.test(precedingRaw);
  const restrictedExplicit = restrictedOnlyMatch
    ? /(?:^|\s)(?:غير|الا|سوي|علي|بس|فقط)(?=\s|$)/.test(restrictedOnlyMatch[0]) &&
      (!negatedBeforeRestriction || /(?:^|\s)(?:غير|الا|سوي)(?=\s|$)/.test(restrictedOnlyMatch[0]))
    : false;
  if (restrictedOnlyMatch && restrictedExplicit) {
    const allowedFromFrag = parseDaysList(restrictedOnlyMatch[0]);
    const allowedDays = allowedFromFrag;
    if (allowedDays.length > 0 && allowedDays.length < allDays.length) {
      for (const d of allDays) {
        if (!allowedDays.includes(d) && !out.off_days.includes(d)) {
          out.off_days.push(d);
        }
      }
      out.work_days = [...allowedDays];
      out.understood = true;
      effectiveClause = effectiveClause
        .replace(restrictedOnlyMatch[0], " ")
        .replace(/(?:يعني\s*)?(?:باقي|بقيه)\s*(?:الاسبوع|الايام)\s*اجازه/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  const n = normAr(effectiveClause);
  const soft = SOFT_WORDS.test(n);
  const hard = !soft;
  const items = tokenize(effectiveClause);
  if (items.length === 0) return;

  // ---- limits / policies phrased explicitly ----
  let m = n.match(/اقصي (?:عدد )?حصص يوميه\s*:?\s*(\d+)/);
  if (m) {
    out.max_daily = Number(m[1]);
    out.understood = true;
    return;
  }
  m = n.match(/اقصي (?:عدد )?حصص اسبوعيه\s*:?\s*(\d+)/);
  if (m) {
    out.max_weekly = Number(m[1]);
    out.understood = true;
    return;
  }
  m = n.match(/اقصي (?:عدد )?حصص متتاليه(?: لنفس المدرس مع نفس الفصل)?\s*:?\s*(\d+)/);
  if (m) {
    if (/نفس الفصل/.test(n)) out.global_max_consecutive_same = Number(m[1]);
    else out.max_consecutive = Number(m[1]);
    out.understood = true;
    return;
  }
  m = n.match(/عدد ايام العمل المستهدف\s*:?\s*(\d+)/);
  if (m) {
    out.target_days = Number(m[1]);
    out.understood = true;
    return;
  }
  if (/قبل الفسحه/.test(n)) {
    out.before_break = true;
    out.understood = true;
  }
  if (/تجنب/.test(n) && /متتاليه/.test(n)) {
    const nm = items.find((i) => i.k === "NUM") as { k: "NUM"; n: number } | undefined;
    out.global_max_consecutive_same = nm ? Math.max(1, nm.n - 1) : 3;
    out.understood = true;
    return;
  }
  if (/مزدوج|فترات|متتاليتين|حصتين متتاليتين|فردي|فرديه|منفرد|منفرده|مفرد|مفرده/.test(n)) {
    if (/ممنوع|لا مزدوج|بدون مزدوج|منفرده|منفرد|مفرده|مفرد|فردي|فرديه/.test(n) && !/مزدوج|فترات/.test(n.replace(/لا مزدوج|بدون مزدوج/g, ""))) out.double = "SINGLE";
    else if (/اجباري|الزامي|الزام|لازم/.test(n)) out.double = "REQUIRED";
    else if (/مفضل|يفضل|تفضيل/.test(n)) out.double = "PREFER";
    else out.double = "REQUIRED";
    if (/لهذه الماده|للماده/.test(n)) out.subject_double = out.double === "SINGLE" ? "SINGLE" : "REQUIRED";
    out.understood = true;
    // may also carry counts ("اربع حصص يوميا") — fall through quietly
  }

  const hasNeg = items.some((i) => i.k === "NEG");
  const hasSlotLike = items.some((i) => i.k === "SLOT" || i.k === "ORD" || i.k === "FIRST" || i.k === "LAST" || i.k === "FROM");
  const dayItems = items.filter((i) => i.k === "DAY") as Array<{ k: "DAY"; d: number }>;

  // ---- "has the last period" at day level: "يأخذ الحصة الأخيرة" ----
  // (explicit phrase from canonical markdown)
  if (/ياخذ الحصه الاخيره|يحمل الحصه الاخيره|ياخذ اخر حصه/.test(n)) {
    const days = dayItems.map((d) => d.d);
    if (days.length === 0) days.push(-1);
    for (const d of days) addRule(out, { day: d < 0 ? null : d, type: "HAS_LAST", hard, weight: soft ? 9 : 10 });
    out.understood = true;
    return;
  }

  // ---- explicit day counts: "الأحد: عدد حصصه 3 بالضبط" ----
  m = n.match(/عدد حصصه (\d+)\s*(بالضبط|كحد اقصي|كحد ادني)/);
  if (m && dayItems.length > 0) {
    const type = m[2] === "بالضبط" ? "EXACT" : m[2] === "كحد اقصي" ? "MAX" : "MIN";
    for (const d of dayItems) out.day_counts.push({ day: d.d, count: Number(m[1]), type });
    out.understood = true;
    return;
  }

  // ---- off / work days (no placement words) ----
  const hasOff = items.some((i) => i.k === "OFF");
  const exceptIdx = items.findIndex((i) => i.k === "EXCEPT");
  if (exceptIdx >= 0 && (dayItems.length > 0)) {
    const after = items.slice(exceptIdx + 1).filter((i) => i.k === "DAY") as Array<{ k: "DAY"; d: number }>;
    if (after.length > 0) {
      for (const d of after) if (!out.off_days.includes(d.d)) out.off_days.push(d.d);
      out.understood = true;
      return;
    }
  }
  if (hasOff && dayItems.length > 0) {
    const offIdx = items.findIndex((i) => i.k === "OFF");
    const dayAfter = items.slice(offIdx).filter((i) => i.k === "DAY") as Array<{ k: "DAY"; d: number }>;
    const use = dayAfter.length > 0 ? dayAfter : dayItems;
    for (const d of use) if (!out.off_days.includes(d.d)) out.off_days.push(d.d);
    out.understood = true;
    // continue only if the clause also holds placement words
    if (!hasSlotLike) return;
  }
  if (hasNeg && !hasSlotLike && dayItems.length > 0 && items.some((i) => i.k === "WORK")) {
    for (const d of dayItems) if (!out.off_days.includes(d.d)) out.off_days.push(d.d);
    out.understood = true;
    return;
  }
  if (!hasSlotLike && dayItems.length > 0 && !hasNeg && !hasOff) {
    const days = dayItems.map((d) => d.d);
    const cur = out.work_days ? out.work_days : [];
    for (const d of days) if (!cur.includes(d)) cur.push(d);
    out.work_days = cur;
    out.understood = true;
    return;
  }
  if (/كل ايام|كل يوم|جميع الايام|كل الايام|طوال الاسبوع|متفرغ|كامل الاسبوع/.test(n) && dayItems.length === 0 && !hasSlotLike) {
    out.understood = true;
    return;
  }

  // ---- placement parsing ----
  // Special: Nasser-like "الحصة الرابعة 3 ايام والحصة الاخيرة يومين" (count of days, no day names)
  const hasDaysCount = items.some((it, idx) => it.k === "NUM" && items[idx + 1]?.k === "DAYS");
  if (hasDaysCount && dayItems.length === 0) {
    const ords: number[] = [];
    let wantsLast = false;
    let wantsFirst = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.k === "ORD" && !(items[i + 1]?.k === "FIRST")) ords.push(it.n);
      if (it.k === "ORD" && items[i + 1]?.k === "FIRST") wantsFirst = true;
      if (it.k === "LAST") wantsLast = true;
    }
    const w = soft ? 9 : 10;
    if (ords.length > 0) addRule(out, { day: null, type: "EXACT_PERIODS", periods: ords, hard, weight: w });
    if (wantsLast) addRule(out, { day: null, type: "LAST_N", n: 1, hard, weight: w });
    if (wantsFirst && ords.length === 0) addRule(out, { day: null, type: "FIRST_N", n: 1, hard, weight: w });
    // mixed first+last over a number of days -> edges
    if (wantsFirst && wantsLast && ords.length === 0) {
      out.rules = out.rules.filter((r) => !(r.day === null && (r.type === "FIRST_N" || r.type === "LAST_N")));
      addRule(out, { day: null, type: "EDGES", n: 4, hard, weight: w });
    }
    out.understood = true;
    return;
  }

  // "first 4 periods in three days and two days last periods": edges
  const firstIdx = items.findIndex((i) => i.k === "FIRST");
  const lastIdx = items.findIndex((i) => i.k === "LAST");
  if (firstIdx >= 0 && lastIdx >= 0 && dayItems.length === 0 && items.some((i) => i.k === "DAYS") && !hasNeg) {
    const nm = items.find((i) => i.k === "NUM") as { k: "NUM"; n: number } | undefined;
    addRule(out, { day: null, type: "EDGES", n: nm ? nm.n : 4, hard: false, weight: 9 });
    out.understood = true;
    return;
  }

  // "حصة واحدة اخيرة فقط" / "حصة اخيرة واحدة للمدرس" / "ياخذ يومين حصة اخيرة": weekly count of last periods
  if (lastIdx >= 0 && dayItems.length === 0 && !hasNeg) {
    const nm = items.find((i) => i.k === "NUM") as { k: "NUM"; n: number } | undefined;
    const hasOne = /واحد|يومين|ايام/.test(n) || !!nm;
    if (hasOne && !items.some((i) => i.k === "ORD" && i.n > 1)) {
      const val = nm ? nm.n : 1;
      out.last_period_target = val;
      out.understood = true;
      return;
    }
  }

  // Walk items collecting specs. Days accumulate until a spec consumes them.
  let pending: number[] = [];
  let i = 0;
  const lookAheadDays = (from: number): { days: number[]; next: number } => {
    const days: number[] = [];
    let j = from;
    while (j < items.length) {
      const it = items[j];
      if (it.k === "DAY") days.push(it.d);
      else if (it.k === "AND" || it.k === "DAYS") {
        /* skip */
      } else if (it.k === "OTHER" && ["في", "كل", "من"].includes(it.t)) {
        /* skip */
      } else break;
      j++;
    }
    return { days, next: j };
  };

  const w = soft ? 9 : 10;
  const push = (days: number[], base: Omit<CompactRule, "day">) => {
    const targetDays =
      days.length > 0
        ? days
        : dayItems.length > 0
          ? dayItems.map((d) => d.d)
          : out.work_days && out.work_days.length > 0
            ? out.work_days
            : [];
    if (targetDays.length === 0) addRule(out, { ...base, day: null });
    else for (const d of targetDays) addRule(out, { ...base, day: d });
  };

  while (i < items.length) {
    const it = items[i];
    if (it.k === "DAY") {
      pending.push(it.d);
      i++;
      continue;
    }
    // Negated placement: "لا يعمل في الحصة الاولى والاخيرة" / "معندوش الأول" / "بلاش الأولى"
    if (it.k === "NEG") {
      let j = i + 1;
      const neg: Array<"FIRST" | "LAST" | number> = [];
      let sawWorkOnly = false;
      const lim = Math.min(items.length, i + 16);
      for (; j < lim; j++) {
        const x = items[j];
        if (x.k === "ORD" && items[j + 1]?.k === "FIRST") {
          neg.push("FIRST");
          j++;
        } else if (x.k === "ORD") {
          neg.push(x.n === 1 ? "FIRST" : x.n);
        } else if (x.k === "FIRST") {
          neg.push("FIRST");
        } else if (x.k === "LAST") {
          neg.push("LAST");
        } else if (x.k === "NUM") {
          neg.push(x.n);
        } else if (x.k === "OTHER" && /^(?:يبقوا|ويبقوا|يكونوا|ويكونوا|ويكون|وتكون|لكن|غير|اكتر|اكثر|غيرهم)$/.test(x.t)) {
          break;
        } else if (x.k === "WORK" || x.k === "SLOT" || x.k === "DAYS" || x.k === "AND" || x.k === "OTHER" || x.k === "FROM") {
          if (x.k === "WORK") sawWorkOnly = true;
        } else if (x.k === "DAY") {
          pending.push(x.d);
        } else break;
      }
      void sawWorkOnly;
      if (neg.length > 0) {
        const periods = neg.filter((x): x is number => typeof x === "number");
        const days = pending;
        if (neg.includes("FIRST")) push(days, { type: "AVOID_FIRST", hard, weight: w });
        if (neg.includes("LAST")) push(days, { type: "AVOID_LAST", hard, weight: w });
        if (periods.length) push(days, { type: "AVOID_PERIODS", periods, hard, weight: w });
        pending = [];
        out.understood = true;
        i = j;
        continue;
      }
      i++;
      continue;
    }
    // "من الحصة الرابعة": works from that period on
    if (it.k === "FROM") {
      const ordIt = items.slice(i + 1, i + 4).find((x) => x.k === "ORD") as { k: "ORD"; n: number } | undefined;
      const numIt = items.slice(i + 1, i + 4).find((x) => x.k === "NUM") as { k: "NUM"; n: number } | undefined;
      const from = ordIt?.n ?? numIt?.n;
      if (from && from > 1) {
        const periods = Array.from({ length: from - 1 }, (_, k) => k + 1);
        let days = pending;
        if (days.length === 0) days = lookAheadDays(i + 1).days;
        push(days, { type: "AVOID_PERIODS", periods, hard, weight: w });
        pending = [];
        out.understood = true;
      }
      // skip the slot / ordinal words that belong to this "from period N" phrase
      i++;
      while (i < items.length && (items[i].k === "SLOT" || items[i].k === "ORD" || items[i].k === "NUM")) i++;
      continue;
    }
    // FIRST / LAST specs with optional counts
    if (it.k === "FIRST" || it.k === "LAST") {
      const isFirst = it.k === "FIRST";
      // skip if this FIRST is the companion of an ordinal "الاولى" handled in ORD branch
      let j = i + 1;
      let num: number | undefined;
      let plural = false;
      let hasSlot = false;
      while (j < items.length && j <= i + 3) {
        const x = items[j];
        if (x.k === "NUM") {
          num = x.n;
          j++;
        } else if (x.k === "SLOT") {
          plural = x.plural;
          hasSlot = true;
          j++;
        } else break;
      }
      if (!hasSlot) {
        for (let b = i - 1; b >= 0 && b >= i - 2; b--) {
          const x = items[b];
          if (x.k === "SLOT") {
            plural = x.plural;
            hasSlot = true;
            break;
          }
          if (x.k !== "AND") break;
        }
      }
      let days = pending;
      if (days.length === 0) {
        const la = lookAheadDays(j);
        if (la.days.length > 0) {
          days = la.days;
          j = la.next;
        }
      }
      const nVal = num ?? (isFirst ? (plural ? 4 : hasSlot ? 1 : 4) : plural ? 4 : hasSlot ? 1 : 1);
      push(days, { type: isFirst ? "FIRST_N" : "LAST_N", n: nVal, hard, weight: w });
      pending = [];
      out.understood = true;
      i = j;
      continue;
    }
    // Ordinal lists: "الحصة الرابعة", "الاولى والثانية", "السادسة والسابعة"
    if (it.k === "ORD") {
      const ords: number[] = [];
      let j = i;
      let sawFirstWord = false;
      let sawLast = false;
      while (j < items.length) {
        const x = items[j];
        if (x.k === "ORD") {
          ords.push(x.n);
          j++;
          if (items[j]?.k === "FIRST") {
            sawFirstWord = true;
            j++;
          }
        } else if (x.k === "AND") j++;
        else if (x.k === "LAST") {
          sawLast = true;
          j++;
        } else break;
      }
      // look back for slot plurality
      let plural = false;
      for (let b = i - 1; b >= 0 && b >= i - 2; b--) {
        const x = items[b];
        if (x.k === "SLOT") {
          plural = x.plural;
          break;
        }
      }
      let days = pending;
      if (days.length === 0) {
        const la = lookAheadDays(j);
        if (la.days.length > 0) {
          days = la.days;
          j = la.next;
        }
      }
      const uniq = [...new Set(ords)].sort((a, b) => a - b);
      const contiguousFromOne = uniq.every((v, idx) => v === idx + 1);
      if (uniq.length === 1 && uniq[0] === 1 && plural && sawFirstWord) {
        push(days, { type: "FIRST_N", n: 4, hard, weight: w });
      } else if (contiguousFromOne) {
        push(days, { type: "FIRST_N", n: uniq.length, hard, weight: w });
      } else {
        push(days, { type: "EXACT_PERIODS", periods: uniq, hard, weight: w });
      }
      if (sawLast) push(days, { type: "LAST_N", n: 1, hard, weight: w });
      pending = [];
      out.understood = true;
      i = j;
      continue;
    }
    // "يعمل الحصص 2 و 3 و4" / "عدد حصص" counts
    if (it.k === "WORK" || it.k === "SLOT" || it.k === "NUM") {
      let j = i;
      let slotSeen = false;
      const nums: number[] = [];
      let plural = false;
      let hadWork = false;
      while (j < items.length && j <= i + 12) {
        const x = items[j];
        if (x.k === "WORK") {
          hadWork = true;
          j++;
        } else if (x.k === "SLOT") {
          slotSeen = true;
          plural = x.plural;
          j++;
        } else if (x.k === "NUM") {
          nums.push(x.n);
          j++;
        } else if (x.k === "AND") j++;
        else if (x.k === "OTHER" && ["في", "كل", "من"].includes(x.t)) j++;
        else break;
      }
      void plural;
      // "ثلاث حصص في كل من الثلاثاء والاربعاء": daily counts
      const la = lookAheadDays(j);
      if (nums.length >= 1 && slotSeen && (pending.length > 0 || la.days.length > 0) && !hadWork) {
        const days = pending.length ? pending : la.days;
        for (const d of days) out.day_counts.push({ day: d, count: nums[0], type: "EXACT" });
        pending = [];
        out.understood = true;
        i = pending.length ? j : la.next;
        continue;
      }
      if (hadWork && nums.length > 0 && slotSeen) {
        const uniq = [...new Set(nums)].sort((a, b) => a - b);
        const contiguousFromOne = uniq.every((v, idx) => v === idx + 1);
        const days = pending;
        push(days, contiguousFromOne ? { type: "FIRST_N", n: uniq.length, hard, weight: w } : { type: "EXACT_PERIODS", periods: uniq, hard, weight: w });
        pending = [];
        out.understood = true;
        i = j;
        continue;
      }
      i = Math.max(j, i + 1);
      continue;
    }
    i++;
  }
  // leftover pending days with a work verb ("يعمل الاحد") are work-day statements
  if (pending.length > 0 && out.rules.length === 0 && items.some((x) => x.k === "WORK")) {
    out.work_days = [...new Set([...(out.work_days || []), ...pending])];
    out.understood = true;
  }
  void allDays;
}

/**
 * Parses text found inside "( ... )" next to a teacher or subject name.
 * Handles day clauses ("الاحد والثلاثاء فقط", "كل الايام عدا الاحد", "اجازة الاربعاء") and rule phrases.
 */
export function parseParenthesis(text: string, allDays: number[]): ParsedRuleText {
  const parsed = parseRuleText(text, allDays);
  return parsed;
}
