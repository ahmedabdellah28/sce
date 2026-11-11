import React, { useState, useEffect, useMemo, useRef } from "react";
import { HybridSchoolService, DEFAULT_BACKEND_URL } from "./services/geminiService.ts";
import { getBuiltInSchool376, NESSCHINFO_RAW_TEXT, InBrowserSchoolEngine } from "./services/localEngine.ts";
import {
  ApiKeyManager,
  type UserApiKeyEntry,
  sanitizeSecretText,
} from "./services/apiKeyManager.ts";
import {
  createBlankSchoolTemplate,
  createPrimarySchoolTemplate,
  createSecondarySchoolTemplate,
} from "./services/schoolTemplates.ts";
import {
  ALL_SCHOOL_PRESETS,
  getPresetById,
  createSchoolFromPreset,
  getOrderedSchoolDays,
  getSectionDayPeriods,
  getDayMaxPeriods,
  getTeacherDayPeriods,
  type SchoolPreset,
} from "./presets/commonPresets.ts";
import { generateSchoolMarkdown } from "./services/schoolCore.ts";
import SchoolWizardStepper from "./components/SchoolWizardStepper.tsx";
import {
  dryRunMinimalChange,
  calculateTimetableDiff,
  type TimetableDiffReport,
} from "./services/diffEngine.ts";
import TimetableDiffPreview from "./components/TimetableDiffPreview.tsx";
import { JadwalLogo } from "./components/JadwalLogo.tsx";
import TeacherManagementHub from "./components/TeacherManagementHub.tsx";
import { DAY_NAMES_AR, type SchoolData, type Schedule, type AnalysisReport, type TimetableEntry } from "./types.ts";
import {
  DEFAULT_CHAT_WELCOME_MESSAGE,
  type ChatMessageRecord,
  type EngineResponseMeta,
  type SchoolUndoSnapshot,
  type AgentUiActionType,
} from "./services/agentMemoryEngine.ts";

export interface SavedSchoolEntry {
  id: string;
  name: string;
  school: SchoolData;
  raw_text: string;
  schedule?: Schedule | null;
  analysis?: AnalysisReport | null;
  chat_history?: ChatMessageRecord[];
  undo_stack?: SchoolUndoSnapshot[];
}

export interface CellPalette {
  bg: string;
  border: string;
  text: string;
  badgeBg: string;
  badgeText: string;
  icon?: string;
}

const RICH_PALETTES: CellPalette[] = [
  { bg: "#FEF3C7", border: "#F59E0B", text: "#78350F", badgeBg: "#FDE68A", badgeText: "#92400E", icon: "📖" }, // Amber
  { bg: "#DBEAFE", border: "#3B82F6", text: "#1E3A8A", badgeBg: "#BFDBFE", badgeText: "#1D4ED8", icon: "📐" }, // Blue
  { bg: "#D1FAE5", border: "#10B981", text: "#064E3B", badgeBg: "#A7F3D0", badgeText: "#047857", icon: "🔬" }, // Emerald
  { bg: "#CCFBF1", border: "#14B8A6", text: "#134E4A", badgeBg: "#99F6E4", badgeText: "#0F766E", icon: "🔤" }, // Teal
  { bg: "#FFE4E6", border: "#F43F5E", text: "#881337", badgeBg: "#FECDD3", badgeText: "#BE123C", icon: "🌍" }, // Rose
  { bg: "#EDE9FE", border: "#8B5CF6", text: "#4C1D95", badgeBg: "#DDD6FE", badgeText: "#6D28D9", icon: "✨" }, // Violet
  { bg: "#E0E7FF", border: "#6366F1", text: "#312E81", badgeBg: "#C7D2FE", badgeText: "#4338CA", icon: "💻" }, // Indigo
  { bg: "#ECFCCB", border: "#84CC16", text: "#365314", badgeBg: "#D9F99D", badgeText: "#4D7C0F", icon: "⚽" }, // Lime
  { bg: "#FFEDD5", border: "#F97316", text: "#7C2D12", badgeBg: "#FED7AA", badgeText: "#C2410C", icon: "🎨" }, // Orange
  { bg: "#FCE7F3", border: "#EC4899", text: "#831843", badgeBg: "#FBCFE8", badgeText: "#BE185D", icon: "🎵" }, // Pink
  { bg: "#F5D0FE", border: "#D946EF", text: "#701A75", badgeBg: "#E879F9", badgeText: "#86198F", icon: "🗣️" }, // Fuchsia
  { bg: "#E0F2FE", border: "#0EA5E9", text: "#0C4A6E", badgeBg: "#BAE6FD", badgeText: "#0369A1", icon: "🛠️" }, // Sky
  { bg: "#FFFBEB", border: "#F59E0B", text: "#78350F", badgeBg: "#FEF3C7", badgeText: "#B45309", icon: "💡" }, // Amber Warm
  { bg: "#F1F5F9", border: "#64748B", text: "#0F172A", badgeBg: "#E2E8F0", badgeText: "#334155", icon: "⚙️" }, // Slate
  { bg: "#FEF9C3", border: "#EAB308", text: "#713F12", badgeBg: "#FEF08A", badgeText: "#854D0E", icon: "🌟" }, // Yellow
  { bg: "#DCFCE7", border: "#22C55E", text: "#14532D", badgeBg: "#BBF7D0", badgeText: "#15803D", icon: "🌱" }, // Forest
];

const SECTION_PALETTE = RICH_PALETTES;

export function getSubjectPalette(subjectName: string = ""): CellPalette {
  const s = subjectName.trim().toLowerCase();
  if (s.includes("عرب") || s.includes("قرائ") || s.includes("نصوص") || s.includes("خط") || s.includes("إملاء")) {
    return { bg: "#FEF3C7", border: "#F59E0B", text: "#78350F", badgeBg: "#FDE68A", badgeText: "#92400E", icon: "📖" };
  }
  if (s.includes("رياض") || s.includes("حساب") || s.includes("جبر") || s.includes("هندس") || s.includes("math")) {
    return { bg: "#DBEAFE", border: "#3B82F6", text: "#1E3A8A", badgeBg: "#BFDBFE", badgeText: "#1D4ED8", icon: "📐" };
  }
  if (s.includes("علوم") || s.includes("كيميا") || s.includes("فيزيا") || s.includes("أحياء") || s.includes("science")) {
    return { bg: "#D1FAE5", border: "#10B981", text: "#064E3B", badgeBg: "#A7F3D0", badgeText: "#047857", icon: "🔬" };
  }
  if (s.includes("إنجليز") || s.includes("انجليز") || s.includes("english") || s.includes("أجنبي")) {
    return { bg: "#CCFBF1", border: "#14B8A6", text: "#134E4A", badgeBg: "#99F6E4", badgeText: "#0F766E", icon: "🔤" };
  }
  if (s.includes("دراسات") || s.includes("تاريخ") || s.includes("جغرافيا") || s.includes("اجتماع")) {
    return { bg: "#FFE4E6", border: "#F43F5E", text: "#881337", badgeBg: "#FECDD3", badgeText: "#BE123C", icon: "🌍" };
  }
  if (s.includes("دين") || s.includes("قرآن") || s.includes("إسلام") || s.includes("مسيح")) {
    return { bg: "#EDE9FE", border: "#8B5CF6", text: "#4C1D95", badgeBg: "#DDD6FE", badgeText: "#6D28D9", icon: "✨" };
  }
  if (s.includes("حاسب") || s.includes("كمبيوتر") || s.includes("تكنولوج") || s.includes("ict")) {
    return { bg: "#E0E7FF", border: "#6366F1", text: "#312E81", badgeBg: "#C7D2FE", badgeText: "#4338CA", icon: "💻" };
  }
  if (s.includes("رياضية") || s.includes("ألعاب") || s.includes("بدني") || s.includes("sport") || s.includes("gym")) {
    return { bg: "#ECFCCB", border: "#84CC16", text: "#365314", badgeBg: "#D9F99D", badgeText: "#4D7C0F", icon: "⚽" };
  }
  if (s.includes("فني") || s.includes("رسم") || s.includes("موسيق") || s.includes("art")) {
    return { bg: "#FFEDD5", border: "#F97316", text: "#7C2D12", badgeBg: "#FED7AA", badgeText: "#C2410C", icon: "🎨" };
  }
  if (s.includes("مهارات") || s.includes("مهني") || s.includes("توكاتسو") || s.includes("نشاط")) {
    return { bg: "#FCE7F3", border: "#EC4899", text: "#831843", badgeBg: "#FBCFE8", badgeText: "#BE185D", icon: "🛠️" };
  }
  if (s.includes("فرنس") || s.includes("ألمان") || s.includes("إيطال")) {
    return { bg: "#F5D0FE", border: "#D946EF", text: "#701A75", badgeBg: "#E879F9", badgeText: "#86198F", icon: "🗣️" };
  }
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return { ...RICH_PALETTES[Math.abs(hash) % RICH_PALETTES.length], icon: "📚" };
}

const DARK_CELL_PALETTES_BY_BG: Record<string, Omit<CellPalette, "icon">> = {
  "#FEF3C7": { bg: "#3B2306", border: "#D97706", text: "#FDE68A", badgeBg: "#78350F", badgeText: "#FEF3C7" },
  "#DBEAFE": { bg: "#172554", border: "#3B82F6", text: "#BFDBFE", badgeBg: "#1E3A8A", badgeText: "#DBEAFE" },
  "#D1FAE5": { bg: "#063626", border: "#10B981", text: "#A7F3D0", badgeBg: "#065F46", badgeText: "#D1FAE5" },
  "#CCFBF1": { bg: "#0B3534", border: "#14B8A6", text: "#99F6E4", badgeBg: "#115E59", badgeText: "#CCFBF1" },
  "#FFE4E6": { bg: "#450A1B", border: "#F43F5E", text: "#FECDD3", badgeBg: "#881337", badgeText: "#FFE4E6" },
  "#EDE9FE": { bg: "#2B1454", border: "#8B5CF6", text: "#DDD6FE", badgeBg: "#4C1D95", badgeText: "#EDE9FE" },
  "#E0E7FF": { bg: "#1E1B4B", border: "#6366F1", text: "#C7D2FE", badgeBg: "#312E81", badgeText: "#E0E7FF" },
  "#ECFCCB": { bg: "#1E330B", border: "#84CC16", text: "#D9F99D", badgeBg: "#365314", badgeText: "#ECFCCB" },
  "#FFEDD5": { bg: "#421A06", border: "#F97316", text: "#FED7AA", badgeBg: "#7C2D12", badgeText: "#FFEDD5" },
  "#FCE7F3": { bg: "#480B27", border: "#EC4899", text: "#FBCFE8", badgeBg: "#831843", badgeText: "#FCE7F3" },
  "#F5D0FE": { bg: "#3D0E42", border: "#D946EF", text: "#F5D0FE", badgeBg: "#701A75", badgeText: "#FAE8FF" },
  "#E0F2FE": { bg: "#0C2D42", border: "#0EA5E9", text: "#BAE6FD", badgeBg: "#075985", badgeText: "#E0F2FE" },
  "#FFFBEB": { bg: "#3B2306", border: "#F59E0B", text: "#FDE68A", badgeBg: "#78350F", badgeText: "#FEF3C7" },
  "#F1F5F9": { bg: "#1E293B", border: "#64748B", text: "#E2E8F0", badgeBg: "#334155", badgeText: "#F1F5F9" },
  "#FEF9C3": { bg: "#3A2B06", border: "#EAB308", text: "#FEF08A", badgeBg: "#713F12", badgeText: "#FEF9C3" },
  "#DCFCE7": { bg: "#08331B", border: "#22C55E", text: "#BBF7D0", badgeBg: "#14532D", badgeText: "#DCFCE7" },
};

function adaptCellPalette(pal: CellPalette, isDark: boolean): CellPalette {
  if (!isDark) return pal;
  const mapped = DARK_CELL_PALETTES_BY_BG[pal.bg];
  if (mapped) return { ...mapped, icon: pal.icon };
  return { bg: "#1E293B", border: "#64748B", text: "#E2E8F0", badgeBg: "#334155", badgeText: "#F1F5F9", icon: pal.icon };
}


