export function classifyMicrophoneFailure(error, {
  permissionState = "unknown",
  secureContext = true,
  apiAvailable = true,
  policyAllowed = null
} = {}) {
  const errorName = typeof error?.name === "string" && error.name ? error.name : "Error";
  const errorMessage = typeof error?.message === "string" ? error.message : String(error ?? "Unknown microphone error");
  let category = "capture_failed";
  let message = "تعذر بدء التسجيل. تحقق من الميكروفون وحاول مرة أخرى.";

  if (!secureContext || !apiAvailable) {
    category = "secure_context_required";
    message = "هذا المصدر لا يتيح تسجيل الميكروفون. افتح Motion Studio من رابط HTTPS أو WebView يسمح صراحةً بالميكروفون.";
  } else if (policyAllowed === false) {
    category = "source_policy_blocked";
    message = "سياسة الصفحة أو الإطار تمنع استخدام الميكروفون. افتح الرابط مباشرةً في المتصفح بدل إطار مضمّن.";
  } else if (errorName === "NotAllowedError" && permissionState === "denied") {
    category = "permission_denied";
    message = "إذن الميكروفون مرفوض لهذا التطبيق أو الموقع. فعّله من إعدادات Android أو أذونات الموقع، ثم اضغط «أعد المحاولة».";
  } else if (errorName === "NotAllowedError") {
    category = "permission_or_policy_blocked";
    message = "رفض المتصفح طلب الميكروفون أو منعته سياسة الموقع أو الإطار. تحقق من إذن التطبيق والموقع، وافتح الرابط مباشرةً في المتصفح عند استخدام إطار مضمّن، ثم أعد المحاولة.";
  } else if (errorName === "SecurityError") {
    category = "source_security_blocked";
    message = "المتصفح حظر الميكروفون لهذا المصدر أو الإطار. افتح الرابط مباشرةً عبر HTTPS وتحقق من سياسة الأذونات.";
  } else if (errorName === "TimeoutError") {
    category = "permission_timeout";
    message = "لم يصل رد على طلب الميكروفون. تحقق من إذن Android والمتصفح ثم أعد المحاولة.";
  } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    category = "microphone_missing";
    message = "لم يعثر Android على ميكروفون متاح.";
  } else if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    category = "microphone_busy";
    message = "تعذر فتح الميكروفون؛ قد يكون مستخدمًا من تطبيق آخر. أغلق التطبيق الآخر ثم أعد المحاولة.";
  }

  return { category, message, errorName, errorMessage, permissionState };
}
