-- One-time shift type migration: old values are retained temporarily, converted,
-- then the final operational type set is enforced.
ALTER TABLE shift_code
  MODIFY COLUMN ShiftType ENUM('Day', 'Night', 'Split', 'Flexible', 'DS', 'NS', 'MS', 'SS') NOT NULL DEFAULT 'DS';

UPDATE shift_code
SET ShiftType = CASE ShiftType
  WHEN 'Day' THEN 'DS'
  WHEN 'Night' THEN 'NS'
  WHEN 'Split' THEN 'SS'
  ELSE ShiftType
END;

ALTER TABLE shift_code
  MODIFY COLUMN ShiftType ENUM('DS', 'NS', 'MS', 'SS', 'Flexible') NOT NULL DEFAULT 'DS';
