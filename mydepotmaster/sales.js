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
 * PROMOTIONS (roadmap step 25): an offer the till applies by itself, from the list the Admin keeps under Settings -> Promotions (DATA.promotions). Four kinds, each on
 *   chosen items and/or whole categories, between two dates and on chosen weekdays: a percentage off (pct), a special price per unit (price), N for a fixed price (multi),
 *   buy N get M free (bogo). pct and price can need a minimum quantity. An offer works on ONE sale line at a time (a line is one item); a line gets the single offer that
 *   saves the customer most, never two. promoApply() is the one place that works it out, in whole ngwee; nothing is stored about it except what the sale records.
 *   ON THE RECORD a promotion is a discount with a name. line.discount stays "all the money off this line" (offer + manual), so line.total, netPrice(), the returns maths,
 *   stock value and every report that sums line totals stay right with no change. What is new and additive: line.promoDiscount / promoId / promoName (the part that came
 *   from the offer) and the header's promoDiscount (their sum). A sale whose whole discount is offers has discountBy = PROMO_BY, so a reader that has never heard of
 *   promotions still accepts it. A manual (basket) discount is worked on the value AFTER the offers, so the cashier's limit is a share of what the customer would
 *   otherwise pay. discountParts(sale) splits a sale's discount into { promoC, manualC } for reports and the audit log.
 *
 * MULTIPLE UNITS (roadmap step 26): an item has one base unit and may be sold in others (PACK = 6, CARTON = 24). A line in another unit carries `factor` (base units in
 *   one of it) and `base` (the base unit's name); qty, price, total and discounts stay in the sold unit, and baseQty(line) = qty x factor is what stock, issuedRows and soldById
 *   count. Lines without `factor` (the base unit, and every sale before step 26) read exactly as before. unitList(item, basePrice) is the one place that works out which units an
 *   item is sold in and at what price.
 *
 * PRICE LEVELS (roadmap step 27): an item has its normal RETAIL price (the Price List) and may also have a WHOLESALE price, per base unit (and optionally one of its own per pack or
 *   carton), plus an optional "wholesale from N" quantity. A line is sold at the wholesale price when the basket is a wholesale basket (the cashier or a wholesale customer chose it) or
 *   when the item's total in the basket reaches its "from" quantity. levelApply() is the one place that decides, line by line, in whole ngwee, TOGETHER WITH the offers of step 25:
 *   a line takes whichever is cheaper for the customer, the wholesale price or the retail price with its offer; they are never stacked. A wholesale price is only ever used when it is
 *   BELOW the retail price. ON THE RECORD a wholesale line is simply sold at its (lower) price: line.price is what was charged, so totals, stock value, returns and every report need no
 *   change. New, additive: line.level ('wholesale') + line.listPrice (the retail price per sold unit, higher than price) and, when the basket was chosen as a wholesale basket,
 *   the header's priceLevel ('wholesale') + priceLevelBy (who allowed it: the person, the manager whose PIN approved it, or the wholesale customer's account).
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
  const PROMO_BY = 'Promotion';                           // discountBy of a sale whose whole discount came from offers
  const WHOLESALE = 'wholesale';                         // step 27: the one price level besides retail (retail has no name: it is the plain price)
  const PROMO_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const FACTOR_MAX = 100000;                             // step 26: the most base units one sold unit may hold (a carton of 24, a bag of 50 kg ...)
  const BATCH_NAME = 'TILL SALES';                       // pseudo batch the main app shows for commodity sold at the till

  const isNum = x => typeof x === 'number' && isFinite(x);
  // The app's date rule: the DEVICE's own calendar date (index.html's today() and pos.html's localYMD give the same). It used to be the UTC date.
  const localDay = t => { const d = t instanceof Date ? t : new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const r2 = n => Math.round(n * 100) / 100;
  const r3 = n => Math.round(n * 1000) / 1000;
  const toC = n => Math.round((Number(n) || 0) * 100);
  const str = (x, n) => (x == null ? '' : String(x)).slice(0, n);
  // Login-link step 7: the staff profile behind a login travels on the record as a plain string of 1 to 64 characters, and ONLY when the login is linked to one.
  // staffIdOf() is what the builders use (an odd value is left out, never cut short, so a sale is never refused over it); okStaffId() is what validate checks.
  const staffIdOf = v => { const t = v == null ? '' : String(v); return t.length >= 1 && t.length <= 64 ? t : ''; };
  const okStaffId = v => typeof v === 'string' && v.length >= 1 && v.length <= 64;
  function err(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
  // Realtime Database hands back an array as {"0":..,"1":..}, and drops an empty one altogether.
  const arr = x => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : []);

  // ══════════════════════════════════════════════════════════════════════════════
  // MULTIPLE UNITS (roadmap step 26)
  // ══════════════════════════════════════════════════════════════════════════════
  // A stock item has ONE base unit (item.unit: PCS, KG ...). Stock is always counted in it. The item may ALSO be sold in bigger (or smaller) units,
  // e.g. PACK = 6 PCS, CARTON = 24 PCS: item.units = [{ name, factor, barcode, price }], factor = base units in one of that unit, price optional
  // (blank = base price x factor), barcode optional (a carton has its own). A sale line in such a unit is written in THAT unit and says how big it is:
  //   { unit:'CARTON', qty:2, price:<per carton>, total, factor:24, base:'PCS' }       2 cartons = 48 PCS off the shelf
  // `factor` and `base` are absent for a line in the base unit, and for every line written before step 26, so those read exactly as they did.
  // qty, price, total, discount and the offers stay in the SOLD unit (the receipt, the returns and the money all follow what the customer saw);
  // only what is counted against STOCK is converted, by baseQty(). Commodities are not sold in several units.
  const fOf = l => (l && isNum(l.factor) && l.factor > 0) ? l.factor : 1;
  const baseQty = l => { const f = fOf(l), q = Number(l && l.qty) || 0; return f === 1 ? q : r3(q * f); };
  // The units an item is sold in: item = { unit, barcode, units:[{name,factor,barcode,price}] }, basePrice = list price per base unit.
  // -> [{ name, factor, barcode, price, wprice, isBase, own }], base unit first. A unit with no name, a repeated name, a factor of 1 or a bad factor is left out.
  // `own` is true when the unit carries its own price; otherwise the price is basePrice x factor, rounded to the ngwee.
  // Step 27: wholeBase = the wholesale price per BASE unit (optional). `wprice` is each unit's wholesale price: its own (item.units[].wprice) or wholeBase x factor, and 0 (none)
  // unless it is below that unit's retail price: a wholesale price is never used when it would not be cheaper.
  function unitList(item, basePrice, wholeBase) {
    item = item || {};
    const bp = Number(basePrice) || 0, wb = Number(wholeBase) > 0 ? Number(wholeBase) : 0, alts = [], seen = new Set();
    const wpOf = (retail, raw) => { const w = isNum(raw) && raw > 0 ? r2(raw) : 0; return w > 0 && w < retail ? w : 0; };
    let baseName = str(item.unit, 40).trim();
    seen.add(baseName.toUpperCase());
    arr(item.units).forEach(u => {
      if (!u) return;
      const name = str(u.name, 40).trim(), f = Number(u.factor);
      if (!name || seen.has(name.toUpperCase()) || !isNum(f) || !(f > 0) || f === 1 || f > FACTOR_MAX || Math.abs(f * 1000 - Math.round(f * 1000)) > 1e-6) return;
      seen.add(name.toUpperCase());
      const own = isNum(Number(u.price)) && Number(u.price) > 0, price = own ? r2(Number(u.price)) : r2(bp * f);
      const ownW = isNum(Number(u.wprice)) && Number(u.wprice) > 0;
      alts.push({ name, factor: f, barcode: str(u.barcode, 48), price, wprice: wpOf(price, ownW ? Number(u.wprice) : wb * f), isBase: false, own });
    });
    if (!baseName && alts.length) baseName = 'EACH';
    return [{ name: baseName, factor: 1, barcode: str(item.barcode, 48), price: r2(bp), wprice: wpOf(r2(bp), wb), isBase: true, own: true }].concat(alts);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // THE RECORD
  // ══════════════════════════════════════════════════════════════════════════════
  // {
  //   v:1, id, receiptNo, tillId, till, seq,            id === receiptNo; till = 4-char code; tillId = long random id
  //   at, date, time,                                    epoch ms; date/time as the main app writes them
  //   cashier, cashierRole,
  //   cashierStaffId (optional; login-link step 7: the id of the staff profile linked to the cashier's login, 1 to 64 characters; absent when the login is linked to nobody, and on every sale before step 7),
  //   shiftId (optional; step 16: the shift this sale was taken in, e.g. K7F2-S0001; sales before step 16 have none),
  //   lines:[{itemId, kind:'item'|'commodity', name, unit, qty, price, total}],   price copied at the moment of sale
  //   lineCount, qtyTotal, total,
  //   payments:[{method, label, amount, tendered, ref}],                          absent for a pure credit sale
  //   amountPaid, change, balance, creditStatus:'paid'|'partial'|'credit', customerId, customerName
  // }
  // opts.dateOf(at) must give the date the way the main app's today() does (the device's own date), so the till's
  // sales land on the same day as everything else in Sales History and the daily close-out.
  function toRecord(b, opts) {
    opts = opts || {};
    const at = Math.round(Number(b.at));
    const dateOf = opts.dateOf || localDay;
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
        const fc = Number(l.factor);
        if (o.kind === 'item' && isNum(fc) && fc > 0 && fc !== 1) { o.factor = fc; o.base = str(l.base, 40); }   // step 26: absent unless sold in a unit other than the base
        const pd = Number(l.promoDiscount);
        if (isNum(pd) && pd > 0 && l.promoId) { o.promoDiscount = pd; o.promoId = str(l.promoId, 40); o.promoName = str(l.promoName, 60); }   // step 25: the part of o.discount that an offer gave
        const lp = Number(l.listPrice);
        if (l.level === WHOLESALE && isNum(lp) && lp > o.price) { o.level = WHOLESALE; o.listPrice = lp; }   // step 27: sold at the wholesale price; listPrice = the retail price per sold unit
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
    const staffId = staffIdOf(b.cashierStaffId);         // step 7: only when the login is linked to a staff profile
    if (staffId) rec.cashierStaffId = staffId;
    const dsum = rec.lines.reduce((a, l) => a + toC(l.discount), 0);
    const psum = rec.lines.reduce((a, l) => a + toC(l.promoDiscount), 0);
    if (dsum > 0) {
      rec.discount = dsum / 100;
      const onlyOffers = psum === dsum;                  // every cent of the discount came from offers: nobody gave it, the offer did
      rec.discountBy = str(b.discountBy, 80) || (onlyOffers ? PROMO_BY : '');
      rec.discountReason = str(b.discountReason, 60) || (onlyOffers ? Array.from(new Set(rec.lines.filter(l => l.promoName).map(l => l.promoName))).join(', ').slice(0, 60) : '');
    }
    if (psum > 0) rec.promoDiscount = psum / 100;
    if (b.priceLevel === WHOLESALE && rec.lines.some(l => l.level)) { rec.priceLevel = WHOLESALE; rec.priceLevelBy = str(b.priceLevelBy, 80); }   // step 27: only when the basket was chosen as a wholesale basket and a line really got the lower price
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
    if (s.cashierStaffId !== undefined && !okStaffId(s.cashierStaffId)) return 'bad cashier profile id';
    if (s.shiftId !== undefined && (!SID_RE.test(String(s.shiftId)) || String(s.shiftId).slice(0, 4) !== s.till)) return 'bad shift id';
    const lines = s.lines;
    if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) return 'bad lines';
    let sum = 0, qty = 0, dsum = 0, psum = 0;
    for (const l of lines) {
      if (!l || typeof l.itemId !== 'string' || !l.itemId || l.itemId.length > 80) return 'bad item id';
      if (l.kind !== 'item' && l.kind !== 'commodity') return 'bad item kind';
      if ((l.kind === 'commodity') !== /^com:./.test(l.itemId)) return 'item kind does not match its id';
      if (typeof l.name !== 'string' || !l.name || l.name.length > 200) return 'bad item name';
      if (l.factor !== undefined || l.base !== undefined) {   // step 26: a line sold in a pack or carton says how many base units it holds
        if (l.kind !== 'item') return 'only stock items are sold in several units';
        if (!isNum(l.factor) || !(l.factor > 0) || l.factor > FACTOR_MAX || Math.abs(l.factor * 1000 - Math.round(l.factor * 1000)) > 1e-6) return 'bad unit size';
        if (typeof l.base !== 'string' || !l.base || l.base.length > 40) return 'bad base unit';
      }
      if (!isNum(l.qty) || !(l.qty > 0) || !isNum(l.price) || l.price < 0 || !isNum(l.total) || l.total < 0) return 'bad line amounts';
      if (l.level !== undefined || l.listPrice !== undefined) {   // step 27: a line sold at the wholesale price says what the retail price was
        if (l.level !== WHOLESALE) return 'bad price level';
        if (!isNum(l.listPrice) || !(l.listPrice > l.price) || !twoDp(l.listPrice)) return 'a wholesale line needs the retail price, and it must be higher than the price charged';
      }
      const dsc = l.discount === undefined ? 0 : l.discount;
      if (!isNum(dsc) || dsc < 0 || Math.abs(dsc * 100 - Math.round(dsc * 100)) > 1e-6) return 'bad line discount';
      const gross = r2(l.price * l.qty);
      if (dsc > gross + 0.005) return 'a line discount is more than the line';
      if (Math.abs(l.total - r2(gross - dsc)) > 0.005) return dsc ? 'line total does not match price × qty less the discount' : 'line total does not match price × qty';
      if (l.promoDiscount !== undefined) {              // step 25: the part of this line's discount that an offer gave
        const pd = l.promoDiscount;
        if (!isNum(pd) || !(pd > 0) || Math.abs(pd * 100 - Math.round(pd * 100)) > 1e-6) return 'bad line promotion';
        if (pd > dsc + 0.005) return 'a line promotion is more than the line discount';
        if (typeof l.promoId !== 'string' || !PROMO_ID_RE.test(l.promoId)) return 'bad promotion id';
        if (typeof l.promoName !== 'string' || !l.promoName || l.promoName.length > 60) return 'bad promotion name';
        psum += toC(pd);
      } else if (l.promoId !== undefined || l.promoName !== undefined) return 'a promotion needs its amount';
      sum += toC(l.total); qty += l.qty; dsum += toC(dsc);
    }
    if (!isNum(s.total) || toC(s.total) !== sum) return 'total does not match the lines';
    const hd = s.discount === undefined ? 0 : s.discount;
    if (!isNum(hd) || hd < 0 || toC(hd) !== dsum) return 'discount does not match the lines';
    const hp = s.promoDiscount === undefined ? 0 : s.promoDiscount;
    if (!isNum(hp) || hp < 0 || toC(hp) !== psum) return 'promotion total does not match the lines';
    if (hd > 0) {
      if (typeof s.discountBy !== 'string' || !s.discountBy || s.discountBy.length > 80) return 'a discount needs the person who allowed it';
      if (typeof s.discountReason !== 'string' || s.discountReason.length > 60) return 'bad discount reason';
    }
    if (s.priceLevel !== undefined || s.priceLevelBy !== undefined) {   // step 27: the basket was chosen as a wholesale basket
      if (s.priceLevel !== WHOLESALE) return 'bad price level';
      if (typeof s.priceLevelBy !== 'string' || !s.priceLevelBy || s.priceLevelBy.length > 80) return 'wholesale prices need the person who allowed them';
      if (!lines.some(l => l.level === WHOLESALE)) return 'a wholesale basket needs a wholesale line';
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
  // PROMOTIONS (roadmap step 25) — pure functions, shared by the till, the main app's editor and the Node tests
  // ══════════════════════════════════════════════════════════════════════════════
  // A promotion, as the Admin saves it in DATA.promotions:
  //   { id, name, type:'pct'|'price'|'multi'|'bogo', on:true|false,
  //     items:[itemId, ...]  and/or  cats:[category name, ...]     (at least one; a line matches if its item is listed or its category is)
  //     pct (0-100, 2 decimals)            type 'pct':   that much off the line
  //     price (money, per unit)            type 'price': each unit costs this (only ever lowers the price)
  //     buy (whole number >= 2), bundlePrice   type 'multi': every `buy` units cost `bundlePrice` together; the rest at the normal price
  //     buy (>= 1), free (>= 1)            type 'bogo':  of every buy+free units, `free` are free; the rest at the normal price
  //     minQty (optional, pct and price)   the line must have at least this many units
  //     from, to ('YYYY-MM-DD' or '', both days included, the shop's own calendar), days ([0-6], 0 = Sunday; empty = every day) }
  // Money is worked in whole ngwee. Every kind rounds in the shop's favour and can never take off more than the line is worth.
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const PROMO_TYPES = ['pct', 'price', 'multi', 'bogo'];
  const MAX_PROMOS = 200, MAX_PROMO_ITEMS = 100, MAX_PROMO_CATS = 50;
  const twoDp = n => isNum(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
  function realDay(t) {
    if (typeof t !== 'string' || !DAY_RE.test(t)) return false;
    const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)), d = Number(t.slice(8, 10)), x = new Date(Date.UTC(y, m - 1, d));
    return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
  }
  // '' when the promotion is sound, otherwise why not (worded for the person who is typing it in).
  function promoCheck(p) {
    if (!p || typeof p !== 'object') return 'not a promotion';
    if (typeof p.id !== 'string' || !PROMO_ID_RE.test(p.id)) return 'bad promotion id';
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60) return 'Give the promotion a name (up to 60 letters).';
    if (PROMO_TYPES.indexOf(p.type) < 0) return 'Choose what kind of offer it is.';
    const items = p.items === undefined ? [] : p.items, cats = p.cats === undefined ? [] : p.cats;
    if (!Array.isArray(items) || !Array.isArray(cats)) return 'bad item list';
    if (!items.length && !cats.length) return 'Choose at least one item or category.';
    if (items.length > MAX_PROMO_ITEMS || cats.length > MAX_PROMO_CATS) return 'Too many items or categories in one promotion.';
    if (!items.every(x => typeof x === 'string' && x && x.length <= 80)) return 'bad item in the list';
    if (!cats.every(x => typeof x === 'string' && x.trim() && x.length <= 60)) return 'bad category in the list';
    if (p.type === 'pct' && !(isNum(p.pct) && p.pct > 0 && p.pct <= 100 && twoDp(p.pct))) return 'The percentage must be more than 0 and at most 100.';
    if (p.type === 'price' && !(isNum(p.price) && p.price >= 0 && p.price <= 1e7 && twoDp(p.price))) return 'Type the special price per unit.';
    if (p.type === 'multi') {
      if (!(Number.isInteger(p.buy) && p.buy >= 2 && p.buy <= 1000)) return 'Type how many units make the bundle (2 or more).';
      if (!(isNum(p.bundlePrice) && p.bundlePrice >= 0 && p.bundlePrice <= 1e7 && twoDp(p.bundlePrice))) return 'Type the price of the bundle.';
    }
    if (p.type === 'bogo') {
      if (!(Number.isInteger(p.buy) && p.buy >= 1 && p.buy <= 1000)) return 'Type how many units the customer buys (1 or more).';
      if (!(Number.isInteger(p.free) && p.free >= 1 && p.free <= 1000)) return 'Type how many units are free (1 or more).';
    }
    if (p.minQty !== undefined && !(isNum(p.minQty) && p.minQty >= 0 && p.minQty <= 1e6)) return 'The minimum quantity must be 0 or more.';
    const from = p.from === undefined ? '' : p.from, to = p.to === undefined ? '' : p.to;
    if ((from !== '' && !realDay(from)) || (to !== '' && !realDay(to))) return 'Type the dates as day, month and year.';
    if (from && to && from > to) return 'The end date is before the start date.';
    const days = p.days === undefined ? [] : p.days;
    if (!Array.isArray(days) || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) return 'bad weekdays';
    return '';
  }
  // DATA.promotions (anything: missing, a Realtime Database object, junk) -> clean promotions only. A bad one is dropped, never thrown;
  // the first of two with the same id wins. Switched off unless `on` is exactly true.
  function promoList(raw) {
    const seen = new Set(), out = [];
    arr(raw).forEach(p0 => {
      if (!p0 || typeof p0 !== 'object') return;
      const p = Object.assign({}, p0);                                  // a list may come back as {"0":..,"1":..}: make it a real array before it is checked
      ['items', 'cats', 'days'].forEach(k => { if (p[k] !== undefined) p[k] = arr(p[k]); });
      if (out.length >= MAX_PROMOS || promoCheck(p) || seen.has(p.id)) return;
      seen.add(p.id);
      out.push({
        id: p.id, name: p.name.trim(), type: p.type, on: p.on === true,
        items: arr(p.items).slice(), cats: arr(p.cats).map(c => c.trim()),
        pct: p.type === 'pct' ? p.pct : 0, price: p.type === 'price' ? p.price : 0,
        buy: p.type === 'multi' || p.type === 'bogo' ? p.buy : 0, bundlePrice: p.type === 'multi' ? p.bundlePrice : 0, free: p.type === 'bogo' ? p.free : 0,
        minQty: (p.type === 'pct' || p.type === 'price') && isNum(p.minQty) ? p.minQty : 0,
        from: p.from || '', to: p.to || '', days: arr(p.days).slice().sort((a, b) => a - b).filter((d, i, a) => a.indexOf(d) === i)
      });
    });
    return out;
  }
  // The shop's calendar day and weekday for a moment. Local time of the phone, on purpose: "until Friday" means the shop's Friday, whereas a sale's own
  // `date` field is the device's own day too (the main app's today()).
  function promoDay(ms) {
    const d = new Date(ms), pad = n => String(n).padStart(2, '0');
    return { date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), dow: d.getDay() };
  }
  const promoActive = (p, day) => !!(p && p.on && (!p.from || day.date >= p.from) && (!p.to || day.date <= p.to) && (!p.days.length || p.days.indexOf(day.dow) >= 0));
  const promoMatches = (p, l) => p.items.indexOf(l.itemId) >= 0 || (!!l.category && p.cats.some(c => c.toLowerCase() === String(l.category).trim().toLowerCase()));
  const nTxt = n => String(Math.round(n * 1000) / 1000);
  // The offer in words, for lists, the cart and the receipt. opts.money(n) formats money.
  function promoText(p, opts) {
    const money = (opts && opts.money) || (n => r2(n).toFixed(2));
    const min = p.minQty > 0 ? ' when you buy ' + nTxt(p.minQty) + ' or more' : '';
    if (p.type === 'pct') return pctText(Math.round(p.pct * 100)) + '% off' + min;
    if (p.type === 'price') return 'Special price ' + money(p.price) + min;
    if (p.type === 'multi') return p.buy + ' for ' + money(p.bundlePrice);
    return 'Buy ' + p.buy + ' get ' + p.free + ' free';
  }
  // What ONE promotion takes off ONE line.  line = { itemId, category, qty, price } -> { discC: ngwee, hint }
  // hint: when the line is close to earning the offer (or one more of it), what to add; shown to the cashier. '' when there is nothing useful to say.
  function promoLine(p, line, opts) {
    const q = Number(line.qty), price = Number(line.price), EPS = 1e-9;
    if (!(q > 0) || !(price >= 0)) return { discC: 0, hint: '' };
    const grossC = toC(r2(price * q));
    let d = 0, hint = '';
    if (p.type === 'pct' || p.type === 'price') {
      if (q + EPS < p.minQty) hint = 'Buy ' + nTxt(p.minQty) + ' or more: ' + promoText(Object.assign({}, p, { minQty: 0 }), opts);
      else if (p.type === 'pct') { const x = grossC * Math.round(p.pct * 100); d = (x - (x % 10000)) / 10000; }     // rounded DOWN
      else d = grossC - Math.round(p.price * q * 100);
    } else if (p.type === 'multi') {
      const regularC = Math.round(price * p.buy * 100), bundleC = toC(p.bundlePrice);
      if (bundleC < regularC) {
        const g = Math.floor(q / p.buy + EPS), rem = q - g * p.buy;
        if (g >= 1) d = Math.round(price * p.buy * g * 100) - g * bundleC;
        if (rem > EPS) hint = 'Add ' + nTxt(Math.ceil(p.buy - rem - EPS)) + ' more: ' + promoText(p, opts);
      }
    } else {                                                                                                          // bogo
      const grp = p.buy + p.free, g = Math.floor(q / grp + EPS), rem = q - g * grp;
      d = Math.round(price * g * p.free * 100);
      if (rem + EPS >= p.buy && rem < grp - EPS) hint = 'Add ' + nTxt(Math.ceil(grp - rem - EPS)) + ' more to get ' + p.free + (g >= 1 ? ' more' : '') + ' free';
    }
    d = Math.max(0, Math.min(d, grossC));
    return { discC: d, hint };
  }
  // The offers for a whole basket.  lines: [{ itemId, category, qty, price }]; promos: promoList() output; ctx: { now } (ms) or { day } (promoDay result).
  // -> { lines: [{ discC, promo: { id, name, type } | null, hint }], totalC }, one entry per line, in order. A line takes the offer that saves most
  // (the first listed wins a tie); other offers are not stacked on it.
  function promoApply(lines, promos, ctx) {
    ctx = ctx || {};
    const day = ctx.day || promoDay(ctx.now != null ? ctx.now : Date.now());
    const live = arr(promos).filter(p => promoActive(p, day));
    const out = arr(lines).map(l => {
      l = l || {};
      let best = null, hint = '';
      live.forEach(p => {
        if (!promoMatches(p, l)) return;
        const r = promoLine(p, l, ctx);
        if (r.discC > 0) { if (!best || r.discC > best.discC) best = { p, discC: r.discC, hint: r.hint }; }
        else if (r.hint && !hint) hint = r.hint;
      });
      return best ? { discC: best.discC, promo: { id: best.p.id, name: best.p.name, type: best.p.type }, hint: best.hint } : { discC: 0, promo: null, hint };
    });
    return { lines: out, totalC: out.reduce((a, x) => a + x.discC, 0) };
  }
  // A sale's discount split into what the offers gave and what a person gave, in ngwee (a sale from before step 25 has all of it manual).
  function discountParts(s) {
    const all = toC(s && s.discount), promo = Math.min(all, toC(s && s.promoDiscount));
    return { allC: all, promoC: promo, manualC: all - promo };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PRICE LEVELS (roadmap step 27) — pure functions, shared by the till, the main app and the Node tests
  // ══════════════════════════════════════════════════════════════════════════════
  // The depot's policy (Settings -> Wholesale prices, kept in depotInfo): wholesaleOn (default OFF: until the Admin switches it on the till sells at retail only) and
  // wholesaleBy: 'pin' (default: a Cashier or Staff login needs a manager PIN to make a basket wholesale; an Admin or Manager login needs none) or 'any' (anyone at the till).
  // A wholesale CUSTOMER (a contact with priceLevel 'wholesale', set by the Admin) needs no PIN: the Admin already decided that customer is wholesale.
  function levelPolicy(depotInfo) {
    const di = depotInfo || {};
    return { on: di.wholesaleOn === true, anyone: di.wholesaleBy === 'any' };
  }
  // The price of every line of a basket, and the offers, together.  lines: [{ itemId, category, qty, f, rp, wp, wm }]
  //   qty  in the SOLD unit;  f  base units in one of it (1 for the base unit);  rp / wp  the RETAIL and WHOLESALE price of the sold unit (wp 0 = none);
  //   wm   the quantity, in BASE units counted over every line of that item, from which the item is wholesale by itself (0 = never by quantity).
  // o: { on, level:'retail'|'wholesale' (the basket), promos (promoList output), now | day, money }.
  // A line is wholesale when it has a wholesale price below its retail price AND (the basket is wholesale OR its item reaches wm) AND the wholesale line costs the
  // customer no more than the same line at retail with its best offer. Otherwise it is retail, with that offer. Offers are never added to a wholesale line.
  // -> { lines: [{ price, listPrice, level:''|'wholesale', discC, promo, hint }], totalC }   price = what one sold unit costs; discC = the offer's money off in ngwee.
  function levelApply(lines, o) {
    o = o || {};
    const on = o.on !== false, basket = on && o.level === WHOLESALE, money = typeof o.money === 'function' ? o.money : (n => r2(n).toFixed(2));
    const L = arr(lines).map(l => l || {});
    const fx = l => (isNum(l.f) && l.f > 0) ? l.f : 1;
    const bq = l => { const q = Number(l.qty) || 0, f = fx(l); return f === 1 ? q : r3(q * f); };
    const tot = new Map();
    L.forEach(l => tot.set(l.itemId, r3((tot.get(l.itemId) || 0) + bq(l))));
    const retail = promoApply(L.map(l => ({ itemId: l.itemId, category: l.category, qty: bq(l), price: (Number(l.rp) || 0) / fx(l) })), o.promos, o);   // offers are judged on the base-unit equivalent, as in step 26
    const out = L.map((l, i) => {
      const rp = Number(l.rp) || 0, wp = Number(l.wp) || 0, wm = Number(l.wm) || 0, q = Number(l.qty) || 0, have = tot.get(l.itemId) || 0;
      let r = retail.lines[i];
      if (on && wp > 0 && wp < rp) {
        if (basket || (wm > 0 && have + 1e-9 >= wm)) {
          const wC = toC(r2(wp * q)), rC = toC(r2(rp * q)) - r.discC;
          if (wC <= rC) return { price: wp, listPrice: rp, level: WHOLESALE, discC: 0, promo: null, hint: '' };
        } else if (wm > 0 && fx(l) === 1 && !r.hint) {
          r = { discC: r.discC, promo: r.promo, hint: 'Buy ' + nTxt(wm) + ' or more: wholesale price ' + money(wp) };
        }
      }
      return { price: rp, listPrice: rp, level: '', discC: r.discC, promo: r.promo, hint: r.hint };
    });
    return { lines: out, totalC: out.reduce((a, x) => a + x.discC, 0) };
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
  // The general-issue row for one sale or return line. In the base unit it is what it always was. In another unit (step 26) the row is in BASE units
  // (issued = qty x factor, price per base unit, the base unit's name), so every report that adds up `issued` or issued x price stays right; soldQty /
  // soldUnit / soldFactor keep what the customer saw, for Sales History to show.
  function unitRow(l) {
    const f = fOf(l);
    if (f === 1) return { itemName: l.name, itemId: l.itemId, sellingPrice: netPrice(l), unit: l.unit };
    return { itemName: l.name, itemId: l.itemId, sellingPrice: netPrice(l) / f, unit: l.base, soldQty: Number(l.qty), soldUnit: l.unit, soldFactor: f };
  }
  function issuedRows(sales, returns) {
    const gen = [], com = {};
    const list = (sales || []).slice().sort((a, b) => (a.date + a.time + a.id).localeCompare(b.date + b.time + b.id));
    list.forEach(s => {
      const paid = linePaid(s);
      s.lines.forEach((l, i) => {
        const base = {
          id: s.id + '#' + i, _sale: true, saleId: s.id, receiptNo: s.receiptNo, tillId: s.tillId,
          date: s.date, time: s.time, issued: baseQty(l), notes: '',
          creditStatus: l.total > 0 ? s.creditStatus : 'paid',
          partialPaid: s.creditStatus === 'partial' ? paid[i] : 0,
          customerId: s.customerId || '', customerName: s.customerName || '',
          enteredBy: s.cashier, enteredByRole: s.cashierRole || '', enteredAt: s.at, approvalStatus: 'approved',
          payMethods: methodsOf(s)
        };
        if (s.cashierStaffId) base.enteredByStaffId = s.cashierStaffId;   // step 7: the main app's "entered by" finds the person (same field the main app's own entries carry)
        if (l.kind === 'commodity') {
          const cid = l.itemId.slice(4);
          (com[cid] || (com[cid] = [])).push(Object.assign(base, { batchName: BATCH_NAME, transporter: '', salePrice: netPrice(l) }));
        } else {
          gen.push(Object.assign(base, unitRow(l)));
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
          date: r.date, time: r.time, issued: -baseQty(l), notes: (r.kind === 'void' ? 'VOID of ' : 'REFUND of ') + r.saleId + ' \u00B7 ' + (r.reason || ''),
          creditStatus: toC(l.total) > 0 ? st : 'paid', partialPaid: st === 'partial' ? -pc / 100 : 0,
          customerId: r.customerId || '', customerName: r.customerName || '',
          enteredBy: r.cashier, enteredByRole: r.cashierRole || '', enteredAt: r.at, approvalStatus: 'approved', payMethods: how
        };
        if (r.cashierStaffId) base.enteredByStaffId = r.cashierStaffId;   // step 7: as for sales
        if (l.kind === 'commodity') {
          const cid = l.itemId.slice(4);
          (com[cid] || (com[cid] = [])).push(Object.assign(base, { batchName: BATCH_NAME, transporter: '', salePrice: netPrice(l) }));
        } else {
          gen.push(Object.assign(base, unitRow(l)));
        }
      });
    });
    return { gen, com };
  }

  // itemId -> quantity sold (items AND commodities; commodity ids start with "com:"). The till subtracts this from stock.
  function soldById(sales) {
    const m = new Map();
    (sales || []).forEach(s => s.lines.forEach(l => m.set(l.itemId, r3((m.get(l.itemId) || 0) + baseQty(l)))));
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
    (src.sales || []).forEach(s => { if (s && within(s.date, s.time)) arr(s.lines).forEach(l => add(l.itemId, 'sold', baseQty(l))); });
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
  // EXPIRY AND BATCHES OF A GENERAL ITEM  (roadmap step 30)
  // ══════════════════════════════════════════════════════════════════════════════
  // A BATCH is what one delivery brought in: its received rows carry an optional batchNo and an optional expiryDate ('YYYY-MM-DD'). Rows with the same batchNo AND the
  // same expiry date are one batch; a row with neither belongs to the undated batch (stock that does not expire, and every delivery received before step 30).
  // Nothing is stored about it, exactly like stockBook and batchBook: expiryBook() replays the records in date/time order (at the same minute: received, issued, sold,
  // returned) and ALLOCATES every outgoing quantity to the batches FEFO (first expired, first out), so the per-batch figures always add up to the item's stockBook() balance.
  //   - A SALE takes from the batch that expires first and is still in date on the day of the sale, then the next, and so on; undated stock goes last. Only when nothing in
  //     date is left does it take expired stock (a sale of expired goods that was let through); anything over what is in stock goes to the batch it last took from
  //     (it shows negative: a visible oversell), else the newest batch, else the undated batch.
  //   - An ISSUE that names its batch (issued rows may carry batchNo and/or expiryDate: the "write off this batch" action does) takes it all from that batch (it shows negative if the
  //     batch held less: visible, never spilled onto another batch). An issue that names none takes FEFO, expired stock first.
  //   - A RETURN that goes back on the shelf goes to the batches its sale line came from, in the order they supplied it (a void puts back exactly what it took).
  // EXPIRED means the expiry date has arrived: expiryDate <= today. This is the rule the dashboard alert has always used (a batch is flagged on its date, not the day after).
  // src: { received, issued, sales, returns }   received / issued / sales exactly as for stockBook; returns are the return RECORDS (returns.js), NOT Returns.forStock().
  // opts: idOfName / keyOf / isApproved / until / untilDate / only, exactly as in stockBook.
  // Returns:
  //   keys()                    every item key that has a record
  //   batches(key)              [{ batch, exp, rec, issued, sold, ret, bal }] in FEFO order (soonest expiry first, undated last)
  //   facts(key, today, warn)   { total, expired, soon, next, nextDays, batches }   today = 'YYYY-MM-DD'; warn = days ahead that count as "soon" (default EXPIRY_WARN)
  //                               total = every batch with stock; expired = stock on the shelf whose date has arrived; soon = stock expiring within `warn` days (not yet expired);
  //                               next = the soonest still-in-date batch that has stock ({ batch, exp, qty }) or null; nextDays = days until it
  //                               batches = the batches that hold stock, FEFO order, each { batch, exp, bal, days (null = undated), expired }
  //   allocation(key, id)       which batches a sale line (id "<saleId>#<line index>") came from: [{ batch, exp, qty }]
  const EXPIRY_WARN = 30;
  const dayNo = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null; };
  const daysUntil = (exp, today) => { const a = dayNo(exp), b = dayNo(today); return a == null || b == null ? null : a - b; };
  function expiryBook(src, o) {
    o = o || {};
    src = src || {};
    const idOf = o.idOfName || (n => 'name:' + String(n || '').trim().toUpperCase());
    const ok = o.isApproved || (r => !r.approvalStatus || r.approvalStatus === 'approved');
    const keyOf = o.keyOf || (r => r.itemId || idOf(r.itemName));
    const upTo = o.until != null ? String(o.until) : null, upDay = o.untilDate != null ? String(o.untilDate) : null;
    const within = (date, time) => (upTo == null || (String(date || '') + ' ' + (time || '00:00')) <= upTo) && (upDay == null || String(date || '') <= upDay);
    const at = (date, time) => String(date || '') + ' ' + (time || '00:00');
    const expOf = r => { const d = String(r && r.expiryDate || '').trim(); return dayNo(d) == null ? '' : d; };
    const noOf = r => String(r && r.batchNo == null ? '' : r.batchNo).trim().toUpperCase().slice(0, 40);
    const bkey = (no, exp) => no + '|' + exp;
    const EPS = 1e-9;
    const ev = new Map(), dated = new Set();                           // key -> events; keys with any batch or expiry on a received/issued row
    const push = (k, e) => { if (!k || (o.only != null && k !== o.only)) return; let a = ev.get(k); if (!a) ev.set(k, a = []); a.push(e); };
    (src.received || []).forEach(r => {
      if (!r || r._sale || !ok(r) || r.condition === 'rejected' || !within(r.date, r.time)) return;
      const k = keyOf(r), no = noOf(r), exp = expOf(r);
      if (no || exp) dated.add(k);
      push(k, { k: 0, at: at(r.date, r.time), id: String(r.id || ''), no, exp, q: Number(r.received) || 0 });
    });
    (src.issued || []).forEach(r => {
      if (!r || r._sale || !ok(r) || !within(r.date, r.time)) return;
      const k = keyOf(r), no = noOf(r), exp = expOf(r);
      push(k, { k: 1, at: at(r.date, r.time), id: String(r.id || ''), no, exp, tagged: !!(no || exp), q: Number(r.issued) || 0 });
    });
    (src.sales || []).forEach(s => {
      if (!s || !within(s.date, s.time)) return;
      arr(s.lines).forEach((l, i) => { if (l) push(l.itemId, { k: 2, at: at(s.date, s.time), id: s.id + '#' + i, day: String(s.date || ''), q: baseQty(l) }); });
    });
    (src.returns || []).forEach(r => {
      if (!r || !within(r.date, r.time)) return;
      arr(r.lines).forEach(l => { if (l && l.restock !== false) push(l.itemId, { k: 3, at: at(r.date, r.time), id: r.id + '#' + l.lineNo, sl: r.saleId + '#' + l.lineNo, q: baseQty(l) }); });
    });

    const done = new Map();
    function replay(key) {
      let got = done.get(key);
      if (got) return got;
      const list = (ev.get(key) || []).slice();
      list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.k - b.k) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
      const st = new Map(), order = [], lines = new Map(), back = new Map();
      const slot = (no, exp) => { const b = bkey(no, exp); let s = st.get(b); if (!s) { s = { no, exp, rec: 0, issued: 0, sold: 0, ret: 0, i: order.length }; st.set(b, s); order.push(s); } return s; };
      const bal = s => s.rec - s.issued - s.sold + s.ret;
      const rank = s => s.exp || '9999-12-31';                           // undated stock never expires: it goes last
      const fefo = () => order.slice().sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : a.i - b.i));
      // takes `need` from the batches in `seq` that hold stock, in that order; returns what is still needed
      const drain = (seq, need, f) => { for (const s of seq) { if (need <= EPS) break; const have = bal(s); if (have > EPS) { const t = Math.min(have, need); f(s, t); need -= t; } } return need; };
      list.forEach(e => {
        if (e.k === 0) { slot(e.no, e.exp).rec += e.q; return; }
        if (e.k === 1) {
          if (e.tagged) { slot(e.no, e.exp).issued += e.q; return; }       // names its batch: that batch gives all of it (negative when it holds less: visible, never spilled onto another batch)
          const need = drain(fefo(), e.q, (s, t) => { s.issued += t; });
          if (need > EPS) (order.length ? order[order.length - 1] : slot('', '')).issued += need;
          return;
        }
        if (e.k === 3) {
          let need = e.q;
          const parts = lines.get(e.sl) || [];
          for (const p of parts) {
            if (need <= EPS) break;
            const bk = e.sl + '|' + bkey(p.s.no, p.s.exp), free = p.qty - (back.get(bk) || 0);
            if (free > EPS) { const t = Math.min(free, need); p.s.ret += t; back.set(bk, (back.get(bk) || 0) + t); need -= t; }
          }
          if (need > EPS) (parts.length ? parts[parts.length - 1].s : (order.length ? order[order.length - 1] : slot('', ''))).ret += need;
          return;
        }
        let need = e.q, last = null;
        const parts = [];
        const take = (s, t) => { s.sold += t; last = s; const p = parts.find(x => x.s === s); if (p) p.qty += t; else parts.push({ s, qty: t }); };
        const live = fefo().filter(s => bal(s) > EPS);
        need = drain(live.filter(s => !s.exp || s.exp > e.day), need, take);          // in date on the day of the sale
        need = drain(live.filter(s => s.exp && s.exp <= e.day), need, take);          // expired: only when nothing in date is left
        if (need > EPS) take(last || (order.length ? order[order.length - 1] : slot('', '')), need);
        lines.set(e.id, parts);
      });
      got = { order, st, lines, bal, fefo };
      done.set(key, got);
      return got;
    }
    const fin = s => ({ batch: s.no, exp: s.exp, rec: r3(s.rec), issued: r3(s.issued), sold: r3(s.sold), ret: r3(s.ret), bal: r3(s.rec - s.issued - s.sold + s.ret) });
    const batches = k => replay(k).fefo().map(fin);
    return {
      keys: () => Array.from(ev.keys()),
      has: k => dated.has(k),                                          // true when the item has any batch number or expiry date at all
      batches,
      facts: (k, today, warn) => {
        const w = warn == null ? EXPIRY_WARN : Number(warn);
        const hold = batches(k).filter(b => b.bal > EPS).map(b => {
          const days = b.exp ? daysUntil(b.exp, today) : null;
          return { batch: b.batch, exp: b.exp, bal: b.bal, days, expired: days != null && days <= 0 };
        });
        const sum = f => r3(hold.filter(f).reduce((a, b) => a + b.bal, 0));
        const nx = hold.find(b => b.exp && !b.expired);
        return {
          total: sum(() => true), expired: sum(b => b.expired), soon: sum(b => b.exp && !b.expired && b.days <= w),
          next: nx ? { batch: nx.batch, exp: nx.exp, qty: nx.bal } : null, nextDays: nx ? nx.days : null, batches: hold
        };
      },
      allocation: (k, id) => (replay(k).lines.get(id) || []).map(p => ({ batch: p.s.no, exp: p.s.exp, qty: r3(p.qty) }))
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // MARGIN REPORT (roadmap step 31)
  // ══════════════════════════════════════════════════════════════════════════════
  // What did the stock we sold cost us, and what is left? Nothing is stored (no cost on the sale record, no counter): marginBook() works the figures out from the same
  // records stockBook() reads, so a report can be re-run for any period and always agrees with the ledger.
  //   REVENUE   what was really taken: sale line.total (after discounts, offers and wholesale prices), less the lines of voids / refunds (booked on the day the return was made,
  //             like Sales History and the Z report, so a day that was closed is never changed), plus the main app's own Issue Item rows that carry a selling price.
  //   COST      the AVERAGE COST OF THE PRIORITISED STOCK RECEIVED UP TO THE MOMENT OF THE SALE: sum(received x purchasePrice) / sum(received) over the item's approved, not
  //             rejected received rows that carry a price, at or before the sale (at the same minute a receive counts first, as in stockBook). So a later price rise never rewrites
  //             an old margin, and a price you paid last year still counts in this year's average, exactly like the Profit & Loss report's average but as at the sale.
  //             A received row with no price (a stock-count surplus, opening stock typed in without a price) is left out of the average: it neither lowers nor raises it.
  //             If NOTHING priced had been received yet, the item's current cost (opts.currentCost) is used and the figure is marked ESTIMATED; with no cost at all the sale is NOT COSTED.
  //   RETURNS   goods that go back on the shelf come off the cost at the SAME unit cost as the sale line they reverse (so a refund never depends on today's price); goods that come
  //             back damaged (restock:false) keep their cost: the money went back, the stock is lost, and the margin shows it. A return of a sale this book cannot see is costed as at the return.
  //   NOT COSTED sales with no cost known are never guessed: their revenue is shown on its own, and margin %, cost and profit are worked ONLY on the costed revenue, so a missing cost can
  //             never inflate a margin. `coverage` says what share of the revenue was costed.
  //   NOT INCLUDED commodity lines (kind 'commodity'): a commodity is bought in bulk and booked as purchases in the P&L; their revenue is reported in `skipped`, never mixed in.
  //   VAT is not separated: revenue and cost are the amounts as entered.
  // Money is worked in whole ngwee per line (cost = round(base qty x unit cost x 100)), so every row, category and the totals add up exactly: profit = costed revenue - cost.
  // src:  received  generalInventory rows  {itemId?, itemName, received, purchasePrice, date, time, approvalStatus, condition}   (purchasePrice is per BASE unit)
  //       issued    generalIssued rows: only rows that are not _sale, are approved and carry sellingPrice > 0 are sales (internal issues have price 0, so they are never margin)
  //       sales     ledger records (sales.js)           returns  return RECORDS (returns.js), NOT Returns.forStock()
  // opts: idOfName / keyOf / isApproved as in stockBook;  from / to  'YYYY-MM-DD' inclusive (omit for all time), or within(date) -> true for a day that is in the period (wins over from / to:
  //       the main app passes its own period rule, so the report always covers exactly the days Sales History and the P&L do);
  //       currentCost(key) the item's cost per base unit today (the fallback);  nameOf(key) / categoryOf(key)  for the labels (default: the name on the records, no category)
  // Returns { rows, categories, totals, skipped, counts }
  //   row / category: { key, name, category?, unit?, qty (net base units sold), revenue, costedRevenue, notCostedRevenue, estimatedRevenue (costed from the current cost), cost, profit,
  //                     marginPct (profit / costed revenue), markupPct (profit / cost), loss (profit < 0), lines }     rows sorted by profit, biggest first
  //   totals:       the same fields over everything, plus coverage (costed revenue / revenue, or null when there is no revenue)
  //   skipped:      { commodityRevenue }       counts: { sales, returns, issued } documents inside the period
  function marginBook(src, o) {
    o = o || {};
    src = src || {};
    const idOf = o.idOfName || (n => 'name:' + String(n || '').trim().toUpperCase());
    const ok = o.isApproved || (r => !r.approvalStatus || r.approvalStatus === 'approved');
    const keyOf = o.keyOf || (r => r.itemId || idOf(r.itemName));
    const from = o.from ? String(o.from) : null, to = o.to ? String(o.to) : null;
    const inRange = o.within ? (d => !!o.within(String(d || ''))) : (d => { d = String(d || ''); return (!from || d >= from) && (!to || d <= to); });
    const at = (date, time) => String(date || '') + ' ' + (time || '00:00');

    // cost history per item: priced received rows in time order, with running totals
    const hist = new Map();
    (src.received || []).forEach(r => {
      if (!r || r._sale || !ok(r) || r.condition === 'rejected') return;
      const q = Number(r.received), p = Number(r.purchasePrice);
      if (!isNum(q) || !(q > 0) || !isNum(p) || !(p > 0)) return;
      const k = keyOf(r); if (!k) return;
      let a = hist.get(k); if (!a) hist.set(k, a = []);
      a.push({ at: at(r.date, r.time), q, v: q * p });
    });
    hist.forEach(a => {
      a.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
      let cq = 0, cv = 0;
      a.forEach(e => { cq += e.q; cv += e.v; e.cq = cq; e.cv = cv; });
    });
    // unit cost per base unit as at a moment: { unit, how: 'avg' | 'current' } or null
    const costAt = (k, when) => {
      const a = hist.get(k);
      if (a) {
        let lo = 0, hi = a.length - 1, best = -1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].at <= when) { best = m; lo = m + 1; } else hi = m - 1; }
        if (best >= 0) return { unit: a[best].cv / a[best].cq, how: 'avg' };
      }
      const cur = o.currentCost ? Number(o.currentCost(k)) : 0;
      return isNum(cur) && cur > 0 ? { unit: cur, how: 'current' } : null;
    };

    const ev = [];                                                    // one event per sale / issue / return line inside the period
    const lineCost = new Map();                                       // 'saleId#lineIndex' -> the cost the sale line was given (a return reverses it at the same cost)
    const skipped = { commodityRevenue: 0 }, counts = { sales: 0, returns: 0, issued: 0 };
    const push = (k, name, unit, d, qty, revC, cost, cogsC) => ev.push({ k, name, unit, d, qty, revC, cost, cogsC });

    (src.sales || []).forEach(s => {
      if (!s) return;
      const day = String(s.date || ''), when = at(s.date, s.time), live = inRange(day);
      if (live) counts.sales++;
      arr(s.lines).forEach((l, i) => {
        if (!l) return;
        if (l.kind === 'commodity') { if (live) skipped.commodityRevenue += toC(l.total); return; }
        const k = l.itemId; if (!k) return;
        const q = baseQty(l), c = costAt(k, when);
        lineCost.set(s.id + '#' + i, c);
        if (live) push(k, l.name, fOf(l) === 1 ? l.unit : (l.base || l.unit), day, q, toC(l.total), c, c ? Math.round(q * c.unit * 100) : 0);
      });
    });
    (src.issued || []).forEach(r => {
      if (!r || r._sale || !ok(r) || !(Number(r.sellingPrice) > 0) || !(Number(r.issued) > 0) || !inRange(r.date)) return;
      const k = keyOf(r); if (!k) return;
      counts.issued++;
      const q = Number(r.issued), c = costAt(k, at(r.date, r.time));
      push(k, r.itemName, '', String(r.date || ''), q, toC(q * Number(r.sellingPrice)), c, c ? Math.round(q * c.unit * 100) : 0);
    });
    (src.returns || []).forEach(r => {
      if (!r || !inRange(r.date)) return;
      counts.returns++;
      arr(r.lines).forEach(l => {
        if (!l) return;
        if (l.kind === 'commodity') { skipped.commodityRevenue -= toC(l.total); return; }
        const k = l.itemId; if (!k) return;
        const q = baseQty(l), had = lineCost.has(r.saleId + '#' + l.lineNo), c = had ? lineCost.get(r.saleId + '#' + l.lineNo) : costAt(k, at(r.date, r.time));
        push(k, l.name, fOf(l) === 1 ? l.unit : (l.base || l.unit), String(r.date || ''), -q, -toC(l.total), c, c && l.restock !== false ? -Math.round(q * c.unit * 100) : 0);
      });
    });

    const blank = () => ({ qty: 0, revC: 0, costedC: 0, notC: 0, estC: 0, cogsC: 0, lines: 0 });
    const add = (t, e) => {
      t.qty += e.qty; t.revC += e.revC; t.lines++;
      if (e.cost) { t.costedC += e.revC; t.cogsC += e.cogsC; if (e.cost.how === 'current') t.estC += e.revC; } else t.notC += e.revC;
    };
    const fin = (t, base) => {
      const profitC = t.costedC - t.cogsC;
      return Object.assign(base, {
        qty: r3(t.qty), revenue: t.revC / 100, costedRevenue: t.costedC / 100, notCostedRevenue: t.notC / 100, estimatedRevenue: t.estC / 100,
        cost: t.cogsC / 100, profit: profitC / 100,
        marginPct: t.costedC !== 0 ? r2(profitC / t.costedC * 100) : null, markupPct: t.cogsC > 0 ? r2(profitC / t.cogsC * 100) : null,
        loss: profitC < 0, lines: t.lines
      });
    };
    const items = new Map(), cats = new Map(), all = blank();
    ev.forEach(e => {
      let it = items.get(e.k);
      if (!it) items.set(e.k, it = { t: blank(), name: e.name, unit: e.unit });
      if (!it.unit && e.unit) it.unit = e.unit;
      add(it.t, e); add(all, e);
    });
    const rows = [];
    items.forEach((it, k) => {
      if (!it.t.qty && !it.t.revC && !it.t.cogsC) return;            // a sale that was fully given back at its own cost leaves nothing to report
      const cat = o.categoryOf ? String(o.categoryOf(k) || '') : '';
      const row = fin(it.t, { key: k, name: (o.nameOf && o.nameOf(k)) || it.name || k, category: cat, unit: it.unit || '' });
      rows.push(row);
      let c = cats.get(cat); if (!c) cats.set(cat, c = { t: blank(), items: 0 });
      c.items++;
      ['qty', 'revC', 'costedC', 'notC', 'estC', 'cogsC', 'lines'].forEach(f => { c.t[f] += it.t[f]; });
    });
    const byProfit = (a, b) => (b.profit - a.profit) || (b.revenue - a.revenue) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    rows.sort(byProfit);
    const categories = Array.from(cats.entries()).map(([cat, c]) => fin(c.t, { key: cat, name: cat, items: c.items })).sort(byProfit);
    skipped.commodityRevenue = skipped.commodityRevenue / 100;
    const totals = fin(all, {});
    totals.coverage = totals.revenue !== 0 ? r2(totals.costedRevenue / totals.revenue * 100) : null;
    totals.items = rows.length;
    return { rows, categories, totals, skipped, counts };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // REORDER SUGGESTIONS (roadmap step 32)
  // ══════════════════════════════════════════════════════════════════════════════
  // What should we order, and how many? Nothing is stored (no reorder level, no counter): reorderBook() works the list out from the records stock already reads, so it always agrees with the ledger.
  //   AVAILABLE  what can be sold today = the item's stock (the caller's onHand(key): stockBook's balance, so there is ONE stock formula) less its reserved quantity and less any stock past its
  //              expiry date (opts.unsellable(key), from expiryBook: the till will not sell it). It can be negative (an oversell).
  //   RATE       what customers take per day over the last `look` COMPLETE days (today is left out: it is not finished): till sale lines + the main app's priced Issue Item rows (the same rule as
  //              marginBook: an issue with a selling price is a sale), less what customers gave back (void / refund lines, restocked or not). Internal issues, write-offs and stock-count losses are
  //              not demand. Commodity lines are not in this list. Quantities are in BASE units. An item younger than the window is averaged over the complete days since its first receive or
  //              sale, so a new line is not under-counted; `thin` marks a rate worked from fewer than 7 days (a rough guess). A day the shelf was empty counts as a day of no demand.
  //   COVER      days the available stock lasts at that rate = available / rate (null when nothing sells).
  //   THE RULE   safety = the item's minimum stock (set by the Admin on the item); lead = days the supplier takes; cover = days of stock to hold after a delivery.
  //                REORDER POINT = safety + rate x lead              order when what is available is at or below it: it would dip into the safety stock before a delivery can arrive
  //                ORDER UP TO   = safety + rate x (lead + cover)
  //                ORDER         = ORDER UP TO - available, to the nearest thousandth and then UP to a whole base unit
  //   STATUS     'out' (nothing available) > 'low' (at or under the minimum: the same test as the low-stock alert, on a smaller number) > 'soon' (above the minimum, at or under the reorder point)
  //              > 'ok' (never listed). 'none': no minimum and nothing sold in the window, so there is nothing to size an order from (never listed).
  //              At or under its minimum with no recent sales, the order is only what brings it back to the minimum (0 when it sits exactly on it: flagged, but there is nothing to size an order from).
  // Money is the item's CURRENT cost per base unit (items[].cost), an estimate: value = round(order x cost x 100) / 100 per row, and the total adds the rows.
  // src:   items     [{ id, name, minStock, reserved?, category?, unit?, cost? }]   the item master (an item with no id is skipped)
  //        received  generalInventory rows (only to find when an item first appeared)      issued  generalIssued rows      sales  ledger records      returns  return RECORDS (returns.js)
  // opts:  today 'YYYY-MM-DD' (default: the device's own date);  lead / cover / look  the policy in whole days (see reorderPolicy: anything missing or out of range takes the default);
  //        onHand(key) REQUIRED;  unsellable(key) optional;  idOfName / keyOf / isApproved as in stockBook
  // Returns { rows, totals, policy }
  //   row:    { key, name, category, unit, onHand, reserved, expired, available, min, demand (net units over `days`), days (complete days averaged), rate (per day), thin, cover (days), reorderPoint, orderUpTo,
  //             status, flag (out / low / soon), qty (to order), cost, value }      sorted: out, low, soon, ok, none; then the shortest cover first; then by name
  //   totals: { items, order (flagged), out, low, soon, ok, none, value (of what has a cost), uncosted (flagged items with something to order but no cost) }
  const REORDER_DEFAULTS = { lead: 3, cover: 14, look: 30 };
  const REORDER_RANGE = { lead: [0, 90], cover: [1, 180], look: [7, 365] };
  // The depot's policy (kept in depotInfo, set on the Reorder screen by the Admin): reorderLeadDays, reorderCoverDays, reorderLookDays, whole days. Missing or out of range = the default.
  function reorderPolicy(depotInfo) {
    const di = depotInfo || {};
    const pick = (v, k) => {
      const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
      return isFinite(n) && Math.floor(n) === n && n >= REORDER_RANGE[k][0] && n <= REORDER_RANGE[k][1] ? n : REORDER_DEFAULTS[k];
    };
    return { lead: pick(di.reorderLeadDays, 'lead'), cover: pick(di.reorderCoverDays, 'cover'), look: pick(di.reorderLookDays, 'look') };
  }
  function reorderBook(src, o) {
    o = o || {};
    src = src || {};
    if (typeof o.onHand !== 'function') throw err('INVALID', 'reorderBook needs onHand(key): the stock figure comes from stockBook, never from a second formula');
    const idOf = o.idOfName || (n => 'name:' + String(n || '').trim().toUpperCase());
    const ok = o.isApproved || (r => !r.approvalStatus || r.approvalStatus === 'approved');
    const keyOf = o.keyOf || (r => r.itemId || idOf(r.itemName));
    const pol = reorderPolicy({ reorderLeadDays: o.lead, reorderCoverDays: o.cover, reorderLookDays: o.look });
    const tn = dayNo(o.today || localDay(Date.now()));
    if (tn == null) throw err('INVALID', 'today must be YYYY-MM-DD');
    const lo = tn - pol.look, hi = tn - 1;                              // the complete days that are averaged

    const first = new Map(), dem = new Map();                           // key -> first day number with a record;  key -> net base units taken inside the window
    const seen = (k, d) => { const n = dayNo(d); if (!k || n == null) return; const f = first.get(k); if (f === undefined || n < f) first.set(k, n); };
    const take = (k, d, q) => { const n = dayNo(d); if (!k || n == null || n < lo || n > hi) return; dem.set(k, (dem.get(k) || 0) + q); };
    (src.received || []).forEach(r => { if (r && !r._sale && ok(r) && r.condition !== 'rejected' && Number(r.received) > 0) seen(keyOf(r), r.date); });
    (src.sales || []).forEach(s => {
      if (!s) return;
      arr(s.lines).forEach(l => { if (!l || l.kind === 'commodity' || !l.itemId) return; seen(l.itemId, s.date); take(l.itemId, s.date, baseQty(l)); });
    });
    (src.issued || []).forEach(r => {
      if (!r || r._sale || !ok(r) || !(Number(r.sellingPrice) > 0) || !(Number(r.issued) > 0)) return;      // only an issue with a selling price is a sale
      const k = keyOf(r); seen(k, r.date); take(k, r.date, Number(r.issued));
    });
    (src.returns || []).forEach(r => {
      if (!r) return;
      arr(r.lines).forEach(l => { if (!l || l.kind === 'commodity' || !l.itemId) return; take(l.itemId, r.date, -baseQty(l)); });
    });

    const E = 1e-9, rows = [], sumC = { v: 0 };
    arr(src.items).forEach(it => {
      if (!it || !it.id) return;
      const key = String(it.id), min = Math.max(0, Number(it.minStock) || 0), rsv = Math.max(0, Number(it.reserved) || 0);
      const onHand = Number(o.onHand(key)) || 0, exp = typeof o.unsellable === 'function' ? Math.max(0, Number(o.unsellable(key)) || 0) : 0;
      const avail = r3(onHand - rsv - exp);
      const f = first.get(key), hist = f === undefined ? 0 : Math.max(0, tn - f);                 // complete days since the first record (a record from today gives 0)
      const days = Math.min(hist, pol.look), used = Math.max(0, dem.get(key) || 0);
      const rate = days > 0 ? used / days : 0;
      const rop = min + rate * pol.lead, up = min + rate * (pol.lead + pol.cover);
      let status;
      if (!(rate > 0) && !(min > 0)) status = 'none';
      else if (avail <= 0) status = 'out';
      else if (min > 0 && avail <= min) status = 'low';
      else if (rate > 0 && avail <= rop + E) status = 'soon';
      else status = 'ok';
      const flag = status === 'out' || status === 'low' || status === 'soon';
      const qty = flag ? Math.max(0, Math.ceil(r3(up - avail))) : 0;
      const cost = Number(it.cost) > 0 ? Number(it.cost) : 0, valueC = cost && qty > 0 ? Math.round(qty * cost * 100) : 0;
      if (flag && valueC) sumC.v += valueC;
      rows.push({
        key, name: String(it.name || ''), category: String(it.category || ''), unit: String(it.unit || ''),
        onHand: r3(onHand), reserved: r3(rsv), expired: r3(exp), available: avail, min: r3(min),
        demand: r3(used), days, rate: r3(rate), thin: days > 0 && days < 7, cover: rate > 0 ? r2(Math.max(0, avail) / rate) : null,
        reorderPoint: r3(rop), orderUpTo: r3(up), status, flag, qty, cost, value: valueC / 100
      });
    });
    const RANK = { out: 0, low: 1, soon: 2, ok: 3, none: 4 };
    rows.sort((a, b) => (RANK[a.status] - RANK[b.status]) || ((a.cover == null) - (b.cover == null)) || ((a.cover || 0) - (b.cover || 0)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const totals = { items: rows.length, order: 0, out: 0, low: 0, soon: 0, ok: 0, none: 0, value: sumC.v / 100, uncosted: 0 };
    rows.forEach(r => { totals[r.status]++; if (r.flag) { totals.order++; if (r.qty > 0 && !r.cost) totals.uncosted++; } });
    return { rows, totals, policy: pol };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // COLD DAYS (roadmap step 33) — a long ledger kept small in memory
  // ══════════════════════════════════════════════════════════════════════════════
  // Nothing is deleted, here or in the cloud (the rules only ever allow a sale to be CREATED). The records stay in IndexedDB. What changes is what a phone
  // holds IN MEMORY: the last `hotDays` days (default 120) as the real records, older days as DIGESTS. A digest is one pseudo sale for one cold
  // day, one till, one shift and one cashier: its lines are that group's per-item totals, its payments the per-method totals, and `n` says how many sales it stands for.
  // Every engine above reads it like any sale (stock, batches, expiry, margin, reorder, Sales History, the Z item list), and the money and counts
  // come out the same: sums are worked in whole ngwee, quantities to 3 places, exactly as the sales themselves are.
  // A sale is NEVER folded when something needs it as a receipt (keepFull): a customer's sale, anything on credit or part-paid, a discount a person
  // allowed (the audit log names who), a wholesale basket, or a sale that a void / refund points at. Those stay real records for ever.
  // A digest is derived, never edited: loading again from the same records gives the same digests. `load()` below keeps them in a cache so a phone does not
  // read the whole ledger on every start; the cache is checked against the records (count per day, once per start) and is rebuilt when they disagree.
  // What a cold day no longer shows: the receipt list of its anonymous paid sales (reprint one from Sales History by receipt number: it is read from the phone
  // on demand), the time of each sale, per-sale payment references, and stock "as at" a minute inside the day (the day's digest sits at its last sale's time).
  const HOT_DAYS = { def: 120, min: 30, max: 730 };
  function ledgerPolicy(depotInfo) {
    const n = Math.floor(Number((depotInfo || {}).ledgerHotDays));
    return { hotDays: !isNum(n) ? HOT_DAYS.def : Math.max(HOT_DAYS.min, Math.min(HOT_DAYS.max, n)) };
  }
  function dayAdd(date, n) {
    const t = Date.parse(String(date) + 'T00:00:00Z');
    return isNaN(t) ? String(date) : new Date(t + n * 86400000).toISOString().slice(0, 10);
  }
  const coldCut = (today, hotDays) => dayAdd(today, -ledgerPolicy({ ledgerHotDays: hotDays }).hotDays);
  // true when a sale must stay a real record even on a cold day. refs = Set of sale ids a void / refund points at.
  function keepFull(s, refs) {
    if (!s || !Array.isArray(s.lines) || !s.id || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || ''))) return true;   // anything odd is left exactly as it is
    if (refs && refs.has(s.id)) return true;
    if (s.customerId || s.customerName) return true;
    if (s.creditStatus !== 'paid' || toC(s.balance) > 0) return true;
    const all = toC(s.discount), pr = Math.min(all, toC(s.promoDiscount));
    if (all - pr > 0) return true;                       // a person gave a discount: the audit log names who
    if (s.priceLevel === WHOLESALE) return true;         // a basket chosen as wholesale: the audit log names who
    return false;
  }
  const accKey = s => [s.date, s.till || '', s.shiftId || '', s.cashier || ''].join('|');
  function accNew(s) {
    return { date: String(s.date), till: String(s.till || ''), tillId: String(s.tillId || ''), shiftId: String(s.shiftId || ''), cashier: String(s.cashier || ''), cashierRole: String(s.cashierRole || ''),
      n: 0, at: 0, time: '', qtyTotal: 0, totalC: 0, paidC: 0, changeC: 0, discC: 0, promoC: 0, promoN: 0, items: {}, pays: {} };
  }
  function accAdd(a, s) {
    a.n++;
    if ((Number(s.at) || 0) >= a.at) { a.at = Number(s.at) || 0; a.time = String(s.time || ''); }
    a.qtyTotal = r3(a.qtyTotal + (Number(s.qtyTotal) || 0));
    a.totalC += toC(s.total); a.paidC += toC(s.amountPaid); a.changeC += toC(s.change);
    a.discC += toC(s.discount); a.promoC += Math.min(toC(s.discount), toC(s.promoDiscount));
    if (toC(s.promoDiscount) > 0) a.promoN++;
    arr(s.lines).forEach(l => {
      const f = fOf(l), k = String(l.itemId) + (f !== 1 ? '|' + f + '|' + String(l.unit || '') : '');   // a carton and a single are different rows: their quantities cannot be added
      const x = a.items[k] || (a.items[k] = { itemId: String(l.itemId), kind: l.kind === 'commodity' ? 'commodity' : 'item', name: String(l.name || ''), unit: String(l.unit || ''), qty: 0, totalC: 0, discC: 0, factor: f !== 1 ? f : 0, base: f !== 1 ? String(l.base || '') : '' });
      x.qty = r3(x.qty + (Number(l.qty) || 0)); x.totalC += toC(l.total); x.discC += toC(l.discount);
    });
    arr(s.payments).forEach(p => {
      const m = String(p.method), x = a.pays[m] || (a.pays[m] = { method: m, label: String(p.label || ''), c: 0 });
      x.c += toC(p.amount);
    });
  }
  function accDigest(a) {
    const lines = Object.keys(a.items).sort().map(k => {
      const x = a.items[k];
      const l = { itemId: x.itemId, kind: x.kind, name: x.name, unit: x.unit, qty: x.qty, price: x.qty > 0 ? (x.totalC + x.discC) / 100 / x.qty : 0, total: x.totalC / 100 };
      if (x.discC > 0) l.discount = x.discC / 100;       // netPrice() then charges total / qty, as for any discounted line
      if (x.factor) { l.factor = x.factor; l.base = x.base; }
      return l;
    });
    const d = {
      v: V, _digest: true, n: a.n, id: 'DAY:' + a.date + ':' + a.till + ':' + (a.shiftId || '-') + ':' + a.cashier, receiptNo: 'DAY ' + a.date,
      tillId: a.tillId, till: a.till, seq: 0, at: a.at, date: a.date, time: a.time, cashier: a.cashier, cashierRole: a.cashierRole,
      lines, lineCount: lines.length, qtyTotal: a.qtyTotal, total: a.totalC / 100,
      payments: Object.keys(a.pays).sort().map(m => ({ method: a.pays[m].method, label: a.pays[m].label, amount: a.pays[m].c / 100 })),
      amountPaid: a.paidC / 100, change: a.changeC / 100, balance: 0, creditStatus: 'paid', customerId: '', customerName: ''
    };
    if (a.shiftId) d.shiftId = a.shiftId;
    if (a.discC > 0) d.discount = a.discC / 100;
    if (a.promoC > 0) { d.promoDiscount = a.promoC / 100; d.promoN = a.promoN; }   // promoN: how many of the n sales had an offer (shifts.js counts them)
    return d;
  }
  // The sales a digest or a list stands for.
  const saleCount = list => (list || []).reduce((a, s) => a + (s && Number(s.n) > 0 ? Math.floor(Number(s.n)) : 1), 0);
  const byAt = (a, b) => ((Number(a.at) || 0) - (Number(b.at) || 0)) || String(a.id).localeCompare(String(b.id));
  // Pure: the whole fold from scratch. sales = every real record; o = { cutDate, returns }.  Days BEFORE cutDate are cold.
  // -> { list (sorted), folded (sales turned into digests), groups, kept (cold sales left real) }
  function foldCold(sales, o) {
    o = o || {};
    const cut = String(o.cutDate || ''), refs = new Set(arr(o.returns).map(r => r && r.saleId).filter(Boolean));
    const out = [], groups = new Map();
    let folded = 0, kept = 0;
    arr(sales).forEach(s => {
      if (!s || !(String(s.date || '') < cut)) { out.push(s); return; }
      if (keepFull(s, refs)) { out.push(s); kept++; return; }
      const k = accKey(s); let a = groups.get(k); if (!a) { a = accNew(s); groups.set(k, a); }
      accAdd(a, s); folded++;
    });
    groups.forEach(a => out.push(accDigest(a)));
    return { list: out.sort(byAt), folded, groups: groups.size, kept };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STORAGE ADAPTERS — every method is async; d = depot key
  //   add(d, rec)                       save a sale AND queue it for upload, in one transaction; EXISTS if the id is taken
  //   get(d, id) / all(d)               read
  //   addMany(d, recs, queue)           add those not stored yet, return how many; queue=true also queues them for upload
  //   outbox(d)                         [{id, tries, err}] still to upload      unqueue(d, id)      bump(d, id, err)
  //   getMeta(k) / setMeta(k, v)
  //   range(d, from, to)                records with from <= date < to (from '' = no lower limit, to null = no upper limit)      (step 33)
  //   each(d, from, to, fn)             the same range, one record at a time, nothing kept in memory      countBefore(d, date)   how many records are dated before `date`
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
      async getMeta(k) { return meta.has(k) ? JSON.parse(JSON.stringify(meta.get(k))) : null; },
      async setMeta(k, v) { meta.set(k, JSON.parse(JSON.stringify(v))); },
      async range(d, from, to) {
        const o = [];
        sales.forEach((r, k) => { if (k.startsWith(d + '|') && (!from || r.date >= from) && (to == null || r.date < to)) o.push(JSON.parse(JSON.stringify(r))); });
        return o;
      },
      async each(d, from, to, fn) { (await this.range(d, from, to)).forEach(fn); },
      async countBefore(d, date) { let n = 0; sales.forEach((r, k) => { if (k.startsWith(d + '|') && r.date < date) n++; }); return n; },
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
        try { q = idb.open('mdm_sales', 2); } catch (e) { dbp = null; return rej(err('STORAGE', 'Could not open the sales store')); }
        q.onupgradeneeded = () => {
          const db = q.result;
          if (!db.objectStoreNames.contains('sales')) db.createObjectStore('sales', { keyPath: 'k' }).createIndex('depot', 'depot');
          if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'k' }).createIndex('depot', 'depot');
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
          // version 2 (step 33): sales by day, so a day or a range of days is read without reading the rest. Existing records are indexed as the index is made.
          const st = q.transaction.objectStore('sales');
          if (!st.indexNames.contains('depotDate')) st.createIndex('depotDate', ['depot', 'rec.date']);
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
      async range(d, from, to) {
        const db = await open(), ix = tx(db, ['sales'], 'readonly').objectStore('sales').index('depotDate');
        const rows = await req(ix.getAll(IDBKeyRange.bound([d, from || ''], [d, to == null ? '\uffff' : to], false, to != null)));
        return rows.map(x => x.rec);
      },
      async each(d, from, to, fn) {
        const db = await open(), ix = tx(db, ['sales'], 'readonly').objectStore('sales').index('depotDate');
        await new Promise((res, rej) => {
          const q = ix.openCursor(IDBKeyRange.bound([d, from || ''], [d, to == null ? '\uffff' : to], false, to != null));
          q.onsuccess = () => { const c = q.result; if (!c) return res(); try { fn(c.value.rec); } catch (e) { return rej(e); } c.continue(); };
          q.onerror = () => rej(q.error || err('STORAGE', 'Could not read'));
        });
      },
      async countBefore(d, date) {
        const db = await open(), ix = tx(db, ['sales'], 'readonly').objectStore('sales').index('depotDate');
        return req(ix.count(IDBKeyRange.bound([d, ''], [d, date], false, true)));
      },
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

    // ── COLD DAYS (step 33): what a phone holds in memory. See the long note above foldCold().
    // The cache lives in this device's IndexedDB (meta). One value: { v, upTo (every day BEFORE it is folded), days {date: records}, groups {key: digest},
    // kept {saleId: record} (cold sales that stay real), refs [sale ids a return points at that we have looked at], dirty [days to work again] }.  `groups` holds the finished DIGESTS.
    // A tiny second key says which version of it is current, so two tabs on one phone never read the big value just to find out nothing changed.
    const GEN = d => 'coldGen:' + d, CCK = d => 'cold:' + d, CUP = d => 'coldUpTo:' + d;
    const freshCache = () => ({ v: 2, upTo: '', days: {}, groups: {}, kept: {}, refs: [], dirty: [] });
    const newGen = () => Date.now() + '.' + Math.random().toString(36).slice(2, 8);
    let mem = null, memD = '', memGen = null, verifiedD = '';
    // One thing at a time touches the cache (two screens asking at once must not fold a day twice).
    let chain = Promise.resolve();
    const exclusive = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
    async function readCache(d) {
      const g = await A.getMeta(GEN(d));
      if (mem && memD === d && g === memGen) return mem;
      const c = g == null ? null : await A.getMeta(CCK(d));
      mem = c && c.v === 2 ? c : freshCache(); memD = d; memGen = c && c.v === 2 ? g : null; verifiedD = '';
      return mem;
    }
    async function saveCache(d, c) {
      const g = newGen();
      await A.setMeta(CCK(d), c); await A.setMeta(CUP(d), c.upTo); await A.setMeta(GEN(d), g);
      mem = c; memD = d; memGen = g;
    }
    // A pass of folding gathers into accumulators (`accs`), then writes the finished digests. A day is only ever finished once per pass, and a day that is worked again is
    // first removed whole (rebuildDay), so a digest is never added to after it is written.
    function foldInto(c, accs, rec, refs) {
      c.days[rec.date] = (c.days[rec.date] || 0) + 1;
      if (keepFull(rec, refs)) { c.kept[rec.id] = rec; return; }
      const k = accKey(rec), a = accs.get(k) || (accs.set(k, accNew(rec)), accs.get(k));
      accAdd(a, rec);
    }
    const finish = (c, accs) => { accs.forEach((a, k) => { c.groups[k] = accDigest(a); }); };
    async function rebuildDay(d, c, date, refs) {
      Object.keys(c.groups).forEach(k => { if (c.groups[k].date === date) delete c.groups[k]; });
      Object.keys(c.kept).forEach(id => { if (c.kept[id].date === date) delete c.kept[id]; });
      delete c.days[date];
      const accs = new Map();
      await A.each(d, date, dayAdd(date, 1), r => foldInto(c, accs, r, refs));
      finish(c, accs);
    }
    const sumDays = c => Object.keys(c.days).reduce((a, k) => a + c.days[k], 0);
    // A record that arrives dated BEFORE the cache's boundary (a late upload, a restore) marks its day to be worked again. A sale of today never costs more than this check of the date.
    async function touch(d, dates) {
      const floor = dayAdd(localDay(Date.now()), -HOT_DAYS.min);
      const old = Array.from(new Set(dates.filter(x => x && x < floor)));
      if (!old.length) return;                                       // today's sales end here, without waiting for anything
      return exclusive(async () => {
        try {
          const up = await A.getMeta(CUP(d));
          const late = up ? old.filter(x => x < up) : [];
          if (!late.length) return;
          const c = await readCache(d);
          late.forEach(x => { if (c.dirty.indexOf(x) < 0) c.dirty.push(x); });
          await saveCache(d, c);
        } catch (e) { console.warn('[sales] could not mark late records', e); }
      });
    }
    // The ledger as this phone should hold it in memory: the last hotDays days as real records, older days as digests (and the cold sales that must stay real).
    //   o = { today:'YYYY-MM-DD' (the app's date), hotDays (Sales.ledgerPolicy(depotInfo).hotDays), returns:[return records] }
    //   -> { list (sorted like all()), count (sales the list stands for), cut, hotDays, folded, groups, kept }
    const load = async o => { const d = need(); return exclusive(() => loadNow(d, o)); };
    async function loadNow(d, o) {
      o = o || {};
      const hotDays = ledgerPolicy({ ledgerHotDays: o.hotDays }).hotDays;
      const today = o.today || localDay(Date.now()), cut = dayAdd(today, -hotDays);
      let c = await readCache(d), changed = false;
      if (c.upTo > cut) { c = freshCache(); changed = true; }                                             // the window was made longer: those days must come back
      if (c.upTo && verifiedD !== d) {                                                                   // once per start: the cache must agree with the records
        if ((await A.countBefore(d, c.upTo)) !== sumDays(c)) { c = freshCache(); changed = true; }
        verifiedD = d;
      }
      const seen = new Set(c.refs), dirty = new Set(c.dirty);
      const want = new Set(arr(o.returns).map(r => r && r.saleId).filter(Boolean));
      for (const id of want) {                                                                           // a void / refund points at a sale: that sale must be a real record
        if (seen.has(id)) continue;
        const rec = await A.get(d, id);
        if (!rec) continue;                                                                              // not on this phone yet: look again next time
        c.refs.push(id); seen.add(id); changed = true;
        if (c.upTo && rec.date < c.upTo && !c.kept[id]) dirty.add(rec.date);
      }
      if (dirty.size) {
        c.dirty = [];
        for (const day of Array.from(dirty).sort()) if (day < c.upTo) await rebuildDay(d, c, day, seen);
        changed = true;
      }
      if (cut > c.upTo) { const accs = new Map(); await A.each(d, c.upTo || '', cut, r => foldInto(c, accs, r, seen)); finish(c, accs); c.upTo = cut; changed = true; }
      if (changed) { await saveCache(d, c); verifiedD = d; }
      const hot = await A.range(d, cut, null);
      const dg = Object.keys(c.groups).map(k => c.groups[k]), kept = Object.keys(c.kept).map(id => c.kept[id]);
      const list = hot.concat(kept, dg).sort(byAt);
      return { list, count: saleCount(list), cut, hotDays, folded: sumDays(c) - kept.length, groups: dg.length, kept: kept.length };
    }
    // One sale as it was recorded, whatever its day: the receipt of an old, folded day is read from here.
    async function get(id) { return A.get(need(), String(id)); }

    // Save one sale. It is stored and queued for upload in one transaction; only after this resolves may the receipt be shown.
    async function append(basket) {
      const d = need(), rec = toRecord(basket, env.opts);
      const bad = validate(rec);
      if (bad) throw err('INVALID', 'The sale is not valid: ' + bad);
      await A.add(d, rec);
      touch(d, [rec.date]);                          // a sale dated long ago (a wrong clock): its day is worked again. Not awaited: never slows a sale.
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
        await touch(d, good.map(r => r.date));
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
      const added = await A.addMany(d, good, true);
      await touch(d, good.map(r => r.date));
      return { added, skipped: arr(list).length - good.length };
    }

    return { append, all, load, get, pending, push, pull, importMany };
  }

  return { V, ID_RE, BATCH_NAME, DISC_MAX_PCT, PROMO_BY, toRecord, validate, forCloud, fromCloud, issuedRows, soldById, stockBook, batchBook, expiryBook, marginBook, reorderBook, reorderPolicy, REORDER_DEFAULTS, REORDER_RANGE, EXPIRY_WARN, daysUntil, fOf, baseQty, unitList, FACTOR_MAX, linePaid, methodsOf, netPrice, discountPolicy, discountSplit, discountJudge, pctText, promoCheck, promoList, promoDay, promoActive, promoMatches, promoText, promoLine, promoApply, discountParts, WHOLESALE, levelPolicy, levelApply, ledgerPolicy, HOT_DAYS, keepFull, foldCold, saleCount, coldCut, dayAdd, create, memAdapter, idbAdapter };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sales; // lets Node load it for tests
