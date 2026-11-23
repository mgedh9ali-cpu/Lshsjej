package school.dafaa;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.util.Base64;
import org.json.*;
import java.util.*;
import java.security.*;
import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

final class RoomStore {
    private final SQLiteDatabase db;
    private final Map<String,long[]> attempts = new HashMap<>();
    private static final SecureRandom RNG = new SecureRandom();
    RoomStore(Context c){
        db=c.openOrCreateDatabase("classroom.db",Context.MODE_PRIVATE,null);
        db.execSQL("CREATE TABLE IF NOT EXISTS accounts(name TEXT PRIMARY KEY, salt TEXT NOT NULL, verifier TEXT NOT NULL, owner INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, owner INTEGER NOT NULL, created INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX IF NOT EXISTS sessions_account ON sessions(name,owner)");
        db.execSQL("CREATE TABLE IF NOT EXISTS subjects(id INTEGER PRIMARY KEY,name TEXT UNIQUE,page INTEGER DEFAULT 0)");
        db.execSQL("CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,title TEXT,body TEXT,created INTEGER)");
        db.execSQL("CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY,name TEXT,body TEXT,reply TEXT,created INTEGER)");
        db.execSQL("CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY,subject INTEGER,title TEXT,topic TEXT,body TEXT,image TEXT,created INTEGER,UNIQUE(subject,topic))");
        db.execSQL("CREATE TABLE IF NOT EXISTS quizzes(id INTEGER PRIMARY KEY,subject INTEGER,title TEXT,question TEXT,choices TEXT,answer INTEGER,published INTEGER DEFAULT 0)");
        db.execSQL("CREATE TABLE IF NOT EXISTS results(id INTEGER PRIMARY KEY,quiz INTEGER,name TEXT,choice INTEGER,correct INTEGER,created INTEGER)");
        // Keep existing classroom databases intact while enabling activity and source attribution.
        if(!hasColumn("accounts","last_seen"))db.execSQL("ALTER TABLE accounts ADD COLUMN last_seen INTEGER");
        if(!hasColumn("sources","added_by"))db.execSQL("ALTER TABLE sources ADD COLUMN added_by TEXT");
        for(String subject:new String[]{"الفيزياء","الكيمياء","العلوم","الإنجليزي","الرياضيات"})
            db.execSQL("INSERT OR IGNORE INTO subjects(name) VALUES(?)",new Object[]{subject});
    }
    private boolean hasColumn(String table,String column){
        try(Cursor cursor=db.rawQuery("PRAGMA table_info("+table+")",null)){
            while(cursor.moveToNext())if(column.equals(cursor.getString(1)))return true;
        }
        return false;
    }
    private static String tokenHash(String token)throws Exception{
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(digest,Base64.NO_WRAP);
    }
    private JSONArray rows(String sql,String... args)throws Exception{
        JSONArray list=new JSONArray();
        try(Cursor cur=db.rawQuery(sql,args)){
            while(cur.moveToNext()){
                JSONObject item=new JSONObject();
                for(int i=0;i<cur.getColumnCount();i++){
                    Object v=cur.isNull(i)?JSONObject.NULL:cur.getType(i)==Cursor.FIELD_TYPE_INTEGER?(Object)cur.getLong(i):cur.getString(i);
                    item.put(cur.getColumnName(i),v);
                }
                list.put(item);
            }
        }
        return list;
    }
    static String check(JSONObject p,String key,int max)throws Exception{
        String v=p.optString(key,"").trim();
        if(v.isEmpty()||v.length()>max)throw new Exception("تحقّق من الحقل المطلوب.");
        return v;
    }
    static JSONObject obj(Object... pairs)throws Exception{
        JSONObject r=new JSONObject();
        for(int i=0;i<pairs.length;i+=2)r.put((String)pairs[i],pairs[i+1]);
        return r;
    }
    static String random(int n){
        byte[] bytes=new byte[n];RNG.nextBytes(bytes);
        return Base64.encodeToString(bytes,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
    }
    private static byte[] hash(String pass,String salt)throws Exception{
        PBEKeySpec spec=new PBEKeySpec(pass.toCharArray(),salt.getBytes("UTF-8"),180000,256);
        try{return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).getEncoded();}
        finally{spec.clearPassword();}
    }
    private void account(JSONObject p,boolean owner)throws Exception{
        String name=check(p,"name",80),pass=check(p,"password",128);
        if(pass.length()<8)throw new Exception("كلمة السر تحتاج ثمانية أحرف على الأقل.");
        if(rows("SELECT name FROM accounts WHERE name=?",name).length()>0)throw new Exception("الاسم مستخدم بالفعل.");
        String salt=random(18);
        db.execSQL("INSERT INTO accounts VALUES(?,?,?,?)",new Object[]{name,salt,Base64.encodeToString(hash(pass,salt),Base64.NO_WRAP),owner?1:0});
    }
    private void rate(String key,int max,long period)throws Exception{
        long now=System.currentTimeMillis();long[] a=attempts.get(key);
        if(a==null||a[0]<=now){a=new long[]{now+period,0};attempts.put(key,a);}
        if(++a[1]>max)throw new Exception("محاولات كثيرة. انتظر قليلًا.");
    }
    synchronized Object handle(boolean owner,String peer,JSONObject p)throws Exception{
        String op=check(p,"op",40);
        boolean first=rows("SELECT 1 FROM accounts WHERE owner=1").length()==0;
        if(op.equals("status"))return obj("setup",owner&&first);
        if(op.equals("setup")){
            if(!owner||!first)throw new Exception("العملية للمالك.");
            account(p,true);op="login";
        }
        if(op.equals("login")){
            rate("login:"+peer,60,60000);
            String name=check(p,"name",80),pass=check(p,"password",128);
            JSONArray found=rows("SELECT salt,verifier FROM accounts WHERE name=? AND owner=?",name,owner?"1":"0");
            JSONObject a=found.optJSONObject(0);
            byte[] actual=hash(pass,a==null?"unavailable-account":a.getString("salt"));
            if(a==null||!MessageDigest.isEqual(actual,Base64.decode(a.getString("verifier"),Base64.DEFAULT)))throw new Exception("الاسم أو كلمة السر غير صحيحة.");
            String token=random(32);
            long now=System.currentTimeMillis();
            db.execSQL("INSERT INTO sessions(token_hash,name,owner,created) VALUES(?,?,?,?)",
                new Object[]{tokenHash(token),name,owner?1:0,now});
            db.execSQL("UPDATE accounts SET last_seen=? WHERE name=?",new Object[]{now,name});
            return obj("token",token,"name",name);
        }
        String token=p.optString("token","");
        if(token.isEmpty()||token.length()>128)throw new Exception("انتهت الجلسة. سجّل الدخول مجددًا.");
        String digest=tokenHash(token);
        JSONArray matches=rows("SELECT s.name FROM sessions s JOIN accounts a ON a.name=s.name AND a.owner=s.owner WHERE s.token_hash=? AND s.owner=?",
            digest,owner?"1":"0");
        JSONObject active=matches.optJSONObject(0);
        if(active==null)throw new Exception("انتهت الجلسة. سجّل الدخول مجددًا.");
        String name=active.getString("name");
        db.execSQL("UPDATE accounts SET last_seen=? WHERE name=?",new Object[]{System.currentTimeMillis(),name});
        String id=String.valueOf(p.optInt("id")),sub=String.valueOf(p.optInt("subject"));
        switch(op){
        case "resume":return obj("name",name);
        case "logout":db.execSQL("DELETE FROM sessions WHERE token_hash=? AND owner=?",new Object[]{digest,owner?1:0});return obj();
        case "home":return obj("subjects",rows("SELECT s.*, (SELECT count(*) FROM sources d WHERE d.subject=s.id) AS docs FROM subjects s ORDER BY s.id"),"notices",rows("SELECT * FROM posts ORDER BY id DESC LIMIT 80"),"feedback",owner?rows("SELECT * FROM feedback ORDER BY id DESC LIMIT 200"):rows("SELECT * FROM feedback WHERE name=? ORDER BY id DESC LIMIT 200",name),"students",owner?rows("SELECT a.name,a.last_seen,"+
            "(SELECT count(*) FROM sources d WHERE d.added_by=a.name) AS sources,"+
            "(SELECT count(*) FROM results r WHERE r.name=a.name) AS quizzes,"+
            "(SELECT count(*) FROM feedback f WHERE f.name=a.name) AS suggestions "+
            "FROM accounts a WHERE a.owner=0 ORDER BY a.name"):new JSONArray());
        case "subject":return obj("sources",rows("SELECT id,title,created,added_by FROM sources WHERE subject=? ORDER BY created DESC,id DESC",sub),"quizzes",rows("SELECT id,title,published FROM quizzes WHERE subject=? AND (published=1 OR ?='1') ORDER BY id DESC",sub,owner?"1":"0"));
        case "source":return rows("SELECT title,body,image,created,added_by FROM sources WHERE id=?",id).getJSONObject(0);
        case "quiz":return rows("SELECT title,question,choices FROM quizzes WHERE id=? AND (published=1 OR ?='1')",id,owner?"1":"0").getJSONObject(0);
        case "solve":{
            JSONObject q=rows("SELECT answer,choices FROM quizzes WHERE id=? AND published=1",id).getJSONObject(0);
            int choice=p.getInt("choice");
            if(choice<0||choice>=new JSONArray(q.getString("choices")).length())throw new Exception("اختر إجابة.");
            int answer=q.getInt("answer");
            db.execSQL("INSERT INTO results(quiz,name,choice,correct,created) VALUES(?,?,?,?,?)",new Object[]{id,name,choice,answer==choice?1:0,System.currentTimeMillis()});
            return obj("answer",answer);
        }
        case "suggest":
            rate("feedback:"+name,12,600000);
            db.execSQL("INSERT INTO feedback(name,body,created) VALUES(?,?,?)",new Object[]{name,check(p,"body",2000),System.currentTimeMillis()});return obj();
        case "addSource":{
            rate("sources:"+name,30,600000);
            if(rows("SELECT id FROM subjects WHERE id=?",sub).length()==0)throw new Exception("المادة غير موجودة.");
            String title=check(p,"title",180),body=check(p,"body",16000);
            String topic=java.text.Normalizer.normalize(title,java.text.Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replaceAll("[\\u064B-\\u065Fـ]","").replaceAll("[أإآ]","ا").replaceAll("^(شرح|ملخص|مراجعة)\\s+","").trim();
            if(rows("SELECT id FROM sources WHERE subject=? AND topic=?",sub,topic).length()>0)throw new Exception("هذا المصدر موجود مسبقًا.");
            String image=check(p,"image",550000);
            if(!image.startsWith("data:image/jpeg;base64,/9j/"))throw new Exception("صورة غير صالحة.");
            db.execSQL("INSERT INTO sources(subject,title,topic,body,image,created,added_by) VALUES(?,?,?,?,?,?,?)",new Object[]{sub,title,topic,body,image,System.currentTimeMillis(),name});return obj();
        }}
        if(!owner)throw new Exception("العملية للمالك فقط.");
        switch(op){
        case "account":account(p,false);break;
        case "addSubject":db.execSQL("INSERT INTO subjects(name) VALUES(?)",new Object[]{check(p,"name",80)});break;
        case "progress":{
            int page=p.getInt("page");if(page<1||page>10000)throw new Exception("أدخل رقم صفحة صحيحًا.");
            db.execSQL("UPDATE subjects SET page=? WHERE id=?",new Object[]{page,sub});break;}
        case "remove":db.execSQL("DELETE FROM sources WHERE id=?",new Object[]{id});break;
        case "reply":db.execSQL("UPDATE feedback SET reply=? WHERE id=?",new Object[]{check(p,"body",2000),id});break;
        case "notice":db.execSQL("INSERT INTO posts(title,body,created) VALUES(?,?,?)",new Object[]{check(p,"title",150),check(p,"body",6000),System.currentTimeMillis()});break;
        case "draft":{
            JSONArray choices=p.getJSONArray("choices");int answer=p.getInt("answer");
            if(choices.length()<2||choices.length()>8||answer<0||answer>=choices.length())throw new Exception("تحقّق من الخيارات والإجابة.");
            for(int i=0;i<choices.length();i++)if(choices.getString(i).trim().isEmpty()||choices.getString(i).length()>300)throw new Exception("تحقّق من الخيارات.");
            db.execSQL("INSERT INTO quizzes(subject,title,question,choices,answer) VALUES(?,?,?,?,?)",new Object[]{sub,check(p,"title",150),check(p,"question",1000),choices.toString(),answer});break;}
        case "publish":db.execSQL("UPDATE quizzes SET published=1 WHERE id=?",new Object[]{id});break;
        default:throw new Exception("الإجراء غير متاح.");
        }
        return obj();
    }
}
