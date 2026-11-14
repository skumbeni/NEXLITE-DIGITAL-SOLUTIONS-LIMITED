const assert = require('assert');
const Shifts = require('./shifts.js');
const DEPOT = 'MDM-TEST-0001-0001';

// ── a fake cloud that behaves like create-only rules + createdAt ordering
function fakeCloud(store, opts) {
  opts = opts || {};
  let clock = 1000;
  return {
    async get(path) { return store.has(path) ? JSON.parse(JSON.stringify(store.get(path))) : null; },
    async putIfAbsent(path, obj) {
      if (opts.refuse && opts.refuse(path)) { const e = new Error('permission denied'); e.code = 'PERMISSION'; throw e; }
      if (store.has(path)) { const e = new Error('exists'); e.code = 'EXISTS'; throw e; }
      const o = JSON.parse(JSON.stringify(obj)); o.createdAt = ++clock; store.set(path, o);
    },
    async query(path) {
      const o = {}; store.forEach((v, k) => { if (k.startsWith(path + '/')) o[k.slice(path.length + 1)] = JSON.parse(JSON.stringify(v)); });
      return Object.keys(o).length ? o : null;
    }
  };
}
const till = (code, id) => ({ code, tillId: id, registered: true });
const T1 = till('K7F2', 'a'.repeat(24)), T2 = till('M3P9', 'b'.repeat(24));
const mk = () => Shifts.create({ depotKey: () => DEPOT, adapter: Shifts.memAdapter(), opts: { dateOf: t => new Date(t).toISOString().slice(0, 10), timeOf: () => '10:15' } });

