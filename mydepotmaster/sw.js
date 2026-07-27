// ── MDM Service Worker — offline-first ──────────────────────────────────────
// Registered from same origin (not blob URL) so Android Chrome can
// intercept navigation requests and serve the shell when offline.
//
// Strategy:
//   navigate requests  → network-first (always try latest; fall back to cache)
//   Google Fonts       → cache-first (stale-while-revalidate)
//   Firebase REST      → network-only (never cache auth/data requests)
//   everything else    → pass-through (network only)
//
// Update flow:
//   1. New SW installs → skipWaiting() fires immediately (always)
//   2. activate purges old caches → clients.claim() takes over all tabs
//   3. SW posts { type:'NEW_VERSION', version:CACHE } to every open tab
//   4. index.html listener: Median → clears webview cache + hard reload
//                           Browser → shows update toast
//
// Median note:
//   Median's webview caches the HTML shell independently of the SW cache.
//   To guarantee Median users always get the latest version:
//   - index.html stamps every URL with ?_mv=<VERSION> and forces a reload
//     if the stamp is missing or outdated (medianUpdateCheck IIFE).
//   - The SW strips _mv from cache keys so ?_mv=mdm-v22 and the bare URL
//     resolve to the same cached entry — no double-fetching.
//   - On activate the SW posts NEW_VERSION → index.html clears the webview
//     cache and navigates to the stamped URL.
//
// Current version: v64 (2026-07-09)
//
// v64 changes (2026-07-09) — Crash fix (Staff tab blank/Display Error):
//   - ROOT CAUSE: in renderStaffLogs(), the per-staff cumulative running-
//     total map (cumMap) was rebuilt from approved entries only (v61
//     approval workflow). But the fallback used when a log had no entry
//     in that map — i.e. any PENDING log — was `{cumBags:0,cumNet:0}`,
//     while the render code actually reads `cum.cumQty` and `cum.cumUnit`.
//     Neither key existed on the fallback, so `cum.cumQty.toLocaleString()`
//     threw "Cannot read properties of undefined (reading 'toLocaleString')"
//     the moment any pending staff log existed — blanking the Staff tab
//     (and, via the app shell/SW interaction, sometimes the whole page).
//   - FIX: fallback corrected to `{cumQty:0,cumNet:0,cumUnit:''}` to match
//     what's actually read.
//   - Audited all other cumulative maps (general/commodity received &
//     issued) for the same class of bug — none found; their fallbacks are
//     plain `||0` against numbers, which is safe.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v63 changes (2026-07-09) — License activation not being picked up:
//   - ROOT CAUSE: checkLicense() only ever ran at the 3 login call-sites
//     (password login, quick/biometric login, session auto-restore). A
//     device that stayed logged in never re-fetched /licenses/{depotKey},
//     so activating/upgrading a customer in Firebase while their app was
//     already open went unnoticed until they fully logged out and back in.
//   - FIX 1: added a 🔄 refresh control on the trial/subscription banner
//     and on Settings → License & Connection, which calls checkLicense()
//     immediately and toasts the result (still trial / now active / etc).
//   - FIX 2: added a throttled automatic re-check (at most once every 5
//     min) on `visibilitychange`, so simply switching back to the app
//     after paying picks up the change without any manual action.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v62 changes (2026-07-09) — Approval workflow fixes:
//   - FIX: a rejected clock-in was still showing a green "🟢 ACTIVE" badge
//     and offering admin a "Clock Out" button, contradicting the REJECTED
//     badge. A rejected staff log is no longer treated as an active shift.
//   - FIX: rejection reason was only in a hover `title` attribute, invisible
//     on mobile (no hover). It's now shown as visible text under the
//     ❌ REJECTED badge on every list (received/issued/stock counts/
//     transport/staff logs/payments/leave), for staff and admin alike.
//   - FIX: the Pending Approvals modal kept showing already-actioned
//     entries until manually closed and reopened. Approve/Reject now
//     refreshes the list in place immediately.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v61 changes (2026-07-09) — Entry Approval Workflow:
//   - NEW: every entry created by a non-admin (staff/data-entry) account —
//     general received/issued, general stock counts, commodity
//     received/issued/stock counts, transport log, staff clock-in/work log,
//     staff payments, and leave/absence entries — is now stamped 'pending'
//     instead of joining official company data immediately.
//   - Pending entries still show in the account that created them (and to
//     admin) with a ⏳ PENDING badge, but are excluded from every balance,
//     stock-availability, sales, credit/debt, payroll, P&L and Cash Flow
//     calculation until approved.
//   - Admin gets a "Pending Approvals" screen (banner on Dashboard when
//     items are waiting → openPendingApprovalsModal()) to Approve or
//     Reject each entry, with an optional rejection reason shown to the
//     staff member (❌ REJECTED badge).
//   - Admin-created entries are approved immediately — no change to admin
//     workflow.
//   - Edits to existing records were already admin-only before this change
//     and remain so; this release only affects newly created entries.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v60 changes (2026-07-08):
//   - Cleanup: removed a dead `waMsg` per-tier WhatsApp message builder in
//     renderPaymentSection() (Settings → My Plan). It was leftover from
//     before the in-app "Apply to Upgrade" flow existed and was never
//     referenced — buttons already open openSubscriptionForm(), which
//     submits structured data straight to subscriptionRequests/ for the
//     admin panel. No behavior change; just removes confusing dead code.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v59 changes (2026-07-08):
//   - Fix: Settings → My Plan wrongly marked the Pro card as your "CURRENT"
//     plan while on trial (since trial grants pro-equivalent feature access),
//     which hid the "Apply to Upgrade" button — leaving no way to actually
//     apply for Pro during the trial. renderPaymentSection() now only treats
//     a tier as current when there's a real paid subscription (status
//     'active' or 'expired_grace'); trial/free/expired show no tier as
//     current, so Starter, Growth, and Pro all keep their upgrade buttons.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v58 changes (2026-07-08):
//   - Fix: "Clear all data" (Settings → Danger Zone) wiped local data but
//     never pushed the change to the cloud — unlike every other delete in
//     the app, it didn't call scheduleFbSync(). The old data could sit in
//     Firebase until the next 5-minute periodic sync or a manual "Upload to
//     Cloud" tap, and another logged-in account could even pull the stale
//     un-cleared data back down in the meantime. clearAll() now pushes
//     immediately, same as every individual record delete.
//   - No sw.js fetch/cache logic changes — bump only.
//
// v57 changes (2026-07-08):
//   - Fix: multi-account Firebase sync used _v (a per-device local edit
//     counter) to decide which copy of the data was "newer". Since each
//     device/account increments its own _v independently, a device with more
//     historical edits could show a higher _v than a device holding the
//     actual most recent change — so deletes and other edits made from a
//     data-entry account (e.g. sdc1, sdc2) could be silently discarded by
//     other logged-in accounts, or even overwritten back into the cloud.
//     Sync now stamps every write with a Firebase SERVER timestamp
//     (_syncTs) and compares against that shared clock instead. Falls back
//     to the old _v comparison only once, for cloud data written before
//     this fix shipped.
//   - Added a 60-second background pull while a session is open (previously
//     the app only pulled from the cloud at login and pushed every 5
//     minutes, so an already-logged-in account could go a long time without
//     seeing another account's changes). Skipped automatically while a
//     modal is open so it never interrupts active data entry.
//   - Non-admin (data-entry/staff) accounts now get their own Settings tab
//     — previously hidden from them entirely. Scoped to only what's
//     relevant for them: display preferences, dashboard widgets,
//     fingerprint login, stay-signed-in, their own password, help/legal —
//     not company-wide, billing, or destructive admin controls.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v56 changes (2026-07-05):
//   - Added Depot Copilot: Pro-tier AI assistant (🤖 FAB) for stock/staff
//     Q&A and a Fable-5-powered end-of-day/period reconciliation, proxied
//     through a new Cloudflare Worker (depot-copilot-worker.js) so the
//     Anthropic API key never lives in client code. CSP connect-src
//     extended to allow the worker origin once deployed. No sw.js cache
//     logic changes — bump only, so the new index.html JS is fetched
//     instead of served from the old cached shell.
//
// v55 changes (2026-07-03):
//   - Fix: clicking anything that re-rendered the current tab (adding,
//     editing, or deleting a record) reset scroll position to the top of
//     the page. render() now preserves scroll across data-driven re-renders
//     and only jumps to top on an actual tab switch (showTab).
//   - Added fixed monthly salary support for staff, alongside the existing
//     task/rate-based pay. New Pay Type field (+ Monthly Salary amount) in
//     Register Staff and Edit Staff Details. Salaried staff can still clock
//     in/out for attendance without accruing task-rate earnings. Payslips
//     for salaried staff use the fixed monthly amount, prorated for partial
//     months (joined/left mid-month); deductions still apply as before.
//     P&L and Cash Flow now include prorated salaried-staff cost for the
//     selected period. Staff tab's Earnings and Roster views show a SALARY
//     badge and the monthly amount instead of a misleading K0.
//
// v54 changes (2026-06-30):
//   - Branding in all prints: company logo and brand colour now appear on
//     every print surface (sale receipts, payslips, period summary, audit
//     log, CSV/data exports, books PDF, staff ID cards). New
//     _getBrandedHeader() helper reads di.logoDataUrl and di.brandColor;
//     shows logo image if uploaded, else a coloured initials box. CSS var
//     --accent injected into _pdfPrint() so table accents, borders, and
//     highlights all follow the depot's colour. Feature gate removed from
//     ID card print — stored logo/colour always prints regardless of tier.
//   - Sales tab gated to Pro plan. Free/Starter/Growth users see a lock
//     screen with upgrade prompt. daily_sales added to TIER_FEATURES.pro.
//     Sales tab button shows 🔒 for non-pro tiers.
//   - Inline "＋ New Customer" in issue form. Tapping the link opens a
//     name + phone panel inside the modal; "✓ Save & Select Customer"
//     creates the contact in DATA.contacts, logs to audit trail, and
//     auto-selects the new customer in the dropdown — no form re-open
//     needed. Duplicate names reuse the existing contact instead.
//
// v53 changes (2026-06-28):
//   - Payment details: Airtel Money number changed to +260 977 638 790 in the
//     subscription application form, the upgrade prompt screen, and the
//     copy-to-clipboard value. MTN MoMo number unchanged.
//   - Trading name updated: payment method labels ("MDM Developer" →
//     "Spike Trading and General Dealers"), Terms of Service (§1 Acceptance,
//     §7 Intellectual Property), Privacy Policy (§1 Who We Are), and both
//     modal footer copyright lines now read NEXLITE-DIGITAL-SOLUTIONS-LIMITED
//     (trading as Spike Trading and General Dealers) in place of
//     "Digital Frontier Technologies". Legal entity name unchanged.
//
// v52 changes (2026-06-28):
//   - Fix: Sales tab button not responding to taps. 'sales' was missing from
//     the gtab listener array in attachTabListeners(), so no click handler was
//     ever registered for #gtab-sales. Added 'sales' between 'issued' and
//     'stockcount' in the forEach list.
//   - Admin panel: subscription applications now received and actionable.
//     MDM app writes to subscriptionRequests/<installId>/<timestamp> but the
//     admin panel only read licenses/ — applications were silently lost.
//     Admin now loads subscriptionRequests/ in parallel with licenses/ on
//     every refresh. A "📋 Subscription Applications" section (with pulsing
//     badge count) appears above the depot list whenever pending requests
//     exist. Each card shows depot name, phone (tap-to-call), payment method,
//     transaction ID, and submission time, with three action buttons:
//     → Trial (sets status:trial), → Active (sets status:active with correct
//     tier + 30-day activeUntil), ✕ Dismiss (marks request dismissed without
//     touching the license). Field mapping fixed: MDM sends `phone`, admin
//     now reads phone || contactPhone when writing to licenses/.
//     Firebase rules note added to admin config block — subscriptionRequests
//     node must allow unauthenticated read/write per $installId.
//
// v51 changes (2026-06-28):
//   - Font stack updated: DM Sans → IBM Plex Sans, DM Mono → IBM Plex Mono.
//     Provides a more authoritative financial/data-entry feel throughout the app.
//     Syne (headings) retained. FONTS_CSS updated to match new Google Fonts URL.
//   - Customer linking: sales/issue transactions now accept an optional customer
//     from DATA.contacts (type=customer). customerId + customerName stored on
//     each generalIssued record. Customer column added to Issued and Daily Sales
//     tables. Customer name appears on printed receipts. Contacts tab customer
//     cards gain a 🧾 History button showing all linked transactions, total
//     spend, and outstanding credit. Debtor card shows customer name inline.
//     Cache bump only for sw.js — no SW logic changes.
//
// v50 changes (2026-06-24):
//   - Fix: when "Stay Signed In" is enabled on a device, inactivity
//     auto-logout is now fully disabled. _idleReset() returns early and
//     clears any pending timers if _checkStaySignedIn() returns a valid
//     session. The user is only logged out by an explicit Sign Out action
//     or by disabling the "Stay Signed In" toggle. The Settings card
//     description is updated to reflect this behaviour.
//   - Cache version bump to align sw.js with index.html v49 deploy.
//
// v49 changes (2026-06-21):
//   - Median appConfig hardened: keepScreenOn, portrait lock, PDF/CSV
//     downloads to public storage, tel/mailto/wa.me external routing,
//     pull-to-refresh disabled, Android hardware back confirm-exit,
//     allowInsecure:false, androidWebviewTextZoom:100.
//     No sw.js logic changes; cache bump only.
//
// v48 changes (2026-06-21):
//   - Fix: login delay (30+ seconds, spread evenly across steps). Root cause:
//     _getAppCheckToken() is called fresh before every single Firebase
//     request, and one login makes 5-6 sequential Firebase calls (lockout
//     check, username lookup, auth lookup, depot data restore, lockout
//     clear, post-login cloud restore). When the reCAPTCHA→App Check token
//     exchange is failing (it currently is — see Firebase Console App Check
//     metrics, 0% verified), each of those 5-6 calls independently re-paid
//     the full ~20s reCAPTCHA+exchange timeout before falling through to
//     "no token" and proceeding. Added a 30s negative cache: once the
//     exchange fails once, subsequent calls within that window return null
//     immediately instead of retrying, so only the first call in a login
//     pays the timeout cost. Does not fix the underlying App Check failure
//     itself (still being diagnosed via ?acdebug=1) — only bounds its cost.
//
// v47 changes (2026-06-21):
//   - New Settings → "Stay Signed In" toggle (off by default). Per-device,
//     opt-in: when on, skips the login screen on app relaunch for up to a
//     user-chosen number of days (7/14/30/60/90). Stores ONLY username +
//     expiry timestamp in localStorage — never a password or hash — so a
//     copied localStorage value can skip the login screen on that one
//     device only, never be replayed elsewhere or used to derive
//     credentials. Any explicit logout (button or remote cross-tab logout)
//     immediately revokes the persisted session; turning the toggle off
//     does the same. When "Stay Signed In" is active, inactivity
//     auto-logout is suppressed — the timers are not started so the user
//     is never kicked out involuntarily while the feature is enabled.
//
// v46 changes (2026-06-21):
//   - Cache version bump only (debug build for App Check diagnostics).
//
// v45 changes (2026-06-21):
//   - Security: login now verifies the password against a small new
//     depots/<id>/auth record (just username/passwordHash/role) BEFORE
//     fetching the full depot dataset. Previously the entire depot — every
//     commodity, staff record, transaction, and financial figure — was
//     downloaded as part of resolving the login, even on a wrong password.
//     The auth record is kept in sync automatically on every doFbSync() call
//     (derived from DATA.users) and written immediately at signup. Existing
//     depots self-migrate on their next sync; until then, login falls back
//     to the old full-data verification path with no behavior change.
//
// v44 changes (2026-06-21):
//   - Fix: login could hang forever with zero feedback on a slow/flaky
//     connection. _getAppCheckToken() (called before every Firebase request,
//     including the brute-force lockout check that runs first on login) had
//     no timeout on its reCAPTCHA promise or token-exchange fetch — both now
//     bounded to 10s and degrade gracefully like the rest of the Firebase
//     helpers. doLogin() also now validates the ToS checkbox and updates the
//     button to "Checking…" BEFORE making any network call, so a tap always
//     gives instant visual feedback instead of looking unresponsive.
//
// v43 changes (2026-06-21):
//   - Firebase App Check (reCAPTCHA v3) integrated. All Firebase REST calls
//     (fbGet, fbSet, fbSetIfNotExists, fbDelete) now attach an
//     X-Firebase-AppCheck token. Token is fetched from reCAPTCHA v3 and
//     exchanged via firebaseappcheck.googleapis.com, cached until near-expiry.
//     Degrades silently if reCAPTCHA hasn't loaded (offline start). CSP
//     updated to allow reCAPTCHA and App Check domains.
//
// v31 changes (2026-06-20):
//   - General-tab inventory item types now capped, in parallel with (but
//     independent from) the existing Commodity tab cap: Free = 1 item type,
//     Starter = 3, Growth+ = unlimited. Enforced at both entry points that
//     write to DATA.inventoryItems — the Manage Inventory Items modal and
//     the General tab's Item Names subtab — each swapping the add-form for
//     an upgrade card when the depot is at its limit.
//
// v30 changes (2026-06-20):
//   - Numeric tier caps now enforced (previously labels only). Free: 1 staff,
//     1 commodity type, 30-day visible history, contacts view-only (removed
//     contacts_edit from Free — was incorrectly granted before this release).
//     Starter: 5 staff, 3 commodity types, 90-day history, contacts editable
//     up to 50. Growth/Pro/Multi-Site remain unlimited on all four. Checked
//     at the point of creation (staff/commodity/contact add) with a
//     dedicated "limit reached" upgrade prompt, and at the point of display
//     for history (filterPeriod now clamps every period — including "All"
//     and custom date ranges — to the tier's visible-history window).
//
// v29 changes (2026-06-20):
//   - New Starter tier (K90/mo) inserted between Free and Growth in the
//     tiered licensing system. Same feature set as Free (no cloud sync,
//     exports, or reports) — raises numeric ceilings only: 5 staff profiles,
//     3 commodity types, 90-day visible history, edit up to 50 contacts.
//     Cap enforcement itself is not yet wired up; this release only adds
//     the tier to TIER_ORDER/TIER_META/_TIER_BULLETS and updates every
//     tier-aware UI surface (landing pricing ladder, upgrade modal, admin
//     payment panel, account status screen) to display and price it.
//   - Legal/identity update: Terms of Service, Privacy Policy, and the
//     Settings screen footer now name the NAPSA-registered company,
//     NEXLITE-DIGITAL-SOLUTIONS-LIMITED (trading as Digital Frontier
//     Technologies), as the operating entity in place of "MDM Developer."
//
// v28 changes (2026-06-12):
//   - Price per month updated from K100 to K300.
//   - Fix 13: Cross-tab logout synchronisation via BroadcastChannel (with
//     localStorage storage-event fallback for Safari <15.4). Logging out in
//     any tab now immediately logs out all other open tabs.
//   - Fix 14: SubtleCrypto (PBKDF2) fallback to mdm1 disabled for new
//     passwords. hashPassword now throws with a user-facing toast when
//     crypto.subtle.deriveBits is unavailable instead of silently falling
//     back to the weaker custom stretch algorithm. Legacy mdm1 hashes are
//     still accepted by verifyPassword for backward compatibility.
//
// v27 changes (2026-06-12):
//   - Fix 30: Dashboard Widget Customisation. New "Dashboard Widgets" section
//     in Settings lets users show/hide any of the 8 dashboard sections via
//     toggle switches: Alerts & Warnings, Quick Actions, Today Snapshot,
//     Commodities, Inventory Balances, Staff Summary, Recent Activity, Recent
//     Books. Preferences stored in localStorage (per-device, not cloud-synced).
//     All widgets default to on. "↺ Show All Widgets" reset button restores
//     all. Each toggle re-renders the dashboard instantly with a toast.
//
// v26 changes (2026-06-12):
//   - Fix 29: Staff ID Card Generator. "🪪 Print ID Card" button added to
//     every staff profile modal. Opens a print-ready pop-up with front and
//     back of a credit-card-sized ID card (85.6 × 54 mm). Front: initials
//     avatar, name, role, phone, date joined, location, colour-coded contract
//     type badge, employee ID, live status indicator. Back: emergency contact,
//     company info, employee ID in barcode style, authorised signature line.
//     Fully offline — pure HTML/CSS, no external dependencies.
//
// v25 changes (2026-06-12):
//   - Cloud upload/download icons on every nav tab. Two small SVG cloud
//     buttons per tab: ↑ Upload (doFbSync) and ↓ Download (version-gated
//     pull with confirm). Fade on hover; always visible on active tab;
//     45% opacity on inactive tabs on touch. Spins while syncing.
//   - Fix 27: First-Run Onboarding Checklist. 5-step modal auto-appears
//     after first admin login. Steps auto-check from live DATA state.
//     Navigates to relevant tab on tap. Permanently dismissible.
//     Re-openable from Settings → Help & Documentation.
//   - Fix 28: Inline ℹ️ Tooltips. mdmTip() helper with smart-positioned
//     singleton popup. 15 tooltips across key fields: Currency, Shift Hours,
//     Annual Leave, Edit Window, Auto-Logout, Recovery PIN, Purchase Price,
//     Selling Price, Batch Name, Deduction, Budget fields, and more.
//
// v24 changes (2026-06-11):
//   - Two-Stage Shift Log: "Log Work" button split into ⏵ Clock In and
//     ✏️ Manual. Clock In (Stage 1) saves an open shift with status:'open',
//     timeInTs, staff, role, task, date, time-in. Clock Out (Stage 2)
//     completes the shift: adds time-out, qty, earnings, deductions, notes,
//     sets status:'completed' + timeOutTs. Open shifts show a pulsing
//     🟢 ACTIVE badge and inline ⏹ Clock Out button in the logs table.
//     Active-shifts banner at top of logs lists all open shifts.
//     Duplicate open-shift guard blocks double clock-in with redirect to
//     Clock Out. Edit-window calculation now anchors to timeOutTs instead
//     of uid creation time for completed staff logs. Migration on load tags
//     all legacy logs as status:'completed' with timeOutTs from uid timestamp.
//   - Hotfix: missing `function openLogForm(){` declaration (eaten by str_replace
//     anchor) caused a parse-time SyntaxError → blank dark screen on load.
//
// v23 changes (2026-06-11):
//   - PC/tablet nav moved from left sidebar to bottom tab bar.
//     Tabs display icon + label side-by-side (row layout), 64px tall,
//     max 140px wide per tab, centred across full width. Active tab
//     retains green top-border indicator. Content area uses full screen
//     width with 28–40px horizontal padding. Book editor unlocked from
//     480px cap on PC. Extra-wide (≥1200px) breakpoint bumped to 68px
//     tab height and 40px content padding.
//
// v22 changes (2026-06-11):
//   - Light theme purified: all hardcoded dark hex backgrounds (#0a1628,
//     #001a2e, #002b1f, #081428, #0d1a40, #1a0d2e, #0d2a00, #2a1500,
//     #3d1515) replaced with CSS variables (var(--surface),
//     var(--overlay-dark-1), rgba tints). Screen gradients now use
//     var(--surface2). fs-mini, gsearch-overlay, pay-row, unp-row,
//     role badges, activity icons, error boxes and all JS-rendered cards
//     are theme-aware. Quick-action buttons get body.light tint classes.
//
// v21 changes (2026-06-11):
//   - Fix 23: Supplier picker added to General and Commodity receive forms.
//     supplierId + supplierName stored on every receive record; Supplier
//     Performance tab now auto-links without manual name matching.
//   - Fix 24: Vehicle / Transport Log added as new 🚛 Transport subtab inside
//     the Commodity tab. Fields: date, vehicle, driver, route, trip type,
//     cost, notes. Includes CSV export.
//   - Fix 25: Batch/lot traceability on commodity issues. Issue form shows
//     Source Receive Record dropdown (filtered by batch, shows date/qty/supplier).
//     sourceReceiveId stored on issue records. 🔍 Trace button on issue rows
//     opens a modal showing the full issue → receive chain with supplier details.
//
// v20 changes (2026-06-10):
//   - Fix 19: Credit/debt tracking on issue and receive records.
//     Issue form now captures payment status (paid/partial/credit) and
//     partial amount paid. Outstanding credit card shows all open debts.
//     Receive form captures supplier payment status (paid/partial/credit).
//   - Fix 20: Consolidated Profit & Loss view added as new P&L subtab
//     in the General tab. Shows revenue, COGS, gross profit, staff costs,
//     and net profit for the selected period, with a full COGS breakdown.
//
// v19 changes (2026-06-10):
//   - (index-4 release — see index.html changelog)
//
// v18 changes (2026-06-09):
//   - fbRestoreData now merges users instead of overwriting: cloud is
//     authoritative for users it knows, but local-only users (sub-users added
//     while offline or before sync caught up) are never dropped.
//
// v17 changes (2026-06-09):
//   - Any account from any depot can now log in on any device (no device binding).
//   - Pre-login restore always looks up username in Firebase usernames/ index first
//     to resolve the correct depot installId, then restores that depot's data.
//
// v16 changes (2026-06-09):
//   - Pre-login restore now always runs (not only when DATA.users is empty).
//   - On brand-new device/fresh install: looks up username in Firebase
//     usernames/ index to discover installId, then does a full depot restore.
//
// v15 changes (2026-06-09):
//   - Removed Depot Key as a recovery method entirely.
//   - Recovery is now PIN and email only.
//
// v14 changes (2026-06-09):
//   - Pre-login cloud restore when DATA.users is empty on fresh install.
//   - Better login error message when no local data exists on device.

