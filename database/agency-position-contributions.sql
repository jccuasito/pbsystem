-- One contribution schedule applies to an agency position across its sites.
-- SiteRateID remains as historical metadata on existing plans.
-- Use scripts/apply-agency-position-contributions.mjs to validate and backfill
-- existing plans before making AgencyPositionID NOT NULL.
ALTER TABLE agency_contribution_plan
  ADD COLUMN AgencyPositionID INT NULL AFTER AgencyID,
  ADD KEY idx_contribution_agency_position (AgencyPositionID, DeductionTypeID, Status, EffectiveStartDate),
  ADD CONSTRAINT fk_contribution_agency_position
    FOREIGN KEY (AgencyPositionID) REFERENCES agency_position(AgencyPositionID);
