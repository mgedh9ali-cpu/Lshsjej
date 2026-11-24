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
    private byte[] pendingSourceDownload;
    private String restorePassword;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        if(android.os.Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
        owner="school.dafaa.owner".equals(getPackageName());
        base=owner?"https://room.invalid/":"https://classroom.invalid/";
        if(owner){store=new RoomStore(this);cloud().edit().remove("owner_session").apply();}
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
                try{startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(p.getAcceptTypes().length==1&&p.getAcceptTypes()[0].startsWith("image/")?"image/*":"*/*"),89);}
                catch(ActivityNotFoundException e){picker=null;cb.onReceiveValue(null);}return true;
            }});
        web.addJavascriptInterface(new Bridge(),"Classroom");web.loadUrl(base+"room.html");
    }

    @Override protected void onStart(){
        super.onStart();
        foreground=true;
        if(!owner){syncTimer.removeCallbacks(retrySync);syncTimer.post(retrySync);}
    }

    @Override protected void onStop(){
        foreground=false;
        syncTimer.removeCallbacks(retrySync);
        super.onStop();
    }

    private SharedPreferences localData(){return getSharedPreferences("offline_student",MODE_PRIVATE);}
    private SharedPreferences cloud(){return getSharedPreferences("internet_classroom",MODE_PRIVATE);}

    private boolean linked(){return !owner || !cloud().getString("key","").isEmpty();}

    private JSONObject cloudRequest(JSONObject payload)throws Exception{
        return cloudRequest(payload,null);
    }

    private JSONObject cloudRequest(JSONObject payload,CloudClass.Progress progress)throws Exception{
        SharedPreferences config=cloud();
        String origin=owner?CloudClass.DEFAULT_ORIGIN:config.getString("url",CloudClass.DEFAULT_ORIGIN);
        if(!owner)return CloudClass.call(origin,config.getString("key",""),payload);
        String device=config.getString("owner_device","");
        if(device.isEmpty())
            throw new Exception("اتصال المالك غير متاح على هذا الهاتف.");
        try{
            return progress==null?CloudClass.ownerDevice(origin,device,payload):
                CloudClass.upload(origin,"OwnerDevice "+device,payload,progress);
        }catch(CloudClass.Unauthorized denied){
            throw new Exception("اتصال المالك غير متاح على هذا الهاتف.");
        }
    }

    private JSONObject studentRequest(String op,JSONObject data)throws Exception{
        return studentRequest(op,data,null);
    }

    private JSONObject studentRequest(String op,JSONObject data,CloudClass.Progress progress)throws Exception{
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
        return progress==null?CloudClass.student(device,request):
            CloudClass.upload(CloudClass.DEFAULT_ORIGIN,"Device "+device,request,progress);
    }

    private JSONArray pendingSuggestions()throws JSONException{
        return new JSONArray(cloud().getString("outbox","[]"));
    }

    private void syncCloud()throws Exception{
        if(!linked()||!localData().getBoolean("remembered",false))return;
        SharedPreferences config=cloud();
        JSONObject inbox=studentRequest("sync",new JSONObject());
        JSONArray pending=pendingSuggestions();
        boolean sent=false;
        while(pending.length()>0){
            try{studentRequest("suggest",pending.getJSONObject(0));}
            catch(Exception error){break;}
            pending.remove(0);sent=true;
            if(!config.edit().putString("outbox",pending.toString()).commit())throw new Exception("تعذّر حفظ حالة الإرسال.");
        }
        if(sent){
            try{inbox=studentRequest("sync",new JSONObject());}catch(Exception ignored){}
        }
        notifyStudent(inbox);
        boolean changed=!inbox.getJSONArray("entries").toString().equals(config.getString("feedback","[]"));
        config.edit().putString("feedback",inbox.getJSONArray("entries").toString()).apply();
        updateStudentNotices(localData(),inbox.getJSONArray("notices"));
        if(changed)refreshCloudUI();
    }

    private static final String NOTICE_CHANNEL="class_updates";
    private boolean studentAlertsAllowed(){
        android.app.NotificationManager manager=getSystemService(android.app.NotificationManager.class);
        return (android.os.Build.VERSION.SDK_INT<24||manager.areNotificationsEnabled()) &&
            (android.os.Build.VERSION.SDK_INT<33||checkSelfPermission("android.permission.POST_NOTIFICATIONS")==android.content.pm.PackageManager.PERMISSION_GRANTED);
    }
    private void notifyStudent(JSONObject inbox)throws JSONException{
        if(!localData().getBoolean("remembered",false))return;
        if(!localData().getBoolean("alerts",false)||!studentAlertsAllowed())return;
        JSONArray notices=inbox.getJSONArray("notices"), entries=inbox.getJSONArray("entries");
        JSONArray previous=new JSONArray(localData().getString("noticeCache","[]"));
        JSONArray oldEntries=new JSONArray(cloud().getString("feedback","[]"));
        Set<Long> priorIds=new HashSet<>();
        for(int i=0;i<previous.length();i++)priorIds.add(previous.getJSONObject(i).getLong("id"));
        Map<String,String> oldReplies=new HashMap<>();
        for(int i=0;i<oldEntries.length();i++){
            JSONObject item=oldEntries.getJSONObject(i);
            oldReplies.put(item.getString("id"),item.optString("reply",""));
        }
        boolean newReply=false;
        for(int i=0;i<entries.length();i++){
            JSONObject item=entries.getJSONObject(i);
            String reply=item.isNull("reply")?"":item.optString("reply","");
            if(!reply.isEmpty()&&!reply.equals(oldReplies.get(item.getString("id"))))newReply=true;
        }
        boolean newNotice=false;
        for(int i=0;i<notices.length();i++)if(!priorIds.contains(notices.getJSONObject(i).getLong("id")))newNotice=true;
        if(!newReply&&!newNotice)return;
        android.app.NotificationManager manager=getSystemService(android.app.NotificationManager.class);
        if(android.os.Build.VERSION.SDK_INT>=26)
            manager.createNotificationChannel(new android.app.NotificationChannel(NOTICE_CHANNEL,"أخبار الصف",android.app.NotificationManager.IMPORTANCE_DEFAULT));
        Intent launch=new Intent(this,RoomActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        android.app.PendingIntent tap=android.app.PendingIntent.getActivity(this,0,launch,android.app.PendingIntent.FLAG_IMMUTABLE);
        android.app.Notification.Builder builder=android.os.Build.VERSION.SDK_INT>=26?
            new android.app.Notification.Builder(this,NOTICE_CHANNEL):new android.app.Notification.Builder(this);
        manager.notify(101,builder.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("قوم دروس")
            .setContentText(newReply?"وصلك رد في الاقتراحات.":"لديك إشعار جديد في الصف.")
            .setAutoCancel(true).setVisibility(android.app.Notification.VISIBILITY_PRIVATE).setContentIntent(tap).build());
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
                if(foreground&&!syncExecutor.isShutdown())syncTimer.postDelayed(retrySync,5000);
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

    private static byte[] localHash(char[] password, byte[] salt) throws Exception {
        javax.crypto.spec.PBEKeySpec spec = new javax.crypto.spec.PBEKeySpec(password, salt, 210000, 256);
        try { return javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).getEncoded(); }
        finally { spec.clearPassword(); java.util.Arrays.fill(password, '\0'); }
    }

    private Object studentAccount(String op,JSONObject p)throws Exception{
        SharedPreferences local=localData();
        String importedEmail=local.getString("email","");
        String email=p.optString("email","").trim().toLowerCase(Locale.ROOT);
        if(email.length()>254||!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches())
            throw new Exception("أدخل عنوان بريد إلكتروني صحيحًا.");
        String name=op.equals("register")?RoomStore.check(p,"name",100):local.getString("name","");
        if(!op.equals("register")&&!importedEmail.isEmpty()&&!importedEmail.equals(email))
            throw new Exception("البريد أو كلمة السر غير صحيحة.");
        String password=p.optString("password","");
        if(password.length()<6||password.length()>128)throw new Exception("اكتب كلمة سر من 6 إلى 128 حرفًا.");
        SharedPreferences.Editor edit=local.edit();
        if(op.equals("register")){
            if(local.contains("hash"))throw new Exception("يوجد حساب محلي على هذا الهاتف بالفعل.");
            if(name.matches("(?s).*\\p{Cntrl}.*"))throw new Exception("الاسم غير صالح.");
            byte[] salt=new byte[16];
            new java.security.SecureRandom().nextBytes(salt);
            edit.putString("name",name).putString("salt",android.util.Base64.encodeToString(salt,2))
                .putString("hash",android.util.Base64.encodeToString(localHash(password.toCharArray(),salt),2));
        }else{
            byte[] salt=android.util.Base64.decode(local.getString("salt",""),0);
            byte[] digest=android.util.Base64.decode(local.getString("hash",""),0);
            if(!local.contains("hash")||
                !java.security.MessageDigest.isEqual(digest,localHash(password.toCharArray(),salt)))
                throw new Exception("الاسم أو كلمة السر غير صحيحة.");
        }
        if(!edit.putString("email",email).putBoolean("remembered",true).commit())throw new Exception("تعذّر حفظ الحساب على الهاتف.");
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
            if(operation.startsWith("online")||operation.startsWith("shared")||
                    operation.equals("studentFeedback")||operation.equals("studentNotices")||operation.equals("studentSuggest")){
                syncExecutor.execute(()->{
                    try{
                        if(owner?token.isEmpty():!localData().getBoolean("remembered",false))
                            throw new Exception("سجّل الدخول لربط الصف.");
                        JSONObject result;
                        switch(operation){
                            case "sharedSubjects":
                            case "sharedList":
                            case "sharedImage":
                            case "sharedPublish":
                            case "sharedRemove":
                            case "sharedStudy":
                            case "sharedSolve":
                            case "sharedDownload":
                                String actionName;
                                switch(operation){
                                    case "sharedSubjects": actionName="subjects";break;
                                    case "sharedList": actionName="sources";break;
                                    case "sharedPublish": actionName="addsource";break;
                                    case "sharedRemove": actionName="removesource";break;
                                    case "sharedStudy": actionName="study";break;
                                    case "sharedSolve": actionName="solve";break;
                                    default: actionName="source";
                                }
                                CloudClass.Progress progress=operation.equals("sharedPublish")?(bytes,total)->runOnUiThread(()->{
                                    if(!isDestroyed())web.evaluateJavascript("window.uploadProgress("+id+","+bytes+","+total+")",null);
                                }):null;
                                result=owner?cloudRequest(input.put("op",actionName),progress):studentRequest(actionName,input,progress);
                                if(operation.equals("sharedDownload")){
                                    prepareSourceDownload(result.getJSONObject("entry"));
                                    result=RoomStore.obj();
                                }
                                break;
                            case "studentNotices":
                            case "studentFeedback":
                                if(owner)throw new Exception("العملية للطالب.");
                                if(input.optBoolean("refresh")){
                                    try{syncCloud();}catch(Exception error){updateStudentNotices(localData(),null);}
                                }
                                result=operation.equals("studentFeedback")?studentFeedback():
                                    RoomStore.obj("notices",new JSONArray(localData().getString("noticeCache","[]")),
                                        "online",noticesConnected,"configured",linked());
                                break;
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
                            "studentEmail",owner?"":local.getString("email",""),"savedSession",owner&&!token.isEmpty(),"hasAccount",!owner&&local.contains("hash"),
                            "cloudUrl",cloud().getString("url",CloudClass.DEFAULT_ORIGIN),
                            "locked",!owner&&!local.getBoolean("remembered",false),
                            "setup",owner&&((JSONObject)store.handle(true,"device",RoomStore.obj("op","status"))).optBoolean("setup"));
                    }else if(!owner&&(op.equals("register")||op.equals("unlock"))){
                        value=studentAccount(op,p);
                    }else if(!owner&&op.equals("studentLogout")){
                        if(!localData().edit().putBoolean("remembered",false).commit())throw new Exception("تعذّر تسجيل الخروج.");
                        value=RoomStore.obj();
                    }else if(!owner&&op.equals("studentAlertSettings")){
                        if(p.has("enabled")){
                            boolean enabled=p.getBoolean("enabled");
                            localData().edit().putBoolean("alerts",enabled).apply();
                            if(enabled&&android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=android.content.pm.PackageManager.PERMISSION_GRANTED)
                                runOnUiThread(()->requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},55));
                        }
                        value=RoomStore.obj("allowed",studentAlertsAllowed(),"enabled",localData().getBoolean("alerts",false));
                    }else if(!owner&&(op.equals("getNote")||op.equals("saveNote"))){
                        if(!localData().getBoolean("remembered",false))throw new Exception("سجّل الدخول لفتح ملاحظاتك.");
                        int index=p.optInt("index",-1);
                        if(index<0||index>5)throw new Exception("اختر مادة صالحة.");
                        String key="note_"+index;
                        String note=p.optString("text","");
                        if(op.equals("saveNote")){
                            if(note.length()>16000)throw new Exception("الملاحظة طويلة جدًا.");
                            if(!localData().edit().putString(key,note).commit())throw new Exception("تعذّر حفظ الملاحظة.");
                        }
                        value=RoomStore.obj("text",localData().getString(key,""));
                    }else if(op.equals("openStudyLink")){
                        if(owner?token.isEmpty():!localData().getBoolean("remembered",false))
                            throw new Exception("سجّل الدخول لفتح الرابط.");
                        java.net.URI link=new java.net.URI(RoomStore.check(p,"url",2000));
                        if(!"https".equals(link.getScheme())||link.getHost()==null||link.getUserInfo()!=null)
                            throw new Exception("رابط الاختبار غير صالح.");
                        runOnUiThread(()->{
                            try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(link.toASCIIString())).addCategory(Intent.CATEGORY_BROWSABLE));}
                            catch(ActivityNotFoundException e){noticeBackup(false,"تعذّر فتح رابط الاختبار.");}
                        });
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
    private void prepareSourceDownload(JSONObject entry)throws Exception{
        JSONObject file=entry.optJSONObject("file");
        final String name=file==null?"QumDorous-source-"+entry.getLong("id")+".jpg":file.getString("name");
        final String mime=file==null?"image/jpeg":"application/octet-stream";
        String encoded=file==null?entry.getString("image").substring("data:image/jpeg;base64,".length()):file.getString("base64");
        final byte[] bytes=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);
        runOnUiThread(()->{
            if(isFinishing()||isDestroyed())return;
            if(pendingSourceDownload!=null){noticeBackup(false,"أكمل تنزيل المصدر الحالي أولًا.");return;}
            pendingSourceDownload=bytes;
            try{
                startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime).putExtra(Intent.EXTRA_TITLE,name),92);
            }catch(ActivityNotFoundException e){pendingSourceDownload=null;noticeBackup(false,"تعذّر فتح نافذة التنزيل.");}
        });
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] results){
        super.onRequestPermissionsResult(requestCode,permissions,results);
        if(requestCode==55&&!isDestroyed())web.evaluateJavascript("if(window.studentPermissionChanged)window.studentPermissionChanged()",null);
    }
    @Override protected void onActivityResult(int code,int result,Intent data){
        super.onActivityResult(code,result,data);
        if(code==89&&picker!=null){
            Uri u=result==RESULT_OK&&data!=null?data.getData():null;
            picker.onReceiveValue(u!=null&&"content".equals(u.getScheme())?new Uri[]{u}:null);
            picker=null;
            return;
        }
        if(code==92){
            final byte[] bytes=pendingSourceDownload;
            pendingSourceDownload=null;
            final Uri destination=result==RESULT_OK&&data!=null?data.getData():null;
            if(bytes!=null&&destination!=null&&"content".equals(destination.getScheme()))tasks.execute(()->{
                try(java.io.OutputStream out=getContentResolver().openOutputStream(destination,"w")){
                    if(out==null)throw new java.io.IOException();
                    out.write(bytes);
                }catch(Exception e){
                    runOnUiThread(()->noticeBackup(false,"تعذّر حفظ المصدر."));
                    return;
                }
                runOnUiThread(()->noticeBackup(true,"تم تنزيل المصدر."));
            });
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
