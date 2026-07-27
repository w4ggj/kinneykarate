# Kinney Karate POS — Mobile App Setup

## Prerequisites

- Node 18+
- EAS CLI: `npm install -g eas-cli`
- Expo account (free): https://expo.dev/signup
- For iOS builds: Apple Developer account ($99/yr)
- For iOS Tap to Pay: Stripe approval required (see below)

## 1. Install dependencies

```bash
cd mobile
npm install
```

## 2. Log in to Expo / EAS

```bash
eas login
```

Enter your Expo account credentials.

## 3. Configure EAS project

```bash
eas build:configure
```

This links the project to your EAS account and may update `app.json` with an `extra.eas.projectId`.

## 4. Stripe Tap to Pay on iPhone entitlement

Tap to Pay on iPhone requires approval from Stripe before it can be used in production.

1. Log in to the Stripe Dashboard → Settings → Terminal
2. Click **Request Tap to Pay on iPhone**
3. Fill out the form (business info, use case)
4. Stripe typically approves within a few business days
5. Once approved, the Stripe Terminal SDK will allow `localMobile` discovery on physical iPhones running iOS 16+

**Note:** During development you can test with `simulated: true` in `discoverReaders` (set in `POSScreen.tsx`) — this uses a virtual reader and doesn't require NFC hardware or Stripe approval.

## 5. Apple Developer portal — proximity reader entitlement

The `com.apple.developer.proximity-reader.payment.acceptance` entitlement must be added to the App ID:

1. Go to https://developer.apple.com → Certificates, Identifiers & Profiles
2. Select **Identifiers** → find or create `com.kinneykarate.pos`
3. Scroll to **Additional Capabilities** → enable **Tap to Pay on iPhone**
4. Save the identifier
5. Regenerate your provisioning profiles if necessary (EAS handles this automatically during cloud builds)

## 6. Build Android APK (for sideloading)

```bash
eas build --platform android --profile preview
```

- EAS builds in the cloud; no local Android SDK required
- When complete, EAS provides a download URL for the `.apk`
- Build takes ~10–15 minutes

**To sideload on Android:**
1. On the device: Settings → Security (or Apps) → Install unknown apps → enable for your browser
2. Open the EAS download link in the device browser
3. Download and install the APK
4. The app appears in the launcher

## 7. Build iOS for TestFlight (internal distribution)

```bash
eas build --platform ios --profile preview
```

- EAS handles code signing automatically (managed credentials)
- When complete, download the `.ipa` from the EAS dashboard
- Upload to App Store Connect using Transporter (Mac app) or `xcrun altool`
- Add testers in TestFlight → Internal Testing
- Testers install via the TestFlight app

## 8. Signing in to the app

Use the same admin email/password used for the Kinney Karate admin console at kinneykarate.com/admin. The app authenticates against the same Supabase project.

## 9. Reader pairing (Tap to Pay)

The app uses **Tap to Pay on iPhone** (no external hardware required). On first launch:

1. Sign in with admin credentials
2. The app calls `discoverReaders({ discoveryMethod: 'localMobile' })` automatically
3. A system prompt may appear asking to allow payment acceptance — tap Allow
4. The status dot in the header turns green when the reader is ready
5. Tap any product card to start a payment — the system NFC sheet appears

## Environment / API

The app points to `https://kinneykarate.com` (defined in `src/config.ts`). To point at staging or local dev, change `API_BASE` there and rebuild.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Reader error — restart app" on launch | Check iOS version (16+ required for Tap to Pay). Try `simulated: true` to verify Terminal SDK is working. |
| Login fails with "Invalid login credentials" | Confirm the email/password works at kinneykarate.com/admin |
| Connection token errors | Ensure the Cloudflare Worker has `STRIPE_SECRET_KEY` and `SUPABASE_URL`/`SUPABASE_ANON_KEY` set |
| Android build fails | Run `eas build --platform android --profile preview --clear-cache` |
| iOS build fails with entitlement error | Verify the proximity reader entitlement is enabled in the Apple Developer portal for `com.kinneykarate.pos` |
