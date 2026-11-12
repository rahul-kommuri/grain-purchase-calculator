# Supabase setup

The app remains usable with browser-local storage before Supabase is configured. After setup, sign in on each device to sync its local records to your private Supabase project. Local changes are saved first and queued for sync when the app is online.

## 1. Install and start the web app

Install Node.js, then in this project folder run:

```sh
npm install
npm run dev
```

Open the printed local URL. Do not open `index.html` directly with `file://`; the app uses Vite modules and the service worker requires an HTTP(S) origin. For a phone on the same Wi-Fi, use the network URL printed by Vite. For use away from home, deploy the app to an HTTPS static host.

## 2. Create the Supabase project

1. Create a Supabase project and copy its **Project URL** and **publishable key** (or legacy `anon` key).
2. Copy `.env.example` to `.env` and replace the example values:

   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-publishable-or-anon-key
   ```

3. Restart the Vite server after editing `.env`.
4. In the Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql).
5. In Supabase Authentication settings, enable email/password sign-in and add your local and deployed HTTPS URLs to the allowed redirect URLs.
6. Deploy with those same two `VITE_` variables set in the host's build environment.

The publishable/anon key is intended for browser use. **Never put a Supabase `service_role` or secret key in this app or in a `VITE_` variable.** The SQL enables row-level security so authenticated users can access only rows whose `user_id` matches their account.

## 3. Connect devices

Open Settings → Cloud sync, create an account or sign in, and use that same account on the other devices for this business. The app keeps working when offline; local edits sync after connectivity returns. If email confirmation is enabled, confirm the account from your email before signing in.

The first successful sync merges local and cloud rows by record ID and update time; the newest update wins when the same record changed on two devices. The three fixed grains are matched by name so their IDs remain consistent across devices. If separate devices have created the same receipt number for different purchases, sync stops and reports the conflict instead of silently merging those purchases. A browser profile is linked to the first Supabase account that syncs there; use a separate browser profile for a different account to prevent mixing business data.

## Offline behavior and data safety

The service worker caches the app shell for offline opening. Purchase data and pending sync deletions remain in that browser's local storage until Supabase sync succeeds. Sign in with the same account on each device to share records. Clearing site data or uninstalling the browser app removes that device's unsynced local data; confirm the cloud sync status before doing so.

Bag-size defaults are 70 kg for Paddy and 60 kg for Maize and Jowar. Adjust each grain's default in Settings or override it on an individual purchase. Payable weight subtracts a fixed 1 kg tare for every bag used, including bags needed for remaining KGs; each purchase stores its bag size and tare basis so later default changes do not alter saved transactions.

This is an initial sync implementation, not a multi-user team/role system. Use one business account across the devices that should share a dataset. Supabase Auth and row-level security isolate different accounts. Changes sync after local edits, when connectivity returns, when the app is focused, and from Settings → Sync now.

## 4. Build and install the Android app

The Android project wraps the same app using Capacitor. Its built web files are bundled into the APK, so the app itself starts and remains usable without an internet connection. Supabase sync still requires connectivity.

1. Install Android Studio, Android SDK Platform 36 and Platform Tools, and JDK 21. Configure `JAVA_HOME` to point to JDK 21, then open Android Studio once and let it finish installing its SDK components.
2. In this project folder, install dependencies and build/sync the native project:

   ```sh
   npm install
   npm run android:sync
   ```

3. To open the project and run it on a connected device or emulator:

   ```sh
   npm run android:open
   ```

4. To build a debug APK from PowerShell:

   ```powershell
   npm run android:apk
   ```

   The APK is created at `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to the Android device and install it, or use Android Studio's Run action. Android may ask you to allow installation from that file source.

The Android application ID is currently `com.grainwise.purchase`. Set Supabase build variables in `.env` before building if you want the installed app to sync; without them it runs local-only. Do not put secret/service-role keys in `.env`.

The APK stores records locally on the installed device and does not need the PWA service worker. Different devices only share data through Supabase after signing in and connecting to the internet. Android app data is removed when the app is uninstalled or its storage is cleared, so verify cloud sync before doing that. Receipts, farmer statements, and reports use Android's native print service; test 58 mm/80 mm media support with the target printer and its print service before relying on it in production.
