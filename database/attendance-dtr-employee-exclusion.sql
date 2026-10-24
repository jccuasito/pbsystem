CREATE TABLE IF NOT EXISTS attendance_dtr_employee_exclusion (
  BatchID INT NOT NULL,
  EmployeeID INT NOT NULL,
  RemovedBy INT NULL,
  RemovedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (BatchID, EmployeeID),
  CONSTRAINT fk_dtr_exclusion_batch FOREIGN KEY (BatchID) REFERENCES attendance_dtr(BatchID) ON DELETE CASCADE,
  CONSTRAINT fk_dtr_exclusion_employee FOREIGN KEY (EmployeeID) REFERENCES employee(EmployeeID) ON DELETE CASCADE,
  CONSTRAINT fk_dtr_exclusion_actor FOREIGN KEY (RemovedBy) REFERENCES `user`(UserID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
