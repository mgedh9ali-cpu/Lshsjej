package school.dafaa;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class RoomSession {
    private static final String ALIAS = "qum-classroom-session";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private final SharedPreferences preferences;
    private final String legacy;
    private final String encrypted;

    RoomSession(SharedPreferences preferences, String legacy) {
        this.preferences = preferences;
        this.legacy = legacy;
        this.encrypted = legacy + "Encrypted";
    }

    private static synchronized SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        if (!create) throw new IllegalStateException("Session key missing");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }

    String load() {
        try {
            String stored = preferences.getString(encrypted, "");
            if (!stored.isEmpty()) {
                String[] fields = stored.split(":", 2);
                Cipher cipher = Cipher.getInstance(TRANSFORMATION);
                cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Base64.decode(fields[0], Base64.NO_WRAP)));
                return new String(cipher.doFinal(Base64.decode(fields[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
            }
            String token = preferences.getString(legacy, "");
            if (!token.isEmpty()) save(token);
            return token;
        } catch (Exception invalid) {
            clear();
            return "";
        }
    }

    void save(String token) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        String nonce = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
        String ciphertext = Base64.encodeToString(cipher.doFinal(token.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!preferences.edit().remove(legacy).putString(encrypted, nonce + ":" + ciphertext).commit()) {
            throw new IllegalStateException("Session could not be saved");
        }
    }

    void clear() {
        preferences.edit().remove(legacy).remove(encrypted).apply();
    }
}
