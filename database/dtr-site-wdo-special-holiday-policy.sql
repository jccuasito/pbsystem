-- Site-specific DTR controls for automatic WDO, Sunday WDO OT, and
-- applicability of Special Holidays. Legal Holidays remain global.
ALTER TABLE site_policy
  ADD COLUMN AutoWDOEnabled TINYINT(1) NOT NULL DEFAULT 1 AFTER RelieverPositionOverrideEnabled,
  ADD COLUMN SundayWDOOTEnabled TINYINT(1) NOT NULL DEFAULT 0 AFTER AutoWDOEnabled;

CREATE TABLE site_special_holiday (
  SiteSpecialHolidayID INT NOT NULL AUTO_INCREMENT,
  SiteID INT NOT NULL,
  HolidayID INT NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (SiteSpecialHolidayID),
  UNIQUE KEY uq_site_special_holiday (SiteID, HolidayID),
  KEY idx_site_special_holiday_holiday (HolidayID),
  CONSTRAINT fk_site_special_holiday_site FOREIGN KEY (SiteID) REFERENCES site (SiteID) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_site_special_holiday_holiday FOREIGN KEY (HolidayID) REFERENCES holiday (HolidayID) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Preserve the previous behavior for Special Holidays that already exist.
INSERT IGNORE INTO site_special_holiday (SiteID, HolidayID)
SELECT s.SiteID, h.HolidayID
FROM site s
CROSS JOIN holiday h
WHERE s.Status = 'Active' AND h.Status = 'Active' AND h.HolidayType = 'Special';
