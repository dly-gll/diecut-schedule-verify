const fs = require('fs');
const path = require('path');
const vm = require('vm');

const serverPath = path.join(__dirname, 'diecut-schedule', 'server.js');
if (!fs.existsSync(serverPath)) throw new Error(`server.js not found: ${serverPath}`);
const source = fs.readFileSync(serverPath, 'utf8');

const requiredPatterns = [
  "'预计产量'",
  "'出货数量'",
  "'要求出货时间'",
  "'出货需求日期'",
  "snap.work_order_number IS NULL",
  "snap.stage=?",
  "shipping_quantity: shippingQuantity",
  "Number(item.shipping_quantity)||0",
  "shipping_quantity=?,shipping_required_date=?,delivery_date=?",
  "json_extract(snap.raw_json,'$.shipping_quantity')",
  "json_extract(snap.raw_json,'$.delivery_qty')",
  "CASE WHEN COALESCE(snap.quantity,0)>0 THEN snap.quantity ELSE COALESCE(o.quantity,0) END quantity",
  "excelContext.shippingRequiredDateByOrder?.get(orderNumber)",
  "excelContext.deliveryDateByOrder?.get(orderNumber)",
  "excelContext.urgentShippingDateByOrder?.get(orderNumber)",
  "excelContext.urgentDeliveryDateByOrder?.get(orderNumber)",
  "// V5.1.5-WORKFLOW-LEGACY-FIELD-BACKFILL",
  "const legacyQuantity = numberOr(fields[8], NaN)",
  "const legacyShipping = numberOr(fields[14], NaN)",
  "const legacyShipDate = normalizeImportedDate(fields[15])",
  "backfillWorkflowLegacyBoardFields();"
];
for (const pattern of requiredPatterns) {
  if (!source.includes(pattern)) throw new Error(`Missing workflow mapping/repair: ${pattern}`);
}

function normalizeImportHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s\u3000_\-/\\()（）【】\x5B\]：:]+/g, '');
}
function findImportValue(row, aliases) {
  const entries = Object.entries(row || {});
  const map = new Map(entries.map(([k,v]) => [normalizeImportHeader(k), v]));
  for (const alias of aliases) {
    const key = normalizeImportHeader(alias);
    if (map.has(key)) return map.get(key);
  }
  for (const [k,v] of entries) {
    const nk = normalizeImportHeader(k);
    if (aliases.some(a => nk.includes(normalizeImportHeader(a)))) return v;
  }
  return '';
}
function findImportValuePriority(row, preferredAliases = [], fallbackAliases = []) {
  const entries = Object.entries(row || {}).map(([k,v]) => ({key:normalizeImportHeader(k), value:v}));
  const preferred = preferredAliases.map(normalizeImportHeader).filter(Boolean);
  for (const alias of preferred) {
    const exact = entries.find(x => x.key === alias);
    if (exact) return exact.value;
  }
  for (const alias of preferred) {
    const partial = entries.find(x => x.key.includes(alias));
    if (partial) return partial.value;
  }
  return findImportValue(row, fallbackAliases.length ? fallbackAliases : preferredAliases);
}
const sampleRow = {'生产数量':0,'预计产量':300000,'出货数量':100000,'要求出货日期':'2026-08-20'};
if (Number(findImportValuePriority(sampleRow,['预计产量','预计计划量','数量','quantity','qty'],['工单数量','订单数量','需求数量','生产数量','计划数量','pcs','总数量'])) !== 300000) throw new Error('预计产量优先级回归失败');
if (Number(findImportValuePriority(sampleRow,['出货数量','shipping_quantity','shipping quantity'],['已出货数量','交货数量','发货数量','delivery quantity'])) !== 100000) throw new Error('出货数量回归失败');

const legacyFnStart = source.indexOf('function backfillWorkflowLegacyBoardFields()');
const legacyFnEnd = source.indexOf('backfillWorkflowLegacyBoardFields();', legacyFnStart);
if (legacyFnStart < 0 || legacyFnEnd < 0) throw new Error('Legacy workflow backfill function not found');
const fnSource = source.slice(legacyFnStart, legacyFnEnd);

function numberOr(value, fallback) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}
function normalizeImportedDate(value) {
  const s = String(value ?? '').trim();
  const m = s.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return null;
}

let updated;
const fakeRows = [{
  id: 1,
  work_order_number: '5110-20260804013',
  quantity: 0,
  shipping_quantity: 0,
  shipping_required_date: null,
  delivery_date: null,
  sheet_name: '8.22在制工单明细',
  raw_json: JSON.stringify({
    quantity: 0,
    status_text: 'K00002 | ****-YLA2608003-0007 | 5110-20260804013 | 未生产 | 2026-08-23 | 31BJ00194A | GIAY DAN LOA 喇叭双面胶 | 6.23mm*1.8mm | 300000 | 0 | 300000 | 5410-20260804014 | AI1689005WR00005 |  |  | 未发料 | 仓库有料 | 8.21查料',
    shipping_quantity: 0
  })
}];
const fakeDb = {
  prepare(sql) {
    if (/SELECT id FROM workflow_import_batches/.test(sql)) return { get: () => ({id: 24}) };
    if (/SELECT id, work_order_number, quantity/.test(sql)) return { all: () => fakeRows };
    if (/UPDATE workflow_snapshots/.test(sql)) return { run: (...args) => { updated = args; } };
    throw new Error(`Unexpected SQL in legacy backfill test: ${sql}`);
  },
  transaction(fn) { return () => fn(); }
};
const backfill = vm.runInNewContext(`(function(){${fnSource}\nreturn backfillWorkflowLegacyBoardFields;})()`, {db: fakeDb, numberOr, normalizeImportedDate});
const changed = backfill();
if (changed !== 1) throw new Error(`Expected 1 legacy row patched, got ${changed}`);
if (!updated) throw new Error('Legacy backfill did not execute update');
if (Number(updated[0]) !== 300000) throw new Error(`Legacy quantity recovery failed: ${updated[0]}`);
if (Number(updated[1]) !== 0) throw new Error(`Legacy shipping quantity should remain 0: ${updated[1]}`);
if (updated[2] !== null) throw new Error(`Legacy row should keep null shipping date when source row has no date: ${updated[2]}`);
const patchedRaw = JSON.parse(updated[4]);
if (Number(patchedRaw.quantity) !== 300000) throw new Error('Patched raw quantity is not 300000');
if (Number(patchedRaw.shipping_quantity) !== 0) throw new Error('Patched raw shipping quantity should remain 0');

console.log('WORKFLOW_BOARD_IMPORT_PRIORITY_AND_FIELDS_REGRESSION_OK');
