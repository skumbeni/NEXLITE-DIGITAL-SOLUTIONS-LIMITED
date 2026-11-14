/*!
 * sales.js — the append-only sales ledger. ONE copy, loaded by both index.html and pos.html (roadmap step 9).
 *
 * WHAT IT IS
 *   Every till sale is ONE record, stored as sales/{saleId} (saleId = the receipt number, e.g. K7F2-000123).
 *   A record is written once and never changed: no edit, no delete, no counters. Corrections are new records
 *   (voids / refunds, roadmap step 19). The records live OUTSIDE the DATA blob, so two tills selling at the
 *   same moment can never overwrite each other (the blob is last-write-wins; this is not).
 *
 * WHERE A RECORD LIVES
 *   1. On the device: IndexedDB database "mdm_sales" (stores: sales, outbox, meta). A sale is saved there, in one
 *      transaction together with its "still to upload" mark, BEFORE the receipt is shown. Works fully offline.
 *   2. In the cloud: depots/<depotKey>/sales/<saleId>, create-only (see database_rules.json). Each device uploads
 *      its own outbox whenever it is online, and downloads the other tills' sales (incrementally, by the server's
 *      createdAt time). Uploading is idempotent: a sale that is already there is simply marked as uploaded.
 *
 * STOCK (roadmap step 10): stockBook() below is the ONE place stock is worked out, for the till and the main app:
 *       stock = received − issued − sold + returns        (no stored counters: every figure is summed from records)
 *   received/issued are the main app's own records, sold comes from this ledger, returns from the void/refund records of returns.js
 *   (roadmap step 19: Returns.forStock() hands over the lines that go back on the shelf; a damaged return is not restocked).
 *
 * PER-BATCH STOCK (v0.3.36): a till sale of a commodity carries no batch, so batchBook() below allocates each sale line to the
 *   batches FIFO (oldest stock first), replaying the records in date/time order. Nothing is stored; the per-batch figures
 *   always add up to the same commodity total stockBook() gives (and the till shows).
 *
 * DISCOUNTS (roadmap step 18): a discount is part of the sale record, never a separate edit. Each line may carry `discount` (money off
 *   that line); line.total is the amount AFTER the discount, so total, the Z report's item list, stock value and every report that sums
 *   line totals stay right without knowing about discounts. The header carries `discount` (the sum of the lines'), `discountBy` (who
 *   allowed it: the cashier within their own limit, or the manager whose PIN approved more) and `discountReason`. A sale with no
 *   discount has none of these fields, exactly as before. The till gives a discount on the whole basket; it is shared out over the
 *   lines in whole ngwee (discountSplit), so a line can carry a discount even though the cashier never typed one for it.
 *   The policy (Settings -> Till discounts) lives in depotInfo: discountOn, discountCapPct (what a cashier may give alone),
 *   discountMaxPct (the most anyone may give, even with a PIN). discountJudge() is the one place that decides who may give what.
 *
 * WHAT THE MAIN APP DOES WITH THE LEDGER BESIDES STOCK
 *   issuedRows() turns the sales into rows shaped like generalIssued / commodityIssued rows (flag _sale:true). The
 *   main app overlays them on DATA in memory so reports, close-out and customer balances see till sales, and strips
 *   them again whenever DATA is saved or synced. Stock does NOT depend on that overlay: stockBook ignores _sale rows
 *   and reads the ledger itself. Roadmap step 23 (Sales History from the ledger) retires the overlay.
 *   VOIDS AND REFUNDS (roadmap step 19, returns.js): a return is a record of its own, never an edit of the sale. issuedRows(sales, returns) adds each
 *   one as NEGATIVE rows (issued < 0, flags _sale and _return) dated the day the return was made, so a day that was already closed is never changed
 *   and every report that sums issued x price comes out net. The cash/credit split of a return row follows the main app's own pattern: money handed
 *   back is a negative partialPaid, the part taken off the customer's balance is the rest of the negative value.
 *
 * Plain classic script, no dependencies, one global: Sales. Load it with a normal <script src="sales.js"></script>
 * after gate.js. Add sales.js to the precache list in sw.js, otherwise the pages cannot start offline.
 * Storage and network are injected, so Node can test this file (see create(env) and memAdapter()).
 */
