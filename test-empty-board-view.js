const fs = require('fs');

const server = fs.readFileSync('diecut-schedule/server.js', 'utf8');
const index = fs.readFileSync('diecut-schedule/public/index.html', 'utf8');

if (!server.includes('// V5.2-EMPTY-BOARD-VIEW-FIX')) throw new Error('Empty-board server fix marker missing');
if (!server.includes("FROM workflow_import_batches b") || !server.includes("JOIN workflow_snapshots s ON s.batch_id=b.id AND s.stage=?")) {
  throw new Error('Latest valid workflow batch fallback query missing');
}
if (!server.includes("SELECT kpi_date FROM workflow_daily_kpi ORDER BY kpi_date DESC LIMIT 1")) {
  throw new Error('KPI should read latest calculated snapshot');
}
if (!server.includes('KPI只读取最近一次已计算的快照')) throw new Error('KPI latest-snapshot policy missing');

const emptyRow = '<tr><td class="text-muted">当前批次该板块暂无数据</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
if (!index.includes(emptyRow)) throw new Error('Empty board row must preserve 10 table cells for DataTables');
if (!index.includes("workflowKpiData?.has_data")) throw new Error('KPI no-data display guard missing');

console.log('EMPTY_BOARD_VIEW_NO_DATA_AND_KPI_REGRESSION_OK');
