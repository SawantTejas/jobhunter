CREATE TABLE opportunities (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, companyOrClient TEXT NOT NULL,
 description TEXT NOT NULL, location TEXT NOT NULL, remoteType TEXT NOT NULL, employmentType TEXT NOT NULL,
 canonicalUrl TEXT NOT NULL UNIQUE, postedAt TEXT, updatedAt TEXT, dateKind TEXT,
 firstSeenAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL, discoveredAt TEXT NOT NULL,
 experienceMin REAL, experienceMax REAL, budgetMin REAL, budgetMax REAL, currency TEXT, budgetUnit TEXT,
 status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','SAVED','OPENED','IGNORED','APPLIED')), closed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX opportunity_company_title ON opportunities(companyOrClient,title);
CREATE TABLE opportunity_sources (
 source TEXT NOT NULL, externalId TEXT NOT NULL, opportunityId TEXT NOT NULL REFERENCES opportunities(id),
 sourceUrl TEXT NOT NULL, rawJson TEXT NOT NULL, firstSeenAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL,
 PRIMARY KEY(source,externalId)
);
CREATE TABLE source_registry (id TEXT PRIMARY KEY, adapter TEXT NOT NULL, company TEXT NOT NULL, board TEXT NOT NULL, enabled INTEGER NOT NULL);
CREATE TABLE skills (name TEXT PRIMARY KEY);
CREATE TABLE opportunity_skills (opportunityId TEXT REFERENCES opportunities(id), skill TEXT REFERENCES skills(name), PRIMARY KEY(opportunityId,skill));
CREATE TABLE candidate_profile (id INTEGER PRIMARY KEY CHECK(id=1), profileJson TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE TABLE search_runs (id TEXT PRIMARY KEY, startedAt TEXT NOT NULL, finishedAt TEXT, summaryJson TEXT);
CREATE TABLE source_runs (runId TEXT REFERENCES search_runs(id), source TEXT NOT NULL, success INTEGER NOT NULL, rawCount INTEGER NOT NULL, error TEXT);
CREATE TABLE ignored_opportunities (opportunityId TEXT PRIMARY KEY REFERENCES opportunities(id), reason TEXT, ignoredAt TEXT NOT NULL);
