# L13-S1 — المراجعة الشاملة لواجهة Motion Studio

**مرجع الفحص:** PR #143، رأس الفرع المسترجع فعليًا `7b3a335d85f66ff60187d12edb306cd9486d17ae`، أحدث من 55dd346. المراجعة مستقلة؛ لا تغيير في ملفات محرر الإنتاج أو المحرك أو الألعاب. النموذج مستقل ولا يستخدم API أو تسجيلًا/تصديرًا حقيقيين.

## 1. نطاق الأدلة

جرد [control-matrix.csv](control-matrix.csv) يضم **167 صفًا**: عناصر HTML الأصلية (الأزرار، الحقول، القوائم مع قيم الخيارات، منزلقات، labels، روابط، مقاطع فيديو، أدوات إفصاح، مؤشرات، مناطق لوحة المفاتيح) + 18 عائلة عناصر تُنشأ ديناميكيًا. صف كل عنصر يحدد نقطة الربط، الحالة الأولية، القيود، شروط التفعيل، ملاحظة UX، التوصية واختبار القبول. أيقونات SVG مرفقة بصف الزر المالك؛ رموز النص مذكورة في التسمية. العناصر المتكررة من مشاهد/أصول/مقاطع/مفاتيح تسجل كعائلة لا كعدد ثابت. عناصر العرض غير التفاعلية (canvas/status/outputs/rulers) مغطاة أدناه. لا يفهم وجود handler أنه إثبات نجاح وظيفي على Android.

### مراجعة الملفات (5,851 سطرًا، تشمل مولد HTML)

| الملف | المسؤولية/ملاحظة التنفيذ |
|---|---|
| index.html (400) | DOM قديم ثم حاويات فارغة وإعادة تركيب؛ الحقول كثيرة ووحداتها مختلطة |
| studio.css (423) | قواعد طويلة موروثة ثم overrides؛ تضارب simple/pro؛ أحجام صغيرة |
| studio.js (2933) | ربط الأحداث، التركيب، الحالة، الحفظ، الصوت، الصيغ، معاينة وتصدير؛ مسؤوليات متشابكة |
| studio-timeline.js (263) | مفاتيح كاميرا، drag/capture/keyboard/cancel؛ الحفاظ على focus عند إعادة الرسم |
| studio-character-timeline.js (136) | مسار شخصية، selection/drag/edit، إلغاء الالتقاط؛ يحتاج قسمًا خاصًا |
| studio-character-track.js (120) | قنوات الرأس والعين والجسم والفم والتعبير؛ رسم شخصية، ليس استخراج رأس/فم من صورة عشوائية |
| studio-audio-timeline.js (120) | مسارات الحوار والموسيقى والمؤثر، مستوى لكل مسار، اختيار وسحب مقطع |
| studio-audio-model.js (153) | قيود الملفات، فك مدة الصوت، تحرير المقاطع وviseme؛ الإشارة/الصيغة قرار الجهاز |
| studio-visual-effects-timeline.js (108) | اختيار وسحب وحركة playhead وإلغاء عند blur/visibility؛ أهداف صغيرة |
| studio-visual-effects-model.js (87) | سبعة أنواع منشأة وقنوات From/To مختلفة، تحقق التوقيت والقيم |
| studio-motion-presets.js (110) | ست حركات كاميرا، توليد مفاتيح ضمن نطاق، speed/strength/focus |
| studio-model.js (222) | حدود 3–60ث للمشهد، تحقق viewport، endpoints، JSON أحادي، request token |
| studio-sequence-editor.js (190) | CRUD وإعادة ترتيب وتسمية وتسلسل JSON متعدد؛ لا مسح قديم في L13 |
| studio-sequence-runtime.js (133) | تشغيل تسلسل وصوت، timeout/cleanup؛ فصل العرض من تصدير |
| studio-sequence-export.js (48) | تحضير تسلسل التصدير والمزج واللقطات |
| studio-export-core.js (222) | L5 القديم: profiles/limits/lock/session/test pulses |
| studio-scene-renderer.js (37) | الرسم الفعلي وتجميع الصورة/الكاميرا/الشخصية/المؤثر |
| studio-dimensions.js (54) | سبعة نسب أبعاد + fit/fill، حدود المعاينة |
| studio-image.js (59) | decode الصورة وقيود الحجم/الدقة وبدائل Android |
| studio-errors.js (26) | بناء رسائل الأخطاء وعرض تفاصيلها |
| scripts/motion-studio-preview-html.js (7) | تحويل importmap/module/style إلى مستند مستقل؛ لا تغييره |
| scripts/build-motion-studio-preview.mjs | تجميع ZIP HTML offline؛ ليس إثبات صلاحية ميكروفون file:// |
| .github/workflows/motion-studio-preview.yml / qarton-pages.yml | نشر وبناء واختبار؛ مراجعة مخاطر أدناه |

