package com.grainwise.purchase;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
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
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(
    name = "GrainPrint",
    permissions = {
        @Permission(alias = "bluetoothConnect", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class GrainPrintPlugin extends Plugin {
    private static final UUID SERIAL_PORT_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final List<WebView> activePrintViews = new ArrayList<>();
    private final ExecutorService bluetoothExecutor = Executors.newSingleThreadExecutor();
    private final Object bluetoothLock = new Object();
    private BluetoothSocket bluetoothSocket;

    @PluginMethod
    public void requestBluetoothPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState("bluetoothConnect") == PermissionState.GRANTED) {
            call.resolve();
            return;
        }
        requestPermissionForAlias("bluetoothConnect", call, "bluetoothPermissionCallback");
    }

    @PermissionCallback
    private void bluetoothPermissionCallback(PluginCall call) {
        if (getPermissionState("bluetoothConnect") == PermissionState.GRANTED) call.resolve();
        else call.reject("Nearby devices permission is required to use a Bluetooth printer.");
    }

    @PluginMethod
    public void getPairedPrinters(PluginCall call) {
        if (!hasBluetoothPermission()) {
            call.reject("Nearby devices permission is required to list paired printers.");
            return;
        }
        try {
            BluetoothAdapter adapter = bluetoothAdapter();
            if (adapter == null) {
                call.reject("Bluetooth is not available on this device.");
                return;
            }
            if (!adapter.isEnabled()) {
                call.reject("Turn on Bluetooth before selecting a printer.");
                return;
            }
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            List<BluetoothDevice> devices = new ArrayList<>(bonded);
            devices.sort(Comparator.comparing(device -> safeDeviceName(device).toLowerCase()));
            JSArray result = new JSArray();
            for (BluetoothDevice device : devices) {
                JSObject item = new JSObject();
                item.put("name", safeDeviceName(device));
                item.put("address", device.getAddress());
                result.put(item);
            }
            JSObject response = new JSObject();
            response.put("devices", result);
            call.resolve(response);
        } catch (SecurityException error) {
            call.reject("Bluetooth permission was denied.", error);
        }
    }

    @PluginMethod
    public void connectBluetooth(PluginCall call) {
        String address = call.getString("address");
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            call.reject("Select a valid paired Bluetooth printer.");
            return;
        }
        if (!hasBluetoothPermission()) {
            call.reject("Nearby devices permission is required to connect to the printer.");
            return;
        }
        bluetoothExecutor.execute(() -> {
            try {
                BluetoothAdapter adapter = bluetoothAdapter();
                if (adapter == null || !adapter.isEnabled()) throw new IOException("Turn on Bluetooth before connecting.");
                BluetoothDevice device = adapter.getRemoteDevice(address);
                BluetoothSocket socket = connectSocket(device);
                synchronized (bluetoothLock) {
                    closeBluetoothSocket();
                    bluetoothSocket = socket;
                }
                JSObject result = new JSObject();
                result.put("name", safeDeviceName(device));
                result.put("address", address);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not connect to the Bluetooth printer. Confirm that it is paired and not connected to another phone.", error);
            }
        });
    }

    @PluginMethod
    public void disconnectBluetooth(PluginCall call) {
        bluetoothExecutor.execute(() -> {
            synchronized (bluetoothLock) { closeBluetoothSocket(); }
            call.resolve();
        });
    }

    @PluginMethod
    public void printEscPos(PluginCall call) {
        String encoded = call.getString("data");
        if (encoded == null || encoded.isEmpty()) {
            call.reject("Receipt data is empty.");
            return;
        }
        bluetoothExecutor.execute(() -> {
            try {
                byte[] data = Base64.decode(encoded, Base64.DEFAULT);
                synchronized (bluetoothLock) {
                    if (bluetoothSocket == null || !bluetoothSocket.isConnected()) throw new IOException("Bluetooth printer is not connected.");
                    OutputStream output = bluetoothSocket.getOutputStream();
                    for (int offset = 0; offset < data.length; offset += 512) {
                        output.write(data, offset, Math.min(512, data.length - offset));
                    }
                    output.flush();
                }
                JSObject result = new JSObject();
                result.put("bytesWritten", data.length);
                call.resolve(result);
            } catch (Exception error) {
                synchronized (bluetoothLock) { closeBluetoothSocket(); }
                call.reject("The receipt could not be sent to the Bluetooth printer.", error);
            }
        });
    }

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

    private boolean hasBluetoothPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState("bluetoothConnect") == PermissionState.GRANTED;
    }

    private BluetoothAdapter bluetoothAdapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private String safeDeviceName(BluetoothDevice device) {
        try {
            String name = device.getName();
            return name == null || name.trim().isEmpty() ? "Bluetooth device" : name.trim();
        } catch (SecurityException error) {
            return "Bluetooth device";
        }
    }

    private BluetoothSocket connectSocket(BluetoothDevice device) throws IOException {
        BluetoothSocket secure = device.createRfcommSocketToServiceRecord(SERIAL_PORT_UUID);
        try {
            secure.connect();
            return secure;
        } catch (IOException secureError) {
            try { secure.close(); } catch (IOException ignored) {}
            BluetoothSocket insecure = device.createInsecureRfcommSocketToServiceRecord(SERIAL_PORT_UUID);
            try {
                insecure.connect();
                return insecure;
            } catch (IOException insecureError) {
                try { insecure.close(); } catch (IOException ignored) {}
                insecureError.addSuppressed(secureError);
                throw insecureError;
            }
        }
    }

    private void closeBluetoothSocket() {
        if (bluetoothSocket == null) return;
        try { bluetoothSocket.close(); } catch (IOException ignored) {}
        bluetoothSocket = null;
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (bluetoothLock) { closeBluetoothSocket(); }
        bluetoothExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
