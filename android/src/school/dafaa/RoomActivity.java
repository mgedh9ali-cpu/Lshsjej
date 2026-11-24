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
    private WebView web;
    private boolean owner;
    private ValueCallback<Uri[]> picker;
    private volatile String token="";
    private final ExecutorService syncExecutor=Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicBoolean syncInFlight=new java.util.concurrent.atomic.AtomicBoolean();
    private final android.os.Handler syncTimer=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable retrySync=this::synchronizeStudent;
    private volatile boolean foreground;
    private volatile boolean noticesConnected;
    private String backupPassword;
    private String restorePassword;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        if(android.os.Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
        owner="school.dafaa.owner".equals(getPackageName());
        base=owner?"https://room.invalid/":"https://classroom.invalid/";
        if(owner)store=new RoomStore(this);
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
                if(r.getUrl().toString().startsWith(base)&&Arrays.asList("library.js","room.html","room.css","room.js","cairo.woff2","thmanyahsans-Regular.woff2","thmanyahsans-Bold.woff2").contains(file)){
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
    }

    @Override protected void onStart(){
        super.onStart();
        foreground=true;
        if(!owner)syncTimer.post(retrySync);
    }

    @Override protected void onStop(){
        foreground=false;
        syncTimer.removeCallbacks(retrySync);
        super.onStop();
    }

    private SharedPreferences localData(){return getSharedPreferences("offline_student",MODE_PRIVATE);}
    private SharedPreferences cloud(){return getSharedPreferences("internet_classroom",MODE_PRIVATE);}

    private boolean linked(){return !owner || !cloud().getString("key","").isEmpty();}

    private String ownerDevice()throws Exception{
        SharedPreferences config=cloud();
        String device=config.getString("owner_device","");
        if(device.isEmpty()){
            device=RoomStore.random(32);
            if(!config.edit().putString("owner_device",device).commit())throw new Exception("تعذّر حفظ اعتماد الهاتف.");
        }
        return device;
    }

    private String ownerEnrollmentCode()throws Exception{
        byte[] digest=java.security.MessageDigest.getInstance("SHA-256")
            .digest(ownerDevice().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return android.util.Base64.encodeToString(digest,android.util.Base64.URL_SAFE|android.util.Base64.NO_WRAP|android.util.Base64.NO_PADDING);
    }

    private JSONObject cloudRequest(JSONObject payload)throws Exception{
        SharedPreferences config=cloud();
        String origin=config.getString("url",CloudClass.DEFAULT_ORIGIN);
        String key=config.getString("key","");
        if(owner){
            try{return CloudClass.ownerDevice(origin,ownerDevice(),payload);}
            catch(CloudClass.Unauthorized denied){
                if(key.isEmpty())throw new Exception("هذا الهاتف بانتظار اعتماد لوحة المالك.");
            }
        }
        return CloudClass.call(origin,key,payload);
    }

    private JSONObject studentRequest(String op,JSONObject data)throws Exception{
        SharedPreferences config=cloud();
        String device=config.getString("device","");
        if(device.isEmpty()){
            device=RoomStore.random(32);
            if(!config.edit().putString("device",device).commit())throw new Exception("تعذّر حفظ اتصال الصف.");
        }
        JSONObject request=data.put("op",op).put("device",device).put("name",localData().getString("name",""));
        String savedUrl=config.getString("url","");
        if(!savedUrl.isEmpty()&&!savedUrl.equals(CloudClass.DEFAULT_ORIGIN)){
            return cloudRequest(request);
        }
        return CloudClass.student(device,request);
    }

    private JSONArray pendingSuggestions()throws JSONException{
        return new JSONArray(cloud().getString("outbox","[]"));
    }

    private void syncCloud()throws Exception{
        if(!linked()||!localData().getBoolean("remembered",false))return;
        SharedPreferences config=cloud();
        JSONArray pending=pendingSuggestions();
        while(pending.length()>0){
            studentRequest("suggest",pending.getJSONObject(0));
            pending.remove(0);
            if(!config.edit().putString("outbox",pending.toString()).commit())throw new Exception("تعذّر حفظ حالة الإرسال.");
        }
        JSONObject inbox=studentRequest("sync",new JSONObject());
        boolean changed=!inbox.getJSONArray("entries").toString().equals(config.getString("feedback","[]"));
        config.edit().putString("feedback",inbox.getJSONArray("entries").toString()).apply();
        updateStudentNotices(localData(),inbox.getJSONArray("notices"));
        if(changed)refreshCloudUI();
    }

    private void refreshCloudUI(){
        runOnUiThread(()->{
            if(!isFinishing()&&!isDestroyed())web.evaluateJavascript("if(window.cloudUpdated)window.cloudUpdated()",null);
        });
    }

    private void synchronizeStudent(){
        if(!foreground||isFinishing()||isDestroyed())return;
        SharedPreferences local=localData();
        if(!local.getBoolean("remembered",false)||!syncInFlight.compareAndSet(false,true))return;
        syncExecutor.execute(()->{
            try{
                syncCloud();
            }catch(Exception ignored){
                updateStudentNotices(local,null);
            }finally{
                syncInFlight.set(false);
                if(foreground&&!syncExecutor.isShutdown())syncTimer.postDelayed(retrySync,12000);
            }
        });
    }

    private void updateStudentNotices(SharedPreferences local,JSONArray latest){
        boolean online=latest!=null, changed=online!=noticesConnected;
        if(online){
            String json=latest.toString();
            if(!json.equals(local.getString("noticeCache","[]"))){
                local.edit().putString("noticeCache",json).apply();
                changed=true;
            }
        }
        noticesConnected=online;
        if(changed)runOnUiThread(()->{
            if(!isFinishing()&&!isDestroyed())web.evaluateJavascript("if(window.noticesUpdated)window.noticesUpdated()",null);
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
        syncTimer.removeCallbacks(retrySync);
        syncTimer.post(retrySync);
        return RoomStore.obj("name",name);
    }

    private JSONObject studentFeedback()throws Exception{
        return RoomStore.obj("entries",new JSONArray(cloud().getString("feedback","[]")),
            "pending",pendingSuggestions(),"configured",linked(),"online",noticesConnected);
    }

    public final class Bridge{
        @JavascriptInterface public void request(int id,String raw){
            JSONObject input;
            try{input=new JSONObject(raw);}catch(JSONException error){return;}
            String operation=input.optString("op");
            if(operation.equals("ownerEnrollment")||operation.startsWith("online")||
                    operation.equals("studentFeedback")||operation.equals("studentSuggest")){
                syncExecutor.execute(()->{
                    try{
                        if(owner?token.isEmpty():!localData().getBoolean("remembered",false))
                            throw new Exception("سجّل الدخول لربط الصف.");
                        JSONObject result;
                        switch(operation){
                            case "ownerEnrollment":
                                if(!owner)throw new Exception("العملية للمالك.");
                                result=RoomStore.obj("code",ownerEnrollmentCode());break;
                            case "studentFeedback":
                                if(owner)throw new Exception("العملية للطالب.");
                                if(input.optBoolean("refresh")){
                                    syncTimer.removeCallbacks(retrySync);
                                    syncTimer.post(retrySync);
                                }
                                result=studentFeedback();break;
                            case "studentSuggest":
                                if(owner||!linked())throw new Exception("اربط الصف عبر الإنترنت أولًا.");
                                JSONArray queue=pendingSuggestions();
                                if(queue.length()>=20)throw new Exception("انتظر إرسال الاقتراحات المعلّقة.");
                                queue.put(RoomStore.obj("requestId",RoomStore.random(24),"body",RoomStore.check(input,"body",2000),"created",System.currentTimeMillis()));
                                if(!cloud().edit().putString("outbox",queue.toString()).commit())throw new Exception("تعذّر حفظ الاقتراح.");
                                try{syncCloud();}catch(Exception ignored){updateStudentNotices(localData(),null);}
                                result=studentFeedback();break;
                            default:
                                if(!owner)throw new Exception("العملية للمالك.");
                                String action=operation.substring("online".length()).toLowerCase(java.util.Locale.ROOT);
                                result=cloudRequest(input.put("op",action));
                        }
                        finishRequest(id,RoomStore.obj("value",result));
                    }catch(Exception error){
                        try{finishRequest(id,RoomStore.obj("error",RoomLink.safe(error)));}catch(Exception ignored){}
                    }
                });
                return;
            }
            tasks.execute(()->{
                JSONObject result;
                try{
                    JSONObject p=input;String op=operation;
                    Object value;
                    if(op.equals("boot")){
                        SharedPreferences local=localData();
                        value=RoomStore.obj("owner",owner,"studentName",owner?"":local.getString("name",""),
                            "savedSession",owner&&!token.isEmpty(),"hasAccount",!owner&&local.contains("hash"),
                            "cloudUrl",cloud().getString("url",CloudClass.DEFAULT_ORIGIN),
                            "locked",!owner&&!local.getBoolean("remembered",false),
                            "setup",owner&&((JSONObject)store.handle(true,"device",RoomStore.obj("op","status"))).optBoolean("setup"));
                    }else if(!owner&&op.equals("lock")){
                        localData().edit().putBoolean("remembered",false).apply();
                        value=RoomStore.obj();
                    }else if(!owner&&(op.equals("register")||op.equals("unlock"))){
                        value=studentAccount(op,p);
                    }else if(!owner&&op.equals("studentNotices")){
                        if(!localData().getBoolean("remembered",false))throw new Exception("سجّل الدخول لعرض الإشعارات.");
                        if(p.optBoolean("refresh")){
                            syncTimer.removeCallbacks(retrySync);
                            syncTimer.post(retrySync);
                        }
                        value=RoomStore.obj("notices",new JSONArray(localData().getString("noticeCache","[]")),"online",noticesConnected,"configured",linked());
                    }else if(!owner&&(op.equals("getNote")||op.equals("saveNote"))){
                        if(!localData().getBoolean("remembered",false))throw new Exception("سجّل الدخول لفتح ملاحظاتك.");
                        int index=p.optInt("index",-1);
                        if(index<0||index>4)throw new Exception("اختر مادة صالحة.");
                        String key="note_"+index;
                        String note=p.optString("text","");
                        if(op.equals("saveNote")){
                            if(note.length()>16000)throw new Exception("الملاحظة طويلة جدًا.");
                            if(!localData().edit().putString(key,note).commit())throw new Exception("تعذّر حفظ الملاحظة.");
                        }
                        value=RoomStore.obj("text",localData().getString(key,""));
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
                        }else if(op.equals("logout")){
                            token="";
                            getPreferences(MODE_PRIVATE).edit().remove(owner?"ownerToken":"studentToken").remove(owner?"ownerName":"studentName").apply();
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
                finishRequest(id,result);
            });
        }
    }
    private void finishRequest(int id,JSONObject result){
        String js="window.complete("+id+","+JSONObject.quote(result.toString())+")";
        runOnUiThread(()->{if(!isDestroyed())web.evaluateJavascript(js,null);});
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
    @Override protected void onDestroy(){syncTimer.removeCallbacks(retrySync);syncExecutor.shutdownNow();tasks.shutdownNow();if(picker!=null)picker.onReceiveValue(null);web.removeJavascriptInterface("Classroom");web.destroy();super.onDestroy();}
}
