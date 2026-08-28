const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const Database = require(path.join(__dirname, 'diecut-schedule', 'node_modules', 'better-sqlite3'));

const serverPath = path.join(__dirname, 'diecut-schedule', 'server.js');
if (!fs.existsSync(serverPath)) throw new Error(`server.js not found: ${serverPath}`);
const source = fs.readFileSync(serverPath, 'utf8');

const requiredPatterns = [
  "snap.shipping_required_date,snap.delivery_date",
  "'出货需求日期'",
  "'要求出货日期'",
  "'预计计划量'",
  "snap.work_order_number IS NULL",
  "snap.stage=?",
  "shipping_quantity: shippingQuantity",
  "Number(item.shipping_quantity)||0",
  "shipping_quantity=?,shipping_required_date=?,delivery_date=?",
  "json_extract(snap.raw_json,'$.shipping_quantity')",
  "json_extract(snap.raw_json,'$.delivery_qty')",
  "CASE WHEN COALESCE(snap.quantity,0)>0 THEN snap.quantity ELSE COALESCE(o.quantity,0) END quantity",
  "// V5.1.4-WORKFLOW-FIELDS-VERIFIED",
  "// V5.1.3-SHIPPING-QTY-BACKFILL",
  "backfillOrderShippingQuantities();"
];
for (const pattern of requiredPatterns) {
  if (!source.includes(pattern)) throw new Error(`Missing workflow mapping/repair: ${pattern}`);
}

const boardSqlGuard = /snap\.work_order_number\s+IS\s+NULL\s+\n?\s*OR\s+snap\.id\s*=/;
if (!boardSqlGuard.test(source)) throw new Error('Workflow board query is missing the NULL work-order guard');

const boardFieldFallbacks = [
  "json_extract(snap.raw_json,'$.shipping_quantity')",
  "json_extract(snap.raw_json,'$.delivery_qty')",
  "COALESCE(NULLIF(TRIM(snap.shipping_required_date),''),o.shipping_required_date)",
  "COALESCE(NULLIF(TRIM(snap.delivery_date),''),o.delivery_date)"
];
for (const pattern of boardFieldFallbacks) {
  if (!source.includes(pattern)) throw new Error(`Board field fallback missing: ${pattern}`);
}

// 直接执行生产代码中的 backfillOrderShippingQuantities()，验证旧 data.db 也能被自动修复。
const fnStart = source.indexOf('// V5.1.3-SHIPPING-QTY-BACKFILL');
const fnEnd = source.indexOf('backfillOrderShippingQuantities();', fnStart);
if (fnStart < 0 || fnEnd < 0) throw new Error('Shipping backfill function not found');
const fnSource = source.slice(source.indexOf('function backfillOrderShippingQuantities()', fnStart), fnEnd);
const dbPath = path.join(os.tmpdir(), `diecut-shipping-backfill-${process.pid}.db`);
const db = new Database(dbPath);
try {
  db.exec(`
    CREATE TABLE workflow_import_batches (id INTEGER PRIMARY KEY, snapshot_date TEXT, imported_at TEXT);
    CREATE TABLE workflow_snapshots (
      id INTEGER PRIMARY KEY, batch_id INTEGER, work_order_number TEXT,
      raw_json TEXT, shipping_required_date TEXT, delivery_date TEXT, quantity REAL DEFAULT 0, stage TEXT
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY, order_number TEXT, quantity INTEGER DEFAULT 0, shipping_quantity INTEGER DEFAULT 0,
      shipping_required_date TEXT, delivery_date TEXT
    );
  `);
  db.prepare('INSERT INTO workflow_import_batches VALUES (1,\'2026-08-28\',\'2026-08-28T03:00:00Z\')').run();
  db.prepare('INSERT INTO orders VALUES (1,\'5110-20260811002\',0,0,\'2026-08-20\',NULL)').run();
  db.prepare('INSERT INTO workflow_snapshots VALUES (1,1,?,?,?,?,?,?)')
    .run('5110-20260811002', JSON.stringify({shipping_quantity: 100000, delivery_qty: 100000}), '2026-08-20', null, 100000, 'waiting_schedule');

  const backfill = vm.runInNewContext(`(function(){${fnSource}\n return backfillOrderShippingQuantities; })()`, { db });
  const changed = backfill();
  if (changed !== 1) throw new Error(`Expected 1 backfilled order, got ${changed}`);
  const row = db.prepare('SELECT shipping_quantity, shipping_required_date, delivery_date FROM orders WHERE id=1').get();
  if (row.shipping_quantity !== 100000 || row.shipping_required_date !== '2026-08-20') {
    throw new Error(`Shipping quantity backfill failed: ${JSON.stringify(row)}`);
  }

  // Board projection regression: quantity/shipping/date must remain populated from snapshot/order fallbacks.
  const boardRow = db.prepare(`
    SELECT
      CASE WHEN COALESCE(snap.quantity,0)>0 THEN snap.quantity ELSE COALESCE(o.quantity,0) END quantity,
      CASE WHEN COALESCE(o.shipping_quantity,0)>0 THEN o.shipping_quantity
           ELSE COALESCE(CAST(json_extract(snap.raw_json,'$.shipping_quantity') AS REAL),CAST(json_extract(snap.raw_json,'$.delivery_qty') AS REAL),0) END shipping_quantity,
      COALESCE(NULLIF(TRIM(snap.shipping_required_date),''),o.shipping_required_date) shipping_required_date,
      COALESCE(NULLIF(TRIM(snap.delivery_date),''),o.delivery_date) delivery_date
    FROM workflow_snapshots snap
    LEFT JOIN orders o ON o.order_number=snap.work_order_number
    WHERE snap.batch_id=1 AND snap.stage='waiting_schedule'
  `).get();
  if (Number(boardRow.quantity) !== 100000 || Number(boardRow.shipping_quantity) !== 100000 || boardRow.shipping_required_date !== '2026-08-20') {
    throw new Error(`Board field projection failed: ${JSON.stringify(boardRow)}`);
  }
} finally {
  db.close();
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(`${dbPath}-wal`); } catch {}
  try { fs.unlinkSync(`${dbPath}-shm`); } catch {}
}

console.log('WORKFLOW_BOARD_FIELDS_AND_SHIPPING_REGRESSION_OK');
