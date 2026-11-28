export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PREVIEW_EDGE = 2048;
export const MAX_PREVIEW_PIXELS = 2_621_440;
export const IMAGE_DECODE_WIDTHS = Object.freeze([1280, 1024, 768, 512, 384, 256]);

const IMAGE_DECODE_ERROR = "تعذر فك ترميز الصورة أو تصغيرها بحدود ذاكرة آمنة. جرّب صورة JPG أو PNG أو WebP أصغر.";

function inBounds(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width >= 16 && height >= 16 &&
    width <= MAX_PREVIEW_EDGE && height <= MAX_PREVIEW_EDGE && width * height <= MAX_PREVIEW_PIXELS;
}

function readRasterWidth(file) {
  if (!file?.slice || !["image/png", "image/webp"].includes(file.type)) return null;
  return (async () => {
    try {
      const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
      const text = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
      if (file.type === "image/png" && bytes.length >= 24 && text(0, 8) === "\x89PNG\r\n\x1a\n") {
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16, false);
      }
      if (file.type !== "image/webp" || bytes.length < 30 || text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") return 0;
      const chunk = text(12, 4);
      if (chunk === "VP8X") return 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      if (chunk === "VP8L" && bytes[20] === 0x2f) return 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      if (chunk === "VP8 " && text(23, 3) === "\x9d\x01\x2a") return (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    } catch {}
    return 0;
  })();
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

  // PNG/WebP character layers often have only a few hundred pixels across.
  // Do not request a 1280px bitmap for them: some decoders upscale to the
  // requested width and waste the shared decoded-character pixel budget.
  const widthRead = readRasterWidth(file);
  const sourceWidth = widthRead ? await widthRead : 0;
  const decodeWidths = sourceWidth > 0
    ? [Math.min(IMAGE_DECODE_WIDTHS[0], sourceWidth), ...IMAGE_DECODE_WIDTHS.filter(width => width < Math.min(IMAGE_DECODE_WIDTHS[0], sourceWidth))]
    : IMAGE_DECODE_WIDTHS;
  let lastDecodeError;
  for (const resizeWidth of decodeWidths) {
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
