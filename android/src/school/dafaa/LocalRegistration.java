package school.dafaa;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import org.json.JSONObject;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class LocalRegistration {
    private static final String TYPE = "_qum-class._tcp.";
    private static final String FINGERPRINT = "fp";
    private final NsdManager manager;
    private NsdManager.RegistrationListener advertisement;

    LocalRegistration(Context context) {
        manager = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
    }

    synchronized void advertise(String fingerprint) {
        if (advertisement != null) return;
        NsdServiceInfo service = new NsdServiceInfo();
        service.setServiceName("QumDorous");
        service.setServiceType(TYPE);
        service.setPort(RoomLink.PORT);
        service.setAttribute(FINGERPRINT, fingerprint);
        advertisement = new NsdManager.RegistrationListener() {
            public void onServiceRegistered(NsdServiceInfo info) {}
            public void onServiceUnregistered(NsdServiceInfo info) {}
            public void onUnregistrationFailed(NsdServiceInfo info, int error) {}
            public void onRegistrationFailed(NsdServiceInfo info, int error) {
                synchronized (LocalRegistration.this) {
                    if (advertisement == this) advertisement = null;
                }
            }
        };
        try { manager.registerService(service, NsdManager.PROTOCOL_DNS_SD, advertisement); }
        catch (RuntimeException problem) { advertisement = null; throw problem; }
    }

    synchronized void close() {
        if (advertisement == null) return;
        try { manager.unregisterService(advertisement); } catch (IllegalArgumentException ignored) {}
        advertisement = null;
    }

    String send(String id, String name, String pinnedOwner) throws Exception {
        Map<String, NsdServiceInfo> found = new HashMap<>();
        CountDownLatch failed = new CountDownLatch(1);
        NsdManager.DiscoveryListener discovery = new NsdManager.DiscoveryListener() {
            public void onDiscoveryStarted(String type) {}
            public void onDiscoveryStopped(String type) {}
            public void onStartDiscoveryFailed(String type, int error) { failed.countDown(); }
            public void onStopDiscoveryFailed(String type, int error) {}
            public void onServiceFound(NsdServiceInfo info) {
                synchronized (found) { found.put(info.getServiceName(), info); }
            }
            public void onServiceLost(NsdServiceInfo info) {
                synchronized (found) { found.remove(info.getServiceName()); }
            }
        };
        manager.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, discovery);
        NsdServiceInfo candidate;
        try {
            if (failed.await(1800, TimeUnit.MILLISECONDS)) return null;
            synchronized (found) {
                if (found.size() != 1) return null;
                candidate = found.values().iterator().next();
            }
        } finally {
            try { manager.stopServiceDiscovery(discovery); } catch (IllegalArgumentException ignored) {}
        }

        AtomicReference<NsdServiceInfo> resolved = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        manager.resolveService(candidate, new NsdManager.ResolveListener() {
            public void onResolveFailed(NsdServiceInfo info, int error) { done.countDown(); }
            public void onServiceResolved(NsdServiceInfo info) { resolved.set(info); done.countDown(); }
        });
        if (!done.await(5, TimeUnit.SECONDS)) return null;
        NsdServiceInfo service = resolved.get();
        if (service == null || service.getPort() != RoomLink.PORT) return null;
        InetAddress host = service.getHost();
        byte[] attribute = service.getAttributes().get(FINGERPRINT);
        if (host == null || attribute == null) return null;
        String fingerprint = new String(attribute, StandardCharsets.US_ASCII);
        if (!fingerprint.matches("[a-f0-9]{64}") || (!pinnedOwner.isEmpty() && !pinnedOwner.equals(fingerprint))) return null;
        JSONObject response = RoomLink.call(host, fingerprint, RoomStore.obj("op", "registerLocal", "id", id, "name", name));
        JSONObject value = response.optJSONObject("value");
        return value != null && value.optBoolean("registered") ? fingerprint : null;
    }
}
