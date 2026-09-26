-- Region belongs to each physical site. Client remains the billing/customer account.
-- Run after database/site-specific-rates.sql so site.RegionID exists.
-- Preferred runner: node --env-file=.env scripts/apply-remove-client-region.mjs

START TRANSACTION;

-- Preserve legacy region data for old sites that have not yet been assigned directly.
UPDATE site s
INNER JOIN client c ON c.ClientID = s.ClientID
SET s.RegionID = c.RegionID
WHERE s.RegionID IS NULL
  AND c.RegionID IS NOT NULL;

COMMIT;

-- Abort before dropping the client column when any site still needs a region.
DELIMITER $$
DROP PROCEDURE IF EXISTS remove_client_region$$
CREATE PROCEDURE remove_client_region()
BEGIN
  IF EXISTS (SELECT 1 FROM site WHERE RegionID IS NULL) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Assign a region to every site before removing client.RegionID.';
  END IF;

  SET @client_region_fk = (
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'client'
      AND COLUMN_NAME = 'RegionID'
      AND REFERENCED_TABLE_NAME IS NOT NULL
    LIMIT 1
  );

  IF @client_region_fk IS NOT NULL THEN
    SET @drop_fk = CONCAT('ALTER TABLE client DROP FOREIGN KEY `', REPLACE(@client_region_fk, '`', '``'), '`');
    PREPARE drop_fk_statement FROM @drop_fk;
    EXECUTE drop_fk_statement;
    DEALLOCATE PREPARE drop_fk_statement;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'client'
      AND COLUMN_NAME = 'RegionID'
  ) THEN
    ALTER TABLE client DROP COLUMN RegionID;
  END IF;
END$$
DELIMITER ;

CALL remove_client_region();
DROP PROCEDURE remove_client_region;
