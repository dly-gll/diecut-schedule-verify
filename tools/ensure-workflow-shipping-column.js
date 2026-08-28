const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'diecut-schedule', 'server.js');
let source = fs.readFileSync(file, 'utf8');
const marker = "ensureColumn('workflow_snapshots', 'shipping_quantity', 'REAL DEFAULT 0');";
if (!source.includes(marker)) {
  const anchor = "ensureColumn('workflow_snapshots', 'shipping_required_date', 'TEXT');";
  if (!source.includes(anchor)) throw new Error('workflow_snapshots compatibility anchor not found');
  source = source.replace(anchor, `${anchor}\n${marker}`);
  fs.writeFileSync(file, source);
  console.log('WORKFLOW_SNAPSHOT_SHIPPING_QUANTITY_COLUMN_ADDED');
} else {
  console.log('WORKFLOW_SNAPSHOT_SHIPPING_QUANTITY_COLUMN_ALREADY_PRESENT');
}
