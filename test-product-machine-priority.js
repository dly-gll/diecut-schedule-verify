const fs = require('fs');
const path = require('path');
const vm = require('vm');

const serverPath = path.join(__dirname, 'diecut-schedule', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');

if (!source.includes('// V5.1.6-PRODUCT-MACHINE-PRIORITY')) {
  throw new Error('Product-machine priority marker missing');
}

const start = source.indexOf('function normalizeImportHeader');
const end = source.indexOf("app.post('/api/orders/import-normalize'", start);
if (start < 0 || end < 0) throw new Error('Import normalization source range not found');
const chunk = source.slice(start, end);
const sandbox = {};
vm.runInNewContext(`${chunk}\nthis.__auto = autoNormalizeImportedOrder;`, sandbox);

const autoNormalizeImportedOrder = sandbox.__auto;
const productMap = new Map([
  ['31WB00271A', {
    product_code: '31WB00271A',
    product_name: 'SFA-透气孔膜片',
    machines: '产品机台-A',
    process: '产品工艺',
    mold: 'Z4937',
    capacity: 1000,
    mold_change_time: 30
  }],
  ['31PM00001A', {
    product_code: '31PM00001A',
    product_name: '测试产品',
    machines: '',
    process: '产品工艺',
    mold: 'M001',
    capacity: 1000,
    mold_change_time: 30
  }]
]);

const productWins = autoNormalizeImportedOrder({
  '工单编号': 'TEST-001',
  '品号': '31WB00271A',
  '品名': 'SFA-透气孔膜片',
  '预计产量': 100000,
  '设备': 'Excel机台-B',
  '刀模': 'Z4937'
}, 0, productMap);
if (productWins.machine_tokens !== '产品机台-A') {
  throw new Error(`Expected product data machine to win, got: ${productWins.machine_tokens}`);
}

const excelFallback = autoNormalizeImportedOrder({
  '工单编号': 'TEST-002',
  '品号': '31PM00001A',
  '品名': '测试产品',
  '预计产量': 20000,
  '设备': 'Excel机台-C',
  '刀模': 'M001'
}, 1, productMap);
if (excelFallback.machine_tokens !== 'Excel机台-C') {
  throw new Error(`Expected Excel machine fallback, got: ${excelFallback.machine_tokens}`);
}

const noProductFallback = autoNormalizeImportedOrder({
  '工单编号': 'TEST-003',
  '品号': 'NOT-IN-PRODUCT-MASTER',
  '品名': '新产品',
  '预计产量': 5000,
  '设备': 'Excel机台-D',
  '刀模': 'M003'
}, 2, productMap);
if (noProductFallback.machine_tokens !== 'Excel机台-D') {
  throw new Error(`Expected Excel machine fallback for unmatched product, got: ${noProductFallback.machine_tokens}`);
}

console.log('PRODUCT_MACHINE_PRIORITY_REGRESSION_OK');
