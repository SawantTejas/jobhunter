CREATE TABLE application_answers (
  concept TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  confirmedAt TEXT NOT NULL
);
CREATE TABLE application_sessions (
  id TEXT PRIMARY KEY,
  jobId TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  startedAt TEXT NOT NULL,
  detectedJson TEXT NOT NULL DEFAULT '[]',
  filledJson TEXT NOT NULL DEFAULT '[]',
  unknownJson TEXT NOT NULL DEFAULT '[]',
  resumeId TEXT,
  completedAt TEXT
);
CREATE INDEX application_sessions_job ON application_sessions(jobId,startedAt);