const Sales = (function () {
  'use strict';

  const V = 1;                                           // record format version
  const ID_RE   = /^[A-HJ-KM-NP-Z2-9]{4}-[0-9]{6,9}$/;   // receipt number = sale id
  const TILL_RE = /^[A-HJ-KM-NP-Z2-9]{4}$/;
  const TID_RE  = /^[0-9a-f]{24}$/;
  const SID_RE  = /^[A-HJ-KM-NP-Z2-9]{4}-S[0-9]{4,9}$/;   // shift id (shifts.js, roadmap step 16)
  const STATUS  = ['paid', 'partial', 'credit'];
  const METHODS = ['cash', 'mtn', 'airtel', 'card'];
  const MAX_LINES = 200, MAX_PAYMENTS = 20;
  const PAGE = 300, MAX_PAGES = 40;                      // pull: records per request / requests per pull
  const OVERLAP_MS = 60000;                              // pull re-reads the last minute, so nothing near the cursor is missed
  const BATCH_NAME = 'TILL SALES';                       // pseudo batch the main app shows for commodity sold at the till

  const isNum = x => typeof x === 'number' && isFinite(x);
  const r2 = n => Math.round(n * 100) / 100;
  const r3 = n => Math.round(n * 1000) / 1000;
  const toC = n => Math.round((Number(n) || 0) * 100);
  const str = (x, n) => (x == null ? '' : String(x)).slice(0, n);
  function err(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
  // Realtime Database hands back an array as {"0":..,"1":..}, and drops an empty one altogether.
  const arr = x => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : []);

  // ══════════════════════════════════════════════════════════════════════════════
  // THE RECORD
  // ══════════════════════════════════════════════════════════════════════════════
  // {
  //   v:1, id, receiptNo, tillId, till, seq,            id === receiptNo; till = 4-char code; tillId = long random id
  //   at, date, time,                                    epoch ms; date/time as the main app writes them
  //   cashier, cashierRole,
  //   shiftId (optional; step 16: the shift this sale was taken in, e.g. K7F2-S0001; sales before step 16 have none),
  //   lines:[{itemId, kind:'item'|'commodity', name, unit, qty, price, total}],   price copied at the moment of sale
  //   lineCount, qtyTotal, total,
  //   payments:[{method, label, amount, tendered, ref}],                          absent for a pure credit sale
  //   amountPaid, change, balance, creditStatus:'paid'|'partial'|'credit', customerId, customerName
  // }
  // opts.dateOf(at) must give the date the way the main app's today() does (it uses the UTC date), so the till's
  // sales land on the same day as everything else in Sales History and the daily close-out.
  function toRecord(b, opts) {
    opts = opts || {};
    const at = Math.round(Number(b.at));
    const dateOf = opts.dateOf || (t => new Date(t).toISOString().slice(0, 10));
    const timeOf = opts.timeOf || (t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); });
    const rec = {
      v: V, id: String(b.receiptNo), receiptNo: String(b.receiptNo), tillId: String(b.tillId), till: String(b.till), seq: Number(b.seq),
      at, date: dateOf(at), time: timeOf(at),
      cashier: str(b.cashier, 80), cashierRole: str(b.cashierRole, 20),
      shiftId: str(b.shiftId, 24),
      lines: arr(b.lines).map(l => {
        const o = {
          itemId: str(l.itemId, 80), kind: l.kind === 'commodity' ? 'commodity' : 'item', name: str(l.name, 200), unit: str(l.unit, 40),
          qty: Number(l.qty), price: Number(l.price), total: Number(l.total)
        };
        const d = Number(l.discount);
        if (isNum(d) && d > 0) o.discount = d;           // absent unless a discount was given on this line
        return o;
      }),
      lineCount: Number(b.lineCount), qtyTotal: Number(b.qtyTotal), total: Number(b.total),
      payments: arr(b.payments).map(p => {
        const o = { method: String(p.method), label: str(p.label, 40), amount: Number(p.amount), ref: str(p.ref, 100) };
        if (isNum(Number(p.tendered)) && p.tendered != null) o.tendered = Number(p.tendered);
        return o;
      }),
      amountPaid: Number(b.amountPaid), change: Number(b.change), balance: Number(b.balance),
      creditStatus: String(b.creditStatus), customerId: str(b.customerId, 80), customerName: str(b.customerName, 200)
    };
    if (!rec.shiftId) delete rec.shiftId;                // no shift (a sale from before step 16): the field is simply absent
    const dsum = rec.lines.reduce((a, l) => a + toC(l.discount), 0);
    if (dsum > 0) { rec.discount = dsum / 100; rec.discountBy = str(b.discountBy, 80); rec.discountReason = str(b.discountReason, 60); }
    return JSON.parse(JSON.stringify(rec));              // plain data only: what is stored here is what the cloud will hold
  }

  // '' when the record is sound, otherwise why not. Run before saving AND on everything pulled from the cloud.
  function validate(s) {
    if (!s || typeof s !== 'object') return 'not a record';
    if (!ID_RE.test(String(s.id)) || s.id !== s.receiptNo) return 'bad receipt number';
    if (!TILL_RE.test(String(s.till)) || String(s.receiptNo).slice(0, 4) !== s.till) return 'bad till code';
    if (!TID_RE.test(String(s.tillId))) return 'bad till id';
    if (!Number.isInteger(s.seq) || s.seq < 1 || Number(String(s.receiptNo).slice(5)) !== s.seq) return 'bad sequence';
    if (!isNum(s.at) || s.at <= 0) return 'bad time';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) || !/^\d{2}:\d{2}$/.test(String(s.time))) return 'bad date';
    if (typeof s.cashier !== 'string' || s.cashier.length > 80) return 'bad cashier';
    if (s.shiftId !== undefined && (!SID_RE.test(String(s.shiftId)) || String(s.shiftId).slice(0, 4) !== s.till)) return 'bad shift id';
    const lines = s.lines;
    if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) return 'bad lines';
    let sum = 0, qty = 0, dsum = 0;
    for (const l of lines) {
      if (!l || typeof l.itemId !== 'string' || !l.itemId || l.itemId.length > 80) return 'bad item id';
      if (l.kind !== 'item' && l.kind !== 'commodity') return 'bad item kind';
      if ((l.kind === 'commodity') !== /^com:./.test(l.itemId)) return 'item kind does not match its id';
      if (typeof l.name !== 'string' || !l.name || l.name.length > 200) return 'bad item name';
      if (!isNum(l.qty) || !(l.qty > 0) || !isNum(l.price) || l.price < 0 || !isNum(l.total) || l.total < 0) return 'bad line amounts';
      const dsc = l.discount === undefined ? 0 : l.discount;
      if (!isNum(dsc) || dsc < 0 || Math.abs(dsc * 100 - Math.round(dsc * 100)) > 1e-6) return 'bad line discount';
      const gross = r2(l.price * l.qty);
      if (dsc > gross + 0.005) return 'a line discount is more than the line';
      if (Math.abs(l.total - r2(gross - dsc)) > 0.005) return dsc ? 'line total does not match price × qty less the discount' : 'line total does not match price × qty';
      sum += toC(l.total); qty += l.qty; dsum += toC(dsc);
    }
    if (!isNum(s.total) || toC(s.total) !== sum) return 'total does not match the lines';
    const hd = s.discount === undefined ? 0 : s.discount;
    if (!isNum(hd) || hd < 0 || toC(hd) !== dsum) return 'discount does not match the lines';
    if (hd > 0) {
      if (typeof s.discountBy !== 'string' || !s.discountBy || s.discountBy.length > 80) return 'a discount needs the person who allowed it';
      if (typeof s.discountReason !== 'string' || s.discountReason.length > 60) return 'bad discount reason';
    }
    if (s.lineCount !== lines.length) return 'bad line count';
    if (!isNum(s.qtyTotal) || Math.abs(s.qtyTotal - r3(qty)) > 0.0015) return 'bad quantity total';
    const pays = s.payments === undefined ? [] : s.payments;
    if (!Array.isArray(pays) || pays.length > MAX_PAYMENTS) return 'bad payments';
    let paid = 0;
    for (const p of pays) {
      if (!p || METHODS.indexOf(p.method) < 0 || !isNum(p.amount) || p.amount < 0) return 'bad payment';
      paid += toC(p.amount);
    }
    if (!isNum(s.amountPaid) || !isNum(s.balance) || !isNum(s.change) || s.amountPaid < 0 || s.balance < 0 || s.change < 0) return 'bad money';
    if (toC(s.amountPaid) !== paid) return 'payments do not add up to the amount paid';
    if (toC(s.amountPaid) + toC(s.balance) !== toC(s.total)) return 'paid + balance does not match the total';
    if (STATUS.indexOf(s.creditStatus) < 0) return 'bad payment status';
    const want = s.balance <= 0 ? 'paid' : (s.amountPaid > 0 ? 'partial' : 'credit');
    if (s.creditStatus !== want) return 'payment status does not match the money';
    if (typeof s.customerId !== 'string' || typeof s.customerName !== 'string') return 'bad customer';
    if (s.balance > 0 && !s.customerId) return 'an unpaid balance needs a customer';
    return '';
  }

  // The copy that goes to the cloud: the record plus the SERVER's clock, which is what pulls are ordered by.
  // The id is the node's key, so it is not repeated inside (the rules reject unknown fields); fromCloud puts it back.
  function forCloud(rec) { const o = Object.assign({}, rec, { createdAt: { '.sv': 'timestamp' } }); delete o.id; return o; }

  // What came back from the cloud -> { rec | null, createdAt }. createdAt is not kept on the record, so a sale looks the
  // same on every device however it got there.
  function fromCloud(id, o) {
    if (!o || typeof o !== 'object') return { rec: null, createdAt: 0 };
    const createdAt = isNum(o.createdAt) ? o.createdAt : 0;
    const rec = Object.assign({}, o);
    delete rec.createdAt;
    rec.id = id;
    rec.lines = arr(rec.lines);
    if (rec.payments !== undefined) rec.payments = arr(rec.payments);
    if (rec.payments === undefined || !rec.payments.length) rec.payments = [];
    ['customerId', 'customerName', 'cashierRole'].forEach(k => { if (rec[k] == null) rec[k] = ''; });
    if (rec.discount !== undefined && rec.discountReason == null) rec.discountReason = '';
    rec.lines.forEach(l => { if (l && l.unit == null) l.unit = ''; });
    rec.payments.forEach(p => { if (p && p.ref == null) p.ref = ''; });
    return { rec: validate(rec) ? null : rec, createdAt };
  }

  // The price per unit actually charged on a line. Without a discount it is the list price, untouched. With one it is total / qty, so
  // the main app's "issued x selling price" and a batch's sold value come to what was really taken (not the list value).
  function netPrice(l) {
    const q = Number(l.qty), d = Number(l.discount);
    return d > 0 && q > 0 ? (Number(l.total) || 0) / q : Number(l.price) || 0;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DISCOUNTS (roadmap step 18) — pure functions, shared by the till and Node tests
  // ══════════════════════════════════════════════════════════════════════════════
  // Percentages are worked in basis points (1% = 100) and money in ngwee, so a limit is compared as whole numbers.
  //   policy = discountPolicy(depotInfo):  { on, capBP, maxBP }
  //     on      Settings -> Till discounts is switched on (default OFF: until the Admin switches it on the till offers no discount)
  //     capBP   what a Cashier or Staff login may give alone, as a share of the basket's value before discount (default 5%)
  //     maxBP   the most anyone may give, with or without a PIN (default 20%, never below the cap, never above 90%)
  const DISC_MAX_PCT = 90;
  function discountPolicy(depotInfo) {
    const di = depotInfo || {};
    const pct = (v, d, hi) => { const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN); return isFinite(n) && n >= 0 && n <= hi ? n : d; };
    const cap = Math.round(pct(di.discountCapPct, 5, DISC_MAX_PCT) * 100);
    const max = Math.round(pct(di.discountMaxPct, 20, DISC_MAX_PCT) * 100);
    return { on: di.discountOn === true, capBP: cap, maxBP: Math.max(cap, max) };
  }
  const pctText = bp => String(Math.round(bp) / 100);

  // Shares a discount over the lines. grossC = each line's value before discount in ngwee.
  //   kind 'pct': value is a percentage (up to 2 decimals); each line gets its share rounded DOWN, so the total never goes above the
  //               percentage typed (a limit of 5% can never be tipped over by rounding).
  //   kind 'amt': value is money off the whole basket (capped at the basket); shared in proportion to the lines, whole ngwee, the
  //               spare ngwee going to the largest remainders, so no line is ever given more than it is worth.
  // Returns { lines: ngwee per line, total: ngwee }.
  function discountSplit(grossC, kind, value) {
    const out = grossC.map(() => 0), G = grossC.reduce((a, g) => a + g, 0), v = Number(value);
    if (!out.length || !(v > 0) || !(G > 0)) return { lines: out, total: 0 };
    if (kind === 'pct') {
      const bp = Math.round(Math.min(v, 100) * 100);
      grossC.forEach((g, i) => { const x = g * bp; out[i] = (x - (x % 10000)) / 10000; });
    } else {
      const D = Math.min(Math.round(v * 100), G), Gb = BigInt(G), Db = BigInt(D);
      const q = grossC.map(g => (BigInt(g) * Db) / Gb), rem = grossC.map((g, i) => BigInt(g) * Db - q[i] * Gb);
      let spare = D - q.reduce((a, x) => a + Number(x), 0);
      grossC.forEach((g, i) => { out[i] = Number(q[i]); });
      grossC.map((g, i) => i).sort((a, b) => (rem[a] === rem[b] ? a - b : (rem[a] > rem[b] ? -1 : 1))).forEach(i => { if (spare > 0 && out[i] < grossC[i]) { out[i]++; spare--; } });
    }
    return { lines: out, total: out.reduce((a, x) => a + x, 0) };
  }

  // Who may give how much.  p = { grossC, discC, policy, holder, apBP }
  //   grossC/discC  the basket's value before discount, and the discount, in ngwee
  //   holder        the person at the till is an Admin or Manager: they may give up to the maximum on their own
  //   apBP          a manager PIN approved a discount up to this many basis points of the basket (0 = none)
  // -> { ok:true, bp, approved? } | { need:'pin', bp } | { err, code }.   bp = the discount as basis points, rounded UP.
  function discountJudge(p) {
    const pol = p.policy;
    if (!pol || !pol.on) return { err: 'Discounts are switched off.', code: 'OFF' };
    if (!(p.discC > 0)) return { ok: true, bp: 0 };
    if (!(p.grossC > 0) || p.discC > p.grossC) return { err: 'The discount is more than the basket.', code: 'TOO_BIG' };
    const bp = Math.ceil(p.discC * 10000 / p.grossC);
    if (bp > pol.maxBP) return { err: 'That is more than the most this depot allows (' + pctText(pol.maxBP) + '%).', code: 'OVER_MAX', bp };
    if (bp <= (p.holder ? pol.maxBP : pol.capBP)) return { ok: true, bp };
    if ((p.apBP || 0) >= bp) return { ok: true, bp, approved: true };
    return { need: 'pin', bp };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // READING THE LEDGER
  // ══════════════════════════════════════════════════════════════════════════════
  // How much of a basket's payment belongs to each line, in money: proportional to the line totals, whole ngwee, the
  // last line takes the rounding. Used so a part-paid basket can be shown line by line.
  function linePaid(s) {
    const T = toC(s.total), P = toC(s.amountPaid), n = s.lines.length;
    if (s.creditStatus === 'paid') return s.lines.map(l => l.total);
    if (s.creditStatus === 'credit' || T <= 0) return s.lines.map(() => 0);
    let given = 0;
    return s.lines.map((l, i) => {
      const c = i === n - 1 ? P - given : Math.floor(P * toC(l.total) / T);
      given += c; return c / 100;
    });
  }
  function methodsOf(s) {
    const set = [];
    arr(s.payments).forEach(p => { const m = String(p.label || p.method).toUpperCase(); if (set.indexOf(m) < 0) set.push(m); });
    return set.join(' + ');
  }

  // Sales -> rows shaped like the main app's own records. gen: general items (generalIssued shape);
  // com: { commodityId: [commodityIssued-shaped rows] }. Every row carries _sale:true and a unique id "<saleId>#<line>".
  function issuedRows(sales, returns) {
    const gen = [], com = {};
    const list = (sales || []).slice().sort((a, b) => (a.date + a.time + a.id).localeCompare(b.date + b.time + b.id));
    list.forEach(s => {
      const paid = linePaid(s);
      s.lines.forEach((l, i) => {
        const base = {
          id: s.id + '#' + i, _sale: true, saleId: s.id, receiptNo: s.receiptNo, tillId: s.tillId,
          date: s.date, time: s.time, issued: l.qty, notes: '',
          creditStatus: l.total > 0 ? s.creditStatus : 'paid',
          partialPaid: s.creditStatus === 'partial' ? paid[i] : 0,
          customerId: s.customerId || '', customerName: s.customerName || '',
          enteredBy: s.cashier, enteredByRole: s.cashierRole || '', enteredAt: s.at, approvalStatus: 'approved',
          payMethods: methodsOf(s)
        };
        if (l.kind === 'commodity') {
          const cid = l.itemId.slice(4);
          (com[cid] || (com[cid] = [])).push(Object.assign(base, { batchName: BATCH_NAME, transporter: '', salePrice: netPrice(l) }));
        } else {
          gen.push(Object.assign(base, { itemName: l.name, itemId: l.itemId, sellingPrice: netPrice(l), unit: l.unit }));
        }
      });
    });
    // Voids and refunds (returns.js): negative rows on the day they were made. Row status: nothing handed back = 'credit' (the whole value comes off
    // what the customer owes), nothing taken off a balance = 'paid', both = 'partial' with the money handed back as a NEGATIVE partialPaid.
    const rets = (returns || []).filter(r => r && r.id && arr(r.lines).length).slice().sort((a, b) => (a.date + a.time + a.id).localeCompare(b.date + b.time + b.id));
    rets.forEach(r => {
      const lines = arr(r.lines), T = lines.reduce((a, l) => a + toC(l.total), 0), M = toC(r.refunded), C = toC(r.creditApplied);
      const st = M <= 0 ? 'credit' : (C <= 0 ? 'paid' : 'partial');
      const how = arr(r.refunds).map(p => String(p.label || p.method).toUpperCase()).filter((m, i, a) => a.indexOf(m) === i).join(' + ');
      let given = 0;
      lines.forEach((l, i) => {
        let pc = 0;
        if (st === 'partial') { pc = i === lines.length - 1 ? M - given : Math.floor(M * toC(l.total) / (T || 1)); given += pc; }
        const base = {
          id: r.id + '#' + i, _sale: true, _return: true, returnId: r.id, returnKind: r.kind, saleId: r.saleId, receiptNo: r.id, tillId: r.tillId,
          date: r.date, time: r.time, issued: -Number(l.qty), notes: (r.kind === 'void' ? 'VOID of ' : 'REFUND of ') + r.saleId + ' \u00B7 ' + (r.reason || ''),
          creditStatus: toC(l.total) > 0 ? st : 'paid', partialPaid: st === 'partial' ? -pc / 100 : 0,
          customerId: r.customerId || '', customerName: r.customerName || '',
          enteredBy: r.cashier, enteredByRole: r.cashierRole || '', enteredAt: r.at, approvalStatus: 'approved', payMethods: how
        };
        if (l.kind === 'commodity') {
          const cid = l.itemId.slice(4);
          (com[cid] || (com[cid] = [])).push(Object.assign(base, { batchName: BATCH_NAME, transporter: '', salePrice: netPrice(l) }));
        } else {
          gen.push(Object.assign(base, { itemName: l.name, itemId: l.itemId, sellingPrice: netPrice(l), unit: l.unit }));
        }
      });
    });
    return { gen, com };
  }

  // itemId -> quantity sold (items AND commodities; commodity ids start with "com:"). The till subtracts this from stock.
  function soldById(sales) {
    const m = new Map();
    (sales || []).forEach(s => s.lines.forEach(l => m.set(l.itemId, r3((m.get(l.itemId) || 0) + l.qty))));
    return m;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STOCK  =  received − issued − sold + returns   (roadmap step 10)
  // ══════════════════════════════════════════════════════════════════════════════
  // Nothing is stored: every call sums records. src:
  //   received  main-app receive rows (generalInventory, or one commodity's received rows)   {itemId?, itemName, received, date, time, approvalStatus, condition}
  //   issued    main-app issue rows (generalIssued / one commodity's issued rows)             {itemId?, itemName, issued, date, time, approvalStatus}
  //             Rows flagged _sale are the main app's in-memory overlay of THIS ledger and are skipped here, so a
  //             till sale is counted once, from the ledger, never twice.
  //   sales     ledger records; every line counts against its itemId ("com:<id>" for a commodity)
  //   returns   [{itemId | itemName, qty, date?, time?}]: stock coming back (voids / refunds, roadmap step 19: Returns.forStock(records))
  // opts:
  //   idOfName(name)   id for a row that carries only a name (the main app passes its item-master lookup)
  //   keyOf(row)       overrides how a received/issued row is keyed (used to total ONE commodity)
  //   until            'YYYY-MM-DD HH:MM': only records at or before that moment (stock as it was at a stock count)
  //   untilDate        'YYYY-MM-DD': only records on or before that day
  //   only             a key: work out just that item (cheaper for a one-off question)
  //   isApproved(row)  default: no approvalStatus, or 'approved'. Pending and rejected entries never count.
  // Counted: received rows that are approved and not condition 'rejected'; issued rows that are approved.
  function stockBook(src, o) {
    o = o || {};
    src = src || {};
    const idOf = o.idOfName || (n => 'name:' + String(n || '').trim().toUpperCase());
    const ok = o.isApproved || (r => !r.approvalStatus || r.approvalStatus === 'approved');
    const keyOf = o.keyOf || (r => r.itemId || idOf(r.itemName));
    const upTo = o.until != null ? String(o.until) : null, upDay = o.untilDate != null ? String(o.untilDate) : null;
    const within = (date, time) => (upTo == null || (String(date || '') + ' ' + (time || '00:00')) <= upTo) && (upDay == null || String(date || '') <= upDay);
    const m = new Map();
    const add = (k, f, n) => {
      if (!k || (o.only != null && k !== o.only) || !isNum(n)) return;
      let s = m.get(k); if (!s) { s = { rec: 0, issued: 0, sold: 0, ret: 0 }; m.set(k, s); }
      s[f] += n;
    };
    (src.received || []).forEach(r => { if (r && ok(r) && r.condition !== 'rejected' && within(r.date, r.time)) add(keyOf(r), 'rec', Number(r.received) || 0); });
    (src.issued || []).forEach(r => { if (r && !r._sale && ok(r) && within(r.date, r.time)) add(keyOf(r), 'issued', Number(r.issued) || 0); });
    (src.sales || []).forEach(s => { if (s && within(s.date, s.time)) arr(s.lines).forEach(l => add(l.itemId, 'sold', Number(l.qty) || 0)); });
    (src.returns || []).forEach(x => { if (x && within(x.date, x.time)) add(x.itemId || idOf(x.itemName), 'ret', Number(x.qty) || 0); });
    const fin = s => ({ rec: r3(s.rec), issued: r3(s.issued), sold: r3(s.sold), ret: r3(s.ret), out: r3(s.issued + s.sold), bal: r3(s.rec - s.issued - s.sold + s.ret) });
    const none = { rec: 0, issued: 0, sold: 0, ret: 0 };
    return {
      get: k => fin(m.get(k) || none),                    // { rec, issued, sold, ret, out (= issued + sold), bal }
      byName: n => fin(m.get(idOf(n)) || none),
      keys: () => Array.from(m.keys())
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PER-BATCH STOCK of ONE commodity  =  the stockBook formula, split by batch
  // ══════════════════════════════════════════════════════════════════════════════
  //   batch stock = received(batch) − issued(batch) − sold(batch) + returned(batch)      (roadmap step 19)
  // A restocked return goes back to the batches its sale line came from, in the order they supplied it (so a void puts exactly what it took back where it
  // was); anything over that goes to the last of them. src.returns are the return RECORDS (returns.js), not the stockBook shape.
  // A till sale names no batch, so every sale line is ALLOCATED: records are replayed in date/time order (at the same
  // minute: received, then issued, then sold) and a sale takes from the batch that arrived first and still holds stock,
  // then the next, and so on (FIFO). If a sale is bigger than everything in stock at that moment, the shortfall goes to
  // the batch the sale last took from (it shows negative: a visible oversell), else to the newest batch, else to the
  // pseudo batch BATCH_NAME (no stock was recorded at all yet). The allocation is derived, never stored, so it re-works
  // itself when a backdated receive is entered. A later cut-off gives the same numbers as the full replay up to then.
  // src: { received: commodity received rows, issued: commodity issued rows (rows flagged _sale are skipped, sales are
  //        read from the ledger), sales: ledger records, returns?: return records }
  // opts: cid (required: the commodity id; its sale lines have itemId "com:<cid>"), until / untilDate / isApproved,
  //       exactly as in stockBook. Same rules as stockBook: approved rows only, received rows with condition 'rejected' skipped.
  // Returns:
  //   get(batch)        { rec, issued, sold, ret, out (= issued + sold), bal, soldValue (money taken for what was sold, less what was given back) }
  //   names()           every batch that has any record, oldest stock first
  //   total()           the commodity's stock = stockBook(...).bal for the same commodity
  //   timeline()        { rowId: stock after that row }: a received/issued row gets its OWN batch's stock;
  //                     a till-sale or till-return row (id "<saleId or returnId>#<line>") gets the commodity's total stock, as it belongs to no one batch
  //   allocation(id)    which batches a sale line came from: [{ batch, qty }]
  function batchBook(src, o) {
    o = o || {};
    src = src || {};
    const key = 'com:' + String(o.cid || '');
    const ok = o.isApproved || (r => !r.approvalStatus || r.approvalStatus === 'approved');
    const upTo = o.until != null ? String(o.until) : null, upDay = o.untilDate != null ? String(o.untilDate) : null;
    const within = (date, time) => (upTo == null || (String(date || '') + ' ' + (time || '00:00')) <= upTo) && (upDay == null || String(date || '') <= upDay);
    const at = (date, time) => String(date || '') + ' ' + (time || '00:00');
    const nameOf = r => (r.batchName == null ? '' : String(r.batchName));
    const EPS = 1e-9;
    const ev = [];
    (src.received || []).forEach(r => { if (r && !r._sale && ok(r) && r.condition !== 'rejected' && within(r.date, r.time)) ev.push({ k: 0, at: at(r.date, r.time), id: String(r.id || ''), b: nameOf(r), q: Number(r.received) || 0 }); });
    (src.issued || []).forEach(r => { if (r && !r._sale && ok(r) && within(r.date, r.time)) ev.push({ k: 1, at: at(r.date, r.time), id: String(r.id || ''), b: nameOf(r), q: Number(r.issued) || 0 }); });
    (src.sales || []).forEach(s => {
      if (!s || !within(s.date, s.time)) return;
      arr(s.lines).forEach((l, i) => { if (l && l.itemId === key) ev.push({ k: 2, at: at(s.date, s.time), id: s.id + '#' + i, q: Number(l.qty) || 0, price: netPrice(l) }); });
    });
    (src.returns || []).forEach(r => {
      if (!r || !within(r.date, r.time)) return;
      arr(r.lines).forEach((l, i) => { if (l && l.itemId === key) ev.push({ k: 3, at: at(r.date, r.time), id: r.id + '#' + i, q: l.restock === false ? 0 : Number(l.qty) || 0, sl: r.saleId + '#' + l.lineNo }); });
    });
    ev.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.k - b.k) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));

    const st = new Map(), order = [], lines = new Map(), prices = new Map(), back = new Map(), tl = new Map();
    let total = 0;
    const slot = b => { let s = st.get(b); if (!s) { s = { rec: 0, issued: 0, sold: 0, ret: 0, value: 0 }; st.set(b, s); } return s; };
    const bal = s => s.rec - s.issued - s.sold + s.ret;
    ev.forEach(e => {
      if (e.k === 0) {
        const s = slot(e.b); if (order.indexOf(e.b) < 0) order.push(e.b);
        s.rec += e.q; total += e.q; tl.set(e.id, bal(s));
      } else if (e.k === 1) {
        const s = slot(e.b); s.issued += e.q; total -= e.q; tl.set(e.id, bal(s));
      } else if (e.k === 3) {
        let need = e.q;
        const parts = lines.get(e.sl) || [], price = prices.get(e.sl) || 0;
        const give = (b, q) => { const s = slot(b); s.ret += q; s.value -= q * price; total += q; need -= q; };
        for (const p of parts) {
          if (need <= EPS) break;
          const bk = e.sl + '|' + p.batch, free = p.qty - (back.get(bk) || 0);
          if (free > EPS) { const t = Math.min(free, need); give(p.batch, t); back.set(bk, (back.get(bk) || 0) + t); }
        }
        if (need > EPS) give(parts.length ? parts[parts.length - 1].batch : (order.length ? order[order.length - 1] : BATCH_NAME), need);
        tl.set(e.id, total);
      } else {
        let need = e.q, last = null;
        const parts = [];
        const take = (b, q) => {
          const s = slot(b); s.sold += q; s.value += q * e.price; total -= q; need -= q; last = b;
          const p = parts.find(x => x.batch === b); if (p) p.qty += q; else parts.push({ batch: b, qty: q });
        };
        for (const b of order) { if (need <= EPS) break; const have = bal(slot(b)); if (have > EPS) take(b, Math.min(have, need)); }
        if (need > EPS) take(last != null ? last : (order.length ? order[order.length - 1] : BATCH_NAME), need);
        lines.set(e.id, parts.map(p => ({ batch: p.batch, qty: r3(p.qty) })));
        prices.set(e.id, e.price);
        tl.set(e.id, total);
      }
    });

    const fin = s => ({ rec: r3(s.rec), issued: r3(s.issued), sold: r3(s.sold), ret: r3(s.ret), out: r3(s.issued + s.sold), bal: r3(s.rec - s.issued - s.sold + s.ret), soldValue: r2(s.value) });
    const none = { rec: 0, issued: 0, sold: 0, ret: 0, value: 0 };
    let tlObj = null;
    return {
      get: b => fin(st.get(b == null ? '' : String(b)) || none),
      names: () => { const n = order.slice(); st.forEach((s, b) => { if (n.indexOf(b) < 0) n.push(b); }); return n; },
      total: () => r3(total),
      timeline: () => { if (!tlObj) { tlObj = {}; tl.forEach((v, id) => { tlObj[id] = r3(v); }); } return tlObj; },
      allocation: id => (lines.get(id) || []).map(p => ({ batch: p.batch, qty: p.qty }))
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STORAGE ADAPTERS — every method is async; d = depot key
  //   add(d, rec)                       save a sale AND queue it for upload, in one transaction; EXISTS if the id is taken
  //   get(d, id) / all(d)               read
  //   addMany(d, recs, queue)           add those not stored yet, return how many; queue=true also queues them for upload
  //   outbox(d)                         [{id, tries, err}] still to upload      unqueue(d, id)      bump(d, id, err)
  //   getMeta(k) / setMeta(k, v)
  // ══════════════════════════════════════════════════════════════════════════════
  function memAdapter() {
    const sales = new Map(), outbox = new Map(), meta = new Map();
    const K = (d, id) => d + '|' + id;
    return {
      async add(d, rec) {
        if (sales.has(K(d, rec.id))) throw err('EXISTS', 'This receipt number is already recorded');
        sales.set(K(d, rec.id), JSON.parse(JSON.stringify(rec)));
        outbox.set(K(d, rec.id), { d, id: rec.id, tries: 0, err: '' });
      },
      async get(d, id) { const r = sales.get(K(d, id)); return r ? JSON.parse(JSON.stringify(r)) : null; },
      async all(d) { const o = []; sales.forEach((r, k) => { if (k.startsWith(d + '|')) o.push(JSON.parse(JSON.stringify(r))); }); return o; },
      async addMany(d, recs, queue) {
        let n = 0;
        recs.forEach(rec => {
          if (sales.has(K(d, rec.id))) return;
          sales.set(K(d, rec.id), JSON.parse(JSON.stringify(rec)));
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

  // IndexedDB: database "mdm_sales" (separate from index.html's "mdm_db", so neither page's schema upgrade can block the other).
  function idbAdapter(idb) {
    idb = idb || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      if (!idb) return Promise.reject(err('STORAGE', 'IndexedDB is not available'));
      dbp = new Promise((res, rej) => {
        let q;
        try { q = idb.open('mdm_sales', 1); } catch (e) { dbp = null; return rej(err('STORAGE', 'Could not open the sales store')); }
        q.onupgradeneeded = () => {
          const db = q.result;
          db.createObjectStore('sales', { keyPath: 'k' }).createIndex('depot', 'depot');
          db.createObjectStore('outbox', { keyPath: 'k' }).createIndex('depot', 'depot');
          db.createObjectStore('meta', { keyPath: 'k' });
        };
        q.onsuccess = () => { const db = q.result; db.onversionchange = () => { try { db.close(); } catch (e) {} dbp = null; }; res(db); };
        q.onerror = () => { dbp = null; rej(err('STORAGE', 'Could not open the sales store')); };
      });
      return dbp;
    }
    const wait = tx => new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error || err('STORAGE', 'Could not save'));
      tx.onabort = () => rej(tx.error || err('STORAGE', 'Could not save'));
    });
    const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || err('STORAGE', 'Could not read')); });
    // 'strict' makes the browser flush to disk before the transaction completes: a sale must survive a battery pull.
    function tx(db, names, mode) {
      try { return db.transaction(names, mode, { durability: 'strict' }); } catch (e) { return db.transaction(names, mode); }
    }
    return {
      async add(d, rec) {
        const db = await open(), t = tx(db, ['sales', 'outbox'], 'readwrite'), k = d + '|' + rec.id;
        let dup = false;
        const a = t.objectStore('sales').add({ k, depot: d, id: rec.id, rec });
        a.onerror = ev => { dup = true; ev.preventDefault(); try { t.abort(); } catch (e) {} };
        t.objectStore('outbox').put({ k, depot: d, id: rec.id, tries: 0, err: '' });
        try { await wait(t); } catch (e) { throw dup ? err('EXISTS', 'This receipt number is already recorded') : (e && e.code ? e : err('STORAGE', 'Could not save the sale')); }
      },
      async get(d, id) {
        const db = await open(), r = await req(tx(db, ['sales'], 'readonly').objectStore('sales').get(d + '|' + id));
        return r ? r.rec : null;
      },
      async all(d) {
        const db = await open(), rows = await req(tx(db, ['sales'], 'readonly').objectStore('sales').index('depot').getAll(d));
        return rows.map(x => x.rec);
      },
      async addMany(d, recs, queue) {
        if (!recs.length) return 0;
        const db = await open(), t = tx(db, queue ? ['sales', 'outbox'] : ['sales'], 'readwrite');
        let n = 0;
        recs.forEach(rec => {
          const k = d + '|' + rec.id;
          const a = t.objectStore('sales').add({ k, depot: d, id: rec.id, rec });
          a.onsuccess = () => { n++; if (queue) t.objectStore('outbox').put({ k, depot: d, id: rec.id, tries: 0, err: '' }); };
          a.onerror = ev => ev.preventDefault();         // already stored: keep the original, carry on with the rest
        });
        await wait(t);
        return n;
      },
      async outbox(d) {
        const db = await open(), rows = await req(tx(db, ['outbox'], 'readonly').objectStore('outbox').index('depot').getAll(d));
        return rows.map(q => ({ id: q.id, tries: q.tries || 0, err: q.err || '' }));
      },
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

    // Save one sale. It is stored and queued for upload in one transaction; only after this resolves may the receipt be shown.
    async function append(basket) {
      const d = need(), rec = toRecord(basket, env.opts);
      const bad = validate(rec);
      if (bad) throw err('INVALID', 'The sale is not valid: ' + bad);
      await A.add(d, rec);
      return rec;
    }
    async function all() { return (await A.all(need())).sort((a, b) => (a.at - b.at) || a.id.localeCompare(b.id)); }
    async function pending() { return (await A.outbox(need())).length; }

    // Upload this device's outbox. Stops at the first network failure (everything stays queued). A sale that is already in
    // the cloud with the same till id counts as uploaded, which is what makes retries and double taps harmless.
    async function push(cloud) {
      const d = need(), queue = await A.outbox(d);
      let sent = 0, lastErr = '';
      for (const q of queue) {
        const rec = await A.get(d, q.id);
        if (!rec) { await A.unqueue(d, q.id); continue; }
        const path = 'depots/' + d + '/sales/' + q.id;
        try { await cloud.putIfAbsent(path, forCloud(rec)); await A.unqueue(d, q.id); sent++; continue; }
        catch (e) {
          const c = (e && e.code) || 'error';
          if (c === 'NETWORK' || c === 'NO_AUTH') { lastErr = c; break; }
          let there = null;
          try { there = await cloud.get(path); } catch (e2) { lastErr = (e2 && e2.code) || 'error'; if (lastErr === 'NETWORK' || lastErr === 'NO_AUTH') break; await A.bump(d, q.id, lastErr); continue; }
          if (there && typeof there === 'object' && there.tillId === rec.tillId) { await A.unqueue(d, q.id); sent++; }
          else { lastErr = c; await A.bump(d, q.id, c); }
        }
      }
      return { sent, left: (await A.outbox(d)).length, error: lastErr };
    }

    // Download the sales other tills have uploaded. Incremental: the cursor is the newest createdAt seen, and each pull
    // starts a minute before it, so nothing written at the same moment is missed (re-reading a record is harmless).
    async function pull(cloud) {
      const d = need(), ck = 'cursor:' + d;
      let cursor = Number(await A.getMeta(ck)) || 0, start = cursor ? Math.max(0, cursor - OVERLAP_MS) : 0, added = 0, bad = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await cloud.query('depots/' + d + '/sales', 'orderBy=' + encodeURIComponent('"createdAt"') + '&startAt=' + start + '&limitToFirst=' + PAGE);
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
        if (ids.length < PAGE || maxC <= start) break;   // last page, or a full page that cannot move on: stop rather than loop
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

  return { V, ID_RE, BATCH_NAME, DISC_MAX_PCT, toRecord, validate, forCloud, fromCloud, issuedRows, soldById, stockBook, batchBook, linePaid, methodsOf, netPrice, discountPolicy, discountSplit, discountJudge, pctText, create, memAdapter, idbAdapter };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sales; // lets Node load it for tests
