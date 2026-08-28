const fs = require('fs');
const path = require('path');
const vm = require('vm');

const serverPath = path.join(__dirname, 'diecut-schedule', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');

if (!source.includes('// V5.1.7-PRODUCT-DATA-EQUIPMENT-PRIORITY')) {
  throw new Error('Product-data equipment priority marker missing');
}

const start = source.indexOf('function normalizeImportHeader');
const end = source.indexOf("app.post('/api/orders/import-normalize'", start);
if (start < 0 || end < 0) throw new Error('Import normalization source range not found');
const chunk = source.slice(start, end);
const sandbox = {};
vm.runInNewContext(`${chunk}\nthis.__auto = autoNormalizeImportedOrder;`, sandbox);

const autoNormalizeImportedOrder = sandbox.__auto;

// 这里使用用户真实 data.db 中的产品数据样本：
// 31WB00271A / 31PM01254A 的 product_data.process 与 product_data.machines 均来自真实现场数据库。
const productMap = new Map([
  ['31WB00271A', {
    product_code: '31WB00271A',
    product_name: 'SFA-透气孔膜片',
    machines: '1',
    process: '套冲',
    mold: 'Z4937',
    capacity: 1868,
    mold_change_time: 30
  }],
  ['31PM01254A', {
    product_code: '31PM01254A',
    product_name: '上垫棉',
    machines: '对面',
    process: '对面冲压（350/H）',
    mold: 'Z5623',
    capacity: 1000,
    mold_change_time: 30
  }],
  ['31PM00001A', {
    product_code: '31PM00001A',
    product_name: '测试产品',
    machines: '',
    process: '',
    mold: 'M001',
    capacity: 1000,
    mold_change_time: 30
  }]
]);

const productWins = autoNormalizeImportedOrder({
  '工单编号': '5110-20260811002',
  '品号': '31WB00271A',
  '品名': 'SFA-透气孔膜片',
  '预计产量': 100000,
  '设备': 'Excel机台-B',
  '刀模': 'Excel刀模'
}, 0, productMap);
if (productWins.process !== '套冲') {
  throw new Error(`Expected product data equipment(process) to win, got: ${productWins.process}`);
}
if (productWins.machine_tokens !== '1') {
  throw new Error(`Expected product data available-machine value to win, got: ${productWins.machine_tokens}`);
}
if (productWins.mold !== 'Excel刀模') {
  throw new Error('Existing rule changed: Excel mold should still be preserved when product mold fallback is only used');
}

const productWinsSecondRealSample = autoNormalizeImportedOrder({
  '工单编号': '5110-TEST-01254A',
  '品号': '31PM01254A',
  '品名': '上垫棉',
  '预计产量': 4000,
  '设备': 'Excel机台-C',
  '刀模': 'Excel刀模'
}, 1, productMap);
if (productWinsSecondRealSample.process !== '对面冲压（350/H）') {
  throw new Error(`Expected second real product-data equipment to win, got: ${productWinsSecondRealSample.process}`);
}
if (productWinsSecondRealSample.machine_tokens !== '对面') {
  throw new Error(`Expected second real product-data machine to win, got: ${productWinsSecondRealSample.machine_tokens}`);
}

const excelFallback = autoNormalizeImportedOrder({
  '工单编号': 'TEST-002',
  '品号': '31PM00001A',
  '品名': '测试产品',
  '预计产量': 20000,
  '设备': 'Excel机台-C',
  '刀模': 'M001'
}, 2, productMap);
if (excelFallback.machine_tokens !== 'Excel机台-C') {
  throw new Error(`Expected Excel machine fallback when product-data machine is empty, got: ${excelFallback.machine_tokens}`);
}
if (excelFallback.process !== 'Excel机台-C') {
  throw new Error(`Expected Excel equipment to populate process when product-data equipment is empty, got: ${excelFallback.process}`);
}

const noProductFallback = autoNormalizeImportedOrder({
  '工单编号': 'TEST-003',
  '品号': 'NOT-IN-PRODUCT-MASTER',
  '品名': '新产品',
  '预计产量': 5000,
  '设备': 'Excel机台-D',
  '刀模': 'M003'
}, 3, productMap);
if (noProductFallback.machine_tokens !== 'Excel机台-D' || noProductFallback.process !== 'Excel机台-D') {
  throw new Error(`Expected full Excel equipment fallback for unmatched product, got: process=${noProductFallback.process}, machine_tokens=${noProductFallback.machine_tokens}`);
}

console.log('PRODUCT_DATA_EQUIPMENT_PRIORITY_REGRESSION_OK');
