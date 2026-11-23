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
    private boolean unlocked;
    private final ExecutorService tasks=Executors.newSingleThreadExecutor();
    private RoomStore store;
    private RoomLink link;
    private WebView web;
    private boolean owner;
    private volatile boolean sharing;
    private ValueCallback<Uri[]> picker;
    private String token="";
    private String remote;
    private String backupPassword;
    private String restorePassword;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        owner="school.dafaa.owner".equals(getPackageName());
        base=owner?"https://room.invalid/":"https://classroom.invalid/";
        if(owner){store=new RoomStore(this);link=new RoomLink(store);}
        token=getPreferences(MODE_PRIVATE).getString(owner?"ownerToken":"studentToken","");
        unlocked=getSharedPreferences("offline_student",MODE_PRIVATE).getBoolean("remembered",false);
        remote=getPreferences(MODE_PRIVATE).getString("invite","");
        web=new WebView(this);web.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        android.widget.FrameLayout frame=new android.widget.FrameLayout(this);
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
                if(r.getUrl().toString().startsWith(base)&&Arrays.asList("library.js","room.html","room.css","room.js","ocr-worker.js","core.js","models.js","cairo.woff2").contains(file)){
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
        if(owner)tasks.execute(()->{
            try{
                link.start();sharing=true;
                runOnUiThread(()->getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
            }catch(Exception problem){
                runOnUiThread(()->noticeBackup(false,"تعذّر تشغيل مشاركة الصف. افتح الإعدادات وأعد المحاولة."));
            }
        });
    }
    public final class Bridge{
        @JavascriptInterface public void request(int id,String raw){
            tasks.execute(()->{
                JSONObject result;
                try{
                    JSONObject p=new JSONObject(raw);String op=p.getString("op");
                    Object value;
                    if(op.equals("boot"))value=RoomStore.obj("owner",owner,"studentName",token.isEmpty()?"":getPreferences(MODE_PRIVATE).getString(owner?"ownerName":"studentName",""),"savedSession",!token.isEmpty(),"locked",!unlocked&&getSharedPreferences("offline_student",MODE_PRIVATE).contains("hash"),"paired",!remote.isEmpty(),"setup",owner&&((JSONObject)store.handle(true,"device",RoomStore.obj("op","status"))).optBoolean("setup"));
                    else if(!owner&&op.equals("lock")){unlocked=false;getSharedPreferences("offline_student",MODE_PRIVATE).edit().putBoolean("remembered",false).apply();value=RoomStore.obj();}
                    else if(!owner&&op.equals("unlock")){
                        android.content.SharedPreferences old=getSharedPreferences("offline_student",MODE_PRIVATE);
                        byte[] salt=android.util.Base64.decode(old.getString("salt",""),0);
                        byte[] digest=android.util.Base64.decode(old.getString("hash",""),0);
                        if(!java.security.MessageDigest.isEqual(digest,MainActivity.localHash(p.getString("password").toCharArray(),salt)) || !old.getString("name","").equals(p.getString("name")))throw new Exception("الاسم أو كلمة السر غير صحيحة.");
                        unlocked=true;old.edit().putBoolean("remembered",true).apply();value=RoomStore.obj();
                    }else if(!owner&&op.equals("notes")){
                        runOnUiThread(()->startActivity(new Intent(RoomActivity.this,MainActivity.class).putExtra("savedNotes",true)));
                        value=RoomStore.obj();
                    }
                    else if(!owner&&op.equals("pair")){
                        String code=p.getString("invite").trim();
                        JSONObject response=RoomLink.call(code,RoomStore.obj("op","status"));
                        if(!response.has("value"))throw new Exception("تحقّق من رمز الصف.");
                        getSharedPreferences("room_mode",MODE_PRIVATE).edit().putBoolean("prefer_offline",false).apply();
                        String[] previous=remote.split("/"),current=code.split("/");
                        boolean sameClass=previous.length==3&&current.length==3&&previous[2].equals(current[2]);
                        remote=code;
                        android.content.SharedPreferences.Editor editor=getPreferences(MODE_PRIVATE).edit().putString("invite",code);
                        if(!sameClass){token="";editor.remove("studentToken").remove("studentName");}
                        editor.apply();
                        value=RoomStore.obj("retained",sameClass&&!token.isEmpty());
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
                    }else if(owner&&op.equals("share")){
                        store.handle(true,"device",RoomStore.obj("op","home","token",token));
                        link.start();String code=link.invitation();sharing=true;
                        runOnUiThread(()->{getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                            if(!code.startsWith("qum1/127."))startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,code),"إرسال رمز الصف"));});
                        value=RoomStore.obj("invite",code);
                    }else if(op.equals("local")&&!owner){getSharedPreferences("room_mode",MODE_PRIVATE).edit().putBoolean("prefer_offline",true).apply();runOnUiThread(()->finish());value=RoomStore.obj();}
                    else{
                        p.put("token",token);
                        if(owner)value=store.handle(true,"device",p);
                        else{JSONObject response=RoomLink.call(remote,p);if(response.has("error")){String error=response.getString("error");if(error.contains("انتهت الجلسة")){token="";getPreferences(MODE_PRIVATE).edit().remove("studentToken").remove("studentName").apply();}throw new Exception(error);}value=response.get("value");}
                        if(op.equals("login")||op.equals("setup")){
                            token=((JSONObject)value).getString("token");
                            getPreferences(MODE_PRIVATE).edit().putString(owner?"ownerToken":"studentToken",token).putString(owner?"ownerName":"studentName",((JSONObject)value).getString("name")).apply();((JSONObject)value).remove("token");
                        }else if(op.equals("logout")){
                            token="";
                            getPreferences(MODE_PRIVATE).edit().remove(owner?"ownerToken":"studentToken").remove(owner?"ownerName":"studentName").apply();
                            if(owner&&sharing){link.close();link=new RoomLink(store);sharing=false;runOnUiThread(()->getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));}
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
    @Override protected void onDestroy(){if(link!=null)link.close();tasks.shutdownNow();if(picker!=null)picker.onReceiveValue(null);web.removeJavascriptInterface("Classroom");web.destroy();super.onDestroy();}
}
