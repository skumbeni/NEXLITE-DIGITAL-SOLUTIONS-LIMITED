/*!
 * shifts.js — shifts: open with a float, close with a cash count. ONE copy, loaded by pos.html (roadmap step 16).
 *
 * WHAT IT IS
 *   A shift is one cashier working one till for a while. It has exactly two records, and neither is ever changed:
 *     OPEN   shifts/{shiftId}       who opened it, when, and the float (the cash already in the drawer)
 *     CLOSE  shiftCloses/{shiftId}  who closed it, when, expected cash, counted cash and the difference
 *   shiftId = <till code>-S<number>, e.g. K7F2-S0001. The number counts up per till. Every sale taken during the shift carries
 *   its shiftId (sales.js), so "the sales of this shift" is a lookup, not a guess from the clock.
 *   Like sales, shift records live OUTSIDE the DATA blob, so two tills can never overwrite each other.
 *
 * CASH MATHS (nothing is stored but the result at close; every figure is summed from records)
 *   expected cash = float + cash taken on this shift's sales − cash paid out (cash handed back on voids and refunds, roadmap step 19: Returns.cashOutOf(shiftId) is the `out` figure)
 *   cash taken on a sale = the CASH payment lines' `amount` (what was applied to the bill; the change given back is already
 *   left out of `amount`, `tendered` is not used here).
 *   variance = counted − expected   (negative = cash is short, positive = cash is over)
 *
 * WHERE A RECORD LIVES
 *   1. On the device: IndexedDB database "mdm_shifts" (stores: ev, outbox, meta). Saved together with its "still to upload"
 *      mark in one transaction, BEFORE the screen moves on. Works fully offline. (A separate database from "mdm_sales", so a
 *      schema change in one can never block the other.)
 *   2. In the cloud: depots/<depot>/shifts/<id> and depots/<depot>/shiftCloses/<id>, create-only (database_rules.json). Each
 *      device uploads its own outbox whenever it is online and downloads the other tills' records, incrementally by the
 *      server's createdAt time, exactly as sales.js does. Uploading is idempotent.
 *
 * ONE SHIFT AT A TIME PER TILL. open() refuses while this till has an open shift (code ALREADY_OPEN, with the shift). Two tabs
 * on one phone that open at the same moment compute the same shiftId, and the store's key makes the second one fail with
 * EXISTS: they cannot both win.
 *
 * X AND Z REPORTS (roadmap step 17)
 *   Nothing new is stored. A report is worked out from the records every time, so it can never disagree with them.
 *     report('X', ...)  one OPEN shift, read-only, as often as wanted. Changes nothing.
 *     report('Z', ...)  one CLOSED shift: the figures frozen in its close record, plus the item list from the ledger.
 *     dayReport(...)    every sale of one date and every shift COUNTED on it, across tills: what the main app's daily close-out shows and keeps.
 *   VOIDS AND REFUNDS (roadmap step 19, returns.js). A return is booked on the day and in the shift it is MADE, never back onto the sale's, so a
 *   closed shift or a closed day is never changed. Its cash comes out of the drawer (`out`); the reports show it beside the sales: report() adds `rt`
 *   (counts and money of this shift's returns, from o.returns) and `netTotal`; dayReport(date, events, sales, returns) adds `returns`, `cashOut` (cash
 *   handed back on the date) and `netTotal`. The Z's own figures are still the close record's: `total` stays the sales taken, `cashOut` is already in it.
 *   The Z of a shift IS its shiftCloses record (append-only), so there is no Z counter to collide: its number is the shiftId.
 *   The day's Z reference is 'Z-' + the date.
 *
 * THE TILL'S AUDIT TRAIL (roadmap step 20)
 *   The Audit log in the main app is DATA.auditLog, written by logAuditEvent(). The till cannot write to it: DATA is one blob,
 *   last write wins, so two phones writing audit lines into it would lose some. The till's events therefore reach the Audit log
 *   by the same route as its sales: append-only records outside the blob. Two kinds, and the main app joins them with DATA.auditLog
 *   when it shows or exports the log (auditEntries() below turns both into the shape logAuditEvent writes):
 *     1. Events that ALREADY have a record are not written twice. They are read straight from it, so the log can never disagree with
 *        the ledger and a line cannot go missing:  shift opened (shifts/), shift closed, forced or not, with the cash variance
 *        (shiftCloses/), a discount given and who allowed it (the sale in sales/), a void or refund with reason and approver (returns/).
 *     2. Events that leave NO record are written as audit records:   tillAudit/{id}   id = <till code>-A<time><3 random>, create-only
 *          x_report   an X report was taken            z_report   a Z report was shown or reprinted (what:'copy' for a reprint)
 *          exit_ok    a manager PIN let a cashier leave the till (approver)
 *          pin_fail   a wrong manager PIN was typed (what = what it was for)       pin_lock   the pad locked after 5 wrong PINs
 *        A PIN is never stored, only who typed a wrong one, when, and what for. Same store as shifts ("mdm_shifts", stores ev/outbox/meta),
 *        same outbox and download, so no new database and no schema change. shiftsOf() / openShiftOf() skip them.
 *
 * Plain classic script, no dependencies, one global: Shifts. Load it with a normal <script src="shifts.js"></script> after
 * gate.js and sales.js. Add shifts.js to the precache list in sw.js, otherwise the till cannot start offline.
 * Storage and network are injected, so Node can test this file (see create(env) and memAdapter()).
 */
