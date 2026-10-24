CREATE TABLE IF NOT EXISTS employee_position_change (
  PositionChangeID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  EmployeeID INT NOT NULL,
  OldAgencyPositionID INT NOT NULL,
  NewAgencyPositionID INT NOT NULL,
  EffectiveDate DATE NOT NULL,
  Reason VARCHAR(500) NOT NULL,
  OldDeploymentID INT NULL,
  NewDeploymentID INT NULL,
  CreatedBy INT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_position_date (EmployeeID, EffectiveDate),
  CONSTRAINT fk_position_change_employee FOREIGN KEY (EmployeeID) REFERENCES employee(EmployeeID) ON DELETE CASCADE,
  CONSTRAINT fk_position_change_old_position FOREIGN KEY (OldAgencyPositionID) REFERENCES agency_position(AgencyPositionID),
  CONSTRAINT fk_position_change_new_position FOREIGN KEY (NewAgencyPositionID) REFERENCES agency_position(AgencyPositionID),
  CONSTRAINT fk_position_change_old_deployment FOREIGN KEY (OldDeploymentID) REFERENCES employee_deployment(DeploymentID) ON DELETE SET NULL,
  CONSTRAINT fk_position_change_new_deployment FOREIGN KEY (NewDeploymentID) REFERENCES employee_deployment(DeploymentID) ON DELETE SET NULL,
  CONSTRAINT fk_position_change_actor FOREIGN KEY (CreatedBy) REFERENCES `user`(UserID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
