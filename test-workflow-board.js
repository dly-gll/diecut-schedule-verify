const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
if (!fs.existsSync(serverPath)) {
  throw new Error('server.js has not been uploaded yet');
}
const source = fs.readFileSync(serverPath, 'utf8');

const requiredPatterns = [
  "COALESCE(snap.shipping_required_date,o.shipping_required_date) shipping_required_date",
  "COALESCE(snap.delivery_date,o.delivery_date,o.delivery_time) delivery_date",
  "出货需求日期",
  "要求出货日期"
];
for (const pattern of requiredPatterns) {
  if (!source.includes(pattern)) {
    throw new Error(`Missing workflow data mapping: ${pattern}`);
  }
}
console.log('WORKFLOW_SOURCE_MAPPING_OK');
