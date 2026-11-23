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
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final int PICK_IMAGE = 23;
    private String origin;
    private WebView web;
    private ValueCallback<Uri[]> chooser;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        origin = getPreferences(MODE_PRIVATE).getString("origin", "");
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
        ImageView logo = new ImageView(this);
        logo.setImageResource(getResources().getIdentifier("school_logo", "drawable", getPackageName()));
        card.addView(logo, new LinearLayout.LayoutParams(dp(72), dp(72)));
        TextView title = new TextView(this);
        title.setText("قو مدرس");
        title.setTextSize(30);
        title.setTextColor(Color.rgb(36,21,77));
        card.addView(title);
        ImageView study = new ImageView(this);
        study.setImageResource(getResources().getIdentifier("study", "drawable", getPackageName()));
        study.setScaleType(ImageView.ScaleType.FIT_CENTER);
        card.addView(study, new LinearLayout.LayoutParams(-1, dp(118)));
        TextView instructions = new TextView(this);
        instructions.setText("أدخل رابط تطبيق الطلاب الذي استلمته من المدرسة.");
        instructions.setTextSize(17);
        card.addView(instructions);
        EditText address = new EditText(this);
        address.setHint("https://");
        address.setText(origin);
        address.setTextDirection(View.TEXT_DIRECTION_LTR);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        card.addView(address);
        Button connect = new Button(this);
        connect.setText("اتصال");
        connect.setMinimumHeight(dp(48));
        card.addView(connect);
        TextView status = new TextView(this);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setText(message);
        card.addView(status);
        connect.setOnClickListener(view -> {
            final String selected;
            try { selected = httpsOrigin(address.getText().toString().trim()); }
            catch (Exception invalid) { status.setText("أدخل رابط HTTPS كاملًا لواجهة الطلاب."); return; }
            connect.setEnabled(false);
            status.setText("جارٍ التحقق من الرابط…");
            new Thread(() -> {
                boolean valid = checkSchool(selected);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    if (!valid) {
                        status.setText("تعذّر الاتصال بواجهة الطلاب. تحقق من الرابط والإنترنت.");
                        connect.setEnabled(true);
                        return;
                    }
                    if (!selected.equals(origin)) CookieManager.getInstance().removeAllCookies(null);
                    origin = selected;
                    getPreferences(MODE_PRIVATE).edit().putString("origin", origin).apply();
                    openStudentApp();
                });
            }).start();
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

    private static boolean checkSchool(String address) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URI(address + "/student-app").toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            if (connection.getResponseCode() != 200) return false;
            try (java.io.InputStream stream = connection.getInputStream()) {
                byte[] payload = new byte[32];
                int count = 0;
                int read;
                while (count < payload.length && (read = stream.read(payload, count, payload.length - count)) != -1) count += read;
                return "school-student-v1".equals(new String(payload, 0, count, StandardCharsets.UTF_8));
            }
        } catch (Exception failure) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
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
        loading.setText("جارٍ فتح قو مدرس…");
        loading.setPadding(dp(16), dp(12), dp(16), dp(8));
        loading.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(loading);
        ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        root.addView(progress);
        Button connection = new Button(this);
        connection.setText("إعدادات الاتصال");
        connection.setOnClickListener(view -> setup(""));
        root.addView(connection);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        WebView page = web;
        Runnable timedOut = () -> {
            if (web == page && !isDestroyed()) {
                page.stopLoading();
                setup("تأخر الخادم في الرد. تحقق من رابط الطلاب ثم أعد المحاولة.");
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
                connection.setVisibility(View.GONE);
            }
            private void connectionError(WebView view) {
                view.removeCallbacks(timedOut);
                view.post(() -> {
                    if (web == page && !isDestroyed()) setup("تعذّر فتح رابط الطلاب. تحقق من الرابط والإنترنت.");
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
