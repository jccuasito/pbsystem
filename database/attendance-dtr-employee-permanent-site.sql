-- Preserve the employee's site-assignment state for this specific DTR cutoff.
-- The live employee_deployment value can change after a transfer; this snapshot must not.
ALTER TABLE attendance_dtr_employee
  ADD COLUMN IsPermanentSite TINYINT(1) NOT NULL DEFAULT 0 AFTER AttendanceType,
  ADD KEY idx_dtr_employee_permanent_site (BatchID, IsPermanentSite);

-- One-time best-effort backfill. Subsequent DTR writes save their own cutoff snapshot.
UPDATE attendance_dtr_employee de
INNER JOIN employee_deployment ed ON ed.DeploymentID = de.DeploymentID
SET de.IsPermanentSite = ed.IsPermanentSite;
