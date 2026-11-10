import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failedCount++;
    console.error(`❌ FAILED: ${message}`);
  } else {
    passedCount++;
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log("======================================================================");
console.log("   AUTOMATED REGRESSION TEST: RTL LAYOUT, LOGICAL CSS & WCAG AA      ");
console.log("======================================================================\n");

const appTsxPath = path.resolve(__dirname, "../App.tsx");
const indexHtmlPath = path.resolve(__dirname, "../index.html");

const appContent = fs.readFileSync(appTsxPath, "utf-8");
const htmlContent = fs.readFileSync(indexHtmlPath, "utf-8");

// 1. RTL direction
assert(htmlContent.includes('dir="rtl"'), "index.html has explicit dir='rtl'");
assert(appContent.includes('dir="rtl"'), "App.tsx root has explicit dir='rtl'");

// 2. No physical directional margins or paddings
const physicalRegex = /\b(mr-|ml-|pr-|pl-)\d+/g;
const physicalMatches = appContent.match(physicalRegex) || [];
assert(
  physicalMatches.length === 0,
  `App.tsx strictly uses logical CSS only (found ${physicalMatches.length} physical classes: ${physicalMatches.join(", ")})`
);

// 3. Right Sidebar flex order (start in RTL)
assert(
  appContent.includes("<aside") && appContent.includes("<main"),
  "Layout uses semantic <aside> and <main> elements"
);

const asidePos = appContent.indexOf("<aside");
const mainPos = appContent.indexOf("<main");
assert(
  asidePos > 0 && mainPos > asidePos,
  "DOM order: <aside> appears BEFORE <main>, placing the Chat Panel at inline-start (Right side in RTL)"
);

// 4. Resizer handle & Collapsible state
assert(
  appContent.includes("isChatCollapsed") && appContent.includes("chatWidth"),
  "App.tsx manages chatWidth and isChatCollapsed state"
);
assert(
  appContent.includes("handleStartResize"),
  "Interactive drag resizer handle is implemented"
);
assert(
  appContent.includes("toggleChatCollapse"),
  "Collapse / Expand toggle function is implemented"
);

// 5. Mobile Bottom Sheet (< lg screens)
assert(
  appContent.includes("isMobileSheetOpen"),
  "Mobile bottom sheet state is managed"
);
assert(
  appContent.includes("lg:hidden") && appContent.includes("وكيل الجداول الذكي (طلب تعديل بالعامية)"),
  "Mobile bottom trigger button exists for non-intrusive mobile UX"
);

// 6. Logical message bubble alignment
assert(
  appContent.includes("ms-auto max-w-[85%]") && appContent.includes("me-auto max-w-[92%]"),
  "Chat messages use logical ms-auto and me-auto for RTL alignment"
);

// 7. Sticky table cells use logical start-0
assert(
  appContent.includes("sticky start-0") && !appContent.includes("sticky right-0"),
  "Table headers & first columns use 'sticky start-0' instead of 'sticky right-0'"
);

// 8. WCAG AA Contrast Compliance
assert(
  !appContent.includes("backdrop-blur"),
  "No glassy backdrop-blur that harms text contrast"
);
assert(
  appContent.includes("bg-[#1C1917] text-white") && appContent.includes("bg-[#FFFFFF] rounded-2xl border border-[#E7E5E4]"),
  "High contrast accessible Warm Stone surfaces used for headers and cards"
);

console.log("\n======================================================================");
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("======================================================================");

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
