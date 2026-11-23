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
    private static final String BASE="https://room.invalid/";
    private final ExecutorService tasks=Executors.newSingleThreadExecutor();
    private RoomStore store;
    private RoomLink link;
    private WebView web;
    private boolean owner;
    private volatile boolean sharing;
    private ValueCallback<Uri[]> picker;
    private String token="";
    private String remote;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        owner="school.dafaa.owner".equals(getPackageName());
        if(owner){store=new RoomStore(this);link=new RoomLink(store);}
        remote=getPreferences(MODE_PRIVATE).getString("invite","");
        web=new WebView(this);web.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        web.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});
        setContentView(web);web.requestApplyInsets();
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,String url){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                Uri u=r.getUrl();String file=u.getLastPathSegment();
                if(r.getUrl().toString().startsWith(BASE)&&Arrays.asList("room.html","room.css","room.js","ocr-worker.js","core.js","models.js","cairo.woff2").contains(file)){
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
        web.addJavascriptInterface(new Bridge(),"Classroom");web.loadUrl(BASE+"room.html");
    }
    public final class Bridge{
        @JavascriptInterface public void request(int id,String raw){
            tasks.execute(()->{
                JSONObject result;
                try{
                    JSONObject p=new JSONObject(raw);String op=p.getString("op");
                    Object value;
                    if(op.equals("boot"))value=RoomStore.obj("owner",owner,"paired",!remote.isEmpty(),"setup",owner&&((JSONObject)store.handle(true,"device",RoomStore.obj("op","status"))).optBoolean("setup"));
                    else if(!owner&&op.equals("pair")){
                        String code=p.getString("invite").trim();
                        JSONObject response=RoomLink.call(code,RoomStore.obj("op","status"));
                        if(!response.has("value"))throw new Exception("تحقّق من رمز الصف.");
                        getSharedPreferences("room_mode",MODE_PRIVATE).edit().putBoolean("prefer_offline",false).apply();remote=code;token="";getPreferences(MODE_PRIVATE).edit().putString("invite",code).apply();value=RoomStore.obj();
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
                        else{JSONObject response=RoomLink.call(remote,p);if(response.has("error"))throw new Exception(response.getString("error"));value=response.get("value");}
                        if(op.equals("login")||op.equals("setup")){
                            token=((JSONObject)value).getString("token");((JSONObject)value).remove("token");
                        }else if(op.equals("logout")){
                            token="";
                            if(owner&&sharing){link.close();link=new RoomLink(store);sharing=false;runOnUiThread(()->getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));}
                        }
                    }
                    result=RoomStore.obj("value",value);
                }catch(Exception e){try{result=RoomStore.obj("error",RoomLink.safe(e));}catch(Exception impossible){return;}}
                final String js="window.complete("+id+","+JSONObject.quote(result.toString())+")";
                runOnUiThread(()->{if(!isDestroyed())web.evaluateJavascript(js,null);});
            });
        }
    }
    @Override protected void onActivityResult(int code,int result,Intent data){
        super.onActivityResult(code,result,data);
        if(code==89&&picker!=null){Uri u=result==RESULT_OK&&data!=null?data.getData():null;picker.onReceiveValue(u!=null&&"content".equals(u.getScheme())?new Uri[]{u}:null);picker=null;}
    }
    @Override public void onBackPressed(){web.evaluateJavascript("window.backPage ? backPage() : false",v->{if("false".equals(v))super.onBackPressed();});}
    @Override protected void onDestroy(){if(link!=null)link.close();tasks.shutdownNow();if(picker!=null)picker.onReceiveValue(null);web.removeJavascriptInterface("Classroom");web.destroy();super.onDestroy();}
}
