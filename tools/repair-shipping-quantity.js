const fs = require('fs');

const file = 'diecut-schedule/server.js';
let source = fs.readFileSync(file, 'utf8');
const original = source;

function replaceOnce(from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  }
  source = source.replace(from, to);
}

// 1) 从“在制工单明细”本行直接读取出货数量，避免只依赖品号级汇总。
replaceOnce(
  "  const quantity = numberOr(findImportValue(row, [\n    '工单数量','生产数量','计划数量','数量','qty','quantity'\n  ]), 0);\n",
  "  const quantity = numberOr(findImportValue(row, [\n    '工单数量','生产数量','计划数量','数量','qty','quantity'\n  ]), 0);\n  const shippingQuantity = numberOr(findImportValue(row, [\n    '出货数量','已出货数量','交货数量','发货数量','shipping_quantity','shipping quantity'\n  ]), 0);\n",
  'extract shippingQuantity'
);

replaceOnce(
  "    quantity,\n    stage,\n",
  "    quantity,\n    shipping_quantity: shippingQuantity,\n    stage,\n",
  'return shipping_quantity'
);

// 2) 新建工单时，把工作流本行出货数量写入订单表，而不是写死 0。
replaceOnce(
  "              item.work_order_number,item.product_code,item.product_name,item.quantity,0,item.shipping_required_date||null,item.delivery_date||null,null,\n",
  "              item.work_order_number,item.product_code,item.product_name,item.quantity,Number(item.shipping_quantity)||0,item.shipping_required_date||null,item.delivery_date||null,null,\n",
  'insert shipping_quantity'
);

// 3) 更新已存在工单时，同步覆盖出货数量（0 也是有效值）。
replaceOnce(
  "            shipping_required_date=?,delivery_date=?,\n",
  "            shipping_quantity=?,shipping_required_date=?,delivery_date=?,\n",
  'update shipping_quantity SQL'
);

replaceOnce(
  "              item.product_name||'',item.product_name||'',Number(item.quantity)||0,Number(item.quantity)||0,item.shipping_required_date||null,item.delivery_date||null,\n",
  "              item.product_name||'',item.product_name||'',Number(item.quantity)||0,Number(item.quantity)||0,Number(item.shipping_quantity)||0,item.shipping_required_date||null,item.delivery_date||null,\n",
  'update shipping_quantity params'
);

if (source === original) {
  throw new Error('No changes made');
}

fs.writeFileSync(file, source, 'utf8');
console.log('SHIPPING_QUANTITY_REPAIR_APPLIED');
