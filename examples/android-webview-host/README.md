# Android WebView diagnostics host

This is a separate Capacitor application used only to run the QARTON diagnostics page on a physical Android WebView.

- Application ID: `com.qarton.webviewdiagnostics`
- Application name: `QARTON WebView Diagnostics`
- Capacitor: `8.6.0`
- The app bundles the reviewed `../android-webview-diagnostics.html` file as its start page.
- It does not use the Carthage application ID, install over Carthage, or access Carthage save data.

The GitHub Actions workflow `.github/workflows/android-webview-diagnostics.yml` builds a debug APK and uploads it as the `qarton-android-webview-diagnostics` artifact. Install it alongside Carthage, run the checks, test both audio buttons, background and foreground the app, then copy the raw report.

This APK validates the Capacitor Android WebView host configuration. It does not replace a later in-game integration test or certify GPU, audio-focus, or long-running scene behavior.
