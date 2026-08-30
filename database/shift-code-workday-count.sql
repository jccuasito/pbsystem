-- A shift can represent more than one payable DTR day. Straight 24-hour
-- duties start at two, while every other existing shift remains one day.
ALTER TABLE shift_code
  ADD COLUMN WorkdayCount TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER RegularOTCap;

UPDATE shift_code
SET WorkdayCount = 2
WHERE ShiftType = 'SS';

-- Store the shift's day equivalent on the attendance record as a snapshot so
-- editing a shift code later does not change an already-prepared DTR/payroll.
ALTER TABLE attendance
  ADD COLUMN WorkdayCount TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER ShiftCodeID;

UPDATE attendance at
LEFT JOIN shift_code sc ON sc.ShiftCodeID = at.ShiftCodeID
SET at.WorkdayCount = COALESCE(sc.WorkdayCount, 1);