const Shifts = (function () {
  'use strict';

  const V = 1;                                            // record format version
  const TILL_RE = /^[A-HJ-KM-NP-Z2-9]{4}$/;
  const TID_RE  = /^[0-9a-f]{24}$/;
  const SID_RE  = /^[A-HJ-KM-NP-Z2-9]{4}-S[0-9]{4,9}$/;   // shift id
  const MAX_MONEY = 1e9;
  const PAGE = 300, MAX_PAGES = 40;
  const OVERLAP_MS = 60000;
  const OPEN = 'open', CLOSE = 'close', AUDIT = 'audit';
  const COLL = { open: 'shifts', close: 'shiftCloses', audit: 'tillAudit' };    // cloud collection of each kind
  const AID_RE = /^[A-HJ-KM-NP-Z2-9]{4}-A[0-9a-z]{9,16}$/;                       // audit record id (step 20)
  const AUDIT_EVENTS = ['x_report', 'z_report', 'exit_ok', 'pin_fail', 'pin_lock'];

  const isNum = x => typeof x === 'number' && isFinite(x);
  const r2 = n => Math.round(n * 100) / 100;
  const toC = n => Math.round((Number(n) || 0) * 100);
  const str = (x, n) => (x == null ? '' : String(x)).slice(0, n);
  function err(code, msg, extra) { const e = new Error(msg || code); e.code = code; if (extra) Object.assign(e, extra); return e; }
  const arr = x => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : []);
  const idOf = (till, seq) => till + '-S' + String(seq).padStart(4, '0');

  // ══════════════════════════════════════════════════════════════════════════════
  // THE RECORDS
  // ══════════════════════════════════════════════════════════════════════════════
  // OPEN : { v:1, type:'open', id, shiftId, till, tillId, seq, at, date, time, cashier, cashierRole, float }
  // CLOSE: { v:1, type:'close', id, shiftId, till, tillId, at, date, time, closedBy, closedByRole, forced,
  //          float, cashSales, cashOut, expectedCash, countedCash, variance,
  //          saleCount, total, credit, byMethod:{cash,mtn,airtel,card}, firstReceipt, lastReceipt, note }
  //   forced: true when someone other than the opener closed it (a manager closing a forgotten shift).
  //   total = value of the sales, credit = what was left unpaid on them, byMethod = money taken per method.
  //   note: why the count differs (free text, optional)
  function openRecord(b, opts) {
    opts = opts || {};
    const at = Math.round(Number(b.at));
    const dateOf = opts.dateOf || (t => new Date(t).toISOString().slice(0, 10));
    const timeOf = opts.timeOf || (t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); });
    const id = idOf(String(b.till), Number(b.seq));
    return JSON.parse(JSON.stringify({
      v: V, type: OPEN, id, shiftId: id, till: String(b.till), tillId: String(b.tillId), seq: Number(b.seq),
      at, date: dateOf(at), time: timeOf(at),
      cashier: str(b.cashier, 80), cashierRole: str(b.cashierRole, 20), float: r2(Number(b.float))
    }));
  }
  function validateOpen(s) {
    if (!s || typeof s !== 'object' || s.type !== OPEN) return 'not a shift record';
    if (!SID_RE.test(String(s.id)) || s.id !== s.shiftId) return 'bad shift id';
    if (!TILL_RE.test(String(s.till)) || String(s.id).slice(0, 4) !== s.till) return 'bad till code';
    if (!TID_RE.test(String(s.tillId))) return 'bad till id';
    if (!Number.isInteger(s.seq) || s.seq < 1 || Number(String(s.id).slice(6)) !== s.seq) return 'bad shift number';
    if (!isNum(s.at) || s.at <= 0) return 'bad time';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) || !/^\d{2}:\d{2}$/.test(String(s.time))) return 'bad date';
    if (typeof s.cashier !== 'string' || !s.cashier || s.cashier.length > 80) return 'bad cashier';
    if (typeof s.cashierRole !== 'string' || s.cashierRole.length > 20) return 'bad cashier role';
    if (!isNum(s.float) || s.float < 0 || s.float > MAX_MONEY || toC(s.float) !== Math.round(s.float * 100)) return 'bad float';
    return '';
  }

  const METHODS = ['cash', 'mtn', 'airtel', 'card'];
  function closeRecord(b, opts) {
    opts = opts || {};
    const at = Math.round(Number(b.at));
    const dateOf = opts.dateOf || (t => new Date(t).toISOString().slice(0, 10));
    const timeOf = opts.timeOf || (t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); });
    const by = {}; METHODS.forEach(m => { by[m] = r2(Number((b.byMethod || {})[m]) || 0); });
    return JSON.parse(JSON.stringify({
      v: V, type: CLOSE, id: String(b.shiftId), shiftId: String(b.shiftId), till: String(b.till), tillId: String(b.tillId),
      at, date: dateOf(at), time: timeOf(at),
      closedBy: str(b.closedBy, 80), closedByRole: str(b.closedByRole, 20), forced: !!b.forced,
      float: r2(Number(b.float)), cashSales: r2(Number(b.cashSales)), cashOut: r2(Number(b.cashOut) || 0),
      expectedCash: r2(Number(b.expectedCash)), countedCash: r2(Number(b.countedCash)), variance: r2(Number(b.variance)),
      saleCount: Number(b.saleCount), total: r2(Number(b.total)), credit: r2(Number(b.credit)), byMethod: by,
      firstReceipt: str(b.firstReceipt, 16), lastReceipt: str(b.lastReceipt, 16), note: str(b.note, 300)
    }));
  }
  function validateClose(s) {
    if (!s || typeof s !== 'object' || s.type !== CLOSE) return 'not a shift record';
    if (!SID_RE.test(String(s.id)) || s.id !== s.shiftId) return 'bad shift id';
    if (!TILL_RE.test(String(s.till)) || String(s.id).slice(0, 4) !== s.till) return 'bad till code';
    if (!TID_RE.test(String(s.tillId))) return 'bad till id';
    if (!isNum(s.at) || s.at <= 0) return 'bad time';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) || !/^\d{2}:\d{2}$/.test(String(s.time))) return 'bad date';
    if (typeof s.closedBy !== 'string' || !s.closedBy || s.closedBy.length > 80) return 'bad closer';
    if (typeof s.closedByRole !== 'string' || s.closedByRole.length > 20) return 'bad closer role';
    if (typeof s.forced !== 'boolean') return 'bad forced flag';
    const money = ['float', 'cashSales', 'cashOut', 'expectedCash', 'countedCash', 'total', 'credit'];
    for (const k of money) if (!isNum(s[k]) || s[k] < 0 || s[k] > MAX_MONEY) return 'bad ' + k;
    if (!isNum(s.variance) || Math.abs(s.variance) > MAX_MONEY) return 'bad variance';
    if (Math.max(0, toC(s.float) + toC(s.cashSales) - toC(s.cashOut)) !== toC(s.expectedCash)) return 'expected cash does not add up';
    if (toC(s.countedCash) - toC(s.expectedCash) !== toC(s.variance)) return 'variance does not match the count';
    if (!Number.isInteger(s.saleCount) || s.saleCount < 0) return 'bad sale count';
    const by = s.byMethod;
    if (!by || typeof by !== 'object') return 'bad payment totals';
    for (const m of METHODS) if (!isNum(by[m]) || by[m] < 0) return 'bad payment totals';
    if (toC(by.cash) !== toC(s.cashSales)) return 'cash total does not match';
    if (typeof s.firstReceipt !== 'string' || typeof s.lastReceipt !== 'string' || typeof s.note !== 'string' || s.note.length > 300) return 'bad text field';
    return '';
  }
  // expected cash is never negative in the record (a drawer cannot hold less than nothing): if payouts ever exceed float + cash
  // sales, the record says 0 and the variance carries the rest.

  // AUDIT: { v:1, type:'audit', id, till, tillId, at, date, time, user, role, event, shiftId?, what?, approver?, note? }
  //   user/role: who was signed in at the till.  event: one of AUDIT_EVENTS.  shiftId: the shift on the till, when there is one.
  //   what: what the event was about, a few words ('leave the till', 'allow a discount', 'copy').  approver: exit_ok only, the PIN holder.
  //   note: a short extra ('2 wrong PINs in a row').  Nothing secret goes in: never a PIN.
  const auditId = (till, at, rnd) => till + '-A' + Math.round(at).toString(36).padStart(8, '0') + rnd;
  function auditRecord(b, opts) {
    opts = opts || {};
    const at = Math.round(Number(b.at));
    const dateOf = opts.dateOf || (t => new Date(t).toISOString().slice(0, 10));
    const timeOf = opts.timeOf || (t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); });
    const rnd = String(b.rnd == null ? '' : b.rnd).toLowerCase().replace(/[^0-9a-z]/g, '').slice(0, 4);
    const o = {
      v: V, type: AUDIT, id: auditId(String(b.till), at, rnd), till: String(b.till), tillId: String(b.tillId),
      at, date: dateOf(at), time: timeOf(at), user: str(b.user, 80), role: str(b.role, 20), event: String(b.event)
    };
    if (b.shiftId) o.shiftId = str(b.shiftId, 24);
    if (b.what) o.what = str(b.what, 40);
    if (b.approver) o.approver = str(b.approver, 80);
    if (b.note) o.note = str(b.note, 200);
    return JSON.parse(JSON.stringify(o));
  }
  function validateAudit(s) {
    if (!s || typeof s !== 'object' || s.type !== AUDIT) return 'not an audit record';
    if (!AID_RE.test(String(s.id))) return 'bad audit id';
    if (!TILL_RE.test(String(s.till)) || String(s.id).slice(0, 4) !== s.till) return 'bad till code';
    if (!TID_RE.test(String(s.tillId))) return 'bad till id';
    if (!isNum(s.at) || s.at <= 0) return 'bad time';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) || !/^\d{2}:\d{2}$/.test(String(s.time))) return 'bad date';
    if (typeof s.user !== 'string' || !s.user || s.user.length > 80) return 'bad user';
    if (typeof s.role !== 'string' || s.role.length > 20) return 'bad role';
    if (AUDIT_EVENTS.indexOf(s.event) < 0) return 'bad event';
    if (s.shiftId !== undefined && !SID_RE.test(String(s.shiftId))) return 'bad shift id';
    for (const [k, n] of [['what', 40], ['approver', 80], ['note', 200]]) if (s[k] !== undefined && (typeof s[k] !== 'string' || s[k].length > n)) return 'bad ' + k;
    return '';
  }

  function forCloud(rec) { const o = Object.assign({}, rec, { createdAt: { '.sv': 'timestamp' } }); delete o.id; delete o.type; return o; }
  function fromCloud(kind, id, o) {
    if (!o || typeof o !== 'object') return { rec: null, createdAt: 0 };
    const createdAt = isNum(o.createdAt) ? o.createdAt : 0;
    const rec = Object.assign({}, o);
    delete rec.createdAt;
    rec.id = id; rec.type = kind;
    if (kind === CLOSE) { ['firstReceipt', 'lastReceipt', 'note'].forEach(k => { if (rec[k] == null) rec[k] = ''; }); }
    if (kind === OPEN && rec.cashierRole == null) rec.cashierRole = '';
    if (kind === CLOSE && rec.closedByRole == null) rec.closedByRole = '';
    if (kind === CLOSE && rec.byMethod) METHODS.forEach(m => { if (rec.byMethod[m] == null) rec.byMethod[m] = 0; });
    if (kind === AUDIT && rec.role == null) rec.role = '';
    const bad = kind === OPEN ? validateOpen(rec) : kind === CLOSE ? validateClose(rec) : validateAudit(rec);
    return { rec: bad ? null : rec, createdAt };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // READING THE LEDGER
  // ══════════════════════════════════════════════════════════════════════════════
  // events -> [{ open, close|null }] oldest first. A close with no matching open (should not happen) is ignored.
  function shiftsOf(events) {
    const opens = new Map(), closes = new Map();
    (events || []).forEach(e => { if (!e) return; if (e.type === OPEN) opens.set(e.shiftId, e); else if (e.type === CLOSE) closes.set(e.shiftId, e); });
    const list = [];
    opens.forEach((o, id) => list.push({ open: o, close: closes.get(id) || null }));
    return list.sort((a, b) => (a.open.at - b.open.at) || a.open.id.localeCompare(b.open.id));
  }
  // The shift this till has open right now, or null. Only THIS till's own records count (till = the device's code).
  function openShiftOf(events, tillId) {
    const open = shiftsOf(events).filter(s => !s.close && s.open.tillId === tillId);
    return open.length ? open[open.length - 1] : null;      // two would be a fault; the newest is the one in use
  }

  // The figures of one shift, summed from the ledger's sales (those whose shiftId is this shift).
  // sales: ledger records. extra.out: cash paid out of the drawer so far, e.g. cash refunds (step 19), default 0.
  function summary(open, sales, extra) {
    extra = extra || {};
    const mine = (sales || []).filter(s => s && s.shiftId === open.shiftId).sort((a, b) => (a.at - b.at) || a.id.localeCompare(b.id));
    const by = {}; METHODS.forEach(m => { by[m] = 0; });
    let total = 0, credit = 0;
    mine.forEach(s => {
      total += toC(s.total); credit += toC(s.balance);
      arr(s.payments).forEach(p => { if (by[p.method] != null) by[p.method] += toC(p.amount); });
    });
    const out = toC(extra.out), fl = toC(open.float);
    const expected = fl + by.cash - out;
    const o = {};
    METHODS.forEach(m => { o[m] = by[m] / 100; });
    return {
      shiftId: open.shiftId, saleCount: mine.length, total: total / 100, credit: credit / 100, byMethod: o,
      float: fl / 100, cashSales: by.cash / 100, cashOut: out / 100, expectedCash: Math.max(0, expected) / 100,
      firstReceipt: mine.length ? mine[0].receiptNo : '', lastReceipt: mine.length ? mine[mine.length - 1].receiptNo : ''
    };
  }
  // variance of a count against the summary, in money (negative = short)
  const varianceOf = (sum, counted) => (toC(counted) - toC(sum.expectedCash)) / 100;

  // ══════════════════════════════════════════════════════════════════════════════
  // X AND Z REPORTS (roadmap step 17) — pure functions, nothing is stored
  // ══════════════════════════════════════════════════════════════════════════════
  // What was sold in a list of sales, one row per item: [{ itemId, name, unit, qty, total }], biggest value first.
  function itemsOf(sales) {
    const m = new Map();
    (sales || []).forEach(s => { if (s) arr(s.lines).forEach(l => {
      const k = String(l.itemId);
      const x = m.get(k) || { itemId: k, name: String(l.name || ''), unit: String(l.unit || ''), qty: 0, c: 0 };
      x.qty = Math.round((x.qty + (Number(l.qty) || 0)) * 1000) / 1000;
      x.c += toC(l.total);
      m.set(k, x);
    }); });
    return Array.from(m.values()).map(x => ({ itemId: x.itemId, name: x.name, unit: x.unit, qty: x.qty, total: x.c / 100 }))
      .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));
  }

  // Voids and refunds (returns.js records) summed: { count, voids, refunds, total, credit, money, byMethod }. `total` is the value taken back,
  // `credit` the part of it taken off customers' unpaid balances, `money` what was handed back (byMethod splits it).
  function returnsSummary(list) {
    const by = {}; METHODS.forEach(m => { by[m] = 0; });
    let voids = 0, refunds = 0, total = 0, credit = 0, money = 0;
    (list || []).forEach(r => {
      if (!r) return;
      if (r.kind === 'void') voids++; else refunds++;
      total += toC(r.total); credit += toC(r.creditApplied); money += toC(r.refunded);
      arr(r.refunds).forEach(p => { if (by[p.method] != null) by[p.method] += toC(p.amount); });
    });
    const o = {}; METHODS.forEach(m => { o[m] = by[m] / 100; });
    return { count: voids + refunds, voids, refunds, total: total / 100, credit: credit / 100, money: money / 100, byMethod: o };
  }

  // One shift's report.  kind 'X' (shift open) or 'Z' (shift closed).
  //   open   the shift's open record     sales   the ledger's records     o.close  its close record (needed for Z)
  //   o.out  cash paid out of the drawer so far (X only; step 19)           o.now    time the report is taken (X)
  //   o.returns  the ledger's return records (any; this shift's are picked by shiftId): adds r.rt and r.netTotal (step 19)
  // 'Z' takes every figure from the close record, because that is what was counted and signed off; the item list comes from the
  // ledger. itemsComplete says whether that list adds up to the Z's total: a phone that has not downloaded every sale of the
  // shift (a Z reprinted on another device) would otherwise print a list that disagrees with the totals, so it reports false.
  function report(kind, open, sales, o) {
    o = o || {};
    if (kind !== 'X' && kind !== 'Z') throw err('BAD_KIND', 'A report is X or Z');
    if (!open) throw err('NO_SHIFT', 'No shift to report on');
    const mine = (sales || []).filter(s => s && s.shiftId === open.shiftId).sort((a, b) => (a.at - b.at) || a.id.localeCompare(b.id));
    const items = itemsOf(mine);
    const base = { kind, shiftId: open.shiftId, till: open.till, tillId: open.tillId, cashier: open.cashier, openedAt: open.at, openedDate: open.date, openedTime: open.time };
    let r;
    if (kind === 'Z') {
      const c = o.close;
      if (!c) throw err('NO_CLOSE', 'This shift is not closed yet');
      const by = {}; METHODS.forEach(m => { by[m] = r2(Number((c.byMethod || {})[m]) || 0); });
      r = Object.assign(base, {
        closedAt: c.at, closedDate: c.date, closedTime: c.time, closedBy: c.closedBy, forced: !!c.forced,
        saleCount: c.saleCount, total: c.total, credit: c.credit, byMethod: by,
        float: c.float, cashSales: c.cashSales, cashOut: c.cashOut, expectedCash: c.expectedCash,
        countedCash: c.countedCash, variance: c.variance, firstReceipt: c.firstReceipt, lastReceipt: c.lastReceipt, note: c.note || ''
      });
    } else {
      const sm = summary(open, sales, { out: o.out });
      r = Object.assign(base, {
        takenAt: o.now || Date.now(), closedAt: null, closedBy: '', forced: false,
        saleCount: sm.saleCount, total: sm.total, credit: sm.credit, byMethod: sm.byMethod,
        float: sm.float, cashSales: sm.cashSales, cashOut: sm.cashOut, expectedCash: sm.expectedCash,
        countedCash: null, variance: null, firstReceipt: sm.firstReceipt, lastReceipt: sm.lastReceipt, note: ''
      });
    }
    let sumC = 0, qty = 0, change = 0, disc = 0, discN = 0;
    items.forEach(i => { sumC += toC(i.total); qty += i.qty; });
    mine.forEach(s => { change += toC(s.change); const d = toC(s.discount); if (d > 0) { disc += d; discN++; } });
    r.items = items;
    r.qtyTotal = Math.round(qty * 1000) / 1000;
    r.changeGiven = change / 100;
    r.discountGiven = disc / 100;            // roadmap step 18: already taken off `total`, shown so a manager can see how much was given
    r.discountCount = discN;
    r.itemsComplete = mine.length === r.saleCount && sumC === toC(r.total);
    r.rt = returnsSummary((o.returns || []).filter(x => x && x.shiftId === open.shiftId));   // step 19: voids and refunds paid out in this shift
    r.netTotal = (toC(r.total) - toC(r.rt.total)) / 100;
    return r;
  }

  // Everything of one date (YYYY-MM-DD, the ledger's own day), across all tills the phone knows about.
  //   events  shift opens and closes (create(env).all())    sales  the ledger's records
  // Returns the day's sales by method, the shifts counted on the day, and which shifts are still open.
  // ONE SHIFT, ONE DAY. A sale belongs to the date it was taken (its own `date`), so a shift that runs across UTC midnight (02:00
  // Zambia time) sells on two dates. The shift itself is listed on exactly one: the date it was CLOSED, because that is when its drawer
  // was counted and its variance became final; a shift still open is listed on the date it was OPENED. So a variance and a count are
  // never added into two days, and the close-out made after the count is the one that carries it. A closed shift's count covers ALL of
  // its sales, including cash taken on the earlier date; row.openedDate !== row.closedDate tells the caller that this is such a shift.
  //   openToday   shifts opened on this date and not closed (the main app refuses a day close-out while there are any)
  //   openEarlier shifts opened on an earlier date and still open (a warning, not a block: a till whose storage was wiped can leave one)
  //   cashSales   cash taken on the day's sales (cash payment lines; the float and the change given back are not in it)
  //   shiftVariance  sum of the closed shifts' variances (negative = short);  counted  sum of their counts less floats
  function dayReport(date, events, sales, returns) {
    const list = shiftsOf(events);
    const rt = returnsSummary((returns || []).filter(x => x && x.date === date));   // step 19: returns made on this date (their own day, whatever the sale's)
    const day = (sales || []).filter(s => s && s.date === date);
    const by = {}; METHODS.forEach(m => { by[m] = 0; });
    let total = 0, credit = 0, change = 0, noShift = 0, disc = 0, discN = 0;
    day.forEach(s => {
      total += toC(s.total); credit += toC(s.balance); change += toC(s.change);
      const d = toC(s.discount); if (d > 0) { disc += d; discN++; }
      if (!s.shiftId) noShift++;
      arr(s.payments).forEach(p => { if (by[p.method] != null) by[p.method] += toC(p.amount); });
    });
    const row = x => ({
      shiftId: x.open.shiftId, till: x.open.till, cashier: x.open.cashier, openedDate: x.open.date, openedTime: x.open.time,
      closed: !!x.close, closedDate: x.close ? x.close.date : '', closedTime: x.close ? x.close.time : '',
      closedBy: x.close ? x.close.closedBy : '', forced: x.close ? !!x.close.forced : false,
      float: x.open.float, expectedCash: x.close ? x.close.expectedCash : null,
      countedCash: x.close ? x.close.countedCash : null, variance: x.close ? x.close.variance : null
    });
    const dayOfShift = x => (x.close ? x.close.date : x.open.date);   // the ONE day a shift is listed on
    const inDay = list.filter(x => dayOfShift(x) === date);
    const rows = inDay.map(row);
    const openNow = list.filter(x => !x.close);
    let varC = 0, countedC = 0;
    rows.forEach(r => { if (r.closed) { varC += toC(r.variance); countedC += toC(r.countedCash) - toC(r.float); } });
    const o = {}; METHODS.forEach(m => { o[m] = by[m] / 100; });
    return {
      date, saleCount: day.length, total: total / 100, credit: credit / 100, byMethod: o,
      cashSales: by.cash / 100, nonCash: (by.mtn + by.airtel + by.card) / 100, changeGiven: change / 100, noShift,
      discountGiven: disc / 100, discountCount: discN,    // already taken off `total` (step 18)
      returns: rt, cashOut: rt.byMethod.cash, netTotal: (total - toC(rt.total)) / 100,   // step 19: voids and refunds made today; cash handed back; sales less returns
      shifts: rows, openToday: openNow.filter(x => x.open.date === date).map(row), openEarlier: openNow.filter(x => x.open.date < date).map(row),
      shiftVariance: varC / 100, counted: countedC / 100, items: itemsOf(day)
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // THE TILL'S LINES FOR THE AUDIT LOG (roadmap step 20) — a pure function, nothing is stored
  // ══════════════════════════════════════════════════════════════════════════════
  // events  shift records and audit records (create(env).all())    sales  the sales ledger    returns  the voids and refunds
  // o.money  how to write an amount (the main app passes its zm); default is two decimals.
  // Returns entries shaped exactly like the ones logAuditEvent() writes into DATA.auditLog, plus src:'till', oldest first:
  //   { id, ts (ISO), date, time, user, role, action, entity, detail, src }
  // The id is built from the record's own id, so the same record is always the same entry, whoever builds the list.
  //   OPEN  Till Shift     CLOSE  Till Shift (variance; forced = closed by someone other than the opener)
  //   DISCOUNT  Till Sale  (every sale with a discount: who allowed it, the reason)
  //   VOID / REFUND  Till Sale  (reason, who allowed it, money back)
  //   REPORT  X Report / Z Report      APPROVE  Till Exit PIN      DENY  Manager PIN (wrong PIN / pad locked)
  function auditEntries(events, sales, returns, o) {
    o = o || {};
    const money = typeof o.money === 'function' ? o.money : (n => (Number(n) || 0).toFixed(2));
    const out = [];
    const add = (id, at, date, time, user, role, action, entity, detail) => {
      if (!isNum(at) || at <= 0) return;
      out.push({ id, ts: new Date(at).toISOString(), date: String(date || ''), time: String(time || ''), user: user ? String(user) : '\u2014', role: role ? String(role) : '', action, entity, detail, src: 'till' });
    };
    const opens = new Map();
    (events || []).forEach(e => { if (e && e.type === OPEN) opens.set(e.shiftId, e); });
    const who = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
    (events || []).forEach(e => {
      if (!e) return;
      if (e.type === OPEN) {
        add('T:open:' + e.id, e.at, e.date, e.time, e.cashier, e.cashierRole, 'OPEN', 'Till Shift',
          e.shiftId + ' \u00B7 Till ' + e.till + ' \u00B7 Float: ' + money(e.float));
      } else if (e.type === CLOSE) {
        const op = opens.get(e.shiftId), v = Number(e.variance) || 0;
        const vs = toC(v) === 0 ? 'balanced' : v < 0 ? 'SHORT ' + money(-v) : 'OVER ' + money(v);
        add('T:close:' + e.id, e.at, e.date, e.time, e.closedBy, e.closedByRole, 'CLOSE', 'Till Shift',
          e.shiftId + ' \u00B7 Expected: ' + money(e.expectedCash) + ' \u00B7 Counted: ' + money(e.countedCash) + ' \u00B7 ' + vs
          + (e.forced ? ' \u00B7 FORCED: closed by ' + e.closedBy + (op ? ' for ' + op.cashier + '\u2019s shift' : '') : '')
          + (e.note ? ' \u00B7 Note: ' + e.note : ''));
      } else if (e.type === AUDIT) {
        const sh = e.shiftId ? ' \u00B7 Shift: ' + e.shiftId : '', nt = e.note ? ' \u00B7 ' + e.note : '';
        if (e.event === 'x_report') add('T:audit:' + e.id, e.at, e.date, e.time, e.user, e.role, 'REPORT', 'X Report', 'X report taken' + sh + nt);
        else if (e.event === 'z_report') add('T:audit:' + e.id, e.at, e.date, e.time, e.user, e.role, 'REPORT', 'Z Report', (e.what === 'copy' ? 'Z report reprinted (COPY)' : 'Z report shown') + sh + nt);
        else if (e.event === 'exit_ok') add('T:audit:' + e.id, e.at, e.date, e.time, e.user, e.role, 'APPROVE', 'Till Exit PIN',
          (e.approver || 'A manager') + ' allowed ' + e.user + ' to ' + (e.what || 'leave the till') + sh + nt);
        else if (e.event === 'pin_fail') add('T:audit:' + e.id, e.at, e.date, e.time, e.user, e.role, 'DENY', 'Manager PIN', 'Wrong PIN typed to ' + (e.what || 'unlock the pad') + sh + nt);
        else if (e.event === 'pin_lock') add('T:audit:' + e.id, e.at, e.date, e.time, e.user, e.role, 'DENY', 'Manager PIN', 'PIN pad locked after too many wrong PINs (to ' + (e.what || 'unlock the pad') + ')' + sh + nt);
      }
    });
    (sales || []).forEach(s => {
      if (!s || !(toC(s.discount) > 0)) return;
      const gross = (toC(s.total) + toC(s.discount)) / 100, pct = Math.round(toC(s.discount) / (toC(s.total) + toC(s.discount)) * 10000) / 100;
      const by = String(s.discountBy || '');
      add('T:disc:' + s.id, s.at, s.date, s.time, s.cashier, s.cashierRole, 'DISCOUNT', 'Till Sale',
        (s.receiptNo || s.id) + ' \u00B7 ' + money(s.discount) + ' off ' + money(gross) + ' (' + pct + '%) \u00B7 Allowed by: ' + (by || '\u2014') + (by && !who(by, s.cashier) ? ' (manager PIN)' : '')
        + (s.discountReason ? ' \u00B7 Reason: ' + s.discountReason : ''));
    });
    (returns || []).forEach(r => {
      if (!r) return;
      const isVoid = r.kind === 'void';
      add('T:ret:' + r.id, r.at, r.date, r.time, r.cashier, r.cashierRole, isVoid ? 'VOID' : 'REFUND', 'Till Sale',
        r.id + ' on sale ' + r.saleId + ' \u00B7 ' + money(r.total) + (isVoid ? ' (whole sale)' : ' (' + (r.lineCount || '?') + ' line' + (r.lineCount === 1 ? '' : 's') + ')')
        + ' \u00B7 Reason: ' + (r.reason || '\u2014') + ' \u00B7 Allowed by: ' + (r.approvedBy || '\u2014')
        + (Number(r.refunded) > 0 ? ' \u00B7 Paid back: ' + money(r.refunded) : '') + (Number(r.creditApplied) > 0 ? ' \u00B7 Off customer balance: ' + money(r.creditApplied) : '')
        + (r.note ? ' \u00B7 ' + r.note : ''));
    });
    return out.sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STORAGE ADAPTERS — every method is async; d = depot key
  //   add(d, kind, rec)        save AND queue for upload in one transaction; EXISTS if (kind, id) is taken
  //   all(d)                   every event (opens and closes)
  //   addMany(d, recs, queue)  add those not stored yet, return how many
  //   outbox(d) / unqueue(d, kind, id) / bump(d, kind, id, err)
  //   getMeta(k) / setMeta(k, v)
  // ══════════════════════════════════════════════════════════════════════════════
  function memAdapter() {
    const ev = new Map(), outbox = new Map(), meta = new Map();
    const K = (d, kind, id) => d + '|' + kind + '|' + id;
    const clone = x => JSON.parse(JSON.stringify(x));
    return {
      async add(d, kind, rec) {
        if (ev.has(K(d, kind, rec.id))) throw err('EXISTS', 'This shift record is already saved');
        ev.set(K(d, kind, rec.id), clone(rec));
        outbox.set(K(d, kind, rec.id), { d, kind, id: rec.id, tries: 0, err: '' });
      },
      async all(d) { const o = []; ev.forEach((r, k) => { if (k.startsWith(d + '|')) o.push(clone(r)); }); return o; },
      async addMany(d, recs, queue) {
        let n = 0;
        recs.forEach(rec => {
          const k = K(d, rec.type, rec.id);
          if (ev.has(k)) return;
          ev.set(k, clone(rec));
          if (queue) outbox.set(k, { d, kind: rec.type, id: rec.id, tries: 0, err: '' });
          n++;
        });
        return n;
      },
      async get(d, kind, id) { const r = ev.get(K(d, kind, id)); return r ? clone(r) : null; },
      async outbox(d) { const o = []; outbox.forEach(q => { if (q.d === d) o.push({ kind: q.kind, id: q.id, tries: q.tries, err: q.err }); }); return o; },
      async unqueue(d, kind, id) { outbox.delete(K(d, kind, id)); },
      async bump(d, kind, id, e) { const q = outbox.get(K(d, kind, id)); if (q) { q.tries++; q.err = String(e || ''); } },
      async getMeta(k) { return meta.has(k) ? meta.get(k) : null; },
      async setMeta(k, v) { meta.set(k, v); },
    };
  }

  function idbAdapter(idb) {
    idb = idb || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      if (!idb) return Promise.reject(err('STORAGE', 'IndexedDB is not available'));
      dbp = new Promise((res, rej) => {
        let q;
        try { q = idb.open('mdm_shifts', 1); } catch (e) { dbp = null; return rej(err('STORAGE', 'Could not open the shift store')); }
        q.onupgradeneeded = () => {
          const db = q.result;
          db.createObjectStore('ev', { keyPath: 'k' }).createIndex('depot', 'depot');
          db.createObjectStore('outbox', { keyPath: 'k' }).createIndex('depot', 'depot');
          db.createObjectStore('meta', { keyPath: 'k' });
        };
        q.onsuccess = () => { const db = q.result; db.onversionchange = () => { try { db.close(); } catch (e) {} dbp = null; }; res(db); };
        q.onerror = () => { dbp = null; rej(err('STORAGE', 'Could not open the shift store')); };
      });
      return dbp;
    }
    const wait = tx => new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error || err('STORAGE', 'Could not save'));
      tx.onabort = () => rej(tx.error || err('STORAGE', 'Could not save'));
    });
    const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || err('STORAGE', 'Could not read')); });
    function tx(db, names, mode) {
      try { return db.transaction(names, mode, { durability: 'strict' }); } catch (e) { return db.transaction(names, mode); }
    }
    const K = (d, kind, id) => d + '|' + kind + '|' + id;
    return {
      async add(d, kind, rec) {
        const db = await open(), t = tx(db, ['ev', 'outbox'], 'readwrite'), k = K(d, kind, rec.id);
        let dup = false;
        const a = t.objectStore('ev').add({ k, depot: d, kind, id: rec.id, rec });
        a.onerror = e => { dup = true; e.preventDefault(); try { t.abort(); } catch (x) {} };
        t.objectStore('outbox').put({ k, depot: d, kind, id: rec.id, tries: 0, err: '' });
        try { await wait(t); } catch (e) { throw dup ? err('EXISTS', 'This shift record is already saved') : (e && e.code ? e : err('STORAGE', 'Could not save the shift')); }
      },
      async all(d) {
        const db = await open(), rows = await req(tx(db, ['ev'], 'readonly').objectStore('ev').index('depot').getAll(d));
        return rows.map(x => x.rec);
      },
      async get(d, kind, id) {
        const db = await open(), r = await req(tx(db, ['ev'], 'readonly').objectStore('ev').get(K(d, kind, id)));
        return r ? r.rec : null;
      },
      async addMany(d, recs, queue) {
        if (!recs.length) return 0;
        const db = await open(), t = tx(db, queue ? ['ev', 'outbox'] : ['ev'], 'readwrite');
        let n = 0;
        recs.forEach(rec => {
          const k = K(d, rec.type, rec.id);
          const a = t.objectStore('ev').add({ k, depot: d, kind: rec.type, id: rec.id, rec });
          a.onsuccess = () => { n++; if (queue) t.objectStore('outbox').put({ k, depot: d, kind: rec.type, id: rec.id, tries: 0, err: '' }); };
          a.onerror = e => e.preventDefault();
        });
        await wait(t);
        return n;
      },
      async outbox(d) {
        const db = await open(), rows = await req(tx(db, ['outbox'], 'readonly').objectStore('outbox').index('depot').getAll(d));
        return rows.map(q => ({ kind: q.kind, id: q.id, tries: q.tries || 0, err: q.err || '' }));
      },
      async unqueue(d, kind, id) { const db = await open(), t = tx(db, ['outbox'], 'readwrite'); t.objectStore('outbox').delete(K(d, kind, id)); await wait(t); },
      async bump(d, kind, id, e) {
        const db = await open(), t = tx(db, ['outbox'], 'readwrite'), s = t.objectStore('outbox'), k = K(d, kind, id);
        const g = s.get(k);
        g.onsuccess = () => { const q = g.result; if (q) { q.tries = (q.tries || 0) + 1; q.err = String(e || ''); s.put(q); } };
        await wait(t);
      },
      async getMeta(k) { const db = await open(), r = await req(tx(db, ['meta'], 'readonly').objectStore('meta').get(k)); return r ? r.v : null; },
      async setMeta(k, v) { const db = await open(), t = tx(db, ['meta'], 'readwrite'); t.objectStore('meta').put({ k, v }); await wait(t); },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // THE STORE
  //   env = { depotKey(), adapter?, opts? }     opts is passed to openRecord / closeRecord (dateOf / timeOf)
  //   cloud = { get(path), putIfAbsent(path, obj), query(path, queryString) }   (Gate.restCloud gives exactly this)
  // ══════════════════════════════════════════════════════════════════════════════
  function create(env) {
    const A = env.adapter || idbAdapter();
    const depot = () => String(env.depotKey() || '');
    const need = () => { const d = depot(); if (!d) throw err('NO_DEPOT', 'No depot yet'); return d; };

    async function all() { return (await A.all(need())).sort((a, b) => (a.at - b.at) || String(a.id).localeCompare(String(b.id)) || (a.type < b.type ? -1 : 1)); }
    async function pending() { return (await A.outbox(need())).length; }

    // The shift this till (tillId) has open right now: { open, close:null } or null.
    async function current(tillId) { return openShiftOf(await all(), tillId); }

    // Open a shift. till = { code, tillId } from Gate.receiptNumbering().peek(); who = { username, role }; float in money.
    // Refuses with ALREADY_OPEN (err.shift = the open one) while this till has one open.
    async function open(till, who, floatAmt, now) {
      const d = need();
      if (!till || !till.code || !till.tillId || !till.registered) throw err('NOT_REGISTERED', 'This till has not claimed its code yet');
      const f = Number(floatAmt);
      if (!isNum(f) || f < 0 || f > MAX_MONEY) throw err('BAD_FLOAT', 'Type the float as an amount, 0 or more');
      const events = await all();
      const mineOpen = openShiftOf(events, till.tillId);
      if (mineOpen) throw err('ALREADY_OPEN', 'This till already has an open shift', { shift: mineOpen });
      const seq = 1 + events.filter(e => e.type === OPEN && e.till === till.code).reduce((m, e) => Math.max(m, e.seq), 0);
      const rec = openRecord({ till: till.code, tillId: till.tillId, seq, at: now || Date.now(), cashier: who.username, cashierRole: who.role, float: f }, env.opts);
      const bad = validateOpen(rec);
      if (bad) throw err('INVALID', 'The shift is not valid: ' + bad);
      try { await A.add(d, OPEN, rec); }
      catch (e) {
        if (e && e.code === 'EXISTS') { const again = openShiftOf(await all(), till.tillId); if (again) throw err('ALREADY_OPEN', 'This till already has an open shift', { shift: again }); }
        throw e;
      }
      return rec;
    }

    // Close the open shift. sales = the ledger's records. count = money counted in the drawer. who = the person closing.
    // forced is worked out here: true when the closer is not the opener. note = optional text.
    async function close(shift, sales, count, who, note, extra, now) {
      const d = need();
      const c = Number(count);
      if (!isNum(c) || c < 0 || c > MAX_MONEY) throw err('BAD_COUNT', 'Type the cash you counted, 0 or more');
      const events = await all();
      const live = shiftsOf(events).find(s => s.open.shiftId === shift.open.shiftId);
      if (!live) throw err('NO_SHIFT', 'That shift is not on this phone');
      if (live.close) throw err('ALREADY_CLOSED', 'That shift is already closed', { shift: live });
      const sum = summary(live.open, sales, extra);
      const rec = closeRecord(Object.assign({}, sum, {
        at: now || Date.now(), till: live.open.till, tillId: live.open.tillId,
        closedBy: who.username, closedByRole: who.role, forced: String(who.username).toLowerCase() !== String(live.open.cashier).toLowerCase(),
        countedCash: r2(c), variance: varianceOf(sum, c), note
      }), env.opts);
      const bad = validateClose(rec);
      if (bad) throw err('INVALID', 'The close is not valid: ' + bad);
      try { await A.add(d, CLOSE, rec); }
      catch (e) { if (e && e.code === 'EXISTS') throw err('ALREADY_CLOSED', 'That shift is already closed'); throw e; }
      return rec;
    }

    // Record something the till did that leaves no other record (step 20; see THE TILL'S AUDIT TRAIL above). event is one of
    // AUDIT_EVENTS; extra = { shiftId?, what?, approver?, note? }; who = { username, role }. Throws like open() and close() do, so the
    // caller decides what to do: the till treats it as best effort and never lets a failed log stop a sale or a PIN.
    async function log(till, who, event, extra, now) {
      const d = need();
      if (!till || !till.code || !till.tillId || !till.registered) throw err('NOT_REGISTERED', 'This till has not claimed its code yet');
      if (!who || !who.username) throw err('NO_USER', 'Nobody is signed in');
      const x = extra || {};
      for (let attempt = 0; attempt < 3; attempt++) {         // two entries in the same millisecond differ by their random tail
        const rnd = env.opts && typeof env.opts.rand === 'function' ? env.opts.rand() : Math.random().toString(36).slice(2, 5).padEnd(3, '0');
        const rec = auditRecord({ till: till.code, tillId: till.tillId, at: now || Date.now(), user: who.username, role: who.role, event,
          shiftId: x.shiftId, what: x.what, approver: x.approver, note: x.note, rnd }, env.opts);
        const bad = validateAudit(rec);
        if (bad) throw err('INVALID', 'The audit entry is not valid: ' + bad);
        try { await A.add(d, AUDIT, rec); return rec; }
        catch (e) { if (!(e && e.code === 'EXISTS')) throw e; }
      }
      throw err('EXISTS', 'Could not find a free audit number');
    }

    // Upload this device's outbox. Opens go before closes (a close is only valid once its open is in the cloud); audit records last.
    async function push(cloud) {
      const rank = k => (k === OPEN ? 0 : k === CLOSE ? 1 : 2);
      const d = need(), queue = (await A.outbox(d)).sort((a, b) => rank(a.kind) - rank(b.kind));
      let sent = 0, lastErr = '';
      for (const q of queue) {
        const rec = await A.get(d, q.kind, q.id);
        if (!rec) { await A.unqueue(d, q.kind, q.id); continue; }
        const path = 'depots/' + d + '/' + COLL[q.kind] + '/' + q.id;
        try { await cloud.putIfAbsent(path, forCloud(rec)); await A.unqueue(d, q.kind, q.id); sent++; continue; }
        catch (e) {
          const c = (e && e.code) || 'error';
          if (c === 'NETWORK' || c === 'NO_AUTH') { lastErr = c; break; }
          let there = null;
          try { there = await cloud.get(path); } catch (e2) { lastErr = (e2 && e2.code) || 'error'; if (lastErr === 'NETWORK' || lastErr === 'NO_AUTH') break; await A.bump(d, q.kind, q.id, lastErr); continue; }
          if (there && typeof there === 'object' && there.tillId === rec.tillId && there.at === rec.at) { await A.unqueue(d, q.kind, q.id); sent++; }
          else { lastErr = c; await A.bump(d, q.kind, q.id, c); }
        }
      }
      return { sent, left: (await A.outbox(d)).length, error: lastErr };
    }

    // Download the other tills' shift records (both kinds), incrementally.
    async function pullKind(cloud, kind) {
      const d = need(), ck = 'cursor:' + kind + ':' + d;
      let cursor = Number(await A.getMeta(ck)) || 0, start = cursor ? Math.max(0, cursor - OVERLAP_MS) : 0, added = 0, bad = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await cloud.query('depots/' + d + '/' + COLL[kind], 'orderBy=' + encodeURIComponent('"createdAt"') + '&startAt=' + start + '&limitToFirst=' + PAGE);
        const ids = res && typeof res === 'object' ? Object.keys(res) : [];
        if (!ids.length) break;
        const good = []; let maxC = start;
        ids.forEach(id => {
          const x = fromCloud(kind, id, res[id]);
          if (x.rec) good.push(x.rec); else bad++;
          if (x.createdAt > maxC) maxC = x.createdAt;
        });
        added += await A.addMany(d, good, false);
        if (maxC > cursor) cursor = maxC;
        if (ids.length < PAGE || maxC <= start) break;
        start = maxC;
      }
      await A.setMeta(ck, cursor);
      return { added, bad };
    }
    async function pull(cloud) {
      const a = await pullKind(cloud, OPEN), b = await pullKind(cloud, CLOSE), c = await pullKind(cloud, AUDIT);   // audit last: if its rules are not published yet, the shifts above are already in
      return { added: a.added + b.added + c.added, bad: a.bad + b.bad + c.bad };
    }

    return { all, pending, current, open, close, log, push, pull };
  }

  return { V, SID_RE, AID_RE, METHODS, AUDIT_EVENTS, openRecord, closeRecord, auditRecord, validateOpen, validateClose, validateAudit, forCloud, fromCloud, shiftsOf, openShiftOf, summary, varianceOf, itemsOf, report, dayReport, returnsSummary, auditEntries, create, memAdapter, idbAdapter };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Shifts; // lets Node load it for tests
