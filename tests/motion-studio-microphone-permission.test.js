import test from "node:test";
import assert from "node:assert/strict";
import { classifyMicrophoneFailure } from "../examples/motion-studio-lab/microphone-permission.js";

test("Android permission denial is distinguished from an unavailable secure context", () => {
  const error = Object.assign(new Error("Permission denied by user"), { name: "NotAllowedError" });
  const denied = classifyMicrophoneFailure(error, { permissionState: "denied", secureContext: true, apiAvailable: true });
  assert.equal(denied.category, "permission_denied");
  assert.equal(denied.errorName, "NotAllowedError");
  assert.equal(denied.errorMessage, "Permission denied by user");
  assert.match(denied.message, /إعدادات Android/);

  const insecure = classifyMicrophoneFailure(error, { permissionState: "denied", secureContext: false, apiAvailable: false });
  assert.equal(insecure.category, "secure_context_required");
  assert.notEqual(insecure.category, denied.category);
});

test("NotAllowedError stays ambiguous unless permission or source policy is confirmed", () => {
  const error = Object.assign(new Error("NotAllowedError: blocked"), { name: "NotAllowedError" });
  const prompt = classifyMicrophoneFailure(error, { permissionState: "prompt" });
  assert.equal(prompt.category, "permission_or_policy_blocked");
  assert.match(prompt.message, /سياسة الموقع أو الإطار/);
  assert.equal(classifyMicrophoneFailure(error, { permissionState: "unknown" }).category, "permission_or_policy_blocked");
  assert.equal(classifyMicrophoneFailure(error, { permissionState: "granted", policyAllowed: false }).category, "source_policy_blocked");
  assert.equal(classifyMicrophoneFailure(Object.assign(new Error("sandbox"), { name: "SecurityError" })).category, "source_security_blocked");
});

test("hardware, busy, and timeout errors retain their original browser names", () => {
  for (const [name, category] of [["NotFoundError", "microphone_missing"], ["NotReadableError", "microphone_busy"], ["TimeoutError", "permission_timeout"]]) {
    const result = classifyMicrophoneFailure(Object.assign(new Error(`original ${name}`), { name }));
    assert.equal(result.category, category);
    assert.equal(result.errorName, name);
    assert.equal(result.errorMessage, `original ${name}`);
  }
});
