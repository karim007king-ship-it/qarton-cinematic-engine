# QARTON Motion Studio — S1

تدقيق وتصميم مبنيان على `main` عند `e01128bdae28058b94169977f8679e7e39889582`. المقترح الأول مشهد عمودي من صورة محلية وصوت مستورد، مع حركة كاميرا وتحريك وجه اختياري عند توفر طبقات الوجه. يستطيع مضيف اللعبة استعمال نفس بيانات الحركة والعرض مع إبقاء التصدير في Studio.

## جرد المحرك

| المجال | الملفات الفعلية وسلوكها | إعادة الاستعمال والفجوة |
|---|---|---|
| تحريك الشخصية | `src/character/character-controller.js` يحسب حالة الشخصية والحركات. `src/character/frame-animation.js` يختار إطارًا من مقطع ويطبق الرمش. `src/character/character-stage.js` يدير دورة حياة الشخصيات وأصولها. `src/character/dom-character-renderer.js` يعرض الشخصية في DOM. | نستعمل حساب الحركة وتوقيت الإطارات ونموذج الأصول. نحتاج تركيب أجزاء الوجه في Canvas. اختيار صورة إطار كاملة يختلف عن تركيب العين والفم في الوقت نفسه. |
| الكاميرا والطبقات | `src/camera/camera-track.js` يبني المسار ويعاين x/y/zoom/rotation ويجمع الاهتزاز. `src/effects/parallax.js` و`src/effects/camera-shake.js` يحسبان الإزاحات. `src/runtime/background-renderer.js` و`src/scene/layer-plan.js` يديران طبقات العرض الحالية. | نعيد استعمال عينات المسارات والحسابات. نترجم التحويلات إلى Canvas مع اختبار مرجع الدوران، واتجاه الإزاحة، وترتيب الكاميرا والطبقات. |
| الزمن والأحداث | `src/motion/timeline.js` يبني قائمة أحداث مؤقتة ويسترجع أحداث الفترة. `src/motion/scene-clock.js` يوفر الإيقاف والاستئناف وseek. `src/motion/easing.js` و`src/motion/path.js` يوفران الاستيفاء والمسار. | نستعمل الساعة للمعاينة والمنحنيات للحركة. نحتاج معاينة مرئية صافية عند زمن مطلق للتصدير، مع منع إعادة إطلاق الأحداث عند أخذ عينة أو التنقل. |
| تشغيل المشهد | `src/scene/scene-package.js` يجمع طبقات وكاميرا وشخصيات وأحداث وصوت JSON v1، و`src/runtime/cinematic-director.js` ينسّق تحديثها. `src/runtime/cinematic-playback.js` يملك ساعة جلسة واحدة وواجهة mount/play/pause/resume/replay/seek/tick/destroy. | نحتفظ بالـScene Package الحالي كمدخل عبر adapter اختياري. التصدير يحتاج عزلاً عن جلسة المعاينة وآثار الصوت والأحداث. |
| الصوت | `src/audio/audio-cue-controller.js` يدير cues والأصوات النشطة، و`src/audio/html-audio-adapter.js` يشغلها عبر HTMLAudio. | مناسب لإشارات الألعاب. الصوت السردي المستمر يحتاج مسارًا جديدًا يحفظ offset عند seek/resume، ويخرج الصوت إلى مسار تسجيل Web Audio. |
| أصول وأداء | `src/assets/asset-manager.js`، `src/core/performance-profile.js`، `src/runtime/adaptive-performance.js`. | نستعمل إدارة أصول المعاينة ومراقبة الأداء حسب الحاجة. التصدير يثبت الأبعاد ومعدل الإطارات المستهدف ويبلّغ عن الانخفاض. |
| المختبرات | `examples/scene-lab/{index.html,lab.js,scene.json}` يجرّب المشاهد وطبقات DOM. `examples/character-lab/{index.html,lab.js,scene.json}` يجرّب الشخصيات والساعة وseek. `examples/playback-lab/{index.html,lab.js}` يجرّب التشغيل والتنقل وتبديل المشهد مع أصوات oscillator. | Playback Lab مرجع دورة الحياة. نحتاج مختبر Canvas مستقل لاختبار ملفات محلية ورسم الوجه وفك ترميز الفيديو الناتج. |
| حدود التصدير الحالي | `src/index.js` و`package.json` يعرّفان واجهات المحرك العامة. `src/runtime/official-intro-player.js` يشغّل فيديو المقدمة الموجود. | لا توجد وحدة إخراج فيديو أو تركيب وجوه أو توقيت viseme في الواجهات الحالية. |

