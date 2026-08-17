-- Recovery data reconstructed from the surviving attendance records and the
-- completed transfer that was present before employee_deployment was lost.
-- DeploymentID 1 is retained so attendance rows 1-15 remain linked.

INSERT INTO employee_deployment
  (DeploymentID, EmployeeID, ClientRateID, SiteID, SiteShiftID, DeploymentType, StartDate, EndDate, Remarks, CreatedBy)
VALUES
  (1, 3, 1, 1, 1, 'Regular', '2026-08-01', '2026-08-17', NULL, NULL),
  (2, 3, 2, 2, NULL, 'Regular', '2026-08-18', NULL, 'Sample', NULL)
ON DUPLICATE KEY UPDATE
  EmployeeID = VALUES(EmployeeID),
  ClientRateID = VALUES(ClientRateID),
  SiteID = VALUES(SiteID),
  SiteShiftID = VALUES(SiteShiftID),
  DeploymentType = VALUES(DeploymentType),
  StartDate = VALUES(StartDate),
  EndDate = VALUES(EndDate),
  Remarks = VALUES(Remarks);
