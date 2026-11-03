# School Pro: Play Store checklist (PWABuilder, consumption-only)

Do not upload this file to your host.

## How the app knows it is the Play build
A PWABuilder app is a Trusted Web Activity: it runs in Chrome, so there is no special user-agent. The app is told by its **Start URL**:

`https://nexlitedigitalsolutionslimited.digital/school-pro-ultimate/index.html?app=play`

`index.html` sees `?app=play` and sets `SP_PLAY` for that tab only (session storage). Your normal website and the installed PWA are unaffected, even on the same phone. If the Start URL has no `?app=play`, the app will show pricing and signup and Play will reject it.

## What is hidden or changed when SP_PLAY is on
- Hidden: Sign Up, "Set Up Your School", "New school?", the closing sign-up banner, plans and pricing links, "No card required".
- Blocked in code: school signup, and creating a new school from Google sign-in.
- Admin > Subscription: plain "Access status" card. No prices, Apply buttons or Airtel/MTN number.
- Banners and messages: no Renew, Subscribe, Upgrade, no phone numbers. Read-only mode still works.
- Terms section 5: "arranged outside the app, no in-app purchases".
- Kept: parents submitting school fee payments (a real-world service, not a digital good).

## 1. Upload to your host
- `school-pro-ultimate/`: `index.html`, `sw.js` (v66), `manifest.json`, `terms.html`, `privacy.html`, `delete-account.html`
- Domain root (not the subfolder): `/.well-known/assetlinks.json` (see step 4). In Namecheap File Manager, show hidden files and create the `.well-known` folder in `public_html`.

## 2. Check at pwabuilder.com
Enter `https://nexlitedigitalsolutionslimited.digital/school-pro-ultimate/index.html`. Manifest, service worker and icons should pass. Optional but helpful: add 2 or more phone screenshots to the manifest.

## 3. Package for Android
- Package ID: choose once, never change it (for example `digital.nexlitedigitalsolutionslimited.schoolpro`).
- **Start URL:** the `?app=play` URL above.
- Host: `nexlitedigitalsolutionslimited.digital`. Display: standalone.
- Signing key: choose **Generate new** and keep the downloaded keystore and passwords safe. Losing them blocks future updates. Or use Play App Signing and upload the generated AAB.
- It must target Android 16 (API 36). Check `targetSdkVersion` in the package PWABuilder gives you.
- Build the **AAB**, not the APK.

## 4. Digital Asset Links
Without this, the app shows a Chrome address bar at the top and looks unfinished.
1. Play Console > your app > Test and release > App integrity > copy the **App signing key certificate SHA-256**.
2. Put it in `assetlinks.json` with your package ID, upload to `/.well-known/assetlinks.json` on the domain root.
3. Open that URL in a browser. It must show the JSON directly, with no redirect.

## 5. Test on a real phone (internal testing track)
Login, forgot password, parent login, Admin > Subscription (no prices), an expired trial (read-only banner), no address bar. Test Google login; if it fails, add `web-only` to the class of `#lpGoogleLoginBtn` and `#lpGoogleSignupBtn` in `index.html`.

## Play Console
- **Privacy policy URL:** `https://nexlitedigitalsolutionslimited.digital/school-pro-ultimate/privacy.html`
- **Account deletion URL** (Data safety): `https://nexlitedigitalsolutionslimited.digital/school-pro-ultimate/delete-account.html`. Confirm the 30-day promise on that page, or edit it.
- **App access:** create a demo school with fake learners. Give reviewers its email, password and any PIN. Without this the app is rejected: it opens on a login screen.
- **Ads:** No. **In-app purchases / paid app:** none.
- **Target audience:** 18+ (teachers, administrators, parents). **Category:** Education.
- **Financial features declaration:** the app records fees and payroll but does not move money. Declare no financial services.
- **Data safety** (collected, encrypted in transit, deletion on request, not sold, not shared):
  - Personal info: name, email address, phone numbers.
  - Photos: learner photos. Files and docs: Inbox uploads.
  - Financial info: fee and payment records (transaction IDs, amounts).
  - App activity / user content: results, attendance, conduct, messages.
  - No analytics, no ad SDKs.
- **Store listing text and screenshots:** no prices, plans, trials, Airtel/MTN or "pay to activate". Suggested line: "For schools that already use School Pro. Log in with the details your school gave you."
- If your developer account is a personal one created after Nov 2023, Play requires a closed test with 12 testers for 14 days before production. An organization account is exempt.