ملفات المحرك المشتركة التي تُستدعى من الواجهة (packages/motion-studio وsrc) ليست هدف تعديل. يمكن الإبقاء على APIs الحالية.

## 2. نتائج محددة بالأولوية

| ID | أهمية | دليل من المرجع | النتيجة والتعديل المقترح |
|---|---|---|---|
| UX01 | عالية | studio.js:1520–1532 | فتح الصوت/المؤثرات/المزيد أو التصدير يفرض Professional؛ الرجوع للحركة يبقي وضعًا لم يختره المستخدم. فصل القسم عن الوضع. |
| UX02 | عالية | studio.css:192–196, studio.js:39–40,514–515 | منتقي الصورة ينتقل للمعاينة ثم يختفي عند imageReady؛ لا استبدال واضح. إبقاء زر إضافة/استبدال في المشاهد. |
| UX03 | عالية | studio.css:196, studio.js:1265–1300 | previewSceneStrip مخفي دائمًا ولا يملأه renderSequenceOverview؛ المصغرات في تبويب المشاهد فقط. إظهار شريط دائم مع +. |
| UX04 | عالية | studio.js:1526,2770–2790,395–421 | حفظ الرأس ينقر حفظ JSON ويخلط الحفظ المحلي والتصدير كملف؛ المحلي metadata وIndexedDB منفصلان. عنوان الحفظ وحالة آخر حفظ + نسخة احتياطية. |
| UX05 | عالية | studio.js:514–618,907–935,1151–1168,1200–1234,1468–1515 | قفل موزع بين دوال متعددة؛ inspector release قد يعيد تفعيل حسب activeExport بينما exportPreparing فقط؛ motion presets/undo وeffects/audio volume ليست كلها في mic list. يلزم اختبار سباق القفل، لا الادعاء بتلف فعلي. |
| UX06 | عالية | studio.js:550–560,585–618,85–94 | التصدير يحتاج probe منفصل؛ زر الإلغاء الوحيد في L5 المخفي؛ أثناء integrated export يصعب الوصول إليه. نافذة تصدير واحدة مع cancel/progress مخصص. |
| UX07 | عالية | studio.js:85–94؛ integratedFrom/To وsyncIntegratedRange | النص بعد mount يقول المشهد الحالي بينما المصدر يصدر نطاق المشروع؛ legacy L5 اختبار نبضات لا مزج. توحيد النطاق وشرح الصوت. |
| UX08 | متوسطة | studio.css:164–165,335–401 | أوضاع 34–40px، header 38–40px عرض، labels 8–12px، بعض inputs 40–42px؛ أهداف 44×44 و14px للنص المهم. |
| UX09 | متوسطة | studio.js:55–67, studio.css: advanced-motion-drawer | قسم الشخصية تحت advanced motion؛ في simple العنصر مغلق مخفي؛ فصل شخصيات واختصارات الفم. |
| UX10 | متوسطة | studio.js:1468–1515 | ثلاث نسخ Undo لنفس quickMotion؛ لا undo حذف مشهد أو صوت. لا تسمية عامة حتى تنفيذ تاريخ أوامر شامل. |
| UX11 | متوسطة | studio.js:1905–1958,1338 | حذف مشهد مباشر؛ أصول مستخدمة محمية (ميزة تحفظ). إضافة تأكيد أو undo، وحماية آخر مشهد. |
| UX12 | متوسطة | studio.js:2207–2277,2420–2460 | تسجيل يتبع آخر audioTrackType؛ quick music يغيّره؛ المستخدم يتوقع تسجيل حوار. تثبيت dialogue افتراضيًا وإظهار الهدف. |
| UX13 | متوسطة | studio.js:1151–1168,2633–2708 | add manual/delete duplicated؛ صوت عام متقدم؛ اختيار مقطع وسبب عدم ارتباطه غير بارزين. إدراج واحد ثم تشغيل/حذف سياقي. |
| UX14 | متوسطة | studio.css:35–56,91–96; studio.js:1287–1300 | RTL عام وtimestamps LTR جزئيًا؛ sequence block keyboard click يستخدم clientX؛ يسار/يمين للترتيب غير «سابق/تالٍ». خط زمن LTR موحد، labels عربية، أرقام bdi، اختبار keyboard/drag. |
| UX15 | متوسطة | index.html:203–240, CSS:52 | Viseme/Phoneme/From/To/easing/ms/neutral كلمات غير مترجمة؛ labels عربي forced LTR. مفاتيح داخلية ثابتة وترجمة عرض مستقلة وبالثواني. |
| UX16 | متوسطة | studio.js:1122–1149,2270 | solo clip منفصل ميزة جيدة؛ يجب زر إيقاف وحالة واضحة وألا يختلط مع playback. |
| UX17 | متوسطة | studio.js:324–331,395–421 | فشل auto-save في رسالة مكتبة مخفية؛ لا حالة dirty/failed مرئية. شريط حالة دائم، انتقال بعد إعادة ربط. |
| UX18 | متوسطة | studio.css:113–131,206–209,369–391 | 100dvh + scroll داخلي مفيد، لكن درج صغير وتداخل keyboard/landscape؛ status قد يقتطع. قياس فعلي + fallback للارتفاع. |
| UX19 | متوسطة | studio.js:1287–1301; CSS:95 | كتل sequence min 2px، مفاتيح متقاربة؛ اختيار عبر القائمة بديل عن سحب دقيق. |
| UX20 | متوسطة | studio.js:2258–2277,2420–2558 | زر mic ينشأ ديناميكياً؛ aria-label بدء التسجيل يبقى عند الإيقاف. تحديث accessible name، timer، permission denied/retry. |
| UX21 | متوسطة | studio.js:1545–1548,1474–1503 | sliders السرعة والشدة والتركيز لا تحرك الكاميرا من دون ضغط preset مجددًا. إظهار apply صريح أو تحديث حي بعقد واحد. |
| UX22 | متوسطة | studio.js:2034,2031,1959,1719 | seek محلي مقابل sequenceSeek الإجمالي داخل تبويب المشاهد؛ للمستخدم ساعة رئيسية إجمالية مع مؤشر محلي في pro. |
| UX23 | متوسطة | studio.js:2770–2790, studio-model.js:138–222, studio-sequence-editor.js:141–190 | حفظ one-scene وmulti-scene بصيغتين؛ JSON دون الأصول؛ لا يوصف بأنه مشروع مكتمل قابل للنقل. |
| UX24 | متوسطة | studio.js:32–96, studio.css:98–99 و107–423 | تركيب يعتمد ترتيب cards slices ومحددات CSS legacy؛ هش عند تغيير DOM. استبدال بواجهة semantic ثابتة تدريجيًا، لا إعادة كتابة المحرك. |

