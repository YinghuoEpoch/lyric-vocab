package com.colin.lyricvocab;

import android.os.Build;
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

        ret.put("available", true);
        ret.put("top", Math.round(bars.top / density));
        ret.put("right", Math.round(bars.right / density));
        ret.put("bottom", Math.round(bars.bottom / density));
        ret.put("left", Math.round(bars.left / density));
        call.resolve(ret);
    }
}
