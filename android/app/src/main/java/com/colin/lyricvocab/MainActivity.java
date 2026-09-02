package com.colin.lyricvocab;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

/**
 * 沉浸式：网页自己铺到状态栏和导航栏底下。
 *
 * 起因是用户在平板上报的两条：顶上一条深灰的状态栏和 app 格格不入；
 * 底下导航栏那一行是空的，弹窗把背景压暗时它不跟着暗，别的 app 都是交融的。
 *
 * **给系统栏染个色是不够的** —— 用户当场指出来的：左栏和正文之间那条竖线会停在
 * 系统栏下沿，上面一截是空的，看着像断了；底下则变成 app 踩在一条空白横条上。
 * 所以只能是网页自己长到屏幕边缘，每一栏的底色和竖线一路铺到最顶最底，
 * 时钟电量和导航键浮在 app 自己的颜色上。
 *
 * 这里做四件事：
 *
 * 1. **关掉系统给窗口的自动避让**（setDecorFitsSystemWindows(false)），
 *    网页从此占满整块屏幕。两条系统栏的底色在主题里已经改成透明（styles.xml）。
 * 2. **图标一律按「浅色底」画**（深色图标）。这个 app 没有深色模式，
 *    系统栏后面永远是白纸或纸色，白图标等于看不见。
 * 3. **系统栏尺寸报给网页**。启动时由网页主动来问（见 SafeAreaPlugin），
 *    这里只管**之后**的变化：转屏、键盘弹起收起。那时候网页早在了，不抢跑。
 * 4. **键盘避让**。一旦关掉自动避让，安卓 15 以下就没人管输入法遮挡了
 *    （Capacitor 那段处理同样只在 15 及以上）。这个 app 在键盘上栽过跟头
 *    （见后续规划第七之二节），所以 15 以下自己把内容顶上去。这一段别删。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ⚠️ 必须在 super.onCreate 之前 —— 桥是在 super 里建的，晚一步就注册不进去
        registerPlugin(SafeAreaPlugin.class);

        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        /*
         * 图标深浅。用 WindowInsetsControllerCompat 而不是主题属性：
         * windowLightStatusBar 要 API 23、windowLightNavigationBar 要 API 27，
         * 写在主题里得为它们单开 values-v23 / values-v27 两个目录，这边一句话带版本判断。
         */
        WindowInsetsControllerCompat bars =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(true);
        bars.setAppearanceLightNavigationBars(true);

        // 安卓 10 起，系统会给透明的系统栏自动加一层灰蒙版「保证对比度」，
        // 那正好又变成一条看得见的带子。关掉，对比度由我们自己的底色负责
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        final View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets systemBars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            /*
             * 放按钮要让多少，和底色要铺多少不是一回事 —— 算法和插件那边共用一份
             * （SafeAreaPlugin.buttonBottom），免得两条路一处改了另一处忘。
             * ⚠️ 它出来的已经是 CSS 像素，下面 pushInsets 不要再除一次密度。
             */
            float density = getResources().getDisplayMetrics().density;
            int buttonBottom = SafeAreaPlugin.buttonBottom(this, insets, density);

            // 键盘弹出来时底部不再让系统栏那一条 —— 那时候底边归键盘
            pushInsets(
                systemBars.top,
                systemBars.right,
                imeVisible ? 0 : systemBars.bottom,
                systemBars.left,
                imeVisible ? 0 : buttonBottom
            );

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
    }

    /**
     * 把变化后的尺寸推给网页。
     *
     * 只调网页留好的那个钩子，不直接改 CSS 变量 —— 保底值、四舍五入这些规矩
     * 都写在网页那一边（src/safeArea.ts），两条路（问答式、推送式）走同一套算法，
     * 免得一处改了另一处忘。钩子还没挂上（网页没起来）时这一句是空转，
     * 不要紧：启动那次的值是网页自己来问的。
     */
    /** 前四个数是物理像素，最后那个 buttonBottom 已经是 CSS 像素了，别再除一次 */
    private void pushInsets(int top, int right, int bottom, int left, int buttonBottomCss) {
        if (getBridge() == null || getBridge().getWebView() == null) return;

        float density = getResources().getDisplayMetrics().density;
        final String js = String.format(
            Locale.US,
            "window.__onNativeInsets&&window.__onNativeInsets(%d,%d,%d,%d,%d)",
            Math.round(top / density),
            Math.round(right / density),
            Math.round(bottom / density),
            Math.round(left / density),
            buttonBottomCss
        );

        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }
}
