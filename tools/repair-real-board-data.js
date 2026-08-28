const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'diecut-schedule', 'server.js');
let source = fs.readFileSync(file, 'utf8');

if (!source.includes('// V5.1.5-WORKFLOW-LEGACY-FIELD-BACKFILL')) {
  const marker = 'backfillOrderShippingQuantities();\n\nfunction hashPassword(password) {';
  const insert = [
    'backfillOrderShippingQuantities();',
    '',
    '// V5.1.5-WORKFLOW-LEGACY-FIELD-BACKFILL',
    '// 兼容已经导入过的现场标准表：旧版本可能把“预计产量/出货数量/要求出货日期”留在 raw_json.status_text。',
    '// 当前看板仍应从这些真实字段恢复，不要求用户重新整理数据库。',
    'function backfillWorkflowLegacyBoardFields() {',
    "  const latestBatch = db.prepare('SELECT id FROM workflow_import_batches ORDER BY id DESC LIMIT 1').get();",
    '  if (!latestBatch) return 0;',
    '  const rows = db.prepare("SELECT id, work_order_number, quantity, shipping_quantity, shipping_required_date, delivery_date, raw_json, sheet_name FROM workflow_snapshots WHERE batch_id=? AND work_order_number IS NOT NULL AND TRIM(work_order_number)<>\'\' AND (sheet_name LIKE \'%在制工单明细%\' OR sheet_name LIKE \'%生产工单明细%\')").all(latestBatch.id);',
    '  const update = db.prepare("UPDATE workflow_snapshots SET quantity=?, shipping_quantity=?, shipping_required_date=?, delivery_date=?, raw_json=? WHERE id=?");',
    '  let changed = 0;',
    '  const tx = db.transaction(() => {',
    '    for (const row of rows) {',
    '      let raw = {};',
    '      try { raw = row.raw_json ? JSON.parse(row.raw_json) : {}; } catch { raw = {}; }',
    "      const fields = String(raw.status_text || '').split('|').map(v => String(v ?? '').trim());",
    '      const legacyQuantity = numberOr(fields[8], NaN);',
    '      const legacyShipping = numberOr(fields[14], NaN);',
    '      const legacyShipDate = normalizeImportedDate(fields[15]);',
    '      const quantity = Number(row.quantity) > 0 ? Number(row.quantity) : (Number.isFinite(legacyQuantity) && legacyQuantity > 0 ? legacyQuantity : Number(row.quantity || 0));',
    '      const shippingQuantity = Number(row.shipping_quantity) > 0 ? Number(row.shipping_quantity) : (Number.isFinite(Number(raw.shipping_quantity)) && Number(raw.shipping_quantity) >= 0 ? Number(raw.shipping_quantity) : (Number.isFinite(Number(raw.delivery_qty)) && Number(raw.delivery_qty) >= 0 ? Number(raw.delivery_qty) : (Number.isFinite(legacyShipping) && legacyShipping >= 0 ? legacyShipping : Number(row.shipping_quantity || 0))));',
    '      const shippingRequiredDate = row.shipping_required_date || raw.shipping_required_date || legacyShipDate || null;',
    '      const deliveryDate = row.delivery_date || raw.delivery_date || null;',
    '      const patchedRaw = { ...raw, quantity, shipping_quantity: shippingQuantity, shipping_required_date: shippingRequiredDate, delivery_date: deliveryDate };',
    '      if (quantity !== Number(row.quantity || 0) || shippingQuantity !== Number(row.shipping_quantity || 0) || shippingRequiredDate !== (row.shipping_required_date || null) || deliveryDate !== (row.delivery_date || null)) {',
    '        update.run(quantity, shippingQuantity, shippingRequiredDate, deliveryDate, JSON.stringify(patchedRaw), row.id);',
    '        changed += 1;',
    '      }',
    '    }',
    '  });',
    '  tx();',
    '  return changed;',
    '}',
    'backfillWorkflowLegacyBoardFields();',
    '',
    'function hashPassword(password) {'
  ].join('\n');
  if (!source.includes(marker)) throw new Error('Legacy backfill insertion marker not found');
  source = source.replace(marker, insert);
}

const oldAuto = `const quantity = numberOr(findImportValue(row, [
    'quantity','qty','工单数量','订单数量','需求数量','生产数量','计划数量','数量','pcs','总数量'
  ]), 0);`;
const newAuto = `const quantity = numberOr(findImportValuePriority(row, [
    '预计产量','预计计划量','数量','quantity','qty'
  ], [
    '工单数量','订单数量','需求数量','生产数量','计划数量','pcs','总数量'
  ]), 0);`;
if (source.includes(oldAuto)) source = source.replace(oldAuto, newAuto);

fs.writeFileSync(file, source);
console.log('REAL_BOARD_DATA_FALLBACK_REPAIR_APPLIED');
