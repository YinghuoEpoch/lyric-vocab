package com.colin.lyricvocab;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

/**
 * 沉浸式：网页自己铺到状态栏和导航栏底下。
 *
 * 起因是用户在平板上报的两条：顶上一条深灰的状态栏和 app 格格不入；底下的导航栏
 * 那一行是空的，弹窗把背景压暗时它不跟着暗 —— 因为网页压根没铺到那儿，
 * 那一条是窗口底色，不属于网页。别的 app 都是「交融」的，就它不是。
 *
 * 这里做两件事：
 *
 * 1. **关掉系统给窗口的自动避让**（setDecorFitsSystemWindows(false)），
 *    网页从此占满整块屏幕，系统栏浮在它上面。系统栏底色在主题里已经改成透明。
 * 2. **把系统栏的尺寸报给网页**，写成 --safe-area-inset-* 四个 CSS 变量，
 *    网页那边据此留白（src/index.css）。
 *
 * 为什么不直接靠 CSS 的 env(safe-area-inset-*)：安卓 WebView 对它的支持要看版本，
 * 老一点的只认刘海、不认系统栏。Capacitor 8 自己也注入这四个变量，但**只在
 * 安卓 15 及以上**（见 SystemBars.java）。这台平板是什么版本不好说，所以自己也算一份 ——
 * 变量名和算法与 Capacitor 保持一致，两边同时写也是同一个值，不会打架。
 *
 * ⚠️ 键盘：一旦关掉自动避让，安卓 15 以下就没人管输入法遮挡了
 * （Capacitor 那段处理同样只在 15 及以上）。所以下面在 15 以下自己把内容顶上去。
 * 这个 app 在键盘上栽过跟头（见后续规划第七之二节），这一段别删。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // 安卓 10 起，系统会给半透明的系统栏自动加一层灰色蒙版「保证对比度」，
        // 那正好又变成一条看得见的带子。关掉，对比度由我们自己的底色负责
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        final View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());

            // 键盘弹出来时底部不再留系统栏的白 —— 那时候底边归键盘
            injectSafeAreaInsets(bars.top, bars.right, imeVisible ? 0 : bars.bottom, bars.left);

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
                int imeBottom = imeVisible
                    ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
                    : 0;
                if (v.getPaddingBottom() != imeBottom) {
                    v.setPadding(0, 0, 0, imeBottom);
                }
            }

            // 不吞掉：Capacitor 自己那套（安卓 15 及以上）还要用
            return insets;
        });

        /*
         * 网页装好之后再报一次。
         *
         * 上面那个监听第一次触发时网页可能还没加载，写进去的变量会随着页面加载一起没了。
         * Capacitor 自己也是这么补的一刀。
         */
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                view.requestApplyInsets();
            }
        });
    }

    /** 把系统栏尺寸（换算成 CSS 像素）写成四个 CSS 变量 */
    private void injectSafeAreaInsets(int top, int right, int bottom, int left) {
        if (getBridge() == null || getBridge().getWebView() == null) return;

        float density = getResources().getDisplayMetrics().density;
        final String js = String.format(
            Locale.US,
            "try{var s=document.documentElement.style;" +
                "s.setProperty('--safe-area-inset-top','%dpx');" +
                "s.setProperty('--safe-area-inset-right','%dpx');" +
                "s.setProperty('--safe-area-inset-bottom','%dpx');" +
                "s.setProperty('--safe-area-inset-left','%dpx');}catch(e){}",
            (int) (top / density),
            (int) (right / density),
            (int) (bottom / density),
            (int) (left / density)
        );

        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }
}
