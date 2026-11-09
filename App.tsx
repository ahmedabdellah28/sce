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
import { DAY_NAMES_AR, type SchoolData, type Schedule, type AnalysisReport, type TimetableEntry } from "./types.ts";

export interface SavedSchoolEntry {
  id: string;
  name: string;
  school: SchoolData;
  raw_text: string;
  schedule?: Schedule | null;
  analysis?: AnalysisReport | null;
}

const SECTION_PALETTE = [
  { bg: "#DBEAFE", border: "#93C5FD", text: "#1E3A8A" },
  { bg: "#D1FAE5", border: "#6EE7B7", text: "#065F46" },
  { bg: "#FEF3C7", border: "#FCD34D", text: "#92400E" },
  { bg: "#EDE9FE", border: "#C4B5FD", text: "#5B21B6" },
  { bg: "#FFE4E6", border: "#FDA4AF", text: "#9F1239" },
  { bg: "#E0F2FE", border: "#7DD3FC", text: "#075985" },
  { bg: "#FCE7F3", border: "#F9A8D4", text: "#831843" },
  { bg: "#ECFCCB", border: "#BEF264", text: "#3F6212" },
  { bg: "#FFEDD5", border: "#FDBA74", text: "#9A3412" },
  { bg: "#F3E8FF", border: "#D8B4FE", text: "#6B21A8" },
];