**تمييز:** UX01/02/03/04/06/07/08/09/10/11/12/14/15/20/21 عيوب أو اختلافات قابلة للتتبع من المصدر. UX05/16/17/18/19/22/23/24 مخاطر أو تحسينات مرتبطة بالأدلة؛ اختبار كل مسار مطلوب، ولا ندعي فشلًا ماديًا غير مقاس. لا زر static بلا ربط في المصفوفة؛ وجود أزرار غير متاحة بسبب الحالة لا يعني أن handler غير موجود.

## 3. مسارات المستخدم وعقد القبول

| الاختبار | المسار في الإنتاج | المطلوب من Luna | تغطية النموذج |
|---|---|---|---|
| T00 | load → mountCompactWorkspace → mode/section/fullscreen | default simple؛ 6 أقسام؛ لا forced mode؛ نص قابل للقراءة | تغيير تبويب/وضع/ملء شاشة |
| T01 | imageInput → decode → registerAssetFile → preview | اختيار/استبدال؛ أبعاد/fit؛ أخطاء نوع/ذاكرة | صورة محلية واحتواء |
| T02 | add/duplicate/reorder/deleteScene → activate | شريط ثابت، حد 32 وآخر مشهد، undo | CRUD |
| T03 | playback / seek local/global / scene duration | ساعة موحدة ووحدات s؛ pause/replay | تشغيل/seek/replay محلي تجريبي |
| T04 | applyQuickMotion / studio-timeline | preset وقوة واضحة؛ حفظ keyframes؛ undo محدد | presets + مفاتيح demo |
| T05 | characterTimeline / viseme | preset يترجم إلى قنوات حقيقية؛ لا وعد lip sync تلقائي | اختيار/إضافة مفتاح demo |
| T06 | microphone / quick import → decode → register → insert → solo/preview | صوت مثبت؛ عذر disabled؛ record/stop وأخطاء واضحة وكشف الملف غير المرتبط | محاكاة تسجيل وإدراج واختيار؛ لا ميكروفون حقيقي |
| T07 | add/edit/removeVisualEffect → drawStudioScene | اسم عربي وشدة تؤثر فعليًا؛ تفاصيل اختيارية | معاينة شكلية/اختيار |
| T08 | autosave / JSON / restore / asset storage | حفظ محلي، JSON، missing asset، إعادة فتح؛ نفس الأصل | localStorage + JSON تجريبي دون الصورة |
| T09 | export/record/import/scene activation/save | مصفوفة عملية واحدة، يمنع تغير البيانات؛ unlock يعيد شروط selection | lock أثناء التسجيل والتصدير |
| T10 | probe → prepare → integrated export → download/cancel | مرئي دائمًا؛ تأكيد النطاق والصيغة؛ رسالة عند الفشل؛ تنزيل حقيقي فقط | sheet/progress/cancel محاكاة |
| T11 | pointer/keyboard/RTL/scroll | focus بعد rerender، drag cancel، 44px، timeline LTR | تنقل وتخطيط؛ ليس محرر Timeline كامل |
| T12 | تصدير/معاينة signal | اختبار ميكروفون Android وقيم PCM للفيديو كما في #143؛ حماية الذاكرة | خارج نطاق النموذج |

