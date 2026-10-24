-- Account names remain independent; each site/agency coverage chooses its account.
ALTER TABLE site_agency
  ADD COLUMN SiteAccountID INT NULL,
  ADD KEY idx_site_agency_account (SiteAccountID),
  ADD CONSTRAINT fk_site_agency_account FOREIGN KEY (SiteAccountID) REFERENCES site_account (SiteAccountID)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve previous selections once. No sites, agencies, or payrolls are duplicated.
UPDATE site_agency link INNER JOIN site s ON s.SiteID=link.SiteID
SET link.SiteAccountID=s.SiteAccountID;
