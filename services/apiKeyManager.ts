/**
 * Bring-Your-Own-Key (BYOK) Manager for Gemini API Keys.
 * - Stores keys strictly on the user's device (localStorage).
 * - Displays only the last 4 characters of any key (masked).
 * - Supports single add and bulk add (one key per line).
 * - Rotates automatically on 429/503 (with 60s cooldown) and disables invalid keys on 400/403.
 * - Sanitizes all errors and logs so API keys never leak into console, UI, or network payloads.
 * - Validates Gemini SchoolData JSON outputs before applying them to application state.
 */

import { GoogleGenAI } from "@google/genai";
import type { SchoolData } from "../types.ts";
import { sanitizeSchool } from "./schoolCore.ts";

export const BYOK_STORAGE_KEY = "AI_STUDIO_BYOK_GEMINI_KEYS_V1";
export const DEFAULT_COOLDOWN_MS = 60_000;
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

export type ApiKeyStatus = "untested" | "valid" | "cooldown" | "invalid";

export interface UserApiKeyEntry {
  id: string;
  alias: string;
  key: string;
  masked: string;
  enabled: boolean;
  status: ApiKeyStatus;
  cooldownUntil?: number;
  lastStatusMessage?: string;
  addedAt: string;
}

export class AllKeysFailedError extends Error {
  public readonly notices: string[];
  public readonly hadConfiguredKeys: boolean;

  constructor(message: string, notices: string[] = [], hadConfiguredKeys: boolean = false) {
    super(message);
    this.name = "AllKeysFailedError";
    this.notices = notices;
    this.hadConfiguredKeys = hadConfiguredKeys;
  }
}

// In-memory fallback for Node.js test environments where localStorage is not defined
let memoryStore: UserApiKeyEntry[] = [];

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function maskApiKey(rawKey: string): string {
  const clean = (rawKey || "").trim();
  if (!clean) return "••••";
  const last4 = clean.slice(-4);
  return `••••${last4}`;
}

export function sanitizeSecretText(input: unknown, knownKeys: string[] = []): string {
  let text = typeof input === "string" ? input : String((input as any)?.message || input || "");
  if (!text) return "";

  // 1. Strip any exact known user key (full or partial >= 8 chars)
  for (const k of knownKeys) {
    const clean = (k || "").trim();
    if (clean.length >= 6) {
      text = text.split(clean).join("[REDACTED_KEY]");
    }
  }

  // 2. Strip standard Google API key patterns (AIza... and AQ.Ab8...)
  text = text.replace(/AIza[0-9A-Za-z\-_]{8,}/g, "[REDACTED_KEY]");
  text = text.replace(/AQ\.[0-9A-Za-z\-_.]{8,}/g, "[REDACTED_KEY]");
  text = text.replace(/key=[0-9A-Za-z\-_.]{8,}/gi, "key=[REDACTED_KEY]");

  return text;
}

