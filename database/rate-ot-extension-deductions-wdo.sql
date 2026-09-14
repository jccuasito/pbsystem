-- Add configurable rates without changing existing amounts or DTR snapshots.
-- Run once before deploying the updated rates API/forms.
-- LateDeduction and UndertimeDeduction are PHP per hour (minutes / 60).
-- Zero means unconfigured; no rates are inferred or copied from existing fields.
ALTER TABLE payroll_rate
  ADD COLUMN OTExtRate DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER OTRate,
  ADD COLUMN RestDayOTRate DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER RestDayRate,
  ADD COLUMN LateDeduction DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER LegalHolidayOTRate,
  ADD COLUMN UndertimeDeduction DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER LateDeduction;

ALTER TABLE billing_rate
  ADD COLUMN OTExtRate DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER OTRate,
  ADD COLUMN RestDayOTRate DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER RestDayRate,
  ADD COLUMN LateDeduction DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER LegalHolidayOTRate,
  ADD COLUMN UndertimeDeduction DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER LateDeduction;
