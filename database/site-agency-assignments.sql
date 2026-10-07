-- A site may be served by more than one agency. Run before deploying the
-- Organization > Sites and Site Rates agency-scoped forms.
CREATE TABLE IF NOT EXISTS site_agency (
  SiteID INT(11) NOT NULL,
  AgencyID INT(11) NOT NULL,
  Status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  PRIMARY KEY (SiteID, AgencyID),
  KEY idx_site_agency_agency_status (AgencyID, Status, SiteID),
  CONSTRAINT fk_site_agency_site FOREIGN KEY (SiteID) REFERENCES site (SiteID)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_site_agency_agency FOREIGN KEY (AgencyID) REFERENCES agency (AgencyID)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Preserve every agency already linked to a site through a rate, including
-- sites with multiple agencies and historical inactive rate links.
INSERT IGNORE INTO site_agency (SiteID, AgencyID, Status)
SELECT DISTINCT sr.SiteID, ap.AgencyID, 'Active'
FROM site_rate sr
INNER JOIN payroll_rate pr ON pr.PayrollRateID = sr.PayrollRateID
INNER JOIN agency_position ap ON ap.AgencyPositionID = pr.AgencyPositionID;