// ────────────────────────────────────────────────────────────────────────────

const CACHE     = 'mdm-v67';   // ← bump this whenever you deploy a new version
const SHELL     = './';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@600;700;800&display=swap';

// ── HELPERS ──────────────────────────────────────────────────────────────────

// Strip _mv query param from a URL so cached entries are found regardless of
// whether the URL was stamped by the Median update check or not.
function stripMv(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('_mv');
    return u.toString();
  } catch (e) {
    return url;
  }
}

// Build a cache Request with the _mv param removed (used as the cache key).
function cacheKey(request) {
  const clean = stripMv(request.url);
  return clean === request.url ? request : new Request(clean, { mode: 'same-origin' });
}

function cacheFirst(req) {
  const key = cacheKey(req);
  return caches.match(key).then(cached => {
    // Serve cached immediately; revalidate in background (stale-while-revalidate)
    const revalidate = fetch(req).then(r => {
      if (r && r.ok) caches.open(CACHE).then(c => c.put(key, r.clone()));
      return r;
    }).catch(() => {});
    return cached || revalidate;
  });
}

function networkFirst(req) {
  const key = cacheKey(req);
  return fetch(req)
    .then(r => {
      if (r && r.ok) caches.open(CACHE).then(ca => ca.put(key, r.clone()));
      return r;
    })
    .catch(() => caches.match(key).then(cached => cached || caches.match(SHELL)));
}

