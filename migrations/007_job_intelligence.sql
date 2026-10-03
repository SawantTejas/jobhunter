ALTER TABLE opportunities ADD COLUMN requirementsJson TEXT;
ALTER TABLE opportunities ADD COLUMN partial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opportunities ADD COLUMN availability TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(availability IN ('ACTIVE','POSSIBLY_CLOSED','CLOSED','STALE','INACCESSIBLE'));
ALTER TABLE opportunities ADD COLUMN availabilityReason TEXT;
ALTER TABLE opportunities ADD COLUMN availabilityCheckedAt TEXT;
UPDATE opportunities SET availability='CLOSED',availabilityReason='Source reported closed' WHERE closed=1;
CREATE TABLE availability_observations (
  id INTEGER PRIMARY KEY,
  opportunityId TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  observedAt TEXT NOT NULL,
  evidence TEXT NOT NULL CHECK(evidence IN ('ACTIVE','CLOSED','NOT_FOUND','INACCESSIBLE')),
  url TEXT NOT NULL,
  UNIQUE(opportunityId,observedAt,evidence)
);
CREATE INDEX availability_history ON availability_observations(opportunityId,observedAt);
