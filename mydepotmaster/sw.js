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
// Current version: v100 (2026-08-23)
//
// v100 changes (2026-08-23) — Role Work History: show tasks with no logs:
//   - A task under a role (e.g. "Loader" under the Loading role) with zero
//     logged entries so far was silently dropped from its role's Role
//     History section — admins had no way to see it existed as a defined
//     sub-role until someone logged work under it.
//   - Every task defined on a role now always shows as its own sub-role
//     section, even with zero entries — it just shows "No entries logged
//     under this task yet." when expanded, instead of not appearing at all.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v99 (2026-08-23)
//
// v99 changes (2026-08-23) — Role Work History: nest tasks as sub-roles:
//   - A role can define more than one task at different pay rates (e.g.
//     role "Loading" → tasks "Loader" @K1.70/bag and "Stacking"
//     @K0.90/bag). The Role History report previously merged every task
//     under a role into one combined role-level total, with per-task
//     figures only visible as a flat BY TASK list inside.
//   - Each task under a role is now its own separate sub-role accordion,
//     nested inside the parent role's section, with its own independent
//     BY STAFF, BY DATE, and RECENT ENTRIES breakdown — fully separate
//     from other tasks under the same role rather than folded together.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v98 (2026-08-23)
//
// v98 changes (2026-08-23) — Job Role(s) picker: flat list:
//   - "Job Role(s)" in Register Staff and Edit Staff Details was a
//     flex-wrapped grid of checkbox pills, which gets cramped and hard to
//     scan once several roles are defined (e.g. splitting a combined
//     "Loading" role into separate Loading and Stacking roles). Both
//     pickers now render as a plain flat vertical list — one role per
//     full-width row — instead of wrapped pills. No change to the
//     underlying multi-role selection logic, just the layout.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v97 (2026-08-23)
//
// v97 changes (2026-08-23) — Role Work History: accordion + by-date:
//   - Each role in the "📋 Role History" report (Staff tab) is now its own
//     collapsed accordion section — tap a role's header to expand/collapse
//     it, instead of every role's full breakdown being shown at once in one
//     long combined scroll.
//   - Added a BY DATE breakdown inside each role section: combined totals
//     (entries, quantity, net) per calendar date across all staff logged
//     under that role. Deliberately excludes staff names — it's a pure
//     day-by-day activity total, unlike BY STAFF / RECENT ENTRIES.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v96 (2026-08-23)
//
// v96 changes (2026-08-23) — Combined Role Work History (admin):
//   - Added a "📋 Role History" button to the Staff tab (admin only) that
//     opens a company-wide report grouping every staff member's work log
//     entries by job role (sub-role) instead of by individual staff member.
//     Each role section shows total entries/quantity/net, a per-staff
//     contribution breakdown within that role, a per-task breakdown, and
//     the 10 most recent entries across all staff for that role.
//   - This is separate from the existing per-role section inside an
//     individual staff member's own profile, which only covers that one
//     person's logs across their assigned roles.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v95 (2026-08-19)
//
// v95 changes (2026-08-19) — Hamburger menu + Global Search role scoping:
//   - The hamburger menu showed every row to every role — General
//     Inventory, Commodities, Books, Contacts, Reports & Records (P&L/Cash
//     Flow/Budget), Audit Log, Setup Checklist, Today at a Glance
//     company-wide stats, and Cloud Sync management — even to a Staff login
//     that's view-only and self-scoped everywhere else (showTab() already
//     bounces it back to Dashboard via STAFF_BLOCKED_TABS, and Audit
//     Log/Setup Checklist already refuse non-admins). Tapping those rows
//     just produced a bounce or a refusal alert — confusing dead rows.
//   - Menu rows now hide per-role to match what each account can actually
//     do: Staff no longer sees any of the rows above; Manager/Admin are
//     unaffected except Audit Log and Setup Checklist, which now show for
//     Admin only (matching their existing requireAdmin()/role checks).
//     Synced on login and every time the menu opens, so switching accounts
//     on one device always reflects the current role.
//   - Bigger fix: Global Search (_doGlobalSearch) searched the FULL depot
//     — every staff member, all commodities, all contacts, all General
//     Inventory — regardless of role. This was a real side-door around the
//     Staff role's self-only scoping (same class of bug as the v93/v94
//     Depot Assistant fixes): a Staff login could search for and read
//     anyone else's records even though every tab that data lives on is
//     blocked for that role. Staff logins now only ever search their own
//     staff profile and their own logs; General Inventory, Commodities,
//     and Contacts sections are skipped entirely for that role.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v94 (2026-08-19)
//
// v94 changes (2026-08-19) — Depot Assistant full role scoping:
//   - v93 only fixed account/user-roster leakage. The Assistant still handed
//     a Staff-role login (view-only everywhere else in the app) the FULL
//     depot dataset — every staff member's logs and pay, all inventory,
//     commodities, and financials — plus every data-entry tool (clock
//     in/out, log commodity moves, log payments, etc.), none of which a
//     Staff login can touch anywhere else in the UI.
//   - buildCopilotContext() now branches on role: a Staff login gets ONLY
//     its own linked staff profile, own logs/pay/warnings/leave/attendance
//     (mirrors renderStaffDash's existing self-only scope) — no other staff,
//     no inventory, no commodities, no financials exist in that payload at
//     all. Admin/Manager keep the full operational dataset as before.
//   - Data-entry tools are no longer sent to the model for a Staff login,
//     and _handleAIActionCall() independently refuses to resolve/execute any
//     tool call for that role even if one somehow arrives — belt and
//     suspenders, so no code path can let a view-only account write data
//     through chat.
//   - System prompts updated to explain the new "accessScope" field so the
//     model states plainly it doesn't have other accounts'/staff's data
//     instead of guessing.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v93 (2026-08-19)
//
// v93 changes (2026-08-19) — Depot Assistant account isolation:
//   - Fix: Depot Assistant's context payload sent the FULL user roster
//     (every account's recovery email, phone, linked staff member, role) to
//     whichever account was chatting, regardless of that account's own role.
//     A Staff or Data Entry login could ask "about my account" and get every
//     other account's details.
//   - Now the Assistant is only ever given a single "myAccount" object — the
//     record for the account actually chatting. No other account's data is
//     ever included, admin included; system prompts updated so the model
//     explains it can't see other accounts if asked.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v89 (2026-08-18)
//
// v89 changes (2026-08-18) — Manager/Staff role tiers + self clock-in:
//   - New "Staff" role (in addition to Admin and Manager/Data Entry): a
//     genuinely view-only tier — dashboards, own password, own earnings —
//     that cannot add or edit any records.
//   - Staff logins can now be linked to a specific Staff Profile and clock
//     THEMSELVES in only (no picking another staff member); clocking out
//     stays Admin-only as before.
//   - Self clock-ins by Staff go through the existing pending-approval
//     workflow; that Pending Approvals review is now visible to Managers
//     too, not just Admin.
//   - Login screen now has an on-screen "← Back" button to landing (was
//     missing; hardware back already worked, this adds the visible one).
//   - New "Create Login" shortcut on each staff profile card, pre-filling
//     role=Staff and the linked staff profile.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v81 (2026-08-12)
//
// v81 changes (2026-08-12) — Books editor action bar moved to top:
//   - Save / Download / Print PDF were large full-width buttons pinned to
//     the bottom of the Books editor (easy to lose behind the mobile
//     keyboard, and took up a lot of vertical space). Moved into a compact
//     row directly under the title bar instead, using the small button
//     style — same actions, same ids, just relocated and shrunk.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v80 (2026-08-12)
//
// v80 changes (2026-08-12) — Books pagination + global search navigation fix:
//   - Books (Word docs): editor now shows visible A4-style page breaks as you
//     type instead of one endless block, plus a live "N pages" badge in the
//     header. No actual size cap existed before or after — this was a visual
//     fix so long documents don't feel capped at one page.
//   - Books (Spreadsheets): new "🖨 Print PDF" button exports the grid as a
//     paginated multi-page PDF via the existing print engine, alongside the
//     existing CSV download. Grid itself was already uncapped.
//   - Fix: global search results for Staff, Staff Logs, and Contacts only
//     ever navigated to the parent tab (e.g. tapping a staff member's log
//     just opened the Staff list) instead of opening that specific record.
//     Staff/Staff Log hits now open the matching staff member's profile
//     directly; Contact hits now open that contact's card directly.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v79 (2026-08-07)
//
// v77 changes (2026-08-07) — Install App button:
//   - Settings → Help & Documentation now has an "Install on This Phone" card
//     with a real Install App button, wired to the browser's beforeinstallprompt
//     event (captured in index.html, replayed via .prompt() on tap). Previously
//     the manifest/SW/icons were all in place for installability, but nothing
//     in the UI ever triggered the actual install dialog — users had to
//     discover their browser's own install icon/menu entry on their own.
//   - Button auto-hides once already installed (display-mode: standalone/
//     fullscreen, or iOS's navigator.standalone) or before the browser has
//     signalled the app is installable, with a note explaining how to install
//     manually as a fallback (e.g. iOS Safari, which never fires the event).
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// Current version: v76 (2026-08-06)
//
// v76 changes (2026-08-06) — Depot Assistant proxy fix + graceful overload handling:
//   - Fix: mdm-copilot-proxy Cloudflare Worker was serving stale "Hello
//     World" stub code (never actually deployed with the real proxy logic),
//     and the GEMINI_API_KEY secret had been lost during a Worker
//     deployment-source change. Both root causes together were producing
//     "Failed to fetch" and then HTTP 401 errors in Depot Assistant.
//     Re-deployed the correct worker.js and re-added the secret directly
//     in the Cloudflare dashboard — key itself was never exposed in
//     index.html or chat.
//   - New: _callCopilot now retries once automatically (after a 2s delay)
//     on transient Gemini overload responses (429/500/503) before
//     surfacing any error to the user — most "high demand" spikes now
//     resolve silently.
//   - New: when an error is shown, it now parses the JSON error body and
//     displays the human-readable message field (e.g. "gemini-3.5-flash
//     is currently experiencing high demand...") instead of raw, often
//     truncated JSON.
//
// v75 changes (2026-08-03) — Depot Assistant auth fix + action support:
//   - Fix: Gemini Interactions API calls were sending GEMINI_API_KEY via the
//     x-goog-api-key header, which was intermittently rejected (401
//     "Expected OAuth 2 access token...") with this account's AQ.-format
//     key — while the same key worked fine via a ?key= query param in
//     another app on this same account. Switched to sending the key as a
//     query param as the primary method, with the header kept only as a
//     one-time fallback if that somehow 401s too.
//   - Fix: chat/reconciliation requests could abort with a raw
//     "signal is aborted without reason" browser message on slower mobile
//     connections. Timeout raised to a flat 45s for both modes, and abort
//     errors now show a clear "Request timed out — check your connection
//     and try again" message instead.
//   - Regular chat questions now send a trimmed context (most recent ~150
//     entries per log-style array — staff logs, warnings, payments, leave,
//     attendance, movements, transport, close-outs, audit log) instead of
//     the full dataset, for faster responses over mobile data.
//     Reconciliation still gets the complete, untrimmed dataset.
//   - New: Depot Assistant can propose clocking a staff member in via a
//     clock_in_staff tool call, but only ever as a Confirm/Cancel action in
//     the chat — nothing is written until the user taps Confirm. Reuses the
//     same stampEntry()/logAuditEvent()/updateData() path as the manual
//     Clock In form, so pending-approval workflow and the audit trail
//     behave identically; audit entries are tagged "via Depot Assistant".
//     Reconciliation mode has no tool access — read-only analysis only.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v74 changes (2026-08-03) — stale-shell fix + login hardening:
//   - Navigate fetch now uses { cache: 'no-store' } instead of a plain
//     fetch(). "Network-first" only helps if the request actually reaches
//     the network — a plain fetch() still honors normal HTTP caching, so a
//     host sending cache-control headers on index.html could hand back a
//     stale response even though the SW "tried the network first". This
//     was likely why login fixes shipped in index.html weren't reaching
//     devices on redeploy without a manual cache clear.
//   - index.html: fbAuthSignIn/fbAuthSignUp now wrapped in the same
//     10s-timeout pattern as fbGet/fbSet, so a stalled Firebase Auth SDK
//     call can no longer hang doLogin() on "Verifying…" forever.
//   - index.html: doLogin() same-depot restore path now forces one
//     unconditional cloud re-fetch/merge if the usernames/ index confirms
//     an account belongs to this depot but it's still missing locally
//     after the normal version-gated restore — fixes sub-user accounts
//     that silently could never log in on a given device.
//
// Current version: v73 (2026-08-02)
//
// v73 changes (2026-08-02) — rate-change security, Depot Assistant (Gemini), OT fix:
//   - Security: changing a staff task's pay rate, rate unit, or custom unit
//     in Roles & Rates now requires the admin password confirmation modal
//     (requireAdminPassword), not just admin role — matching every other
//     destructive/sensitive admin action in the app.
//   - Depot Copilot replaced with Depot Assistant, powered by Gemini instead
//     of the Cloudflare Worker + Anthropic proxy. Calls Google's Gemini API
//     directly from the browser via the Interactions API (generativelanguage.
//     googleapis.com/v1beta/interactions) using a client-side GEMINI_API_KEY.
//     Now has full data access (staff, commodities, stock movements,
//     payments, attendance, transport, budgets, audit log) rather than a
//     capped/summarized snapshot — excluding password hashes and the
//     recovery PIN, which never leave the device. CSP connect-src updated
//     to allow generativelanguage.googleapis.com; the old worker-subdomain
//     placeholder origin removed.
//   - Fix: Overtime multiplier dropdown (Log Task and Complete Shift forms)
//     defaulted to "× 1.5 — Time & a half" selected in the HTML, so gross
//     pay was multiplied by 1.5 even when the OT section was hidden and no
//     actual overtime had been detected from time in/out (e.g. both fields
//     left blank). Default changed to "× 1.0 — No extra OT pay", and the
//     dropdown now explicitly resets to 1 whenever the calculated hours no
//     longer exceed the depot's Standard Shift Hours setting.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v72 changes (2026-07-28) — signup ordering fix for Phase 4 readiness:
//   - Reordered admin signup: Firebase Auth account creation + Phase 3's
//     authorizedUids grant now happen BEFORE the depots/{id}/auth write,
//     not after. Previously the depots write went out unauthenticated
//     (before any UID existed for that depot), which works fine against
//     open rules but would reject every new signup once Phase 4's depots
//     rule requires auth.uid ∈ authorizedUids. No behavior change while
//     depots stays open — this only matters once that rule ships.
//
// v71 changes (2026-07-28) — Phase 3 & 5: ownership records + admin auth:
//   - Phase 3: new _grantAuthorizedUid(installId, uid) writes
//     depots/{installId}/authorizedUids/{uid}: true whenever a UID is
//     confirmed for a depot — at signup, sub-user creation, and both
//     login-time migration paths (already-Auth-confirmed backfill, and
//     silent migration on legacy-verified login). This is the record
//     Phase 4's tightened depots rule will check against once published;
//     it does nothing on its own until that rule ships.
//   - Phase 5 (mdm-admin.html only, not index.html, but versioned together
//     since they deploy as one release): admin panel login now goes through
//     real Firebase Auth (signInWithEmailAndPassword) instead of a
//     client-side SHA-256 password comparison. Every fbGet/fbPatch/fbDelete
//     in the admin panel now attaches the operator's ID token the same way
//     index.html's v70 change did for the main app.
//   - No rules changes shipped with this version — licenses and
//     subscriptionRequests operator-gating rules are published separately
//     once the admin panel above is confirmed working with the new login.
//   - depots deliberately NOT gated in this version — still open. Gating it
//     now would strand any account that hasn't completed the Phase 1 login
//     migration yet, since an unmigrated account has no auth.uid at all
//     during its own legacy-verification read. Held until migration
//     coverage is confirmed near-total.
//
// v70 changes (2026-07-27) — Phase 2: authenticated RTDB requests:
//   - fbAuthSignUp/fbAuthSignIn now go through the Firebase Auth SDK (loaded
//     via CDN — firebase-app-compat.js + firebase-auth-compat.js, deferred —
//     see index.html <head>) instead of hand-rolled Identity Toolkit REST
//     calls. The SDK persists the session and refreshes ID tokens silently
//     in the background (they expire hourly), which is what this phase
//     needed — reimplementing that with raw refresh-token REST calls would
//     just be a worse version of what the SDK already does.
//   - Every fbGet/fbSet/fbSetIfNotExists/fbDelete call now attaches
//     ?auth=<idToken> when a Firebase Auth session exists (_getIdToken()).
//     No rules changed yet, so this doesn't restrict anything on its own —
//     it just means requests are *carrying* proof of identity, ready for
//     Phase 4 to actually require it. A request with no Auth session (not
//     yet migrated, or the SDK failed to load) simply goes out
//     unauthenticated, exactly as every request did before this phase.
//   - Realtime Database and App Check both stay on the existing REST API —
//     only Auth itself moved to the SDK.
//   - Logout (_doLogoutNow) now also clears the Auth SDK session
//     (fbAuthSignOutSilently), so no stale token lingers into the next login
//     on a shared device.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v69 changes (2026-07-27) — Phase 1: Firebase Auth migration:
//   - Real Firebase Authentication accounts now exist alongside the legacy
//     username/password-hash system, as the first step of migrating off the
//     current "no auth, public rules" Firebase security model.
//   - New signups (signupFinish) and admin-added sub-users (_confirmAddUser)
//     provision a real Firebase Auth account (synthetic email
//     {username}@mdm-depot.internal) immediately alongside the existing
//     password hash.
//   - Existing accounts migrate silently on their next successful login:
//     doLogin() tries Firebase Auth first, and on any failure (not-yet-
//     migrated, or a stale Auth password — see below) falls back to the
//     existing hash check exactly as before, then provisions/repairs the
//     Auth account using the plaintext password the user just typed.
//   - Any password reset that happens without the old password (email/PIN
//     recovery, admin reset, Settings > My Account change) now flags
//     authMigrated:false, since it can't push the new password to Firebase
//     Auth from the client — that needs either the old password or a
//     privileged server-side call. Login is unaffected either way (Auth
//     failures always fall back to the legacy check); fully closing this
//     gap is a Phase 5 (server-side) follow-up.
//   - No database rules changed yet — this phase only builds the dual-path
//     login system rules will eventually depend on (Phase 4).
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v68 changes (2026-07-27) — Staff Date of Birth:
//   - Added optional Date of Birth field to Register Staff and Edit Staff
//     Details forms, shown on the staff profile card, and included as a
//     column in the Staff Roster CSV export.
//   - No sw.js fetch/cache logic changes — bump only, so the updated
//     index.html JS is fetched instead of served from the old cached shell.
//
// v67 changes (2026-07-09) — Crash fix (Staff tab blank/Display Error):
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

const CACHE     = 'v0.2';   // ← bump this whenever you deploy a new version
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
  // { cache: 'no-store' } bypasses the browser's own HTTP cache for this fetch —
  // network-first here only matters if the fetch actually reaches the network
  // instead of being satisfied by an HTTP-cached response the host may have
  // sent cache-control headers for. Without this, a deploy can update the
  // server's file but returning visitors keep getting the old HTML anyway.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
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
