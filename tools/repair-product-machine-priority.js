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

// 只在 autoNormalizeImportedOrder() 内修改，避免误改 workflow 解析器中的 process 字段。
const start = source.indexOf('function autoNormalizeImportedOrder');
const end = source.indexOf("app.post('/api/orders/import-normalize'", start);
if (start < 0 || end < 0) throw new Error('autoNormalizeImportedOrder source range not found');
const fn = source.slice(start, end);

// 1) 替换当前函数中的产品数据设备优先块；支持 V5.1.6/7/8 和旧版补齐块。
const currentBlockRegex = /  \/\/ V5\.1\.(?:6|7|8)-PRODUCT-(?:MACHINE|DATA-EQUIPMENT)-PRIORITY[\s\S]*?\n  if \(!\(moldChange >= 0\)\) moldChange = 30;/;
const legacyBlock = `  // V5 自动反查产品主数据补齐：设备、刀模、产能、换模时间、品名、工艺。\n  if (product) {\n    if (!process) process = normalizeImportText(product.process);\n    if (!machineTokens) machineTokens = normalizeImportText(product.machines);\n    if (!mold) mold = normalizeImportText(product.mold);\n    if (!(capacity > 0)) capacity = numberOr(product.capacity, 1000);\n    if (!(moldChange >= 0)) moldChange = numberOr(product.mold_change_time, 30);\n  }`;
let fn2 = fn;
if (currentBlockRegex.test(fn2)) {
  fn2 = fn2.replace(currentBlockRegex, newBlock);
} else if (fn2.includes(legacyBlock)) {
  fn2 = fn2.replace(legacyBlock, newBlock);
} else {
  throw new Error('Product data equipment priority block not found inside autoNormalizeImportedOrder');
}

// 2) 精确修改 autoNormalizeImportedOrder 中的 process 读取，让 Excel“设备”在产品数据无设备时回退。
const processStart = fn2.indexOf('  let process = normalizeImportText(findImportValue(row, [');
const processEnd = fn2.indexOf('  ]));', processStart);
if (processStart < 0 || processEnd < 0) throw new Error('autoNormalizeImportedOrder process field target not found');
const processReplacement = "  let process = normalizeImportText(findImportValue(row, [\n    'process','工艺','制程','工序','设备','设备名称','设备编号','机台配置','机台','机台号','机器','机器编号','生产设备'\n  ]));";
fn2 = fn2.slice(0, processStart) + processReplacement + fn2.slice(processEnd + '  ]));'.length);

source = source.slice(0, start) + fn2 + source.slice(end);
fs.writeFileSync(file, source);
console.log(marker + '_APPLIED');
