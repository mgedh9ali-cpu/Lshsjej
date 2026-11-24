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

    static final class Unauthorized extends Exception {
        Unauthorized(String message) { super(message); }
    }

    static final class Blocked extends Exception {
        Blocked(String message) { super(message); }
    }

    static JSONObject ownerDevice(String origin, String device, JSONObject payload) throws Exception {
        return request(origin, "OwnerDevice " + device, payload);
    }

    private static JSONObject request(String origin, String authorization, JSONObject payload) throws Exception {
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
            try (java.io.OutputStream output = connection.getOutputStream()) { output.write(request); }
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
                if (status == 403)
                    throw new Blocked(result.optString("error", "هذا البريد محظور من الصف."));
                if (status != 200) throw new Exception(result.optString("error", "استجابة غير صالحة من خادم الصف."));
                return result;
            }
        } finally { connection.disconnect(); }
    }
}
