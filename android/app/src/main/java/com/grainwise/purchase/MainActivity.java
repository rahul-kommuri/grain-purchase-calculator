package com.grainwise.purchase;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(GrainPrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