`npm test` على Node 24.22.3 نجح 168/168. من التغطية الموجودة `tests/character-frame-animation.test.js` و`tests/character-stage.test.js` و`tests/camera-track.test.js` و`tests/foundation.test.js` و`tests/scene-package.test.js` و`tests/cinematic-playback.test.js` و`tests/audio-cue-controller.test.js` و`tests/html-audio-adapter.test.js`. الـCI يشغّل Node 22 عبر `.github/workflows/test.yml`. اختبار `tests/browser-smoke-syntax.test.js` يفحص صياغة JavaScript للمثال، لذلك يلزم اختبار تشغيل مستقل في متصفح حقيقي.

## بنية الوحدة وعقودها المقترحة

مسارات مستقبلية بعد الاعتماد. `packages/motion-studio/` يعتمد على الواجهات العامة لـ`@qarton/cinematic-engine`، وفيه وظائف نقية لأخذ عينات المشهد وطبقة Canvas ومنفذ تصدير اختياري. `examples/motion-studio-lab/` يستضيف واجهة التأليف. تطبيق اللعبة يستطيع استيراد العارض والعينات دون واجهة التحرير أو مسجل الفيديو. يبدأ Studio بـJSON منفصل عن حفظ الألعاب.

```ts
type Pose = { x: number; y: number; zoom: number; rotation: number };
type Key<T> = { atMs: number; value: T };
type Viseme = 'rest' | 'closed' | 'open' | 'wide' | 'round' | 'teeth';
type StudioProjectV1 = {
  version: 1;
  durationMs: number;
  viewport: { width: number; height: number; fps: number };
  layers: Array<{ id: string; assetId: string; z: number; track?: Key<Pose>[] }>;
  camera?: Key<Pose>[];
  face?: {
    headLayerId: string;
    pivot: { x: number; y: number };
    eyeAssetIds?: { open: string; closed: string };
    mouthAssetIds?: Record<Viseme, string>;
    headTrack?: Key<Pose>[];
    blinkMs?: number[];
    pupilAssetIds?: { left: string; right: string };
    gaze?: Key<{ x: number; y: number }>[];
    mouth?: Array<{ startMs: number; endMs: number; shape: Viseme }>;
  };
  voice?: { assetId: string; startMs: number; trimInMs: number; trimOutMs: number };
};
```

| API مقترحة | العقد |
|---|---|
| `compileProject(project, assetProvider)` | يتحقق من النسخة، الأبعاد، المدة، المراجع، ترتيب الإطارات ومجالاتها. يرفض IDs المكررة وvisemes المتداخلة. `assetProvider.open(id, signal)` يفتح Blob، والمشروع يحتفظ بالمعرّفات فقط. |
| `session = await createMotionStudio(compiled, { canvas, audio })` | `play()` و`pause()` و`seek(ms)` و`dispose()` غير متزامنة ومتسلسلة. يبدأ الصوت بعد تفاعل المستخدم. إعادة التشغيل تبدأ من الصفر. إغلاق الجلسة يحرر الصور والصوت وروابط Blob. |
| `sampleFrame(compiled, timeMs)` و`drawFrame(ctx, frame)` | نفس العينة عند نفس الزمن، دون تغيير المشروع أو إطلاق cues. أزمنة بالملي ثانية، ومواضع x/y ببكسل المشهد، محاور الوجه داخل مستطيل الطبقة بإحداثيات 0–1، الدوران بالدرجات، والـzoom معامل ضرب. في الدفعات الحتمية زمن الإطار `1000 * index / fps`، قبل نهاية المدة. |
| `probeExport(profile, { audio, signal })` | يرجع نتيجة كل MIME مع سبب الرفض أو فشل التشغيل. يفرّق بين الدعم المعلن، نجاح ترميز عينة، وإمكانية حفظها عبر المضيف. |
| `exportVideo(compiled, { format, signal, onProgress, sink })` | ينتج MIME والنوع الفعليين والمدة. ملف واحد عبر Blob مبدئيًا، وsink اختياري للمضيف مع إنهاء/إلغاء واضحين. يبلّغ عن `UNSUPPORTED_FORMAT` و`ASSET_NOT_EXPORTABLE` و`ENCODE_FAILED` و`SAVE_FAILED`. اختيار صيغة بديلة يحتاج موافقة واجهة المستخدم. |

