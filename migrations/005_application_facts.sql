CREATE TABLE application_facts (
 opportunityId TEXT PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,
 recordedAt TEXT NOT NULL, matchScore REAL, postedAt TEXT, dateKind TEXT,
 skillsJson TEXT NOT NULL
);
