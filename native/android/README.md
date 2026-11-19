# Android 壳原生文件

wgt 不能新增原生类或权限，所以这里的文件只打进**全量 APK**（离线壳）。wgt 里的
`lib/keepalive-service.js` 会在新壳上启动前台服务；旧壳找不到服务类时静默失败，
继续用 `lib/background-link.js` 的 PARTIAL_WAKE_LOCK 兜底。

## 集成到离线工程

1. 把 `PilotKeepAliveService.java` 放到
   `<HBuilder-Integrate-AS>/simpleDemo/src/main/java/cc/medpilot/pilot/`。
2. 在 `simpleDemo/src/main/AndroidManifest.xml` 里补权限：

   ```xml
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC"/>
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE"/>
   <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
   <uses-permission android:name="android.permission.CHANGE_WIFI_STATE"/>
   <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"/>
   ```

   `CHANGE_WIFI_STATE` 用于前台服务里的 Wi-Fi 锁，避免息屏后 Wi-Fi 进入省电、
   TCP 连接被系统悄悄断掉。`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 只用于
   「设置 → 连接 → 允许后台运行」打开的确认框，不主动申请其他豁免。

3. 在 `<application>` 里注册服务：

   ```xml
   <service
       android:name="cc.medpilot.pilot.PilotKeepAliveService"
       android:exported="false"
       android:stopWithTask="true"
       android:foregroundServiceType="dataSync|specialUse">
       <property
           android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
           android:value="Keeps the paired phone-to-PC control connection alive while the app is in the background." />
   </service>
   ```

4. 同步版本：`build.gradle` 的 `versionCode` / `versionName`、
   `assets/data/dcloud_control.xml` 的 `appver`、`manifest.json` 的
   `versionName` 必须一致（1.0.56 起为 `131` / `1.0.56`）。

## 行为约定

- 服务在前台启动（`startClient()` / `onAppShow()`），保持低优先级常驻通知。
- 用户从最近任务里划掉 App 时服务随之停止（`stopWithTask="true"`）。
- 解除最后一台电脑的配对时，JS 会调用 `stopService` 停掉通知。
- Android 13+ 未授予通知权限时，服务仍然有效，只是通知不会出现在通知栏。
- `specialUse` 是 Android 14 的前台服务类型：没有 `dataSync` 的 6 小时/日限制，
  但只能用于确有必要的常驻连接场景（本应用是用户主动配对的设备控制通道）。
- 服务同时持有 partial wake lock 和 Wi-Fi 锁：前者防止 CPU 休眠，后者防止
  息屏后 Wi-Fi 省电把 TCP 连接断掉。两者都在服务销毁时释放。
- 设置页显示前台服务状态、系统电池优化状态和上次后台回来的结果（连接保持 /
  连接被断开 / App 被系统回收），用于区分「服务没启动」「网络断了」和
  「进程被 ROM 清理」。
