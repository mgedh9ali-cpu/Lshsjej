package school.dafaa;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.content.SharedPreferences;
import android.text.method.PasswordTransformationMethod;
import android.util.Base64;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.AdapterView;
import java.security.MessageDigest;
import java.security.SecureRandom;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
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
    private String localName;
    private boolean atHome;
    private static final String ASSETS = "https://classroom.invalid/";
    private static final int INK = 0xff173d39;
    private static final int TEAL = 0xff11695d;
    private static final int MUTED = 0xff47665d;
    private static final int FIELD = 0xffedf4ef;
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
        Uri invitation = getIntent().getData();
        if (invitation != null && "qumdorous".equals(invitation.getScheme()) && "join".equals(invitation.getHost())) {
            try {
                final String address = httpsOrigin(invitation.getQueryParameter("school"));
                new android.app.AlertDialog.Builder(this).setTitle("الانضمام إلى الصف")
                    .setMessage("افتح هذا العنوان إذا أرسله لك المالك:"+ "\n" + address)
                    .setPositiveButton("فتح الصف", (dialog, which) -> connect(address))
                    .setNegativeButton("إلغاء", (dialog, which) -> finish()).show();
                return;
            } catch (Exception ignored) {}
        }
        if(getIntent().getBooleanExtra("savedNotes",false)){
            setup("");
        }else if(origin.isEmpty()){
            openClassroom();
            finish();
        }else openStudentApp();
    }

    private void openClassroom() { startActivity(new Intent(this,RoomActivity.class)); }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private LinearLayout layout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setBackgroundColor(Color.rgb(243,246,241));
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

    private GradientDrawable surface(int color, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(radius));
        return shape;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private LinearLayout panel() {
        LinearLayout root = layout();
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, -1));
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(22), dp(24), dp(22), dp(24));
        scroll.addView(column);
        return column;
    }

    private void add(LinearLayout parent, View child, int top) {
        LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(-1, -2);
        size.topMargin = dp(top);
        parent.addView(child, size);
    }

    private LinearLayout card(LinearLayout parent) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(16), dp(18), dp(18));
        card.setBackground(surface(Color.WHITE, 24));
        card.setElevation(dp(2));
        add(parent, card, 18);
        return card;
    }

    private void banner(LinearLayout parent, String title, String subtitle) {
        LinearLayout hero = new LinearLayout(this);
        hero.setOrientation(LinearLayout.VERTICAL);
        hero.setPadding(dp(22), dp(23), dp(22), dp(23));
        GradientDrawable background = new GradientDrawable(GradientDrawable.Orientation.TR_BL,
            new int[]{0xff173d39, 0xff20645e});
        background.setCornerRadius(dp(28));
        hero.setBackground(background);
        add(hero, text(title, 31, Color.WHITE, true), 0);
        add(hero, text(subtitle, 15, 0xffa9f6df, false), 7);
        add(parent, hero, 0);
    }

    private EditText field(LinearLayout parent, String label, int type) {
        EditText input = new EditText(this);
        TextView caption = text(label, 14, INK, true);
        input.setId(View.generateViewId());
        caption.setLabelFor(input.getId());
        add(parent, caption, 12);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | type);
        input.setPadding(dp(14), 0, dp(14), 0);
        input.setMinHeight(dp(54));
        input.setTextColor(INK);
        input.setBackground(surface(FIELD, 14));
        add(parent, input, 5);
        return input;
    }

    private Button primary(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setMinHeight(dp(52));
        button.setBackground(new android.graphics.drawable.RippleDrawable(
            android.content.res.ColorStateList.valueOf(0x44ffffff), surface(TEAL, 15), null));
        return button;
    }

    private SharedPreferences localData() { return getSharedPreferences("offline_student", MODE_PRIVATE); }

    static byte[] localHash(char[] password, byte[] salt) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(password, salt, 210000, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).getEncoded(); }
        finally { spec.clearPassword(); java.util.Arrays.fill(password, '\0'); }
    }

    private void setup(String message) {
        localName = null;
        if (web != null) {
            LinearLayout old = (LinearLayout) web.getParent();
            if (old != null) old.removeView(web);
            web.destroy();
            web = null;
        }
        LinearLayout screen = panel();
        boolean local = origin.isEmpty();
        boolean first = local && !localData().contains("hash");
        banner(screen, "قوم دروس", local ? "مساحتك الدراسية على هذا الهاتف" : "تسجيل الدخول إلى المدرسة");
        LinearLayout card = card(screen);
        if (!local) {
            add(card, text(message, 15, MUTED, false), 0);
            Button retry = primary("إعادة المحاولة");
            add(card, retry, 12);
            retry.setOnClickListener(view -> openStudentApp());
            section(card, "فتح مساحة الهاتف", view -> {
                getPreferences(MODE_PRIVATE).edit().remove("origin").apply();
                origin = "";
                setup("");
            });
            return;
        }
        section(card, "دخول الصف برمز المالك", v -> openClassroom());
        add(card, text(first ? "إنشاء حساب محلي" : "تسجيل الدخول", 22, INK, true), 0);
        EditText name = field(card, "الاسم", InputType.TYPE_TEXT_VARIATION_PERSON_NAME);
        EditText secret = field(card, "كلمة السر", InputType.TYPE_TEXT_VARIATION_PASSWORD);
        secret.setTransformationMethod(PasswordTransformationMethod.getInstance());
        secret.setSaveEnabled(false);
        if (!first) name.setText(localData().getString("name", ""));
        Button submit = primary(first ? "إنشاء الحساب" : "دخول");
        add(card, submit, 18);
        TextView status = text("", 14, MUTED, false);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        add(card, status, 8);
        submit.setOnClickListener(view -> {
            String enteredName = name.getText().toString().trim();
            int length = secret.length();
            if (enteredName.isEmpty() || enteredName.length() > 100 || length < 6 || length > 128) {
                status.setText("اكتب الاسم وكلمة سر من 6 إلى 128 حرفًا أو رقمًا.");
                return;
            }
            char[] password = new char[length];
            secret.getText().getChars(0, length, password, 0);
            secret.setText("");
            submit.setEnabled(false);
            new Thread(() -> {
                boolean entered;
                try { entered = verifyLocal(enteredName, password, first); }
                catch (Exception error) { entered = false; }
                final boolean success = entered;
                runOnUiThread(() -> {
                    if (isDestroyed() || isFinishing()) return;
                    if (success && getIntent().getBooleanExtra("savedNotes",false)) showLocalNotes(enteredName,0);
                    else if (success) showLocalHome(enteredName);
                    else {
                        status.setText(first ? "تعذّر إنشاء الحساب. حاول مجددًا." : "تحقّق من الاسم وكلمة السر.");
                        status.postDelayed(() -> submit.setEnabled(true), 900);
                    }
                });
            }).start();
        });
    }

    private synchronized boolean verifyLocal(String name, char[] password, boolean first) throws Exception {
        SharedPreferences data = localData();
        if (first && !data.contains("hash")) {
            byte[] salt = new byte[16];
            new SecureRandom().nextBytes(salt);
            return data.edit().putString("name", name).putString("salt", Base64.encodeToString(salt, Base64.NO_WRAP))
                .putString("hash", Base64.encodeToString(localHash(password, salt), Base64.NO_WRAP)).commit();
        }
        byte[] salt = Base64.decode(data.getString("salt", ""), Base64.DEFAULT);
        byte[] stored = Base64.decode(data.getString("hash", ""), Base64.DEFAULT);
        return MessageDigest.isEqual(stored, localHash(password, salt)) && name.equals(data.getString("name", ""));
    }

    private android.database.sqlite.SQLiteDatabase openStudentCatalog() throws java.io.IOException {
        java.io.File file = new java.io.File(getCacheDir(), "student-0.5.0.sqlite");
        if (!file.exists()) {
            java.io.File staging = java.io.File.createTempFile("student-", ".tmp", getCacheDir());
            try {
                try (java.io.InputStream source = getAssets().open("student.sqlite");
                     java.io.FileOutputStream target = new java.io.FileOutputStream(staging)) {
                    byte[] buffer = new byte[4096];
                    int length;
                    while ((length = source.read(buffer)) != -1) target.write(buffer, 0, length);
                }
                if (!staging.renameTo(file)) throw new java.io.IOException("Could not install student database");
            } finally { staging.delete(); }
        }
        return android.database.sqlite.SQLiteDatabase.openDatabase(file.getPath(), null,
            android.database.sqlite.SQLiteDatabase.OPEN_READONLY);
    }

    private Button section(LinearLayout parent, String label, View.OnClickListener handler) {
        Button button = primary(label);
        add(parent, button, 10);
        button.setOnClickListener(handler);
        return button;
    }

    private LinearLayout localSection(String name, String title) {
        atHome = false;
        LinearLayout screen = panel();
        banner(screen, title, "قوم دروس");
        section(screen, "العودة للرئيسية", view -> showLocalHome(name));
        return screen;
    }

    private void showLocalHome(String name) {
        localName = name;
        atHome = true;
        LinearLayout screen = panel();
        banner(screen, "موادّي الدراسية", "قوم دروس · " + name);
        String[] subjects = localSubjects();
        LinearLayout toolbar = new LinearLayout(this);
        add(screen,toolbar,12);
        Button menu = primary("☰  القائمة");
        toolbar.addView(menu);
        menu.setOnClickListener(v -> {
            android.widget.PopupMenu drawer = new android.widget.PopupMenu(this,menu);
            String[] items={"حساب الصف","الأخبار والإشعارات","اقتراحاتي","الإعدادات"};
            for(int i=0;i<items.length;i++)drawer.getMenu().add(0,i,i,items[i]);
            drawer.setOnMenuItemClickListener(entry->{
                switch(entry.getItemId()){case 0:openClassroom();break;case 1:showLocalUpdates(name);break;case 2:showLocalSuggestion(name);break;default:showSettings(name);}
                return true;
            });
            drawer.show();
        });
        LinearLayout library = card(screen);
        EditText search = field(library,"بحث في المواد",InputType.TYPE_CLASS_TEXT);
        java.util.List<View> cards = new java.util.ArrayList<>();
        for (String subject : subjects) {
            Button item = new Button(this);
            item.setText(subject + "\nالمصادر والاختبارات");
            item.setAllCaps(false);
            item.setMinHeight(dp(76));
            item.setTextColor(INK);
            item.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL);
            item.setPadding(dp(16),0,dp(16),0);
            item.setBackground(surface(FIELD,12));
            item.setTag(subject);
            cards.add(item);
            add(library,item,7);
            item.setOnClickListener(v -> openSources(name, subject));
        }
        search.addTextChangedListener(new android.text.TextWatcher(){
            public void beforeTextChanged(CharSequence s,int start,int count,int after){}
            public void afterTextChanged(android.text.Editable s){}
            public void onTextChanged(CharSequence s,int start,int before,int count){
                for(View item:cards)item.setVisibility(item.getTag().toString().contains(s.toString().trim())?View.VISIBLE:View.GONE);
            }
        });
        section(screen,"فتح الصف المشترك",v -> openClassroom());
    }

    private void showSettings(String name){
        LinearLayout options = card(localSection(name,"الإعدادات"));
        add(options,text(name,20,INK,true),0);
        section(options,"ملاحظاتي المحفوظة",w -> showLocalNotes(name,0));
        section(options,"الصف على شبكة الواي فاي",w -> openClassroom());
        section(options,"ربط بعنوان المدرسة",w -> configureClass(options));
        section(options,"تسجيل الخروج",w -> setup(""));
    }

    private void connect(String address) {
        origin = address;
        getPreferences(MODE_PRIVATE).edit().putString("origin", address).apply();
        localName = null;
        openStudentApp();
    }

    private void configureClass(LinearLayout parent) {
        EditText address = field(parent, "رابط الطلاب من المالك", InputType.TYPE_TEXT_VARIATION_URI);
        section(parent, "فتح حساب الصف", v -> {
            try { connect(httpsOrigin(address.getText().toString().trim())); }
            catch(Exception error){ address.setError("أدخل رابط HTTPS الصحيح."); }
        });
    }

    private void openSources(String name, String subject) {
        atHome = false;
        LinearLayout root = layout();
        Button back = new Button(this);
        back.setText("المواد الدراسية");
        root.addView(back);
        back.setOnClickListener(v -> leaveSources(name));
        Button quizzes = new Button(this);
        quizzes.setText("اختبارات المادة");
        root.addView(quizzes);
        quizzes.setOnClickListener(v -> new android.app.AlertDialog.Builder(this)
            .setTitle("اختبارات " + subject).setMessage("افتح حساب الصف للاطلاع على الاختبارات التي نشرها المالك.")
            .setPositiveButton("حسنًا",null).show());
        web = new WebView(this);
        root.addView(web,new LinearLayout.LayoutParams(-1,0,1));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){ return true; }
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
                String file = request.getUrl().getLastPathSegment();
                if (request.getUrl().toString().startsWith(ASSETS) && java.util.Arrays.asList("source.html","source.js","ocr-worker.js","core.js","models.js").contains(file)) {
                    try {return new android.webkit.WebResourceResponse(file.endsWith(".html") ? "text/html" : "application/javascript","UTF-8",getAssets().open(file));}
                    catch(Exception ignored){}
                }
                return new android.webkit.WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));
            }
        });
        enablePicker(true);
        web.loadUrl(ASSETS + "source.html?subject=" + Uri.encode(subject));
    }

    private void leaveSources(String name) {
        if (web != null) {
            ((LinearLayout) web.getParent()).removeView(web);
            web.destroy(); web = null;
        }
        showLocalHome(name);
    }

    private String[] localSubjects() {
        java.util.List<String> names = new java.util.ArrayList<>();
        try (android.database.sqlite.SQLiteDatabase db = openStudentCatalog();
             android.database.Cursor rows = db.rawQuery("SELECT name FROM subjects ORDER BY id", null)) {
            while (rows.moveToNext()) names.add(rows.getString(0));
        } catch (Exception error) { android.util.Log.e("QumDorous", "Unable to open subject catalog", error); }
        return names.toArray(new String[0]);
    }

    private void showLocalUpdates(String name) {
        LinearLayout screen = localSection(name, "الأخبار والتحديثات");
        try (android.database.sqlite.SQLiteDatabase db = openStudentCatalog();
             android.database.Cursor rows = db.rawQuery("SELECT title,body FROM updates ORDER BY id DESC", null)) {
            while (rows.moveToNext()) {
                LinearLayout item = card(screen);
                add(item, text(rows.getString(0), 19, INK, true), 0);
                add(item, text(rows.getString(1), 15, MUTED, false), 6);
            }
        } catch (Exception error) {
            add(card(screen), text("تعذّر تحميل التحديثات المحلية.", 16, MUTED, false), 0);
        }
    }

    private void showLocalSuggestion(String name) {
        LinearLayout card = card(localSection(name, "اقتراحات"));
        add(card, text("المسودة تحفظ على الهاتف. الإرسال للمالك متاح عند تشغيل النسخة المتصلة.", 15, MUTED, false), 0);
        EditText entry = field(card, "اقتراحك", InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        entry.setSingleLine(false);
        entry.setMinLines(4);
        entry.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(2000)});
        entry.setText(localData().getString("suggestion_draft", ""));
        TextView status = text("", 14, MUTED, false);
        section(card, "حفظ المسودة", view -> {
            localData().edit().putString("suggestion_draft", entry.getText().toString()).apply();
            status.setText("حُفظت المسودة.");
        });
        add(card, status, 8);
    }

    private void showLocalNotes(String name, int index) {
        LinearLayout screen = localSection(name, "ملاحظاتي");
        LinearLayout card = card(screen);
        String[] subjects = localSubjects();
        if (subjects.length == 0) {
            add(card, text("تعذّر فتح المواد.", 16, MUTED, false), 0);
            return;
        }
        Spinner picker = new Spinner(this);
        ArrayAdapter<String> choices = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, subjects);
        picker.setAdapter(choices);
        picker.setSelection(index);
        add(card, picker, 12);
        EditText note = field(card, "ملاحظتك", InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        note.setSingleLine(false);
        note.setMinLines(4);
        note.setGravity(android.view.Gravity.TOP | android.view.Gravity.START);
        picker.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                note.setText(localData().getString("note_" + position, ""));
            }
            @Override public void onNothingSelected(AdapterView<?> parent) {}
        });
        Button save = primary("حفظ الملاحظة");
        add(card, save, 14);
        TextView status = text("", 14, MUTED, false);
        add(card, status, 7);
        save.setOnClickListener(view -> {
            localData().edit().putString("note_" + picker.getSelectedItemPosition(), note.getText().toString()).apply();
            status.setText("حُفظت على هذا الهاتف.");
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
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString() + " QumDorousAndroid");
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
        enablePicker(false);
        web.loadUrl(origin + "/");
    }

    private void enablePicker(boolean local) {
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (local ? view.getUrl() == null || !view.getUrl().startsWith(ASSETS) : !allowed(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) return false;
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
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != PICK_IMAGE || chooser == null) return;
        Uri selected = result == RESULT_OK && data != null ? data.getData() : null;
        chooser.onReceiveValue(selected != null && "content".equals(selected.getScheme()) ? new Uri[]{selected} : null);
        chooser = null;
    }

    @Override public void onBackPressed() {
        if(getIntent().getBooleanExtra("savedNotes",false)){finish();return;}
        if (localName != null && !atHome) { leaveSources(localName); return; }
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
