package school.dafaa;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONObject;
import javax.net.ssl.*;
import java.io.*;
import java.net.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.*;
import java.util.concurrent.*;

final class RoomLink {
    static final int PORT=29467;
    static final int LIMIT=850000;
    static final String ALIAS="qum-classroom-tls";
    private SSLServerSocket server;
    private final ThreadPoolExecutor pool=new ThreadPoolExecutor(4,4,0,TimeUnit.SECONDS,new ArrayBlockingQueue<Runnable>(16));
    private String fingerprint;
    private final RoomStore store;
    RoomLink(RoomStore store){this.store=store;}
    static String fingerprint(X509Certificate cert)throws Exception{
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(cert.getEncoded());
        StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(Locale.US,"%02x",b&255));return out.toString();
    }
    synchronized void start()throws Exception{
        if(server!=null)return;
        KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);
        if(!keys.containsAlias(ALIAS)){
            KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA","AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY)
                .setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256,KeyProperties.DIGEST_SHA384,KeyProperties.DIGEST_SHA512)
                .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1,KeyProperties.SIGNATURE_PADDING_RSA_PSS).build());
            generator.generateKeyPair();
        }
        X509Certificate cert=(X509Certificate)keys.getCertificate(ALIAS);
        start(cert,(PrivateKey)keys.getKey(ALIAS,null));
    }
    synchronized void start(X509Certificate cert,PrivateKey key)throws Exception{
        if(server!=null)return;
        fingerprint=fingerprint(cert);
        X509KeyManager identity=new X509KeyManager(){
            public String[] getClientAliases(String k,Principal[] p){return null;}
            public String chooseClientAlias(String[] k,Principal[] p,Socket s){return null;}
            public String[] getServerAliases(String k,Principal[] p){return "RSA".equals(k)?new String[]{ALIAS}:null;}
            public String chooseServerAlias(String k,Principal[] p,Socket s){return "RSA".equals(k)?ALIAS:null;}
            public X509Certificate[] getCertificateChain(String alias){return new X509Certificate[]{cert};}
            public PrivateKey getPrivateKey(String alias){return key;}
        };
        SSLContext context=SSLContext.getInstance("TLS");context.init(new KeyManager[]{identity},null,null);
        final SSLServerSocket listener=(SSLServerSocket)context.getServerSocketFactory().createServerSocket(PORT);
        server=listener;
        new Thread(()->{
            while(!listener.isClosed()){
                try{
                    final Socket s=listener.accept();s.setSoTimeout(12000);
                    try{pool.execute(()->serve(s));}catch(RejectedExecutionException full){s.close();}
                }catch(IOException closed){break;}
            }
        },"class-listener").start();
    }
    synchronized void close(){try{if(server!=null)server.close();}catch(Exception ignored){}pool.shutdownNow();}
    String invitation()throws Exception{
        Enumeration<NetworkInterface> adapters=NetworkInterface.getNetworkInterfaces();
        while(adapters.hasMoreElements()){
            NetworkInterface nic=adapters.nextElement();
            if(!nic.isUp()||nic.isLoopback())continue;
            Enumeration<InetAddress> hosts=nic.getInetAddresses();
            while(hosts.hasMoreElements()){
                InetAddress ip=hosts.nextElement();
                if(ip instanceof Inet4Address&&ip.isSiteLocalAddress())return "qum1/"+ip.getHostAddress()+"/"+fingerprint;
            }
        }
        return "qum1/127.0.0.1/"+fingerprint;
    }
    private void serve(Socket socket){
        try(Socket s=socket){
            JSONObject req=receive(s);JSONObject result;
            try{result=RoomStore.obj("value",store.handle(false,s.getInetAddress().getHostAddress(),req));}
            catch(Exception e){result=RoomStore.obj("error",safe(e));}
            send(s,result);
        }catch(Exception ignored){}
    }
    static String safe(Exception e){String m=e.getMessage();return m!=null&&m.matches("(?s).*[ء-ي].*")?m:"تعذّر إتمام العملية. تحقق من البيانات والاتصال.";}
    static void send(Socket s,JSONObject data)throws Exception{
        byte[] bytes=data.toString().getBytes("UTF-8");if(bytes.length>LIMIT)throw new IOException("البيانات أكبر من المسموح.");
        DataOutputStream out=new DataOutputStream(s.getOutputStream());out.writeInt(bytes.length);out.write(bytes);out.flush();
    }
    static JSONObject receive(Socket s)throws Exception{
        DataInputStream in=new DataInputStream(s.getInputStream());int n=in.readInt();
        if(n<2||n>LIMIT)throw new IOException("طلب غير صالح.");
        byte[] bytes=new byte[n];in.readFully(bytes);return new JSONObject(new String(bytes,"UTF-8"));
    }
    static JSONObject call(String invite,JSONObject req)throws Exception{
        String[] parts=invite.trim().split("/");
        if(parts.length!=3||!parts[0].equals("qum1")||!parts[1].matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")||!parts[2].matches("[a-f0-9]{64}"))throw new Exception("الصق رمز الربط الكامل من المالك.");
        InetAddress host=InetAddress.getByName(parts[1]);
        if(!host.isSiteLocalAddress()&&!host.isLoopbackAddress())throw new Exception("استخدم شبكة الصف المحلية.");
        X509TrustManager trust=new X509TrustManager(){
            public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}
            public void checkClientTrusted(X509Certificate[] c,String t)throws java.security.cert.CertificateException{throw new java.security.cert.CertificateException();}
            public void checkServerTrusted(X509Certificate[] c,String t)throws java.security.cert.CertificateException{
                try{if(c.length>0&&parts[2].equals(fingerprint(c[0]))){c[0].checkValidity();return;}}catch(Exception ignored){}
                throw new java.security.cert.CertificateException("Class identity mismatch");
            }};
        SSLContext ctx=SSLContext.getInstance("TLS");ctx.init(null,new TrustManager[]{trust},null);
        try(SSLSocket socket=(SSLSocket)ctx.getSocketFactory().createSocket()){
            socket.connect(new InetSocketAddress(host,PORT),4000);socket.setSoTimeout(12000);socket.startHandshake();
            send(socket,req);return receive(socket);
        }catch(IOException e){throw new Exception("تعذّر الوصول لهاتف المالك. تحقق من شبكة الواي فاي ورمز الربط وفتح لوحة المالك.");}
    }
}
