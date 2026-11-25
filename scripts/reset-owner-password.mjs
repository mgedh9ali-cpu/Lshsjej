import { randomBytes, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

if (process.stdin.isTTY) throw Error('Pipe the new password on standard input without writing it to the command line.');
let password = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  password += chunk;
  if (password.length > 130) throw Error('Invalid password length.');
}
password = password.replace(/\r?\n$/, '');
if (password.length < 12 || password.length > 128 || /[\r\n]/.test(password)) throw Error('Use a password of 12 to 128 characters.');
const salt = randomBytes(16).toString('hex');
const verifier = salt + ':' + scryptSync(password, salt, 64).toString('hex');
const db = new DatabaseSync(process.env.SCHOOL_DB || 'data/school.sqlite', { timeout: 5000 });
try {
  db.exec('BEGIN IMMEDIATE');
  const owner = db.prepare("SELECT id FROM users WHERE role='owner'").get();
  if (!owner) throw Error('Owner account not found.');
  db.prepare('UPDATE users SET password=?,temporary=0 WHERE id=?').run(verifier, owner.id);
  db.prepare('DELETE FROM sessions WHERE user=?').run(owner.id);
  db.prepare('INSERT INTO audit(user,action,details,created) VALUES(?,?,?,?)').run(
    owner.id, 'تغيير كلمة مرور المالك من الخادم', 'إلغاء جلسات المالك', Date.now(),
  );
  db.exec('COMMIT');
} finally {
  if (db.isTransaction) db.exec('ROLLBACK');
  db.close();
}
console.log('Owner password updated and sessions revoked.');