(async () => {
  // 1. log() writes a valid record and queues it
  const L1 = mk();
  const r = await L1.log(T1, { username: 'ana', role: 'cashier' }, 'pin_fail', { what: 'allow a refund', shiftId: 'K7F2-S0001', note: '2 wrong PINs in a row' }, 1760000000000);
  assert.strictEqual(Shifts.validateAudit(r), '');
  assert(Shifts.AID_RE.test(r.id), r.id);
  assert.strictEqual(r.id.slice(0, 4), 'K7F2');
  assert.strictEqual(await L1.pending(), 1);
  console.log('1 ok  id =', r.id);

  // 2. bad input is refused, never stored
  await assert.rejects(L1.log(T1, { username: 'ana', role: 'cashier' }, 'bogus'), e => e.code === 'INVALID');
  await assert.rejects(L1.log({ code: 'K7F2', tillId: T1.tillId, registered: false }, { username: 'ana' }, 'x_report'), e => e.code === 'NOT_REGISTERED');
  await assert.rejects(L1.log(T1, { username: '' }, 'x_report'), e => e.code === 'NO_USER');
  assert.strictEqual(await L1.pending(), 1);
  console.log('2 ok  refusals');

  // 3. a PIN is never stored: nothing but what we passed ends up in the record
  const keys = Object.keys(r).sort().join(',');
  assert.strictEqual(keys, 'at,date,event,id,note,role,shiftId,till,tillId,time,type,user,v,what');
  console.log('3 ok  fields =', keys);

  // 4. same millisecond twice on one till: both saved (random tail), ids differ
  const a = await L1.log(T1, { username: 'ana', role: 'cashier' }, 'x_report', {}, 1760000000001);
  const b = await L1.log(T1, { username: 'ana', role: 'cashier' }, 'x_report', {}, 1760000000001);
  assert.notStrictEqual(a.id, b.id);
  // forced collision: rand always 'abc' -> EXISTS retried then gives up cleanly
  const Lc = Shifts.create({ depotKey: () => DEPOT, adapter: Shifts.memAdapter(), opts: { rand: () => 'abc' } });
  await Lc.log(T1, { username: 'ana', role: 'cashier' }, 'x_report', {}, 1760000000002);
  await assert.rejects(Lc.log(T1, { username: 'ana', role: 'cashier' }, 'x_report', {}, 1760000000002), e => e.code === 'EXISTS');
  console.log('4 ok  collisions');

  // 5. audit records do not disturb the shift logic
  const sh = await L1.open(T1, { username: 'ana', role: 'cashier' }, 200, 1760000100000);
  const cur = await L1.current(T1.tillId);
  assert(cur && cur.open.shiftId === sh.shiftId && !cur.close);
  assert.strictEqual(Shifts.shiftsOf(await L1.all()).length, 1);
  console.log('5 ok  shifts unaffected by audit records');

  // 6. push / pull between two tills, with cloud rules refusing tillAudit (not published yet)
  const store = new Map();
  const cloudNoRules = fakeCloud(store, { refuse: p => p.includes('/tillAudit/') });
  let up = await L1.push(cloudNoRules);
  assert.strictEqual(up.sent, 1);                   // the shift went up
  assert(up.left >= 3 && up.error, JSON.stringify(up));   // audit records wait in the outbox, nothing lost
  assert(store.has('depots/' + DEPOT + '/shifts/' + sh.shiftId));
  console.log('6 ok  rules not published: shift uploaded, audit waits (' + up.left + ' left, error ' + up.error + ')');
  const cloud = fakeCloud(store);
  up = await L1.push(cloud);
  assert.strictEqual(up.left, 0, JSON.stringify(up));
  const L2 = mk();
  const pl = await L2.pull(cloud);
  assert.strictEqual(pl.bad, 0);
  const all2 = await L2.all();
  assert.strictEqual(all2.filter(e => e.type === 'audit').length, 3);
  assert.strictEqual(all2.filter(e => e.type === 'open').length, 1);
  const pl2 = await L2.pull(cloud);                  // second pull adds nothing
  assert.strictEqual(pl2.added, 0);
  console.log('7 ok  other till downloaded', all2.length, 'records, second pull added 0');

  // 8. a record the cloud mangled is dropped, not shown
  store.set('depots/' + DEPOT + '/tillAudit/K7F2-Azzzzzzzzz1', { v: 1, till: 'K7F2', tillId: T1.tillId, at: 5, date: '2025-01-01', time: '10:00', user: 'x', event: 'hacked', createdAt: 99999 });
  const L3 = mk(); const p3 = await L3.pull(cloud);
  assert.strictEqual(p3.bad, 1);
  console.log('8 ok  invalid record rejected on download');

  // 9. auditEntries: every source, one line each
  const ev = (await L2.all()).concat([]);
  const close = Shifts.closeRecord({ shiftId: sh.shiftId, till: 'K7F2', tillId: T1.tillId, at: 1760003600000, closedBy: 'boss', closedByRole: 'admin', forced: true,
    float: 200, cashSales: 100, cashOut: 0, expectedCash: 300, countedCash: 250, variance: -50, saleCount: 1, total: 100, credit: 0,
    byMethod: { cash: 100, mtn: 0, airtel: 0, card: 0 }, firstReceipt: 'K7F2-000001', lastReceipt: 'K7F2-000001', note: 'drawer short' },
    { dateOf: t => new Date(t).toISOString().slice(0, 10), timeOf: () => '11:15' });
  assert.strictEqual(Shifts.validateClose(close), '');
  ev.push(close);
  const sales = [
    { id: 'K7F2-000001', receiptNo: 'K7F2-000001', at: 1760000200000, date: '2025-10-09', time: '10:20', cashier: 'ana', cashierRole: 'cashier', total: 95, discount: 5, discountBy: 'boss', discountReason: 'loyal customer' },
    { id: 'K7F2-000002', receiptNo: 'K7F2-000002', at: 1760000300000, date: '2025-10-09', time: '10:25', cashier: 'ana', cashierRole: 'cashier', total: 40 }       // no discount: no line
  ];
  const rets = [{ id: 'K7F2-R000003', kind: 'refund', saleId: 'K7F2-000001', at: 1760000400000, date: '2025-10-09', time: '10:30', cashier: 'ana', cashierRole: 'cashier',
    approvedBy: 'boss', reason: 'Damaged or faulty', lineCount: 1, total: 20, creditApplied: 0, refunded: 20 },
    { id: 'K7F2-R000004', kind: 'void', saleId: 'K7F2-000002', at: 1760000500000, date: '2025-10-09', time: '10:31', cashier: 'ana', cashierRole: 'cashier', approvedBy: 'ana', reason: 'Wrong item', lineCount: 1, total: 40, creditApplied: 0, refunded: 40 }];
  const ents = Shifts.auditEntries(ev, sales, rets, { money: n => 'ZMW ' + Number(n).toFixed(2) });
  ents.forEach(e => console.log('  ', e.ts.slice(11, 19), e.action.padEnd(8), e.entity.padEnd(13), String(e.user).padEnd(5), '|', e.detail));
  const acts = ents.map(e => e.action).sort().join(',');
  assert.strictEqual(acts, 'CLOSE,DENY,DISCOUNT,OPEN,REFUND,REPORT,REPORT,VOID');
  assert.strictEqual(new Set(ents.map(e => e.id)).size, ents.length);        // ids unique and stable
  assert.deepStrictEqual(Shifts.auditEntries(ev, sales, rets).map(e => e.id), Shifts.auditEntries(ev.slice().reverse(), sales, rets).map(e => e.id)); // order-independent
  // the entries have exactly the logAuditEvent shape
  ents.forEach(e => { ['id', 'ts', 'date', 'time', 'user', 'role', 'action', 'entity', 'detail'].forEach(k => assert(typeof e[k] === 'string', k + ' on ' + e.id)); assert(/^\d{4}-\d\d-\d\dT/.test(e.ts)); });
  // garbage in does not throw
  assert.deepStrictEqual(Shifts.auditEntries(null, null, null), []);
  assert.doesNotThrow(() => Shifts.auditEntries([null, { type: 'open' }, { type: 'audit', event: 'x_report' }], [null, { discount: 5 }], [null, {}]));
  console.log('9 ok  auditEntries');
  console.log('ALL PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
