package cc.medpilot.pilot;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps the Pilot process alive while the app is in the background.
 *
 * The JavaScript heartbeat and the native OkHttp WebSocket both need the app
 * process to stay scheduled. A plain partial wake lock only keeps the CPU
 * awake; Android can still freeze or reclaim a cached process. Running as a
 * foreground service raises the process importance so the paired connection
 * survives screen-off / app-switch and is still there when the user returns.
 *
 * Started from lib/keepalive-service.js through Native.js. The service is
 * stopped when the last pairing is removed, and stops with the task when the
 * user swipes the app away (android:stopWithTask="true").
 */
public class PilotKeepAliveService extends Service {
    private static final String CHANNEL_ID = "pilot_connection";
    private static final int NOTIFICATION_ID = 0x50494c4f; // "PILO"
    private static final String WAKE_LOCK_TAG = "Pilot:keepalive";
    private static final String WIFI_LOCK_TAG = "Pilot:wifi";

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) {
            // Android 14+: specialUse has no 6-hour daily cap (unlike dataSync)
            // and the manifest declares the matching property + permission.
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else if (Build.VERSION.SDK_INT >= 29) {
            // Android 10–13 do not know "specialUse" yet; use a type they do.
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        acquireWakeLock();
        acquireWifiLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Do not resurrect a process whose JS runtime is gone; a restarted
        // service without the app would only show a misleading notification.
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        releaseWifiLock();
        try {
            stopForeground(true);
        } catch (Throwable ignored) {
            // Best effort only.
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void acquireWakeLock() {
        try {
            PowerManager manager =
                    (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (manager == null) return;
            wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG);
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        } catch (Throwable ignored) {
            // The foreground service alone is enough to avoid process freeze
            // on most devices; a ROM that rejects wake locks still works.
        }
    }

    private void releaseWakeLock() {
        if (wakeLock == null) return;
        try {
            if (wakeLock.isHeld()) wakeLock.release();
        } catch (Throwable ignored) {
            // ignore
        }
        wakeLock = null;
    }

    /**
     * Keeps Wi-Fi awake at a low-latency power profile. Without this, some
     * phones put Wi-Fi into power save as soon as the screen turns off and the
     * TCP connection dies even though the process is still alive.
     */
    private void acquireWifiLock() {
        try {
            WifiManager manager =
                    (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (manager == null) return;
            int mode = Build.VERSION.SDK_INT >= 29
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = manager.createWifiLock(mode, WIFI_LOCK_TAG);
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        } catch (Throwable ignored) {
            // CHANGE_WIFI_STATE can be revoked by the user; the connection is
            // still usable, it just loses the screen-off Wi-Fi guarantee.
        }
    }

    private void releaseWifiLock() {
        if (wifiLock == null) return;
        try {
            if (wifiLock.isHeld()) wifiLock.release();
        } catch (Throwable ignored) {
            // ignore
        }
        wifiLock = null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Pilot 连接",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("在后台保持与电脑的连接");
        channel.setShowBadge(false);
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent open = new Intent();
        open.setClassName(getPackageName(), "io.dcloud.PandoraEntry");
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pending = PendingIntent.getActivity(
                this,
                0,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        int icon = getApplicationInfo().icon;
        if (icon == 0) icon = android.R.drawable.stat_notify_sync;

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        builder.setSmallIcon(icon)
                .setContentTitle("Pilot 已连接到电脑")
                .setContentText("后台保持连接，点按返回")
                .setContentIntent(pending)
                .setOngoing(true)
                .setShowWhen(false)
                .setPriority(Notification.PRIORITY_LOW);
        return builder.build();
    }
}
