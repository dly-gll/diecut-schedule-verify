const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'diecut-schedule', 'server.js');
let source = fs.readFileSync(file, 'utf8');

const marker = '// V5.1.7-PRODUCT-DATA-EQUIPMENT-PRIORITY';
if (source.includes(marker)) {
  console.log('PRODUCT_DATA_EQUIPMENT_PRIORITY_ALREADY_APPLIED');
  process.exit(0);
}

const blockRegex = /  \/\/ V5\.1\.6-PRODUCT-MACHINE-PRIORITY[\s\S]*?\n  if \(!\(moldChange >= 0\)\) moldChange = 30;/;
const newBlock = `  // V5.1.7-PRODUCT-DATA-EQUIPMENT-PRIORITY
  // 工单导入设备规则：先按品号匹配产品数据；产品数据“设备”有值时优先使用该设备，
  // 产品数据“可用设备/机台”有值时同时优先使用；只有产品数据对应字段为空时才回退 Excel。
  if (product) {
    const productDevice = normalizeImportText(product.process);
    const productMachines = normalizeImportText(product.machines);
    if (productDevice) process = productDevice;
    if (productMachines) machineTokens = productMachines;
    if (!mold) mold = normalizeImportText(product.mold);
    if (!(capacity > 0)) capacity = numberOr(product.capacity, 1000);
    if (!(moldChange >= 0)) moldChange = numberOr(product.mold_change_time, 30);
  }
  if (!(capacity > 0)) capacity = 1000;
  if (!(moldChange >= 0)) moldChange = 30;`;

if (!blockRegex.test(source)) throw new Error('Product data equipment priority patch target not found');
source = source.replace(blockRegex, newBlock);

// 页面“设备”实际显示 orders.process；当产品主数据没有设备时，Excel 的“设备”必须回退到 process。
const oldProcessLine = "  let process = normalizeImportText(findImportValue(row, [\n    'process','工艺','制程','工序','process'\n  ]));";
const newProcessLine = "  let process = normalizeImportText(findImportValue(row, [\n    'process','工艺','制程','工序','设备','设备名称','设备编号','机台配置','机台','机台号','机器','机器编号','生产设备'\n  ]));";
if (!source.includes(newProcessLine)) {
  if (!source.includes(oldProcessLine)) throw new Error('Excel equipment fallback target not found');
  source = source.replace(oldProcessLine, newProcessLine);
}

fs.writeFileSync(file, source);
console.log('PRODUCT_DATA_EQUIPMENT_PRIORITY_APPLIED');
