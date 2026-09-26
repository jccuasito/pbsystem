-- Site-specific rate ownership.
-- Existing records stay usable as legacy client-wide fallback rows until they
-- are assigned to a site from the Site Rates screen.

ALTER TABLE site
  ADD COLUMN RegionID INT NULL AFTER ClientID,
  ADD KEY idx_site_region (RegionID),
  ADD CONSTRAINT fk_site_region
    FOREIGN KEY (RegionID) REFERENCES region (RegionID)
    ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE site s
INNER JOIN client c ON c.ClientID = s.ClientID
SET s.RegionID = c.RegionID
WHERE s.RegionID IS NULL;

ALTER TABLE client_rate
  ADD COLUMN SiteID INT NULL AFTER ClientID,
  ADD KEY idx_client_rate_site (SiteID),
  ADD CONSTRAINT fk_client_rate_site
    FOREIGN KEY (SiteID) REFERENCES site (SiteID)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- An existing rate can be assigned automatically when its client has only one
-- site. Ambiguous multi-site records remain NULL and are clearly marked as
-- legacy in the UI instead of being guessed or copied silently.
UPDATE client_rate cr
INNER JOIN (
  SELECT ClientID, MIN(SiteID) AS SiteID
  FROM site
  GROUP BY ClientID
  HAVING COUNT(*) = 1
) only_site ON only_site.ClientID = cr.ClientID
SET cr.SiteID = only_site.SiteID
WHERE cr.SiteID IS NULL;
