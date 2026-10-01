-- Recover genuine recorded dates cleared by V0.2 status resets. Never invent dates.
UPDATE opportunities SET appliedAt=(SELECT MIN(changedAt) FROM opportunity_status_events e WHERE e.opportunityId=opportunities.id AND e.toStatus='APPLIED') WHERE appliedAt IS NULL;
UPDATE opportunities SET interviewAt=(SELECT MIN(changedAt) FROM opportunity_status_events e WHERE e.opportunityId=opportunities.id AND e.toStatus='INTERVIEW') WHERE interviewAt IS NULL;
CREATE INDEX opportunity_events_by_job ON opportunity_status_events(opportunityId,changedAt);
