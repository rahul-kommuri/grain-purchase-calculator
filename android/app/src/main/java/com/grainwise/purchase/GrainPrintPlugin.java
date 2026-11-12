package com.grainwise.purchase;

import android.app.Activity;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "GrainPrint")
public class GrainPrintPlugin extends Plugin {
    private final List<WebView> activePrintViews = new ArrayList<>();

    @PluginMethod
    public void print(PluginCall call) {
        String html = call.getString("html");
        String jobName = call.getString("jobName", "Grainwise");
        String paper = call.getString("paper", "A4");
        if (html == null || html.isEmpty()) {
            call.reject("Print content is empty.");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("The Android activity is not available.");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                WebView webView = new WebView(activity);
                WebSettings settings = webView.getSettings();
                settings.setJavaScriptEnabled(false);
                settings.setAllowFileAccess(true);
                AtomicBoolean started = new AtomicBoolean(false);
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                        if (!request.isForMainFrame() || !started.compareAndSet(false, true)) return;
                        String description = error.getDescription() == null
                            ? "Unknown document loading error."
                            : error.getDescription().toString();
                        call.reject("Could not load the document for printing: " + description);
                        view.destroy();
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        if (!started.compareAndSet(false, true)) return;
                        try {
                            PrintManager printManager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                            if (printManager == null) {
                                call.reject("Android printing is not available on this device.");
                                webView.destroy();
                                return;
                            }
                            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                            PrintJob printJob = printManager.print(jobName, adapter, printAttributes(paper));
                            synchronized (activePrintViews) {
                                activePrintViews.add(webView);
                            }
                            monitorPrintJob(activity, printJob, webView);
                            JSObject result = new JSObject();
                            result.put("jobId", printJob.getId().toString());
                            call.resolve(result);
                        } catch (Exception error) {
                            call.reject("Could not start the Android print dialog.", error);
                            webView.destroy();
                        }
                    }
                });
                webView.loadDataWithBaseURL(
                    "file:///android_asset/public/",
                    html,
                    "text/html",
                    "UTF-8",
                    null
                );
            } catch (Exception error) {
                call.reject("Could not prepare the document for printing.", error);
            }
        });
    }

    private void monitorPrintJob(Activity activity, PrintJob printJob, WebView webView) {
        Handler handler = new Handler(Looper.getMainLooper());
        Runnable cleanup = new Runnable() {
            @Override
            public void run() {
                if (printJob.isCompleted() || printJob.isCancelled() || activity.isFinishing()) {
                    synchronized (activePrintViews) {
                        activePrintViews.remove(webView);
                    }
                    webView.destroy();
                } else if (!activity.isFinishing()) {
                    handler.postDelayed(this, 1000);
                }
            }
        };
        handler.postDelayed(cleanup, 1000);
    }

    private PrintAttributes printAttributes(String paper) {
        PrintAttributes.MediaSize mediaSize;
        switch (paper) {
            case "58mm":
                mediaSize = new PrintAttributes.MediaSize("grainwise_58mm", "58 mm Thermal", 2283, 1000000);
                break;
            case "80mm":
                mediaSize = new PrintAttributes.MediaSize("grainwise_80mm", "80 mm Thermal", 3150, 1000000);
                break;
            case "A5":
                mediaSize = PrintAttributes.MediaSize.ISO_A5;
                break;
            default:
                mediaSize = PrintAttributes.MediaSize.ISO_A4;
                break;
        }
        return new PrintAttributes.Builder()
            .setMediaSize(mediaSize)
            .setResolution(new PrintAttributes.Resolution("grainwise", "Grainwise", 300, 300))
            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
            .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
            .build();
    }
}