export default function App() {
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
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
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
  const [pendingDiff, setPendingDiff] = useState<TimetableDiffReport | null>(null);

  const togglePinEntry = (entry: TimetableEntry) => {
    setSchedule((prev) => {
      if (!prev) return prev;
      const nextEntries = prev.entries.map((e) =>
        e.entry_id === entry.entry_id ? { ...e, is_pinned: !e.is_pinned } : e
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
  const [chatHistory, setChatHistory] = useState<
    Array<{
      role: "user" | "ai";
      text: string;
      changes?: string[];
      isError?: boolean;
      retryPrompt?: string;
      timestamp?: string;
    }>
  >([
    {
      role: "ai",
      text: "مرحباً بك! أنا وكيل الجداول المدرسية الذكي المستقل (Autonomous School Timetable Agent).\n\nأدِر بيانات المدرسة مباشرة: اطلب مني إعطاء إجازة لمعلم، تعديل أنصبة الحصص، أو تثبيت حصص أولى وأخيرة، وسأقوم فوراً بتحديث وثيقة المدرسة (.md)، وتحديث هيكل البيانات، وإعادة إنشاء الجدول تلقائياً بضمان 0% تعارضات.",
      timestamp: "الآن",
    },
  ]);

  const [isLiveActive, setIsLiveActive] = useState(false);
  const liveSessionRef = React.useRef<{
    sendAudio: (b64: string) => void;
    sendText: (t: string) => void;
    close: () => void;
  } | null>(null);
  const audioContextRef = React.useRef<{ input?: AudioContext; output?: AudioContext } | null>(null);

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
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
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
      } catch {}
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const toggleChatCollapse = () => {
    setIsChatCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("AI_STUDIO_CHAT_COLLAPSED", String(next));
      } catch {}
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
      setSelectedPreset(presetId);
      localStorage.setItem("AI_STUDIO_ACTIVE_SCHOOL_ID", presetId);
      const nowStr = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
      setLastUpdatedTime(nowStr);
      const localFound = savedSchools.find((s) => s.id === presetId);
      if (localFound) {
        setSchool(localFound.school);
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

      if (newSchoolType === "preset" && selectedPresetObj) {
        createdSchool = createSchoolFromPreset(selectedPresetObj.id, {
          schoolName: name,
          sectionsPerGrade: 1,
        });
        createdRawText = generateSchoolMarkdown(createdSchool);
      } else if (newSchoolType === "ai" && newSchoolAiPrompt.trim()) {
        setStatusMessage("جاري إنشاء وتوليد المدرسة بواسطة الذكاء الاصطناعي...");
        const aiRes = await service.parseRawText(newSchoolAiPrompt);
        createdSchool = {
          ...aiRes.school,
          id: "sch_" + Date.now().toString(36),
          name: name || aiRes.school.name || "مدرسة جديدة",
        };
        createdRawText = newSchoolAiPrompt;
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
      setStatusMessage(`تم إنشاء "${createdSchool.name}" بنجاح! يمكنك الآن تعديل قيودها أو إنشاء جدولها مباشرة.`);
      setActiveTab("ingest");

      setChatHistory((prev) => [
        ...prev,
        {
          role: "ai",
          text: `تم إنشاء المدرسة الجديدة "${createdSchool.name}" بنجاح! تحتوي على ${createdSchool.sections.length} فصول و ${createdSchool.teachers.length} معلماً. اطلب مني أي تعديل أو اضغط على (إنشاء الجدول الآن).`,
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
      setActiveTab("analyze");
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

  async function handleSendChat(customPrompt?: string) {
    const msg = (customPrompt ?? chatInput).trim();
    if (!msg) return;
    if (!customPrompt) setChatInput("");
    const activeSchool = school || createBlankSchoolTemplate("مدرسة جديدة", 7).school;
    const activeRawText = rawText || createBlankSchoolTemplate("مدرسة جديدة", 7).raw_text;
    const nowTime = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    setChatHistory((prev) => [...prev, { role: "user", text: msg, timestamp: nowTime }]);
    setIsChatSubmitting(true);
    setChatLoadingStep(1);
    setLoading(true);
    try {
      const res = await service.chatWithCopilot(msg, activeSchool, schedule, activeRawText, chatHistory);
      setChatLoadingStep(2);
      if (res.updated_markdown) setRawText(res.updated_markdown);
      const targetSchool = res.updated_school || activeSchool;
      if (res.updated_school) {
        setSchool(res.updated_school);
        if (res.updated_school.name !== school.name || res.updated_school.id !== school.id) {
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
      setChatHistory((prev) => [
        ...prev,
        {
          role: "ai",
          text: res.reply,
          changes: res.applied_changes,
          timestamp: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      if (res.should_solve && targetSchool) {
        setChatLoadingStep(3);
        const diffReport = dryRunMinimalChange(activeSchool, schedule, targetSchool);
        setPendingDiff(diffReport);
        setActiveTab("timetable");
        setStatusMessage(
          `تم احتساب التعديلات بأقل تغيير بنجاح! تم الحفاظ على ${diffReport.unchanged_count} حصة ثابتة، و ${diffReport.total_changes} حصة معدلة معروضة للمعاينة.`
        );
      } else if (targetSchool) {
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

  async function toggleLiveVoice() {
    if (isLiveActive) {
      liveSessionRef.current?.close();
      liveSessionRef.current = null;
      if (audioContextRef.current?.input) audioContextRef.current.input.close().catch(() => {});
      if (audioContextRef.current?.output) audioContextRef.current.output.close().catch(() => {});
      audioContextRef.current = null;
      setIsLiveActive(false);
      setChatHistory((prev) => [
        ...prev,
        { role: "ai", text: "تم إنهاء جلسة المحادثة الصوتية المباشرة (Gemini Live API)." },
      ]);
      return;
    }

    try {
      const outputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });
      let nextStartTime = outputAudioCtx.currentTime;

      function playAudioChunk(base64Data: string) {
        try {
          const binaryString = atob(base64Data);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const pcm16 = new Int16Array(bytes.buffer);
          const float32 = new Float32Array(pcm16.length);
          for (let i = 0; i < pcm16.length; i++) {
            float32[i] = pcm16[i] / 32768.0;
          }
          const buffer = outputAudioCtx.createBuffer(1, float32.length, 24000);
          buffer.copyToChannel(float32, 0);
          const source = outputAudioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(outputAudioCtx.destination);
          const startTime = Math.max(outputAudioCtx.currentTime, nextStartTime);
          source.start(startTime);
          nextStartTime = startTime + buffer.duration;
        } catch (e) {
          console.warn("Playback error:", e);
        }
      }

      const session = service.connectLiveSession({
        onOpen: () => {
          setIsLiveActive(true);
          setChatHistory((prev) => [
            ...prev,
            {
              role: "ai",
              text: "🎙️ بدأت المحادثة الصوتية المباشرة مع Gemini Live API! تحدث الآن عبر الميكروفون.",
            },
          ]);
        },
        onAudioChunk: (b64) => {
          playAudioChunk(b64);
        },
        onInterrupted: () => {
          nextStartTime = outputAudioCtx.currentTime;
        },
        onError: (err) => {
          console.warn("Live error:", err);
          setIsLiveActive(false);
        },
        onClose: () => {
          setIsLiveActive(false);
        },
      });
      liveSessionRef.current = session;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const inputAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      const sourceNode = inputAudioCtx.createMediaStreamSource(stream);
      const processor = inputAudioCtx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!liveSessionRef.current) return;
        const channelData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(channelData.length);
        for (let i = 0; i < channelData.length; i++) {
          const s = Math.max(-1, Math.min(1, channelData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        session.sendAudio(base64);
      };

      sourceNode.connect(processor);
      processor.connect(inputAudioCtx.destination);
      audioContextRef.current = { input: inputAudioCtx, output: outputAudioCtx };
    } catch (err: any) {
      setErrorMessage("تعذر بدء جلسة الصوت: " + (err.message || String(err)));
      setIsLiveActive(false);
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
  const formatSection = (name: string) => (
    <span dir="ltr" className="inline-block font-extrabold">
      {name}
    </span>
  );
  function getSectionPalette(sectionId: string) {
    if (!school) return SECTION_PALETTE[0];
    const idx = school.sections.findIndex((s) => s.id === sectionId);
    return SECTION_PALETTE[(idx >= 0 ? idx : 0) % SECTION_PALETTE.length];
  }

  const activeConstraintTeacher = useMemo(
    () => school?.teachers.find((t) => t.id === selectedConstraintTeacherId) || null,
    [school, selectedConstraintTeacherId]
  );

  const renderChatPanelContent = (isMobile: boolean = false) => (
    <div className="bg-white rounded-2xl border border-slate-300 shadow-sm flex flex-col h-full overflow-hidden">
      {/* Fixed Header */}
      <div className="bg-slate-900 text-white p-3.5 rounded-t-2xl flex items-center justify-between shrink-0 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-base shadow-xs shrink-0">
            🤖
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="font-extrabold text-xs tracking-tight text-white truncate">وكيل الجداول الذكي</h3>
              <span className="text-[9px] bg-emerald-500/20 text-emerald-400 font-bold px-1.5 py-0.5 rounded border border-emerald-500/30 shrink-0">
                نشط
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5 font-medium truncate">تعديل القيود والإجازات بالعامية المصرية والخليجية</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() =>
              setChatHistory([
                {
                  role: "ai",
                  text: "مرحباً بك! أنا وكيل الجداول المدرسية الذكي المستقل.\n\nيمكنك طلب تعديل أي قيد أو إجازة لمعلم أو تبديل حصص بالعامية المصرية أو الخليجية وسأقوم بتحديث الوثيقة وحل الجدول تلقائياً بضمان 0% تعارضات.",
                },
              ])
            }
            className="text-[11px] text-slate-300 hover:text-white px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 transition"
            title="مسح سجل المحادثة والبدء من جديد"
          >
            🗑️ مسح
          </button>

          <button
            type="button"
            onClick={toggleLiveVoice}
            className={`text-xs px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors ${
              isLiveActive
                ? "bg-rose-500 text-white animate-pulse"
                : "bg-slate-800 hover:bg-slate-700 text-slate-200"
            }`}
            title={isLiveActive ? "إنهاء المحادثة الصوتية المباشرة" : "بدء محادثة صوتية مباشرة (Gemini Live API تجريبي)"}
          >
            🎙️ {isLiveActive ? "متصل..." : "صوتي (تجريبي)"}
          </button>

          {isMobile ? (
            <button
              type="button"
              onClick={() => setIsMobileSheetOpen(false)}
              className="text-xs text-slate-300 hover:text-white px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 transition font-bold"
              title="إغلاق اللوحة"
            >
              ✕ إغلاق
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleChatCollapse}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition text-xs font-bold"
              title="طي لوحة الشات إلى شريط جانبي"
            >
              ⇤
            </button>
          )}
        </div>
      </div>

      {/* Messages Area - Internal Scroll Only with WCAG AA Contrast */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3 bg-slate-50/40">
        {chatHistory.map((item, idx) => (
          <div
            key={idx}
            className={`p-3.5 rounded-2xl text-xs whitespace-pre-wrap transition-all shadow-xs ${
              item.role === "user"
                ? "bg-blue-600 text-white ms-auto max-w-[85%]"
                : "bg-white text-slate-900 border border-slate-300 me-auto max-w-[92%]"
            }`}
          >
            <div className="flex items-center justify-between mb-1.5 opacity-80 text-[10px] font-bold">
              <span className="flex items-center gap-1">
                {item.role === "user" ? "👤 طلبك" : "🤖 وكيل الجداول الذكي"}
              </span>
              {item.timestamp && <span>{item.timestamp}</span>}
            </div>

            <div className="leading-relaxed font-medium">{item.text}</div>

            {item.changes && item.changes.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-slate-200 space-y-1">
                <span className="text-[10px] text-emerald-800 font-extrabold flex items-center gap-1">
                  <span>✅</span>
                  <span>العمليات المنفذة بنجاح:</span>
                </span>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-700 ps-1">
                  {item.changes.map((c, cIdx) => (
                    <li key={cIdx}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {item.isError && item.retryPrompt && (
              <div className="mt-2 pt-2 border-t border-rose-200 flex items-center justify-between">
                <span className="text-[10px] text-rose-700 font-bold">تعذر إكمال العملية</span>
                <button
                  type="button"
                  onClick={() => handleSendChat(item.retryPrompt)}
                  className="bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition"
                >
                  إعادة المحاولة 🔄
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Multi-Step Animated Loading Indicator */}
        {isChatSubmitting && (
          <div className="p-3.5 rounded-2xl text-xs bg-white text-slate-900 me-auto max-w-[92%] border border-blue-300 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs animate-spin">
                  ⚙️
                </div>
                <span className="font-extrabold text-blue-950 text-xs">جاري المعالجة بضمان 0% تعارضات...</span>
              </div>
              <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                {chatLoadingStep === 1
                  ? "1 / 3 فهم وتحليل"
                  : chatLoadingStep === 2
                  ? "2 / 3 تحديث الوثيقة"
                  : "3 / 3 حل وتوزيع"}
              </span>
            </div>

            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full transition-all duration-500 rounded-full"
                style={{
                  width: chatLoadingStep === 1 ? "35%" : chatLoadingStep === 2 ? "70%" : "95%",
                }}
              />
            </div>

            <div className="space-y-1 text-[11px]">
              <div className={`flex items-center gap-1.5 ${chatLoadingStep >= 1 ? "text-blue-950 font-bold" : "text-slate-400"}`}>
                <span>{chatLoadingStep > 1 ? "✅" : "🔍"}</span>
                <span>تحليل وفهم الأمر بالعامية والتحقق من المعلمين</span>
              </div>
              <div className={`flex items-center gap-1.5 ${chatLoadingStep >= 2 ? "text-indigo-950 font-bold" : "text-slate-400"}`}>
                <span>{chatLoadingStep > 2 ? "✅" : chatLoadingStep === 2 ? "⏳" : "📝"}</span>
                <span>تحديث وثيقة الـ Markdown وسجل الإسناد والقيود</span>
              </div>
              <div className={`flex items-center gap-1.5 ${chatLoadingStep >= 3 ? "text-emerald-950 font-bold" : "text-slate-400"}`}>
                <span>{chatLoadingStep === 3 ? "⚙️" : "📊"}</span>
                <span>حل الجدول وتوزيع الحصص بضمان 0% تعارضات</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Fixed Input Area at Bottom */}
      <div className="p-3 border-t border-slate-200 bg-white shrink-0 space-y-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
          {[
            "اديله اجازة التلات",
            "خليه ياخد اول حصتين",
            "بدل حصص كمال مع يوسف",
            "سو جدول جديد الحين",
          ].map((chip, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSendChat(chip)}
              disabled={loading}
              className="bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 px-2.5 py-1 rounded-lg shrink-0 font-bold border border-slate-200 transition"
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
            placeholder="اطلب تعديل أي قيد أو إجازة أو تبديل حصص..."
            className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder:text-slate-400 bg-white"
          />
          <button
            type="button"
            onClick={() => handleSendChat()}
            disabled={loading || !chatInput.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-extrabold px-4 py-2 rounded-xl text-xs shadow-xs transition flex items-center gap-1.5 shrink-0"
          >
            <span>إرسال</span>
            <span>🚀</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div dir="rtl" className="min-h-screen bg-slate-100 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-slate-900 text-white px-6 py-3.5 shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-extrabold flex items-center gap-2">
            <span>🗓️</span>
            <span>AI Studio — نظام إنشاء جداول الحصص المدرسية الذكي</span>
          </h1>
          <p className="text-xs text-slate-400">
            منظومة ذكية متكاملة لإعداد جداول الحصص بمحرك القيود والاستمثال (TypeScript Solver) وتكامل Gemini AI
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Global School Switcher & Persistence Toolbar */}
          <div className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700 rounded-xl p-1 shadow-inner">
            <span className="text-xs px-1 text-slate-300">🏫</span>
            <select
              value={selectedPreset}
              onChange={(e) => handleLoadPreset(e.target.value)}
              className="bg-slate-900 border border-slate-600 text-white rounded-lg px-2.5 py-1 text-xs font-bold shadow-inner focus:ring-2 focus:ring-blue-400 focus:outline-none max-w-[210px] truncate"
              title="التبديل بين المدارس المحفوظة"
            >
              {allSchoolsList.length === 0 ? (
                <option value="">(لا توجد مدارس مضافة)</option>
              ) : (
                allSchoolsList.map((p) => (
                  <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                    {p.name}
                  </option>
                ))
              )}
            </select>

            <button
              type="button"
              onClick={() => setShowAddSchoolModal(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-2.5 py-1 rounded-lg shadow-xs flex items-center gap-1 transition"
              title="إنشاء أو إضافة مدرسة جديدة"
            >
              <span>➕</span>
              <span>جديدة</span>
            </button>

            {school && (
              <>
                <button
                  type="button"
                  onClick={handleSaveCurrentSchool}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs px-2.5 py-1 rounded-lg shadow-xs flex items-center gap-1 transition"
                  title="حفظ بيانات المدرسة الحالية والجدول الأخير في ذاكرة المتصفح"
                >
                  <span>💾</span>
                  <span>حفظ</span>
                </button>

                <button
                  type="button"
                  onClick={handleDuplicateSchool}
                  className="bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold text-xs px-2 py-1 rounded-lg border border-slate-600 flex items-center gap-1 transition"
                  title="نسخ المدرسة الحالية كمسودة جديدة للتعديل عليها"
                >
                  <span>📋</span>
                  <span>نسخ</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteSchool(selectedPreset)}
                  className="bg-rose-900/60 hover:bg-rose-800 text-rose-200 hover:text-white font-bold text-xs px-2.5 py-1 rounded-lg border border-rose-700/60 shadow-xs flex items-center gap-1 transition"
                  title="حذف هذه المدرسة نهائياً"
                >
                  <span>🗑️</span>
                  <span>حذف</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleExportBackupJson}
              className="bg-indigo-700 hover:bg-indigo-600 text-white font-bold text-xs px-2.5 py-1 rounded-lg border border-indigo-500/60 shadow-xs flex items-center gap-1 transition"
              title="تصدير نسخة احتياطية كاملة (JSON) لبيانات مدارسك وجداولك (بدون مفاتيح API)"
            >
              <span>📤</span>
              <span>تصدير JSON</span>
            </button>

            <button
              type="button"
              onClick={() => backupFileInputRef.current?.click()}
              className="bg-teal-700 hover:bg-teal-600 text-white font-bold text-xs px-2.5 py-1 rounded-lg border border-teal-500/60 shadow-xs flex items-center gap-1 transition"
              title="استيراد واستعادة نسخة احتياطية (JSON) مع التحقق التلقائي من سلامة البيانات"
            >
              <span>📥</span>
              <span>استيراد JSON</span>
            </button>
            <input
              ref={backupFileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportBackupJsonFile}
              className="hidden"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              refreshKeysState();
              setShowKeyManagerModal(true);
            }}
            className="bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-bold text-xs px-3 py-2 rounded-xl shadow flex items-center gap-1.5 transition"
            title="إدارة مفاتيح Gemini API الخاصة بك (BYOK) وتدويرها التلقائي"
          >
            <span>🔑</span>
            <span>مفاتيح Gemini</span>
            <span className="bg-amber-500/20 text-amber-200 border border-amber-500/40 px-1.5 py-0.5 rounded-md text-[10px]">
              {userKeys.filter((k) => k.enabled).length}
            </span>
          </button>

          <button
            onClick={handleSolve}
            disabled={loading || !school}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-extrabold text-xs px-4 py-2 rounded-xl shadow flex items-center gap-1.5 transition"
          >
            <span>⚡</span>
            <span>{loading ? "⏳ جاري المعالجة..." : "إنشاء الجدول الآن (محرك الاستمثال الذكي)"}</span>
          </button>
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
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-extrabold transition ${
                  keyManagerTab === "single" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                ➕ إضافة مفتاح مفرد (باسم مستعار)
              </button>
              <button
                type="button"
                onClick={() => setKeyManagerTab("bulk")}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-extrabold transition ${
                  keyManagerTab === "bulk" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
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
                      placeholder="مثال: حسابي الشخصي 1"
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
                  placeholder={"AIzaSyExampleKeyOne1111\nAIzaSyExampleKeyTwo2222\nمشروع 3: AIzaSyExampleKeyThree3333"}
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
                        className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
                          !k.enabled
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
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                !k.enabled
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
                            className={`font-bold text-[11px] px-2.5 py-1 rounded-lg border transition ${
                              k.enabled
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
                  placeholder="مثال: مدرسة المستقبل الابتدائية / مدرسة الفاروق الإعدادية..."
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
                    className={`py-2 px-3 rounded-xl border-2 text-center font-extrabold text-xs transition ${
                      newSchoolType === "preset"
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
                    className={`py-2 px-3 rounded-xl border-2 text-center font-extrabold text-xs transition ${
                      newSchoolType === "blank"
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
                    className={`py-2 px-3 rounded-xl border-2 text-center font-extrabold text-xs transition ${
                      newSchoolType === "ai"
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
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                            presetCategoryFilter === "ALL"
                              ? "bg-slate-800 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          الكل ({ALL_SCHOOL_PRESETS.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setPresetCategoryFilter("GOVERNMENT_GENERAL")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                            presetCategoryFilter === "GOVERNMENT_GENERAL"
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          حكومي عام
                        </button>
                        <button
                          type="button"
                          onClick={() => setPresetCategoryFilter("EXPERIMENTAL_LANGUAGE")}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                            presetCategoryFilter === "EXPERIMENTAL_LANGUAGE"
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
                            className={`p-3 rounded-xl border-2 cursor-pointer transition text-start ${
                              isSelected
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
                                className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                                  p.school_type === "GOVERNMENT_GENERAL"
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
                    placeholder="مثال: مدرسة الأمل التجريبية بها 6 فصول للمرحلة الابتدائية، معلمين للغة العربية والإنجليزية والعلوم، الأحد إلى الخميس 7 حصص يومياً..."
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
              className="h-full bg-white rounded-2xl border border-slate-300 p-2 flex flex-col items-center justify-between cursor-pointer hover:border-blue-400 hover:shadow-md transition group select-none"
              title="توسيع لوحة مساعد الشات الذكي"
            >
              <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center text-sm shadow-xs group-hover:bg-blue-600 transition">
                🤖
              </div>
              <div className="[writing-mode:vertical-rl] rotate-180 font-black text-xs text-slate-700 tracking-wider flex items-center gap-2">
                <span>مساعد الشات الذكي</span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded">نشط</span>
              </div>
              <button
                type="button"
                className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 group-hover:bg-blue-50 group-hover:text-blue-700 flex items-center justify-center text-xs font-black transition"
                title="توسيع"
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
          <div className="bg-white rounded-xl p-1.5 shadow-sm border border-slate-200 flex flex-wrap gap-1.5">
            {[
              { id: "wizard", label: "🧙‍♂️ معالج المدرسة (6 خطوات)" },
              { id: "timetable", label: "📅 عرض الجدول والتصدير" },
              { id: "constraints", label: "🔒 القيود والإجازات" },
              { id: "analyze", label: "📊 التحليل والجدوى" },
              { id: "ingest", label: "📝 المحرر النصي (Markdown)" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as any)}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition ${
                  activeTab === t.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {statusMessage && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-2.5 rounded-xl text-xs font-bold">
              ✅ {statusMessage}
            </div>
          )}
          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 text-rose-900 px-4 py-2.5 rounded-xl text-xs font-bold">
              ⚠️ {errorMessage}
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
            <div className="bg-rose-50 border border-rose-300 text-rose-950 px-4 py-3 rounded-xl text-xs space-y-1.5 shadow-sm">
              <div className="flex items-center gap-1.5 font-extrabold text-rose-900">
                <span>🚫</span>
                <span>تنبيهات الطاقة الاستيعابية:</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-rose-900/90 pe-2">
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
                setSchool(updatedSchool);
                setRawText(updatedMarkdown);
                const ana = InBrowserSchoolEngine.analyzeSchool(updatedSchool);
                setAnalysis(ana);
                persistSchoolData(updatedSchool, updatedMarkdown, schedule, ana);
              }}
              onSolveAndOpenTimetable={(schoolToSolve) => {
                handleSolve(schoolToSolve);
              }}
              onCancel={() => setActiveTab("timetable")}
            />
          )}

          {school && activeTab === "ingest" && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-extrabold text-slate-800">🏫 المدرسة النشطة:</h2>
                  <select
                    value={selectedPreset}
                    onChange={(e) => handleLoadPreset(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold bg-white shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    {allSchoolsList.length === 0 ? (
                      <option value="">(لا توجد مدارس مضافة)</option>
                    ) : (
                      allSchoolsList.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))
                    )}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveCurrentSchool}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-sm transition"
                    title="حفظ بيانات المدرسة الحالية في المتصفح"
                  >
                    <span>💾</span>
                    <span>حفظ التعديلات</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddSchoolModal(true)}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-sm transition"
                    title="إنشاء مدرسة جديدة بنموذج جاهز أو بالذكاء الاصطناعي"
                  >
                    <span>➕</span>
                    <span>مدرسة جديدة</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDuplicateSchool}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 flex items-center gap-1 transition"
                    title="عمل نسخة من المدرسة الحالية للتعديل عليها"
                  >
                    <span>📋</span>
                    <span>نسخ</span>
                  </button>
                  {school && (
                    <button
                      type="button"
                      onClick={() => handleDeleteSchool(selectedPreset)}
                      className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs px-2.5 py-1.5 rounded-lg border border-rose-200 flex items-center gap-1 transition"
                      title="حذف هذه المدرسة نهائياً"
                    >
                      <span>🗑️</span>
                      <span>حذف</span>
                    </button>
                  )}
                </div>
              </div>
              <textarea
                rows={14}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="w-full border rounded-xl p-4 text-xs font-mono bg-slate-50"
                placeholder="الصق هنا نص بيانات المدرسة..."
              />
              <div className="flex gap-3">
                <button
                  onClick={handleParseRawText}
                  disabled={loading || !rawText.trim()}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl"
                >
                  🧠 تحليل وفهم النص بالـ AI
                </button>
                <button
                  onClick={handleSolve}
                  disabled={loading || !school}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl"
                >
                  ⚡ إنشاء الجدول مباشرةً
                </button>
              </div>
            </div>
          )}

          {activeTab === "analyze" && analysis && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-3 bg-slate-50 rounded-xl border">
                  <div className="text-xs text-slate-500">حالة الجدوى</div>
                  <div className={`text-base font-extrabold ${analysis.is_feasible ? "text-emerald-600" : "text-rose-600"}`}>
                    {analysis.is_feasible ? "صالحة للحل 100%" : "يوجد اختناق"}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border">
                  <div className="text-xs text-slate-500">الفصول</div>
                  <div className="text-xl font-extrabold">{analysis.total_sections}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border">
                  <div className="text-xs text-slate-500">المعلمون</div>
                  <div className="text-xl font-extrabold">{analysis.total_teachers}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border">
                  <div className="text-xs text-slate-500">إجمالي الحصص</div>
                  <div className="text-xl font-extrabold text-blue-600">{analysis.total_weekly_periods}</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "constraints" && school && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h3 className="text-sm font-extrabold">مصفوفة أيام عمل وإجازات المعلمين</h3>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="p-2 border text-start">المعلم</th>
                      {school.days.map((d) => (
                        <th key={d} className="p-2 border text-center">{DAY_NAMES_AR[d]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {school.teachers.map((tch) => (
                      <tr key={tch.id}>
                        <td className="p-2 border font-bold">{tch.name}</td>
                        {school.days.map((d) => {
                          const isOff = tch.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF";
                          return (
                            <td key={d} className="p-1.5 border text-center">
                              <button
                                onClick={() => toggleTeacherDayOff(tch.id, d)}
                                className={`px-2 py-1 rounded text-[11px] font-bold ${
                                  isOff ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                {isOff ? "إجازة ✗" : "متاح ✓"}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "timetable" && school && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              {/* Live Auto-Update Status Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-gradient-to-r from-blue-50/90 via-indigo-50/70 to-slate-50 border border-blue-200/80 rounded-xl text-xs shadow-2xs">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  <span className="font-extrabold text-blue-950 flex items-center gap-1">
                    <span>⚡ التحديث التلقائي للجدول مفعل على الشاشة</span>
                  </span>
                  <span className="text-[11px] text-slate-500 hidden md:inline">
                    (أي أمر أو تعديل من وكيل الذكاء الاصطناعي أو مصفوفة القيود ينعكس في هذا الجدول مباشرة بضمان 0% تعارضات)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab("wizard")}
                    className="bg-blue-50 hover:bg-blue-100 text-blue-900 text-[11px] font-extrabold px-3 py-1 rounded-lg border border-blue-200 shadow-2xs flex items-center gap-1 transition"
                    title="تعديل المدرسة بالمعالج (الخطوات الـ 6)"
                  >
                    <span>🧙‍♂️</span>
                    <span>تعديل بالمعالج</span>
                  </button>
                  <span className="text-[11px] font-bold text-slate-600 bg-white/80 border border-slate-200 px-2 py-0.5 rounded-lg">
                    آخر تحديث: {lastUpdatedTime}
                  </span>
                  <button
                    type="button"
                    onClick={handleForceRefreshSchedule}
                    disabled={loading}
                    className="bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-extrabold px-3 py-1 rounded-lg border border-slate-300 shadow-2xs flex items-center gap-1 transition disabled:opacity-50"
                    title="إعادة بناء وتحديث جدول الحصص المعروض على الشاشة فوراً"
                  >
                    <span>🔄</span>
                    <span>{loading ? "جاري التحديث..." : "تحديث الشاشة الآن"}</span>
                  </button>
                </div>
              </div>

              {/* Diff Preview Banner if diff is pending */}
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

              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                  <button
                    onClick={() => setViewMode("master")}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                      viewMode === "master" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    🗺️ الجدول العام الشامل
                  </button>
                  <button
                    onClick={() => setViewMode("section")}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                      viewMode === "section" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    🏫 جداول الفصول
                  </button>
                  <button
                    onClick={() => setViewMode("teacher")}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                      viewMode === "teacher" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    👨‍🏫 جداول المعلمين
                  </button>
                </div>

                {schedule && schedule.entries.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => service.downloadExport("pdf", school, schedule, "master").catch((e) => setErrorMessage(e.message))}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1 transition"
                      title="طباعة الجدول العام بحجم A3 Landscape"
                    >
                      <span>🗺️</span>
                      <span>PDF العام A3</span>
                    </button>
                    <button
                      onClick={() => service.downloadExport("pdf", school, schedule, "sections").catch((e) => setErrorMessage(e.message))}
                      className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1 transition"
                      title="طباعة بطاقات الفصول (2 في الصفحة A4 مع خط قص مقص ✂)"
                    >
                      <span>✂</span>
                      <span>بطاقات الفصول A4</span>
                    </button>
                    <button
                      onClick={() => service.downloadExport("pdf", school, schedule, "teachers").catch((e) => setErrorMessage(e.message))}
                      className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1 transition"
                      title="طباعة بطاقات المعلمين (2 في الصفحة A4 مع خط قص مقص ✂)"
                    >
                      <span>👨‍🏫</span>
                      <span>بطاقات المعلمين A4</span>
                    </button>
                    <button
                      onClick={() => service.downloadExport("pdf", school, schedule, "all").catch((e) => setErrorMessage(e.message))}
                      className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1 transition"
                      title="طباعة وتصدير ملف PDF الشامل للمدرسة"
                    >
                      <span>📄</span>
                      <span>PDF الشامل</span>
                    </button>
                    <button
                      onClick={() => service.downloadExport("excel", school, schedule, "all").catch((e) => setErrorMessage(e.message))}
                      className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg shadow-sm flex items-center gap-1 transition"
                      title="تصدير كود إكسيل حقيقي يحتوي على 4 أوراق عمل منسقة بالألوان والأنصبة"
                    >
                      <span>📊</span>
                      <span>Excel ملون (4 أوراق)</span>
                    </button>
                  </div>
                )}
              </div>

              {(() => {
                const activeSchedule = pendingDiff ? pendingDiff.preview_schedule : schedule;
                if (!activeSchedule || !activeSchedule.entries || activeSchedule.entries.length === 0) return null;

                return (
                  <>
                    {viewMode === "master" && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span className="font-bold text-slate-700">
                            💡 عمود المعلم ثابت على اليمين — توزيع الحصص اليومية والفترات معتمد بنسبة 0% تعارض
                          </span>
                          <span className="bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded border border-blue-200">
                            إجمالي الحصص المجدولة: {activeSchedule.entries.length} حصة (تعارضات: 0%)
                          </span>
                        </div>

                        <div className="overflow-x-auto border border-slate-300 rounded-xl shadow-xs max-h-[650px]">
                          <table className="w-full text-[11px] border-collapse bg-white">
                            <thead>
                              {/* Day Group Row */}
                              <tr className="bg-slate-900 text-white">
                                <th
                                  rowSpan={2}
                                  className="sticky start-0 z-30 bg-slate-900 text-white p-2.5 text-start font-extrabold text-xs min-w-[140px] border-b border-e border-slate-700 shadow-[2px_0_6px_rgba(0,0,0,0.18)]"
                                >
                                  المعلم / اليوم
                                </th>
                                {school.days.map((d) => {
                                  const dayPeriods = school.sections[0]?.daily_period_limits?.[String(d)] ?? school.periods_per_day;
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
                              {/* Periods Sub-Header Row */}
                              <tr className="bg-slate-800 text-slate-200">
                                {school.days.map((d) => {
                                  const dayPeriods = school.sections[0]?.daily_period_limits?.[String(d)] ?? school.periods_per_day;
                                  return Array.from({ length: dayPeriods }, (_, i) => i + 1).map((p) => (
                                    <th
                                      key={`h-${d}-${p}`}
                                      className="bg-slate-800 text-slate-200 p-1 text-center font-bold text-[10px] border-b border-l border-slate-700 whitespace-nowrap"
                                      style={{ minWidth: "75px" }}
                                    >
                                      ح {p}
                                    </th>
                                  ));
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {school.teachers.map((tch) => {
                                const teacherEntriesCount = activeSchedule.entries.filter((e) => e.teacher_id === tch.id).length;
                                return (
                                  <tr key={tch.id} className="hover:bg-slate-50/70 transition-colors">
                                    <td className="sticky start-0 z-20 bg-white p-2.5 text-start border-b border-e border-slate-300 shadow-[2px_0_6px_rgba(0,0,0,0.06)] min-w-[140px]">
                                      <div className="font-extrabold text-xs text-slate-900 leading-tight">{tch.name}</div>
                                      <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                                        {teacherEntriesCount} حصة {tch.code ? `| ${tch.code}` : ""}
                                      </div>
                                    </td>
                                    {school.days.map((d) => {
                                      const dayPeriods = school.sections[0]?.daily_period_limits?.[String(d)] ?? school.periods_per_day;
                                      const isOff = tch.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF";
                                      return Array.from({ length: dayPeriods }, (_, i) => i + 1).map((p) => {
                                        const entry = activeSchedule.entries.find(
                                          (e) => e.teacher_id === tch.id && e.day === d && e.period === p
                                        );
                                        const pal = entry ? getSectionPalette(entry.section_id) : null;
                                        const isChangedCell = entry && pendingDiff?.changed_cell_keys.has(`${entry.section_id}_${d}_${p}`);
                                        return (
                                          <td
                                            key={`${tch.id}-${d}-${p}`}
                                            className="p-1 border-b border-l border-slate-200 text-center align-middle"
                                            style={{ minWidth: "75px", height: "50px" }}
                                          >
                                            {entry ? (
                                              <div
                                                className={`w-full h-full rounded-md p-1 flex flex-col justify-center items-center shadow-xs border transition-transform hover:scale-105 relative ${
                                                  isChangedCell
                                                    ? "ring-2 ring-blue-500 border-dashed border-blue-600 motion-safe:animate-pulse motion-reduce:animate-none"
                                                    : ""
                                                }`}
                                                style={{
                                                  backgroundColor: isChangedCell ? "#E0F2FE" : pal?.bg,
                                                  borderColor: isChangedCell ? "#2563EB" : pal?.border,
                                                  color: isChangedCell ? "#1E3A8A" : pal?.text,
                                                }}
                                              >
                                                <div className="flex items-center gap-1">
                                                  <span>{formatSection(getSectionName(entry.section_id))}</span>
                                                  {isChangedCell && (
                                                    <span className="bg-blue-700 text-white text-[9px] px-1 py-0.2 rounded font-extrabold" aria-label="حصة معدلة">
                                                      [معدل]
                                                    </span>
                                                  )}
                                                </div>
                                                <div className="flex items-center justify-between w-full mt-0.5 gap-0.5">
                                                  <span className="text-[10px] font-bold leading-tight truncate max-w-full opacity-95">
                                                    {getSubjectName(entry.subject_id)}
                                                  </span>
                                                  <button
                                                    type="button"
                                                    onClick={(ev) => {
                                                      ev.stopPropagation();
                                                      togglePinEntry(entry);
                                                    }}
                                                    title={entry.is_pinned ? "الحصة مثبّتة (انقر لإلغاء التثبيت)" : "تثبيت الحصة لمنع تغييرها في إعادة التوليد"}
                                                    className="text-[10px] opacity-75 hover:opacity-100 p-0.5"
                                                  >
                                                    {entry.is_pinned ? "📌" : "🔓"}
                                                  </button>
                                                </div>
                                              </div>
                                            ) : isOff ? (
                                              <div className="w-full h-full rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 font-bold text-sm">
                                                —
                                              </div>
                                            ) : (
                                              <div className="w-full h-full rounded-md bg-slate-50/60 border border-slate-100 flex items-center justify-center text-slate-300 font-bold text-sm">
                                                —
                                              </div>
                                            )}
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
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-700">اختر الفصل:</span>
                            <select
                              value={selectedSectionId}
                              onChange={(e) => setSelectedSectionId(e.target.value)}
                              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold bg-white"
                            >
                              {school.sections.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          </div>
                          <span className="text-xs font-bold text-slate-600">
                            جدول حصص أسبوعي متكامل للفصل المحدد
                          </span>
                        </div>

                        {(() => {
                          const sec = school.sections.find((s) => s.id === selectedSectionId) || school.sections[0];
                          if (!sec) return null;
                          const maxP = Math.max(
                            ...school.days.map((d) => sec.daily_period_limits?.[String(d)] ?? school.periods_per_day)
                          );
                          return (
                            <div className="overflow-x-auto border border-slate-200 rounded-xl">
                              <table className="w-full text-xs border-collapse">
                                <thead>
                                  <tr className="bg-slate-900 text-white">
                                    <th className="p-2.5 text-start font-extrabold w-28 border">اليوم / الحصة</th>
                                    {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
                                      <th key={p} className="p-2 text-center font-extrabold border">الحصة {p}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {school.days.map((d) => {
                                    const limit = sec.daily_period_limits?.[String(d)] ?? school.periods_per_day;
                                    return (
                                      <tr key={d} className="border-b">
                                        <td className="p-3 bg-slate-50 font-extrabold border text-start">{DAY_NAMES_AR[d]}</td>
                                        {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => {
                                          if (p > limit) {
                                            return (
                                              <td key={p} className="p-2 border text-center bg-slate-100 text-slate-400 font-bold">
                                                —
                                              </td>
                                            );
                                          }
                                          const entry = activeSchedule.entries.find(
                                            (e) => e.section_id === sec.id && e.day === d && e.period === p
                                          );
                                          const isChangedCell = entry && pendingDiff?.changed_cell_keys.has(`${entry.section_id}_${d}_${p}`);
                                          return (
                                            <td key={p} className="p-2 border text-center">
                                              {entry ? (
                                                <div
                                                  className={`border rounded-lg p-2 relative ${
                                                    isChangedCell
                                                      ? "bg-blue-100 border-dashed border-blue-600 text-blue-950 ring-2 ring-blue-500 motion-safe:animate-pulse motion-reduce:animate-none"
                                                      : "bg-blue-50 border-blue-200 text-blue-900"
                                                  }`}
                                                >
                                                  <div className="flex items-center justify-between">
                                                    <span className="font-extrabold text-xs">{getSubjectName(entry.subject_id)}</span>
                                                    {isChangedCell && (
                                                      <span className="bg-blue-700 text-white text-[9px] px-1 py-0.2 rounded font-extrabold" aria-label="حصة معدلة">
                                                        [معدل]
                                                      </span>
                                                    )}
                                                  </div>
                                                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold mt-1">
                                                    <span>{getTeacherName(entry.teacher_id)}</span>
                                                    <button
                                                      type="button"
                                                      onClick={(ev) => {
                                                        ev.stopPropagation();
                                                        togglePinEntry(entry);
                                                      }}
                                                      title={entry.is_pinned ? "الحصة مثبّتة (انقر لإلغاء التثبيت)" : "تثبيت الحصة لمنع تغييرها في إعادة التوليد"}
                                                      className="text-[10px] opacity-75 hover:opacity-100"
                                                    >
                                                      {entry.is_pinned ? "📌" : "🔓"}
                                                    </button>
                                                  </div>
                                                </div>
                                              ) : (
                                                <span className="text-slate-300 font-bold">—</span>
                                              )}
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Teacher Timetable View */}
                    {viewMode === "teacher" && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-700">اختر المعلم:</span>
                            <select
                              value={selectedTeacherId}
                              onChange={(e) => setSelectedTeacherId(e.target.value)}
                              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold bg-white"
                            >
                              {school.teachers.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                          </div>
                          <span className="text-xs font-bold text-slate-600">
                            جدول الحصص والتفرغات الخاص بالمعلم المحدد
                          </span>
                        </div>

                        {(() => {
                          const tch = school.teachers.find((t) => t.id === selectedTeacherId) || school.teachers[0];
                          if (!tch) return null;
                          const maxP = Math.max(
                            ...school.days.map((d) => school.sections[0]?.daily_period_limits?.[String(d)] ?? school.periods_per_day)
                          );
                          return (
                            <div className="overflow-x-auto border border-slate-200 rounded-xl">
                              <table className="w-full text-xs border-collapse">
                                <thead>
                                  <tr className="bg-slate-900 text-white">
                                    <th className="p-2.5 text-start font-extrabold w-28 border">اليوم / الحصة</th>
                                    {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
                                      <th key={p} className="p-2 text-center font-extrabold border">الحصة {p}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {school.days.map((d) => {
                                    const isOff = tch.work_pattern?.day_rules?.[String(d)] === "MANDATORY_OFF";
                                    const count = school.sections[0]?.daily_period_limits?.[String(d)] ?? school.periods_per_day;
                                    return (
                                      <tr key={d} className="border-b">
                                        <td className="p-3 bg-slate-50 font-extrabold border text-start">{DAY_NAMES_AR[d]}</td>
                                        {isOff ? (
                                          <td colSpan={maxP} className="p-3 border text-center bg-rose-50 text-rose-600 font-extrabold">
                                            إجازة تفرغ أسبوعية معتمدة (MANDATORY_OFF)
                                          </td>
                                        ) : (
                                          Array.from({ length: maxP }, (_, i) => i + 1).map((p) => {
                                            if (p > count) {
                                              return (
                                                <td key={p} className="p-2 border text-center bg-slate-100 text-slate-400 font-bold">
                                                  —
                                                </td>
                                              );
                                            }
                                            const entry = activeSchedule.entries.find(
                                              (e) => e.teacher_id === tch.id && e.day === d && e.period === p
                                            );
                                            const pal = entry ? getSectionPalette(entry.section_id) : null;
                                            const isChangedCell = entry && pendingDiff?.changed_cell_keys.has(`${entry.section_id}_${d}_${p}`);
                                            return (
                                              <td key={p} className="p-2 border text-center">
                                                {entry ? (
                                                  <div
                                                    className={`rounded-lg p-2 font-bold shadow-xs border relative ${
                                                      isChangedCell
                                                        ? "ring-2 ring-blue-500 border-dashed border-blue-600 motion-safe:animate-pulse motion-reduce:animate-none"
                                                        : ""
                                                    }`}
                                                    style={{
                                                      backgroundColor: isChangedCell ? "#E0F2FE" : pal?.bg,
                                                      borderColor: isChangedCell ? "#2563EB" : pal?.border,
                                                      color: isChangedCell ? "#1E3A8A" : pal?.text,
                                                    }}
                                                  >
                                                    <div className="flex items-center justify-between">
                                                      <span>{formatSection(getSectionName(entry.section_id))}</span>
                                                      {isChangedCell && (
                                                        <span className="bg-blue-700 text-white text-[9px] px-1 py-0.2 rounded font-extrabold" aria-label="حصة معدلة">
                                                          [معدل]
                                                        </span>
                                                      )}
                                                    </div>
                                                    <div className="flex items-center justify-between text-[10px] opacity-90 mt-1">
                                                      <span>{getSubjectName(entry.subject_id)}</span>
                                                      <button
                                                        type="button"
                                                        onClick={(ev) => {
                                                          ev.stopPropagation();
                                                          togglePinEntry(entry);
                                                        }}
                                                        title={entry.is_pinned ? "الحصة مثبّتة (انقر لإلغاء التثبيت)" : "تثبيت الحصة لمنع تغييرها في إعادة التوليد"}
                                                        className="text-[10px] opacity-75 hover:opacity-100"
                                                      >
                                                        {entry.is_pinned ? "📌" : "🔓"}
                                                      </button>
                                                    </div>
                                                  </div>
                                                ) : (
                                                  <span className="text-slate-300 font-bold">—</span>
                                                )}
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
                          );
                        })()}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </main>
      </div>

      {/* MOBILE BOTTOM SHEET FOR CHAT (< lg screens) */}
      <div className="lg:hidden">
        {!isMobileSheetOpen ? (
          <div className="fixed bottom-3 inset-x-3 z-40">
            <button
              type="button"
              onClick={() => setIsMobileSheetOpen(true)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs py-3 px-4 rounded-2xl shadow-xl flex items-center justify-between border border-slate-700 transition"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">🤖</span>
                <span>وكيل الجداول الذكي (طلب تعديل بالعامية)</span>
              </div>
              <span className="text-[10px] bg-blue-600 text-white px-2.5 py-1 rounded-full font-bold">
                فتح الشات 💬
              </span>
            </button>
          </div>
        ) : (
          <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 transition-opacity">
            <div className="bg-white rounded-t-3xl shadow-2xl max-h-[85vh] h-[78vh] flex flex-col overflow-hidden border-t border-slate-300">
              <div
                className="p-2 flex justify-center bg-slate-100 cursor-pointer"
                onClick={() => setIsMobileSheetOpen(false)}
                title="إغلاق اللوحة"
              >
                <div className="w-12 h-1.5 bg-slate-400 rounded-full" />
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                {renderChatPanelContent(true)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
