package school.dafaa;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

final class CloudClass {
    static final String DEFAULT_ORIGIN = "https://lshsjej.mgedh-9ali.workers.dev";

    private CloudClass() {}

    static String origin(String value) throws Exception {
        URI uri = new URI(value.trim());
        String path = uri.getRawPath();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null || uri.getRawFragment() != null
                || (path != null && !path.isEmpty() && !path.equals("/"))) {
            throw new Exception("أدخل رابط HTTPS لخادم الصف.");
        }
        return "https://" + uri.getRawAuthority().toLowerCase(java.util.Locale.ROOT);
    }

    static JSONObject call(String origin, String key, JSONObject payload) throws Exception {
        return request(origin, "Bearer " + key, payload);
    }

    static JSONObject student(String device, JSONObject payload) throws Exception {
        return request(DEFAULT_ORIGIN, "Device " + device, payload);
    }

    static JSONObject enroll(String code,String op,String email,String device)throws Exception {
        if(!code.matches("[a-zA-Z0-9_-]{43}"))throw new Exception("أدخل رمز الدعوة الكامل.");
        return request(DEFAULT_ORIGIN,"Invite "+code,RoomStore.obj("op",op,"email",email,"device",device));
    }

    static final class Unauthorized extends Exception {
        Unauthorized(String message) { super(message); }
    }

    static JSONObject ownerDevice(String origin, String device, JSONObject payload) throws Exception {
        return request(origin, "OwnerDevice " + device, payload);
    }

    interface Progress { void written(int bytes, int total); }

    static JSONObject upload(String origin, String authorization, JSONObject payload, Progress progress)throws Exception{
        return request(origin, authorization, payload, progress);
    }

    private static JSONObject request(String origin, String authorization, JSONObject payload) throws Exception {
        return request(origin, authorization, payload, null);
    }

    private static JSONObject request(String origin, String authorization, JSONObject payload, Progress progress) throws Exception {
        if (origin.isEmpty()) throw new Exception("اضبط اتصال الصف عبر الإنترنت من الإعدادات.");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(origin + "/v1/classroom").openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(7000);
        connection.setReadTimeout(8500);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Authorization", authorization);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setDoOutput(true);
        byte[] request = payload.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(request.length);
        try {
            try (java.io.OutputStream output = connection.getOutputStream()) {
                if(progress==null)output.write(request);
                else for(int offset=0;offset<request.length;){
                    int size=Math.min(65536,request.length-offset);
                    output.write(request,offset,size);offset+=size;
                    progress.written(offset,request.length);
                }
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new Exception("عنوان خادم الصف يعيد التوجيه. تحقق من الرابط.");
            try (InputStream input = status == 200 ? connection.getInputStream() : connection.getErrorStream()) {
                if (input == null) throw new Exception("تعذّر الاتصال بخادم الصف.");
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                byte[] bytes = new byte[4096];
                for (int length; (length = input.read(bytes)) != -1;) {
                    if (body.size() + length > 8_000_000) throw new Exception("استجابة الخادم كبيرة جدًا.");
                    body.write(bytes, 0, length);
                }
                JSONObject result = new JSONObject(new String(body.toByteArray(), StandardCharsets.UTF_8));
                if (status == 401)
                    throw new Unauthorized(result.optString("error", "تعذّر التحقق من الاتصال."));
                if (status != 200) throw new Exception(result.optString("error", "استجابة غير صالحة من خادم الصف."));
                return result;
            }
        } finally { connection.disconnect(); }
    }
}
