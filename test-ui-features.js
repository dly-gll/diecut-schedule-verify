const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'diecut-schedule', 'public', 'index.html');
const serverPath = path.join(__dirname, 'diecut-schedule', 'server.js');
const html = fs.readFileSync(indexPath, 'utf8');
const server = fs.readFileSync(serverPath, 'utf8');

const requiredHtml = [
  'V5.1.4-WORKFLOW-UI-VERIFIED',
  'workflow-count-shortage',
  'workflow-count-available_to_issue',
  'workflow-count-waiting_schedule',
  'workflow-count-in_process',
  'lengthMenu: [[10,15,25,50,100,-1],[10,15,25,50,100,\'当前最多\']',
  '每页显示 _MENU_ 条记录',
  'workflowBoardTable',
  'workflow-production-filter',
  'workflow-material-filter',
  "pageLength:15,order:[[5,'asc'],[0,'asc']]"
];
for (const pattern of requiredHtml) {
  if (!html.includes(pattern)) throw new Error(`Missing UI regression pattern: ${pattern}`);
}

if (!/workflowStageCounts=\{\};[\s\S]*workflowStageCounts\[s\]=Number\(byStage\[s\]\?\.count\|\|0\)/.test(html)) {
  throw new Error('Workflow stage counts are not loaded from all four board APIs');
}

if (!server.includes('COALESCE(o.shipping_quantity,0) shipping_quantity')) {
  throw new Error('Workflow board API is missing shipping quantity');
}

const expectedTables = ['ordersTable', 'machinesTable', 'productsTable', 'scheduleTable', 'usersTable'];
for (const table of expectedTables) {
  if (!html.includes(`$('#${table}').DataTable`)) throw new Error(`Expected DataTable init missing: ${table}`);
}

console.log('WORKFLOW_UI_COUNTS_FILTERS_PAGINATION_OK');