// ── INSTALL: pre-cache the app shell ────────────────────────────────────────
// skipWaiting() is called unconditionally so a new SW always activates
// immediately — critical for Median where there may be no tab close/reopen.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.add(SHELL)                         // shell always first
        .then(() => cache.add('manifest.json').catch(() => {})) // manifest (best-effort)
        .then(() => cache.add(FONTS_CSS).catch(() => {}))       // fonts (best-effort, may fail offline)
      )
      .finally(() => self.skipWaiting())   // always activate immediately
  );
});

// ── ACTIVATE: claim clients, purge old caches, notify tabs ──────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => {
        // Notify every open tab → index.html will handle Median reload or show toast
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(clients => {
            clients.forEach(client =>
              client.postMessage({ type: 'NEW_VERSION', version: CACHE })
            );
          });
      })
  );
});

// ── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;

  // Only handle GET — never intercept POST/PUT/DELETE (Firebase writes must go to network)
  if (req.method !== 'GET') return;

  // Firebase REST & auth endpoints — network-only, never cache
  // Caching auth/data responses would serve stale license or data reads offline
  if (
    url.includes('firebaseio.com') ||
    url.includes('googleapis.com/identitytoolkit') ||
    url.includes('securetoken.googleapis.com') ||
    url.includes('firebaseinstallations') ||
    url.includes('firebase')
  ) {
    // Let the browser handle it; offline queue in index.html handles write failures
    return;
  }

  // Navigation requests (loading the app shell) — network-first
  // Strips _mv before storing so both stamped and unstamped URLs hit the same entry.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => {
          if (r && r.ok) {
            caches.open(CACHE).then(ca => ca.put(cacheKey(req), r.clone()));
          }
          return r;
        })
        .catch(() =>
          caches.match(cacheKey(req))
            .then(cached => cached || caches.match(SHELL))
        )
    );
    return;
  }

  // Google Fonts — cache-first (stale-while-revalidate)
  if (url.includes('fonts.gstatic.com') || url.includes('fonts.googleapis.com')) {
    e.respondWith(cacheFirst(req));
    return;
  }

  // manifest.json — network-first with cache fallback
  if (url.includes('manifest.json')) {
    e.respondWith(networkFirst(req));
    return;
  }

  // Everything else — pass through to network
});
