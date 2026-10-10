-- Scope each contribution to one site's agency position/rate assignment.
-- Existing agency-wide plans must be reviewed before enabling them on a site.
ALTER TABLE agency_contribution_plan
  ADD COLUMN SiteRateID INT NULL AFTER AgencyID,
  ADD KEY idx_agency_contribution_site_rate (SiteRateID, Status, DeductOn, EffectiveStartDate),
  ADD CONSTRAINT fk_agency_contribution_site_rate
    FOREIGN KEY (SiteRateID) REFERENCES site_rate(SiteRateID);
