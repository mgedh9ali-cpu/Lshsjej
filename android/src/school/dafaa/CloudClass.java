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
        HttpsURLConnection connection = open(origin, authorization);
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
            return readResponse(connection);
        } finally { connection.disconnect(); }
    }
    private static HttpsURLConnection open(String origin, String authorization) throws Exception {
        if (origin.isEmpty()) throw new Exception("اضبط اتصال الصف عبر الإنترنت من الإعدادات.");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(origin + "/v1/classroom").openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(7000);
        connection.setReadTimeout(8500);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Authorization", authorization);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setDoOutput(true);
        return connection;
    }

    private static JSONObject readResponse(HttpsURLConnection connection) throws Exception {
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
    }

    static void uploadFile(String origin, String authorization, JSONObject details, InputStream input, Progress progress) throws Exception {
        long size = details.getLong("size");
        if (size < 1 || size > 600_000_000) throw new Exception("حجم الملف يجب ألا يتجاوز ٦٠٠ ميغابايت.");
        JSONObject start = request(origin, authorization, details.put("op", "startsource"));
        if (!start.has("upload")) return;
        String upload = start.getString("upload");
        int partSize = start.getInt("partSize");
        if (partSize < 1 || partSize > 8 * 1024 * 1024) throw new Exception("تعذّر بدء رفع الملف.");
        byte[] buffer = new byte[partSize];
        org.json.JSONArray parts = new org.json.JSONArray();
        int total = (int) size;
        int offset = 0;
        java.io.DataInputStream source = new java.io.DataInputStream(input);
        try {
            for (int number = 1; offset < total; number++) {
                if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException();
                int length = Math.min(partSize, total - offset);
                source.readFully(buffer, 0, length);
                JSONObject part;
                try {
                    part = uploadPart(origin, authorization, upload, number, buffer, length, offset, total, progress);
                } catch (java.io.IOException connectionError) {
                    if (Thread.currentThread().isInterrupted()) throw connectionError;
                    part = uploadPart(origin, authorization, upload, number, buffer, length, offset, total, progress);
                }
                parts.put(part);
                offset += length;
            }
            if (input.read() != -1) throw new Exception("تغيّر حجم الملف. اختره مجددًا.");
            JSONObject finish = RoomStore.obj("op", "finishsource", "upload", upload, "parts", parts);
            try {
                request(origin, authorization, finish);
            } catch (java.io.IOException connectionError) {
                if (Thread.currentThread().isInterrupted()) throw connectionError;
                request(origin, authorization, finish);
            }
        } catch (Exception error) {
            try { request(origin, authorization, RoomStore.obj("op", "abortsource", "upload", upload)); }
            catch (Exception ignored) {}
            if (error instanceof java.io.EOFException) throw new Exception("تغيّر حجم الملف. اختره مجددًا.");
            throw error;
        }
    }

    private static JSONObject uploadPart(String origin, String authorization, String upload, int number,
            byte[] buffer, int length, int offset, int total, Progress progress) throws Exception {
        HttpsURLConnection connection = open(origin, authorization);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Content-Type", "application/octet-stream");
        connection.setRequestProperty("X-Source-Upload", upload);
        connection.setRequestProperty("X-Source-Part", Integer.toString(number));
        connection.setFixedLengthStreamingMode(length);
        try {
            try (java.io.OutputStream output = connection.getOutputStream()) {
                for (int sent = 0; sent < length;) {
                    int step = Math.min(262144, length - sent);
                    output.write(buffer, sent, step);
                    sent += step;
                    progress.written(offset + sent, total);
                }
            }
            return readResponse(connection);
        } finally { connection.disconnect(); }
    }

    static void downloadFile(String origin, String authorization, long id, long size, java.io.OutputStream output) throws Exception {
        HttpsURLConnection connection = open(origin, authorization);
        connection.setReadTimeout(30000);
        byte[] request = RoomStore.obj("op", "downloadsource", "id", id).toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(request.length);
        try {
            try (java.io.OutputStream body = connection.getOutputStream()) { body.write(request); }
            if (connection.getResponseCode() != 200) { readResponse(connection); return; }
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[65536];
                long remaining = size;
                for (int length; (length = input.read(buffer)) != -1;) {
                    remaining -= length;
                    if (remaining < 0) throw new java.io.IOException("Unexpected file size");
                    output.write(buffer, 0, length);
                }
                if (remaining != 0) throw new java.io.EOFException();
            }
        } finally { connection.disconnect(); }
    }

}
