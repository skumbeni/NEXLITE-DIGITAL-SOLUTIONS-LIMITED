/*!
 * returns.js — voids and refunds: new append-only records, each linked to the sale it reverses. ONE copy, loaded by both
 * index.html and pos.html (roadmap step 19).
 *
 * WHAT IT IS
 *   A sale (sales.js) is never edited or deleted. When something has to be taken back, the till writes a NEW record that points at
 *   the sale:   returns/{returnId}   returnId = <till code>-R<number>, e.g. K7F2-R000125 (the number comes from the same per-till
 *   counter as receipt numbers, so two tills can never collide; a refund therefore uses up a number of the till's series).
 *     VOID    the whole sale, taken back in full, in the shift it was sold in. Money goes back the way it came (cash as cash, MTN as MTN).
 *     REFUND  some or all of the lines, at any time. The money goes back by any method the cashier picks, never more than was paid.
 *   Like sales and shifts, returns live OUTSIDE the DATA blob, so two tills can never overwrite each other.
 *
 * WHAT A RECORD HOLDS
 *   { v:1, id, kind:'void'|'refund', till, tillId, seq, saleId,                  saleId = the receipt number of the sale
 *     at, date, time, cashier, cashierRole,                                        who took it at the till
 *     approvedBy,                                                                   the manager who allowed it: a PIN holder's PIN, or the Admin / Manager who did it themselves
 *     shiftId (optional),                                                           the shift whose drawer paid it out
 *     reason (required, a short phrase), note (optional),
 *     lines:[{lineNo, itemId, kind, name, unit, qty, price, total, discount?, restock}],   lineNo = which line of the sale; price copied from it;
 *                                                                                           total = what that quantity was really worth (after any discount)
 *     lineCount, qtyTotal, total,                                                   total = value taken back
 *     creditApplied,                                                                part of it taken off the customer's UNPAID balance (cleared first)
 *     refunds:[{method, label, amount, ref}], refunded,                             the rest, handed back as money
 *     customerId, customerName }                                                    copied from the sale (needed when a balance is cleared)
 *   Always:  total = creditApplied + refunded.   restock:false means the goods came back damaged: they do not go back into stock.
 *
 * WHAT THE REST OF THE APP DOES WITH THEM (nothing is stored but the records; every figure is summed from them)
 *   STOCK      stock = received - issued - sold + returns. forStock() gives stockBook / batchBook the restocked lines.
 *   DRAWER     cashOutOf(shiftId) = cash handed back in that shift. shifts.js takes it as `out`: expected cash = float + cash sales - cash out.
 *   REPORTS    A return is booked on the day it is made, never back-dated onto the sale's day, so a closed day / closed shift is never
 *              changed. sales.js issuedRows() turns each return into NEGATIVE rows for the main app (so revenue, customer balances and
 *              cash/credit splits come out net), shifts.js dayReport() and report() show them, the Z / close-out subtracts the cash.
 *   LIMIT      A phone can only check a return against the returns IT knows. Two tills that return the same item at the same moment,
 *              both offline, can each be right locally and together give back more than was sold. overReturned() finds those afterwards.
 *
 * WHERE A RECORD LIVES
 *   1. On the device: IndexedDB database "mdm_returns" (stores: ev, outbox, meta). Saved together with its "still to upload" mark in one
 *      transaction, BEFORE the receipt is shown. A separate database from "mdm_sales" and "mdm_shifts", so a schema change in one can never
 *      block the others.
 *   2. In the cloud: depots/<depot>/returns/<id>, create-only (database_rules.json), and only once the sale it points at is there. Each device
 *      uploads its own outbox whenever it is online and downloads the other tills' records incrementally by the server's createdAt time.
 *
 * Plain classic script, no dependencies, one global: Returns. Load it with a normal <script src="returns.js"></script> after sales.js.
 * Add returns.js to the precache list in sw.js, otherwise the till cannot start offline. Storage and network are injected, so Node can test this
 * file (see create(env) and memAdapter()).
 */
