const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'diecut-schedule', 'server.js');
let source = fs.readFileSync(file, 'utf8');
const original = source;

function replaceOnce(from, to, label, haystack = source) {
  const count = haystack.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  return haystack.replace(from, to);
}

const fnStart = source.indexOf('function extractWorkflowRow(');
const fnEnd = source.indexOf('function workflowStageRank(', fnStart);
if (fnStart < 0 || fnEnd < 0 || fnEnd <= fnStart) {
  throw new Error('extractWorkflowRow function boundaries not found');
}

let fn = source.slice(fnStart, fnEnd);
if (!fn.includes('const shippingQuantity =')) {
  fn = replaceOnce(
    "  const quantity = numberOr(findImportValue(row, [\n    '工单数量','订单数量','需求数量','生产数量','计划数量','数量','qty','pcs','预计产量'\n  ]), 0);\n",
    "  const quantity = numberOr(findImportValue(row, [\n    '工单数量','订单数量','需求数量','生产数量','预计计划量','计划数量','数量','qty','pcs','预计产量'\n  ]), 0);\n  const shippingQuantity = numberOr(findImportValue(row, [\n    '出货数量','已出货数量','交货数量','发货数量','shipping_quantity','shipping quantity'\n  ]), 0);\n",
    'extract shippingQuantity', fn
  );
} else if (!fn.includes('预计计划量')) {
  fn = replaceOnce(
    "    '工单数量','订单数量','需求数量','生产数量','计划数量','数量','qty','pcs','预计产量'\n",
    "    '工单数量','订单数量','需求数量','生产数量','预计计划量','计划数量','数量','qty','pcs','预计产量'\n",
    'add 预计计划量 alias', fn
  );
}

if (!fn.includes('shipping_quantity: shippingQuantity')) {
  fn = replaceOnce(
    "    quantity,\n    stage,\n",
    "    quantity,\n    shipping_quantity: shippingQuantity,\n    stage,\n",
    'return shipping_quantity', fn
  );
}
source = source.slice(0, fnStart) + fn + source.slice(fnEnd);

// Legacy-data compatibility: recover per-order shipping quantity from the latest workflow snapshot.
const backfillMarker = '// V5.1.3-SHIPPING-QTY-BACKFILL';
if (!source.includes(backfillMarker)) {
  const anchor = "ensureColumn('workflow_snapshots', 'shortage_detail', 'TEXT');\n";
  const migration = `${anchor}\n${backfillMarker}\nfunction backfillOrderShippingQuantities() {\n  const latestBatch = db.prepare('SELECT id FROM workflow_import_batches ORDER BY id DESC LIMIT 1').get();\n  if (!latestBatch) return 0;\n\n  const rows = db.prepare(\`\n    SELECT s.id, s.work_order_number, s.raw_json, s.shipping_required_date, s.delivery_date\n    FROM workflow_snapshots s\n    WHERE s.batch_id=?\n      AND s.id IN (\n        SELECT MAX(s2.id)\n        FROM workflow_snapshots s2\n        WHERE s2.batch_id=?\n        GROUP BY s2.work_order_number\n      )\n      AND s.work_order_number IS NOT NULL\n      AND TRIM(s.work_order_number) <> ''\n  \`).all(latestBatch.id, latestBatch.id);\n\n  const findOrder = db.prepare('SELECT id FROM orders WHERE order_number=? ORDER BY id DESC LIMIT 1');\n  const update = db.prepare(\`\n    UPDATE orders\n    SET shipping_quantity=?,\n        shipping_required_date=COALESCE(?, shipping_required_date),\n        delivery_date=COALESCE(?, delivery_date)\n    WHERE id=?\n  \`);\n\n  let changed = 0;\n  const tx = db.transaction(() => {\n    for (const row of rows) {\n      let raw = null;\n      try { raw = row.raw_json ? JSON.parse(row.raw_json) : null; } catch {}\n      if (!raw) continue;\n      const direct = Number(raw.shipping_quantity);\n      const fallback = Number(raw.delivery_qty);\n      const quantity = Number.isFinite(direct) && direct >= 0 ? direct\n        : Number.isFinite(fallback) && fallback >= 0 ? fallback : null;\n      if (quantity === null) continue;\n\n      const order = findOrder.get(row.work_order_number);\n      if (!order) continue;\n      update.run(quantity, row.shipping_required_date || null, row.delivery_date || null, order.id);\n      changed += 1;\n    }\n  });\n  tx();\n  return changed;\n}\nbackfillOrderShippingQuantities();\n`;
  if (!source.includes(anchor)) throw new Error('workflow snapshot schema anchor not found');
  source = source.replace(anchor, migration);
}

// V5.1.4-WORKFLOW-FIELDS-VERIFIED
// The workflow board must return the same order-level quantity/shipping/date fields used by the final verified release.
const boardAnchor = "             COALESCE(snap.quantity,o.quantity,0) quantity,COALESCE(o.shipping_quantity,0) shipping_quantity,o.status order_status,\n             snap.shipping_required_date,snap.delivery_date,\n";
const boardReplacement = "             CASE WHEN COALESCE(snap.quantity,0)>0 THEN snap.quantity ELSE COALESCE(o.quantity,0) END quantity,\n             CASE WHEN COALESCE(o.shipping_quantity,0)>0 THEN o.shipping_quantity\n                  ELSE COALESCE(CAST(json_extract(snap.raw_json,'$.shipping_quantity') AS REAL),CAST(json_extract(snap.raw_json,'$.delivery_qty') AS REAL),0) END shipping_quantity,\n             o.status order_status,\n             COALESCE(NULLIF(TRIM(snap.shipping_required_date),''),o.shipping_required_date) shipping_required_date,\n             COALESCE(NULLIF(TRIM(snap.delivery_date),''),o.delivery_date) delivery_date,\n";
if (!source.includes("// V5.1.4-WORKFLOW-FIELDS-VERIFIED")) {
  source = replaceOnce(boardAnchor, boardReplacement, 'workflow board field mapping');
  source = source.replace("const quantity = numberOr(findImportValue(row, [\n    '工单数量','订单数量','需求数量','生产数量','计划数量','数量','qty','pcs','预计产量'\n  ]), 0);", "const quantity = numberOr(findImportValue(row, [\n    '工单数量','订单数量','需求数量','生产数量','预计计划量','计划数量','数量','qty','pcs','预计产量'\n  ]), 0);");
  const marker = '// V5.1.4-WORKFLOW-FIELDS-VERIFIED';
  source = source.replace('app.get(\'/api/workflow/board\'', `${marker}\napp.get('/api/workflow/board'`);
}

if (source === original) {
  console.log('SHIPPING_QUANTITY_REPAIR_ALREADY_APPLIED');
  process.exit(0);
}
fs.writeFileSync(file, source, 'utf8');
console.log('SHIPPING_QUANTITY_REPAIR_APPLIED');
