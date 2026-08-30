-- One saved batch baseline per employee/cutoff.
-- Already applied to the local database; keep this migration for other environments.
ALTER TABLE attendance_dtr_employee
  ADD COLUMN DefaultShiftCodeID INT NULL AFTER AttendanceType,
  ADD KEY idx_dtr_employee_default_shift (DefaultShiftCodeID),
  ADD CONSTRAINT fk_dtr_employee_default_shift FOREIGN KEY (DefaultShiftCodeID)
    REFERENCES shift_code(ShiftCodeID) ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE attendance_dtr_employee de
SET de.DefaultShiftCodeID = (
  SELECT at.ShiftCodeID
  FROM attendance at
  WHERE at.BatchID = de.BatchID AND at.EmployeeID = de.EmployeeID
    AND at.ShiftCodeID IS NOT NULL
    AND at.AttendanceStatus NOT IN ('Absent', 'Rest Day', 'On-Leave', 'Reliever')
  GROUP BY at.ShiftCodeID
  ORDER BY COUNT(*) DESC, at.ShiftCodeID
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM attendance at
  WHERE at.BatchID = de.BatchID AND at.EmployeeID = de.EmployeeID
    AND at.ShiftCodeID IS NOT NULL
    AND at.AttendanceStatus NOT IN ('Absent', 'Rest Day', 'On-Leave', 'Reliever')
);
