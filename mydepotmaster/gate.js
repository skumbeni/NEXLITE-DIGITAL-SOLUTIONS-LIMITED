/*!
 * gate.js — licence / tier / feature gating + receipt numbering + REST helper. ONE copy, loaded by both index.html and pos.html.
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
    till:       'mdm_till_v2',         // this device's receipt counter + till code (localStorage, one record per depot)
  });
  const POS_SESSION_MS = 12 * 60 * 60 * 1000; // how long a tab's till hand-off stays valid

  // ══════════════════════════════════════════════════════════════════════════════
  // RECEIPT NUMBERING — one number series per till (device), shared by index.html and pos.html.
  //
  // A receipt number looks like  K7F2-000123  =  <till code>-<per-till counter>.
  //   • The till code (4 characters, no I L O 0 1) is CLAIMED IN THE CLOUD: depots/<depotKey>/tills/<code>.
  //     The database rules make that node create-only, so two tills of one depot can never hold the same
  //     code. Until a till has claimed its code it refuses to number anything (invariant: counter = 0
  //     while unregistered), so the code can still be swapped safely if the claim finds it taken.
  //     The claim needs the network ONCE per device. After that everything works offline.
  //   • The counter lives in localStorage (shared by every tab of the device; same origin for both pages).
  //     It is written and read back BEFORE the number is handed out, under a cross-tab lock
  //     (Web Locks, with a localStorage lock as fallback). A crash can therefore leave a gap, never a repeat.
  //   • If the stored record is missing, damaged or edited by hand, the device gets a NEW till code and
  //     claims it. It never restarts an old code at 1. There is deliberately no reset.
  //   • The long random tillId travels with every sale (hidden), so two sales that ever did share a
  //     printed number can still be told apart.
  //
  // Storage and network are injected, so Node can test this file (see receiptNumbering(env)).
  // ══════════════════════════════════════════════════════════════════════════════
  const RC_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 31 symbols: no I, L, O, 0, 1
  const RC_CODE_RE  = /^[A-HJ-KM-NP-Z2-9]{4}$/;
  const RC_ID_RE    = /^[0-9a-f]{24}$/;

  function _err(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

  function _defaultRand(n) {
    const a = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);   // uniqueness comes from the cloud claim, not from this
    return a;
  }
  function newTillCode(rand) {
    rand = rand || _defaultRand;
    let out = '';
    while (out.length < 4) {
      const bytes = rand(8);
      for (let i = 0; i < bytes.length && out.length < 4; i++) {
        if (bytes[i] < 248) out += RC_ALPHABET[bytes[i] % 31];   // 248 = 31*8: no modulo bias
      }
    }
    return out;
  }
  function newTillId(rand) {
    return Array.from((rand || _defaultRand)(12)).map(b => (b & 255).toString(16).padStart(2, '0')).join('');
  }
  function _fnv(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }
  const _pad = n => String(n).padStart(6, '0');

  // env = { depotKey(), who?(), cloud:{get(path), putIfAbsent(path,obj)}, storage?, locks?, now?, rand?, sleep? }
  function receiptNumbering(env) {
    const storage = env.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const locks   = env.locks !== undefined ? env.locks : (typeof navigator !== 'undefined' ? navigator.locks : null);
    const now     = env.now || Date.now;
    const rand    = env.rand || _defaultRand;
    const sleep   = env.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    const depot   = () => String(env.depotKey() || 'local');
    const SK = () => KEYS.till + ':' + depot();
    const LK = () => KEYS.till + '_lock:' + depot();

    const seal = s => { s.chk = _fnv([s.v, s.tillId, s.code, s.n, s.reg ? 1 : 0].join('|')); return s; };
    const fresh = () => seal({ v: 2, tillId: newTillId(rand), code: newTillCode(rand), n: 0, reg: false });

    function parse() {                       // the stored record if it is intact, else null
      let raw;
      try { raw = storage.getItem(SK()); } catch (e) { throw _err('STORAGE', 'Storage is not available'); }
      if (!raw) return null;
      try {
        const s = JSON.parse(raw);
        if (s && s.v === 2 && RC_ID_RE.test(s.tillId) && RC_CODE_RE.test(s.code) && Number.isInteger(s.n) && s.n >= 0 &&
            typeof s.reg === 'boolean' && s.chk === _fnv([s.v, s.tillId, s.code, s.n, s.reg ? 1 : 0].join('|'))) return s;
      } catch (e) {}
      return null;
    }
    function write(s) {                      // write, then read back: a number is never issued on an unsaved counter
      try { storage.setItem(SK(), JSON.stringify(s)); } catch (e) { throw _err('STORAGE', 'Could not save the receipt counter'); }
      const back = parse();
      if (!back || back.tillId !== s.tillId || back.code !== s.code || back.n !== s.n || back.reg !== s.reg) throw _err('STORAGE', 'Could not save the receipt counter');
    }
    function load() {                        // call inside the lock
      const s = parse();
      if (s) return s;
      const f = fresh(); write(f); return f;
    }

    async function storageLock(fn) {         // fallback when Web Locks is missing
      const id = newTillId(rand), key = LK(), start = now();
      for (;;) {
        let cur = null; try { cur = JSON.parse(storage.getItem(key) || 'null'); } catch (e) {}
        if (!cur || cur.exp < now()) {
          try { storage.setItem(key, JSON.stringify({ id, exp: now() + 5000 })); } catch (e) { throw _err('STORAGE', 'Storage is not available'); }
          await sleep(25);
          let chk = null; try { chk = JSON.parse(storage.getItem(key) || 'null'); } catch (e) {}
          if (chk && chk.id === id) {
            try { return await fn(); }
            finally { try { const c = JSON.parse(storage.getItem(key) || 'null'); if (c && c.id === id) storage.removeItem(key); } catch (e) {} }
          }
        }
        if (now() - start > 8000) throw _err('LOCK', 'Another tab is holding the receipt counter');
        await sleep(20 + Math.floor(rand(1)[0] % 30));
      }
    }
    function withLock(fn) {
      if (locks && locks.request) return locks.request('mdm_receipt_' + depot(), { mode: 'exclusive' }, () => fn());
      return storageLock(fn);
    }

    const info = s => ({ code: s.code, tillId: s.tillId, registered: s.reg, last: s.n });

    // Claim the till code in the cloud. Safe to call as often as you like; one claim runs at a time.
    let busy = null;
    function ensureRegistered() {
      if (!busy) busy = _register().finally(() => { busy = null; });
      return busy;
    }
    async function _register() {
      for (let attempt = 0; attempt < 12; attempt++) {
        const s = await withLock(async () => load());
        if (s.reg) return info(s);
        const path = 'depots/' + depot() + '/tills/' + s.code;
        let ours = false;
        const existing = await env.cloud.get(path);          // throws while offline: caller shows "go online once"
        if (existing && typeof existing === 'object') ours = existing.tillId === s.tillId;
        else {
          try { await env.cloud.putIfAbsent(path, { tillId: s.tillId, createdAt: { '.sv': 'timestamp' }, by: String((env.who && env.who()) || '').slice(0, 80) }); ours = true; }
          catch (e) {
            const again = await env.cloud.get(path);          // lost a race, or a real failure?
            if (again && typeof again === 'object') ours = again.tillId === s.tillId;
            else throw e;
          }
        }
        const done = await withLock(async () => {
          const c = load();
          if (c.tillId !== s.tillId) return null;            // another tab replaced the identity meanwhile: start over
          if (ours) { if (!c.reg) { const t = seal({ v: 2, tillId: c.tillId, code: c.code, n: c.n, reg: true }); write(t); return info(t); } return info(c); }
          if (!c.reg && c.n === 0) write(seal({ v: 2, tillId: c.tillId, code: newTillCode(rand), n: 0, reg: false }));   // code was taken: pick another
          return null;
        });
        if (done) return done;
      }
      throw _err('NO_CODE', 'Could not claim a till code');
    }

    // Hand out the next receipt number.
    function next() {
      return withLock(async () => {
        const s = load();
        if (!s.reg) throw _err('NOT_REGISTERED', 'This till has not claimed its code yet');
        const t = seal({ v: 2, tillId: s.tillId, code: s.code, n: s.n + 1, reg: true });
        write(t);                                            // saved and read back BEFORE the number leaves this function
        return { receiptNo: t.code + '-' + _pad(t.n), tillId: t.tillId, code: t.code, seq: t.n };
      });
    }

    // Read-only look for the screen (never creates anything).
    function peek() { try { const s = parse(); return s ? info(s) : null; } catch (e) { return null; } }

    return { ensureRegistered, next, peek };
  }

  // Realtime Database over REST, for the claim above. Same headers as index.html's fbGet/fbSetIfNotExists.
  //   o = { dbUrl, idToken(force?), appCheck?(), fetch?, timeoutMs? }
  function restCloud(o) {
    const base = String(o.dbUrl).replace(/\/+$/, '');
    const doFetch = o.fetch || ((u, i) => fetch(u, i));
    async function call(path, init, qs) {
      let res;
      for (let attempt = 0; attempt < 2; attempt++) {
        const tok = await o.idToken(attempt > 0);
        if (!tok) throw _err('NO_AUTH', 'No cloud session');
        const ac = o.appCheck ? await o.appCheck() : null;
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), o.timeoutMs || 12000) : null;
        try {
          res = await doFetch(base + '/' + path + '.json?auth=' + encodeURIComponent(tok) + (qs ? '&' + qs : ''),
            Object.assign({}, init, { headers: Object.assign({}, init.headers, ac ? { 'X-Firebase-AppCheck': ac } : {}), signal: ctl ? ctl.signal : undefined }));
        } catch (e) { throw _err('NETWORK', 'Network error'); }
        finally { if (timer) clearTimeout(timer); }
        if (res.status === 401 && attempt === 0) continue;   // refresh the token once, as fbGet does
        break;
      }
      return res;
    }
    return {
      async get(path) {
        const res = await call(path, { method: 'GET', headers: {} });
        if (!res.ok) throw _err('HTTP_' + res.status, 'HTTP ' + res.status);
        return res.json();
      },
      // A filtered read, e.g. query('depots/X/sales', 'orderBy=%22createdAt%22&startAt=0&limitToFirst=300') (sales.js pull).
      async query(path, qs) {
        const res = await call(path, { method: 'GET', headers: {} }, qs);
        if (!res.ok) throw _err('HTTP_' + res.status, 'HTTP ' + res.status);
        return res.json();
      },
      async putIfAbsent(path, data) {
        const res = await call(path, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' }, body: JSON.stringify(data) });
        if (res.status === 412) throw _err('EXISTS', 'Already exists');
        if (!res.ok) throw _err('HTTP_' + res.status, 'HTTP ' + res.status);
        return res.json();
      },
    };
  }

  // ═════════════════════════════════════════════════════════════════
  // MANAGER PIN — shared by index.html (sets it, Settings → Manager PIN) and pos.html (asks for it at the till).
  // The PIN is stored on the user as u.pin = { v, s, i, h, at }: a salted PBKDF2/SHA-256 record, never the PIN itself.
  //   s = salt (hex), i = iterations, h = derived key (hex), at = when it was set (ms).
  // Holders are the Admin and Manager roles ('manager' and the legacy 'data_entry'). 5 wrong PINs in a row lock the pad
  // for 1 minute on that phone (counter kept in localStorage under PIN_LOCK_KEY). Soft control, not a security boundary.
  // ═════════════════════════════════════════════════════════════════
  const PIN_ROLES     = Object.freeze(['admin', 'manager', 'data_entry']);
  const PIN_ITER      = 100000;
  const PIN_MAX_TRIES = 5;
  const PIN_LOCK_MS   = 60 * 1000;
  const PIN_LOCK_KEY  = 'mdm_pin_lock';

  function pinValid(p) { return typeof p === 'string' && /^\d{4,6}$/.test(p); }

  function _hex(u8) { return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''); }
  function _unhex(s) {
    if (typeof s !== 'string' || s.length % 2 || /[^0-9a-f]/i.test(s)) throw _err('BAD_RECORD', 'Bad PIN record');
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  async function _pinDerive(pin, saltHex, iterations) {
    if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.subtle.deriveBits) {
      throw _err('NO_CRYPTO', 'This phone cannot store or check a PIN (secure crypto is unavailable). Update the browser and use HTTPS.');
    }
    const key  = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: _unhex(saltHex), iterations, hash: 'SHA-256' }, key, 256);
    return _hex(new Uint8Array(bits));
  }
  function _sameHex(a, b) {                          // constant-time compare of two equal-length hex strings
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }

  // Build the record to store on the user. Async; throws on a bad PIN or when the phone has no PBKDF2.
  async function pinRecord(pin, now) {
    if (!pinValid(pin)) throw _err('BAD_PIN', 'PIN must be 4 to 6 digits, numbers only.');
    const s = _hex(_defaultRand(16));
    const h = await _pinDerive(pin, s, PIN_ITER);
    return { v: 1, s, i: PIN_ITER, h, at: typeof now === 'number' ? now : Date.now() };
  }

  // Does `pin` match this stored record? Resolves true/false; rejects only when the phone cannot do PBKDF2.
  async function pinCheck(pin, rec) {
    if (!pinValid(pin) || !rec || typeof rec.h !== 'string' || typeof rec.s !== 'string') return false;
    const it = Number(rec.i);
    if (!(it >= 1000 && it <= 5000000)) return false;
    let h; try { h = await _pinDerive(pin, rec.s, it); } catch (e) { if (e && e.code === 'NO_CRYPTO') throw e; return false; }
    return _sameHex(h, rec.h);
  }

  // Users who hold a PIN: an Admin or Manager role with a stored PIN record.
  function pinHolders(data) {
    const users = data && Array.isArray(data.users) ? data.users : [];
    return users.filter(u => u && PIN_ROLES.includes(String(u.role)) && u.pin && typeof u.pin.h === 'string' && u.pin.h);
  }

  // Whose PIN is this? Returns { username, role } of the holder it belongs to, or null. Every holder is checked so the
  // time taken does not reveal which one matched.
  async function pinFindApprover(pin, data) {
    if (!pinValid(pin)) return null;
    let found = null;
    for (const u of pinHolders(data)) {
      if (await pinCheck(pin, u.pin) && !found) found = { username: String(u.username || ''), role: String(u.role) };
    }
    return found;
  }

  // Must the till ask for a PIN now? Only when the Admin switched it on, a shift is open, and somebody holds a PIN.
  function pinRequired(data, shiftOpen) {
    return !!shiftOpen && !!(data && data.depotInfo && data.depotInfo.tillExitPin) && pinHolders(data).length > 0;
  }

  // Wrong-PIN counter on this phone. `storage` is localStorage (or any getItem/setItem/removeItem object).
  function _lockRead(storage) {
    try { const o = JSON.parse(storage.getItem(PIN_LOCK_KEY) || 'null'); if (o && typeof o === 'object') return { n: Number(o.n) || 0, until: Number(o.until) || 0 }; } catch (e) {}
    return { n: 0, until: 0 };
  }
  function _lockWrite(storage, o) { try { storage.setItem(PIN_LOCK_KEY, JSON.stringify(o)); } catch (e) {} }
  function pinLockState(storage, now) {
    const o = _lockRead(storage), left = Math.max(0, o.until - now);
    return { locked: left > 0, left, triesLeft: Math.max(0, PIN_MAX_TRIES - o.n) };
  }
  function pinFailed(storage, now) {                 // call after a wrong PIN
    const o = _lockRead(storage);
    if (o.until > now) return { locked: true, left: o.until - now, triesLeft: 0 };
    const n = o.n + 1;
    if (n >= PIN_MAX_TRIES) { _lockWrite(storage, { n: 0, until: now + PIN_LOCK_MS }); return { locked: true, left: PIN_LOCK_MS, triesLeft: 0 }; }
    _lockWrite(storage, { n, until: 0 });
    return { locked: false, left: 0, triesLeft: PIN_MAX_TRIES - n };
  }
  function pinClear(storage) { try { storage.removeItem(PIN_LOCK_KEY); } catch (e) {} }


  return {
    TRIAL_MS, SUB_GRACE_MS, TIER_ORDER, TIER_FEATURES, TRIAL_TIER, READ_ONLY_STATUSES, KEYS, POS_SESSION_MS,
    computeEffectiveStatus, tierFeatureSet: _tierFeatureSet,
    statusOf, isSelfSuspended, tierOf, hasFeature, isReadOnly, reconcile,
    receiptNumbering, restCloud, newTillCode, newTillId, RC_ALPHABET,
    PIN_ROLES, pinValid, pinRecord, pinCheck, pinHolders, pinFindApprover, pinRequired, pinLockState, pinFailed, pinClear,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Gate; // lets Node load it for tests
