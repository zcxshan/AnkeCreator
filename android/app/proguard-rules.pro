# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ============================================================
# Capacitor 核心 —— 反射加载，禁止混淆
# ============================================================
-keep public class com.getcapacitor.** { *; }
-keep public class com.ankecreator.app.** { *; }
-dontwarn com.getcapacitor.**

# Capacitor Cordova 兼容层
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# WebView JavaScriptInterface 反射调用
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ============================================================
# AndroidX（Capacitor 6 依赖）
# ============================================================
-keep class androidx.** { *; }
-keep interface androidx.** { *; }
-dontwarn androidx.**

# ============================================================
# OkHttp / Okio（Capacitor 网络层）
# ============================================================
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**

# ============================================================
# Capacitor 插件模块（已在 dependencies 中声明）
# ============================================================
-keep class com.capacitorjs.plugins.** { *; }
-dontwarn com.capacitorjs.plugins.**

# 保留行号（崩溃栈可读）
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
