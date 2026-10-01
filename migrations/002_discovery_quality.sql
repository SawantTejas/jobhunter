ALTER TABLE opportunities ADD COLUMN employerJobId TEXT;
ALTER TABLE opportunities ADD COLUMN authority TEXT;
ALTER TABLE source_runs ADD COLUMN detailsJson TEXT;
CREATE INDEX source_reference_opportunity ON opportunity_sources(opportunityId);
CREATE TABLE discovery_queries (id TEXT PRIMARY KEY, domain TEXT NOT NULL, query TEXT NOT NULL, searchUrl TEXT NOT NULL, createdAt TEXT NOT NULL);
