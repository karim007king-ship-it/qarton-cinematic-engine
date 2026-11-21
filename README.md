# QARTON Cinematic Engine

محرك سينمائي مستقل وقابل لإعادة الاستخدام في ألعاب وتطبيقات QARTON.

## القرارات المعتمدة
- **Independent:** لا يعتمد على كود لعبة قرطاج ولا يفرض إطار عمل معيناً.
- **Full scope:** مشاهد وخلفيات وطبقات عمق وتحريك وانتقالات ومؤثرات وصوت وأدوات أداء.
- **Adaptive performance:** يختار مستوى التأثيرات وفق قدرات الجهاز ومعدل الإطارات وتفضيل تقليل الحركة.
- **Progressive integration:** لا يتم ربطه بلعبة قرطاج قبل اجتياز الاختبارات وتثبيت واجهات التكامل.

## البنية
```text
src/
  core/          # إعدادات الأداء والقدرات
  motion/        # منحنيات الحركة والمسارات والخطوط الزمنية
  character/     # متحكمات حركة الشخصيات
  scene/         # تعريف المشاهد والخلفيات والطبقات
  effects/       # parallax واهتزاز الكاميرا والجسيمات
  camera/        # مسارات pan / zoom / rotation للكاميرا
  audio/         # جدولة الصوت ومزامنة الـ cues
  runtime/       # عارض المشاهد وطبقات DOM
  assets/        # تحميل الأصول والتخزين المؤقت
tests/
```

## البدء
يتطلب Node.js 22 أو أحدث.
```bash
npm test
```

### اختبار المتصفح الحقيقي
من جذر المستودع شغّل `python -m http.server` وافتح `/docs/`. التجربة الأصلية تختبر الانتقال والصوت بعد اللمس. تجربة المرصد تقرأ ملف JSON وصوراً خارجية وتعرض المشي والإيماءة وحركة الطبقات والكاميرا. يشغّل GitHub Actions التجربتين باستخدام Playwright في Chrome على سطح المكتب وبمحاكاة Pixel 7 قبل النشر.

## تعريف المشهد المستقل

تستقبل `createScenePackage(data)` تعريفاً بإصدار `version: 1`. يحتفظ المضيف بملفات الصور والصوت، ويحدد كيف تتحول مفاتيحها إلى عناوين. مثال قابل للتشغيل في [تعريف المرصد](examples/scene-lab/scene.json) و[مشغّل التجربة](examples/scene-lab/lab.js).

| مدخل JSON | استعماله في المضيف |
|---|---|
| `id, durationMs, layers` | مرّر `pack.scene` إلى runtime وBackgroundRenderer. ترتّب الطبقات حسب الدور والعمق. |
| `camera, layers[].keyframes` | عينات pan وzoom وrotation بالتوقيت المطلق بالميلي ثانية. الطبقة دون مسار تبقى ثابتة. |
| `characters` | مرّر `pack.characters` إلى CharacterStage. تحدّد الصورة عبر التعبير، وتحدّد الحركة عبر مسار ونوع مثل walk أو gesture. |
| `events, audioCues` | مرّر `pack.timeline` إلى Director و`pack.audioCues` إلى متحكّم الصوت مع مشغّل يوفّره المضيف. |
| `transitionMs` | مرّره إلى `transitionTo(scene, {duration: pack.transitionMs})`. |

استخدم `pack.imageKeys(profile)` للتحميل المسبق حسب ميزانية الطبقات. خصّص مدير أصول لكل مضيف أو استخدم مفاتيح ذات بادئة مميزة عند مشاركة المدير. استدعِ `destroy()` عند إنهاء التجربة. يحتفظ المتصفح بإدارة ذاكرة التخزين المؤقت للشبكة. الواجهة السابقة `createSceneDefinition` تظل مدخلاً صالحاً للمشاهد البسيطة.