const Returns = (function () {
  'use strict';

  const V = 1;                                              // record format version
  const ID_RE   = /^[A-HJ-KM-NP-Z2-9]{4}-R[0-9]{6,9}$/;     // return id
  const SALE_RE = /^[A-HJ-KM-NP-Z2-9]{4}-[0-9]{6,9}$/;      // receipt number = sale id
  const TILL_RE = /^[A-HJ-KM-NP-Z2-9]{4}$/;
  const TID_RE  = /^[0-9a-f]{24}$/;
  const SID_RE  = /^[A-HJ-KM-NP-Z2-9]{4}-S[0-9]{4,9}$/;
  const KINDS   = ['void', 'refund'];
  const METHODS = ['cash', 'mtn', 'airtel', 'card'];
  const REASONS = ['Customer changed their mind', 'Wrong item', 'Damaged or faulty', 'Expired', 'Wrong price', 'Cashier error', 'Other'];
  const NO_RESTOCK = ['Damaged or faulty', 'Expired'];       // reasons whose goods usually cannot be sold again: the till unticks "back to stock"
  const MAX_LINES = 200, MAX_REFUNDS = 20;
  const PAGE = 300, MAX_PAGES = 40, OVERLAP_MS = 60000;
  const QTY_EPS = 0.0005;

  const isNum = x => typeof x === 'number' && isFinite(x);
  const r2 = n => Math.round(n * 100) / 100;
  const r3 = n => Math.round(n * 1000) / 1000;
  const toC = n => Math.round((Number(n) || 0) * 100);
  const str = (x, n) => (x == null ? '' : String(x)).slice(0, n);
  function err(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
  const arr = x => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : []);
  const zero = () => { const o = {}; METHODS.forEach(m => { o[m] = 0; }); return o; };

  // 'K7F2-000125' (the number the till's counter hands out) -> 'K7F2-R000125'
  const idFromNumber = receiptNo => String(receiptNo).slice(0, 5) + 'R' + String(receiptNo).slice(5);

  // ══════════════════════════════════════════════════════════════════════════════
  // THE RECORD
  // ══════════════════════════════════════════════════════════════════════════════
  function toRecord(b, opts) {
    opts = opts || {};
    const at = Math.round(Number(b.at));
    const dateOf = opts.dateOf || (t => new Date(t).toISOString().slice(0, 10));
    const timeOf = opts.timeOf || (t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); });
    const rec = {
      v: V, id: String(b.id), kind: String(b.kind), till: String(b.till), tillId: String(b.tillId), seq: Number(b.seq), saleId: String(b.saleId),
      at, date: dateOf(at), time: timeOf(at),
      cashier: str(b.cashier, 80), cashierRole: str(b.cashierRole, 20), approvedBy: str(b.approvedBy, 80),
      shiftId: str(b.shiftId, 24), reason: str(b.reason, 60), note: str(b.note, 200),
      lines: arr(b.lines).map(l => {
        const o = {
          lineNo: Number(l.lineNo), itemId: str(l.itemId, 80), kind: l.kind === 'commodity' ? 'commodity' : 'item', name: str(l.name, 200), unit: str(l.unit, 40),
          qty: Number(l.qty), price: Number(l.price), total: Number(l.total), restock: l.restock !== false
        };
        const d = Number(l.discount);
        if (isNum(d) && d > 0) o.discount = d;
        return o;
      }),
      lineCount: Number(b.lineCount), qtyTotal: Number(b.qtyTotal), total: Number(b.total),
      creditApplied: Number(b.creditApplied) || 0,
      refunds: arr(b.refunds).map(p => ({ method: String(p.method), label: str(p.label, 40), amount: Number(p.amount), ref: str(p.ref, 100) })),
      refunded: Number(b.refunded) || 0,
      customerId: str(b.customerId, 80), customerName: str(b.customerName, 200)
    };
    if (!rec.shiftId) delete rec.shiftId;
    if (!rec.note) delete rec.note;
    return JSON.parse(JSON.stringify(rec));
  }

  // '' when the record is sound on its own, otherwise why not. (check() below compares it with the sale.)
  function validate(s) {
    if (!s || typeof s !== 'object') return 'not a record';
    if (!ID_RE.test(String(s.id))) return 'bad return number';
    if (KINDS.indexOf(s.kind) < 0) return 'bad kind';
    if (!TILL_RE.test(String(s.till)) || String(s.id).slice(0, 4) !== s.till) return 'bad till code';
    if (!TID_RE.test(String(s.tillId))) return 'bad till id';
    if (!Number.isInteger(s.seq) || s.seq < 1 || Number(String(s.id).slice(6)) !== s.seq) return 'bad sequence';
    if (!SALE_RE.test(String(s.saleId))) return 'bad sale reference';
    if (!isNum(s.at) || s.at <= 0) return 'bad time';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) || !/^\d{2}:\d{2}$/.test(String(s.time))) return 'bad date';
    if (typeof s.cashier !== 'string' || !s.cashier || s.cashier.length > 80) return 'bad cashier';
    if (typeof s.approvedBy !== 'string' || !s.approvedBy || s.approvedBy.length > 80) return 'a return needs the person who allowed it';
    if (s.shiftId !== undefined && (!SID_RE.test(String(s.shiftId)) || String(s.shiftId).slice(0, 4) !== s.till)) return 'bad shift id';
    if (typeof s.reason !== 'string' || !s.reason.trim() || s.reason.length > 60) return 'a return needs a reason';
    if (s.note !== undefined && (typeof s.note !== 'string' || s.note.length > 200)) return 'bad note';
    const lines = s.lines;
    if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) return 'bad lines';
    let sum = 0, qty = 0;
    const seen = new Set();
    for (const l of lines) {
      if (!l || !Number.isInteger(l.lineNo) || l.lineNo < 0 || l.lineNo >= MAX_LINES) return 'bad line number';
      if (seen.has(l.lineNo)) return 'a line is returned twice';
      seen.add(l.lineNo);
      if (typeof l.itemId !== 'string' || !l.itemId || l.itemId.length > 80) return 'bad item id';
      if (l.kind !== 'item' && l.kind !== 'commodity') return 'bad item kind';
      if ((l.kind === 'commodity') !== /^com:./.test(l.itemId)) return 'item kind does not match its id';
      if (typeof l.name !== 'string' || !l.name || l.name.length > 200) return 'bad item name';
      if (typeof l.restock !== 'boolean') return 'bad restock flag';
      if (!isNum(l.qty) || !(l.qty > 0) || !isNum(l.price) || l.price < 0 || !isNum(l.total) || l.total < 0) return 'bad line amounts';
      const dsc = l.discount === undefined ? 0 : l.discount;
      if (!isNum(dsc) || dsc < 0 || Math.abs(dsc * 100 - Math.round(dsc * 100)) > 1e-6) return 'bad line discount';
      const gross = r2(l.price * l.qty);
      if (dsc > gross + 0.005) return 'a line discount is more than the line';
      if (Math.abs(l.total - r2(gross - dsc)) > 0.005) return 'line total does not match price × qty less the discount';
      sum += toC(l.total); qty += l.qty;
    }
    if (!isNum(s.total) || toC(s.total) !== sum) return 'total does not match the lines';
    if (s.lineCount !== lines.length) return 'bad line count';
    if (!isNum(s.qtyTotal) || Math.abs(s.qtyTotal - r3(qty)) > 0.0015) return 'bad quantity total';
    if (!isNum(s.creditApplied) || s.creditApplied < 0) return 'bad credit amount';
    if (!isNum(s.refunded) || s.refunded < 0) return 'bad refund amount';
    const refunds = s.refunds === undefined ? [] : s.refunds;
    if (!Array.isArray(refunds) || refunds.length > MAX_REFUNDS) return 'bad refunds';
    let paid = 0;
    for (const p of refunds) {
      if (!p || METHODS.indexOf(p.method) < 0 || !isNum(p.amount) || !(p.amount > 0)) return 'bad refund line';
      if (typeof p.ref !== 'string' || p.ref.length > 100) return 'bad refund reference';
      paid += toC(p.amount);
    }
    if (toC(s.refunded) !== paid) return 'refunds do not add up';
    if (toC(s.creditApplied) + toC(s.refunded) !== toC(s.total)) return 'credit + money back does not match the total';
    if (typeof s.customerId !== 'string' || typeof s.customerName !== 'string') return 'bad customer';
    if (s.creditApplied > 0 && !s.customerId) return 'clearing a balance needs a customer';
    return '';
  }

  // The copy that goes to the cloud: the record plus the SERVER's clock (what pulls are ordered by). The id is the node's key.
  function forCloud(rec) { const o = Object.assign({}, rec, { createdAt: { '.sv': 'timestamp' } }); delete o.id; return o; }
  function fromCloud(id, o) {
    if (!o || typeof o !== 'object') return { rec: null, createdAt: 0 };
    const createdAt = isNum(o.createdAt) ? o.createdAt : 0;
    const rec = Object.assign({}, o);
    delete rec.createdAt;
    rec.id = id;
    rec.lines = arr(rec.lines);
    rec.refunds = arr(rec.refunds);                         // an empty array is not stored: it comes back as nothing
    ['customerId', 'customerName', 'cashierRole'].forEach(k => { if (rec[k] == null) rec[k] = ''; });
    rec.lines.forEach(l => { if (l && l.unit == null) l.unit = ''; });
    rec.refunds.forEach(p => { if (p && p.ref == null) p.ref = ''; });
    return { rec: validate(rec) ? null : rec, createdAt };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // WHAT CAN STILL BE TAKEN BACK  (pure functions, shared by the till and the Node tests)
  // ══════════════════════════════════════════════════════════════════════════════
  // The state of one sale after the returns already made against it.
  //   lines[i]    { lineNo, itemId, kind, name, unit, price, qty (still returnable), valueC (its money, ngwee), soldQty, soldC, usedQty }
  //   balanceC    what the customer still owes on the sale (a return clears this first)
  //   paidC       money the customer paid that has not been handed back yet (a refund can never give back more)
  //   paidBy / refundedBy   per method, ngwee
  function remaining(sale, returns) {
    const lines = arr(sale.lines), mine = arr(returns).filter(r => r && r.saleId === sale.id);
    const used = lines.map(() => ({ qty: 0, c: 0 }));
    let credit = 0, out = 0;
    const refundedBy = zero(), paidBy = zero();
    mine.forEach(r => {
      arr(r.lines).forEach(l => { const u = used[l.lineNo]; if (u) { u.qty += Number(l.qty) || 0; u.c += toC(l.total); } });
      credit += toC(r.creditApplied); out += toC(r.refunded);
      arr(r.refunds).forEach(p => { if (refundedBy[p.method] != null) refundedBy[p.method] += toC(p.amount); });
    });
    arr(sale.payments).forEach(p => { if (paidBy[p.method] != null) paidBy[p.method] += toC(p.amount); });
    return {
      lines: lines.map((l, i) => ({
        lineNo: i, itemId: l.itemId, kind: l.kind, name: l.name, unit: l.unit || '', price: l.price,
        qty: Math.max(0, r3(l.qty - used[i].qty)), valueC: Math.max(0, toC(l.total) - used[i].c),
        soldQty: l.qty, soldC: toC(l.total), usedQty: r3(used[i].qty)
      })),
      balanceC: Math.max(0, toC(sale.balance) - credit),
      paidC: Math.max(0, toC(sale.amountPaid) - out),
      paidBy, refundedBy, count: mine.length,
      done: lines.every((l, i) => r3(l.qty - used[i].qty) <= QTY_EPS)
    };
  }

  // One return line for `q` units of a sale line. The money is what that quantity was really worth (a discount given on the sale
  // comes back off the refund in proportion), never more than is left on the line.
  function lineFor(sale, row, q, restock) {
    const L = sale.lines[row.lineNo];
    q = r3(q);
    const grossC = toC(r2(L.price * q));
    let c;
    if (q >= row.qty - QTY_EPS) c = Math.min(grossC, row.valueC);                    // the last of the line: whatever is left of it
    else if (toC(L.discount) > 0) c = Math.min(grossC, row.valueC, Math.round(toC(L.total) * q / L.qty));
    else c = Math.min(grossC, row.valueC);
    const o = { lineNo: row.lineNo, itemId: L.itemId, kind: L.kind, name: L.name, unit: L.unit || '', qty: q, price: L.price, total: c / 100, restock: restock !== false };
    if (grossC - c > 0) o.discount = (grossC - c) / 100;
    return o;
  }

  // What a refund of `picks` ([{lineNo, qty, restock}]) comes to.  -> { lines, totalC, creditC, moneyC, balanceC, paidC, problem }
  // The customer's unpaid balance is cleared first (creditC); only the rest is money to hand back (moneyC), and that can never be more than
  // the customer actually paid (problem says so when it is).
  function plan(sale, returns, picks) {
    const rem = remaining(sale, returns), lines = [];
    let problem = '';
    arr(picks).forEach(p => {
      const row = rem.lines[p.lineNo], q = r3(Number(p.qty));
      if (!row || !(q > 0)) return;
      if (q > row.qty + QTY_EPS) { problem = 'There is only ' + row.qty + ' of ' + row.name + ' left to take back.'; return; }
      lines.push(lineFor(sale, row, Math.min(q, row.qty), p.restock));
    });
    const totalC = lines.reduce((a, l) => a + toC(l.total), 0);
    const creditC = Math.min(totalC, rem.balanceC), moneyC = totalC - creditC;
    if (!problem && moneyC > rem.paidC) problem = 'That is more money than the customer paid for this sale.';
    return { lines, totalC, creditC, moneyC, balanceC: rem.balanceC, paidC: rem.paidC, problem };
  }

  // A void: every line of the sale, and the money back exactly as it was taken. Only a sale with no return yet can be voided, and only in
  // the shift it was taken in (check() enforces both).  -> { lines, totalC, creditC, moneyC, refunds, problem }
  function voidPlan(sale, returns) {
    const rem = remaining(sale, returns);
    const lines = rem.lines.map(row => lineFor(sale, row, row.qty, true));
    const refunds = arr(sale.payments).filter(p => toC(p.amount) > 0).map(p => ({ method: p.method, label: p.label || p.method, amount: p.amount, ref: p.ref || '' }));
    const totalC = lines.reduce((a, l) => a + toC(l.total), 0);
    return { lines, totalC, creditC: toC(sale.balance), moneyC: toC(sale.amountPaid), refunds, problem: rem.count ? 'This sale already has a return, so it can no longer be voided. Use Refund.' : '' };
  }

  // A sensible first split of the money to hand back: the methods the customer paid with, in the order they paid, up to what each took.
  function defaultRefunds(sale, returns, moneyC) {
    const rem = remaining(sale, returns), out = [];
    let left = moneyC;
    const order = [];
    arr(sale.payments).forEach(p => { if (order.indexOf(p.method) < 0) order.push(p.method); });
    METHODS.forEach(m => { if (order.indexOf(m) < 0) order.push(m); });
    order.forEach(m => {
      const room = Math.max(0, rem.paidBy[m] - rem.refundedBy[m]), give = Math.min(left, room);
      if (give > 0) { out.push({ method: m, amountC: give }); left -= give; }
    });
    if (left > 0) out.push({ method: 'cash', amountC: left });   // only reachable if the sale's own figures are odd; the check afterwards still decides
    return out;
  }

  // '' when `rec` is a proper return of `sale` given the returns already made (`others`, any list: those of other sales are ignored).
  function check(rec, sale, others) {
    if (!sale || sale.id !== rec.saleId) return 'the sale it belongs to was not found';
    if (rec.at < sale.at) return 'a return cannot come before its sale';
    const rem = remaining(sale, arr(others).filter(r => r && r.id !== rec.id));
    for (const l of rec.lines) {
      const row = rem.lines[l.lineNo], L = sale.lines[l.lineNo];
      if (!row || !L || row.itemId !== l.itemId || row.kind !== l.kind) return 'a returned line does not match the sale';
      if (l.price !== L.price) return 'a returned line has a different price from the sale';
      if (l.qty > row.qty + QTY_EPS) return 'more of ' + l.name + ' than was sold';
      if (toC(l.total) > row.valueC) return 'more money for ' + l.name + ' than it was worth';
    }
    const totalC = toC(rec.total);
    if (rec.kind === 'void') {
      if (rem.count) return 'this sale already has a return, so it cannot be voided';
      if (!sale.shiftId || sale.shiftId !== rec.shiftId) return 'a void can only be made in the shift the sale was taken in';
      if (rec.lines.length !== sale.lines.length) return 'a void takes back the whole sale';
      for (const l of rec.lines) { const L = sale.lines[l.lineNo]; if (l.qty !== L.qty || toC(l.total) !== toC(L.total)) return 'a void takes back the whole sale'; }
      if (toC(rec.creditApplied) !== toC(sale.balance)) return 'a void clears the whole unpaid balance';
      const was = zero(), now = zero();
      arr(sale.payments).forEach(p => { if (was[p.method] != null) was[p.method] += toC(p.amount); });
      arr(rec.refunds).forEach(p => { if (now[p.method] != null) now[p.method] += toC(p.amount); });
      if (METHODS.some(m => was[m] !== now[m])) return 'a void gives the money back the way it was taken';
    } else {
      if (toC(rec.creditApplied) !== Math.min(totalC, rem.balanceC)) return 'the customer\u2019s unpaid balance must be cleared first';
      if (toC(rec.refunded) > rem.paidC) return 'more money than the customer paid';
    }
    return '';
  }

  // Sales that have been given back more than they held (two offline tills returning the same item). Each: { saleId, name, qty }.
  function overReturned(sales, returns) {
    const out = [];
    const by = new Map();
    arr(returns).forEach(r => { if (r) { (by.get(r.saleId) || by.set(r.saleId, []).get(r.saleId)).push(r); } });
    arr(sales).forEach(s => {
      if (!s || !by.has(s.id)) return;
      const rem = remaining(s, by.get(s.id));
      arr(s.lines).forEach((l, i) => {
        const gone = rem.lines[i].usedQty;
        if (gone > l.qty + QTY_EPS) out.push({ saleId: s.id, name: l.name, qty: r3(gone - l.qty) });
      });
      const owed = toC(s.balance), cleared = by.get(s.id).reduce((a, r) => a + toC(r.creditApplied), 0);
      if (cleared > owed) out.push({ saleId: s.id, name: 'unpaid balance', qty: (cleared - owed) / 100 });
    });
    return out;
  }

  // ── what the rest of the app reads off the records ────────────────────────────
  // Restocked lines, shaped for Sales.stockBook's `returns` ({itemId, qty, date, time}).
  function forStock(returns) {
    const out = [];
    arr(returns).forEach(r => { if (r) arr(r.lines).forEach(l => { if (l && l.restock !== false) out.push({ itemId: l.itemId, qty: Number(l.qty) || 0, date: r.date, time: r.time }); }); });
    return out;
  }
  // Cash handed back out of a shift's drawer (money).
  function cashOutOf(shiftId, returns) {
    let c = 0;
    arr(returns).forEach(r => { if (r && shiftId && r.shiftId === shiftId) arr(r.refunds).forEach(p => { if (p.method === 'cash') c += toC(p.amount); }); });
    return c / 100;
  }
  function methodsOf(r) {
    const set = [];
    arr(r.refunds).forEach(p => { const m = String(p.label || p.method).toUpperCase(); if (set.indexOf(m) < 0) set.push(m); });
    return set.join(' + ');
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STORAGE ADAPTERS — every method is async; d = depot key
  //   add(d, rec)  save AND queue for upload in one transaction; EXISTS if the id is taken      get(d, id) / all(d)
  //   addMany(d, recs, queue)  add those not stored yet, return how many                         outbox(d) / unqueue(d, id) / bump(d, id, err)
  //   getMeta(k) / setMeta(k, v)
  // ══════════════════════════════════════════════════════════════════════════════
  function memAdapter() {
    const ev = new Map(), outbox = new Map(), meta = new Map();
    const K = (d, id) => d + '|' + id, clone = x => JSON.parse(JSON.stringify(x));
    return {
      async add(d, rec) {
        if (ev.has(K(d, rec.id))) throw err('EXISTS', 'This return number is already recorded');
        ev.set(K(d, rec.id), clone(rec));
        outbox.set(K(d, rec.id), { d, id: rec.id, tries: 0, err: '' });
      },
      async get(d, id) { const r = ev.get(K(d, id)); return r ? clone(r) : null; },
      async all(d) { const o = []; ev.forEach((r, k) => { if (k.startsWith(d + '|')) o.push(clone(r)); }); return o; },
      async addMany(d, recs, queue) {
        let n = 0;
        recs.forEach(rec => {
          if (ev.has(K(d, rec.id))) return;
          ev.set(K(d, rec.id), clone(rec));
          if (queue) outbox.set(K(d, rec.id), { d, id: rec.id, tries: 0, err: '' });
          n++;
        });
        return n;
      },
      async outbox(d) { const o = []; outbox.forEach(q => { if (q.d === d) o.push({ id: q.id, tries: q.tries, err: q.err }); }); return o; },
      async unqueue(d, id) { outbox.delete(K(d, id)); },
      async bump(d, id, e) { const q = outbox.get(K(d, id)); if (q) { q.tries++; q.err = String(e || ''); } },
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
        try { q = idb.open('mdm_returns', 1); } catch (e) { dbp = null; return rej(err('STORAGE', 'Could not open the returns store')); }
        q.onupgradeneeded = () => {
          const db = q.result;
          db.createObjectStore('ev', { keyPath: 'k' }).createIndex('depot', 'depot');
          db.createObjectStore('outbox', { keyPath: 'k' }).createIndex('depot', 'depot');
          db.createObjectStore('meta', { keyPath: 'k' });
        };
        q.onsuccess = () => { const db = q.result; db.onversionchange = () => { try { db.close(); } catch (e) {} dbp = null; }; res(db); };
        q.onerror = () => { dbp = null; rej(err('STORAGE', 'Could not open the returns store')); };
      });
      return dbp;
    }
    const wait = tx => new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error || err('STORAGE', 'Could not save'));
      tx.onabort = () => rej(tx.error || err('STORAGE', 'Could not save'));
    });
    const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || err('STORAGE', 'Could not read')); });
    function tx(db, names, mode) {                         // 'strict': flushed to disk before the transaction completes
      try { return db.transaction(names, mode, { durability: 'strict' }); } catch (e) { return db.transaction(names, mode); }
    }
    return {
      async add(d, rec) {
        const db = await open(), t = tx(db, ['ev', 'outbox'], 'readwrite'), k = d + '|' + rec.id;
        let dup = false;
        const a = t.objectStore('ev').add({ k, depot: d, id: rec.id, rec });
        a.onerror = ev => { dup = true; ev.preventDefault(); try { t.abort(); } catch (e) {} };
        t.objectStore('outbox').put({ k, depot: d, id: rec.id, tries: 0, err: '' });
        try { await wait(t); } catch (e) { throw dup ? err('EXISTS', 'This return number is already recorded') : (e && e.code ? e : err('STORAGE', 'Could not save the return')); }
      },
      async get(d, id) { const db = await open(), r = await req(tx(db, ['ev'], 'readonly').objectStore('ev').get(d + '|' + id)); return r ? r.rec : null; },
      async all(d) { const db = await open(), rows = await req(tx(db, ['ev'], 'readonly').objectStore('ev').index('depot').getAll(d)); return rows.map(x => x.rec); },
      async addMany(d, recs, queue) {
        if (!recs.length) return 0;
        const db = await open(), t = tx(db, queue ? ['ev', 'outbox'] : ['ev'], 'readwrite');
        let n = 0;
        recs.forEach(rec => {
          const k = d + '|' + rec.id;
          const a = t.objectStore('ev').add({ k, depot: d, id: rec.id, rec });
          a.onsuccess = () => { n++; if (queue) t.objectStore('outbox').put({ k, depot: d, id: rec.id, tries: 0, err: '' }); };
          a.onerror = e => e.preventDefault();             // already stored: keep the original, carry on
        });
        await wait(t);
        return n;
      },
      async outbox(d) { const db = await open(), rows = await req(tx(db, ['outbox'], 'readonly').objectStore('outbox').index('depot').getAll(d)); return rows.map(q => ({ id: q.id, tries: q.tries || 0, err: q.err || '' })); },
      async unqueue(d, id) { const db = await open(), t = tx(db, ['outbox'], 'readwrite'); t.objectStore('outbox').delete(d + '|' + id); await wait(t); },
      async bump(d, id, e) {
        const db = await open(), t = tx(db, ['outbox'], 'readwrite'), s = t.objectStore('outbox'), k = d + '|' + id;
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
  //   env = { depotKey(), adapter?, opts? }     opts is passed to toRecord (dateOf / timeOf)
  //   cloud = { get(path), putIfAbsent(path, obj), query(path, queryString) }   (Gate.restCloud gives exactly this)
  // ══════════════════════════════════════════════════════════════════════════════
  function create(env) {
    const A = env.adapter || idbAdapter();
    const depot = () => String(env.depotKey() || '');
    const need = () => { const d = depot(); if (!d) throw err('NO_DEPOT', 'No depot yet'); return d; };

    // Save one return. `sale` is the sale record it reverses (the caller reads it from the sales ledger). The record is checked on its own and
    // against the sale and every return this phone already holds for it, then stored with its "to upload" mark in one transaction. Only after
    // this resolves may the receipt be shown.
    async function append(basket, sale) {
      const d = need(), rec = toRecord(basket, env.opts);
      let bad = validate(rec);
      if (bad) throw err('INVALID', 'The ' + (rec.kind || 'return') + ' is not valid: ' + bad);
      const same = (await A.all(d)).filter(r => r.saleId === rec.saleId);
      bad = check(rec, sale, same);
      if (bad) throw err('INVALID', 'The ' + rec.kind + ' is not allowed: ' + bad);
      await A.add(d, rec);
      return rec;
    }
    async function all() { return (await A.all(need())).sort((a, b) => (a.at - b.at) || a.id.localeCompare(b.id)); }
    async function pending() { return (await A.outbox(need())).length; }

    // Upload this device's outbox. Stops at the first network failure. A record already in the cloud with the same till id counts as uploaded.
    async function push(cloud) {
      const d = need(), queue = await A.outbox(d);
      let sent = 0, lastErr = '';
      for (const q of queue) {
        const rec = await A.get(d, q.id);
        if (!rec) { await A.unqueue(d, q.id); continue; }
        const path = 'depots/' + d + '/returns/' + q.id;
        try { await cloud.putIfAbsent(path, forCloud(rec)); await A.unqueue(d, q.id); sent++; continue; }
        catch (e) {
          const c = (e && e.code) || 'error';
          if (c === 'NETWORK' || c === 'NO_AUTH') { lastErr = c; break; }
          let there = null;
          try { there = await cloud.get(path); } catch (e2) { lastErr = (e2 && e2.code) || 'error'; if (lastErr === 'NETWORK' || lastErr === 'NO_AUTH') break; await A.bump(d, q.id, lastErr); continue; }
          if (there && typeof there === 'object' && there.tillId === rec.tillId && there.at === rec.at) { await A.unqueue(d, q.id); sent++; }
          else { lastErr = c; await A.bump(d, q.id, c); }   // e.g. its sale is not in the cloud yet: stays queued and is tried again
        }
      }
      return { sent, left: (await A.outbox(d)).length, error: lastErr };
    }

    // Download the other tills' returns, incrementally (the cursor is the newest createdAt seen; each pull starts a minute before it).
    async function pull(cloud) {
      const d = need(), ck = 'cursor:' + d;
      let cursor = Number(await A.getMeta(ck)) || 0, start = cursor ? Math.max(0, cursor - OVERLAP_MS) : 0, added = 0, bad = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await cloud.query('depots/' + d + '/returns', 'orderBy=' + encodeURIComponent('"createdAt"') + '&startAt=' + start + '&limitToFirst=' + PAGE);
        const ids = res && typeof res === 'object' ? Object.keys(res) : [];
        if (!ids.length) break;
        const good = []; let maxC = start;
        ids.forEach(id => {
          const x = fromCloud(id, res[id]);
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

    // Records from a backup file: validated, stored if not already there, and queued so the cloud gets any it lacks.
    async function importMany(list) {
      const d = need(), good = [];
      arr(list).forEach(r => { if (r && !validate(r)) good.push(JSON.parse(JSON.stringify(r))); });
      return { added: await A.addMany(d, good, true), skipped: arr(list).length - good.length };
    }

    return { append, all, pending, push, pull, importMany };
  }

  return { V, ID_RE, KINDS, METHODS, REASONS, NO_RESTOCK, idFromNumber, toRecord, validate, forCloud, fromCloud, remaining, lineFor, plan, voidPlan, defaultRefunds, check,
           overReturned, forStock, cashOutOf, methodsOf, create, memAdapter, idbAdapter };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Returns; // lets Node load it for tests