يحوّل adapter مسارات Studio إلى عينات مُستمدة من `createCameraTrack` و`sampleCameraTrack`. يتولى Canvas ترتيب الطبقات والتحويلات والقص. تمر المعاينة والتصدير من نفس `drawFrame`. يستعمل المصدّر Canvas وصوتًا خاصين به حتى تظل حالة المعاينة مستقلة. فك صور الإدخال مرة واحدة مع حد للعدد ولإجمالي البكسلات؛ صورة RGBA واحدة بدقة 720×1280 تقارب 3.5 MiB في الذاكرة قبل حساب النسخ والطبقات.

## حركة 2D ومزامنة العربية الفصحى

- صورة مسطحة واحدة تدعم pan/zoom وتحريكًا طفيفًا للصورة كاملة. فصل الخلفية والشخصية، وإغلاق جفن أو تبديل الفم، يتطلب طبقات شفافة أو أقنعة محضّرة. نبدأ بتحديد المواضع يدويًا مع معاينة قبل التصدير. التفاف الرأس يمينًا ويسارًا يحتاج إطارات اتجاه جاهزة أو أصلًا مفصولًا. دوران 2D حول عنق الشخصية يدعم الإيماءة والميول البسيطة.
- العينان تستعملان قناعًا مفتوحًا وآخر مغلقًا مع رمش مجدول. اتجاه النظر يستعمل تحريك الحدقة داخل قناع صغير حين يكون الأصل جاهزًا. تتبع أجزاء الوجه تحويل الرأس. نربط عمق الخلفيات بإزاحة الكاميرا ونختبر الزوايا لمنع ظهور الفراغات أو قص الوجه في 9:16.
- المسار الأول لصوت مستورد بالفصحى مع markers يدوية على waveform. أول مجموعة أشكال تغطي السكون، الإغلاق لأصوات ب/م، فتح الفم، تمديد الشفتين، استدارتهما لـ/u/ و/w/ بحسب السياق، ووضع الشفة والأسنان لـ/f/. تُمزج الحركات القريبة على حسب السياق ويعود الفم إلى السكون أثناء الصمت. مسار مستوى الصوت يصلح لمعاينة تقريبية للفك؛ استخراج الحروف من مستوى الصوت غير ممكن.
- المحاذاة الآلية مرحلة مستقلة. نستقبل timestamps من مصدر صوت يولّد حدود الفونيمات أو تجربة forced alignment على تسجيل معلوم النص. نختبر تشكيل الكلمات حين يتوفر، الحركات الطويلة والقصيرة، الشدة، الوقف والوصل، النص غير المشكول والأعلام والكلمات الأجنبية. القواميس والنماذج تحتاج توافق مجموعة الفونيمات والتحقق من الترخيص والملاءمة للفصحى. قاموس MFA العربي مرشح للتقييم. نثبت التوقيت على مرجع بشري قبل الاعتماد، مع تصحيح يدوي دائمًا. تُخزَّن فترات mouth بزمن المشهد. عند استيراد محاذاة، تُقص فترات المصدر إلى trimInMs–trimOutMs ثم تتحول بواسطة sceneMs = startMs + sourceMs - trimInMs.

