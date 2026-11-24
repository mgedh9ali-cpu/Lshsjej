CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, student TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, reply TEXT);
CREATE INDEX IF NOT EXISTS feedback_student ON feedback(student, created);

CREATE TABLE IF NOT EXISTS shared_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, publisher TEXT NOT NULL, request_id TEXT NOT NULL, subject TEXT NOT NULL, title TEXT NOT NULL, image TEXT NOT NULL, added_by TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(publisher,request_id));
CREATE INDEX IF NOT EXISTS shared_sources_subject_id ON shared_sources(subject,id DESC);
