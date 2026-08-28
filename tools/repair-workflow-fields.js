const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'diecut-schedule', 'server.js');
let source = fs.readFileSync(file, 'utf8');
const original = source;

function replaceOnce(from, to, label, text = source) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, found ${n}`);
  return text.replace(from, to);
}

if (!source.includes('function findImportValuePriority(')) {
  const anchor = "function findImportValue(row, aliases) {\n";
  const helper = `function findImportValuePriority(row, preferredAliases = [], fallbackAliases = []) {\n  const entries = Object.entries(row || {});\n  const normalizedEntries = entries.map(([k,v]) => ({ key: normalizeImportHeader(k), value:v }));\n  const preferred = preferredAliases.map(normalizeImportHeader).filter(Boolean);\n  for (const alias of preferred) {\n    const exact = normalizedEntries.find(x => x.key === alias);\n    if (exact) return exact.value;\n  }\n  for (const alias of preferred) {\n    const partial = normalizedEntries.find(x => x.key.includes(alias));\n    if (partial) return partial.value;\n  }\n  return findImportValue(row, fallbackAliases.length ? fallbackAliases : preferredAliases);\n}\n\n`;
  source = replaceOnce(anchor, helper + anchor, 'insert priority import helper');
}

let fnStart = source.indexOf('function extractWorkflowRow(');
let fnEnd = source.indexOf('function workflowStageRank(', fnStart);
if (fnStart < 0 || fnEnd < 0) throw new Error('extractWorkflowRow boundaries not found');
let fn = source.slice(fnStart, fnEnd);

fn = fn.replace(/const quantity = numberOr\(findImportValue\(row, \[\n\s*'工单数量','订单数量','需求数量','生产数量','预计计划量','计划数量','数量','qty','pcs','预计产量'\n\s*\]\), 0\);/, `const quantity = numberOr(findImportValuePriority(row, [\n    '预计产量','预计计划量'\n  ], [\n    '工单数量','订单数量','需求数量','生产数量','计划数量','数量','qty','pcs'\n  ]), 0);`);
fn = fn.replace(/const shippingQuantity = numberOr\(findImportValue\(row, \[\n\s*'出货数量','已出货数量','交货数量','发货数量','shipping_quantity','shipping quantity'\n\s*\]\), 0\);/, `const shippingQuantity = numberOr(findImportValuePriority(row, [\n    '出货数量','shipping_quantity','shipping quantity'\n  ], [\n    '已出货数量','交货数量','发货数量','delivery quantity'\n  ]), 0);`);

const dateStart = fn.indexOf('  const shippingRequiredDate =');
const dateEnd = fn.indexOf('\n\n  const explicitExpected =', dateStart);
if (dateStart < 0 || dateEnd < 0) throw new Error('workflow date block not found');
const replacement = `  const shippingRequiredDate = normalizeImportedDate(findImportValuePriority(row, [\n    '要求出货时间','出货需求日期','出货需求时间','客户出货需求日期','客户要求出货日期','要求出货日期','ship date','requested ship date'\n  ], []))\n    || excelContext.shippingRequiredDateByOrder?.get(orderNumber)\n    || excelContext.urgentShippingDateByOrder?.get(orderNumber)\n    || excelContext.urgentShippingDate?.get(productCode)\n    || null;\n  const deliveryDate = normalizeImportedDate(findImportValuePriority(row, [\n    '交货日期','交货时间','客户交货日期','要求交货日期','要求交货时间','delivery_date','delivery date'\n  ], []))\n    || excelContext.deliveryDateByOrder?.get(orderNumber)\n    || excelContext.urgentDeliveryDateByOrder?.get(orderNumber)\n    || excelContext.urgentDeliveryDate?.get(productCode)\n    || null;\n`;
fn = fn.slice(0, dateStart) + replacement.trimEnd() + fn.slice(dateEnd) + '\n';
source = source.slice(0, fnStart) + fn + source.slice(fnEnd);

const ctxMarker = '  const urgentDeliveryDate = new Map();\n';
if (!source.includes('const urgentShippingDateByOrder = new Map();')) {
  source = replaceOnce(ctxMarker, ctxMarker + '  const urgentShippingDateByOrder = new Map();\n  const urgentDeliveryDateByOrder = new Map();\n  const shippingRequiredDateByOrder = new Map();\n  const deliveryDateByOrder = new Map();\n', 'insert workflow date maps');
}

const urgentDateSnippet = `      const workOrder = normalizeImportText(findImportValue(r, ['工单编号','工单号','订单号','订单编号','制造单号','生产单号','work order','wo','wo no','生产工单']));\n      if (workOrder && shipDate && !urgentShippingDateByOrder.has(workOrder)) urgentShippingDateByOrder.set(workOrder, shipDate);\n      if (workOrder && delDate && !urgentDeliveryDateByOrder.has(workOrder)) urgentDeliveryDateByOrder.set(workOrder, delDate);\n`;
if (!source.includes('urgentShippingDateByOrder.set(workOrder')) {
  const anchor = "      const delDate = normalizeImportedDate(findImportValue(r, ['交货日期','要求交货日期']));\n";
  source = replaceOnce(anchor, anchor + urgentDateSnippet, 'insert urgent per-order dates');
}

const generalAnchor = `    if (/模数跳距/i.test(sheet)) {\n`;
if (!source.includes('shippingRequiredDateByOrder.set(workOrder')) {
  const generalBlock = `    const workOrder = normalizeImportText(findImportValue(r, ['工单编号','工单号','订单号','订单编号','制造单号','生产单号','work order','wo','wo no','生产工单']));\n    if (workOrder) {\n      const shipDate = normalizeImportedDate(findImportValue(r, ['要求出货时间','出货需求日期','出货需求时间','客户出货需求日期','客户要求出货日期','要求出货日期']));\n      const delDate = normalizeImportedDate(findImportValue(r, ['交货日期','交货时间','客户交货日期','要求交货日期','要求交货时间']));\n      if (shipDate && !shippingRequiredDateByOrder.has(workOrder)) shippingRequiredDateByOrder.set(workOrder, shipDate);\n      if (delDate && !deliveryDateByOrder.has(workOrder)) deliveryDateByOrder.set(workOrder, delDate);\n    }\n\n`;
  source = replaceOnce(generalAnchor, generalBlock + generalAnchor, 'insert general order date maps');
}

source = source.replace(
  '  return {inventory,inspection,sales,delivery,urgentGap,urgentShippingDate,urgentDeliveryDate,products,productNames};',
  '  return {inventory,inspection,sales,delivery,urgentGap,urgentShippingDate,urgentDeliveryDate,urgentShippingDateByOrder,urgentDeliveryDateByOrder,shippingRequiredDateByOrder,deliveryDateByOrder,products,productNames};'
);

// Keep the existing verified marker; it is intentionally unchanged.
if (source === original) {
  console.log('WORKFLOW_FIELDS_ALREADY_PATCHED');
} else {
  fs.writeFileSync(file, source, 'utf8');
  console.log('WORKFLOW_FIELDS_PATCH_APPLIED');
}