## جدوى WebM وMP4

| المسار | التقييم |
|---|---|
| المتصفح | Canvas 2D origin-clean ← `captureStream(24)` + مسار Web Audio عبر `createMediaStreamDestination()` ← `MediaRecorder`. نجرب WebM VP8/Opus أولًا وMP4 AVC/AAC عند الطلب. نختبر `isTypeSupported` ثم construct/start/stop وBlob صالحًا. تسجيل الزمن الحقيقي يتأثر بخروج التطبيق للخلفية وبضغط الجهاز. |
| MP4 مباشر في WebView | وجود H.264 في نظام Android لا يثبت إتاحته عبر MediaRecorder. يُجرَّب MIME فعليًا ثم يُتحقق من الحاوية والمسارين، وإمكانية seek وفتح النتيجة من تطبيق الملفات. |
| MP4 بديل | WebCodecs مع muxer إذا أثبت الجهاز دعم H.264/AAC وقدرة الحفظ. عند غياب المسار أو الحاجة لتوافق APK نقيّم جسر Android اختياريًا يعتمد MediaCodec وMediaMuxer مع كتابة الملف في التخزين عبر المضيف. تُحسم صلاحية كل مسار بالتجربة قبل إدراجه في المنتج. |

**اختبار S1 المنفذ.** على Linux، أنشأ FFmpeg لقطة اصطناعية عمودية 720×1280 بمعدل 24 إطارًا/ثانية مع نبضة صوت حول الثانية 1. أثبت `ffprobe` المسارين في كل ملف وفك FFmpeg ترميزهما كاملين بدون خطأ.

| الملف | الفيديو والصوت | المدة | الحجم |
|---|---|---:|---:|
| WebM | VP8 / Opus | 3.008 ثانية | 1,135,860 بايت |
| MP4 | H.264 / AAC | 3.000 ثانية | 1,148,092 بايت |

إعادة الاختبار لكل زوج من codecs. عوّض `VIDEO` و`AUDIO` بـ`libvpx libopus` أو `libx264 aac`، واختر امتداد الحاوية الموافق.

```sh
ffmpeg -f lavfi -i 'testsrc2=size=720x1280:rate=24' \
  -f lavfi -i 'sine=frequency=880:sample_rate=48000' \
  -af "volume=enable='not(between(t,1,1.15))':volume=0" \
  -t 3 -threads 2 -c:v VIDEO -b:v 3M -c:a AUDIO probe.EXT
ffprobe -v error -show_streams -show_format probe.EXT
ffmpeg -v error -i probe.EXT -f null -
```

تعذّر بدء Chromium المحلي بسبب رفض socket في البيئة قبل تشغيل اختبار MediaRecorder. نتائج الجدول تثبت إنشاء الحاويتين وقراءة محتواهما بمكتبات سطح المكتب. جدوى MediaRecorder والحفظ على Android ما زالت مفتوحة. الاختبار الأول بعد اعتماد S1 يكون على HONOR 400 Pro في Chrome ثم داخل APK WebView. نسجل إصدار التطبيق والمكوّن، MIME المعلن والفعلي، الأبعاد، مدة الملف، حمل الذاكرة عند توفر قياس، وحصيلة الحفظ وإعادة الفتح. تسجيل 3 ثوانٍ أولًا ثم 10 ثوانٍ متتالية ثلاث مرات، مع علامة مرئية ونبضة صوت للتحقق من انحراف الصوت عن الصورة. هدف قبول أولي ±80 ms ومدة ضمن ±200 ms لمقطع 10 ثوانٍ، مع مسارَي فيديو وصوت صالحين وعدم انهيار الجلسة. هذه أهداف اختبار ولم تُقَس في S1.

## التنفيذ بعد اعتماد S1

