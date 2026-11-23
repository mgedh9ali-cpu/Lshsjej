import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
db.exec(`
  CREATE TABLE subjects(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE updates(id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);
`);
const names = ['الفيزياء', 'الكيمياء', 'العلوم', 'الإنجليزي', 'الرياضيات'];
const subject = db.prepare('INSERT INTO subjects VALUES (?, ?)');
names.forEach((name, id) => subject.run(id, name));
db.prepare('INSERT INTO updates VALUES (?, ?, ?)').run(1, 'قراءة صور الدروس', 'افتح المادة واختر صورة. يُحفَظ النص مع الصورة على هاتفك. تظهر إشعارات المالك عند فتح حساب الصف.');
db.close();
