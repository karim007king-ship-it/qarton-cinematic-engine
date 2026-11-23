export const ASPECT_PRESETS = Object.freeze([
  Object.freeze({ value: "original", label: "الأصلية — نسبة الصورة", ratio: null }),
  Object.freeze({ value: "square", label: "مربع 1:1", ratio: 1, width: 1080, height: 1080 }),
  Object.freeze({ value: "portrait", label: "عمودي 9:16", ratio: 9 / 16, width: 1080, height: 1920 }),
  Object.freeze({ value: "landscape", label: "أفقي 16:9", ratio: 16 / 9, width: 1920, height: 1080 }),
  Object.freeze({ value: "post", label: "منشورات 4:5", ratio: 4 / 5, width: 1080, height: 1350 }),
  Object.freeze({ value: "classic-landscape", label: "كلاسيكي 4:3", ratio: 4 / 3, width: 1440, height: 1080 }),
  Object.freeze({ value: "classic-portrait", label: "كلاسيكي 3:4", ratio: 3 / 4, width: 1080, height: 1440 })
]);

export const MAX_PREVIEW_PIXELS = 921_600;
export const MAX_PREVIEW_EDGE = 1280;
export const DEFAULT_OUTPUT_VIEWPORT = Object.freeze({ width: 1080, height: 1920, fps: 24 });

export function projectSizeForPreset(preset, sourceWidth, sourceHeight) {
  if (preset === "original") {
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
      return { width: DEFAULT_OUTPUT_VIEWPORT.width, height: DEFAULT_OUTPUT_VIEWPORT.height };
    }
    const scale = Math.min(1920 / Math.max(sourceWidth, sourceHeight),
      Math.sqrt(8_388_608 / (sourceWidth * sourceHeight)), 4096 / Math.max(sourceWidth, sourceHeight));
    return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
  }
  const selected = ASPECT_PRESETS.find((item) => item.value === preset);
  if (!selected?.width || !selected?.height) throw new TypeError("نسبة أبعاد المشروع غير مدعومة.");
  return { width: selected.width, height: selected.height };
}

export function safePreviewSize(width, height) {
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError("أبعاد المعاينة غير صالحة.");
  }
  const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(width, height), Math.sqrt(MAX_PREVIEW_PIXELS / (width * height)));
  const previewWidth = Math.max(1, Math.floor(width * scale));
  const previewHeight = Math.max(1, Math.floor(height * scale));
  return { width: previewWidth, height: previewHeight };
}

export function inferAspectPreset(width, height) {
  const ratio = width / height;
  const preset = ASPECT_PRESETS.slice(1).find((item) => Math.abs(ratio - item.ratio) < 0.002);
  return preset?.value ?? "original";
}

export function imageRect(imageWidth, imageHeight, viewportWidth, viewportHeight, fitMode) {
  if (![imageWidth, imageHeight, viewportWidth, viewportHeight].every((value) => Number.isFinite(value) && value > 0) ||
      !["fit", "fill"].includes(fitMode)) throw new RangeError("تعذر حساب إطار الصورة.");
  const scale = fitMode === "fit"
    ? Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight)
    : Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: (viewportWidth - width) / 2, y: (viewportHeight - height) / 2, width, height };
}
