CREATE TABLE IF NOT EXISTS attendance_dtr_employee (
  BatchID INT NOT NULL,
  EmployeeID INT NOT NULL,
  DeploymentID INT NOT NULL,
  CreatedBy INT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (BatchID, EmployeeID),
  KEY idx_dtr_employee_deployment (DeploymentID),
  CONSTRAINT fk_dtr_employee_batch FOREIGN KEY (BatchID) REFERENCES attendance_dtr(BatchID) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_dtr_employee_employee FOREIGN KEY (EmployeeID) REFERENCES employee(EmployeeID) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_dtr_employee_deployment FOREIGN KEY (DeploymentID) REFERENCES employee_deployment(DeploymentID) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_dtr_employee_createdby FOREIGN KEY (CreatedBy) REFERENCES user(UserID) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO attendance_dtr_employee (BatchID, EmployeeID, DeploymentID, CreatedBy)
SELECT BatchID, EmployeeID, DeploymentID, CreatedBy
FROM attendance
WHERE BatchID IS NOT NULL;
