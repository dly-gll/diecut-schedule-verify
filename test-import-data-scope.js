const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'diecut-schedule');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-fixtures', 'import-scope-realdata.json'), 'utf8'));

for (const header of ['生产工单','产品品号','预计产量','出货数量','要求出货时间']) {
  if (!fixture.work_order_sheet.required_headers.includes(header)) throw new Error('Real Excel header missing: ' + header);
}
if (fixture.real_data_snapshot.machines !== 43 || fixture.real_data_snapshot.product_data !== 3848 || fixture.real_data_snapshot.orders !== 92) throw new Error('Real data baseline mismatch');

function section(startMarker, endMarker) {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error('Route section not found: ' + startMarker);
  return server.slice(start, end);
}

const workflow = section("app.post('/api/workflow/import'", "// V5.1.4-WORKFLOW-FIELDS-VERIFIED");
const normalize = section("app.post('/api/orders/import-normalize'", "app.post('/api/orders/batch-import'");
const orderBatch = section("app.post('/api/orders/batch-import'", "app.get('/api/orders/export'");
const products = section("app.post('/api/product-data/batch-import'", "// ================== 设备管理");
const machines = section("app.post('/api/machines/batch-import'", "// ================== 智能排程");

if (!workflow.includes("req.body?.source_page !== 'orders'")) throw new Error('Workflow import must be orders-owned');
if (/INSERT INTO product_data|UPDATE product_data|upsertProduct|productTx\(\)/i.test(workflow)) throw new Error('Workflow import still writes product_data');
if (!workflow.includes("const productRows=db.prepare('SELECT * FROM product_data').all()")) throw new Error('Workflow import must read product_data');

if (!normalize.includes("req.body?.source_page !== 'orders'")) throw new Error('Order normalize must be orders-owned');
if (!orderBatch.includes("req.body?.source_page !== 'orders'")) throw new Error('Order batch must be orders-owned');
if (/INSERT INTO product_data|UPDATE product_data|INSERT INTO machines|UPDATE machines/i.test(orderBatch)) throw new Error('Order batch must not write master data');

if (!products.includes("req.body?.source_page !== 'products'")) throw new Error('Product-data import must be products-owned');
if (!machines.includes("req.body?.source_page !== 'machines'")) throw new Error('Machine import must be machines-owned');
if (!machines.includes('INSERT INTO machines')) throw new Error('Machine import INSERT missing');
if (!machines.includes('UPDATE machines')) throw new Error('Machine import UPDATE missing');

if (!index.includes("source_page:'orders'")) throw new Error('Orders page payload missing source_page=orders');
if (!index.includes("source_page: 'products'")) throw new Error('Products page payload missing source_page=products');
if (!index.includes("source_page:'machines'")) throw new Error('Machines page payload missing source_page=machines');
if (!index.includes('async function importMachines(input)')) throw new Error('Machines page Excel import function missing');
if (!index.includes('onchange="importMachines(this)"')) throw new Error('Machines page Excel button missing');

console.log('IMPORT_DATA_OWNERSHIP_ISOLATION_REGRESSION_OK');