export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("JADWAL_THEME") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("JADWAL_THEME", theme);
    } catch { }
  }, [theme]);

  const [backendUrl] = useState(() => {
    const saved = localStorage.getItem("SCHEDULER_BACKEND_URL");
    return saved === "http://localhost:8000" ? "" : (saved ?? DEFAULT_BACKEND_URL);
  });

  const [service] = useState(() => new HybridSchoolService(DEFAULT_BACKEND_URL));
  const [serverOnline, setServerOnline] = useState(false);

  const [presets, setPresets] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [savedSchools, setSavedSchools] = useState<SavedSchoolEntry[]>(() => {
    try {
      const stored = localStorage.getItem("AI_STUDIO_SAVED_SCHOOLS_V2");
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.map((entry: any) =>
            entry?.school?.teachers
              ? {
                  ...entry,
                  school: {
                    ...entry.school,
                    teachers: entry.school.teachers.map((t: any) => ({
                      ...t,
                      name: String(t?.name || "").replace(/\s*\(شاغر\)/g, "").trim(),
                      code: String(t?.code || "").replace(/^شاغر-/, "").trim(),
                    })),
                  },
                }
              : entry
          );
        }
      }
    } catch { }
    const b376 = getBuiltInSchool376();
    const solved376 = InBrowserSchoolEngine.solveInBrowser(b376);
    return [
      {
        id: "school_376",
        name: `${b376.name} (إعدادي - ${b376.sections.length} فصول - 36 حصة)`,
        school: b376,
        raw_text: NESSCHINFO_RAW_TEXT,
        schedule: solved376.schedule,
        analysis: InBrowserSchoolEngine.analyzeSchool(b376),
      },
    ];
  });

  const [selectedPreset, setSelectedPreset] = useState(() => {
    const activeId = localStorage.getItem("AI_STUDIO_ACTIVE_SCHOOL_ID");
    return activeId || "";
  });
  const [showAddSchoolModal, setShowAddSchoolModal] = useState(false);
  const [showHeaderActionsMenu, setShowHeaderActionsMenu] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState("");
  const [newSchoolType, setNewSchoolType] = useState<string>("preset");
  const [newSchoolPresetId, setNewSchoolPresetId] = useState<string>("preset_primary_gov_single");
  const [presetCategoryFilter, setPresetCategoryFilter] = useState<"ALL" | "GOVERNMENT_GENERAL" | "EXPERIMENTAL_LANGUAGE">("ALL");
  const [newSchoolPeriods, setNewSchoolPeriods] = useState(7);
  const [newSchoolAiPrompt, setNewSchoolAiPrompt] = useState("");
  const [lastUpdatedTime, setLastUpdatedTime] = useState<string>(() =>
    new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
  );

  const initialActiveEntry = useMemo(() => {
    if (selectedPreset) {
      const found = savedSchools.find((s) => s.id === selectedPreset);
      if (found) return found;
    }
    return savedSchools[0] || null;
  }, []);

  useEffect(() => {
    if (!selectedPreset && initialActiveEntry) {
      setSelectedPreset(initialActiveEntry.id);
      localStorage.setItem("AI_STUDIO_ACTIVE_SCHOOL_ID", initialActiveEntry.id);
    }
  }, [initialActiveEntry, selectedPreset]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const allSchoolsList = useMemo(() => {
    return savedSchools.map((s) => ({
      id: s.id,
      name: s.name,
      description: `مدرسة (${s.school.sections.length} فصول - ${s.school.teachers.length} معلماً)`,
    }));
  }, [savedSchools]);

  const [rawText, setRawText] = useState<string>(() => initialActiveEntry?.raw_text || "");
  const [school, setSchool] = useState<SchoolData | null>(() => initialActiveEntry?.school || null);
  const [schedule, setSchedule] = useState<Schedule | null>(() => {
    if (!initialActiveEntry?.school) return null;
    return initialActiveEntry?.schedule || InBrowserSchoolEngine.solveInBrowser(initialActiveEntry.school).schedule;
  });
  const [analysis, setAnalysis] = useState<AnalysisReport | null>(() => {
    if (!initialActiveEntry?.school) return null;
    return initialActiveEntry?.analysis || InBrowserSchoolEngine.analyzeSchool(initialActiveEntry.school);
  });
  const [metrics, setMetrics] = useState<any>(() => {
    if (!initialActiveEntry?.school) return null;
    return InBrowserSchoolEngine.solveInBrowser(initialActiveEntry.school).metrics;
  });
  const [validation, setValidation] = useState<any>(() => {
    if (!initialActiveEntry?.school) return null;
    return InBrowserSchoolEngine.solveInBrowser(initialActiveEntry.school).validation;
  });
  const [normNotes, setNormNotes] = useState<string[]>([]);
  const [unparsedNotes, setUnparsedNotes] = useState<string[]>([]);

  const [activeTab, setActiveTab] = useState<"wizard" | "timetable" | "constraints" | "analyze" | "ingest">("timetable");
  const [viewMode, setViewMode] = useState<"master" | "section" | "teacher">("master");
  const [selectedSectionId, setSelectedSectionId] = useState(() => initialActiveEntry?.school?.sections[0]?.id || "SEC_1_1");
  const [selectedTeacherId, setSelectedTeacherId] = useState(() => initialActiveEntry?.school?.teachers[0]?.id || "TCH_RYA");
  const [selectedConstraintTeacherId, setSelectedConstraintTeacherId] = useState(() => initialActiveEntry?.school?.teachers[0]?.id || "TCH_RYA");
  const [selectedSwapEntry, setSelectedSwapEntry] = useState<TimetableEntry | null>(null);
  const [selectedSwapPairedEntry, setSelectedSwapPairedEntry] = useState<TimetableEntry | null>(null);
  const [selectedMergeCandidate, setSelectedMergeCandidate] = useState<TimetableEntry | null>(null);
  const [userMergedPairs, setUserMergedPairs] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("JADWAL_USER_MERGED_PAIRS");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [userUnmergedPairs, setUserUnmergedPairs] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("JADWAL_USER_UNMERGED_PAIRS");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [pendingDiff, setPendingDiff] = useState<TimetableDiffReport | null>(null);
  const [colorMode, setColorMode] = useState<"subject" | "section">("subject");
  const [cellDensity, setCellDensity] = useState<"compact" | "balanced" | "spacious">("balanced");
  const [masterRowMode, setMasterRowMode] = useState<"teachers" | "sections">("teachers");
  const [timetableSearch, setTimetableSearch] = useState<string>("");
  const [timetableDayFilter, setTimetableDayFilter] = useState<number | null>(null);
  const [isTimetableFullscreen, setIsTimetableFullscreen] = useState<boolean>(false);
  const [timetableZoom, setTimetableZoom] = useState<number>(85); // Default lower zoom (85%)
  const [mergeDoublePeriods, setMergeDoublePeriods] = useState<boolean>(true); // Visually connect double periods as unified block

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTimetableFullscreen) {
        setIsTimetableFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isTimetableFullscreen]);

  const togglePinEntry = (entry: TimetableEntry, paired?: TimetableEntry) => {
    setSchedule((prev) => {
      if (!prev) return prev;
      const idsToToggle = new Set([entry.entry_id]);
      if (paired) idsToToggle.add(paired.entry_id);
      const targetPinned = !entry.is_pinned;
      const nextEntries = prev.entries.map((e) =>
        idsToToggle.has(e.entry_id) ? { ...e, is_pinned: targetPinned } : e
      );
      return { ...prev, entries: nextEntries };
    });
  };

  const [newPlacementDay, setNewPlacementDay] = useState("0");
  const [newPlacementType, setNewPlacementType] = useState<"FIRST_N" | "LAST_N" | "CONTIGUOUS">("LAST_N");
  const [newPlacementCount, setNewPlacementCount] = useState(3);

  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Bring-Your-Own-Key (BYOK) Gemini Key Manager State
  const [showKeyManagerModal, setShowKeyManagerModal] = useState(false);
  const [userKeys, setUserKeys] = useState<UserApiKeyEntry[]>(() => ApiKeyManager.getKeys());
  const [newKeyInput, setNewKeyInput] = useState("");
  const [newKeyAlias, setNewKeyAlias] = useState("");
  const [bulkKeysInput, setBulkKeysInput] = useState("");
  const [keyManagerTab, setKeyManagerTab] = useState<"single" | "bulk">("single");
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [keyManagerNotice, setKeyManagerNotice] = useState<string | null>(null);

  function refreshKeysState() {
    setUserKeys(ApiKeyManager.getKeys());
  }

  function handleAddSingleKey() {
    setKeyManagerNotice(null);
    const res = ApiKeyManager.addKey(newKeyInput, newKeyAlias);
    setUserKeys(res.entries);
    if (res.added && res.entry) {
      setNewKeyInput("");
      setNewKeyAlias("");
      setKeyManagerNotice(`✅ تمت إضافة المفتاح "${res.entry.alias}" (${res.entry.masked}) بنجاح.`);
    } else if (res.reason) {
      setKeyManagerNotice(`⚠️ ${res.reason}`);
    }
  }

  function handleAddBulkKeys() {
    setKeyManagerNotice(null);
    const res = ApiKeyManager.addBulkKeys(bulkKeysInput);
    setUserKeys(res.entries);
    if (res.addedCount > 0) {
      setBulkKeysInput("");
      setKeyManagerNotice(
        `✅ تمت إضافة ${res.addedCount} مفتاح بنجاح${res.skippedCount > 0 ? ` (وتخطي ${res.skippedCount} مكرر/غير صالح)` : ""}.`
      );
    } else {
      setKeyManagerNotice("⚠️ لم يتم العثور على مفاتيح جديدة صالحة للإضافة (سطر لكل مفتاح).");
    }
  }

  function handleToggleUserKey(id: string) {
    const updated = ApiKeyManager.toggleKey(id);
    setUserKeys(updated);
  }

  function handleRemoveUserKey(id: string) {
    const updated = ApiKeyManager.removeKey(id);
    setUserKeys(updated);
    setKeyManagerNotice("🗑️ تم حذف المفتاح من المتصفح.");
  }

  async function handleTestUserKey(id: string) {
    setTestingKeyId(id);
    setKeyManagerNotice(null);
    try {
      const res = await ApiKeyManager.testKeyById(id);
      refreshKeysState();
      setKeyManagerNotice(res.ok ? `✅ ${res.message}` : `⚠️ ${res.message}`);
    } catch (e: unknown) {
      const safe = sanitizeSecretText(e, ApiKeyManager.getKeys().map((k) => k.key));
      setKeyManagerNotice(`⚠️ تعذر اختبار المفتاح: ${safe}`);
    } finally {
      setTestingKeyId(null);
    }
  }

  const persistSchoolData = (
    targetSchool: SchoolData,
    newRawText?: string,
    newSchedule?: Schedule | null,
    newAnalysis?: AnalysisReport | null
  ) => {
    const nowStr = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    setLastUpdatedTime(nowStr);
    setSavedSchools((prev) => {
      const idx = prev.findIndex((s) => s.id === targetSchool.id);
      const entry: SavedSchoolEntry = {
        id: targetSchool.id,
        name: targetSchool.name,
        school: targetSchool,
        raw_text: newRawText !== undefined ? newRawText : (rawText || ""),
        schedule: newSchedule !== undefined ? newSchedule : schedule,
        analysis: newAnalysis !== undefined ? newAnalysis : analysis,
      };
      let updated: SavedSchoolEntry[];
      if (idx >= 0) {
        updated = [...prev];
        updated[idx] = entry;
      } else {
        updated = [entry, ...prev];
      }
      try {
        localStorage.setItem("AI_STUDIO_SAVED_SCHOOLS_V2", JSON.stringify(updated));
        localStorage.setItem("AI_STUDIO_ACTIVE_SCHOOL_ID", targetSchool.id);
      } catch (e) {
        console.error("Failed to save to localStorage:", e);
      }
      return updated;
    });
  };

  function handleSaveCurrentSchool() {
    if (!school) return;
    persistSchoolData(school, rawText, schedule, analysis);
    setStatusMessage(`تم حفظ بيانات مدرسة "${school.name}" والجدول المحدث بنجاح في ذاكرة المتصفح.`);
  }

  const backupFileInputRef = useRef<HTMLInputElement>(null);

  function handleExportBackupJson() {
    setErrorMessage(null);
    const listToExport =
      school && !savedSchools.some((s) => s.id === school.id)
        ? [
          {
            id: school.id,
            name: school.name,
            school,
            raw_text: rawText,
            schedule,
            analysis,
          },
          ...savedSchools,
        ]
        : savedSchools.map((s) =>
          school && s.id === school.id
            ? { ...s, school, raw_text: rawText, schedule, analysis }
            : s
        );

    InBrowserSchoolEngine.exportUserBackupJson({
      savedSchools: listToExport,
      activeSchoolId: selectedPreset || school?.id || "",
      chatHistory: chatHistory.map((h) => ({
        role: h.role,
        text: h.text,
        changes: h.changes,
        timestamp: h.timestamp,
      })),
    });
    setStatusMessage(
      `📦 تم تصدير النسخة الاحتياطية بنجاح (${listToExport.length} مدارس — بدون مفاتيح API لحماية خصوصيتك).`
    );
  }

  function handleImportBackupJsonFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const imported = InBrowserSchoolEngine.importUserBackupJson(text);
        if (!imported.valid || imported.savedSchools.length === 0) {
          setErrorMessage(
            `فشل استيراد النسخة الاحتياطية: ${imported.errors.join(" — ") || "ملف غير صالح"}`
          );
          return;
        }

        // Merge imported schools with existing schools (updating matching IDs)
        const importedIds = new Set(imported.savedSchools.map((s) => s.id));
        const merged = [
          ...imported.savedSchools,
          ...savedSchools.filter((s) => !importedIds.has(s.id)),
        ];

        setSavedSchools(merged);
        localStorage.setItem("AI_STUDIO_SAVED_SCHOOLS_V2", JSON.stringify(merged));

        const targetEntry =
          merged.find((s) => s.id === imported.activeSchoolId) || imported.savedSchools[0];
        if (targetEntry) {
          setSelectedPreset(targetEntry.id);
          localStorage.setItem("AI_STUDIO_ACTIVE_SCHOOL_ID", targetEntry.id);
          setSchool(targetEntry.school);
          setRawText(targetEntry.raw_text || "");
          const ana = targetEntry.analysis || InBrowserSchoolEngine.analyzeSchool(targetEntry.school);
          setAnalysis(ana);
          const sched =
            targetEntry.schedule || InBrowserSchoolEngine.solveInBrowser(targetEntry.school).schedule;
          setSchedule(sched);
          if (targetEntry.school.sections.length > 0) {
            setSelectedSectionId(targetEntry.school.sections[0].id);
          }
          if (targetEntry.school.teachers.length > 0) {
            setSelectedTeacherId(targetEntry.school.teachers[0].id);
            setSelectedConstraintTeacherId(targetEntry.school.teachers[0].id);
          }
        }

        if (imported.chatHistory.length > 0) {
          setChatHistory(imported.chatHistory);
        }

        setStatusMessage(
          `📥 تم استيراد واستعادة ${imported.savedSchools.length} مدرسة بنجاح والتحقق من سلامة بياناتها.`
        );
      } catch (err: any) {
        setErrorMessage(`خطأ أثناء قراءة ملف النسخة الاحتياطية: ${err?.message || String(err)}`);
      } finally {
        if (backupFileInputRef.current) backupFileInputRef.current.value = "";
      }
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleForceRefreshSchedule() {
    if (!school) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const solved = await service.solveSchedule(school, 20);
      setSchool(solved.school);
      setSchedule(solved.schedule);
      setValidation(solved.validation);
      setMetrics(solved.metrics);
      if (solved.analysis) setAnalysis(solved.analysis);
      persistSchoolData(solved.school, rawText, solved.schedule, solved.analysis);
      setStatusMessage(`تم تحديث شاشة الجدول بنجاح (مؤشر الجودة: ${solved.schedule.quality_score.toFixed(1)}% وبدون أي تعارض).`);
    } catch (e: any) {
      setErrorMessage(e.message || "تعذر تحديث الجدول");
    } finally {
      setLoading(false);
    }
  }

  const [chatInput, setChatInput] = useState("");
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);
  const [chatLoadingStep, setChatLoadingStep] = useState<1 | 2 | 3>(1);
  const [chatHistory, setChatHistory] = useState<ChatMessageRecord[]>(() =>
    Array.isArray(initialActiveEntry?.chat_history) && initialActiveEntry.chat_history.length > 0
      ? initialActiveEntry.chat_history
      : [DEFAULT_CHAT_WELCOME_MESSAGE]
  );
  const [undoStack, setUndoStack] = useState<SchoolUndoSnapshot[]>(() =>
    Array.isArray(initialActiveEntry?.undo_stack) ? initialActiveEntry.undo_stack : []
  );

  // Persist active school chatHistory & undoStack automatically across refreshes
  useEffect(() => {
    if (!school?.id) return;
    setSavedSchools((prev) => {
      const idx = prev.findIndex((s) => s.id === school.id);
      if (idx < 0) return prev;
      const nextEntry = {
        ...prev[idx],
        chat_history: chatHistory.slice(-60),
        undo_stack: undoStack.slice(-15),
      };
      const updated = [...prev];
      updated[idx] = nextEntry;
      try {
        localStorage.setItem("AI_STUDIO_SAVED_SCHOOLS_V2", JSON.stringify(updated));
      } catch {
        // If quota exceeded, keep chat_history while trimming older undo snapshots
        try {
          const compact = updated.map((e) => ({ ...e, undo_stack: (e.undo_stack || []).slice(-3) }));
          localStorage.setItem("AI_STUDIO_SAVED_SCHOOLS_V2", JSON.stringify(compact));
        } catch {}
      }
      return updated;
    });
  }, [chatHistory, undoStack, school?.id]);


  // RTL Layout: Collapsible & Resizable Right Chat Sidebar & Mobile Bottom Sheet
  const [chatWidth, setChatWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("AI_STUDIO_CHAT_WIDTH");
      return saved ? Math.max(280, Math.min(650, Number(saved))) : 390;
    } catch {
      return 390;
    }
  });
  const [isChatCollapsed, setIsChatCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("AI_STUDIO_CHAT_COLLAPSED") === "true";
    } catch {
      return false;
    }
  });
  // 3-Stage Floating Chat Bot: circle -> input_bar -> full_sheet
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const [mobileHeaderMenuOpen, setMobileHeaderMenuOpen] = useState(false);
  const [showMobileTableFilters, setShowMobileTableFilters] = useState(false);
  const chatBarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isMobileSheetOpen) {
      const timer = setTimeout(() => {
        chatBarInputRef.current?.focus();
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [isMobileSheetOpen]);

  const isResizingRef = useRef(false);

  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = chatWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      // In RTL, dragging the mouse towards the left expands the right sidebar
      const delta = startX - moveEvent.clientX;
      const nextW = Math.max(280, Math.min(650, startWidth + delta));
      setChatWidth(nextW);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      try {
        localStorage.setItem("AI_STUDIO_CHAT_WIDTH", String(chatWidth));
      } catch { }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const toggleChatCollapse = () => {
    setIsChatCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("AI_STUDIO_CHAT_COLLAPSED", String(next));
      } catch { }
      return next;
    });
  };

  useEffect(() => {
    service.setConfig(backendUrl);
    service.setKeyNoticeHandler((notice) => {
      setKeyManagerNotice(notice);
      setStatusMessage(notice);
      refreshKeysState();
    });
    if (backendUrl) localStorage.setItem("SCHEDULER_BACKEND_URL", backendUrl);
  }, [backendUrl, service]);

  useEffect(() => {
    if (chatHistory.length > 1) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [chatHistory, loading]);

  useEffect(() => {
    async function init() {
      const health = await service.checkBackendHealth();
      setServerOnline(health.online);
      if (health.online) {
        const list = await service.listPresets();
        setPresets(list);
      }
    }
    init();
  }, [backendUrl]);

  async function handleLoadPreset(presetId: string) {
    setLoading(true);
    setErrorMessage(null);
    try {
      setTimetableDayFilter(null);
      setSelectedPreset(presetId);
      localStorage.setItem("AI_STUDIO_ACTIVE_SCHOOL_ID", presetId);
      const nowStr = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
      setLastUpdatedTime(nowStr);
      const localFound = savedSchools.find((s) => s.id === presetId);
      if (localFound) {
        setSchool(localFound.school);
        setChatHistory(
          Array.isArray(localFound.chat_history) && localFound.chat_history.length > 0
            ? localFound.chat_history
            : [DEFAULT_CHAT_WELCOME_MESSAGE]
        );
        setUndoStack(Array.isArray(localFound.undo_stack) ? localFound.undo_stack : []);
        setRawText(localFound.raw_text || "");
        const ana = localFound.analysis || InBrowserSchoolEngine.analyzeSchool(localFound.school);
        setAnalysis(ana);
        const sched = localFound.schedule || InBrowserSchoolEngine.solveInBrowser(localFound.school).schedule;
        setSchedule(sched);
        if (localFound.school.sections.length > 0) setSelectedSectionId(localFound.school.sections[0].id);
        if (localFound.school.teachers.length > 0) {
          setSelectedTeacherId(localFound.school.teachers[0].id);
          setSelectedConstraintTeacherId(localFound.school.teachers[0].id);
        }
        setStatusMessage(`تم تحميل بيانات "${localFound.name}" بنجاح.`);
        return;
      }

      const data = await service.loadPreset(presetId);
      setSchool(data.school);
      setChatHistory([DEFAULT_CHAT_WELCOME_MESSAGE]);
      setUndoStack([]);
      setRawText(data.raw_text || "");
      setAnalysis(data.analysis);
      const solved = InBrowserSchoolEngine.solveInBrowser(data.school);
      setSchedule(solved.schedule);
      setValidation(solved.validation);
      setMetrics(solved.metrics);
      if (data.school.sections.length > 0) setSelectedSectionId(data.school.sections[0].id);
      if (data.school.teachers.length > 0) {
        setSelectedTeacherId(data.school.teachers[0].id);
        setSelectedConstraintTeacherId(data.school.teachers[0].id);
      }
      setStatusMessage(`تم تحميل بيانات "${data.school.name}" بنجاح.`);
    } catch (e: any) {
      setErrorMessage(e.message || "حدث خطأ أثناء تحميل المدرسة");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateNewSchool() {
    const selectedPresetObj = getPresetById(newSchoolPresetId);
    const defaultName =
      newSchoolType === "preset" && selectedPresetObj
        ? selectedPresetObj.label
        : newSchoolType === "secondary"
          ? "مدرسة ثانوية جديدة"
          : newSchoolType === "prep"
            ? "مدرسة إعدادية جديدة"
            : "مدرسة جديدة";
    const name = newSchoolName.trim() || defaultName;

    setLoading(true);
    setErrorMessage(null);
    try {
      let createdSchool: SchoolData;
      let createdRawText: string;
      let createdEngineSource: EngineResponseMeta | undefined;
      let createdNotes: string[] = [];

      if (newSchoolType === "preset" && selectedPresetObj) {
        createdSchool = createSchoolFromPreset(selectedPresetObj.id, {
          schoolName: name,
          sectionsPerGrade: 1,
        });
        createdRawText = generateSchoolMarkdown(createdSchool);
      } else if (newSchoolType === "ai" && newSchoolAiPrompt.trim()) {
        setStatusMessage("جاري تحليل النص واستخراج بيانات المدرسة بالذكاء الاصطناعي...");
        const aiRes = await service.parseRawText(newSchoolAiPrompt, { preferAi: true });
        createdEngineSource = aiRes.engine_source;
        createdNotes = aiRes.normalization_notes || [];
        const explicitName = newSchoolName.trim();
        const extractedName = aiRes.school?.name && aiRes.school.name !== "مدرسة جديدة" ? aiRes.school.name : "";
        createdSchool = {
          ...aiRes.school,
          id: "sch_" + Date.now().toString(36),
          name: explicitName || extractedName || "مدرسة جديدة",
        };
        createdRawText =
          createdSchool.assignments && createdSchool.assignments.length > 0
            ? generateSchoolMarkdown(createdSchool)
            : newSchoolAiPrompt;
      } else if (newSchoolType === "blank") {
        const res = createBlankSchoolTemplate(name, newSchoolPeriods);
        createdSchool = res.school;
        createdRawText = res.raw_text;
      } else if (newSchoolType === "prep") {
        const basePrep = getBuiltInSchool376();
        createdSchool = { ...basePrep, id: "sch_" + Date.now().toString(36), name };
        createdRawText = NESSCHINFO_RAW_TEXT.replace(basePrep.name, name);
      } else {
        // Default to first preset
        createdSchool = createSchoolFromPreset(ALL_SCHOOL_PRESETS[0].id, {
          schoolName: name,
          sectionsPerGrade: 1,
        });
        createdRawText = generateSchoolMarkdown(createdSchool);
      }

      const newAnalysis = InBrowserSchoolEngine.analyzeSchool(createdSchool);
      const newEntry: SavedSchoolEntry = {
        id: createdSchool.id,
        name: createdSchool.name,
        school: createdSchool,
        raw_text: createdRawText,
        analysis: newAnalysis,
        schedule: null,
      };

      const updatedSaved = [...savedSchools.filter((s) => s.id !== createdSchool.id), newEntry];
      setSavedSchools(updatedSaved);
      localStorage.setItem("AI_STUDIO_SAVED_SCHOOLS_V2", JSON.stringify(updatedSaved));

      setTimetableDayFilter(null);
      setSelectedPreset(createdSchool.id);
      setSchool(createdSchool);
      setRawText(createdRawText);
      setAnalysis(newAnalysis);
      setSchedule(null);
      if (createdSchool.sections.length > 0) setSelectedSectionId(createdSchool.sections[0].id);
      if (createdSchool.teachers.length > 0) {
        setSelectedTeacherId(createdSchool.teachers[0].id);
        setSelectedConstraintTeacherId(createdSchool.teachers[0].id);
      }

      setShowAddSchoolModal(false);
      setNewSchoolName("");
      setNewSchoolAiPrompt("");
      const isGeminiCreated = createdEngineSource?.source === "gemini_api";
      const totalWeeklyCreated = createdSchool.assignments.reduce((s, a) => s + (a.weekly_periods || 0), 0);
      const createdShiftSummary =
        createdSchool.shift_mode === "TWO_SHIFTS"
          ? " — نظام فترتين (صباحي + مسائي)"
          : "";
      const fallbackHint =
        newSchoolType === "ai" && !isGeminiCreated && createdEngineSource?.failure?.reason_ar
          ? ` ⚠️ ملاحظة: ${createdEngineSource.failure.reason_ar} (تم البناء بالمحرك المحلي).`
          : "";

      setStatusMessage(
        isGeminiCreated
          ? `✨ تم تحليل وبناء "${createdSchool.name}" عبر Gemini بنجاح (${createdSchool.sections.length} فصول، ${createdSchool.teachers.length} معلماً، ${totalWeeklyCreated} حصة${createdShiftSummary})!`
          : `تم إنشاء "${createdSchool.name}" بنجاح (${createdSchool.sections.length} فصول، ${createdSchool.teachers.length} معلماً، ${totalWeeklyCreated} حصة${createdShiftSummary})!${fallbackHint}`
      );
      setActiveTab(createdSchool.assignments.length > 0 ? "constraints" : "wizard");

      setUndoStack([]);
      setChatHistory([
        DEFAULT_CHAT_WELCOME_MESSAGE,
        {
          role: "ai",
          text: isGeminiCreated
            ? `تم فهم وتحليل وبناء "${createdSchool.name}" عبر Gemini AI بنجاح (${createdSchool.sections.length} فصول، ${createdSchool.teachers.length} معلماً، ${totalWeeklyCreated} حصة${createdShiftSummary}). تم وضع كافة الفترات والأنصبة والإجازات في أماكنها؛ اطلب أي تعديل أو اضغط (إنشاء الجدول الآن).`
            : `تم إنشاء المدرسة "${createdSchool.name}" (${createdSchool.sections.length} فصول، ${createdSchool.teachers.length} معلماً، ${totalWeeklyCreated} حصة${createdShiftSummary}).${fallbackHint ? `\n${fallbackHint}` : ""} اطلب مني أي تعديل أو اضغط على (إنشاء الجدول الآن).`,
          changes: createdNotes.length > 0 ? createdNotes : undefined,
          engineMeta: createdEngineSource,
        },
      ]);
    } catch (e: any) {
      setErrorMessage("فشل إنشاء المدرسة: " + (e.message || String(e)));
    } finally {
      setLoading(false);
    }
  }

  function handleDeleteSchool(id: string) {
    const schoolToDelete = savedSchools.find((s) => s.id === id);
    const schoolName = schoolToDelete?.name || "المدرسة";
    const confirmed = window.confirm(`هل أنت متأكد من حذف "${schoolName}"؟ لا يمكن التراجع عن هذا الإجراء.`);
    if (!confirmed) return;

    const updated = savedSchools.filter((s) => s.id !== id);
    setSavedSchools(updated);
    localStorage.setItem("AI_STUDIO_SAVED_SCHOOLS_V2", JSON.stringify(updated));

    if (selectedPreset === id) {
      if (updated.length > 0) {
        handleLoadPreset(updated[0].id);
      } else {
        setSelectedPreset("");
        localStorage.removeItem("AI_STUDIO_ACTIVE_SCHOOL_ID");
        setSchool(null);
        setRawText("");
        setSchedule(null);
        setAnalysis(null);
        setValidation(null);
        setMetrics(null);
      }
    }
    setStatusMessage(`تم حذف "${schoolName}" بنجاح.`);
  }

  function handleDuplicateSchool() {
    if (!school) return;
    const copyId = "sch_copy_" + Date.now().toString(36);
    const copyName = `${school.name} (نسخة)`;
    const copySchool: SchoolData = {
      ...JSON.parse(JSON.stringify(school)),
      id: copyId,
      name: copyName,
    };
    const copyRawText = rawText ? rawText.replace(school.name, copyName) : "";
    const copyAnalysis = InBrowserSchoolEngine.analyzeSchool(copySchool);
    const newEntry: SavedSchoolEntry = {
      id: copyId,
      name: copyName,
      school: copySchool,
      raw_text: copyRawText,
      analysis: copyAnalysis,
      schedule: null,
    };
    const nextList = [...savedSchools, newEntry];
    setSavedSchools(nextList);
    localStorage.setItem("AI_STUDIO_SAVED_SCHOOLS_V2", JSON.stringify(nextList));
    setSelectedPreset(copyId);
    setSchool(copySchool);
    setRawText(copyRawText);
    setAnalysis(copyAnalysis);
    setSchedule(null);
    setUndoStack([]);
    setChatHistory([DEFAULT_CHAT_WELCOME_MESSAGE]);
    setStatusMessage(`تم نسخ المدرسة بنجاح تحت اسم "${copyName}".`);
  }

  async function handleParseRawText() {
    if (!rawText.trim()) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await service.parseRawText(rawText);
      setSchool(res.school);
      setAnalysis(res.analysis);
      setNormNotes(res.normalization_notes || []);
      setUnparsedNotes((res as any).unparsed_notes || (res.school?.metadata as any)?.unparsed_notes || []);
      setSchedule(null);
      if (res.school.sections.length > 0) setSelectedSectionId(res.school.sections[0].id);
      if (res.school.teachers.length > 0) {
        setSelectedTeacherId(res.school.teachers[0].id);
        setSelectedConstraintTeacherId(res.school.teachers[0].id);
      }
      setStatusMessage(res.explanation);
      setActiveTab("wizard");
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSolve(schoolToSolve?: SchoolData | unknown) {
    const targetSchool =
      schoolToSolve && typeof schoolToSolve === "object" && "sections" in schoolToSolve
        ? (schoolToSolve as SchoolData)
        : school;
    if (!targetSchool) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await service.solveSchedule(targetSchool, 20);
      setSchool(res.school);
      setSchedule(res.schedule);
      setValidation(res.validation);
      setMetrics(res.metrics);
      setAnalysis(res.analysis);
      setNormNotes(res.normalization_notes || []);
      const md = generateSchoolMarkdown(res.school);
      setRawText(md);
      persistSchoolData(res.school, md, res.schedule, res.analysis);
      setActiveTab("timetable");
      setStatusMessage(
        `تم إنشاء الجدول بنجاح في ${res.schedule.solve_time_seconds.toFixed(2)} ثانية! (مؤشر الجودة: ${res.schedule.quality_score.toFixed(1)}%)`
      );
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendChat(customPrompt?: string, chatOpts?: { forceLocalFallback?: boolean }) {
    const msg = (customPrompt ?? chatInput).trim();
    if (!msg) return;
    if (!customPrompt) setChatInput("");
    if (typeof window !== "undefined" && window.innerWidth < 1024) setIsMobileSheetOpen(true);
    const activeSchool = school || createBlankSchoolTemplate("مدرسة جديدة", 7).school;
    const activeRawText = rawText || createBlankSchoolTemplate("مدرسة جديدة", 7).raw_text;
    const nowTime = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    setChatHistory((prev) => [...prev, { role: "user", text: msg, timestamp: nowTime }]);

    // Real Snapshot Undo: handles "تراجع" / "الغي اخر تعديل" / "ارجع زي الاول" / "undo"
    const isExactUndoReq = /^(?:تراجع(?:\s+عن\s+(?:اخر|آخر)\s*(?:تعديل|طلب|خطوة))?|الغي\s+(?:اخر|آخر)\s*(?:تعديل|طلب)|ارجع\s+(?:خطوة|زي\s+الاول|للخلف)|undo)$/i.test(
      msg.replace(/[؟?!.،]/g, "").trim()
    );
    if (isExactUndoReq && undoStack.length > 0) {
      const lastSnap = undoStack[undoStack.length - 1];
      setUndoStack((prev) => prev.slice(0, -1));
      setSchool(lastSnap.school);
      const restoredMd = generateSchoolMarkdown(lastSnap.school);
      setRawText(restoredMd);
      const restoredAna = InBrowserSchoolEngine.analyzeSchool(lastSnap.school);
      setAnalysis(restoredAna);
      const restoredSchedule = lastSnap.schedule || InBrowserSchoolEngine.solveInBrowser(lastSnap.school).schedule;
      setSchedule(restoredSchedule);
      setPendingDiff(null);
      persistSchoolData(lastSnap.school, restoredMd, restoredSchedule, restoredAna);
      const undoReply = `↩️ تم التراجع الفوري بنجاح واستعادة الحالة السابقة قبل: (${lastSnap.label}).`;
      setChatHistory((prev) => [
        ...prev,
        {
          role: "ai",
          text: undoReply,
          changes: [`التراجع عن: ${lastSnap.label}`],
          timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      setStatusMessage(undoReply);
      return;
    }

    setIsChatSubmitting(true);
    setChatLoadingStep(1);
    setLoading(true);
    try {
      const res = await service.chatWithCopilot(msg, activeSchool, schedule, activeRawText, chatHistory, {
        requireGeminiFirst: !chatOpts?.forceLocalFallback,
        forceLocalFallback: Boolean(chatOpts?.forceLocalFallback),
      });
      setChatLoadingStep(2);

      const mutatedSchool = Boolean(res.updated_school && res.applied_changes && res.applied_changes.length > 0);
      const mutatedSchedule = Boolean((res as any).updated_schedule);
      if (mutatedSchool || mutatedSchedule) {
        setUndoStack((prev) => [
          ...prev.slice(-14),
          {
            school: activeSchool,
            schedule: schedule || null,
            label: res.applied_changes?.[0] || msg.slice(0, 60),
            timestamp: nowTime,
          },
        ]);
      }

      if (res.updated_markdown) setRawText(res.updated_markdown);
      const targetSchool = res.updated_school || activeSchool;
      if (res.updated_school) {
        setSchool(res.updated_school);
        if (school && res.updated_school.id !== school.id) {
          const newEntry: SavedSchoolEntry = {
            id: res.updated_school.id,
            name: res.updated_school.name,
            school: res.updated_school,
            raw_text: res.updated_markdown || rawText,
            analysis: res.analysis || null,
            schedule: null,
          };
          setSavedSchools((prev) => {
            const upd = [...prev.filter((s) => s.id !== res.updated_school!.id), newEntry];
            localStorage.setItem("AI_STUDIO_SAVED_SCHOOLS_V2", JSON.stringify(upd));
            return upd;
          });
          setSelectedPreset(res.updated_school.id);
        }
      }
      if (res.analysis) setAnalysis(res.analysis);
      if ((res as any).updated_schedule) {
        const nextSched = (res as any).updated_schedule as Schedule;
        setSchedule(nextSched);
        setLastUpdatedTime(new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }));
        persistSchoolData(targetSchool, res.updated_markdown || rawText, nextSched, res.analysis || analysis);
      }
      // Trigger direct UI / Export / View actions requested in chat
      const uiAct = (res as any).ui_action as AgentUiActionType | undefined;
      const uiTarget = (res as any).ui_target_id as string | undefined;
      if (uiAct) {
        if (uiAct === "export_excel" && schedule) service.downloadExport("excel", targetSchool, schedule, "all").catch((e) => setErrorMessage(e.message));
        else if (uiAct === "export_pdf_all" && schedule) service.downloadExport("pdf", targetSchool, schedule, "all").catch((e) => setErrorMessage(e.message));
        else if (uiAct === "export_pdf_master" && schedule) service.downloadExport("pdf", targetSchool, schedule, "master").catch((e) => setErrorMessage(e.message));
        else if (uiAct === "export_pdf_sections" && schedule) service.downloadExport("pdf", targetSchool, schedule, "sections").catch((e) => setErrorMessage(e.message));
        else if (uiAct === "export_pdf_teachers" && schedule) service.downloadExport("pdf", targetSchool, schedule, "teachers").catch((e) => setErrorMessage(e.message));
        else if (uiAct === "view_master") { setActiveTab("timetable"); setViewMode("master"); }
        else if (uiAct === "view_section" && uiTarget) { setActiveTab("timetable"); setViewMode("section"); setSelectedSectionId(uiTarget); }
        else if (uiAct === "view_teacher" && uiTarget) { setActiveTab("timetable"); setViewMode("teacher"); setSelectedTeacherId(uiTarget); }
      }
      const engineMeta = (res as any).engine_source;
      const needsChoice = Boolean((res as any).needs_api_or_local_choice);
      setChatHistory((prev) => [
        ...prev,
        {
          role: "ai",
          text: res.reply,
          changes: res.applied_changes,
          engineMeta,
          pendingLocalPrompt: needsChoice ? msg : undefined,
          timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      if (res.should_solve && targetSchool && !(res as any).updated_schedule) {
        setChatLoadingStep(3);
        const isExplicitRefresh =
          (res as any).ui_action === "trigger_solve" ||
          /^(?:من فضلك\s+|لو سمحت\s+|ممكن\s+)?(?:حدث|تحديث|اعمل تحديث|اعد تحديث|جدد|ابني|إعادة بناء|حل|وزع|سو جدول)\s*(?:ل)?(?:ال)?جدول/.test(msg.trim());
        const structureChanged =
          targetSchool.periods_per_day !== activeSchool.periods_per_day ||
          targetSchool.sections.length !== activeSchool.sections.length ||
          JSON.stringify(targetSchool.days) !== JSON.stringify(activeSchool.days) ||
          JSON.stringify(targetSchool.sections.map((s) => s.daily_period_limits || null)) !==
            JSON.stringify(activeSchool.sections.map((s) => s.daily_period_limits || null));
        if (!schedule || isExplicitRefresh || structureChanged) {
          const solved = InBrowserSchoolEngine.solveInBrowser(targetSchool);
          setSchedule(solved.schedule);
          setValidation(solved.validation);
          setMetrics(solved.metrics);
          setPendingDiff(null);
          setLastUpdatedTime(new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }));
          persistSchoolData(targetSchool, res.updated_markdown || rawText, solved.schedule, res.analysis || analysis);
          setActiveTab("timetable");
          setStatusMessage(`تم تحديث وبناء الجدول بنجاح (${solved.schedule.entries.length} حصة · 0% تعارضات)!`);
        } else {
          const diffReport = dryRunMinimalChange(activeSchool, schedule, targetSchool);
          if (diffReport.has_changes) {
            setPendingDiff(diffReport);
            setActiveTab("timetable");
            setStatusMessage(
              `تم احتساب التعديلات بأقل تغيير بنجاح! تم الحفاظ على ${diffReport.unchanged_count} حصة ثابتة، و ${diffReport.total_changes} حصة معدلة معروضة للمعاينة.`
            );
          } else {
            // Existing schedule already satisfies the new constraint/edit — keep it intact!
            setPendingDiff(null);
            persistSchoolData(targetSchool, res.updated_markdown || rawText, schedule, res.analysis || analysis);
            setStatusMessage("✓ تم تنفيذ التعديل وحفظه؛ الجدول الحالي متوافق بالفعل دون حاجة لإعادة بناء.");
          }
        }
      } else if (targetSchool && !(res as any).updated_schedule) {
        persistSchoolData(targetSchool, res.updated_markdown || rawText, schedule, res.analysis || analysis);
      }
    } catch (e: any) {
      setChatHistory((prev) => [
        ...prev,
        {
          role: "ai",
          text: `⚠️ تعذر إكمال طلبك: ${e.message}`,
          isError: true,
          retryPrompt: msg,
          timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setIsChatSubmitting(false);
      setLoading(false);
      setChatLoadingStep(1);
    }
  }


  function toggleTeacherDayOff(teacherId: string, day: number) {
    if (!school) return;
    const updatedTeachers = school.teachers.map((t) => {
      if (t.id !== teacherId) return t;
      const wp = t.work_pattern || { day_rules: {}, daily_period_rules: [], placement_rules: [] };
      const current = wp.day_rules?.[String(day)] || "ALLOWED";
      const next: "ALLOWED" | "MANDATORY_OFF" = current === "MANDATORY_OFF" ? "ALLOWED" : "MANDATORY_OFF";
      return {
        ...t,
        work_pattern: {
          ...wp,
          day_rules: { ...(wp.day_rules || {}), [String(day)]: next },
        },
      };
    });
    setSchool({ ...school, teachers: updatedTeachers });
  }

  function handleUpdateSchoolFromHub(updatedSchool: SchoolData, summaryMessage?: string) {
    setSchool(updatedSchool);
    const md = generateSchoolMarkdown(updatedSchool);
    setRawText(md);
    const ana = InBrowserSchoolEngine.analyzeSchool(updatedSchool);
    setAnalysis(ana);
    persistSchoolData(updatedSchool, md, schedule, ana);
    if (summaryMessage) setStatusMessage(summaryMessage);
  }

  function addPlacementRule() {
    if (!school || !selectedConstraintTeacherId) return;
    const updated = school.teachers.map((t) => {
      if (t.id !== selectedConstraintTeacherId) return t;
      const wp = t.work_pattern || { day_rules: {}, daily_period_rules: [], placement_rules: [] };
      return {
        ...t,
        work_pattern: {
          ...wp,
          placement_rules: [
            ...(wp.placement_rules || []),
            {
              day: newPlacementDay === "ALL" ? null : Number(newPlacementDay),
              placement_type: newPlacementType,
              n_periods: Number(newPlacementCount),
              exact_periods: [],
              is_hard: false,
              weight: 10,
            },
          ],
        },
      };
    });
    setSchool({ ...school, teachers: updated });
  }

  function getTeacherName(id: string) {
    return school?.teachers.find((t) => t.id === id)?.name || id;
  }
  function getSubjectName(id: string) {
    return school?.subjects.find((s) => s.id === id)?.name || id;
  }
  function getSectionName(id: string) {
    return school?.sections.find((s) => s.id === id)?.name || id;
  }
  function getSectionCodeOnly(sectionIdOrName: string): string {
    if (!sectionIdOrName) return "";
    const sec = school?.sections.find(
      (s) => s.id === sectionIdOrName || s.name === sectionIdOrName || s.code === sectionIdOrName
    );
    if (sec?.code && /^\d+[\/\\]\d+$/.test(sec.code.trim())) {
      return sec.code.trim();
    }
    const raw = sec ? (sec.code || sec.name) : sectionIdOrName;
    const m = raw.match(/\d+[\/\\]\d+/);
    if (m) return m[0];
    const cleaned = raw
      .replace(/الصف\s*(?:الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|\d+)(?:\s+(?:الثانوي|الإعدادي|الابتدائي))?/g, "")
      .replace(/^فصل\s*/g, "")
      .trim();
    return cleaned || raw;
  }
  const formatSection = (nameOrId: string) => (
    <span dir="ltr" className="inline-block font-extrabold tabular-nums">
      {getSectionCodeOnly(nameOrId)}
    </span>
  );
  function getSectionPalette(sectionId: string): CellPalette {
    if (!school) return adaptCellPalette(RICH_PALETTES[0], theme === "dark");
    const idx = school.sections.findIndex((s) => s.id === sectionId);
    return adaptCellPalette(RICH_PALETTES[(idx >= 0 ? idx : 0) % RICH_PALETTES.length], theme === "dark");
  }

  function getCellPalette(entry: TimetableEntry): CellPalette {
    if (colorMode === "subject") {
      return adaptCellPalette(getSubjectPalette(getSubjectName(entry.subject_id)), theme === "dark");
    }
    return getSectionPalette(entry.section_id);
  }

  function checkCanMerge(entryA: TimetableEntry, entryB: TimetableEntry): boolean {
    return (
      entryA.teacher_id === entryB.teacher_id &&
      entryA.section_id === entryB.section_id &&
      entryA.day === entryB.day &&
      Math.abs(entryA.period - entryB.period) === 1
    );
  }

  function getPairCoordKey(day: number, p1: number, p2: number, teacherId: string, sectionId: string): string {
    const minP = Math.min(p1, p2);
    const maxP = Math.max(p1, p2);
    return `${teacherId}_${sectionId}_${day}_${minP}_${maxP}`;
  }

  function getPairKeys(a: TimetableEntry, b: TimetableEntry): [string, string] {
    const coordKey = getPairCoordKey(a.day, a.period, b.period, a.teacher_id, a.section_id);
    const idKey = [a.entry_id, b.entry_id].sort().join("__");
    return [coordKey, idKey];
  }

  function shouldMergePair(a: TimetableEntry, b: TimetableEntry): boolean {
    if (!checkCanMerge(a, b)) return false;
    const [coordKey, idKey] = getPairKeys(a, b);
    if (userUnmergedPairs.has(coordKey) || userUnmergedPairs.has(idKey)) return false;
    if (userMergedPairs.has(coordKey) || userMergedPairs.has(idKey)) return true;
    if (mergeDoublePeriods && a.subject_id === b.subject_id) return true;
    return false;
  }

  function handleMergePair(entryA: TimetableEntry, entryB: TimetableEntry) {
    const [coordKey, idKey] = getPairKeys(entryA, entryB);
    setUserMergedPairs((prev) => {
      const next = new Set(prev);
      next.add(coordKey);
      next.add(idKey);
      try {
        localStorage.setItem("JADWAL_USER_MERGED_PAIRS", JSON.stringify([...next]));
      } catch {}
      return next;
    });
    setUserUnmergedPairs((prev) => {
      const next = new Set(prev);
      next.delete(coordKey);
      next.delete(idKey);
      try {
        localStorage.setItem("JADWAL_USER_UNMERGED_PAIRS", JSON.stringify([...next]));
      } catch {}
      return next;
    });
    setSelectedSwapEntry(null);
    setSelectedSwapPairedEntry(null);
    setSelectedMergeCandidate(null);
    setStatusMessage("✓ تم دمج الحصتين في كارد واحد بنجاح.");
  }

  function handleSplitPair(entryA: TimetableEntry, entryB: TimetableEntry) {
    const [coordKey, idKey] = getPairKeys(entryA, entryB);
    setUserUnmergedPairs((prev) => {
      const next = new Set(prev);
      next.add(coordKey);
      next.add(idKey);
      try {
        localStorage.setItem("JADWAL_USER_UNMERGED_PAIRS", JSON.stringify([...next]));
      } catch {}
      return next;
    });
    setUserMergedPairs((prev) => {
      const next = new Set(prev);
      next.delete(coordKey);
      next.delete(idKey);
      try {
        localStorage.setItem("JADWAL_USER_MERGED_PAIRS", JSON.stringify([...next]));
      } catch {}
      return next;
    });
    setSelectedSwapEntry(null);
    setSelectedSwapPairedEntry(null);
    setSelectedMergeCandidate(null);
    setStatusMessage("✓ تم فك الدمج وإرجاع الحصتين ككاردين منفصلين.");
  }

  function executeSwap(entryA: TimetableEntry, entryB: TimetableEntry) {
    if (!school || !schedule) return;
    try {
      const swappedEntries = schedule.entries.map((e) => {
        if (e.entry_id === entryA.entry_id) {
          return { ...e, day: entryB.day, period: entryB.period };
        }
        if (e.entry_id === entryB.entry_id) {
          return { ...e, day: entryA.day, period: entryA.period };
        }
        return e;
      });

      const previewSchedule: Schedule = {
        ...schedule,
        entries: swappedEntries,
      };

      const diff = calculateTimetableDiff(schedule, previewSchedule, school);
      setSelectedSwapEntry(null);
      setSelectedSwapPairedEntry(null);
      setSelectedMergeCandidate(null);
      if (diff) {
        setPendingDiff(diff);
        setStatusMessage("✅ تم احتساب التبديل! راجع المعاينة للاعتماد.");
      }
    } catch (err: any) {
      setSelectedSwapEntry(null);
      setSelectedSwapPairedEntry(null);
      setSelectedMergeCandidate(null);
      setErrorMessage(`خطأ أثناء المبادلة: ${err?.message || err}`);
    }
  }

  function isDoublePeriod(entry: TimetableEntry, allEntries: TimetableEntry[]): boolean {
    return allEntries.some((other) => other.entry_id !== entry.entry_id && shouldMergePair(entry, other));
  }

  function handleCellSwapClick(entry: TimetableEntry, pairedEntry?: TimetableEntry) {
    if (pairedEntry) {
      handleSplitPair(entry, pairedEntry);
      return;
    }

    if (!selectedSwapEntry) {
      setSelectedSwapEntry(entry);
      setSelectedSwapPairedEntry(null);
      setSelectedMergeCandidate(null);
      setStatusMessage(
        `🔄 تم تحديد [${getSubjectName(entry.subject_id)} - فصل ${getSectionCodeOnly(entry.section_id)}]. انقر على الحصة المتتالية لدمجهما في كارد واحد، أو على أي حصة أخرى للمبادلة.`
      );
      return;
    }

    if (selectedSwapEntry.entry_id === entry.entry_id) {
      setSelectedSwapEntry(null);
      setSelectedSwapPairedEntry(null);
      setSelectedMergeCandidate(null);
      setStatusMessage("تم إلغاء التحديد.");
      return;
    }

    if (checkCanMerge(selectedSwapEntry, entry)) {
      handleMergePair(selectedSwapEntry, entry);
      return;
    }

    executeSwap(selectedSwapEntry, entry);
  }

  const activeConstraintTeacher = useMemo(
    () => school?.teachers.find((t) => t.id === selectedConstraintTeacherId) || null,
    [school, selectedConstraintTeacherId]
  );

  const renderChatPanelContent = (isMobile: boolean = false) => (
    <div className="bg-[#FFFFFF] rounded-2xl border border-[#E7E5E4] shadow-sm flex flex-col h-full overflow-hidden">
      {/* Fixed Header (Responsive min-w-0 prevents clipping at 390px) */}
      <div className="bg-[#1C1917] text-white p-3 rounded-t-2xl flex items-center justify-between gap-2 shrink-0 border-b border-stone-800">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div
            className="w-8 h-8 rounded-xl bg-[#EDE9FE] text-[#8B5CF6] border border-[#8B5CF6]/40 flex items-center justify-center shadow-xs shrink-0"
            aria-hidden="true"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="font-extrabold text-xs tracking-tight text-white truncate">وكيل الجداول الذكي</h3>
              <span className="text-[10px] bg-[#CCFBF1] text-[#0F766E] font-bold px-1.5 py-0.5 rounded border border-[#14B8A6] shrink-0">
                نشط
              </span>
            </div>
            <p className="text-[11px] text-stone-300 mt-0.5 font-medium truncate">تعديل القيود بالعامية المصرية والخليجية</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              setChatHistory([DEFAULT_CHAT_WELCOME_MESSAGE]);
              setUndoStack([]);
            }}
            className="text-[11px] text-stone-200 hover:text-white px-2 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 transition cursor-pointer"
            title="مسح سجل المحادثة والبدء من جديد"
            aria-label="مسح المحادثة"
          >
            مسح
          </button>

          {isMobile ? (
            <button
              type="button"
              onClick={() => setIsMobileSheetOpen(false)}
              className="text-xs text-stone-200 hover:text-white px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 transition font-bold cursor-pointer"
              title="طي المحادثة"
              aria-label="إغلاق لوحة المحادثة"
            >
              ✕ طي
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleChatCollapse}
              className="text-stone-300 hover:text-white p-1.5 rounded-lg hover:bg-stone-800 transition text-xs font-bold cursor-pointer"
              title="طي لوحة الشات إلى شريط جانبي"
              aria-label="طي لوحة الشات"
            >
              ⇤
            </button>
          )}
        </div>
      </div>

      {/* Messages Area - Internal Scroll Only with WCAG AA Contrast */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3 bg-[#FAFAF9]">
        {chatHistory.map((item, idx) => (
          <div
            key={idx}
            className={`p-3.5 rounded-2xl text-xs whitespace-pre-wrap transition-all shadow-xs ${item.role === "user"
              ? "bg-[#0F766E] text-white ms-auto max-w-[85%]"
              : "bg-[#FFFFFF] text-[#1C1917] border border-[#E7E5E4] me-auto max-w-[92%]"
              }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] font-bold">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`inline-flex items-center gap-1.5 ${item.role === "user" ? "text-[#CCFBF1]" : "text-[#6D28D9]"}`}
                >
                  {item.role === "ai" && (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-[#EDE9FE] text-[#8B5CF6]" aria-hidden="true">
                      ✦
                    </span>
                  )}
                  <span>{item.role === "user" ? "طلبك" : "AI"}</span>
                </span>
                {item.role === "ai" && item.engineMeta && (
                  item.engineMeta.source === "gemini_api" ? (
                    <span
                      title={`${item.engineMeta.model_used || "gemini"} · ${item.engineMeta.via === "browser_byok" ? "BYOK" : "Server"}${item.engineMeta.tool_calls_used?.length ? ` · ${item.engineMeta.tool_calls_used.length} أداة` : ""}`}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#CCFBF1] text-[#0F766E] border border-[#14B8A6]/40"
                    >
                      Gemini
                    </span>
                  ) : item.engineMeta.source === "local_engine" ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300">
                      محلي (أقل دقة)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-300">
                      <span>
                        {item.engineMeta.failure?.error_origin === "model"
                          ? "🤖 خطأ الموديل"
                          : item.engineMeta.failure?.error_origin === "no_key"
                            ? "🔑 بدون مفتاح"
                            : "🔑 خطأ API"}
                      </span>
                      {item.engineMeta.failure?.http_status && (
                        <span dir="ltr" className="font-mono text-[9.5px]">
                          [{item.engineMeta.failure.http_status}]
                        </span>
                      )}
                    </span>
                  )
                )}
              </div>
              {item.timestamp && (
                <span className={`shrink-0 ${item.role === "user" ? "text-[#CCFBF1]" : "text-[#57534E]"}`}>
                  {item.timestamp}
                </span>
              )}
            </div>

            <div className="leading-relaxed font-medium">{item.text}</div>

            {item.pendingLocalPrompt && (
              <div className="mt-2.5 p-2.5 rounded-xl bg-amber-50/90 border border-amber-300 space-y-2">
                <div className="text-[11px] font-bold text-amber-950 flex flex-wrap items-center gap-1.5">
                  <span>
                    {item.engineMeta?.failure?.error_origin === "model"
                      ? "السبب من الموديل:"
                      : "السبب من الـ API:"}
                  </span>
                  <span className="font-medium">{item.engineMeta?.failure?.reason_ar}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowKeyManagerModal(true)}
                    className="bg-[#0F766E] hover:bg-[#115E59] text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                  >
                    🔑 إضافة مفتاح API جديد
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendChat(item.pendingLocalPrompt)}
                    className="bg-white hover:bg-stone-100 text-[#1C1917] border border-[#D6D3D1] text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                  >
                    ✨ إعادة المحاولة الآن
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendChat(item.pendingLocalPrompt, { forceLocalFallback: true })}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                  >
                    ⚙️ إكمال محلي (أقل دقة)
                  </button>
                </div>
              </div>
            )}

            {item.changes && item.changes.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-[#E7E5E4] space-y-1 bg-[#CCFBF1]/35 p-2 rounded-xl border border-[#14B8A6]/40">
                <span className="text-[11px] text-[#0F766E] font-extrabold flex items-center gap-1">
                  <span>✓</span>
                  <span>العمليات المنفذة بنجاح:</span>
                </span>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-[#1C1917] ps-1">
                  {item.changes.map((c, cIdx) => (
                    <li key={cIdx}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {item.isError && item.retryPrompt && (
              <div className="mt-2 pt-2 border-t border-[#FB7185] bg-[#FFF1F2] p-2 rounded-xl flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#BE123C] font-bold">تعذر إكمال العملية</span>
                <button
                  type="button"
                  onClick={() => handleSendChat(item.retryPrompt)}
                  className="bg-[#BE123C] hover:bg-[#9F1239] text-white text-[11px] font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
                >
                  إعادة المحاولة
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Multi-Step Animated Loading Indicator */}
        {isChatSubmitting && (
          <div className="p-3.5 rounded-2xl text-xs bg-[#FFFFFF] text-[#1C1917] me-auto max-w-[92%] border border-[#8B5CF6]/50 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded-full bg-[#EDE9FE] text-[#8B5CF6] flex items-center justify-center text-xs motion-safe:animate-spin shrink-0">
                  ✦
                </div>
                <span className="font-extrabold text-[#6D28D9] text-xs truncate">جاري التحليل وتنفيذ التعديلات...</span>
              </div>
              <span className="text-[11px] font-bold text-[#6D28D9] bg-[#EDE9FE] px-2 py-0.5 rounded-full shrink-0">
                {chatLoadingStep === 1
                  ? "1 / 3 فهم"
                  : chatLoadingStep === 2
                    ? "2 / 3 صياغة"
                    : "3 / 3 توزيع"}
              </span>
            </div>

            <div className="w-full bg-[#E7E5E4] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-[#8B5CF6] h-full transition-all duration-500 rounded-full"
                style={{
                  width: chatLoadingStep === 1 ? "35%" : chatLoadingStep === 2 ? "70%" : "95%",
                }}
              />
            </div>

            <div className="space-y-1 text-[11px]">
              <div className={`flex items-center gap-1.5 ${chatLoadingStep >= 1 ? "text-[#1C1917] font-bold" : "text-[#57534E]"}`}>
                <span>{chatLoadingStep > 1 ? "✓" : "•"}</span>
                <span>فحص السؤال والاطلاع على المعلمين والفصول والأنصبة</span>
              </div>
              <div className={`flex items-center gap-1.5 ${chatLoadingStep >= 2 ? "text-[#6D28D9] font-bold" : "text-[#57534E]"}`}>
                <span>{chatLoadingStep > 2 ? "✓" : chatLoadingStep === 2 ? "⏳" : "•"}</span>
                <span>تحديث بيانات المدرسة وصياغة الرد</span>
              </div>
              <div className={`flex items-center gap-1.5 ${chatLoadingStep >= 3 ? "text-[#0F766E] font-bold" : "text-[#57534E]"}`}>
                <span>{chatLoadingStep === 3 ? "⚡" : "•"}</span>
                <span>حل الجدول وتوزيع الحصص بضمان 0% تعارضات</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Modern 2026 Conversational Composer */}
      <div className="p-2.5 sm:p-3 border-t border-[#E7E5E4] bg-[#FFFFFF] shrink-0">
        <div className="flex items-center gap-1.5 rounded-2xl border border-[#D6D3D1] bg-[#FAFAF9] p-1.5 shadow-2xs transition-all focus-within:bg-[#FFFFFF] focus-within:border-[#0F766E] focus-within:ring-2 focus-within:ring-[#0F766E]/20">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
            placeholder="اكتب طلبك..."
            className="flex-1 min-w-0 bg-transparent px-2.5 py-1.5 text-xs font-semibold text-[#1C1917] focus:outline-none placeholder:font-normal placeholder:text-[#A8A29E]"
          />
          <button
            type="button"
            onClick={() => handleSendChat()}
            disabled={loading || !chatInput.trim()}
            className="min-h-[34px] bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-40 text-white font-bold px-3.5 py-1.5 rounded-xl text-xs shadow-xs transition flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <span>إرسال</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div dir="rtl" className="min-h-screen bg-[#FAFAF9] text-[#1C1917]">
      {/* Executive SaaS Header with Live Pulsing Status Indicator */}
      <header className="sticky top-0 z-30 bg-[#FFFFFF] text-[#1C1917] border-t-[3px] border-t-[#0F766E] border-b border-[#E7E5E4] shadow-2xs px-4 sm:px-6 py-2.5">
        <div className="max-w-[1850px] mx-auto flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
          {/* Typographic Wordmark Logo (جدول AI / JADWAL) + Live Pulsing Dot */}
          <div className="flex items-center justify-between gap-3 min-w-0">
            <div className="flex items-center gap-3 min-w-0">
              <JadwalLogo />

              {/* Pulsing Live Status Dot inside Header */}
              <span
                className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-[#0F766E] bg-[#CCFBF1]/70 border border-[#14B8A6]/45 px-2.5 py-1 rounded-full tabular-nums shrink-0"
                title={`تحديث الجدول متاح تلقائياً وعند الطلب · آخر تحديث: ${lastUpdatedTime}`}
              >
                <span className="relative flex h-2 w-2">
                  <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-[#14B8A6] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0F766E]"></span>
                </span>
                <span>{loading ? "جاري التحديث..." : lastUpdatedTime}</span>
              </span>
            </div>

            {/* Mobile Theme Switch & Menu Toggle */}
            <div className="flex items-center gap-1.5 sm:hidden shrink-0">
              <button
                type="button"
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                aria-label={theme === "dark" ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن"}
                title={theme === "dark" ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن"}
                className="min-h-[34px] min-w-[34px] bg-[#FAFAF9] hover:bg-[#E7E5E4] text-[#1C1917] px-2 py-1.5 rounded-xl border border-[#E7E5E4] flex items-center justify-center transition cursor-pointer"
              >
                {theme === "dark" ? (
                  <svg className="w-4 h-4 text-[#FBBF24]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                    <circle cx="12" cy="12" r="4" />
                    <path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-[#57534E]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={() => setMobileHeaderMenuOpen(!mobileHeaderMenuOpen)}
                className="min-h-[34px] bg-[#FAFAF9] hover:bg-[#E7E5E4] text-[#1C1917] text-xs font-bold px-2.5 py-1.5 rounded-xl border border-[#E7E5E4] transition cursor-pointer"
                title="خيارات المدرسة والمفاتيح"
              >
                {mobileHeaderMenuOpen ? "✕" : "القائمة"}
              </button>
            </div>
          </div>

          {/* Mobile Dropdown Menu */}
          {mobileHeaderMenuOpen && (
            <div className="sm:hidden bg-[#FAFAF9] rounded-xl border border-[#E7E5E4] p-2.5 space-y-2">
              <select
                value={selectedPreset}
                onChange={(e) => handleLoadPreset(e.target.value)}
                className="w-full bg-white border border-[#E7E5E4] text-[#1C1917] rounded-lg px-2.5 py-1.5 text-xs font-bold"
              >
                {allSchoolsList.length === 0 ? (
                  <option value="">(لا توجد مدارس)</option>
                ) : (
                  allSchoolsList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))
                )}
              </select>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddSchoolModal(true);
                    setMobileHeaderMenuOpen(false);
                  }}
                  className="bg-[#0F766E] text-white font-bold p-2 rounded-lg text-center"
                >
                  + مدرسة جديدة
                </button>
                {school && (
                  <button
                    type="button"
                    onClick={() => {
                      handleSaveCurrentSchool();
                      setMobileHeaderMenuOpen(false);
                    }}
                    className="bg-white border border-[#E7E5E4] text-[#1C1917] font-bold p-2 rounded-lg text-center"
                  >
                    حفظ
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    refreshKeysState();
                    setShowKeyManagerModal(true);
                    setMobileHeaderMenuOpen(false);
                  }}
                  className="bg-[#EDE9FE] text-[#6D28D9] font-bold p-2 rounded-lg text-center col-span-2"
                >
                  المفاتيح ({userKeys.filter((k) => k.enabled).length})
                </button>
              </div>
            </div>
          )}

          {/* Desktop & Tablet Unified Action Strip */}
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {/* Active School Selector & Primary School Actions */}
            <div className="hidden sm:flex items-center gap-1 bg-[#FAFAF9] border border-[#E7E5E4] rounded-xl p-1 relative">
              <select
                value={selectedPreset}
                onChange={(e) => handleLoadPreset(e.target.value)}
                className="bg-white border border-[#E7E5E4] text-[#1C1917] rounded-lg px-2.5 py-1.5 text-xs font-extrabold focus:ring-2 focus:ring-[#0F766E] focus:outline-none min-w-[155px] max-w-[215px] truncate cursor-pointer"
                title="التبديل بين المدارس المحفوظة"
                aria-label="اختيار المدرسة النشطة"
              >
                {allSchoolsList.length === 0 ? (
                  <option value="">(لا توجد مدارس)</option>
                ) : (
                  allSchoolsList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))
                )}
              </select>

              <button
                type="button"
                onClick={() => setShowAddSchoolModal(true)}
                className="bg-[#CCFBF1] hover:bg-[#99F6E4] text-[#0F766E] border border-[#14B8A6]/40 font-extrabold text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition cursor-pointer"
                title="إضافة مدرسة جديدة"
              >
                <span>+</span>
                <span>مدرسة</span>
              </button>

              {school && (
                <button
                  type="button"
                  onClick={handleSaveCurrentSchool}
                  className="bg-white hover:bg-[#E7E5E4]/60 text-[#1C1917] border border-[#E7E5E4] font-bold text-xs px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                  title="حفظ بيانات المدرسة والجدول بالمتصفح"
                >
                  حفظ
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowHeaderActionsMenu((prev) => !prev)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${showHeaderActionsMenu
                  ? "bg-[#1C1917] text-white border-[#1C1917]"
                  : "bg-white hover:bg-[#E7E5E4]/60 text-[#57534E] border-[#E7E5E4]"
                  }`}
                title="إجراءات إضافية (نسخ، حذف، نسخ احتياطي JSON)"
              >
                المزيد ▾
              </button>

              {showHeaderActionsMenu && (
                <div className="absolute top-full end-0 mt-1.5 w-48 bg-white rounded-xl border border-[#E7E5E4] shadow-lg p-1.5 z-50 space-y-0.5 text-xs">
                  {school && (
                    <button
                      type="button"
                      onClick={() => {
                        handleDuplicateSchool();
                        setShowHeaderActionsMenu(false);
                      }}
                      className="w-full text-start px-3 py-2 rounded-lg font-bold text-[#1C1917] hover:bg-[#FAFAF9] transition cursor-pointer"
                    >
                      نسخ المدرسة الحالية
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      handleExportBackupJson();
                      setShowHeaderActionsMenu(false);
                    }}
                    className="w-full text-start px-3 py-2 rounded-lg font-bold text-[#1C1917] hover:bg-[#FAFAF9] transition cursor-pointer"
                  >
                    تصدير نسخة JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      backupFileInputRef.current?.click();
                      setShowHeaderActionsMenu(false);
                    }}
                    className="w-full text-start px-3 py-2 rounded-lg font-bold text-[#1C1917] hover:bg-[#FAFAF9] transition cursor-pointer"
                  >
                    استيراد نسخة JSON
                  </button>
                  {school && (
                    <button
                      type="button"
                      onClick={() => {
                        handleDeleteSchool(selectedPreset);
                        setShowHeaderActionsMenu(false);
                      }}
                      className="w-full text-start px-3 py-2 rounded-lg font-bold text-[#BE123C] hover:bg-[#FFF1F2] transition cursor-pointer"
                    >
                      حذف المدرسة
                    </button>
                  )}
                </div>
              )}
              <input
                ref={backupFileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportBackupJsonFile}
                className="hidden"
              />
            </div>

            {/* Creator WhatsApp Contact */}
            <a
              href="https://wa.me/201039659917"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:inline-flex items-center gap-1.5 bg-[#CCFBF1]/60 hover:bg-[#CCFBF1] text-[#0F766E] border border-[#14B8A6]/40 font-bold text-xs px-2.5 py-2 rounded-xl transition shrink-0"
              title="التواصل مع منشئ المشروع عبر واتساب: 01039659917"
            >
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12.031 2c-5.516 0-9.969 4.453-9.969 9.969 0 1.766.469 3.484 1.344 5l-1.406 5.156 5.281-1.375c1.469.797 3.109 1.219 4.75 1.219 5.516 0 9.969-4.453 9.969-9.969s-4.453-10-9.969-10zm5.828 14.125c-.25.703-1.438 1.344-1.984 1.422-.531.078-1.203.109-1.938-.125-.453-.141-1.031-.344-1.766-.656-3.094-1.328-5.109-4.453-5.266-4.656-.156-.203-1.266-1.688-1.266-3.219s.797-2.281 1.078-2.594c.281-.313.625-.391.828-.391.203 0 .406.016.594.016.188 0 .453-.078.703.531.25.609.859 2.094.938 2.25.078.156.125.344.031.547-.094.203-.141.328-.281.5-.141.172-.297.391-.422.516-.141.141-.281.297-.125.578.156.281.703 1.156 1.516 1.875 1.047.922 1.922 1.219 2.203 1.359.281.141.438.109.609-.078.172-.188.703-.828.891-1.109.188-.281.375-.234.625-.141.25.094 1.609.75 1.891.891.281.141.469.203.531.328.063.125.063.719-.188 1.422z" />
              </svg>
              <span>تواصل</span>
            </a>

            {/* Dual Light / Dark Theme Segmented Switch */}
            <div className="hidden sm:inline-flex items-center bg-[#FAFAF9] border border-[#E7E5E4] rounded-xl p-0.5 shrink-0" role="group" aria-label="اختيار مظهر الواجهة">
              <button
                type="button"
                onClick={() => setTheme("light")}
                aria-pressed={theme === "light"}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold inline-flex items-center gap-1 transition cursor-pointer ${theme === "light"
                  ? "bg-white text-[#1C1917] shadow-2xs border border-[#E7E5E4]"
                  : "text-[#57534E] hover:text-[#1C1917]"
                  }`}
                title="الوضع الفاتح (وايت)"
              >
                <svg className="w-3.5 h-3.5 text-[#D97706] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
                </svg>
                <span>فاتح</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                aria-pressed={theme === "dark"}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold inline-flex items-center gap-1 transition cursor-pointer ${theme === "dark"
                  ? "bg-[#292524] text-[#FAF9F7] shadow-2xs border border-[#57534E]"
                  : "text-[#57534E] hover:text-[#1C1917]"
                  }`}
                title="الوضع الداكن (دارك)"
              >
                <svg className="w-3.5 h-3.5 text-[#A78BFA] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
                </svg>
                <span>داكن</span>
              </button>
            </div>

            {/* AI Keys Pill */}
            <button
              type="button"
              onClick={() => {
                refreshKeysState();
                setShowKeyManagerModal(true);
              }}
              className="hidden sm:inline-flex bg-[#EDE9FE]/70 hover:bg-[#EDE9FE] text-[#6D28D9] border border-[#8B5CF6]/35 font-extrabold text-xs px-3 py-2 rounded-xl items-center gap-1.5 transition shrink-0 cursor-pointer"
              title="إدارة مفاتيح Gemini API وتدويرها"
            >
              <span className="text-[#8B5CF6]" aria-hidden="true">✦</span>
              <span>المفاتيح</span>
              <span className="bg-white text-[#6D28D9] px-1.5 py-0.2 rounded-md text-[11px] font-black tabular-nums border border-[#8B5CF6]/20">
                {userKeys.filter((k) => k.enabled).length}
              </span>
            </button>

            {/* Primary CTA: Generate / Update Timetable */}
            <button
              type="button"
              onClick={handleSolve}
              disabled={loading || !school}
              className="w-full sm:w-auto min-h-[38px] bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-50 text-white font-extrabold text-xs px-4 sm:px-5 py-2 rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{loading ? "جاري التوليد..." : "إنشاء الجدول"}</span>
            </button>
          </div>
        </div>
      </header>
      {/* BYOK Gemini API Key Manager Modal */}
      {showKeyManagerModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔑</span>
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">
                    مدير مفاتيح Gemini API (BYOK — تدوير تلقائي)
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    أضف مفتاحاً واحداً أو عدة مفاتيح ليتم التبديل بينها تلقائياً عند انتهاء الحصة (429)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowKeyManagerModal(false)}
                className="bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600"
              >
                إغلاق ✕
              </button>
            </div>

            {/* Mandatory Privacy & Quota Notices */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-1">
                <div className="font-extrabold flex items-center gap-1.5">
                  <span>🔒</span>
                  <span>مفاتيحك تبقى على جهازك</span>
                </div>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  يتم تخزين مفاتيحك محلياً في متصفحك فقط (Local-First) ولا تُرسل إلى أي خادم وسيط، وتُعرض آخر 4 خانات فقط لحمايتها.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1">
                <div className="font-extrabold flex items-center gap-1.5">
                  <span>💡</span>
                  <span>تنبيه حول حصة الاستخدام (Quota)</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  الحصة قد تُحسب على مستوى المشروع (Project) في Google AI Studio؛ للحصول على تدوير فعلي للحصص يُنصح بإنشاء كل مفتاح في مشروع مستقل.
                </p>
              </div>
            </div>

            {keyManagerNotice && (
              <div className="px-3.5 py-2.5 rounded-xl bg-slate-100 border border-slate-300 text-slate-800 text-xs font-bold">
                {keyManagerNotice}
              </div>
            )}

            {/* Tabs: Single Add vs Bulk Add */}
            <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setKeyManagerTab("single")}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-extrabold transition ${keyManagerTab === "single" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
              >
                ➕ إضافة مفتاح مفرد (باسم مستعار)
              </button>
              <button
                type="button"
                onClick={() => setKeyManagerTab("bulk")}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-extrabold transition ${keyManagerTab === "bulk" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
              >
                📋 إضافة عدة مفاتيح دفعة واحدة (سطر لكل مفتاح)
              </button>
            </div>

            {keyManagerTab === "single" ? (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      الاسم المستعار (اختياري):
                    </label>
                    <input
                      type="text"
                      value={newKeyAlias}
                      onChange={(e) => setNewKeyAlias(e.target.value)}
                      placeholder="اسم المفتاح..."
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      مفتاح Gemini API:
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={newKeyInput}
                        onChange={(e) => setNewKeyInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddSingleKey()}
                        placeholder="AIzaSy..."
                        dir="ltr"
                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={handleAddSingleKey}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs px-4 py-2 rounded-lg shadow-xs shrink-0 transition"
                      >
                        إضافة المفتاح
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <label className="text-[11px] font-bold text-slate-700 block">
                  الصق عدة مفاتيح دفعة واحدة (مفتاح واحد في كل سطر، أو بصيغة الاسم: المفتاح):
                </label>
                <textarea
                  rows={4}
                  dir="ltr"
                  value={bulkKeysInput}
                  onChange={(e) => setBulkKeysInput(e.target.value)}
                  placeholder="الصق مفاتيحك (مفتاح في كل سطر)..."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddBulkKeys}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs px-4 py-2 rounded-lg shadow-xs transition"
                  >
                    📥 إضافة جميع المفاتيح
                  </button>
                </div>
              </div>
            )}

            {/* Stored Keys List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-extrabold text-slate-800">
                  المفاتيح المحفوظة في المتصفح ({userKeys.length}):
                </h3>
                <span className="text-[11px] text-slate-500">
                  في حال عدم إضافة مفاتيح، يعمل المحرك المحلي الحتمي تلقائياً بكامل الكفاءة
                </span>
              </div>

              {userKeys.length === 0 ? (
                <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-xl text-xs text-slate-500">
                  لا توجد مفاتيح مضافة حالياً. يعمل التطبيق بالمحرك المحلي الحتمي (schoolCore + TypeScript Constraint Solver) مباشرة، ويمكنك إضافة مفاتيح Gemini لتفعيل التوليد الحر.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pe-1">
                  {userKeys.map((k) => {
                    const isCooldown = k.status === "cooldown" && k.cooldownUntil && k.cooldownUntil > Date.now();
                    return (
                      <div
                        key={k.id}
                        className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${!k.enabled
                          ? "bg-slate-50 border-slate-200 opacity-75"
                          : isCooldown
                            ? "bg-amber-50/60 border-amber-200"
                            : k.status === "valid"
                              ? "bg-emerald-50/40 border-emerald-200"
                              : "bg-white border-slate-200"
                          }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-slate-900">{k.alias}</span>
                            <span
                              dir="ltr"
                              className="font-mono text-[11px] bg-slate-200/80 text-slate-800 px-2 py-0.5 rounded font-bold"
                            >
                              {k.masked}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${!k.enabled
                                ? "bg-rose-100 text-rose-700"
                                : isCooldown
                                  ? "bg-amber-100 text-amber-800"
                                  : k.status === "valid"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                            >
                              {!k.enabled
                                ? "معطّل"
                                : isCooldown
                                  ? "تبريد مؤقت (429)"
                                  : k.status === "valid"
                                    ? "صالح ✓"
                                    : "غير مختبر"}
                            </span>
                          </div>
                          {k.lastStatusMessage && (
                            <p className="text-[10px] text-slate-500">{k.lastStatusMessage}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleTestUserKey(k.id)}
                            disabled={testingKeyId === k.id}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold text-[11px] px-2.5 py-1 rounded-lg transition disabled:opacity-50"
                          >
                            {testingKeyId === k.id ? "⏳ جاري الاختبار..." : "🧪 اختبار المفتاح"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleUserKey(k.id)}
                            className={`font-bold text-[11px] px-2.5 py-1 rounded-lg border transition ${k.enabled
                              ? "bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200"
                              : "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200"
                              }`}
                          >
                            {k.enabled ? "تعطيل" : "تفعيل"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveUserKey(k.id)}
                            className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-[11px] px-2.5 py-1 rounded-lg transition"
                          >
                            🗑️ حذف
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add New School Modal */}
      {showAddSchoolModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🏫</span>
                <h2 className="text-base font-extrabold text-slate-900">إضافة مدرسة جديدة إلى النظام</h2>
              </div>
              <button
                onClick={() => setShowAddSchoolModal(false)}
                className="bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600"
              >
                إغلاق ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-extrabold block mb-1.5 text-slate-700">
                  اسم المدرسة الجديدة:
                </label>
                <input
                  type="text"
                  placeholder="اسم المدرسة..."
                  value={newSchoolName}
                  onChange={(e) => setNewSchoolName(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-extrabold block mb-2 text-slate-700">
                  طريقة الإنشاء:
                </label>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => setNewSchoolType("preset")}
                    className={`py-2 px-3 rounded-xl border-2 text-center font-extrabold text-xs transition ${newSchoolType === "preset"
                      ? "border-blue-600 bg-blue-50 text-blue-900 shadow-xs"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                  >
                    <span>📚 نماذج جاهزة</span>
                    <span className="block text-[10px] font-normal text-slate-500 mt-0.5">
                      قيم شائعة قابلة للتعديل
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewSchoolType("blank")}
                    className={`py-2 px-3 rounded-xl border-2 text-center font-extrabold text-xs transition ${newSchoolType === "blank"
                      ? "border-blue-600 bg-blue-50 text-blue-900 shadow-xs"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                  >
                    <span>📄 قالب فارغ</span>
                    <span className="block text-[10px] font-normal text-slate-500 mt-0.5">
                      تخصيص يدوي من الصفر
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewSchoolType("ai")}
                    className={`py-2 px-3 rounded-xl border-2 text-center font-extrabold text-xs transition ${newSchoolType === "ai"
                      ? "border-blue-600 bg-blue-50 text-blue-900 shadow-xs"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                  >
                    <span>🤖 ذكاء اصطناعي</span>
                    <span className="block text-[10px] font-normal text-slate-500 mt-0.5">
                      توليد من وصف نصي
                    </span>
                  </button>
                </div>

                {newSchoolType === "preset" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-800">
                        اختر النموذج (قيم شائعة قابلة للتعديل بالكامل):
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPresetCategoryFilter("ALL")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${presetCategoryFilter === "ALL"
                            ? "bg-slate-800 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                        >
                          الكل ({ALL_SCHOOL_PRESETS.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setPresetCategoryFilter("GOVERNMENT_GENERAL")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${presetCategoryFilter === "GOVERNMENT_GENERAL"
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                        >
                          حكومي عام
                        </button>
                        <button
                          type="button"
                          onClick={() => setPresetCategoryFilter("EXPERIMENTAL_LANGUAGE")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${presetCategoryFilter === "EXPERIMENTAL_LANGUAGE"
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                        >
                          تجريبي لغات
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pe-1">
                      {ALL_SCHOOL_PRESETS.filter(
                        (p) =>
                          presetCategoryFilter === "ALL" ||
                          p.school_type === presetCategoryFilter
                      ).map((p) => {
                        const isSelected = newSchoolPresetId === p.id;
                        return (
                          <div
                            key={p.id}
                            onClick={() => {
                              setNewSchoolPresetId(p.id);
                              if (!newSchoolName) setNewSchoolName(p.label);
                            }}
                            className={`p-3 rounded-xl border-2 cursor-pointer transition text-start ${isSelected
                              ? "border-blue-600 bg-blue-50/70 shadow-xs"
                              : "border-slate-200 hover:border-slate-300 bg-white"
                              }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-base">
                                  {p.stage === "PRIMARY"
                                    ? "🎒"
                                    : p.stage === "PREPARATORY"
                                      ? "🏫"
                                      : "🎓"}
                                </span>
                                <span className="text-xs font-extrabold text-slate-900">
                                  {p.name}
                                </span>
                              </div>
                              <span
                                className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${p.school_type === "GOVERNMENT_GENERAL"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-emerald-100 text-emerald-800"
                                  }`}
                              >
                                {p.school_type === "GOVERNMENT_GENERAL"
                                  ? "حكومي عام"
                                  : "تجريبي لغات"}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 leading-relaxed">
                              {p.description}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px] text-slate-500">
                              <span className="bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-700">
                                {p.grades.length} صفوف دراسية
                              </span>
                              <span className="bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-700">
                                {p.shifts[0]?.weekly_capacity || 35} حصة أسبوعياً
                              </span>
                              <span className="bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded font-medium">
                                تشمل الأنشطة والحاسب والمهارات
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {newSchoolType === "blank" && (
                <div className="p-3 bg-slate-50 border rounded-xl flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">عدد الحصص اليومية للفصل:</label>
                  <select
                    value={newSchoolPeriods}
                    onChange={(e) => setNewSchoolPeriods(Number(e.target.value))}
                    className="border rounded-lg px-3 py-1.5 text-xs font-bold bg-white"
                  >
                    <option value={6}>6 حصص يومياً (30 أسبوعياً)</option>
                    <option value={7}>7 حصص يومياً (35 أسبوعياً)</option>
                    <option value={8}>8 حصص يومياً (40 أسبوعياً)</option>
                  </select>
                </div>
              )}

              {newSchoolType === "ai" && (
                <div className="space-y-2 p-3 bg-blue-50/50 border border-blue-200 rounded-xl">
                  <label className="text-xs font-bold text-blue-950 block">
                    اكتب وصف المدرسة بالفصول والمواد والمعلمين:
                  </label>
                  <textarea
                    rows={4}
                    value={newSchoolAiPrompt}
                    onChange={(e) => setNewSchoolAiPrompt(e.target.value)}
                    placeholder="صف المدرسة: المراحل، الفصول، المواد، والأيام..."
                    className="w-full border rounded-lg p-2.5 text-xs bg-white focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <button
                type="button"
                onClick={() => setShowAddSchoolModal(false)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-4 py-2 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleCreateNewSchool}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold px-6 py-2.5 rounded-xl shadow flex items-center gap-2"
              >
                <span>✨</span>
                <span>إنشاء المدرسة والبدء فوراً</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Layout (Flex with logical RTL: Chat Sidebar at start/right, Main Workspace at end/left) */}
      <div className="max-w-[1850px] mx-auto p-3 sm:p-4 flex flex-col lg:flex-row items-stretch gap-3">
        {/* RIGHT SIDEBAR (start in RTL): AI Copilot Chat */}
        <aside
          style={{ width: isChatCollapsed ? "52px" : `${chatWidth}px` }}
          className="hidden lg:flex shrink-0 lg:sticky lg:top-[74px] h-[calc(100vh-90px)] flex-col transition-all duration-150 z-20"
        >
          {isChatCollapsed ? (
            <div
              onClick={toggleChatCollapse}
              className="h-full bg-[#FFFFFF] rounded-2xl border border-[#E7E5E4] p-2 flex flex-col items-center justify-between cursor-pointer hover:border-[#8B5CF6] hover:shadow-md transition group select-none"
              title="توسيع لوحة وكيل الجداول الذكي"
            >
              <div className="w-8 h-8 rounded-xl bg-[#EDE9FE] text-[#8B5CF6] flex items-center justify-center text-sm shadow-xs group-hover:bg-[#6D28D9] group-hover:text-white transition" aria-hidden="true">
                ✦
              </div>
              <div className="[writing-mode:vertical-rl] rotate-180 font-black text-xs text-[#1C1917] tracking-wider flex items-center gap-2">
                <span>وكيل الجداول الذكي</span>
                <span className="text-[10px] bg-[#CCFBF1] text-[#0F766E] px-1 py-0.5 rounded">نشط</span>
              </div>
              <button
                type="button"
                className="w-8 h-8 rounded-xl bg-[#FAFAF9] text-[#1C1917] border border-[#E7E5E4] group-hover:bg-[#EDE9FE] group-hover:text-[#6D28D9] flex items-center justify-center text-xs font-black transition cursor-pointer"
                title="توسيع لوحة الشات"
                aria-label="توسيع لوحة الشات"
              >
                ⇥
              </button>
            </div>
          ) : (
            renderChatPanelContent(false)
          )}
        </aside>

        {/* Resizer Divider between Chat Sidebar and Main Content */}
        {!isChatCollapsed && (
          <div
            onMouseDown={handleStartResize}
            className="hidden lg:flex w-2 shrink-0 items-center justify-center cursor-col-resize select-none hover:bg-blue-400/20 transition rounded-full group py-4"
            title="اسحب لتعديل عرض لوحة الشات"
          >
            <div className="w-0.5 h-12 bg-slate-300 group-hover:bg-blue-500 rounded-full transition" />
          </div>
        )}

        {/* Main Content Workspace (Takes full remaining width) */}
        <main className="flex-1 min-w-0 space-y-4">
          <nav aria-label="التنقل الرئيسي" className="bg-[#FFFFFF] rounded-2xl px-2 sm:px-3 pt-1.5 shadow-2xs border border-[#E7E5E4] flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1 sm:gap-2 flex-1">
              {[
                {
                  id: "wizard",
                  label: "إعداد المدرسة",
                  icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z",
                },
                {
                  id: "timetable",
                  label: "الجدول والتصدير",
                  icon: "M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
                },
                {
                  id: "constraints",
                  label: "المعلمون والإسناد",
                  icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
                },
              ].map((t) => {
                const isActive = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id as any)}
                    className={`relative flex items-center justify-center gap-2 py-2.5 px-4 rounded-t-xl text-xs font-extrabold transition whitespace-nowrap cursor-pointer border-b-2 ${isActive
                      ? "text-[#0F766E] border-[#0F766E] bg-[#CCFBF1]/35"
                      : "text-[#57534E] border-transparent hover:text-[#1C1917] hover:bg-[#FAFAF9]"
                      }`}
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
                    </svg>
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === "ingest" ? "wizard" : "ingest")}
              className={`mb-1.5 py-1.5 px-2.5 rounded-lg text-[11px] font-bold transition whitespace-nowrap cursor-pointer border ${activeTab === "ingest"
                ? "bg-[#1C1917] text-white border-[#1C1917]"
                : "bg-[#FAFAF9] text-[#57534E] border-[#E7E5E4] hover:text-[#1C1917]"
                }`}
              title="المحرر النصي المتقدم (.md)"
            >
              نص (.md)
            </button>
          </nav>

          {statusMessage && (
            <div className="bg-[#CCFBF1]/50 border border-[#14B8A6] text-[#0F766E] px-4 py-2.5 rounded-xl text-xs font-bold">
              ✓ {statusMessage}
            </div>
          )}
          {errorMessage && (
            <div className="bg-[#FFF1F2] border border-[#FB7185] border-s-4 border-s-[#FB7185] text-[#BE123C] px-4 py-2.5 rounded-xl text-xs font-bold">
              ⚠ {errorMessage}
            </div>
          )}

          {unparsedNotes.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 text-amber-950 px-4 py-3 rounded-xl text-xs space-y-1.5 shadow-sm">
              <div className="flex items-center gap-1.5 font-extrabold text-amber-900">
                <span>⚠️</span>
                <span>ملاحظات وقيود لم تُفهم آلياً ({unparsedNotes.length}):</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-amber-900/90 pe-2">
                {unparsedNotes.map((note, idx) => (
                  <li key={idx} className="font-medium">{note}</li>
                ))}
              </ul>
            </div>
          )}

          {(school?.metadata as any)?.capacity_validation && !(school.metadata as any).capacity_validation.is_valid && (
            <div className="bg-[#FFF1F2] border border-[#FB7185] border-s-4 border-s-[#FB7185] text-[#1C1917] px-4 py-3 rounded-xl text-xs space-y-1.5 shadow-sm">
              <div className="flex items-center gap-1.5 font-extrabold text-[#BE123C]">
                <span>⚠</span>
                <span>تنبيهات الطاقة الاستيعابية:</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[#BE123C] pe-2">
                {(school.metadata as any).capacity_validation.errors.map((err: string, idx: number) => (
                  <li key={idx} className="font-semibold">{err}</li>
                ))}
              </ul>
            </div>
          )}

          {!school && (
            <div className="bg-white rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center space-y-4 shadow-sm">
              <div className="text-5xl">🏫</div>
              <h3 className="text-lg font-extrabold text-slate-800">لا توجد مدرسة نشطة حالياً</h3>
              <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
                تم حذف المدرسة أو لا توجد مدارس مضافة. يمكنك إنشاء مدرسة جديدة باختيار قالب جاهز (ابتدائي، إعدادي، ثانوي) أو كتابة وصف المدرسة ليقوم الذكاء الاصطناعي بإنشائها فوراً.
              </p>
              <button
                type="button"
                onClick={() => setShowAddSchoolModal(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs px-6 py-3 rounded-xl shadow inline-flex items-center gap-2 transition"
              >
                <span>➕</span>
                <span>إضافة أو إنشاء مدرسة جديدة</span>
              </button>
            </div>
          )}

          {activeTab === "wizard" && (
            <SchoolWizardStepper
              initialSchool={school}
              onSaveSchool={(updatedSchool, updatedMarkdown) => {
                const structureChanged = Boolean(
                  school &&
                    (updatedSchool.periods_per_day !== school.periods_per_day ||
                      JSON.stringify(updatedSchool.days) !== JSON.stringify(school.days) ||
                      JSON.stringify(updatedSchool.sections.map((s) => s.daily_period_limits || null)) !==
                        JSON.stringify(school.sections.map((s) => s.daily_period_limits || null)))
                );
                setSchool(updatedSchool);
                setRawText(updatedMarkdown);
                const ana = InBrowserSchoolEngine.analyzeSchool(updatedSchool);
                setAnalysis(ana);
                if (structureChanged && schedule) {
                  const solved = InBrowserSchoolEngine.solveInBrowser(updatedSchool);
                  setSchedule(solved.schedule);
                  setValidation(solved.validation);
                  setMetrics(solved.metrics);
                  setLastUpdatedTime(new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }));
                  persistSchoolData(updatedSchool, updatedMarkdown, solved.schedule, ana);
                } else {
                  persistSchoolData(updatedSchool, updatedMarkdown, schedule, ana);
                }
              }}
              onSolveAndOpenTimetable={(schoolToSolve) => {
                handleSolve(schoolToSolve);
              }}
              onCancel={() => setActiveTab("timetable")}
            />
          )}

          {school && activeTab === "ingest" && (
            <div className="bg-white rounded-xl border border-[#E7E5E4] p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-[#E7E5E4] pb-2">
                <h2 className="text-xs sm:text-sm font-extrabold text-[#1C1917]">المحرر النصي المتقدم (.md)</h2>
                <button
                  type="button"
                  onClick={() => setActiveTab("wizard")}
                  className="text-xs font-bold text-[#57534E] hover:text-[#1C1917] cursor-pointer"
                >
                  عودة لإعداد المدرسة ×
                </button>
              </div>
              <textarea
                rows={14}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="w-full border border-[#E7E5E4] rounded-xl p-3 text-xs font-mono bg-[#FAFAF9] text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                placeholder="الصق نص أو جدول المدرسة..."
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleParseRawText}
                  disabled={loading || !rawText.trim()}
                  className="bg-[#0F766E] hover:bg-[#115E59] disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer"
                >
                  تحليل النص
                </button>
                <button
                  type="button"
                  onClick={handleSolve}
                  disabled={loading || !school}
                  className="bg-[#1C1917] hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer"
                >
                  إنشاء الجدول
                </button>
              </div>
            </div>
          )}
          {activeTab === "constraints" && school && (
            <TeacherManagementHub
              school={school}
              onUpdateSchool={handleUpdateSchoolFromHub}
              onSolveSchool={() => handleSolve(school)}
              selectedTeacherId={selectedTeacherId}
              onSelectTeacherId={setSelectedTeacherId}
            />
          )}


          {activeTab === "timetable" && school && (
            <div className="bg-[#FFFFFF] rounded-xl border border-[#E7E5E4] p-5 space-y-4">
              {/* Swap & Merge Mode Notification Bar */}
              {selectedSwapEntry && (
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#EDE9FE] border border-[#8B5CF6] text-[#6D28D9] rounded-xl shadow-sm text-xs font-bold transition-all">
                  {selectedSwapPairedEntry ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-base">🔗</span>
                        <span>
                          تم تحديد كارد مدمج: [{getSubjectName(selectedSwapEntry.subject_id)} - فصل {getSectionCodeOnly(selectedSwapEntry.section_id)}].
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleSplitPair(selectedSwapEntry, selectedSwapPairedEntry)}
                          className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer shadow-xs"
                        >
                          فك الدمج
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSwapEntry(null);
                            setSelectedSwapPairedEntry(null);
                            setSelectedMergeCandidate(null);
                            setStatusMessage("تم إلغاء التحديد.");
                          }}
                          className="bg-white/80 hover:bg-white text-slate-700 border border-slate-300 px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer"
                        >
                          إلغاء ✕
                        </button>
                      </div>
                    </>
                  ) : selectedMergeCandidate ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-base">🔗</span>
                        <span>تم تحديد حصتين متتاليتين لنفس المعلم والفصل.</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMergePair(selectedSwapEntry, selectedMergeCandidate)}
                          className="bg-[#0F766E] hover:bg-[#115E59] text-white px-3.5 py-1.5 rounded-lg text-xs font-black transition cursor-pointer shadow-xs"
                        >
                          دمج الحصتين في كارد واحد
                        </button>
                        <button
                          type="button"
                          onClick={() => executeSwap(selectedSwapEntry, selectedMergeCandidate)}
                          className="bg-white/80 hover:bg-white text-slate-700 border border-slate-300 px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer"
                        >
                          تبديل 🔄
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSwapEntry(null);
                            setSelectedSwapPairedEntry(null);
                            setSelectedMergeCandidate(null);
                            setStatusMessage("تم إلغاء التحديد.");
                          }}
                          className="bg-white/80 hover:bg-white text-slate-700 border border-slate-300 px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer"
                        >
                          إلغاء ✕
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-base motion-safe:animate-bounce">🔄</span>
                        <span>
                          وضع تحديد الحصص: تم تحديد [{getSubjectName(selectedSwapEntry.subject_id)} - فصل {getSectionCodeOnly(selectedSwapEntry.section_id)} ({DAY_NAMES_AR[selectedSwapEntry.day]} ح {selectedSwapEntry.period})]. انقر على الحصة المتتالية لدمجهما في كارد واحد، أو انقر على أي حصة أخرى للمبادلة!
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSwapEntry(null);
                          setSelectedSwapPairedEntry(null);
                          setSelectedMergeCandidate(null);
                          setStatusMessage("تم إلغاء تحديد الحصة.");
                        }}
                        className="bg-white/80 hover:bg-white text-slate-700 border border-slate-300 px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition shrink-0 cursor-pointer"
                      >
                        إلغاء ✕
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* View Switcher & Calm Export Hierarchy */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E7E5E4]">
                <div className="flex flex-wrap items-center gap-1 bg-[#FAFAF9] border border-[#E7E5E4] p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setViewMode("master")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${viewMode === "master" ? "bg-[#0F766E] text-white shadow-2xs" : "text-[#57534E] hover:text-[#1C1917]"
                      }`}
                  >
                    <span>الجدول العام</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("section")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${viewMode === "section" ? "bg-[#0F766E] text-white shadow-2xs" : "text-[#57534E] hover:text-[#1C1917]"
                      }`}
                  >
                    <span>الفصول</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("teacher")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${viewMode === "teacher" ? "bg-[#0F766E] text-white shadow-2xs" : "text-[#57534E] hover:text-[#1C1917]"
                      }`}
                  >
                    <span>المعلمون</span>
                  </button>
                </div>

                {schedule && schedule.entries.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIsTimetableFullscreen(!isTimetableFullscreen)}
                      className="bg-[#1C1917] hover:bg-stone-800 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg shadow-2xs flex items-center gap-1 transition cursor-pointer"
                      title="تكبير أو تصغير الجدول لملء الشاشة"
                    >
                      <span>{isTimetableFullscreen ? "إنهاء ملء الشاشة" : "ملء الشاشة"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="bg-[#FFFFFF] hover:bg-[#FAFAF9] text-[#1C1917] text-xs font-bold px-2.5 py-1.5 rounded-lg border border-[#E7E5E4] shadow-2xs flex items-center gap-1 transition cursor-pointer"
                      title="طباعة سريعة للجدول المعروض"
                    >
                      <span>طباعة</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => service.downloadExport("pdf", school, schedule, "master").catch((e) => setErrorMessage(e.message))}
                      className="bg-[#FFFFFF] hover:bg-[#FAFAF9] text-[#1C1917] text-xs font-bold px-2.5 py-1.5 rounded-lg border border-[#E7E5E4] shadow-2xs flex items-center gap-1 transition cursor-pointer"
                      title="طباعة الجدول العام A3"
                    >
                      <span>PDF العام A3</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => service.downloadExport("pdf", school, schedule, "sections").catch((e) => setErrorMessage(e.message))}
                      className="bg-[#FFFFFF] hover:bg-[#FAFAF9] text-[#1C1917] text-xs font-bold px-2.5 py-1.5 rounded-lg border border-[#E7E5E4] shadow-2xs flex items-center gap-1 transition cursor-pointer"
                      title="طباعة بطاقات الفصول A4"
                    >
                      <span>بطاقات الفصول</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => service.downloadExport("pdf", school, schedule, "teachers").catch((e) => setErrorMessage(e.message))}
                      className="bg-[#FFFFFF] hover:bg-[#FAFAF9] text-[#1C1917] text-xs font-bold px-2.5 py-1.5 rounded-lg border border-[#E7E5E4] shadow-2xs flex items-center gap-1 transition cursor-pointer"
                      title="طباعة بطاقات المعلمين A4"
                    >
                      <span>بطاقات المعلمين</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => service.downloadExport("pdf", school, schedule, "all").catch((e) => setErrorMessage(e.message))}
                      className="bg-[#FFFFFF] hover:bg-[#FAFAF9] text-[#0F766E] text-xs font-bold px-2.5 py-1.5 rounded-lg border border-[#14B8A6] shadow-2xs flex items-center gap-1 transition cursor-pointer"
                      title="تصدير ملف PDF الشامل"
                    >
                      <span>PDF الشامل</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => service.downloadExport("excel", school, schedule, "all").catch((e) => setErrorMessage(e.message))}
                      className="bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-2xs flex items-center gap-1 transition cursor-pointer"
                      title="تصدير إكسيل ملون 4 صفحات"
                    >
                      <span>Excel ملون</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Responsive Timetable Controls Toolbar */}
              <div className="bg-[#FAFAF9] rounded-2xl border border-[#E7E5E4] p-2.5 space-y-2 text-xs">
                {/* Row 1: Search Bar & Horizontal Scroll Day Filter */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                  {/* Search Input (Wider to prevent placeholder truncation) */}
                  <div className="relative flex-1 min-w-[200px] max-w-full sm:max-w-sm">
                    <span className="absolute start-2.5 top-1/2 -translate-y-1/2 text-[#57534E] text-xs" aria-hidden="true">🔍</span>
                    <input
                      type="text"
                      value={timetableSearch}
                      onChange={(e) => setTimetableSearch(e.target.value)}
                      placeholder="بحث..."
                      className="w-full ps-8 pe-8 py-1.5 bg-[#FFFFFF] border border-[#D6D3D1] rounded-xl text-xs font-semibold text-[#1C1917] placeholder:font-normal placeholder:text-[#A8A29E] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                    />
                    {timetableSearch && (
                      <button
                        type="button"
                        onClick={() => setTimetableSearch("")}
                        className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs cursor-pointer"
                        title="مسح البحث"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Horizontal Scroll Day Filter (Smooth thumb navigation on mobile) */}
                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
                    <span className="text-[10px] text-slate-400 font-bold shrink-0">اليوم:</span>
                    <button
                      type="button"
                      onClick={() => setTimetableDayFilter(null)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition border shrink-0 cursor-pointer ${timetableDayFilter === null || !getOrderedSchoolDays(school).includes(timetableDayFilter)
                        ? "bg-[#0F766E] text-white border-[#0F766E] font-extrabold shadow-2xs"
                        : "bg-[#FFFFFF] text-[#57534E] border-[#E7E5E4] hover:bg-[#FAFAF9] hover:text-[#1C1917]"
                        }`}
                    >
                      الكل
                    </button>
                    {getOrderedSchoolDays(school).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setTimetableDayFilter(d)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition border shrink-0 cursor-pointer ${timetableDayFilter === d
                          ? "bg-[#0F766E] text-white border-[#0F766E] font-extrabold shadow-2xs"
                          : "bg-[#FFFFFF] text-[#57534E] border-[#E7E5E4] hover:bg-[#FAFAF9] hover:text-[#1C1917]"
                          }`}
                      >
                        {DAY_NAMES_AR[d]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Row 2: View Mode, Zoom Controls, and Display Options Toggle */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/70">
                  <div className="flex items-center gap-1.5">
                    {/* Master View Sub-Mode (Teachers vs Sections) */}
                    {viewMode === "master" && (
                      <div className="flex items-center gap-1 bg-white p-0.5 rounded-xl border border-slate-200">
                        <button
                          type="button"
                          onClick={() => setMasterRowMode("teachers")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${masterRowMode === "teachers" ? "bg-[#0F766E] text-white shadow-2xs" : "text-[#57534E] hover:text-[#1C1917]"
                            }`}
                        >
                          بالمعلمين
                        </button>
                        <button
                          type="button"
                          onClick={() => setMasterRowMode("sections")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${masterRowMode === "sections" ? "bg-[#0F766E] text-white shadow-2xs" : "text-[#57534E] hover:text-[#1C1917]"
                            }`}
                        >
                          بالفصول
                        </button>
                      </div>
                    )}

                    {/* Timetable Zoom Controls (Default lower zoom 85%) */}
                    <div className="flex items-center gap-1 bg-white p-0.5 rounded-xl border border-slate-200 shadow-2xs">
                      <span className="text-[10px] text-slate-400 px-1 font-bold">الزوم:</span>
                      <button
                        type="button"
                        onClick={() => setTimetableZoom((z) => Math.max(60, z - 10))}
                        disabled={timetableZoom <= 60}
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition cursor-pointer"
                        title="تصغير الجدول (-10%)"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() => setTimetableZoom(85)}
                        className="px-2 py-0.5 text-[11px] font-extrabold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg tabular-nums transition cursor-pointer"
                        title="إعادة التعيين للزوم الافتراضي (85%)"
                      >
                        {timetableZoom}%
                      </button>
                      <button
                        type="button"
                        onClick={() => setTimetableZoom((z) => Math.min(140, z + 10))}
                        disabled={timetableZoom >= 140}
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition cursor-pointer"
                        title="تكبير الجدول (+10%)"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Toggle button for extra display filters on mobile */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowMobileTableFilters(!showMobileTableFilters)}
                      className="md:hidden px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-[11px] font-bold transition flex items-center gap-1 cursor-pointer"
                    >
                      <span>⚙️</span>
                      <span>خيارات العرض</span>
                    </button>
                  </div>

                  {/* Desktop always visible / Mobile Collapsible Filters */}
                  <div className={`${showMobileTableFilters ? "flex" : "hidden"} md:flex flex-wrap items-center gap-2 w-full md:w-auto pt-1 md:pt-0`}>
                    {/* Color Mode Selector */}
                    <div className="flex items-center gap-1 bg-white p-0.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] text-slate-400 px-1 font-bold">التلوين:</span>
                      <button
                        type="button"
                        onClick={() => setColorMode("subject")}
                        className={`px-2 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer ${colorMode === "subject" ? "bg-indigo-600 text-white shadow-2xs" : "text-slate-600 hover:text-slate-900"
                          }`}
                        title="تلوين الحقول حسب المادة"
                      >
                        بالمواد
                      </button>
                      <button
                        type="button"
                        onClick={() => setColorMode("section")}
                        className={`px-2 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer ${colorMode === "section" ? "bg-indigo-600 text-white shadow-2xs" : "text-slate-600 hover:text-slate-900"
                          }`}
                        title="تلوين الحقول حسب الفصل"
                      >
                        بالفصول
                      </button>
                    </div>

                    {/* Density Selector */}
                    <div className="flex items-center gap-1 bg-white p-0.5 rounded-xl border border-slate-200">
                      <span className="text-[10px] text-slate-400 px-1 font-bold">الكثافة:</span>
                      <button
                        type="button"
                        onClick={() => setCellDensity("compact")}
                        className={`px-1.5 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer ${cellDensity === "compact" ? "bg-slate-900 text-white shadow-2xs" : "text-slate-600 hover:text-slate-900"
                          }`}
                      >
                        مدمج
                      </button>
                      <button
                        type="button"
                        onClick={() => setCellDensity("balanced")}
                        className={`px-1.5 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer ${cellDensity === "balanced" ? "bg-slate-900 text-white shadow-2xs" : "text-slate-600 hover:text-slate-900"
                          }`}
                      >
                        متوازن
                      </button>
                      <button
                        type="button"
                        onClick={() => setCellDensity("spacious")}
                        className={`px-1.5 py-1 rounded-lg text-[10.5px] font-bold transition cursor-pointer ${cellDensity === "spacious" ? "bg-slate-900 text-white shadow-2xs" : "text-slate-600 hover:text-slate-900"
                          }`}
                      >
                        موسع
                      </button>
                    </div>

                    {/* Double Period Merge Toggle (Zero-icon) */}
                    <button
                      type="button"
                      onClick={() => setMergeDoublePeriods(!mergeDoublePeriods)}
                      className={`px-2.5 py-1 rounded-xl text-[10.5px] font-bold transition border cursor-pointer ${mergeDoublePeriods
                        ? "bg-indigo-50 text-indigo-700 border-indigo-300 font-extrabold shadow-2xs"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      title="دمج الحصص المزدوجة المتتالية كمستطيل موحد بنص واحد متصل"
                    >
                      دمج المزدوجة {mergeDoublePeriods ? "✓" : ""}
                    </button>
                  </div>
                </div>
              </div>

              {(() => {
                const activeSchedule = pendingDiff ? pendingDiff.preview_schedule : schedule;
                if (!activeSchedule || !activeSchedule.entries || activeSchedule.entries.length === 0) return null;

                const densityConfig = {
                  compact: {
                    cellHeight: "h-[52px]",
                    cellMinHeight: "52px",
                    cellMinWidth: "78px",
                    masterMinWidth: "36px",
                    masterMinHeight: "34px",
                    primaryText: "text-[10px] font-extrabold",
                    secondaryText: "text-[9px] font-semibold",
                    badgeText: "text-[8.5px] px-1 py-0.2",
                    cellPadding: "p-1",
                  },
                  balanced: {
                    cellHeight: "h-[68px]",
                    cellMinHeight: "68px",
                    cellMinWidth: "98px",
                    masterMinWidth: "42px",
                    masterMinHeight: "40px",
                    primaryText: "text-[11.5px] font-extrabold",
                    secondaryText: "text-[10px] font-semibold",
                    badgeText: "text-[9px] px-1.5 py-0.5",
                    cellPadding: "p-1.5",
                  },
                  spacious: {
                    cellHeight: "h-[86px]",
                    cellMinHeight: "86px",
                    cellMinWidth: "118px",
                    masterMinWidth: "52px",
                    masterMinHeight: "48px",
                    primaryText: "text-xs font-black",
                    secondaryText: "text-[11px] font-bold",
                    badgeText: "text-[10px] px-2 py-0.5",
                    cellPadding: "p-2",
                  },
                }[cellDensity];

                const isCompactMasterTeachers = viewMode === "master" && masterRowMode === "teachers";
                const activeColMinWidth = isCompactMasterTeachers ? densityConfig.masterMinWidth : densityConfig.cellMinWidth;
                const activeCellMinHeight = isCompactMasterTeachers ? densityConfig.masterMinHeight : densityConfig.cellMinHeight;

                const orderedSchoolDays = getOrderedSchoolDays(school);
                const displayedDays =
                  timetableDayFilter !== null && orderedSchoolDays.includes(timetableDayFilter)
                    ? [timetableDayFilter]
                    : orderedSchoolDays;
                const getDayMaxPeriodsForDisplay = (d: number) => getDayMaxPeriods(school, d, activeSchedule?.entries);

                const isEntrySearchMatch = (entry: TimetableEntry) => {
                  const q = timetableSearch.trim().toLowerCase();
                  if (!q) return true;
                  const sub = getSubjectName(entry.subject_id).toLowerCase();
                  const sec = getSectionName(entry.section_id).toLowerCase();
                  const tch = getTeacherName(entry.teacher_id).toLowerCase();
                  return sub.includes(q) || sec.includes(q) || tch.includes(q);
                };

                const renderTimetableCell = (
                  entry: TimetableEntry | undefined,
                  isOff: boolean = false,
                  secondaryType: "section" | "teacher" = "section",
                  isDouble: boolean = false,
                  pairedEntry?: TimetableEntry,
                  compactSectionOnly: boolean = false
                ) => {
                  if (!entry) {
                    if (isOff) {
                      return (
                        <div className="w-full h-full rounded-lg bg-rose-50/80 border border-rose-200/90 flex items-center justify-center text-rose-700 font-extrabold text-[11px] shadow-2xs">
                          <span aria-label="إجازة رسمية" title="إجازة رسمية">---</span>
                        </div>
                      );
                    }
                    return (
                      <div className="w-full h-full rounded-xl border border-dashed border-slate-200/90 bg-slate-50/40 flex items-center justify-center text-slate-300 font-bold transition hover:bg-slate-100/70 hover:border-slate-300">
                        <span className="select-none text-xs">—</span>
                      </div>
                    );
                  }

                  const pal = getCellPalette(entry);
                  const isChangedCell =
                    pendingDiff?.changed_cell_keys.has(`${entry.section_id}_${entry.day}_${entry.period}`) ||
                    (pairedEntry && pendingDiff?.changed_cell_keys.has(`${pairedEntry.section_id}_${pairedEntry.day}_${pairedEntry.period}`));
                  const isSelectedForSwap =
                    selectedSwapEntry?.entry_id === entry.entry_id ||
                    (pairedEntry && selectedSwapEntry?.entry_id === pairedEntry.entry_id);
                  const isSelectedMergeCandidate = selectedMergeCandidate?.entry_id === entry.entry_id;
                  const isMergeEligible = Boolean(
                    selectedSwapEntry &&
                    !selectedSwapPairedEntry &&
                    !pairedEntry &&
                    entry.entry_id !== selectedSwapEntry.entry_id &&
                    checkCanMerge(selectedSwapEntry, entry)
                  );
                  const isMergedCard = Boolean(isDouble && pairedEntry);
                  const isMatch = isEntrySearchMatch(entry) || (pairedEntry && isEntrySearchMatch(pairedEntry));
                  const subjectName = getSubjectName(entry.subject_id);
                  const secObj = school.sections.find((s) => s.id === entry.section_id);
                  const gradeObj = secObj ? school.grades.find((g) => g.id === secObj.grade_id) : undefined;
                  const gradeLabel = gradeObj?.name || "";
                  const sectionCodeOnly = formatSection(getSectionCodeOnly(entry.section_id));
                  const secondaryLabel =
                    secondaryType === "section"
                      ? sectionCodeOnly
                      : getTeacherName(entry.teacher_id);
                  const periodRange = isDouble && pairedEntry ? `ح ${entry.period}-${pairedEntry.period}` : `ح ${entry.period}`;
                  const gradePrefix = gradeLabel ? `${gradeLabel} · ` : "";
                  const hoverTooltip = `${gradePrefix}فصل ${getSectionName(entry.section_id)} · ${subjectName} (${DAY_NAMES_AR[entry.day]} ${periodRange})${entry.is_pinned ? " [مثبت]" : ""} — انقر للمبادلة، كليك يمين للتثبيت`;

                  if (compactSectionOnly) {
                    return (
                      <div
                        onClick={() => handleCellSwapClick(entry, pairedEntry)}
                        onContextMenu={(ev) => {
                          ev.preventDefault();
                          togglePinEntry(entry, pairedEntry);
                        }}
                        className={`w-full h-full rounded-lg flex items-center justify-center font-black transition-all duration-150 cursor-pointer select-none relative border ${isChangedCell
                          ? "ring-2 ring-[#8B5CF6] border-dashed border-[#6D28D9] motion-safe:animate-pulse"
                          : isSelectedForSwap || isSelectedMergeCandidate
                            ? "ring-2 ring-[#0F766E] scale-[1.04] shadow-md z-20"
                            : isMergeEligible
                              ? "ring-2 ring-indigo-500 border-dashed animate-pulse z-20"
                              : !isMatch && timetableSearch
                                ? "opacity-25 grayscale-[60%]"
                                : isMatch && timetableSearch
                                  ? "ring-2 ring-[#0F766E] shadow-xs z-10"
                                  : "hover:brightness-95"
                          }`}
                        style={{
                          backgroundColor: isChangedCell ? (theme === "dark" ? "#2E1065" : "#EDE9FE") : pal.bg,
                          borderColor: entry.is_pinned ? "#0F766E" : isChangedCell ? "#8B5CF6" : isSelectedForSwap || isSelectedMergeCandidate ? "#0F766E" : isMergeEligible ? "#6366F1" : pal.border,
                          borderWidth: entry.is_pinned ? "2px" : "1px",
                          color: isChangedCell ? (theme === "dark" ? "#DDD6FE" : "#6D28D9") : pal.text,
                        }}
                        title={hoverTooltip}
                      >
                        <span className="text-[11px] font-black leading-none tracking-tight tabular-nums">
                          {sectionCodeOnly}
                        </span>
                        {entry.is_pinned && !isMergedCard && (
                          <span className="absolute top-0.5 end-0.5 w-1.5 h-1.5 rounded-full bg-[#0F766E]" aria-label="مثبت" />
                        )}
                        {isChangedCell && !isMergedCard && (
                          <span className="absolute bottom-0.5 end-0.5 w-1.5 h-1.5 rounded-full bg-[#6D28D9]" aria-label="معدل" />
                        )}
                      </div>
                    );
                  }

                  return (
                    <div
                      onClick={() => handleCellSwapClick(entry, pairedEntry)}
                      className={`w-full h-full rounded-xl flex flex-col justify-between transition-all duration-150 cursor-pointer select-none relative border shadow-2xs hover:shadow-md ${isChangedCell
                        ? "ring-2 ring-[#8B5CF6] border-dashed border-[#6D28D9] motion-safe:animate-pulse"
                        : isSelectedForSwap || isSelectedMergeCandidate
                          ? "ring-3 ring-[#0F766E] scale-[1.03] shadow-lg z-20"
                          : isMergeEligible
                            ? "ring-2 ring-indigo-500 border-dashed animate-pulse z-20"
                            : !isMatch && timetableSearch
                              ? "opacity-30 grayscale-[50%]"
                              : isMatch && timetableSearch
                                ? "ring-2 ring-[#0F766E] scale-[1.01] shadow-sm z-10"
                                : "hover:scale-[1.01]"
                        } ${densityConfig.cellPadding}`}
                      style={{
                        backgroundColor: isChangedCell ? (theme === "dark" ? "#2E1065" : "#EDE9FE") : pal.bg,
                        borderColor: isChangedCell ? "#8B5CF6" : isSelectedForSwap || isSelectedMergeCandidate ? "#0F766E" : isMergeEligible ? "#6366F1" : pal.border,
                        color: isChangedCell ? (theme === "dark" ? "#DDD6FE" : "#6D28D9") : pal.text,
                      }}
                      title={hoverTooltip}
                    >
                      {/* Top Header inside cell */}
                      <div className="flex items-center justify-between w-full gap-1">
                        <div className="flex items-center gap-1.5 leading-tight font-extrabold truncate">
                          {isDouble && pairedEntry ? (
                            <span className={`${densityConfig.primaryText} truncate tracking-tight`}>
                              {subjectName} <span className="text-[9.5px] font-bold opacity-75">(مزدوجة ح{entry.period}-{pairedEntry.period})</span>
                            </span>
                          ) : (
                            <span className={`${densityConfig.primaryText} truncate`}>{subjectName}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            togglePinEntry(entry, pairedEntry);
                          }}
                          title={
                            entry.is_pinned
                              ? "الحصة مثبّتة (انقر لإلغاء التثبيت)"
                              : "تثبيت الحصة لمنع تغييرها في إعادة التوليد"
                          }
                          className="shrink-0 cursor-pointer"
                        >
                          {entry.is_pinned ? (
                            <span className="text-[10px] font-black bg-[#0F766E] text-white px-1.5 py-0.2 rounded shadow-2xs">
                              مثبت
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-[#57534E] bg-[#FFFFFF]/80 px-1 py-0.2 rounded border border-[#E7E5E4] hover:text-[#1C1917] transition">
                              تثبيت
                            </span>
                          )}
                        </button>
                      </div>

                      {/* Bottom Footer inside cell */}
                      <div className="flex items-center justify-between w-full gap-1 mt-auto">
                        <span
                          className={`${densityConfig.badgeText} rounded-md font-bold truncate max-w-[75%] border border-black/5`}
                          style={{
                            backgroundColor: pal.badgeBg,
                            color: pal.badgeText,
                          }}
                        >
                          {secondaryLabel}
                        </span>

                        <div className="flex items-center gap-0.5 shrink-0">
                          {!isDouble && isDoublePeriod(entry, activeSchedule.entries) && (
                            <span
                              className="text-[8.5px] font-black bg-white/95 text-slate-800 px-1 py-0.2 rounded border border-slate-300 shadow-2xs"
                              title="حصة مزدوجة متصلة"
                            >
                              مزدوجة
                            </span>
                          )}
                          {isChangedCell && (
                            <span className="bg-[#6D28D9] text-white text-[10px] px-1.5 py-0.2 rounded font-extrabold" aria-label="حصة معدلة">
                              معدل
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                };

                return (
                  <div className={isTimetableFullscreen ? "fixed inset-0 z-50 bg-white p-4 sm:p-6 overflow-auto shadow-2xl flex flex-col space-y-4" : "space-y-4"}>
                    {/* Fullscreen Header Bar */}
                    {isTimetableFullscreen && (
                      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                        <div className="flex items-center gap-2.5">
                          <h2 className="font-extrabold text-base sm:text-lg text-slate-900">{school.name}</h2>
                          <span className="bg-blue-100 text-blue-900 text-xs font-extrabold px-2 py-0.5 rounded-lg">
                            {viewMode === "master" ? "الجدول العام" : viewMode === "section" ? "الفصول" : "المعلمون"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsTimetableFullscreen(false)}
                          className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <span>✕</span>
                          <span>إنهاء التكبير</span>
                        </button>
                      </div>
                    )}

                    {/* Compact Diff Preview Controls directly above timetable */}
                    {pendingDiff && (
                      <TimetableDiffPreview
                        diff={pendingDiff}
                        onApply={() => {
                          const candidate = pendingDiff.preview_schedule;
                          setSchedule(candidate);
                          if (school) {
                            persistSchoolData(school, undefined, candidate);
                          }
                          setPendingDiff(null);
                          setStatusMessage("✅ تم تطبيق كافة التعديلات على الجدول بنجاح!");
                        }}
                        onDiscard={() => {
                          setPendingDiff(null);
                          setStatusMessage("↩️ تم إلغاء معاينة التعديلات والاحتفاظ بالجدول السابق دون تغيير.");
                        }}
                      />
                    )}

                    {/* Master View */}
                    {viewMode === "master" && (
                      <div className="space-y-3">
                        <div className="overflow-x-auto border border-slate-300 rounded-2xl shadow-xs max-h-[700px] timetable-scroll w-full">
                          <table className="w-full text-[11px] border-collapse bg-white" style={{ zoom: `${timetableZoom}%` }}>
                            <thead>
                              {/* Day Group Header */}
                              <tr className="bg-slate-900 text-white">
                                <th
                                  rowSpan={2}
                                  className="sticky start-0 z-30 bg-slate-900 text-white p-3 text-start font-extrabold text-xs min-w-[115px] border-b border-e border-slate-700 shadow-[3px_0_8px_rgba(0,0,0,0.18)]"
                                >
                                  {masterRowMode === "teachers" ? "المعلم / اليوم" : "الفصل / اليوم"}
                                </th>
                                {displayedDays.map((d) => {
                                  const dayPeriods = getDayMaxPeriodsForDisplay(d);
                                  return (
                                    <th
                                      key={d}
                                      colSpan={dayPeriods}
                                      className="bg-slate-900 text-white p-2 text-center font-extrabold text-xs border-b border-l border-slate-700 whitespace-nowrap"
                                    >
                                      {DAY_NAMES_AR[d]} ({dayPeriods} حصص)
                                    </th>
                                  );
                                })}
                              </tr>
                              {/* Periods Sub-Header */}
                              <tr className="bg-slate-800 text-slate-200">
                                {displayedDays.map((d) => {
                                  const dayPeriods = getDayMaxPeriodsForDisplay(d);
                                  return Array.from({ length: dayPeriods }, (_, i) => i + 1).map((p) => (
                                    <th
                                      key={`h-${d}-${p}`}
                                      className="bg-slate-800 text-slate-200 p-1.5 text-center font-extrabold text-[10.5px] border-b border-l border-slate-700 whitespace-nowrap"
                                      style={{ minWidth: activeColMinWidth }}
                                    >
                                      ح {p}
                                    </th>
                                  ));
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {masterRowMode === "teachers"
                                ? school.teachers.map((tch) => {
                                  const teacherEntriesCount = activeSchedule.entries.filter((e) => e.teacher_id === tch.id).length;
                                  return (
                                    <tr key={tch.id} className="hover:bg-slate-50/70 transition-colors">
                                      <td className="sticky start-0 z-20 bg-white px-2.5 py-1.5 text-start border-b border-e border-slate-300 shadow-[3px_0_8px_rgba(0,0,0,0.06)] min-w-[115px]">
                                        <div className="font-extrabold text-xs text-slate-900 leading-tight">
                                          {tch.name}
                                        </div>
                                        <div className="text-[10px] text-slate-500 font-bold mt-0.5">
                                          {teacherEntriesCount} حصة
                                        </div>
                                      </td>
                                      {displayedDays.map((d) => {
                                        const dayPeriods = getDayMaxPeriodsForDisplay(d);
                                        const isOff = tch.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF";
                                        const consumedPeriods = new Set<number>();

                                        return Array.from({ length: dayPeriods }, (_, i) => i + 1).map((p) => {
                                          if (consumedPeriods.has(p)) return null;

                                          const entry = activeSchedule.entries.find(
                                            (e) => e.teacher_id === tch.id && e.day === d && e.period === p
                                          );

                                          let isDoubleStart = false;
                                          let pairedEntry: TimetableEntry | undefined = undefined;

                                          if (entry) {
                                            const nextP = p + 1;
                                            if (nextP <= dayPeriods) {
                                              const next = activeSchedule.entries.find(
                                                (e) =>
                                                  e.teacher_id === tch.id &&
                                                  e.day === d &&
                                                  e.period === nextP &&
                                                  e.section_id === entry.section_id
                                              );
                                              if (next && shouldMergePair(entry, next)) {
                                                isDoubleStart = true;
                                                pairedEntry = next;
                                                consumedPeriods.add(nextP);
                                              }
                                            }
                                          }

                                          return (
                                            <td
                                              key={`${tch.id}-${d}-${p}`}
                                              colSpan={isDoubleStart ? 2 : 1}
                                              className="p-0.5 border-b border-l border-slate-200 text-center align-middle"
                                              style={{
                                                minWidth: isDoubleStart
                                                  ? `calc(${activeColMinWidth} * 2)`
                                                  : activeColMinWidth,
                                                height: activeCellMinHeight,
                                              }}
                                            >
                                              {renderTimetableCell(entry, isOff, "section", isDoubleStart, pairedEntry, true)}
                                            </td>
                                          );
                                        });
                                      })}
                                    </tr>
                                  );
                                })
                                : school.sections.map((sec) => {
                                  const secEntriesCount = activeSchedule.entries.filter((e) => e.section_id === sec.id).length;
                                  return (
                                    <tr key={sec.id} className="hover:bg-slate-50/70 transition-colors">
                                      <td className="sticky start-0 z-20 bg-white p-2.5 text-start border-b border-e border-slate-300 shadow-[3px_0_8px_rgba(0,0,0,0.06)] min-w-[140px]">
                                        <div className="font-extrabold text-xs text-slate-900 leading-tight">
                                          {formatSection(sec.name)}
                                        </div>
                                        <div className="text-[10px] text-slate-500 font-bold mt-1">
                                          {secEntriesCount} حصة أسبوعياً
                                        </div>
                                      </td>
                                      {displayedDays.map((d) => {
                                        const dayMaxPeriods = getDayMaxPeriodsForDisplay(d);
                                          const dayPeriods = getSectionDayPeriods(school, sec, d);
                                          const consumedPeriods = new Set<number>();

                                          return Array.from({ length: dayMaxPeriods }, (_, i) => i + 1).map((p) => {
                                            if (consumedPeriods.has(p)) return null;
                                            if (p > dayPeriods) {
                                              return (
                                                <td
                                                  key={`${sec.id}-${d}-${p}`}
                                                  className="p-1 border-b border-l border-slate-200 text-center bg-slate-100/60 text-slate-300 font-bold"
                                                  style={{ minWidth: densityConfig.cellMinWidth, height: densityConfig.cellMinHeight }}
                                                >
                                                  —
                                                </td>
                                              );
                                            }

                                          const entry = activeSchedule.entries.find(
                                            (e) => e.section_id === sec.id && e.day === d && e.period === p
                                          );

                                          let isDoubleStart = false;
                                          let pairedEntry: TimetableEntry | undefined = undefined;

                                          if (entry) {
                                            const nextP = p + 1;
                                            if (nextP <= dayPeriods) {
                                              const next = activeSchedule.entries.find(
                                                (e) =>
                                                  e.section_id === sec.id &&
                                                  e.day === d &&
                                                  e.period === nextP &&
                                                  e.teacher_id === entry.teacher_id
                                              );
                                              if (next && shouldMergePair(entry, next)) {
                                                isDoubleStart = true;
                                                pairedEntry = next;
                                                consumedPeriods.add(nextP);
                                              }
                                            }
                                          }

                                          return (
                                            <td
                                              key={`${sec.id}-${d}-${p}`}
                                              colSpan={isDoubleStart ? 2 : 1}
                                              className="p-1 border-b border-l border-slate-200 text-center align-middle"
                                              style={{
                                                minWidth: isDoubleStart
                                                  ? `calc(${densityConfig.cellMinWidth} * 2)`
                                                  : densityConfig.cellMinWidth,
                                                height: densityConfig.cellMinHeight,
                                              }}
                                            >
                                              {renderTimetableCell(entry, false, "teacher", isDoubleStart, pairedEntry)}
                                            </td>
                                          );
                                        });
                                      })}
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Section Timetable View */}
                    {viewMode === "section" && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-800">اختر الفصل:</span>
                            <select
                              value={selectedSectionId}
                              onChange={(e) => setSelectedSectionId(e.target.value)}
                              className="border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-extrabold bg-white shadow-2xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            >
                              {school.sections.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <span className="text-xs font-extrabold text-slate-600 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                            جدول الفصل ({formatSection((school.sections.find((s) => s.id === selectedSectionId) || school.sections[0])?.name || "")})
                          </span>
                        </div>

                        {(() => {
                          const sec = school.sections.find((s) => s.id === selectedSectionId) || school.sections[0];
                          if (!sec) return null;
                          const maxP = Math.max(
                            ...displayedDays.map((d) => getSectionDayPeriods(school, sec, d))
                          );

                          // Build section subject summary
                          const secEntries = activeSchedule.entries.filter((e) => e.section_id === sec.id);
                          const subjectCounts: Record<string, number> = {};
                          for (const e of secEntries) {
                            subjectCounts[e.subject_id] = (subjectCounts[e.subject_id] || 0) + 1;
                          }
                          const summaryList = Object.entries(subjectCounts).map(([subId, cnt]) => ({
                            subId,
                            subName: getSubjectName(subId),
                            count: cnt,
                          }));

                          return (
                            <div className="space-y-4">
                              <div className="overflow-x-auto border border-slate-300 rounded-2xl shadow-xs timetable-scroll w-full">
                                <table className="w-full text-xs border-collapse bg-white" style={{ zoom: `${timetableZoom}%` }}>
                                  <thead>
                                    <tr className="bg-slate-900 text-white">
                                      <th className="p-3 text-start font-extrabold w-28 sm:w-32 border-b border-e border-slate-700">اليوم / الحصة</th>
                                      {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
                                        <th key={p} className="p-2 text-center font-extrabold border-b border-l border-slate-700">
                                          الحصة {p}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {displayedDays.map((d) => {
                                      const limit = getSectionDayPeriods(school, sec, d);
                                      const consumedPeriods = new Set<number>();

                                      return (
                                        <tr key={d} className="border-b hover:bg-slate-50/50 transition-colors">
                                          <td className="p-3 bg-slate-50 font-black border-e border-slate-300 text-start text-slate-800">
                                            {DAY_NAMES_AR[d]}
                                          </td>
                                          {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => {
                                            if (consumedPeriods.has(p)) return null;

                                            if (p > limit) {
                                              return (
                                                <td key={p} className="p-1.5 border-l border-slate-200 text-center bg-slate-100/60 text-slate-400 font-bold">
                                                  —
                                                </td>
                                              );
                                            }
                                            const entry = activeSchedule.entries.find(
                                              (e) => e.section_id === sec.id && e.day === d && e.period === p
                                            );

                                            let isDoubleStart = false;
                                            let pairedEntry: TimetableEntry | undefined = undefined;

                                            if (entry) {
                                              const nextP = p + 1;
                                              if (nextP <= limit) {
                                                const next = activeSchedule.entries.find(
                                                  (e) =>
                                                    e.section_id === sec.id &&
                                                    e.day === d &&
                                                    e.period === nextP &&
                                                    e.teacher_id === entry.teacher_id
                                                );
                                                if (next && shouldMergePair(entry, next)) {
                                                  isDoubleStart = true;
                                                  pairedEntry = next;
                                                  consumedPeriods.add(nextP);
                                                }
                                              }
                                            }

                                            return (
                                              <td
                                                key={p}
                                                colSpan={isDoubleStart ? 2 : 1}
                                                className="p-1.5 border-l border-slate-200 text-center"
                                                style={{
                                                  height: densityConfig.cellMinHeight,
                                                  minWidth: isDoubleStart
                                                    ? `calc(${densityConfig.cellMinWidth} * 2)`
                                                    : densityConfig.cellMinWidth,
                                                }}
                                              >
                                                {renderTimetableCell(entry, false, "teacher", isDoubleStart, pairedEntry)}
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>

                              {/* Section Subjects Summary Strip */}
                              {summaryList.length > 0 && (
                                <div className="p-3.5 bg-slate-50/90 rounded-2xl border border-slate-200 space-y-2">
                                  <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                                    <span>📊</span>
                                    <span>توزيع مواد الفصل:</span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {summaryList.map((item) => {
                                      const pal = adaptCellPalette(getSubjectPalette(item.subName), theme === "dark");
                                      return (
                                        <span
                                          key={item.subId}
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold border shadow-2xs"
                                          style={{
                                            backgroundColor: pal.bg,
                                            borderColor: pal.border,
                                            color: pal.text,
                                          }}
                                        >
                                          <span>{pal.icon}</span>
                                          <span>{item.subName}:</span>
                                          <span className="font-black tabular-nums">{item.count} حصص</span>
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Teacher Timetable View */}
                    {viewMode === "teacher" && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-800">اختر المعلم:</span>
                            <select
                              value={selectedTeacherId}
                              onChange={(e) => setSelectedTeacherId(e.target.value)}
                              className="border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-extrabold bg-white shadow-2xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            >
                              {school.teachers.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <span className="text-xs font-extrabold text-slate-600 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                            جدول المعلم ({(school.teachers.find((t) => t.id === selectedTeacherId) || school.teachers[0])?.name || ""})
                          </span>
                        </div>

                        {(() => {
                          const tch = school.teachers.find((t) => t.id === selectedTeacherId) || school.teachers[0];
                          if (!tch) return null;
                          const maxP = Math.max(
                            ...displayedDays.map((d) => getTeacherDayPeriods(school, tch.id, d, activeSchedule?.entries))
                          );

                          const teacherEntries = activeSchedule.entries.filter((e) => e.teacher_id === tch.id);
                          const quota = tch.max_weekly_periods || teacherEntries.length;
                          const completionPct = quota > 0 ? Math.round((teacherEntries.length / quota) * 100) : 100;

                          return (
                            <div className="space-y-4">
                              <div className="overflow-x-auto border border-slate-300 rounded-2xl shadow-xs timetable-scroll w-full">
                                <table className="w-full text-xs border-collapse bg-white" style={{ zoom: `${timetableZoom}%` }}>
                                  <thead>
                                    <tr className="bg-slate-900 text-white">
                                      <th className="p-3 text-start font-extrabold w-28 sm:w-32 border-b border-e border-slate-700">اليوم / الحصة</th>
                                      {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
                                        <th key={p} className="p-2 text-center font-extrabold border-b border-l border-slate-700">
                                          الحصة {p}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {displayedDays.map((d) => {
                                      const isOff = tch.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF";
                                      const count = getTeacherDayPeriods(school, tch.id, d, activeSchedule?.entries);
                                      const consumedPeriods = new Set<number>();

                                      return (
                                        <tr key={d} className="border-b hover:bg-slate-50/50 transition-colors">
                                          <td className="p-3 bg-slate-50 font-black border-e border-slate-300 text-start text-slate-800">
                                            {DAY_NAMES_AR[d]}
                                          </td>
                                          {isOff ? (
                                            <td colSpan={maxP} className="p-3 border-l border-slate-200 text-center bg-rose-50/90 text-rose-700 font-extrabold">
                                              إجازة تفرغ أسبوعية معتمدة
                                            </td>
                                          ) : (
                                            Array.from({ length: maxP }, (_, i) => i + 1).map((p) => {
                                              if (consumedPeriods.has(p)) return null;

                                              if (p > count) {
                                                return (
                                                  <td key={p} className="p-1.5 border-l border-slate-200 text-center bg-slate-100/60 text-slate-400 font-bold">
                                                    —
                                                  </td>
                                                );
                                              }
                                              const entry = activeSchedule.entries.find(
                                                (e) => e.teacher_id === tch.id && e.day === d && e.period === p
                                              );

                                              let isDoubleStart = false;
                                              let pairedEntry: TimetableEntry | undefined = undefined;

                                              if (entry) {
                                                const nextP = p + 1;
                                                if (nextP <= count) {
                                                  const next = activeSchedule.entries.find(
                                                    (e) =>
                                                      e.teacher_id === tch.id &&
                                                      e.day === d &&
                                                      e.period === nextP &&
                                                      e.section_id === entry.section_id
                                                  );
                                                  if (next && shouldMergePair(entry, next)) {
                                                    isDoubleStart = true;
                                                    pairedEntry = next;
                                                    consumedPeriods.add(nextP);
                                                  }
                                                }
                                              }

                                              return (
                                                <td
                                                  key={p}
                                                  colSpan={isDoubleStart ? 2 : 1}
                                                  className="p-1.5 border-l border-slate-200 text-center"
                                                  style={{
                                                    height: densityConfig.cellMinHeight,
                                                    minWidth: isDoubleStart
                                                      ? `calc(${densityConfig.cellMinWidth} * 2)`
                                                      : densityConfig.cellMinWidth,
                                                  }}
                                                >
                                                  {renderTimetableCell(entry, false, "section", isDoubleStart, pairedEntry)}
                                                </td>
                                              );
                                            })
                                          )}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>

                              {/* Teacher Workload Summary Card */}
                              <div className="p-3.5 bg-slate-50/90 rounded-2xl border border-slate-200 space-y-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-base">👨‍🏫</span>
                                    <span className="font-extrabold text-sm text-slate-900">{tch.name}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs font-bold">
                                    <span className="text-slate-600">النصاب:</span>
                                    <span className="text-blue-700 font-black tabular-nums">{teacherEntries.length} / {quota} حصة</span>
                                    <span className="bg-emerald-100 text-emerald-800 text-[11px] font-black px-2 py-0.5 rounded-lg">
                                      {completionPct}% اكتمال
                                    </span>
                                  </div>
                                </div>

                                {/* Progress Bar */}
                                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                                  <div
                                    className="bg-gradient-to-r from-blue-600 to-indigo-600 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.min(100, completionPct)}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </main>
      </div>

      {/* Executive Footer: Copyright & Creator Contact */}
      <footer className="max-w-[1850px] mx-auto px-4 sm:px-6 pb-20 lg:pb-4 pt-1">
        <div className="bg-[#FFFFFF] border border-[#E7E5E4] rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#57534E]">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="font-bold text-[#1C1917]"
              style={{ fontFamily: "'Readex Pro', 'Cairo', sans-serif" }}
            >
              جدول AI
            </span>
            <span aria-hidden="true">·</span>
            <span>© {new Date().getFullYear()} جميع الحقوق محفوظة</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span>تطوير ودعم منشئ المشروع:</span>
            <a
              href="https://wa.me/201039659917"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-[#CCFBF1]/70 hover:bg-[#CCFBF1] text-[#0F766E] border border-[#14B8A6]/45 font-extrabold px-3 py-1 rounded-xl transition"
            >
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12.031 2c-5.516 0-9.969 4.453-9.969 9.969 0 1.766.469 3.484 1.344 5l-1.406 5.156 5.281-1.375c1.469.797 3.109 1.219 4.75 1.219 5.516 0 9.969-4.453 9.969-9.969s-4.453-10-9.969-10zm5.828 14.125c-.25.703-1.438 1.344-1.984 1.422-.531.078-1.203.109-1.938-.125-.453-.141-1.031-.344-1.766-.656-3.094-1.328-5.109-4.453-5.266-4.656-.156-.203-1.266-1.688-1.266-3.219s.797-2.281 1.078-2.594c.281-.313.625-.391.828-.391.203 0 .406.016.594.016.188 0 .453-.078.703.531.25.609.859 2.094.938 2.25.078.156.125.344.031.547-.094.203-.141.328-.281.5-.141.172-.297.391-.422.516-.141.141-.281.297-.125.578.156.281.703 1.156 1.516 1.875 1.047.922 1.922 1.219 2.203 1.359.281.141.438.109.609-.078.172-.188.703-.828.891-1.109.188-.281.375-.234.625-.141.25.094 1.609.75 1.891.891.281.141.469.203.531.328.063.125.063.719-.188 1.422z" />
              </svg>
              <span>واتساب:</span>
              <span dir="ltr" className="tabular-nums">01039659917</span>
            </a>
          </div>
        </div>
      </footer>

      {/* Sleek Floating Mobile AI Assistant Pill (< lg only) */}
      {!isMobileSheetOpen && (
        <div className="lg:hidden fixed bottom-4 end-4 z-40">
          <button
            type="button"
            onClick={() => setIsMobileSheetOpen(true)}
            aria-label="وكيل الجداول الذكي (طلب تعديل بالعامية)"
            title="وكيل الجداول الذكي (طلب تعديل بالعامية)"
            className="group min-h-[46px] h-12 ps-2 pe-3.5 rounded-full bg-[#1C1917] hover:bg-[#292524] active:scale-95 text-white border border-white/15 dark:border-[#14B8A6]/45 shadow-[0_12px_28px_-6px_rgba(28,25,23,0.45),0_4px_12px_rgba(15,118,110,0.28)] dark:shadow-[0_12px_28px_-6px_rgba(0,0,0,0.8),0_0_0_1px_rgba(20,184,166,0.25)] flex items-center gap-2.5 transition-all duration-200 cursor-pointer"
          >
            <span className="relative w-8 h-8 rounded-full bg-gradient-to-br from-[#0F766E] via-[#0D9488] to-[#6D28D9] flex items-center justify-center shrink-0 ring-1 ring-white/25" aria-hidden="true">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11 2L13.09 8.26L19 10.5L13.09 12.74L11 19L8.91 12.74L3 10.5L8.91 8.26L11 2ZM19 14L20.05 16.95L23 18L20.05 19.05L19 22L17.95 19.05L15 18L17.95 16.95L19 14Z" />
              </svg>
              <span
                className={`absolute -top-0.5 -end-0.5 w-2.5 h-2.5 rounded-full bg-[#10B981] ring-2 ring-[#1C1917] ${isChatSubmitting ? "animate-pulse" : ""}`}
              />
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-[13px] font-extrabold tracking-tight text-white">المساعد الذكي</span>
              <span
                dir="ltr"
                className="text-[10px] font-black tracking-wider px-1.5 py-0.5 rounded-full bg-[#EDE9FE] text-[#5B21B6] leading-none"
              >
                AI
              </span>
            </span>
          </button>
        </div>
      )}

      {isMobileSheetOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex flex-col justify-end bg-[#1C1917]/65"
          role="dialog"
          aria-modal="true"
          aria-label="وكيل الجداول الذكي"
        >
          <div className="bg-[#FFFFFF] rounded-t-3xl shadow-2xl max-h-[88vh] h-[82vh] flex flex-col overflow-hidden border-t border-[#E7E5E4] w-full">
            <button
              type="button"
              className="p-2.5 flex justify-center bg-[#FAFAF9] border-b border-[#E7E5E4] cursor-pointer hover:bg-[#E7E5E4] transition"
              onClick={() => setIsMobileSheetOpen(false)}
              title="إغلاق وطي المحادثة"
              aria-label="إغلاق المحادثة"
            >
              <div className="w-12 h-1.5 bg-[#57534E]/50 rounded-full" />
            </button>
            <div className="flex-1 min-h-0 flex flex-col">
              {renderChatPanelContent(true)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
