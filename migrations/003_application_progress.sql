-- Replace the fixed CHECK with an extensible status lookup, preserving IDs/FKs.
CREATE TABLE opportunity_statuses (name TEXT PRIMARY KEY);
INSERT INTO opportunity_statuses VALUES ('NEW'),('SAVED'),('OPENED'),('IGNORED'),('APPLIED'),('INTERVIEW'),('REJECTED'),('OFFER'),('WITHDRAWN');
CREATE TABLE opportunities_v02 (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, companyOrClient TEXT NOT NULL,
 description TEXT NOT NULL, location TEXT NOT NULL, remoteType TEXT NOT NULL, employmentType TEXT NOT NULL,
 canonicalUrl TEXT NOT NULL UNIQUE, postedAt TEXT, updatedAt TEXT, dateKind TEXT,
 firstSeenAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL, discoveredAt TEXT NOT NULL,
 experienceMin REAL, experienceMax REAL, budgetMin REAL, budgetMax REAL, currency TEXT, budgetUnit TEXT,
 status TEXT NOT NULL DEFAULT 'NEW' REFERENCES opportunity_statuses(name), closed INTEGER NOT NULL DEFAULT 0,
 employerJobId TEXT, authority TEXT, appliedAt TEXT, interviewAt TEXT, statusUpdatedAt TEXT
);
INSERT INTO opportunities_v02 (id,type,title,companyOrClient,description,location,remoteType,employmentType,canonicalUrl,postedAt,updatedAt,dateKind,firstSeenAt,lastSeenAt,discoveredAt,experienceMin,experienceMax,budgetMin,budgetMax,currency,budgetUnit,status,closed,employerJobId,authority)
 SELECT id,type,title,companyOrClient,description,location,remoteType,employmentType,canonicalUrl,postedAt,updatedAt,dateKind,firstSeenAt,lastSeenAt,discoveredAt,experienceMin,experienceMax,budgetMin,budgetMax,currency,budgetUnit,status,closed,employerJobId,authority FROM opportunities;
DROP TABLE opportunities;
ALTER TABLE opportunities_v02 RENAME TO opportunities;
CREATE INDEX opportunity_company_title ON opportunities(companyOrClient,title);
CREATE TABLE opportunity_status_events (
 id INTEGER PRIMARY KEY, opportunityId TEXT NOT NULL REFERENCES opportunities(id),
 fromStatus TEXT NOT NULL, toStatus TEXT NOT NULL, changedAt TEXT NOT NULL
);