## واجهة API الحالية
- `resolveQualityProfile(device)`: اختيار ملف أداء low / medium / high.
- `clamp(value, min, max)`, `lerp(from, to, progress)`, `easeInOutCubic(progress)`.
- `createMotionPath(points)` و`sampleMotionPath(path, progress, easing)`: مسارات 2D محايدة للمنصة مع أخذ عينات للحركة.
- `createTimeline(events)` و`getTimelineEvents(timeline, range)`: ترتيب أحداث الصوت/التعبير/الكاميرا وإرجاع الأحداث ضمن نافذة زمنية ثابتة.
- `createCharacterController({ id, initial, motions })`: حساب موضع الشخصية وحالتها وتعبيرها وخصائصها عبر الزمن دون ربطها بـ DOM أو محرك رسم.
- `createDOMCharacterRenderer({ root, resolveSprite })`: محول اختياري لعرض sprites عبر DOM، مع حقن تحميل الأصول وحماية من نتائج التحميل القديمة.
- `computeParallaxOffset(...)`: حساب حركة طبقات العمق مع حد أقصى للإزاحة.
- `sampleCameraShake(...)`: اهتزاز كاميرا deterministic يتلاشى زمنياً.
- `createCameraTrack(keyframes)`: مسار كاميرا مستقل يدعم pan وzoom وrotation عبر keyframes مرتبة زمنياً مع easing حتمي.
- `sampleCameraTrack(track, timeMs)`: أخذ عينة من وضع الكاميرا عند أي توقيت، مع تثبيت الوضع قبل أول keyframe وبعد آخر واحد.
- `composeCameraPose(pose, shake)`: دمج حركة الكاميرا مع اهتزازها دون تعديل المدخلات.
- `toCameraCSS(pose)`: تحويل وضع الكاميرا إلى CSS transform لعنصر viewport يملكه التطبيق المضيف.
- `createParticleField(...)`: حقل جسيمات deterministic يراعي `profile.particleBudget`.
- `resolveLighting(...)` و`sampleFog(...)`: معلمات إضاءة وضباب تتكيف مع ملف الجودة.
- `createAudioCueController({ cues, play, stop, setVolume })`: جدولة أصوات المشهد حسب التوقيت، مع pause/resume والتحكم بالصوت عبر adapter يقدمه التطبيق.
- `createHTMLAudioAdapter({ resolveAsset, createAudio })`: adapter اختياري لـ HTMLAudio في المتصفح وAndroid WebView، مع حقن إنشاء الصوت وحجم عام لكل الأصوات.
- `createAdaptivePerformanceMonitor(...)`: قياس أزمنة الإطارات المقدمة من المضيف، وخفض/رفع الجودة تدريجياً مع hysteresis.
- `createRuntimeActivityGate({ onPause, onResume })`: بوابة صريحة لإيقاف واستئناف المؤثرات عندما تصبح اللعبة غير نشطة أو مخفية.
- `createCinematicRuntime({ root, loadAsset, renderScene, ... })`: واجهة تجميع للمضيف تربط إدارة الأصول والمشاهد والانتقالات وملف الأداء في runtime واحد، دون الاعتماد على مشروع لعبة محدد.
- `createCinematicDirector({ characterStage, audio, timeline, onEvent })`: ساعة سينمائية مشتركة تنسق تحديث الشخصيات والصوت وأحداث المشهد، وتدعم pause/resume والرجوع الزمني وإعادة تشغيل الأحداث بشكل حتمي؛ المضيف يظل مسؤولاً عن جدولة الإطارات.
- `createSceneDefinition(config)`: التحقق من تعريف مشهد وطبقاته دون الوصول إلى DOM.
- `buildLayerPlan(scene, profile)`: ترتيب الطبقات وتطبيق ميزانية الخلفيات.
- `AssetManager({ loader })`: تحميل أصول عبر محمّل يوفّره التطبيق، مع دمج الطلبات المتزامنة، وذاكرة مؤقتة، و`preload()` و`release()` و`clear()`.
- `BackgroundRenderer({ root, resolveAsset })`: عارض DOM مستقل؛ يمكن تمرير `key => assetManager.load(key)` كدالة حلّ الأصول. `render()` غير متزامنة، و`clear()` و`destroy()` لتنظيف دورة الحياة.
- `SceneTransitionManager({ mount, crossfade, unmount, duration })`: منسّق انتقالات مستقل عن المنصة؛ يجهّز المشهد الجديد قبل الانتقال، ويحافظ على الحالي عند الفشل، ويلغي نتائج الانتقالات التي تم تجاوزها.
- `createDOMTransitionAdapter({ root, renderScene, duration, reducedMotion, wait, animate })`: محول DOM فعلي يوفر mount / crossfade / unmount / destroy ويمكن تمرير دواله مباشرة إلى `SceneTransitionManager`. يستخدم Web Animations API عند توفره، ويرجع إلى CSS transitions مع wait قابل للحقن. الانتقال الحالي يجمع opacity مع blur، وليس shader أو pixel dissolve. الانتقالات الأحدث تلغي الحركة السابقة، كما أن unmount وdestroy يوقفان الانتقالات النشطة.

كل وحدات المرحلة الأولى JavaScript ES Modules ولا تتطلب مكتبات خارجية.

## مبادئ هندسية
1. لا تعديل مباشر على ملفات لعبة قرطاج من هذا المستودع.
2. لا تشغيل تلقائي للمؤثرات عند الاستيراد؛ لا آثار جانبية.
3. فصل بيانات المشهد عن طريقة عرضه.
4. استخدام تحريك خصائص compositor-friendly قدر الإمكان، وتجنب تحديثات التخطيط المتكررة.
5. احترام `prefers-reduced-motion` وتوفير تعطيل/تقليل الحركة.
6. تمرير حالة نشاط الصفحة أو التطبيق إلى `createRuntimeActivityGate` لإيقاف واستئناف العمل.
7. عدم تحميل الصور/الصوت قبل الحاجة، مع إدارة واضحة للذاكرة.

## حالة التكامل

تغطّي اختبارات Node الوحدات ودورة الحياة، وتفحص اختبارات Chrome التحميل والتفاعل وتنظيف المشهد. أكّد المستخدم عمل أزرار التجربة الأصلية على هاتفه. قياس زمن الإطار والذاكرة داخل Android WebView وتجربة المرصد على جهاز فعلي هما خطوتا التحقق التاليتان. خطّة تكامل الألعاب موجودة في [الخطة الرئيسية](docs/QARTON_MASTER_PLAN.md).
