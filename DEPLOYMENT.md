# Grainwise deployment

The application is a Vite static web app/PWA backed by Supabase. Netlify and
Render only host the compiled frontend; Supabase provides authentication and
cloud data sync. The Android app embeds the same compiled frontend through
Capacitor.

## Required Supabase configuration

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
3. In Authentication, enable email/password authentication.
4. Copy `.env.example` to `.env` and set the project URL and the public
   publishable/anon key. Never use a secret or `service_role` key.
5. Add every production URL (Netlify, Render, and any custom domain) under
   Authentication > URL Configuration. Set the primary deployment as the Site
   URL and add the others as Redirect URLs.

## Git hosting

This directory can be pushed to GitHub, GitLab, or Bitbucket. After creating an
empty private repository, run:

```powershell
git init
git add .
git commit -m "Prepare Grainwise for deployment"
git branch -M main
git remote add origin <repository-url>
git push -u origin main
```

`.env`, build output, dependencies, Android local configuration, and APK build
output are ignored and must not be committed.

## Netlify

1. Import the Git repository in Netlify.
2. Netlify reads `netlify.toml`; no build or publish override is needed.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to environment
   variables for Production (and Deploy Previews if previews need cloud sync).
4. Deploy, then add the resulting HTTPS URL to Supabase Auth URL Configuration.

## Render

1. Create a Blueprint from the Git repository. Render reads `render.yaml`.
2. When prompted, enter `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Deploy, then add the resulting `onrender.com` HTTPS URL to Supabase Auth URL
   Configuration.

Both hosts are valid production targets. Usually one should be treated as the
primary URL to avoid users accidentally creating separate browser-local data on
different origins before signing in.

## Android

Set the same two variables in local `.env`, then run:

```powershell
npm ci
npm run android:sync
npm run android:apk
```

The debug APK is written under
`android/app/build/outputs/apk/debug/app-debug.apk`. A Play Store release also
requires a private signing keystore and a release build; never commit the
keystore or its passwords.

## Verification checklist

- `npm ci` and `npm run build` complete successfully.
- Sign-up, email confirmation (if enabled), sign-in, sync, and sign-out work.
- Row-level security prevents one Supabase user from reading another user's data.
- The PWA reopens offline after one successful online visit.
- A purchase created offline syncs after connectivity returns.
- Printing is tested on the intended web browser and Android printer service.
- Android uninstall/clear-data behavior is tested only after confirming sync.
