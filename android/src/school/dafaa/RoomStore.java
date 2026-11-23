package school.dafaa;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.util.Base64;
import java.io.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.json.*;
import java.util.*;
import java.security.*;
import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

final class RoomStore {
    private final SQLiteDatabase db;
    private final Context context;
    private final Map<String,long[]> attempts = new HashMap<>();
    private static final SecureRandom RNG = new SecureRandom();
    RoomStore(Context c){
        context=c.getApplicationContext();
        db=context.openOrCreateDatabase("classroom.db",Context.MODE_PRIVATE,null);
        db.disableWriteAheadLogging();
        db.execSQL("CREATE TABLE IF NOT EXISTS accounts(name TEXT PRIMARY KEY, salt TEXT NOT NULL, verifier TEXT NOT NULL, owner INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, owner INTEGER NOT NULL, created INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX IF NOT EXISTS sessions_account ON sessions(name,owner)");
        db.execSQL("CREATE TABLE IF NOT EXISTS subjects(id INTEGER PRIMARY KEY,name TEXT UNIQUE,page INTEGER DEFAULT 0)");
        db.execSQL("CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY,title TEXT,body TEXT,created INTEGER)");
        db.execSQL("CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY,name TEXT,body TEXT,reply TEXT,created INTEGER)");
        db.execSQL("CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY,subject INTEGER,title TEXT,topic TEXT,body TEXT,image TEXT,created INTEGER,UNIQUE(subject,topic))");
        db.execSQL("CREATE TABLE IF NOT EXISTS quizzes(id INTEGER PRIMARY KEY,subject INTEGER,title TEXT,question TEXT,choices TEXT,answer INTEGER,published INTEGER DEFAULT 0)");
        db.execSQL("CREATE TABLE IF NOT EXISTS results(id INTEGER PRIMARY KEY,quiz INTEGER,name TEXT,choice INTEGER,correct INTEGER,created INTEGER)");
        db.execSQL("CREATE TABLE IF NOT EXISTS local_registrations(id TEXT PRIMARY KEY,name TEXT NOT NULL,created INTEGER NOT NULL)");
        // Keep existing classroom databases intact while enabling activity and source attribution.
        if(!hasColumn("accounts","last_seen"))db.execSQL("ALTER TABLE accounts ADD COLUMN last_seen INTEGER");
        if(!hasColumn("sources","added_by"))db.execSQL("ALTER TABLE sources ADD COLUMN added_by TEXT");
        if(!hasColumn("feedback","registration_id"))db.execSQL("ALTER TABLE feedback ADD COLUMN registration_id TEXT");
        if(!hasColumn("feedback","request_id"))db.execSQL("ALTER TABLE feedback ADD COLUMN request_id TEXT");
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS feedback_request ON feedback(registration_id,request_id)");
        for(String subject:new String[]{"الفيزياء","الكيمياء","العلوم","الإنجليزي","الرياضيات"})
            db.execSQL("INSERT OR IGNORE INTO subjects(name) VALUES(?)",new Object[]{subject});
    }

