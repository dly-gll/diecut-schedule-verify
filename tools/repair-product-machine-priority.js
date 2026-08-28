const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'diecut-schedule', 'server.js');
let source = fs.readFileSync(file, 'utf8');

const marker = '// V5.1.8-PRODUCT-DATA-EQUIPMENT-PRIORITY';
const newBlock = `  // V5.1.8-PRODUCT-DATA-EQUIPMENT-PRIORITY
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
  }`;

// 1) 无论源码当前是旧版 V5.1.6、旧版 V5.1.7，还是已经有 V5.1.8，都强制规范成当前规则。
const currentBlockRegex = /  \/\/ V5\.1\.(?:6|7|8)-PRODUCT-(?:MACHINE|DATA-EQUIPMENT)-PRIORITY[\s\S]*?\n  if \(!\(moldChange >= 0\)\) moldChange = 30;/;
if (currentBlockRegex.test(source)) {
  source = source.replace(currentBlockRegex, newBlock);
} else {
  // 兼容已知正常版中原始的产品主数据补齐代码块。
  const legacyBlock = `  // V5 自动反查产品主数据补齐：设备、刀模、产能、换模时间、品名、工艺。\n  if (product) {\n    if (!process) process = normalizeImportText(product.process);\n    if (!machineTokens) machineTokens = normalizeImportText(product.machines);\n    if (!mold) mold = normalizeImportText(product.mold);\n    if (!(capacity > 0)) capacity = numberOr(product.capacity, 1000);\n    if (!(moldChange >= 0)) moldChange = numberOr(product.mold_change_time, 30);\n  }`;
  if (!source.includes(legacyBlock)) throw new Error('Product data equipment priority patch target not found');
  source = source.replace(legacyBlock, newBlock);
}

// 2) 页面“设备”实际显示 orders.process；产品数据没有设备时，Excel“设备”必须回退到 process。
const processRegex = /  let process = normalizeImportText\(findImportValue\(row, \[[\s\S]*?\]\)\);/;
const desiredProcess = "  let process = normalizeImportText(findImportValue(row, [\n    'process','工艺','制程','工序','设备','设备名称','设备编号','机台配置','机台','机台号','机器','机器编号','生产设备'\n  ]));";
if (!processRegex.test(source)) throw new Error('Excel equipment process fallback target not found');
source = source.replace(processRegex, desiredProcess);

fs.writeFileSync(file, source);
console.log(marker + '_APPLIED');
