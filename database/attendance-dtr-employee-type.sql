-- DTR-specific assignment type. This keeps a cutoff's Regular/Reliever value
-- independent from the employee's longer-lived deployment history.
ALTER TABLE attendance_dtr_employee
  ADD COLUMN AttendanceType ENUM('Regular', 'Reliever') NOT NULL DEFAULT 'Regular' AFTER DeploymentID;

-- Preserve the classification of existing DTR enrollments on first migration.
UPDATE attendance_dtr_employee de
INNER JOIN employee_deployment ed ON ed.DeploymentID = de.DeploymentID
SET de.AttendanceType = ed.DeploymentType;