| المرحلة | صاحب المهمة | شرط الخروج |
|---|---|---|
| S2-A جدوى التصدير | Luna 6 | صفحة اختبار معزولة تستورد ملفًا محليًا، ترسم مؤشرًا متحركًا وتولد النبضة الصوتية، وتسجل نتائج Chrome وWebView حسب جدول S1. تشارك العينة والقيم في PR اختبارات مستقل. |
| S2-B العينات والعرض | Sol 6.2 | تثبيت schema وadapter لمسارات المحرك، ورسم Canvas حتمي مع parity لزوايا الكاميرا والطبقات. |
| S3 تحريك الوجه | Luna 6 | شخصيتان أو صورتان تجريبيتان مرخصتان، رمش وإيماءة وvisemes يدوية، واختبارات على seek وتزامن أجزاء الوجه. تبدأ بعد تثبيت schema. |
| S4 الصوت والتصدير | Sol 6.2 | تطبيق مسار الصوت المستمر، تصدير WebM، ثم اختيار حل MP4 بناء على قياس S2-A. يثبت حفظ الملفات وفك ترميزها. |
| S5 تقييم المحاذاة | Luna 6 | عينات قصيرة معلّمة من العربية الفصحى، مقارنة يدوي/تقريبي/محاذاة فونيمات، وتقرير حالات الخطأ والترخيص. |
| S6 الدمج الاختياري | Sol 6.2 | مثال standalone وAPI موثّق للاستهلاك الاختياري، مع تشغيل اختبارات المحرك وأي adapter تجريبي دون تعديل مشاريع الألعاب. |

## المخاطر والاختبارات التي تغطيها

| الخطر | الاختبار المطلوب |
|---|---|
| خطأ التحويلات أو اقتصاص وجه أو خطأ overscan | golden frames لأوضاع رأس وكاميرا متزامنة، وحواف نقاط الرمش وبداية ونهاية المسارات، على أبعاد عمودية وأفقية. |
| تكرار الأحداث أو صوت عالق بعد seek | انتقال بين play/pause/seek/replay وdispose، وseek للخلف وأثناء التسجيل. تحقق من إلغاء المصادر السابقة وإعادة شروع الصوت من offset الصحيح. |
| انجراف الصوت dropped frames أو ملف بلا مسار صوت | مقارنة العلامة/النبضة في بداية ووسط وآخر المقطع، فحص الحاوية والمسارات وإعادة فتح الملف من المعرض وتطبيق الملفات. |
| نفاد الذاكرة، نقص المساحة، تعليق التصدير | 3 دورات متتالية 10 ثوانٍ، ملف كبير، مساحة منخفضة، وضع الخلفية، cancel/retry، والتحقق من تحرير المصادر وحذف الملفات المؤقتة عند الفشل. |
| صورة خارجية أو اتجاه EXIF | ملفات محلية شفافة، ملفات مقلوبة الاتجاه وملف تالف، أصل cross-origin دون CORS، ورسالة واضحة في حال رفض captureStream. |
| اختلاف وسيلة الحفظ بين Chrome وAPK | تجربة الحفظ وإعادة فتح الملف ونوعه وامتداده. اختبار رفض إذن الحفظ، وإلغاء المشاركة، ورفض صيغة غير مدعومة. |
| جودة فم الفصحى | عينة فيها صمت وشدة وإغلاق شفاه وحركات طويلة، مراجعة بشرية لتوقيت visemes وفشل المحاذاة دون تعطيل التحرير اليدوي. |

## مراجع

- [MDN — Canvas captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)
- [MDN — MediaRecorder isTypeSupported](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static)
- [MDN — WebCodecs video processing concepts](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Video_processing_concepts)
- [Android Developers — Supported media formats](https://developer.android.com/media/platform/supported-formats)
- [Montreal Forced Aligner — Arabic dictionary](https://mfa-models.readthedocs.io/en/latest/dictionary/Arabic/Arabic%20MFA%20dictionary%20v2_0_0.html)
- [Montreal Forced Aligner — Alignment workflow](https://montreal-forced-aligner.readthedocs.io/en/v3.3.7/user_guide/workflows/alignment.html)
