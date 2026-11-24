export const errorText = (error) => error?.message || String(error);
export function setExportErrorMessage(target, error, suggestion = "") {
  const arabic = error?.name === "NotSupportedError" ? "صيغة التصدير غير مدعومة على هذا الجهاز."
    : error?.code === "UNSUPPORTED_FORMAT" ? "صيغة الفيديو غير مدعومة أو تعذّر تشغيل مرمّزها."
      : error?.code === "CLOCK_STALLED" ? "توقفت ساعة التصدير أو تأخرت الإطارات. جرّب جودة أقل أو مدة أقصر."
        : error?.code === "BUDGET_EXCEEDED" ? "حجم الفيديو تجاوز الحد الآمن. قلّل الجودة أو مدة الفيديو."
          : error?.code === "BACKGROUNDED" ? "توقف التصدير لأن الصفحة انتقلت إلى الخلفية."
            : error?.code === "CAPTURE_FAILED" ? "تعذّر بدء التسجيل أو التقاط إطارات الفيديو."
              : error?.code === "INVALID_OUTPUT" ? "تعذّر التحقق من الفيديو الناتج. جرّب صيغة أو جودة أخرى."
                : "فشل تصدير الفيديو. راجع الصورة والصوت والصيغة والمساحة المتاحة.";
  const message = document.createElement("span");
  message.textContent = suggestion ? `${arabic} ${suggestion}` : arabic;
  const detailsText = [error?.code, error?.name, error?.message || String(error),
    error?.details?.assetIds?.length ? `الأصول: ${error.details.assetIds.join(", ")}` : ""]
    .filter(Boolean).join(" · ");
  target.replaceChildren(message);
  if (detailsText) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const code = document.createElement("code");
    summary.textContent = "عرض التفاصيل التقنية";
    code.textContent = detailsText;
    details.append(summary, code);
    target.append(details);
  }
}
