const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'diecut-schedule', 'server.js');
let source = fs.readFileSync(file, 'utf8');

const marker = '// V5.1.6-WORKFLOW-BOARD-RUNTIME-FALLBACK';
if (!source.includes(marker)) {
  const helper = `${marker}
// 看板读取时直接从当前批次快照的原始“在制工单明细”文本恢复现场标准表字段。
// 这样即使旧数据库的 snapshot.quantity/shipping_quantity 没有回填，也不会再显示 0/0/-。
function applyWorkflowBoardLegacyFieldFallback(row) {
  const out = { ...row };
  const fields = String(out.workflow_status_text || '').split('|').map(v => String(v ?? '').trim());
  const legacyQuantity = numberOr(fields[8], NaN);
  const legacyShippingQuantity = numberOr(fields[14], NaN);
  const legacyShippingDate = normalizeImportedDate(fields[15]);

  if (!(Number(out.quantity) > 0) && Number.isFinite(legacyQuantity) && legacyQuantity > 0) {
    out.quantity = legacyQuantity;
  }
  if (!(Number(out.shipping_quantity) > 0) && Number.isFinite(legacyShippingQuantity) && legacyShippingQuantity >= 0) {
    out.shipping_quantity = legacyShippingQuantity;
  }
  if ((!out.shipping_required_date || !String(out.shipping_required_date).trim()) && legacyShippingDate) {
    out.shipping_required_date = legacyShippingDate;
  }

  return out;
}

`;
  const target = 'function backfillWorkflowLegacyBoardFields() {';
  if (!source.includes(target)) throw new Error('Board runtime fallback insertion marker not found');
  source = source.replace(target, helper + target);
}

const oldRoute = ".all(latestBatch.id,stage);\n    // “欠料”页面只展示工单级欠料";
const newRoute = ".all(latestBatch.id,stage).map(applyWorkflowBoardLegacyFieldFallback);\n    // “欠料”页面只展示工单级欠料";
if (source.includes(oldRoute)) {
  source = source.replace(oldRoute, newRoute);
} else if (!source.includes(newRoute)) {
  throw new Error('Workflow board query projection marker not found');
}

fs.writeFileSync(file, source);
console.log('WORKFLOW_BOARD_RUNTIME_FALLBACK_APPLIED');
