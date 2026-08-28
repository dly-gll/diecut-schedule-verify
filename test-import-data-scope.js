const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'diecut-schedule');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-fixtures', 'import-scope-realdata.json'), 'utf8'));

const workflowStart = server.indexOf("app.post('/api/workflow/import'");
const workflowEnd = server.indexOf("// V5.1.4-WORKFLOW-FIELDS-VERIFIED", workflowStart);
if (workflowStart < 0 || workflowEnd < 0) throw new Error('Workflow route boundary missing');
const workflowRoute = server.slice(workflowStart, workflowEnd);

const productStart = server.indexOf("app.post('/api/product-data/batch-import'");
const productEnd = server.indexOf("// ================== 设备管理", productStart);
if (productStart < 0 || productEnd < 0) throw new Error('Product import route boundary missing');
const productRoute = server.slice(productStart, productEnd);

const machineStart = server.indexOf("app.post('/api/machines/batch-import'");
if (machineStart < 0) throw new Error('Machine Excel import route missing');
const machineRoute = server.slice(machineStart, server.indexOf("// ================== 智能排程", machineStart));

const orderStart = server.indexOf("app.post('/api/orders/batch-import'");
const orderEnd = server.indexOf("app.get('/api/orders/export'", orderStart);
if (orderStart < 0 || orderEnd < 0) throw new Error('Order import route boundary missing');
const orderRoute = server.slice(orderStart, orderEnd);

const requiredHeaders = new Set(fixture.work_order_sheet.required_headers);
const expectedHeaders = ['生产工单','产品品号','品名','预计产量','出货数量','要求出货时间','生产进度','是否齐料','欠料明细'];
for (const h of expectedHeaders) if (!requiredHeaders.has(h)) throw new Error(`Real Excel fixture missing header: ${h}`);

if (fixture.real_data_snapshot.machines !== 43 || fixture.real_data_snapshot.product_data !== 3848 || fixture.real_data_snapshot.orders !== 92) {
  throw new Error('Real data snapshot counts do not match the supplied data.db baseline');
}

// Order/workflow imports are owned by orders page and must not mutate master-data tables.
if (!workflowRoute.includes("source_page !== 'orders'")) throw new Error('Workflow order ownership guard missing');
if (/INSERT INTO product_data|UPDATE product_data|productTx\(\)|upsertProduct/i.test(workflowRoute)) {
  throw new Error('Workflow import still writes product_data');
}
if (!workflowRoute.includes('const productRows=db.prepare(\'SELECT * FROM product_data\').all()')) {
  throw new Error('Workflow import should read product_data as master data');
}

if (!orderRoute.includes("source_page !== 'orders'")) throw new Error('Order import ownership guard missing');
if (/INSERT INTO product_data|UPDATE product_data|INSERT INTO machines|UPDATE machines/i.test(orderRoute)) {
  throw new Error('Order batch import writes machines/product_data');
}

// Product data Excel writes only through the product page.
if (!productRoute.includes("source_page !== 'products'")) throw new Error('Product-page ownership guard missing');

// Device Excel writes only through the device page.
if (!machineRoute.includes("source_page !== 'machines'")) throw new Error('Machine-page ownership guard missing');
if (!machineRoute.includes("INSERT INTO machines")) throw new Error('Machine import INSERT missing');
if (!machineRoute.includes("UPDATE machines")) throw new Error('Machine import UPDATE missing');

// UI wiring must declare the page owner explicitly.
if (!index.includes("body:JSON.stringify({ machines, source_page:'machines' })")) throw new Error('Device page import payload missing source_page=machines');
if (!index.includes("body: JSON.stringify({ products, source_page: 'products' })")) throw new Error('Product page import payload missing source_page=products');
if (!index.includes("source_page:'orders'")) throw new Error('Order/workflow import payload missing source_page=orders');
if (!index.includes('async function importMachines(input)')) throw new Error('Device page Excel import function missing');

console.log('IMPORT_DATA_OWNERSHIP_ISOLATION_REGRESSION_OK');
