/**
 * Clean Public Repository Builder & Secret/Privacy Verifier (Allowlist Mode).
 *
 * - Copies ONLY explicitly allowlisted public files from `ai_studio_app` into a new target
 *   directory (`e:\جدول_مدرسة\clean_public_repo`).
 * - NEVER deletes or modifies any private file, `.env`, or real school `.md` file in the source workspace.
 * - Excludes:
 *   - `.env`, `.env.*` (except `.env.example`)
 *   - `presets/*.private.ts` and any `*.private.*`
 *   - `sce/`, Python files, `.db` files, `standalone.html`, `export_samples/`
 *   - Temporary debug/push scripts (`scripts/push.*`, `scripts/sync_to_repo.ps1`, `scripts/try-*`, `scripts/debug-*`, etc.)
 *   - Real school `.md` files (`nesschinfo.md`, `مدرسة_الفاروق_النموذجية_اختبار.md`, `مدرسة_عرب_مطير_الابتدائية.md`)
 * - Links `node_modules` via directory junction so `lint`, `build`, and all 5 test suites run inside the clean repo.
 * - Runs an automated Secret & Privacy Audit on every file in the clean repo AND its compiled `dist/` bundle.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const SOURCE_DIR = path.resolve(import.meta.dirname, "..");
const TARGET_DIR = path.resolve(SOURCE_DIR, "..", "clean_public_repo");

// Strict Allowlist of relative file paths permitted in the public open-source repository
const ALLOWLIST_FILES: string[] = [
  ".gitignore",
  ".env.example",
  "README.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "metadata.json",
  "index.html",
  "index.css",
  "index.tsx",
  "types.ts",
  "App.tsx",
  "server.ts",
  // Public anonymized preset ONLY (excludes school376.private.ts)
  "presets/demo.ts",
  "presets/commonPresets.ts",
  "presets/json/catalog.json",
  "presets/json/preset_primary_gov_single.json",
  "presets/json/preset_primary_gov_two_shifts.json",
  "presets/json/preset_primary_lang_single.json",
  "presets/json/preset_prep_gov_35.json",
  "presets/json/preset_prep_gov_36.json",
  "presets/json/preset_prep_lang_35.json",
  "presets/json/preset_sec_gov_35.json",
  // Components
  "components/JadwalLogo.tsx",
  "components/SchoolWizardStepper.tsx",
  "components/TeacherManagementHub.tsx",
  "components/TimetableDiffPreview.tsx",
  // Public anonymized test fixtures ONLY
  "fixtures/demo_prep_school.md",
  "fixtures/demo_model_school.md",
  "fixtures/demo_two_shift_school.md",
  // Core services
  "services/agentMemoryEngine.ts",
  "services/apiKeyManager.ts",
  "services/arabicRules.ts",
  "services/diffEngine.ts",
  "services/geminiService.ts",
  "services/localEngine.ts",
  "services/scheduler.test.ts",
  "services/schoolAssistant.ts",
  "services/schoolCore.ts",
  "services/schoolTemplates.ts",
  "services/solver.ts",
  "services/unstructuredParser.ts",
  // Official test & builder scripts ONLY
  "scripts/test_presets_integrity.ts",
  "scripts/test_wizard_stepper.ts",
  "scripts/test_layout_rtl.ts",
  "scripts/test_diff_engine.ts",
  "scripts/e2e_comprehensive_test.ts",
  "scripts/test_dialects_and_chat.ts",
  "scripts/test_moteer_integration.ts",
  "scripts/test_exports.ts",
  "scripts/test_ai_agent_e2e_memory.ts",
  "scripts/build_clean_repo.ts",
];

// Forbidden patterns that must NEVER appear in any file of the clean public repo or its dist/ build
const FORBIDDEN_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "Google API Key (AIza...)", regex: /AIzaSy[0-9A-Za-z\-_]{20,}/ },
  { name: "Vertex/Google Token (AQ.Ab8...)", regex: /AQ\.Ab8[0-9A-Za-z\-_.]{15,}/ },
  { name: "GitHub Personal Access Token (ghp_...)", regex: /ghp_[0-9A-Za-z]{20,}/ },
  { name: "Hardcoded License Salt/Master Key", regex: /ADMIN-MASTER-2026|AI_STUDIO_2026_TIMETABLE_PRO_SALT/ },
  { name: "Private School 376 Name (يحيى العريني)", regex: /يحيى العريني/ },
  { name: "Private School Moteer Name (عرب مطير)", regex: /عرب مطير/ },
  { name: "Private Teacher Name (ريا عزت)", regex: /ريا عزت/ },
  { name: "Private Teacher Name (ماهر عبدالفتاح)", regex: /ماهر عبدالفتاح/ },
  { name: "Private Teacher Name (نوال شعبان)", regex: /نوال شعبان/ },
  { name: "Private Teacher Name (حسام صلاح)", regex: /حسام صلاح/ },
  { name: "VITE_ Exposed API Key Variable", regex: /VITE_[A-Z0-9_]*KEY/ },
];

// Test files intentionally assert that dummy test keys (AIzaSyDummy... / AIzaSySuperSecretBackupTestKey...) are redacted
const ALLOWED_TEST_DUMMY_KEY_FILES = new Set([
  path.normalize("scripts/e2e_comprehensive_test.ts"),
  path.normalize("scripts/build_clean_repo.ts"),
]);

function ensureCleanDirectory(dir: string) {
  if (fs.existsSync(dir)) {
    // Safely remove junction first if present so we never touch source node_modules
    const nmPath = path.join(dir, "node_modules");
    if (fs.existsSync(nmPath)) {
      try {
        fs.unlinkSync(nmPath);
      } catch {
        fs.rmSync(nmPath, { recursive: true, force: true });
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyAllowlistedFiles() {
  console.log(`\n📦 Building clean public repository in: ${TARGET_DIR}`);
  ensureCleanDirectory(TARGET_DIR);

  let copiedCount = 0;
  for (const relPath of ALLOWLIST_FILES) {
    const srcFile = path.join(SOURCE_DIR, relPath);
    const dstFile = path.join(TARGET_DIR, relPath);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`Allowlisted file missing in source: ${relPath}`);
    }
    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
    fs.copyFileSync(srcFile, dstFile);
    copiedCount++;
  }
  console.log(`  ✅ Copied ${copiedCount} allowlisted files (0 private files, 0 .env files).`);
}

function scanDirectoryForSecrets(rootDir: string, relativePrefix = ""): string[] {
  const findings: string[] = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(rootDir, entry.name);
    const relPath = path.normalize(relativePrefix ? path.join(relativePrefix, entry.name) : entry.name);

    if (entry.isDirectory()) {
      findings.push(...scanDirectoryForSecrets(fullPath, relPath));
    } else if (entry.isFile()) {
      const content = fs.readFileSync(fullPath, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (
          pattern.name === "Google API Key (AIza...)" &&
          ALLOWED_TEST_DUMMY_KEY_FILES.has(relPath)
        ) {
          // Ensure only dummy test keys exist in the test file, never real keys
          const matches = content.match(/AIzaSy[0-9A-Za-z\-_]{20,}/g) || [];
          const nonDummy = matches.filter(
            (m) => !m.startsWith("AIzaSyDummy") && !m.startsWith("AIzaSySuperSecretBackupTestKey")
          );
          if (nonDummy.length > 0) {
            findings.push(`${relPath}: Found non-dummy Google API Key!`);
          }
          continue;
        }
        if (
          pattern.name === "Vertex/Google Token (AQ.Ab8...)" &&
          ALLOWED_TEST_DUMMY_KEY_FILES.has(relPath)
        ) {
          const matches = content.match(/AQ\.Ab8[0-9A-Za-z\-_.]{15,}/g) || [];
          const nonDummy = matches.filter((m) => !m.includes("_test_secret_token_"));
          if (nonDummy.length > 0) {
            findings.push(`${relPath}: Found non-dummy AQ.Ab8 token!`);
          }
          continue;
        }
        if (
          ALLOWED_TEST_DUMMY_KEY_FILES.has(relPath) &&
          relPath === path.normalize("scripts/build_clean_repo.ts")
        ) {
          continue;
        }
        if (pattern.regex.test(content)) {
          findings.push(`${relPath}: Matched forbidden pattern [${pattern.name}]`);
        }
      }
    }
  }
  return findings;
}

function main() {
  copyAllowlistedFiles();

  // Verify excluded files are NOT present in target
  const forbiddenFiles = [
    ".env",
    "presets/school376.private.ts",
    "standalone.html",
    "scripts/push.js",
    "scripts/push.ps1",
    "scripts/sync_to_repo.ps1",
  ];
  for (const f of forbiddenFiles) {
    if (fs.existsSync(path.join(TARGET_DIR, f))) {
      throw new Error(`Security Violation: Forbidden file ${f} was found in clean repo!`);
    }
  }
  console.log("  ✅ Verified all private/env/push files are excluded from clean repo.");

  // Create temporary node_modules junction in TARGET_DIR to run tsc, vite build, and all 5 test suites
  const srcNodeModules = path.join(SOURCE_DIR, "node_modules");
  const dstNodeModules = path.join(TARGET_DIR, "node_modules");
  fs.symlinkSync(srcNodeModules, dstNodeModules, "junction");

  const nodeExe = process.execPath;
  const runCmd = (label: string, args: string[]) => {
    console.log(`\n▶ [Clean Repo] ${label}...`);
    const cmd = `"${nodeExe}" --experimental-strip-types --no-warnings ${args.join(" ")}`;
    execSync(cmd, { cwd: TARGET_DIR, stdio: "inherit" });
  };

  try {
    // 1. Lint
    runCmd("1. TypeScript Lint (tsc --noEmit)", ["./node_modules/typescript/bin/tsc", "--noEmit"]);

    // 2. Build (generates dist/ with bundled Tailwind CSS)
    runCmd("2. Production Build (vite build)", ["./node_modules/vite/bin/vite.js", "build"]);

    // 3. Run all 5 test suites inside the clean public repo (where school376.private.ts and real .md files DO NOT EXIST)
    runCmd("3. Test Suite 1 (services/scheduler.test.ts)", [
      "--import",
      "tsx",
      "--test",
      "services/scheduler.test.ts",
    ]);
    runCmd("4. Test Suite 2 (scripts/e2e_comprehensive_test.ts)", [
      "./node_modules/tsx/dist/cli.mjs",
      "scripts/e2e_comprehensive_test.ts",
    ]);
    runCmd("5. Test Suite 3 (scripts/test_dialects_and_chat.ts)", [
      "./node_modules/tsx/dist/cli.mjs",
      "scripts/test_dialects_and_chat.ts",
    ]);
    runCmd("6. Test Suite 4 (scripts/test_moteer_integration.ts)", [
      "./node_modules/tsx/dist/cli.mjs",
      "scripts/test_moteer_integration.ts",
    ]);
    runCmd("7. Test Suite 5 (scripts/test_exports.ts)", [
      "./node_modules/tsx/dist/cli.mjs",
      "scripts/test_exports.ts",
    ]);

    // 4. Secret & Privacy Audit on both source files and compiled dist/
    console.log("\n🔍 [Clean Repo] Running Secret & Privacy Scan on source code AND dist/...");
    const findings = scanDirectoryForSecrets(TARGET_DIR);
    if (findings.length > 0) {
      console.error("❌ Secret/Privacy Scan FAILED:");
      for (const f of findings) console.error("  - " + f);
      process.exit(1);
    }
    console.log("  ✅ Secret & Privacy Scan PASSED: 0 secrets, 0 private school names in source & dist/!");
  } finally {
    // Remove the temporary node_modules junction and export_samples generated by test_exports
    try {
      fs.unlinkSync(dstNodeModules);
    } catch {}
    const expSamples = path.join(TARGET_DIR, "export_samples");
    if (fs.existsSync(expSamples)) {
      fs.rmSync(expSamples, { recursive: true, force: true });
    }
  }

  // Initialize a fresh local Git repository in TARGET_DIR and create initial clean commit (NO push)
  console.log("\n📌 Initializing clean Git history in clean_public_repo...");
  execSync("git init", { cwd: TARGET_DIR, stdio: "inherit" });
  execSync('git config user.name "AI Timetable Studio"', { cwd: TARGET_DIR, stdio: "inherit" });
  execSync('git config user.email "studio@local.dev"', { cwd: TARGET_DIR, stdio: "inherit" });
  execSync("git add -A", { cwd: TARGET_DIR, stdio: "inherit" });
  execSync('git commit -m "feat: initial public release of AI School Timetable Studio (BYOK, Local-First)"', {
    cwd: TARGET_DIR,
    stdio: "inherit",
  });

  console.log("\n======================================================================");
  console.log("🎉 CLEAN PUBLIC REPOSITORY BUILT, VERIFIED & COMMITTED SUCCESSFULLY!");
  console.log(`📁 Location: ${TARGET_DIR}`);
  console.log("======================================================================");
}

main();
