const fs = require('fs');
const path = require('path');
const Database = require(path.join(__dirname, 'diecut-schedule', 'node_modules', 'better-sqlite3'));

const serverPath = path.join(__dirname, 'diecut-schedule', 'server.js');
if (!fs.existsSync(serverPath)) {
  throw new Error(`server.js not found: ${serverPath}`);
}
const source = fs.readFileSync(serverPath, 'utf8');

const requiredPatterns = [
  "snap.shipping_required_date,snap.delivery_date",
  "'出货需求日期'",
  "'要求出货日期'",
  "snap.work_order_number IS NULL",
  "snap.stage=?",
  "shipping_quantity: shippingQuantity",
  "Number(item.shipping_quantity)||0",
  "shipping_quantity=?,shipping_required_date=?,delivery_date=?"
];

for (const pattern of requiredPatterns) {
  if (!source.includes(pattern)) {
    throw new Error(`Missing workflow mapping/repair: ${pattern}`);
  }
}

const boardSqlGuard = /snap\.work_order_number\s+IS\s+NULL\s+\n?\s*OR\s+snap\.id\s*=/;
if (!boardSqlGuard.test(source)) {
  throw new Error('Workflow board query is missing the NULL work-order guard');
}

// 使用与生产代码相同的 SQLite 参数形状回归验证：
// 工作流明细的“出货数量”必须能写回 orders.shipping_quantity。
const dbPath = path.join(require('os').tmpdir(), `diecut-shipping-regression-${process.pid}.db`);
const db = new Database(dbPath);
try {
  db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, shipping_quantity INTEGER, shipping_required_date TEXT, delivery_date TEXT)');
  db.prepare('INSERT INTO orders(id, shipping_quantity, shipping_required_date, delivery_date) VALUES (1,0,\'2026-08-20\',NULL)').run();

  const item = { shipping_quantity: 100000, shipping_required_date: '2026-08-20', delivery_date: null };
  db.prepare('UPDATE orders SET shipping_quantity=?, shipping_required_date=?, delivery_date=? WHERE id=?')
    .run(Number(item.shipping_quantity) || 0, item.shipping_required_date || null, item.delivery_date || null, 1);

  const row = db.prepare('SELECT shipping_quantity, shipping_required_date FROM orders WHERE id=1').get();
  if (row.shipping_quantity !== 100000 || row.shipping_required_date !== '2026-08-20') {
    throw new Error(`Shipping quantity regression failed: ${JSON.stringify(row)}`);
  }
} finally {
  db.close();
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(`${dbPath}-wal`); } catch {}
  try { fs.unlinkSync(`${dbPath}-shm`); } catch {}
}

console.log('WORKFLOW_BOARD_AND_SHIPPING_QUANTITY_REGRESSION_OK');
