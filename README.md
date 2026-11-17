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
شغّل خادماً محلياً من جذر المستودع (مثلاً `npx serve .`) ثم افتح `examples/browser-smoke.html`. تختبر الصفحة تحميل صور SVG وفك ترميزها فعلياً، وتركيب مشاهد متعددة الطبقات، وتحريك شخصيتين عبر Character Stage، وتنسيق حركة الشخصيات والصوت وأحداث timeline بواسطة Cinematic Director على ساعة مشتركة، وparallax وcamera track (pan/zoom/rotation) وcamera shake والجسيمات، وانتقالات Web Animations API أو CSS fallback، وصوتاً مولداً محلياً يبدأ بتفاعل المستخدم، ثم تنظيف runtime والأصول. هذا اختبار يدوي في متصفح حقيقي وليس جزءاً من CI حالياً؛ نجاح اختبارات Node وحده لا يثبت سلامة العرض على Android WebView. تم ضبط حساب اهتزاز الكاميرا على توقيت Director النسبي، وتُسلسل تحديثات المشهد عبر الساعة المشتركة.

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
- `createAudioCueController({ cues, play, stop, pauseVoice, resumeVoice, setVolume })`: جدولة أصوات المشهد حسب التوقيت؛ يوقف ويستأنف الأصوات النشطة فعلياً مع الحفاظ على مؤشر الـ cues، ويتجاوز cues التي انتهى وقتها أثناء الإيقاف.
- `createHTMLAudioAdapter({ resolveAsset, createAudio, onPlaybackError })`: adapter اختياري لـ HTMLAudio في المتصفح وAndroid WebView، يدعم pause/resume دون تحرير الصوت، ويتجاهل رفض Promise المتأخر بعد stop ويعزل أخطاء callback.
- `createAdaptivePerformanceMonitor(...)`: قياس أزمنة الإطارات المقدمة من المضيف، وخفض/رفع الجودة تدريجياً مع hysteresis.
- `createRuntimeActivityGate({ onPause, onResume })`: بوابة صريحة لإيقاف واستئناف المؤثرات عندما تصبح اللعبة غير نشطة أو مخفية.
- `createPageLifecycleAdapter({ target, setActive })`: محول اختياري يربط `visibilitychange` و`pagehide` و`pageshow` ببوابة النشاط عبر EventTarget يحقنه المضيف؛ لا يستخدم globals ولا يفرض اعتماد المتصفح على الوحدات الأساسية.
- `createCinematicRuntime({ root, loadAsset, renderScene, lifecycleTarget, audioController, onAudioError, ... })`: واجهة تجميع للمضيف تربط إدارة الأصول والمشاهد والانتقالات وملف الأداء. تمرير `lifecycleTarget` (مثل `document`) يفعّل ربط الصفحة تلقائياً؛ ويمكن التحكم به عبر `startPageLifecycle()` و`stopPageLifecycle()` و`syncPageLifecycle()` وفحص `isActive()`. يمكن تمرير `audioController` اختياري يملكه التطبيق المضيف، ويجب أن يوفّر `pause()` و`resume()`؛ عند استعمال `createCinematicDirector` مرّر كائن director نفسه حتى تتوقف ساعة المشهد والشخصيات والصوت معاً، لا متحكم الصوت وحده. يعيد director معايرة أول إطار بعد العودة ويستبعد مدة الخلفية من ساعة القصة. يجب أن تستخدم طبقات الخلفية والكاميرا والجسيمات القيمة `timeMs` المعادة من `director.update()` بدلاً من حساب الوقت الخام مستقلاً، حتى لا تقفز الرسوم عند العودة. إذا فشل إيقاف أحد الأصوات، يظل director في حالة paused ويُبلّغ الخطأ دون مواصلة تقدم المشهد. يستدعي runtime الدالتين عند إخفاء/إظهار الصفحة، لكنه لا يدمّر المتحكم ولا يمتلكه. أخطاء الصوت المتزامنة تُرسل إلى `onAudioError(error, { phase })` ولا تمنع إغلاق/فتح بوابة النشاط. رفض `HTMLAudio.play()` غير المتزامن يُرسل عبر `onPlaybackError` الخاص بالمحول. عند الإخفاء يتوقف قبول عينات الأداء، وتُصفّر نافذة القياس دون تغيير مستوى الجودة المختار.
- `createCinematicDirector({ characterStage, audio, timeline, onEvent })`: ساعة سينمائية مشتركة تنسق تحديث الشخصيات والصوت وأحداث المشهد. عند pause/resume تعيد معايرة أول timestamp بعد العودة لاستبعاد مدة الخلفية، حتى لو كان المضيف يستخدم `performance.now()`؛ كما تبقى عمليات rewind الصريحة مدعومة. المضيف يظل مسؤولاً عن جدولة الإطارات.
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

