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
fs.writeFileSync(file, source);
console.log('PRODUCT_DATA_EQUIPMENT_PRIORITY_APPLIED');
