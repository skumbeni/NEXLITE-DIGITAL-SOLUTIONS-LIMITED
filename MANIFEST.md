# Nexlite Digital Solutions — Brand & Icon Asset Manifest

Everything here is built from the Woven Emblem mark, ready to drop into the
`nexlite_digital.html` repo and push to GitHub.

## 1. Folder structure — copy this as-is into your repo root

```
your-repo/
├── nexlite_digital.html        ← your existing landing page (or rename to index.html)
├── site.webmanifest
└── assets/
    ├── icons/
    │   ├── favicon.ico
    │   ├── favicon-16x16.png
    │   ├── favicon-32x32.png
    │   ├── favicon-48x48.png
    │   ├── apple-touch-icon.png
    │   ├── android-chrome-192x192.png
    │   ├── android-chrome-512x512.png
    │   ├── maskable-icon-512x512.png
    │   └── safari-pinned-tab.svg
    ├── brand/
    │   ├── nexlite-emblem-standalone.svg
    │   ├── nexlite-emblem-app-icon.svg
    │   ├── nexlite-emblem-lockup-horizontal.svg
    │   ├── nexlite-emblem-lockup-stacked.svg
    │   ├── nexlite-emblem-monochrome.svg
    │   └── nexlite-emblem-on-light.svg
    └── og/
        └── og-image.png
```

`assets/brand/` isn't required by any browser — it's just so the source
marks live in the repo for future reuse (App Store listings, business
cards, the Median APK icon, etc).

## 2. What each icon file is for

| File | Used for |
|---|---|
| `favicon.ico` | Legacy browser tab icon (bundles 16/32/48px) |
| `favicon-16x16.png` / `favicon-32x32.png` | Modern browser tab icon |
| `favicon-48x48.png` | Windows taskbar / desktop shortcut |
| `apple-touch-icon.png` (180×180) | iOS "Add to Home Screen" |
| `android-chrome-192x192.png` / `-512x512.png` | Android home screen, PWA install prompt |
| `maskable-icon-512x512.png` | Android adaptive icon — emblem sits in a safe zone so circular/squircle masks don't crop it |
| `safari-pinned-tab.svg` | macOS Safari pinned-tab icon (single-color silhouette; Safari recolors it itself) |
| `og-image.png` (1200×630) | Link preview image on WhatsApp, Facebook, X/Twitter, LinkedIn |

The small favicon sizes (16/32/48) use a simplified version of the mark —
the weave pattern and ring text were dropped because they just turn to
noise at that size. 180px and up use the full detailed emblem.

> Note: the OG image's wordmark is set in a fallback serif (not Fraunces)
> because it was rendered without internet access to pull the web font. It
> reads cleanly and on-brand, but if you want pixel-perfect Fraunces later,
> the easiest path is to screenshot the live `lockup-horizontal` once the
> site is up and crop it to 1200×630.

## 3. Paste this into `<head>` of nexlite_digital.html

Add it near the existing `<meta name="description">` tag. Paths are
relative on purpose — this keeps working whether the site ends up at the
domain root or nested under a GitHub Pages project path like
`username.github.io/repo-name/`.

```html
<!-- Favicons -->
<link rel="icon" type="image/x-icon" href="assets/icons/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="assets/icons/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="assets/icons/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="assets/icons/apple-touch-icon.png">
<link rel="mask-icon" href="assets/icons/safari-pinned-tab.svg" color="#E8A33D">
<link rel="manifest" href="site.webmanifest">
<meta name="theme-color" content="#0B1F1A">

<!-- Open Graph / link previews -->
<meta property="og:type" content="website">
<meta property="og:title" content="NEXLITE-DIGITAL-SOLUTIONS-LIMITED — Software Built for African Business">
<meta property="og:description" content="Practical, offline-first software for African businesses — depot management, learning tools, and more.">
<meta property="og:image" content="https://REPLACE-WITH-YOUR-SITE-URL/assets/og/og-image.png">
<meta property="og:url" content="https://REPLACE-WITH-YOUR-SITE-URL/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="NEXLITE-DIGITAL-SOLUTIONS-LIMITED">
<meta name="twitter:description" content="Practical, offline-first software for African businesses.">
<meta name="twitter:image" content="https://REPLACE-WITH-YOUR-SITE-URL/assets/og/og-image.png">
```

**Important:** `og:image` and `og:url` must be full absolute URLs (WhatsApp,
Facebook, etc. won't fetch a relative path). Once you know the live URL —
e.g. `https://nexlite-digital.github.io/` or a custom domain — replace
`REPLACE-WITH-YOUR-SITE-URL` in both places.

## 4. Pushing to GitHub

```bash
git add nexlite_digital.html site.webmanifest assets/
git commit -m "Add Nexlite brand icons, manifest, and social preview image"
git push
```

If this is a GitHub Pages **project** site (repo not named
`username.github.io`), double check Settings → Pages is pointed at the
right branch/folder, and that the live URL includes the repo name in the
path — that's the URL you put in step 3.

## 5. Quick sanity checks once it's live

- View page source → confirm the favicon loads in the browser tab.
- Open the site on a phone → "Add to Home Screen" → confirm the app icon
  isn't a generic browser icon.
- Paste the live URL into the Facebook Sharing Debugger or
  https://www.opengraph.xyz/ to confirm `og-image.png` shows up correctly
  (these tools can take a minute to pick up a brand-new page).