    private static final byte[] BACKUP_MAGIC=new byte[]{'Q','U','M','D','B','0','0','1'};
    private static final int BACKUP_ITERATIONS=220000;
    private static void transfer(InputStream input,OutputStream output)throws IOException{
        byte[] block=new byte[32768];int count;
        while((count=input.read(block))!=-1)output.write(block,0,count);
    }
    private static SecretKeySpec backupKey(String phrase,byte[] salt)throws Exception{
        if(phrase==null||phrase.length()<12||phrase.length()>200)throw new Exception("كلمة مرور النسخة يجب أن تحتوي على 12 حرفًا على الأقل.");
        PBEKeySpec spec=new PBEKeySpec(phrase.toCharArray(),salt,BACKUP_ITERATIONS,256);
        try{return new SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).getEncoded(),"AES");}
        finally{spec.clearPassword();}
    }
    synchronized void writeEncryptedBackup(OutputStream destination,String passphrase)throws Exception{
        try(Cursor status=db.rawQuery("PRAGMA integrity_check",null)){
            if(!status.moveToFirst()||!"ok".equals(status.getString(0)))
                throw new Exception("تعذّر التأكد من قاعدة البيانات.");
        }
        db.disableWriteAheadLogging();
        byte[] salt=new byte[16],nonce=new byte[12];RNG.nextBytes(salt);RNG.nextBytes(nonce);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,backupKey(passphrase,salt),new GCMParameterSpec(128,nonce));
        destination.write(BACKUP_MAGIC);destination.write(salt);destination.write(nonce);
        try(InputStream source=new FileInputStream(db.getPath());
            CipherOutputStream encrypted=new CipherOutputStream(destination,cipher)){
            transfer(source,encrypted);
        }
    }
    synchronized void restoreEncryptedBackup(InputStream stream,String passphrase)throws Exception{
        DataInputStream input=new DataInputStream(stream);
        byte[] magic=new byte[8],salt=new byte[16],nonce=new byte[12];
        input.readFully(magic);input.readFully(salt);input.readFully(nonce);
        if(!MessageDigest.isEqual(magic,BACKUP_MAGIC))throw new Exception("هذا ليس ملف نسخة احتياطية من قوم دروس.");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,backupKey(passphrase,salt),new GCMParameterSpec(128,nonce));
        File staging=File.createTempFile("room-restore-",".sqlite",context.getCacheDir());
        File previous=File.createTempFile("room-previous-",".sqlite",context.getCacheDir());
        File current=new File(db.getPath());
        boolean closed=false;
        try{
            try(CipherInputStream decrypted=new CipherInputStream(input,cipher);
                OutputStream output=new FileOutputStream(staging)){
                transfer(decrypted,output);
            }catch(Exception invalid){throw new Exception("تعذّر فك النسخة. تحقق من كلمة المرور وسلامة الملف.");}
            SQLiteDatabase check=SQLiteDatabase.openDatabase(staging.getPath(),null,SQLiteDatabase.OPEN_READONLY);
            try{
                try(Cursor status=check.rawQuery("PRAGMA integrity_check",null)){
                    if(!status.moveToFirst()||!"ok".equals(status.getString(0)))
                        throw new Exception("ملف النسخة تالف.");
                }
                String[] tables={"accounts","subjects","sources","quizzes","results","posts","feedback"};
                for(String table:tables){
                    try(Cursor found=check.rawQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",new String[]{table})){
                        if(!found.moveToFirst())throw new Exception("ملف النسخة غير متوافق مع التطبيق.");
                    }
                }
            }finally{check.close();}
            db.disableWriteAheadLogging();
            try(InputStream source=new FileInputStream(current);
                OutputStream backup=new FileOutputStream(previous)){transfer(source,backup);}
            db.close();closed=true;
            try(InputStream source=new FileInputStream(staging);
                OutputStream result=new FileOutputStream(current)){transfer(source,result);}
            // The activity is restarted after restoration to open the new SQLite connection.
        }catch(Exception failure){
            if(closed){
                try(InputStream source=new FileInputStream(previous);
                    OutputStream result=new FileOutputStream(current)){transfer(source,result);}
                catch(Exception rollback){failure.addSuppressed(rollback);}
            }
            throw failure;
        }finally{staging.delete();previous.delete();}
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
        db.execSQL("INSERT INTO accounts(name,salt,verifier,owner) VALUES(?,?,?,?)",new Object[]{name,salt,Base64.encodeToString(hash(pass,salt),Base64.NO_WRAP),owner?1:0});
    }
    private void rate(String key,int max,long period)throws Exception{
        if(attempts.size()>=1024){
            long now=System.currentTimeMillis();
            Iterator<long[]> values=attempts.values().iterator();
            while(values.hasNext())if(values.next()[0]<=now)values.remove();
            if(attempts.size()>=1024&&!attempts.containsKey(key))throw new Exception("محاولات كثيرة. انتظر قليلًا.");
        }
        long now=System.currentTimeMillis();long[] a=attempts.get(key);
        if(a==null||a[0]<=now){a=new long[]{now+period,0};attempts.put(key,a);}
        if(++a[1]>max)throw new Exception("محاولات كثيرة. انتظر قليلًا.");
    }
    synchronized Object handle(boolean owner,String peer,JSONObject p)throws Exception{
        String op=check(p,"op",40);
        boolean first=rows("SELECT 1 FROM accounts WHERE owner=1").length()==0;
        if(op.equals("status"))return obj("setup",owner&&first);
        if(op.equals("localFeedback")||op.equals("localSuggest")){
            if(owner||first)throw new Exception("لوحة المالك غير متاحة.");
            String registrationId=check(p,"id",24);
            JSONObject registered=rows("SELECT name FROM local_registrations WHERE id=?",registrationId).optJSONObject(0);
            if(registered==null)throw new Exception("لم يصل تسجيلك إلى لوحة المالك بعد. حاول مجددًا.");
            if(op.equals("localSuggest")){
                String requestId=check(p,"requestId",40);
                if(!requestId.matches("[A-Za-z0-9_-]{24,40}"))throw new Exception("تعذّر التحقق من الطلب.");
                rate("local-suggest:"+registrationId,12,600000);
                db.execSQL("INSERT OR IGNORE INTO feedback(name,body,created,registration_id,request_id) VALUES(?,?,?,?,?)",
                    new Object[]{registered.getString("name"),check(p,"body",2000),System.currentTimeMillis(),registrationId,requestId});
            }
            rate("local-feedback:"+registrationId,60,60000);
            return obj("entries",rows("SELECT body,reply,created FROM feedback WHERE registration_id=? ORDER BY id DESC LIMIT 30",registrationId));
        }
        if(op.equals("localNotices")){
            if(owner||first)throw new Exception("لوحة المالك غير متاحة.");
            String registrationId=check(p,"id",40);
            if(!registrationId.matches("[A-Za-z0-9_-]{24}")||
                rows("SELECT 1 FROM local_registrations WHERE id=?",registrationId).length()==0)
                return obj("registered",false);
            rate("local-notices:"+registrationId,30,60000);
            return obj("registered",true,"notices",rows("SELECT id,title,body,created FROM posts ORDER BY id DESC LIMIT 20"));
        }
        if(op.equals("registerLocal")){
            if(owner||first)throw new Exception("لوحة المالك غير جاهزة لاستقبال التسجيل.");
            rate("register-local",60,60000);
            rate("register-local:"+peer,10,60000);
            String id=check(p,"id",40),name=check(p,"name",100);
            if(!id.matches("[A-Za-z0-9_-]{24}")||name.matches("(?s).*\\p{Cntrl}.*"))throw new Exception("بيانات التسجيل غير صالحة.");
            if(rows("SELECT 1 FROM local_registrations WHERE id=?",id).length()>0)return obj("registered",true);
            if(rows("SELECT 1 FROM local_registrations LIMIT 1 OFFSET 9999").length()>0)throw new Exception("قائمة التسجيلات ممتلئة.");
            db.execSQL("INSERT INTO local_registrations(id,name,created) VALUES(?,?,?)",new Object[]{id,name,System.currentTimeMillis()});
            return obj("registered",true,"new",true);
        }
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
        case "registrations":
            if(!owner)throw new Exception("العملية للمالك.");
            return obj("entries",rows("SELECT name,created FROM local_registrations ORDER BY created DESC,rowid DESC LIMIT 200"),
                "total",rows("SELECT COUNT(*) AS total FROM local_registrations").getJSONObject(0).getLong("total"));
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
