package com.qarton.webviewsmoke;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public final class WebViewSmokeTest {
    @Test
    public void rendersCinematicSceneAndTransitionsWithoutConsoleErrors() throws Exception {
        MainActivity.clearConsoleErrors();
        AtomicReference<MainActivity> activityRef = new AtomicReference<>();

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activityRef::set);
            MainActivity activity = activityRef.get();
            assertTrue("Activity should be created", activity != null);

            waitFor(activity, "(() => (document.querySelector('#status')?.textContent || '').includes('Scene dawn active'))()", 30_000);

            String initial = evaluate(activity,
                    "JSON.stringify({"
                    + "images: document.querySelectorAll('.qarton-scene img').length,"
                    + "characters: document.querySelector('#character-layer').children.length,"
                    + "overlays: document.querySelectorAll('.qarton-visual-treatment').length,"
                    + "stageWidth: document.querySelector('#stage').getBoundingClientRect().width"
                    + "})");
            JSONArray initialArray = new JSONArray("[" + initial + "]");
            org.json.JSONObject initialState = initialArray.getJSONObject(0);
            assertEquals("Both background layers should render", 2, initialState.getInt("images"));
            assertEquals("Both character rigs should mount", 2, initialState.getInt("characters"));
            assertEquals("All visual treatment overlays should mount", 3, initialState.getInt("overlays"));
            assertTrue("WebView should provide a measurable stage", initialState.getDouble("stageWidth") > 0);

            evaluate(activity, "document.querySelector('#scene-two').click(); 'clicked'");
            waitFor(activity, "(() => (document.querySelector('#status')?.textContent || '').includes('Scene dusk active'))()", 15_000);
            waitFor(activity, "window.__qartonSmoke?.getTimelineEvents().includes('dust') === true", 10_000);

            String effects = evaluate(activity,
                    "JSON.stringify({"
                    + "camera: document.querySelector('.qarton-scene')?.style.transform || '',"
                    + "parallax: [...document.querySelectorAll('.qarton-scene img')].every(node => !!node.style.transform),"
                    + "timeline: window.__qartonSmoke.getTimelineEvents(),"
                    + "canvasWidth: document.querySelector('#particles').width,"
                    + "canvasHeight: document.querySelector('#particles').height"
                    + "})");
            org.json.JSONObject effectState = new JSONArray("[" + effects + "]").getJSONObject(0);
            assertFalse("Camera should update the scene transform", effectState.getString("camera").isEmpty());
            assertTrue("Parallax should update every background layer", effectState.getBoolean("parallax"));
            assertTrue("Timeline should dispatch the impact event", containsString(effectState.getJSONArray("timeline"), "impact"));
            assertTrue("Canvas should have a non-zero backing size", effectState.getInt("canvasWidth") > 0
                    && effectState.getInt("canvasHeight") > 0);

            evaluate(activity, "document.querySelector('#destroy').click(); 'destroyed'");
            waitFor(activity, "(() => (document.querySelector('#status')?.textContent || '').startsWith('Destroyed:'))()", 10_000);
            assertTrue("WebView should not report JavaScript console errors: " + MainActivity.getConsoleErrors(),
                    MainActivity.getConsoleErrors().isEmpty());
        }
    }

    private static boolean containsString(JSONArray values, String expected) throws Exception {
        for (int index = 0; index < values.length(); index++) {
            if (expected.equals(values.getString(index))) return true;
        }
        return false;
    }

    private static void waitFor(MainActivity activity, String expression, long timeoutMs) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        String last = "";
        while (System.nanoTime() < deadline) {
            last = evaluate(activity, expression);
            if ("true".equals(last)) return;
            Thread.sleep(200);
        }
        throw new AssertionError("Timed out waiting for WebView condition: " + expression + "; last=" + last);
    }

    private static String evaluate(MainActivity activity, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = activity.getWebView();
            if (webView == null) {
                result.set("null");
                latch.countDown();
                return;
            }
            webView.evaluateJavascript(script, value -> {
                result.set(value);
                latch.countDown();
            });
        });
        assertTrue("JavaScript evaluation should complete within 20 seconds", latch.await(20, TimeUnit.SECONDS));
        String value = result.get();
        if (value != null && value.startsWith("\"") && value.endsWith("\"")) {
            return new JSONArray("[" + value + "]").getString(0);
        }
        return value;
    }
}
