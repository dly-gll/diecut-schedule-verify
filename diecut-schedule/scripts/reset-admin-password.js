#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const Database = require('better-sqlite3');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

function validatePassword(password) {
  const value = String(password ?? '');
  if (value.length < 8) throw new Error('管理员密码至少需要 8 个字符');
  if (value.length > 128) throw new Error('管理员密码不能超过 128 个字符');
  return value;
}

function resetAdminPassword(dbPath, password) {
  const clean = validatePassword(password);
  const db = new Database(dbPath);
  try {
    const user = db.prepare('SELECT id FROM users WHERE username=?').get('admin');
    if (!user) {
      db.prepare('INSERT INTO users(username,password,role,created_at) VALUES (?,?,?,?)')
        .run('admin', hashPassword(clean), 'admin', new Date().toISOString());
      return { created: true, updated: false };
    }
    db.prepare('UPDATE users SET password=?, role=CASE WHEN role IS NULL OR role=\'\' THEN \'admin\' ELSE role END WHERE id=?')
      .run(hashPassword(clean), user.id);
    return { created: false, updated: true };
  } finally {
    db.close();
  }
}

function promptPassword() {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';
    stdout.write('请输入新的 admin 密码（至少 8 个字符）：');

    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      rl.question('', answer => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    const onData = ch => {
      const code = ch.toString();
      if (code === '\u0003') {
        cleanup();
        reject(new Error('已取消'));
        return;
      }
      if (code === '\r' || code === '\n') {
        cleanup();
        stdout.write('\n');
        resolve(value);
        return;
      }
      if (code === '\u007f' || code === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += code;
    };
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      rl.close();
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const dbPath = path.resolve(process.env.DIECUT_DB_PATH || path.join(__dirname, '..', 'data.db'));
  const password = process.env.NEW_ADMIN_PASSWORD || process.argv[2] || await promptPassword();
  const result = resetAdminPassword(dbPath, password);
  console.log(result.created ? '✅ 已创建 admin 管理员账号并设置新密码。' : '✅ admin 管理员密码已重置。');
  console.log(`数据库：${dbPath}`);
  console.log('原有订单、产品、设备、排程数据不会被删除。');
}

if (require.main === module) {
  main().catch(err => {
    console.error(`❌ 密码重置失败：${err.message}`);
    process.exit(1);
  });
}

module.exports = { hashPassword, validatePassword, resetAdminPassword };
