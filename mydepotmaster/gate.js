/*!
 * gate.js — licence / tier / feature gating. ONE copy, loaded by both index.html and pos.html.
 *
 * Everything that decides "is this feature allowed?" and "is the account read-only?" lives here, so the
 * two pages cannot drift apart. Each page keeps its own state (LICENSE, DATA) and passes it in; the
 * functions below are pure. index.html wraps them as hasFeature() / currentTier() / isReadOnly();
 * pos.html does the same.
 *
 * Plain classic script, no dependencies, one global: Gate.
 * Load it with a normal <script src="gate.js"></script> BEFORE any script that uses it (no defer/async).
 * Add gate.js to the precache list in sw.js, otherwise the pages cannot start offline.
 */
const Gate = (function () {
  'use strict';

  // ── Time constants shared by the status rules below
  const TRIAL_MS     = 30 * 24 * 60 * 60 * 1000; // 30-day trial (1 month)
  const SUB_GRACE_MS = 3 * 24 * 60 * 60 * 1000;  // 3-day grace after trial/expiry

  // ══════════════════════════════════════════════════════════════════════════════
  // TIER FEATURE SPEC — single source of truth for the tiered licensing system.
  //
  // Tiers (low → high):
  //   free      — permanent free plan after trial ends; core data entry, plus the Till (pos.html)
  //   starter   — first paid tier; same feature set as free, but with higher
  //               numeric caps (staff/commodity/contacts/history — enforced
  //               separately, not via TIER_FEATURES). No new unlocks here.
  //   growth    — small depot / single operator; unlocks exports + cloud sync
  //   pro       — full-featured; unlocks reports, payslips, staff management
  //   multisite — multiple depots under one account (future / enterprise)
  //
  // trial is treated as pro-equivalent access (all features on) for 30 days.
  // suspended / pending_approval are handled separately by applyLicenseMode().
  //
  // HOW TO ADD A NEW GATE:
  //   1. Add a feature key here under the tiers that should have it.
  //   2. Call hasFeature('your_key') at the function entry point.
  //   3. On false → call showUpgradePrompt('your_key') and return early.
  // ══════════════════════════════════════════════════════════════════════════════

  const TIER_FEATURES = {

    // ── FREE ─────────────────────────────────────────────────────────────────
    // Core data-entry that makes the app useful even without payment.
    // If a feature is listed here it is also implicitly in all higher tiers.
    free: [
      'inventory_receive',         // Record stock received (General tab)
      'inventory_issue',           // Record stock issued (General tab)
      'inventory_stock_count',     // Physical stock count / variance
      'commodity_receive',         // Commodity (maize etc.) receive
      'commodity_issue',           // Commodity issue
      'commodity_stock_count',     // Commodity stock count
      'transport_log',             // Vehicle / transport log entries
      'staff_clock_in',            // Staff clock-in / clock-out
      'staff_roster',              // View staff list
      'contacts_view',             // View contacts / suppliers (view only — no add/edit on Free)
      'books_view',                // View saved books / notes
      'dashboard_view',            // Dashboard summary (read-only stats)
      'settings_basic',            // Currency, depot name, display prefs
      'pos_till',                  // Sell tab / till — separate page pos.html, on EVERY plan (pos.html reads this same table via gate.js)
    ],

    // ── STARTER ──────────────────────────────────────────────────────────────
    // Starter unlocks contact editing (capped — see TIER_CAPS below) but still
    // no cloud sync, exports, or reports. No new unlocks beyond contacts_edit.
    starter: [
      'contacts_edit',             // Add / edit contacts (capped at TIER_CAPS.starter.contacts)
    ],

    // ── GROWTH ───────────────────────────────────────────────────────────────
    // Small operators who need to get data out of the app.
    growth: [
      'cloud_sync',                // Manual upload / download to Firebase
      'export_csv',                // CSV exports across all tabs
      'export_pdf_summary',        // Print-to-PDF period summary report
      'books_edit',                // Create / edit books & spreadsheets
      'supplier_performance',      // Supplier performance report tab
      'budget_vs_actual',          // Budget vs Actual report
      'global_search',             // Cross-tab global search (FAB)
      'contacts_full',             // Full contact management (delete, export)
    ],

    // ── PRO ──────────────────────────────────────────────────────────────────
    // Full-featured depot management — current K300/mo equivalent.
    pro: [
      'payslip_generate',          // Generate & print staff payslips (PDF)
      'staff_id_card',             // Print staff ID cards (PDF)
      'staff_warnings',            // Staff disciplinary warnings log
      'staff_leave',               // Leave management
      'staff_multi_user',          // Add extra login users beyond the admin
      'audit_log',                 // View & export the audit log
      'export_json_backup',        // Full JSON data export/import backup
      'profit_loss',               // P&L report (General + Commodities)
      'cash_flow',                 // Cash flow report
      'dashboard_customize',       // Toggle / reorder dashboard widgets
      'biometric_login',           // Fingerprint / Face ID login
      'setup_checklist',           // First-run onboarding checklist
      'custom_branding',           // Custom logo & accent colour on staff ID cards
      'daily_sales',               // Daily Sales tab (close-out, receipt printing, sales history)
      'ai_copilot',                // Depot Assistant (Gemini) — AI chat + reconciliation (Pro only)
      'payroll_run',               // Payroll Run — Prepare Payroll, lock, pay out, mobile money CSV, run payslips, NAPSA/NHIMA/PAYE
      'stock_check',               // Stock check — stock vs logged bags per task, and the "paid for" badge on stock rows
    ],

    // ── MULTISITE ────────────────────────────────────────────────────────────
    // Future: multiple depots / branches under one subscription.
    // Kept here as a placeholder — no gates wired yet (Step 5e).
    multisite: [
      'multi_depot',               // Switch between depot accounts
      'depot_consolidation',       // Consolidated reports across depots
      'branch_user_isolation',     // Per-branch user access control
    ],
  };

  // Tiers ordered low → high. Used for "upgrade to at least X" prompts.
  const TIER_ORDER = ['free', 'starter', 'growth', 'pro', 'multisite'];

  // Trial gets full pro-equivalent access.
  const TRIAL_TIER = 'pro';

  // ── Compute the flat feature set for a given tier (includes all lower tiers)
  function _tierFeatureSet(tier) {
    const idx = TIER_ORDER.indexOf(tier);
    if (idx === -1) return new Set(TIER_FEATURES.free);
    const features = new Set();
    for (let i = 0; i <= idx; i++) {
      (TIER_FEATURES[TIER_ORDER[i]] || []).forEach(f => features.add(f));
    }
    return features;
  }

  // ── Compute effective status from raw Firebase data
  function computeEffectiveStatus(raw, trialStart, activeUntil) {
    if (raw === 'suspended') return 'suspended';
    if (raw === 'pending_approval') return 'pending_approval';
    const now = Date.now();
    if (raw === 'trial') {
      const ts = trialStart || now;
      if (now <= ts + TRIAL_MS) return 'trial';
      // After trial ends — apply 3-day grace
      if (now <= ts + TRIAL_MS + SUB_GRACE_MS) return 'trial_grace';
      return 'trial_expired';
    }
    if (raw === 'active') {
      if (!activeUntil || now <= activeUntil) return 'active';
      // After active period ends — apply 3-day grace
      if (now <= activeUntil + SUB_GRACE_MS) return 'expired_grace';
      return 'expired';
    }
    return raw || 'trial';
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // GATING RULES — pure functions of the licence and the depot data.
  //   lic  = the LICENSE object (index.html) or the signed licence cache (pos.html)
  //   data = DATA; only data.tier and data.depotInfo.selfSuspended are read
  // ══════════════════════════════════════════════════════════════════════════════

  // Statuses that make the account read-only (writes blocked). trial_expired and expired are NOT here:
  // they degrade silently to the free tier instead of blocking the app.
  const READ_ONLY_STATUSES = ['pending_approval', 'suspended', 'trial_grace', 'expired_grace'];

  function statusOf(lic) {
    return lic.effectiveStatus || lic.status || 'active';
  }

  // Admin-initiated pause (Settings → Data & Backup → My Account), distinct from licence 'suspended'.
  // Locks the whole app read-only for everyone until an Admin reactivates it.
  function isSelfSuspended(data) {
    return !!((data.depotInfo || {}).selfSuspended);
  }

  // The tier the depot is operating on.
  //   • Trial is pro-equivalent (TRIAL_TIER).
  //   • Active subscription (and its 3-day grace) uses the stored tier.
  //   • Anything else (trial ended, lapsed, suspended, pending) → 'free'. The app keeps working and only
  //     premium features are gated; isReadOnly() separately blocks writes for suspended/pending/grace.
  function tierOf(lic, data) {
    const eff = statusOf(lic);
    if (eff === 'trial') return TRIAL_TIER;
    if (eff === 'active' || eff === 'expired_grace') return lic.tier || data.tier || 'pro';
    return 'free';
  }

  // The single chokepoint every gate goes through.
  function hasFeature(name, lic, data) {
    return _tierFeatureSet(tierOf(lic, data)).has(name);
  }

  function isReadOnly(lic, data) {
    return isSelfSuspended(data) || READ_ONLY_STATUSES.includes(statusOf(lic));
  }

  // For a page that only has a CACHED licence and cannot run checkLicense() — the till. A cache written
  // days ago still says 'trial' / 'active', so apply the clock to the dates inside it. Returns lic itself
  // when nothing changed. index.html does not use this: checkLicense() / applyLocalFallback() cover it
  // there, with their own 7-day offline allowance (LICENSE_GRACE_MS).
  function reconcile(lic, now) {
    const e = statusOf(lic);
    let eff = e;
    if (e === 'trial' && lic.trialStart && now >= lic.trialStart + TRIAL_MS) eff = 'trial_expired';
    else if (e === 'active' && lic.activeUntil && now > lic.activeUntil + SUB_GRACE_MS) eff = 'expired';
    return eff === e ? lic : Object.assign({}, lic, { effectiveStatus: eff });
  }

  // ── Cross-page storage contract: index.html writes these, pos.html reads them.
  const KEYS = Object.freeze({
    license:    'mdm_license_cache',   // signed licence cache (localStorage)
    stay:       'mdm_stay_signed_in',  // "stay signed in" token (localStorage)
    posSession: 'mdm_pos_session',     // who is signed in, handed to the till (sessionStorage, per tab)
  });
  const POS_SESSION_MS = 12 * 60 * 60 * 1000; // how long a tab's till hand-off stays valid

  return {
    TRIAL_MS, SUB_GRACE_MS, TIER_ORDER, TIER_FEATURES, TRIAL_TIER, READ_ONLY_STATUSES, KEYS, POS_SESSION_MS,
    computeEffectiveStatus, tierFeatureSet: _tierFeatureSet,
    statusOf, isSelfSuspended, tierOf, hasFeature, isReadOnly, reconcile,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Gate; // lets Node load it for tests
