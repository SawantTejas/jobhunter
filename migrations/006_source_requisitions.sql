ALTER TABLE opportunity_sources ADD COLUMN requisitionId TEXT;
UPDATE opportunity_sources SET requisitionId=COALESCE(
 NULLIF(json_extract(rawJson,'$.employerJobId'),''),
 NULLIF(json_extract(rawJson,'$.refNumber'),''),
 NULLIF(json_extract(rawJson,'$.requisition_id'),''))
WHERE json_valid(rawJson);
CREATE INDEX source_requisition ON opportunity_sources(opportunityId,requisitionId);
