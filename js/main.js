import "./calc.js";
import "./storage.js";
import "./validate.js";
import "./receipt.js";
import "../data/sample-purchases.js";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { createSupabaseSync } from "./supabase-sync.js";

const nativePrinter = registerPlugin("GrainPrint");
window.GrainNativePrint = {
  isNative: () => Capacitor.isNativePlatform(),
  stylesheetHref() {
    return Capacitor.isNativePlatform() ? "print.css" : new URL("print.css", document.baseURI).href;
  },
  appStylesheetHref() {
    return document.querySelector('link[rel="stylesheet"]:not([media])')?.getAttribute("href") || "";
  },
  async print(html, jobName, paper = "A4") {
    if (!Capacitor.isNativePlatform()) return false;
    await nativePrinter.print({ html, jobName, paper });
    return true;
  }
};

window.GrainSync = createSupabaseSync(
  import.meta.env.VITE_SUPABASE_URL || "",
  import.meta.env.VITE_SUPABASE_ANON_KEY || ""
);
window.GrainSync.initialize().catch((error) => {
  console.error("Supabase authentication could not be initialized.", error);
});

if (!Capacitor.isNativePlatform() && "serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Offline app cache could not be registered.", error);
    });
  }, { once: true });
}

import("../app.js").catch((error) => {
  console.error("The app could not start.", error);
  const app = document.querySelector("#app");
  if (app) app.textContent = "The app could not start. Reload the page or check the browser console.";
});
