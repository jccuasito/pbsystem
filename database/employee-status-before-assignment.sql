-- HR may encode a dated status before a site or DTR assignment is known.
-- NULL means awaiting assignment; no placeholder deployment is created.
-- Existing deployment FK and employee/date/DTR uniqueness remain intact.
ALTER TABLE attendance MODIFY COLUMN DeploymentID INT NULL;
