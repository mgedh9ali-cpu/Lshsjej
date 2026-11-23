package school.dafaa;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import java.net.URI;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final int PICK_IMAGE = 23;
    private String origin;
    private WebView web;
    private ValueCallback<Uri[]> chooser;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        origin = "";
        try (BufferedReader config = new BufferedReader(new InputStreamReader(
                getAssets().open("student-origin.txt"), StandardCharsets.UTF_8))) {
            String address = config.readLine();
            if (address != null && !address.isEmpty()) origin = httpsOrigin(address);
        } catch (Exception ignored) {}
        if (origin.isEmpty()) {
            try { origin = httpsOrigin(getPreferences(MODE_PRIVATE).getString("origin", "")); }
            catch (Exception ignored) {}
        }
        if (origin.isEmpty()) setup("");
        else openStudentApp();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private LinearLayout layout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setBackgroundColor(Color.rgb(246,244,252));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top;
            int bottom;
            int left;
            int right;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                top = safe.top;
                bottom = safe.bottom;
                left = safe.left;
                right = safe.right;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft();
                right = insets.getSystemWindowInsetRight();
            }
            view.setPadding(left, top, right, bottom);
            return insets;
        });
        setContentView(root);
        root.requestApplyInsets();
        return root;
    }

    private void setup(String message) {
        if (web != null) {
            LinearLayout old = (LinearLayout) web.getParent();
            if (old != null) old.removeView(web);
            web.destroy();
            web = null;
        }
        LinearLayout root = layout();
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(24), dp(32), dp(24), dp(24));
        root.addView(card);
        TextView title = new TextView(this);
        title.setText("قوم دروس");
        title.setTextSize(30);
        title.setTextColor(Color.rgb(36,21,77));
        card.addView(title);
        EditText name = new EditText(this);
        name.setHint("الاسم");
        name.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PERSON_NAME);
        name.setSingleLine(true);
        card.addView(name);
        EditText password = new EditText(this);
        password.setHint("كلمة السر");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        password.setSingleLine(true);
        card.addView(password);
        Button login = new Button(this);
        login.setText(origin.isEmpty() ? "دخول" : "إعادة المحاولة");
        login.setMinimumHeight(dp(48));
        card.addView(login);
        TextView status = new TextView(this);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setText(message);
        card.addView(status);
        login.setOnClickListener(view -> {
            if (origin.isEmpty()) status.setText("خادم المدرسة غير متاح بعد.");
            else openStudentApp();
        });
    }

    private static String httpsOrigin(String input) throws Exception {
        URI uri = new URI(input);
        String path = uri.getRawPath();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
            || uri.getRawQuery() != null || uri.getRawFragment() != null
            || (path != null && !path.isEmpty() && !"/".equals(path))) throw new IllegalArgumentException();
        int port = uri.getPort();
        return "https://" + uri.getHost().toLowerCase(java.util.Locale.ROOT) + (port == -1 || port == 443 ? "" : ":" + port);
    }

    private boolean allowed(Uri url) {
        if (url == null || !url.isHierarchical()) return false;
        try { return origin.equals(httpsOrigin(url.getScheme() + "://" + url.getEncodedAuthority())); }
        catch (Exception invalid) { return false; }
    }

    private void openStudentApp() {
        LinearLayout root = layout();
        web = new WebView(this);
        TextView loading = new TextView(this);
        loading.setText("جارٍ فتح قوم دروس…");
        loading.setPadding(dp(16), dp(12), dp(16), dp(8));
        loading.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(loading);
        ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        root.addView(progress);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        WebView page = web;
        Runnable timedOut = () -> {
            if (web == page && !isDestroyed()) {
                page.stopLoading();
                setup("تأخر الخادم في الرد. تحقق من الإنترنت ثم أعد المحاولة.");
            }
        };
        page.postDelayed(timedOut, 12000);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !allowed(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !allowed(Uri.parse(url));
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (web != page || !allowed(Uri.parse(url))) return;
                view.removeCallbacks(timedOut);
                loading.setVisibility(View.GONE);
                progress.setVisibility(View.GONE);
            }
            private void connectionError(WebView view) {
                view.removeCallbacks(timedOut);
                view.post(() -> {
                    if (web == page && !isDestroyed()) setup("تعذّر الاتصال بخادم المدرسة. تحقق من الإنترنت.");
                });
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) connectionError(view);
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, android.webkit.WebResourceResponse error) {
                if (request.isForMainFrame()) connectionError(view);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!allowed(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) return false;
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("image/*");
                picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp"});
                try { startActivityForResult(picker, PICK_IMAGE); }
                catch (android.content.ActivityNotFoundException error) {
                    chooser = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });
        web.loadUrl(origin + "/");
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != PICK_IMAGE || chooser == null) return;
        Uri selected = result == RESULT_OK && data != null ? data.getData() : null;
        chooser.onReceiveValue(selected != null && "content".equals(selected.getScheme()) ? new Uri[]{selected} : null);
        chooser = null;
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
