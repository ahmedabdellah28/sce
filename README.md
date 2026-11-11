# دليل تطبيق التحديثات المباشرة لمشروع SCE (School Timetable Studio)

الملفات في هذا المجلد تم تجهيزها **بنفس المسارات والمسميات والتوقيعات الأصلية 100%**:

## الملفات المستبدلة:
1. `services/schoolAssistant.ts`:
   - يحتفظ بنفس التوقيع الأصلي:
     `export function isQuestionOrInquiry(message: string): boolean`
     `export function answerSchoolQuestion(school: SchoolData, schedule: Schedule | null, message: string, analysisReport?: AnalysisReport): AssistantAnswer`
   - يحل ثغرة طول السؤال (>= 5 أسطر و >= 150 حرفاً).
   - يتعرف على أسئلة المحاكاة والافتراض (ماذا لو، هل يمكن، هل لو نقلنا، هل يحدث تعارض) والأسئلة الاستشارية (اقترح، ما رأيك، تحسين، عدالة) ويجيب عليها باحترافية بـ `answered: true` دون تعديل الجدول أو تحويلها لأمر تعديل قسري.

2. `services/geminiService.ts`:
   - يحتفظ بنفس التصدير: `export const AGENT_SYSTEM_INSTRUCTION` و `export class HybridSchoolService`.
   - يوجه النموذج بدقة للفصل بين الإجابة الاستشارية والمعلوماتية (`operations: []`) وبين أوامر التعديل الصريحة، مع اقتراح بدائل خالية من التعارض عند تعذر التعديل.

3. `services/schoolCore.ts`:
   - يضيف دالتي التحقق المسبق:
     `validateEffectiveTeacherCapacity` (فحص السعة الفعلية مع الإجازات).
     `canSafelyPlaceLesson` (منع وضع حصة في يوم إجازة المعلم أو خلق تعارض مباشر).

4. `services/solver.ts`:
   - يضيف الحساب الديناميكي لميزانية الوقت والبذرة العشوائية المتجددة عند إعادة المحاولة:
     `resolveDynamicSolverOptions`.

5. `services/unstructuredParser.ts`:
   - يوسع التعابير النمطية لتشمل الصفوف من 1 إلى 12 وكافة الأنماط النصية.

---
## خطوات الرفع إلى GitHub:
1. فك ضغط ملف `sce_project_ready_replacement.zip`.
2. انسخ مجلد `services/` واستبدل به مجلد `services/` الموجود في مشروعك المحلي.
3. نفذ الأمر في الطرفية (Terminal):
   ```bash
   git add services/
   git commit -m "fix(agent-core): upgrade intent router, what-if queries, solver timeout & capacity validation"
   git push origin main
   ```
