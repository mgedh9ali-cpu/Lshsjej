package school.dafaa;
import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;
import android.view.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public final class RoomActivity extends Activity {
    private String base;
    private final ExecutorService tasks=Executors.newSingleThreadExecutor();
    private RoomStore store;
    private RoomLink link;
    private WebView web;
    private boolean owner;
    private volatile boolean sharing;
    private ValueCallback<Uri[]> picker;
    private String token="";
    private LocalRegistration registration;
    private final ExecutorService registrationTask=Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicBoolean registrationInFlight=new java.util.concurrent.atomic.AtomicBoolean();
    private final android.os.Handler registrationTimer=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable retryRegistration=this::deliverRegistration;
    private String backupPassword;
    private String restorePassword;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        if(android.os.Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
        owner="school.dafaa.owner".equals(getPackageName());
        base=owner?"https://room.invalid/":"https://classroom.invalid/";
        registration=new LocalRegistration(this);
        if(owner){store=new RoomStore(this);link=new RoomLink(store,this::registrationArrived);}
        token=getPreferences(MODE_PRIVATE).getString(owner?"ownerToken":"studentToken","");

        web=new WebView(this);web.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        android.widget.FrameLayout frame=new android.widget.FrameLayout(this);
        int background=0xfff6f8fb;
        frame.setBackgroundColor(background);
        web.setBackgroundColor(background);
        frame.addView(web);
        frame.setOnApplyWindowInsetsListener((v,i)->{
            if(android.os.Build.VERSION.SDK_INT>=30){
                android.graphics.Insets safe=i.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());
                v.setPadding(safe.left,safe.top,safe.right,safe.bottom);
            }else v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());
            return i;
        });
        setContentView(frame);frame.requestApplyInsets();
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,String url){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                Uri u=r.getUrl();String file=u.getLastPathSegment();
                if(r.getUrl().toString().startsWith(base)&&Arrays.asList("library.js","room.html","room.css","room.js","ocr-worker.js","core.js","models.js","cairo.woff2","thmanyahsans-Regular.woff2","thmanyahsans-Bold.woff2").contains(file)){
                    try{return new WebResourceResponse(file.endsWith(".html")?"text/html":file.endsWith(".css")?"text/css":file.endsWith(".woff2")?"font/woff2":"application/javascript",file.endsWith(".woff2")?null:"UTF-8",getAssets().open(file));}catch(Exception ignored){}
                }
                return new WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));
            }});
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams p){
                if(picker!=null)picker.onReceiveValue(null);picker=cb;
                try{startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*"),89);}
                catch(ActivityNotFoundException e){picker=null;cb.onReceiveValue(null);}return true;
            }});
        web.addJavascriptInterface(new Bridge(),"Classroom");web.loadUrl(base+"room.html");
        if(owner&&!token.isEmpty())tasks.execute(this::startRegistrationService);
        if(!owner)registrationTimer.post(retryRegistration);
    }

    private void registrationArrived(String name){
        runOnUiThread(()->{
            if(!isFinishing()&&!isDestroyed())web.evaluateJavascript("if(window.registrationArrived)window.registrationArrived("+JSONObject.quote(name)+")",null);
        });
    }

    private void startRegistrationService(){
        try{
            store.handle(true,"device",RoomStore.obj("op","resume","token",token));
            link.start();
            registration.advertise(link.fingerprint());
            sharing=true;
            runOnUiThread(()->getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
        }catch(Exception problem){
            runOnUiThread(()->noticeBackup(false,"تعذّر تشغيل استقبال تسجيلات الطلاب."));
        }
    }

    private SharedPreferences localData(){return getSharedPreferences("offline_student",MODE_PRIVATE);}

    private void deliverRegistration(){
        if(isFinishing()||isDestroyed())return;
        SharedPreferences local=localData();
        if(!local.contains("hash")||local.getBoolean("registrationSent",false)||!registrationInFlight.compareAndSet(false,true))return;
        registrationTask.execute(()->{
            try{
                String id=local.getString("registrationId","");
                if(id.isEmpty()){
                    id=RoomStore.random(18);
                    if(!local.edit().putString("registrationId",id).commit())throw new IllegalStateException();
                }
                String pin=registration.send(id,local.getString("name",""),local.getString("registeredOwner",""));
                if(pin!=null&&local.edit().putString("registeredOwner",pin).putBoolean("registrationSent",true).commit()){
                    runOnUiThread(()->{
                        if(!isFinishing()&&!isDestroyed())web.evaluateJavascript("if(window.registrationDelivered)window.registrationDelivered()",null);
                    });
                }
            }catch(Exception ignored){}
            registrationInFlight.set(false);
            if(!registrationTask.isShutdown()&&!local.getBoolean("registrationSent",false))
                registrationTimer.postDelayed(retryRegistration,8000);
        });
    }

    private Object studentAccount(String op,JSONObject p)throws Exception{
        SharedPreferences local=localData();
        String name=RoomStore.check(p,"name",100);
        String password=p.optString("password","");
        if(password.length()<6||password.length()>128)throw new Exception("اكتب كلمة سر من 6 إلى 128 حرفًا.");
        SharedPreferences.Editor edit=local.edit();
        if(op.equals("register")){
            if(local.contains("hash"))throw new Exception("يوجد حساب محلي على هذا الهاتف بالفعل.");
            if(name.matches("(?s).*\\p{Cntrl}.*"))throw new Exception("الاسم غير صالح.");
            byte[] salt=new byte[16];
            new java.security.SecureRandom().nextBytes(salt);
            edit.putString("name",name).putString("salt",android.util.Base64.encodeToString(salt,2))
                .putString("hash",android.util.Base64.encodeToString(MainActivity.localHash(password.toCharArray(),salt),2));
        }else{
            byte[] salt=android.util.Base64.decode(local.getString("salt",""),0);
            byte[] digest=android.util.Base64.decode(local.getString("hash",""),0);
            if(!local.contains("hash")||!local.getString("name","").equals(name)||
                !java.security.MessageDigest.isEqual(digest,MainActivity.localHash(password.toCharArray(),salt)))
                throw new Exception("الاسم أو كلمة السر غير صحيحة.");
        }
        if(!edit.putBoolean("remembered",true).commit())throw new Exception("تعذّر حفظ الحساب على الهاتف.");
        registrationTimer.removeCallbacks(retryRegistration);
        registrationTimer.post(retryRegistration);
        return RoomStore.obj("name",name);
    }

    public final class Bridge{
        @JavascriptInterface public void request(int id,String raw){
            tasks.execute(()->{
                JSONObject result;
                try{
                    JSONObject p=new JSONObject(raw);String op=p.getString("op");
                    Object value;
                    if(op.equals("boot")){
                        SharedPreferences local=localData();
                        value=RoomStore.obj("owner",owner,"studentName",owner?"":local.getString("name",""),
                            "savedSession",owner&&!token.isEmpty(),"hasAccount",!owner&&local.contains("hash"),
                            "registrationSent",!owner&&local.getBoolean("registrationSent",false),
                            "locked",!owner&&!local.getBoolean("remembered",false),
                            "setup",owner&&((JSONObject)store.handle(true,"device",RoomStore.obj("op","status"))).optBoolean("setup"));
                    }else if(!owner&&op.equals("lock")){
                        localData().edit().putBoolean("remembered",false).apply();
                        value=RoomStore.obj();
                    }else if(!owner&&(op.equals("register")||op.equals("unlock"))){
                        value=studentAccount(op,p);
                    }else if(!owner&&op.equals("notes")){
                        runOnUiThread(()->startActivity(new Intent(RoomActivity.this,MainActivity.class).putExtra("savedNotes",true)));
                        value=RoomStore.obj();
                    }else if(owner&&op.equals("backup")){
                        backupPassword=RoomStore.check(p,"password",200);
                        if(backupPassword.length()<12)throw new Exception("اختر كلمة مرور للنسخة من 12 حرفًا على الأقل.");
                        runOnUiThread(()->{
                            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);
                            intent.addCategory(Intent.CATEGORY_OPENABLE);
                            intent.setType("application/octet-stream");
                            intent.putExtra(Intent.EXTRA_TITLE,"QumDorous-classroom-"+new java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.US).format(new java.util.Date())+".qdb");
                            try{startActivityForResult(intent,90);}
                            catch(Exception e){backupPassword=null;noticeBackup(false,"تعذّر فتح نافذة حفظ النسخة.");}
                        });
                        value=RoomStore.obj("started",true);
                    }else if(owner&&op.equals("restore")){
                        restorePassword=RoomStore.check(p,"password",200);
                        if(restorePassword.length()<12)throw new Exception("أدخل كلمة مرور النسخة الاحتياطية.");
                        runOnUiThread(()->{
                            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
                            intent.addCategory(Intent.CATEGORY_OPENABLE);
                            intent.setType("*/*");
                            try{startActivityForResult(intent,91);}
                            catch(Exception e){restorePassword=null;noticeBackup(false,"تعذّر فتح نافذة اختيار النسخة.");}
                        });
                        value=RoomStore.obj("started",true);
                    }else{
                        if(!owner)throw new Exception("العملية للمالك.");
                        p.put("token",token);
                        value=store.handle(true,"device",p);
                        if(op.equals("login")||op.equals("setup")){
                            token=((JSONObject)value).getString("token");
                            getPreferences(MODE_PRIVATE).edit().putString(owner?"ownerToken":"studentToken",token).putString(owner?"ownerName":"studentName",((JSONObject)value).getString("name")).apply();((JSONObject)value).remove("token");
                            startRegistrationService();
                        }else if(op.equals("logout")){
                            token="";
                            getPreferences(MODE_PRIVATE).edit().remove(owner?"ownerToken":"studentToken").remove(owner?"ownerName":"studentName").apply();
                            if(owner&&sharing){registration.close();link.close();link=new RoomLink(store,RoomActivity.this::registrationArrived);sharing=false;runOnUiThread(()->getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));}
                        }
                    }
                    result=RoomStore.obj("value",value);
                }catch(Exception e){
                    if(e.getMessage()!=null&&e.getMessage().contains("انتهت الجلسة")){
                        token="";
                        getPreferences(MODE_PRIVATE).edit().remove(owner?"ownerToken":"studentToken").remove(owner?"ownerName":"studentName").apply();
                    }
                    try{result=RoomStore.obj("error",RoomLink.safe(e));}catch(Exception impossible){return;}
                }
                final String js="window.complete("+id+","+JSONObject.quote(result.toString())+")";
                runOnUiThread(()->{if(!isDestroyed())web.evaluateJavascript(js,null);});
            });
        }
    }
    private void noticeBackup(boolean success,String message){
        if(web==null||isDestroyed())return;
        web.evaluateJavascript("window.backupComplete("+success+","+JSONObject.quote(message)+")",null);
    }
    @Override protected void onActivityResult(int code,int result,Intent data){
        super.onActivityResult(code,result,data);
        if(code==89&&picker!=null){
            Uri u=result==RESULT_OK&&data!=null?data.getData():null;
            picker.onReceiveValue(u!=null&&"content".equals(u.getScheme())?new Uri[]{u}:null);
            picker=null;
            return;
        }
        if(code!=90&&code!=91)return;
        final boolean exporting=code==90;
        final String pass=exporting?backupPassword:restorePassword;
        backupPassword=null;restorePassword=null;
        final Uri file=result==RESULT_OK&&data!=null?data.getData():null;
        if(file==null||pass==null){noticeBackup(false,"أُلغيت العملية دون تغيير البيانات.");return;}
        tasks.execute(()->{
            try{
                if(exporting){
                    try(java.io.OutputStream out=getContentResolver().openOutputStream(file,"w")){
                        if(out==null)throw new Exception("تعذّر إنشاء ملف النسخة.");
                        store.writeEncryptedBackup(out,pass);
                    }
                    runOnUiThread(()->noticeBackup(true,"حُفظت نسخة احتياطية مشفّرة. احتفظ بكلمة المرور لاستعادتها."));
                }else{
                    try(java.io.InputStream in=getContentResolver().openInputStream(file)){
                        if(in==null)throw new Exception("تعذّر قراءة ملف النسخة.");
                        store.restoreEncryptedBackup(in,pass);
                    }
                    runOnUiThread(()->{
                        android.widget.Toast.makeText(this,"تمت استعادة البيانات. ستُعاد فتح لوحة المالك.",android.widget.Toast.LENGTH_LONG).show();
                        Intent restart=new Intent(this,RoomActivity.class);
                        finish();startActivity(restart);
                    });
                }
            }catch(Exception failure){
                runOnUiThread(()->noticeBackup(false,RoomLink.safe(failure)));
            }
        });
    }
    @Override public void onBackPressed(){web.evaluateJavascript("window.backPage ? backPage() : false",v->{if("false".equals(v))super.onBackPressed();});}
    @Override protected void onDestroy(){registrationTimer.removeCallbacks(retryRegistration);registrationTask.shutdownNow();registration.close();if(link!=null)link.close();tasks.shutdownNow();if(picker!=null)picker.onReceiveValue(null);web.removeJavascriptInterface("Classroom");web.destroy();super.onDestroy();}
}
