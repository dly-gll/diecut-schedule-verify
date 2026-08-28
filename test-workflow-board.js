const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'diecut-schedule', 'server.js');
if (!fs.existsSync(serverPath)) {
  throw new Error(`server.js not found: ${serverPath}`);
}
const source = fs.readFileSync(serverPath, 'utf8');

const requiredPatterns = [
  "snap.shipping_required_date,snap.delivery_date",
  "'出货需求日期'",
  "'要求出货日期'",
  "snap.work_order_number IS NULL",
  "snap.stage=?"
];

for (const pattern of requiredPatterns) {
  if (!source.includes(pattern)) {
    throw new Error(`Missing workflow board mapping/query guard: ${pattern}`);
  }
}

// 回归测试：没有工单号时也必须允许看板记录返回，避免 SQL 中 NULL = NULL 把记录过滤掉。
const boardSqlGuard = /snap\.work_order_number\s+IS\s+NULL\s+\n?\s*OR\s+snap\.id\s*=/.test(source);
if (!boardSqlGuard) {
  throw new Error('Workflow board query is missing the NULL work-order guard');
}

console.log('WORKFLOW_BOARD_SOURCE_MAPPING_OK');