## 4. تصميم Mobile First

- الأسود #0a0a0b والذهبي #edc676؛ لا صور خارجية. رأس صغير: شعار QARTON، تراجع، حفظ، تصدير. لا وضع تلقائي يفرض نفسه؛ اقتراحات في الحركة.
- معاينة ثابتة مع تشغيل، إعادة، seek، توقيت، ملء الشاشة. شريط مشاهد دائم، + واضح، تحديد المشهد الحالي. تحتها درج واحد قابل للتمرير، ثم ستة أقسام ثابتة في الأسفل (مشاهد، حركة، صوت، شخصيات، مؤثرات، مشروع).
- يد واحدة: الأكثر تكرارًا في الأسفل؛ القائمة الأفقية قابلة للتمرير؛ لا نطلب بلوغ زر أعلى لإدراج صوت أو مشهد. الحفظ والتصدير من رأس أو قسم مشروع. عند لوحة مفاتيح قصيرة اجعل التركيز مرئيًا؛ landscape عمودان.
- المبسط: حركة جاهزة وقوة/سرعة؛ صوت record/import/music/sfx وتشغيل المقطع والصوت العام؛ شخصيات اختيارات يدوية، مؤثرات بطاقات، إعداد نسبة/مدة في المشاهد. الاحترافي اختياري من المشروع؛ لا يغيّر تلقائيًا عند tab؛ تظهر النطاقات والقنوات/الحقول.
- التصدير: نافذة نطاق/جودة/صيغة/صوت + تقدم وإلغاء. في التطبيق الحقيقي زر واحد يقوم بفحص واعتماد الخيارات ثم التصدير؛ لا إخراج صامت إلا بموافقة صريحة. النموذج يعرض محاكاة ولا يدّعي إنتاج ملف.
- الحفظ: حالة محلية مؤرخة، نسخة JSON مستقلة، تحذير missing bytes؛ إطلاق «مشروع جديد» بعد حفظ/تأكيد. في النموذج البيانات فقط، لا أصل صورة.
- عناصر معطّلة: وصف سبب قريب، لا تعتيم يخفي النص. عند recording يسمح بإيقاف؛ عند exporting يسمح بإلغاء؛ منع تشغيل متداخل. نموذج HTML يستخدم محاكاة lock؛ الإنتاج يحتاج عقد الحالة التالي.

### عقد حالة مقترح (Luna)

| الحالة | إجراءات مسموحة | إجراءات مقفلة |
|---|---|---|
| no-image | إنشاء/فتح/إضافة صورة وتصفح إعدادات | تصدير؛ أشكال تحتاج أصلًا |
| idle | تحرير/تنقل/حفظ/معاينة؛ delete فقط مع selection | delete آخر مشهد/أصل مستخدم، export غير صالح |
| loading / importing / restoring | إلغاء عند دعمها، عرض حالة | تغيير مشهد/تصدير/حفظ/تسجيل متعارض |
| permission-request | إلغاء وانتظار | جميع mutations، عدم تكرار طلب mic |
| recording | Stop، timer ومقياس | seek/edit/save/export/scene switch |
| audio-finalizing | رسالة اعتماد وإلغاء إن آمن | mutation وrecord مجددًا |
| export-probing/preparing/rendering | إلغاء وتقدم | أي edit/record/scene change |
| error | تفسير، retry/back | حسب العملية؛ لا deadlock |
| completed | حفظ الملف/مشاهدة/عودة | لا قفل دائم |

