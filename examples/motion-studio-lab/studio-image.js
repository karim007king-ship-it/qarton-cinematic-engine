export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PREVIEW_EDGE = 2048;
export const MAX_PREVIEW_PIXELS = 2_621_440;
export const IMAGE_DECODE_WIDTHS = Object.freeze([1280, 1024, 768, 512, 384, 256]);

const IMAGE_DECODE_ERROR = "تعذر فك ترميز الصورة أو تصغيرها بحدود ذاكرة آمنة. جرّب صورة JPG أو PNG أو WebP أصغر.";

function inBounds(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width >= 16 && height >= 16 &&
    width <= MAX_PREVIEW_EDGE && height <= MAX_PREVIEW_EDGE && width * height <= MAX_PREVIEW_PIXELS;
}

export async function decodeImageBitmap(file, {
  createBitmap = globalThis.createImageBitmap?.bind(globalThis),
  isCurrent = () => true
} = {}) {
  if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) {
    throw new TypeError("الملف المختار ليس صورة مدعومة.");
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_FILE_BYTES) {
    throw new RangeError("حجم الصورة يجب أن يكون أكبر من صفر وأقل من 20 ميغابايت.");
  }
  if (typeof createBitmap !== "function") {
    throw new Error("فك الصور غير متاح في هذا المتصفح. افتح المختبر في Chrome أو WebView حديث.");
  }

  let lastDecodeError;
  for (const resizeWidth of IMAGE_DECODE_WIDTHS) {
    if (!isCurrent()) throw new DOMException("Image selection was superseded", "AbortError");
    let bitmap;
    try {
      bitmap = await createBitmap(file, { resizeWidth, resizeQuality: "high" });
    } catch (error) {
      lastDecodeError = error;
      // A rejected resize request may mean the format or decoder does not support it.
      // Do not retry without resize options: that could force a full-resolution decode.
      break;
    }
    if (!isCurrent()) {
      bitmap.close?.();
      throw new DOMException("Image selection was superseded", "AbortError");
    }

    const { width, height } = bitmap;
    if (width > resizeWidth + 1) {
      bitmap.close?.();
      throw new Error(IMAGE_DECODE_ERROR);
    }
    if (inBounds(width, height)) return bitmap;
    bitmap.close?.();

    // If the decoder did resize the requested axis, another smaller request can
    // safely reduce unusually tall or wide images without retaining this bitmap.
    if (width < resizeWidth && height <= MAX_PREVIEW_EDGE && width * height <= MAX_PREVIEW_PIXELS) {
      throw new RangeError("أبعاد الصورة أصغر من الحد الأدنى المطلوب للمعاينة.");
    }
  }
  throw new Error(IMAGE_DECODE_ERROR, { cause: lastDecodeError });
}