## خارطة الطريق
- **P0 — Foundation:** مكتمل؛ ملفات الأداء والحركة والمشهد واختبارات CI.
- **P1 — Scene & Background Runtime:** مخطط الطبقات وعارض DOM وإدارة الأصول (cache / dedup / preload) منفذة ومغطاة باختبارات؛ منسّق دورة حياة الانتقالات ومحول DOM للـ crossfade منفذان ومغطّيان باختبارات Fake DOM؛ ما زال ينقص اختبار متصفح حقيقي وتحميل الصور الفعلي.
- **P2 — Character Motion:** المسارات 2D والخطوط الزمنية ومتحكم الشخصية ومحول DOM للـ sprites منفذة ومغطاة باختبارات محاكاة؛ ما زال ينقص اختبار المتصفح الفعلي ومزامنة الحركة مع الصوت.
- **P3 — Cinematic Effects:** parallax وcamera shake وcamera track لمسارات pan/zoom/rotation وparticle field وlighting/fog samplers منفذة؛ ما زالت مؤثرات shader والاختبار البصري الفعلي لاحقاً.
- **P4 — Audio:** جدولة cues والتحكم في pause/resume على مستوى الأصوات النشطة والـ volume عبر adapter محايد للمنصة منفذة؛ محول HTMLAudio يدعم إيقاف/استئناف الصوت ومعالجة رفض التشغيل المتأخر؛ يبقى اختبار الصوت الفعلي على متصفح وجهاز Android WebView.
- **P5 — Adaptive Runtime:** مراقبة frame-time وتغيير الجودة مع hysteresis وبوابة إيقاف/استئناف منفذة؛ محول Page Visibility/Page Lifecycle اختياري أصبح متاحاً، ويبقى ربط lifecycle Android الأصلي واختبار الأجهزة.
- **P6 — Integration:** runtime تجميعي مستقل للمضيف ومنسق سينمائي مشترك الساعة منفذان؛ يبقى إنشاء adapter خاص بقرطاج وربطه واختباره على Android خطوة منفصلة بعد اكتمال التحقق.

## الحالة
P0 مكتملة. في P2 أضيفت مسارات 2D وخط زمني للأحداث ومتحكم شخصية محايد للمنصة ومحول DOM اختياري للـ sprites. وفي P3 أضيفت حسابات parallax وcamera shake وحقل جسيمات تكيفي deterministic ومعلمات الإضاءة والضباب، وأضيفت وحدة camera track مستقلة لمسارات pan/zoom/rotation مع تركيب shake وتحويل CSS؛ ما زال يلزم اختبارها بصرياً في المتصفح. وفي P4 أضيف متحكم جدولة audio cues يعتمد على adapter خارجي ولا ينشئ AudioContext تلقائياً. وفي P5 أضيف مراقب أداء تكيفي يقيس frame-time عبر المضيف ويبدل الجودة تدريجياً، وبوابة activity gate لإيقاف واستئناف العمل، ومحول صفحة اختياري يربط أحداث visibility/page lifecycle ببوابة النشاط دون فرض browser globals على المحرك الأساسي. يوجد adapter HTMLAudio اختياري مع pause/resume على مستوى الصوت؛ وتم ربطه اختيارياً بدورة حياة runtime عبر audioController دون نقل ملكية الصوت إلى runtime. ما زال يلزم اختبار الصوت الفعلي في متصفح حقيقي وعلى Android WebView. وفي P6 أضيفت واجهة `createCinematicRuntime` لتجميع المشاهد والانتقالات والأصول والأداء عبر callbacks يحددها المضيف، وأضيف `createCinematicDirector` لتنسيق الشخصيات والصوت وأحداث المشهد على ساعة واحدة؛ لم يتم ربطهما بعد بلعبة قرطاج. اختبارات DOM محاكاة ولا تثبت العرض الفعلي في المتصفح أو Android. في P1 أصبح لدينا عارض DOM للطبقات ومدير أصول مستقل مع دمج الطلبات المتزامنة وذاكرة مؤقتة وتحميل مسبق والتحقق من عناوين الأصول. تم توسيع صفحة browser smoke لتكون showcase تكاملياً يربط الخلفيات والشخصيات والمؤثرات والصوت والخط الزمني، لكنها ما زالت تحتاج تشغيلًا يدوياً في متصفح فعلي وAndroid WebView. الاختبارات تستخدم بيئة Node ومحاكاة DOM؛ محول DOM يوفر fade وdissolve بصرياً (opacity + blur) عبر Web Animations API أو CSS fallback؛ لا يتضمن حالياً shader dissolve. لم يتم بعد ربط المحرك بلعبة قرطاج أو اختبار Android، ولا ندّعي جاهزية APK.
