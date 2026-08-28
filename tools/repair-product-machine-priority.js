const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'diecut-schedule', 'server.js');
let source = fs.readFileSync(file, 'utf8');

const marker = '// V5.1.6-PRODUCT-MACHINE-PRIORITY';
if (source.includes(marker)) {
  console.log('PRODUCT_MACHINE_PRIORITY_ALREADY_APPLIED');
  process.exit(0);
}

const oldBlock = `  // V5 自动反查产品主数据补齐：设备、刀模、产能、换模时间、品名、工艺。
  if (product) {
    if (!process) process = normalizeImportText(product.process);
    if (!machineTokens) machineTokens = normalizeImportText(product.machines);
    if (!mold) mold = normalizeImportText(product.mold);
    if (!(capacity > 0)) capacity = numberOr(product.capacity, 1000);
    if (!(moldChange >= 0)) moldChange = numberOr(product.mold_change_time, 30);
  }`;

const newBlock = `  // V5.1.6-PRODUCT-MACHINE-PRIORITY
  // 工单导入设备选择：产品数据按品号命中且存在设备时，产品数据设备优先；
  // 产品数据没有设备时，才保留 Excel 中的设备。
  if (product) {
    if (!process) process = normalizeImportText(product.process);
    const productMachines = normalizeImportText(product.machines);
    if (productMachines) machineTokens = productMachines;
    if (!mold) mold = normalizeImportText(product.mold);
    if (!(capacity > 0)) capacity = numberOr(product.capacity, 1000);
    if (!(moldChange >= 0)) moldChange = numberOr(product.mold_change_time, 30);
  }`;

if (!source.includes(oldBlock)) throw new Error('Product machine priority patch target not found');
source = source.replace(oldBlock, newBlock);
fs.writeFileSync(file, source);
console.log('PRODUCT_MACHINE_PRIORITY_PATCH_APPLIED');
