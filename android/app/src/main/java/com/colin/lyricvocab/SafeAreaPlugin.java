package com.colin.lyricvocab;

import android.os.Build;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 把系统栏（顶上的状态栏、底下的导航栏）有多高告诉网页。
 *
 * ## 为什么是「网页来问」，不是「原生去塞」
 *
 * 上一版（已撤回的 a0622a3）是原生算好之后 evaluateJavascript 塞给网页的，
 * 塞的时机和网页加载抢跑：网页一刷新，塞进去的东西就没了；补塞又赶在 React 起来之前。
 * 真机上一装，四个值全是 0，正文直接顶到状态栏底下。
 *
 * 这一版反过来 —— 网页起来之后**主动调这个方法要**。Capacitor 的桥会把调用排好队，
 * 抢不了跑。转屏、键盘弹出这类**之后**才发生的变化仍由 MainActivity 推给网页
 * （那时候网页早在了，不存在抢跑）。
 *
 * ## 为什么不靠 CSS 的 env(safe-area-inset-*)
 *
 * 安卓 WebView 对它的支持看版本，老一点的只认刘海、不认系统栏。
 * Capacitor 8 自己也注入同名变量，但**只在安卓 15 及以上**（见 SystemBars.java）。
 * 这台平板够不够 15 不好说，所以这里自己算一份，全版本都拿得到。
 */
@CapacitorPlugin(name = "SafeArea")
public class SafeAreaPlugin extends Plugin {

    /**
     * 这台机器底下用的是哪种导航：0 = 三颗键，1 = 两颗键，2 = 手势。取不到是 -1。
     *
     * `navigation_mode` 不是公开 API 里的常量，但它就是系统设置里那个开关本身，
     * 各家 ROM 都得写这一格，读它不需要任何权限。之所以还要读它 ——
     * 本来 tappableElement 就该回答「放按钮要让多少」（手势模式下是 0），
     * 但有 ROM 手势模式下照样报整条，于是 app 白让一条。
     * 先信这一格，取不到再退回 tappableElement。
     */
    static int navigationMode(android.content.Context ctx) {
        try {
            return Settings.Secure.getInt(ctx.getContentResolver(), "navigation_mode", -1);
        } catch (Exception e) {
            return -1;
        }
    }

    /**
     * 放按钮要往上让多少（CSS 像素）。
     *
     * 手势条是透的、点得穿，不用让；三颗键是实心的，压在下面就点不着。
     * ⚠️ 这个数和「底色要铺多少」不是一回事 —— 底色一律铺满整屏。
     */
    static int buttonBottom(android.content.Context ctx, WindowInsetsCompat insets, float density) {
        int tappable = insets.getInsets(WindowInsetsCompat.Type.tappableElement()).bottom;
        int mode = navigationMode(ctx);
        if (mode == 2) return 0; // 手势
        if (mode == 0 || mode == 1) {
            // 按键模式：以系统栏为准，tappableElement 偶有报 0 的
            int bars = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
            return Math.round(Math.max(tappable, bars) / density);
        }
        return Math.round(tappable / density);
    }

    /**
     * 四条边各要让出多少（已换算成 CSS 像素）。
     *
     * 顺带把安卓版本、屏幕密度、以及这次到底取没取到一并报上去 ——
     * 设置页底下那一小行会显示它们，装到真机上截一张图就知道成没成，
     * 不必再靠猜。
     */
    @PluginMethod
    public void getInsets(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("sdk", Build.VERSION.SDK_INT);

        View view = getBridge() == null ? null : getBridge().getWebView();
        WindowInsetsCompat insets = view == null ? null : ViewCompat.getRootWindowInsets(view);

        DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
        float density = metrics.density;
        ret.put("density", density);

        if (insets == null) {
            /*
             * 取不到就老实说取不到，别报 0 ——
             * 网页那边会退回 CSS 的 env()，再不行还有保底值。
             * 报 0 的话它会当成「这台机器真没有系统栏」，那才是上一版栽的样子。
             */
            ret.put("available", false);
            call.resolve(ret);
            return;
        }

        // 刘海也算进来：全面屏手机横过来时，刘海那一侧要让出的比系统栏还宽
        Insets bars = insets.getInsets(
            WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
        );

        /*
         * 底边**另外报一个数**：放按钮的地方要让多少。
         *
         * 底下那条系统栏有两种，让的量差很多：
         *
         * - 三颗导航键：实心的，app 的按钮压在下面就点不着，必须整条让开（48dp 上下）
         * - 手势条：透的，点得穿，不用让 —— tappableElement 这时候是 0
         *
         * 一律按系统栏高度让的话，手势条的机器上就白留一条 ——
         * 用户在平板上一眼看出来了：「左侧栏与右侧栏底部被抬高了」。
         * 所以底色仍旧铺满整屏（用 bottom），而**按钮往上让多少看这个数**。
         */
        Insets tappable = insets.getInsets(WindowInsetsCompat.Type.tappableElement());

        ret.put("available", true);
        ret.put("top", Math.round(bars.top / density));
        ret.put("right", Math.round(bars.right / density));
        ret.put("bottom", Math.round(bars.bottom / density));
        ret.put("left", Math.round(bars.left / density));
        ret.put("tappableRaw", Math.round(tappable.bottom / density));
        ret.put("navMode", navigationMode(getContext()));
        ret.put("tappableBottom", buttonBottom(getContext(), insets, density));
        call.resolve(ret);
    }
}
