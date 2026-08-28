const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'diecut-schedule', 'server.js');
let source = fs.readFileSync(file, 'utf8');
const original = source;

function replaceOnce(from, to, label, haystack = source) {
  const count = haystack.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  }
  return haystack.replace(from, to);
}

const fnStart = source.indexOf('function extractWorkflowRow(');
const fnEnd = source.indexOf('function workflowStageRank(', fnStart);
if (fnStart < 0 || fnEnd < 0 || fnEnd <= fnStart) {
  throw new Error('extractWorkflowRow function boundaries not found');
}

let fn = source.slice(fnStart, fnEnd);
fn = replaceOnce(
  "  const quantity = numberOr(findImportValue(row, [\n    '工单数量','订单数量','需求数量','生产数量','计划数量','数量','qty','pcs','预计产量'\n  ]), 0);\n",
  "  const quantity = numberOr(findImportValue(row, [\n    '工单数量','订单数量','需求数量','生产数量','计划数量','数量','qty','pcs','预计产量'\n  ]), 0);\n  const shippingQuantity = numberOr(findImportValue(row, [\n    '出货数量','已出货数量','交货数量','发货数量','shipping_quantity','shipping quantity'\n  ]), 0);\n",
  'extract shippingQuantity', fn
);

fn = replaceOnce(
  "    quantity,\n    stage,\n",
  "    quantity,\n    shipping_quantity: shippingQuantity,\n    stage,\n",
  'return shipping_quantity', fn
);

source = source.slice(0, fnStart) + fn + source.slice(fnEnd);

source = replaceOnce(
  "              item.work_order_number,item.product_code,item.product_name,item.quantity,0,item.shipping_required_date||null,item.delivery_date||null,null,\n",
  "              item.work_order_number,item.product_code,item.product_name,item.quantity,Number(item.shipping_quantity)||0,item.shipping_required_date||null,item.delivery_date||null,null,\n",
  'insert shipping_quantity'
);

source = replaceOnce(
  "            shipping_required_date=?,delivery_date=?,\n",
  "            shipping_quantity=?,shipping_required_date=?,delivery_date=?,\n",
  'update shipping_quantity SQL'
);

source = replaceOnce(
  "              item.product_name||'',item.product_name||'',Number(item.quantity)||0,Number(item.quantity)||0,item.shipping_required_date||null,item.delivery_date||null,\n",
  "              item.product_name||'',item.product_name||'',Number(item.quantity)||0,Number(item.quantity)||0,Number(item.shipping_quantity)||0,item.shipping_required_date||null,item.delivery_date||null,\n",
  'update shipping_quantity params'
);

if (source === original) throw new Error('No changes made');
fs.writeFileSync(file, source, 'utf8');
console.log('SHIPPING_QUANTITY_REPAIR_APPLIED');
