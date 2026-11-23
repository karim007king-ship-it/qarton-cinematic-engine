# مختبر نواة تحريك الشخصيات L7-A

مشهد ويب مستقل لعرض عينة شخصية أصلية من QARTON. يستعمل `createCharacterAnimation` للحركة الحتمية، و`createCharacterAnimationPlayer` المبني على `createSceneClock` للتشغيل والإيقاف والبحث الزمني. حركة المسارات وإطارات الـSprite Sheet تمر عبر `createCharacterController` و`compileFrameAnimation` الموجودين.

## تجربة النسخة على Android

1. افتح [Pull Request L7-A](https://github.com/karim007king-ship-it/qarton-cinematic-engine/pulls) ثم تبويب **Checks**، وافتح تشغيل **Character Animation Android preview** بعد نجاحه.
2. نزّل Artifact باسم `qarton-character-animation-l7a-android-preview` إلى الهاتف، وفك ضغطه من تطبيق **الملفات**.
3. افتح `index.html` بمتصفح Chrome. النسخة التجريبية صفحة واحدة ذات CSS وJavaScript وSVG مضمنة؛ لا تحتاج خادمًا أو حاسوبًا، وتعمل من `file://`.
4. حرّك شريط الزمن للتحقق من الرمش والميل والتعبير والفم. استعمل تشغيل/إيقاف/إعادة، وبدّل المشهد أثناء الحركة. ارجع إلى الزمن نفسه مرتين؛ يجب أن تكون الوضعية متطابقة.

لا تحتاج التجربة إلى صلاحيات أو اتصال خارجي. الاختبار الآلي في Chromium لا يثبت إحساس اللمس أو أداء HONOR 400 Pro؛ يلزم التحقق على الهاتف نفسه قبل الدمج.

## API

```js
const animation = createCharacterAnimation({
  character: { id: "hero", initial: { x: 12, expression: "neutral" } },
  durationMs: 4000,
  keyframes: [
    { atMs: 0, values: { headRotation: 0, eyeX: 0, expression: "neutral" } },
    { atMs: 900, values: { headRotation: 12, eyeX: 0.3, expression: "curious" }, easing: "easeInOutCubic" }
  ]
});
const state = animation.sample(450); // deterministic absolute-time sample
const player = createCharacterAnimationPlayer(animation);
player.play(); player.pause(); player.seek(1200); player.replay(); player.destroy();
```

تدعم القنوات `headRotation`, `eyeX`, `eyeY`, `blink`, `mouthOpen`, `bodyRotation`, `expression` و`gesture`. تنقل الشخصية وتعابير الإطارات تبقى على متحكم الشخصية الحالي. يقبل Sprite Sheet الأصلي وصفًا داخل clip: `spriteSheet: { asset, frameWidth, frameHeight, columns, frameCount }` مع قائمة `frames` من أرقام الإطارات؛ وتعيد العينة `spriteFrame` بمستطيل القص.

تم تصميم keyframes لتكون مستقلة عن كاميرا Motion Studio. يمكن لمحرر L6-B المستقبلي حفظ/تحرير track شخصية منفصل ثم تمريره إلى النواة، دون استخدام مفاتيح الكاميرا لتخزين حركة الوجه أو الجسم.
