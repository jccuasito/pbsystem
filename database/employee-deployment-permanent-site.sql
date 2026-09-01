-- Site-level permanent assignment.
-- Existing normal deployments are permanent; the DTR-only technical rows stay cutoff-only.
ALTER TABLE employee_deployment
  ADD COLUMN IsPermanentSite TINYINT(1) NOT NULL DEFAULT 1 AFTER DeploymentType,
  ADD KEY idx_employee_deployment_permanent_site (SiteID, IsPermanentSite, StartDate, EndDate);

UPDATE employee_deployment
SET IsPermanentSite = 0
WHERE Remarks LIKE 'Created from DTR attendance assignment';
