-- Store the official logo image directly with each agency and site.
-- Run once on an existing pbsystem database.

ALTER TABLE agency
  ADD COLUMN LogoData MEDIUMBLOB NULL AFTER AgencyContact,
  ADD COLUMN LogoMimeType VARCHAR(50) NULL AFTER LogoData;

ALTER TABLE site
  ADD COLUMN LogoData MEDIUMBLOB NULL AFTER SiteAddress,
  ADD COLUMN LogoMimeType VARCHAR(50) NULL AFTER LogoData;