اشتق enabled من selector واحد per operation + prerequisites؛ لا تستخدم unlock يفعّل كل شيء. كل handler يتحقق من نفس state؛ render لا يغير state. اختبارات سباق قبل await وبعده، focus عند العودة، pagehide، فشل التخزين، إلغاء picker وrecord/export.

## 5. مراجعة HTTPS في PR #143 (دفاعية، لا تغيير)

- workflow motion-studio-preview.yml:166–211 ينشر artifact Pages كاملاً على origin الموجود باستخدام main ثم يضيف route L12-A2. هذا **استبدال نشر الموقع بأكمله**، ليس دمج main؛ أي routes غير موجودة في main تزول. تشغيل main لاحقًا يحذف route التجريبية. لا نضيف مسار L13 إلى نفس Pages.
- concurrency تشارك المجموعة مع main لكن job main يستخدم cancel-in-progress:true، ما يترك تعارضًا محتملاً. الأفضل نشر مستقل/بيئة مستقلة، أو workflow واحد يملك manifest مسارات النشر.
- نشر preview يسحب tip متحرك من فرع feature بدل SHA الذي اختبر من push؛ race: اختبر A ثم نشر B. pin checkout إلى github.sha و main SHA موثق؛ فحص SHA256 قبل الرفع، فصل build عن deploy ونقل artifact نفسه.
- خطوات microphone/audio/screenshot تتشرط github.head_ref في 123–150؛ على push يكون head_ref فارغًا، فتُتخطى هذه الفحوصات بينما deploy يعتمد preview. أصلح الشرط في مهمة Luna المقبلة لا هنا.
- تمرير اسم الفرع مباشرة داخل shell في سطر 54 يجعل مدخل البيانات جزءًا من النص التنفيذي. استعمل env: BRANCH_NAME ثم اقتباس المتغير داخل shell؛ whitelist فروع النشر. لا حاجة لتجربة إساءة الاستخدام. استخدم صلاحيات read للبناء وpages:write/id-token:write للنشر فقط، كما هو.
- نفس HTTPS origin بين main/preview يعني localStorage وIndexedDB مشتركتان؛ نموذج/نسخة تجريبية يمكن أن ترى مشروع الإنتاج أو تغيّر pointer. استخدم أصلًا مستقلًا أو namespace/version مستقل، وتأكد من عدم قراءة بيانات إنتاج بغير الموافقة.
- HTTPS مطلوب لكنه ليس كافيًا: اختبار getUserMedia وpermission OS/Chrome/WebView وMIME والمدة وRMS على HONOR. لا تعرض تسجيلات شخصية أو تقارير على Pages؛ لا رفع تلقائي. تحقق من أذونات البيئة ومن أن رابط preview موجود فعليًا.
- رابط النموذج الجديد منفصل ولا يستخدم mic الحقيقي ولا ملفات المحرك؛ لا يحتاج secrets أو صلاحيات Pages.

## 6. مهام Luna المقترحة (لا تنفذ في هذا الفرع)

1. **L13-L1**: تحويل DOM إلى shell ثابت + 6 tabs + modes + route smoke، preserve IDs/adapters، بقاء canvas/transport/strip. لا تغيير core. قبول T00–T03، 10 أحجام/اتجاهات؛ تحقق من keyboard.
2. **L13-L2**: reducer/selector لقفل العمليات مركزي، مع guards وفصل audio import/record selection. اختبار T09 في Chrome وHONOR.
3. **L13-L3**: المشاهد والحركة والشخصيات والمؤثرات بمسارات مبسطة؛ map presets إلى APIs الموجودة، لا حذف capabilities pro. قبول T02–T05/T07/T11.
4. **L13-L4**: الصوت والـsolo وvolume، permission/encoding/linked assets/viseme يدوية؛ اختبارات PCM وimport/save/reopen. قبول T06/T08/T12.
5. **L13-L5**: مشروع/حفظ/إعادة ربط + export sheet واحدة مع probing/cancel، L5 للمختبر فقط. T08/T10/T12؛ لا تغير format project دون migration.
6. **L13-L6**: Android HTTPS test branch isolated and pinned, شاشات فعلية/RTL/gesture، جميع Node/Chromium/ZIP، ثم مراجعة مستقلة قبل أي merge.

المسارات T00–T12 في المصفوفة تعني متطلبات قبول وليست كلها اختبارات آلية لحظيًا. اختبار النموذج المرفق يشغّل سلوك الواجهة عبر Chromium. لا يعتبر ذلك إثباتًا للوظائف الفعلية للمحرك. نتائج القياس الأصلية والجديدة في artifact CI.