export class ApiKeyManager {
  static getKeys(): UserApiKeyEntry[] {
    if (hasLocalStorage()) {
      try {
        const raw = window.localStorage.getItem(BYOK_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed.map((item) => ({
              ...item,
              masked: maskApiKey(item.key),
            }));
          }
        }
      } catch {
        // Ignore storage read errors
      }
      return [];
    }
    return [...memoryStore];
  }

  static saveKeys(entries: UserApiKeyEntry[]): UserApiKeyEntry[] {
    const normalized = entries.map((e) => ({
      ...e,
      masked: maskApiKey(e.key),
      lastStatusMessage: e.lastStatusMessage
        ? sanitizeSecretText(
            e.lastStatusMessage,
            entries.map((x) => x.key)
          )
        : undefined,
    }));

    if (hasLocalStorage()) {
      try {
        window.localStorage.setItem(BYOK_STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // Ignore storage quota errors
      }
    } else {
      memoryStore = [...normalized];
    }
    return normalized;
  }

  static clearAllKeys(): void {
    this.saveKeys([]);
  }

  static addKey(
    rawKey: string,
    alias?: string
  ): { added: boolean; reason?: string; entry?: UserApiKeyEntry; entries: UserApiKeyEntry[] } {
    const cleanKey = (rawKey || "").trim();
    const current = this.getKeys();

    if (!cleanKey || cleanKey.length < 8) {
      return {
        added: false,
        reason: "يرجى إدخال مفتاح Gemini API صحيح (8 خانات على الأقل).",
        entries: current,
      };
    }

    if (current.some((k) => k.key === cleanKey)) {
      return {
        added: false,
        reason: `المفتاح المنتهي بـ (${maskApiKey(cleanKey)}) مضاف بالفعل.`,
        entries: current,
      };
    }

    const nextIndex = current.length + 1;
    const entry: UserApiKeyEntry = {
      id: `key_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      alias: (alias || "").trim() || `مفتاح #${nextIndex}`,
      key: cleanKey,
      masked: maskApiKey(cleanKey),
      enabled: true,
      status: "untested",
      addedAt: new Date().toISOString(),
    };

    const updated = this.saveKeys([...current, entry]);
    return { added: true, entry, entries: updated };
  }

  /**
   * Bulk-adds multiple keys (one key per line).
   * Supports plain keys per line OR "Alias: KEY" / "Alias = KEY" format.
   */
  static addBulkKeys(
    multilineText: string,
    aliasPrefix: string = "مفتاح"
  ): {
    addedCount: number;
    skippedCount: number;
    entries: UserApiKeyEntry[];
  } {
    const lines = (multilineText || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("//"));

    const current = this.getKeys();
    const existingSet = new Set(current.map((k) => k.key));
    const newEntries: UserApiKeyEntry[] = [];
    let addedCount = 0;
    let skippedCount = 0;

    for (const line of lines) {
      let alias = "";
      let keyCandidate = line;

      // Support "GEMINI_API_KEY=..." or "My Alias: AIza..."
      const eqMatch = line.match(/^([^=:]{1,40})\s*[=:]\s*(.+)$/);
      if (eqMatch) {
        const left = eqMatch[1].trim();
        const right = eqMatch[2].trim();
        // If left side is GEMINI_API_KEY*, generate a clean Arabic alias
        if (/^GEMINI_API_KEY/i.test(left)) {
          alias = "";
        } else {
          alias = left;
        }
        keyCandidate = right;
      }

      const cleanKey = keyCandidate.replace(/^["']|["']$/g, "").trim();
      if (cleanKey.length < 8 || existingSet.has(cleanKey)) {
        skippedCount++;
        continue;
      }

      existingSet.add(cleanKey);
      const seqNum = current.length + newEntries.length + 1;
      newEntries.push({
        id: `key_${Date.now().toString(36)}_${seqNum}_${Math.random().toString(36).slice(2, 5)}`,
        alias: alias || `${aliasPrefix} #${seqNum}`,
        key: cleanKey,
        masked: maskApiKey(cleanKey),
        enabled: true,
        status: "untested",
        addedAt: new Date().toISOString(),
      });
      addedCount++;
    }

    const updated = this.saveKeys([...current, ...newEntries]);
    return { addedCount, skippedCount, entries: updated };
  }

  static removeKey(id: string): UserApiKeyEntry[] {
    const current = this.getKeys().filter((k) => k.id !== id);
    return this.saveKeys(current);
  }

  static toggleKey(id: string, enabled?: boolean): UserApiKeyEntry[] {
    const current = this.getKeys().map((k) => {
      if (k.id !== id) return k;
      const nextEnabled = enabled !== undefined ? enabled : !k.enabled;
      return {
        ...k,
        enabled: nextEnabled,
        status: nextEnabled && k.status === "invalid" ? ("untested" as ApiKeyStatus) : k.status,
        cooldownUntil: nextEnabled ? undefined : k.cooldownUntil,
      };
    });
    return this.saveKeys(current);
  }

  static updateKeyStatus(
    id: string,
    patch: Partial<Pick<UserApiKeyEntry, "enabled" | "status" | "cooldownUntil" | "lastStatusMessage">>
  ): UserApiKeyEntry[] {
    const all = this.getKeys();
    const knownSecrets = all.map((k) => k.key);
    const updated = all.map((k) => {
      if (k.id !== id) return k;
      return {
        ...k,
        ...patch,
        lastStatusMessage:
          patch.lastStatusMessage !== undefined
            ? sanitizeSecretText(patch.lastStatusMessage, knownSecrets)
            : k.lastStatusMessage,
      };
    });
    return this.saveKeys(updated);
  }

  static classifyError(err: unknown): {
    kind: "quota_or_rate_limit" | "invalid_or_forbidden" | "other";
    statusCode?: number;
  } {
    const msg = String((err as any)?.message || err || "");
    const status = Number((err as any)?.status || (err as any)?.statusCode || 0);

    if (
      status === 429 ||
      status === 503 ||
      /\b(429|503)\b/.test(msg) ||
      /RESOURCE_EXHAUSTED|quota|rate.?limit|high demand|UNAVAILABLE|Too Many Requests/i.test(msg)
    ) {
      return { kind: "quota_or_rate_limit", statusCode: status || 429 };
    }

    if (
      status === 400 ||
      status === 401 ||
      status === 403 ||
      /\b(400|401|403)\b/.test(msg) ||
      /API_KEY_INVALID|INVALID_ARGUMENT.*key|PERMISSION_DENIED|unauthenticated|forbidden|expired/i.test(msg)
    ) {
      return { kind: "invalid_or_forbidden", statusCode: status || 403 };
    }

    return { kind: "other", statusCode: status || undefined };
  }

  /**
   * Executes a Gemini operation across the user's active keys with automatic rotation,
   * 60s cooldown on 429/503, and automatic disabling on 400/403.
   */
  static async executeWithRotation<T>(
    operation: (client: GoogleGenAI, keyEntry: UserApiKeyEntry) => Promise<T>,
    options: {
      cooldownMs?: number;
      onNotice?: (notice: string) => void;
      clientFactory?: (apiKey: string) => GoogleGenAI;
    } = {}
  ): Promise<{ result: T; usedKey: Omit<UserApiKeyEntry, "key">; notices: string[] }> {
    const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const notices: string[] = [];
    const emit = (msg: string) => {
      const clean = sanitizeSecretText(
        msg,
        this.getKeys().map((k) => k.key)
      );
      notices.push(clean);
      options.onNotice?.(clean);
    };

    const allKeys = this.getKeys();
    const enabledKeys = allKeys.filter((k) => k.enabled);

    if (enabledKeys.length === 0) {
      throw new AllKeysFailedError(
        allKeys.length === 0
          ? "لم تتم إضافة أي مفتاح Gemini API بعد. تم المتابعة تلقائياً عبر المحرك المحلي الحتمي."
          : "جميع مفاتيح Gemini المضافة معطّلة حالياً. يرجى تفعيل مفتاح صالح أو إضافة مفتاح جديد، وتم المتابعة عبر المحرك المحلي.",
        notices,
        allKeys.length > 0
      );
    }

    const now = Date.now();
    // Release expired cooldowns first
    for (const k of enabledKeys) {
      if (k.status === "cooldown" && k.cooldownUntil && now >= k.cooldownUntil) {
        this.updateKeyStatus(k.id, {
          status: "valid",
          cooldownUntil: undefined,
          lastStatusMessage: "انتهت فترة التبريد — المفتاح متاح مجدداً",
        });
      }
    }

    const refreshed = this.getKeys().filter((k) => k.enabled);
    const availableKeys = refreshed.filter((k) => !k.cooldownUntil || Date.now() >= k.cooldownUntil);

    if (availableKeys.length === 0) {
      const soonest = Math.min(...refreshed.map((k) => k.cooldownUntil || now + cooldownMs));
      const remSec = Math.max(1, Math.ceil((soonest - now) / 1000));
      throw new AllKeysFailedError(
        `جميع المفاتيح المفعّلة في فترة تبريد مؤقتة بسبب تجاوز الحصة (تبقّى ~${remSec} ثانية). تم المتابعة فوراً عبر المحرك المحلي الحتمي.`,
        notices,
        true
      );
    }

    const createClient =
      options.clientFactory ||
      ((apiKey: string) =>
        new GoogleGenAI({
          apiKey,
        }));

    for (const candidate of availableKeys) {
      try {
        const client = createClient(candidate.key);
        const result = await operation(client, candidate);

        this.updateKeyStatus(candidate.id, {
          status: "valid",
          cooldownUntil: undefined,
          lastStatusMessage: `نشط — آخر استخدام ناجح (${new Date().toLocaleTimeString("ar-EG")})`,
        });

        const { key: _omitted, ...safeKey } = candidate;
        return { result, usedKey: safeKey, notices };
      } catch (err: unknown) {
        const classification = this.classifyError(err);
        const safeErrText = sanitizeSecretText(
          err,
          this.getKeys().map((k) => k.key)
        );

        if (classification.kind === "quota_or_rate_limit") {
          const until = Date.now() + cooldownMs;
          this.updateKeyStatus(candidate.id, {
            status: "cooldown",
            cooldownUntil: until,
            lastStatusMessage: `تجاوز الحصة (429/503) — تبريد مؤقت لمدة ${Math.round(cooldownMs / 1000)} ثانية`,
          });
          emit(
            `⏳ المفتاح "${candidate.alias}" (${candidate.masked}) تجاوز الحصة المؤقتة (429)؛ تم وضعه في فترة تبريد والتبديل للمفتاح التالي تلقائياً.`
          );
          continue;
        }

        if (classification.kind === "invalid_or_forbidden") {
          this.updateKeyStatus(candidate.id, {
            enabled: false,
            status: "invalid",
            cooldownUntil: undefined,
            lastStatusMessage: `مفتاح غير صالح أو مرفوض (${classification.statusCode || 403}) — تم تعطيله تلقائياً`,
          });
          emit(
            `⚠️ تم تعطيل المفتاح "${candidate.alias}" (${candidate.masked}) تلقائياً لأنه غير صالح أو مرفوض (${classification.statusCode || 403}).`
          );
          continue;
        }

        // Other unexpected error: record sanitized error and try next key
        this.updateKeyStatus(candidate.id, {
          lastStatusMessage: `خطأ: ${safeErrText.slice(0, 120)}`,
        });
        emit(`تعذر الاتصال عبر المفتاح "${candidate.alias}" (${candidate.masked}). جاري تجربة المفتاح التالي...`);
      }
    }

    throw new AllKeysFailedError(
      "تعذر إتمام الطلب عبر جميع مفاتيح Gemini المفعّلة (بسبب انتهاء الحصة أو عدم صلاحية المفاتيح). تم التحويل تلقائياً إلى المحرك المحلي الحتمي بدون توقف.",
      notices,
      true
    );
  }

  /**
   * Tests a single key by ID and updates its status in storage.
   */
  static async testKeyById(
    id: string,
    clientFactory?: (apiKey: string) => GoogleGenAI
  ): Promise<{ ok: boolean; status: ApiKeyStatus; message: string }> {
    const entry = this.getKeys().find((k) => k.id === id);
    if (!entry) {
      return { ok: false, status: "invalid", message: "المفتاح غير موجود." };
    }

    const createClient =
      clientFactory ||
      ((apiKey: string) =>
        new GoogleGenAI({
          apiKey,
        }));

    try {
      const client = createClient(entry.key);
      await client.models.generateContent({
        model: DEFAULT_GEMINI_MODEL,
        contents: "قل: جاهز",
      });

      const msg = `المفتاح "${entry.alias}" (${entry.masked}) صالح ويعمل بنجاح ✓`;
      this.updateKeyStatus(entry.id, {
        enabled: true,
        status: "valid",
        cooldownUntil: undefined,
        lastStatusMessage: msg,
      });
      return { ok: true, status: "valid", message: msg };
    } catch (err: unknown) {
      const cls = this.classifyError(err);
      if (cls.kind === "quota_or_rate_limit") {
        const until = Date.now() + DEFAULT_COOLDOWN_MS;
        const msg = `المفتاح "${entry.alias}" (${entry.masked}) صحيح لكنه متجاوز للحصة حالياً (429) — في فترة تبريد.`;
        this.updateKeyStatus(entry.id, {
          status: "cooldown",
          cooldownUntil: until,
          lastStatusMessage: msg,
        });
        return { ok: false, status: "cooldown", message: msg };
      }

      const msg = `المفتاح "${entry.alias}" (${entry.masked}) غير صالح أو مرفوض (${cls.statusCode || 400}). تم تعطيله.`;
      this.updateKeyStatus(entry.id, {
        enabled: false,
        status: "invalid",
        cooldownUntil: undefined,
        lastStatusMessage: msg,
      });
      return { ok: false, status: "invalid", message: msg };
    }
  }
}

/**
 * Strict runtime schema validator for SchoolData returned by Gemini LLM.
 * Prevents malformed AI JSON from corrupting application state or localStorage.
 */
export function validateSchoolDataSchema(candidate: unknown): {
  valid: boolean;
  school?: SchoolData;
  errors: string[];
} {
  const errors: string[] = [];
  if (!candidate || typeof candidate !== "object") {
    return { valid: false, errors: ["المخرجات ليست كائن JSON صالحاً."] };
  }

  const obj = candidate as Record<string, any>;

  if (typeof obj.name !== "string" || !obj.name.trim()) {
    errors.push("اسم المدرسة (name) مفقود أو غير صالح.");
  }

  if (!Array.isArray(obj.sections) || obj.sections.length === 0) {
    errors.push("قائمة الفصول (sections) يجب أن تكون مصفوفة غير فارغة.");
  } else {
    for (let i = 0; i < obj.sections.length; i++) {
      const s = obj.sections[i];
      if (!s || typeof s.id !== "string" || typeof s.name !== "string") {
        errors.push(`الفصل رقم ${i + 1} يفتقر إلى id أو name.`);
        break;
      }
    }
  }

  if (!Array.isArray(obj.teachers) || obj.teachers.length === 0) {
    errors.push("قائمة المعلمين (teachers) يجب أن تكون مصفوفة غير فارغة.");
  } else {
    for (let i = 0; i < obj.teachers.length; i++) {
      const t = obj.teachers[i];
      if (!t || typeof t.id !== "string" || typeof t.name !== "string") {
        errors.push(`المعلم رقم ${i + 1} يفتقر إلى id أو name.`);
        break;
      }
    }
  }

  if (!Array.isArray(obj.subjects) || obj.subjects.length === 0) {
    errors.push("قائمة المواد (subjects) يجب أن تكون مصفوفة غير فارغة.");
  } else {
    for (let i = 0; i < obj.subjects.length; i++) {
      const sub = obj.subjects[i];
      if (!sub || typeof sub.id !== "string" || typeof sub.name !== "string") {
        errors.push(`المادة رقم ${i + 1} تفتقر إلى id أو name.`);
        break;
      }
    }
  }

  if (!Array.isArray(obj.assignments) || obj.assignments.length === 0) {
    errors.push("قائمة الإسنادات (assignments) يجب أن تكون مصفوفة غير فارغة.");
  } else {
    for (let i = 0; i < obj.assignments.length; i++) {
      const a = obj.assignments[i];
      if (
        !a ||
        typeof a.section_id !== "string" ||
        typeof a.subject_id !== "string" ||
        typeof a.teacher_id !== "string" ||
        typeof a.weekly_periods !== "number" ||
        !Number.isFinite(a.weekly_periods) ||
        a.weekly_periods <= 0
      ) {
        errors.push(`الإسناد رقم ${i + 1} غير مكتمل أو يحتوي على عدد حصص غير صالح.`);
        break;
      }
    }
  }

  // 3. Reuse sanitizeSchool from schoolCore to normalize IDs, grades, and periods_per_day objects
  const sanitized = sanitizeSchool(obj);
  const s = sanitized.school;

  if (!Array.isArray(s.sections) || s.sections.length === 0) {
    errors.push("قائمة الفصول (sections) يجب أن تكون مصفوفة غير فارغة.");
  }
  if (!Array.isArray(s.teachers) || s.teachers.length === 0) {
    errors.push("قائمة المعلمين (teachers) يجب أن تكون مصفوفة غير فارغة.");
  }
  if (!Array.isArray(s.subjects) || s.subjects.length === 0) {
    errors.push("قائمة المواد (subjects) يجب أن تكون مصفوفة غير فارغة.");
  }
  if (!Array.isArray(s.assignments) || s.assignments.length === 0) {
    errors.push("قائمة الإسنادات (assignments) يجب أن تكون مصفوفة غير فارغة.");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, school: s, errors: [] };
}

