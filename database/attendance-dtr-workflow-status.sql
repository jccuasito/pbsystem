-- DTR workflow states. Existing Draft/Submitted/Approved values remain valid.
ALTER TABLE attendance_dtr
  MODIFY COLUMN Status ENUM(
    'Draft',
    'Submitted',
    'Approved',
    'Computed to Payroll',
    'Computed to Billing',
    'Computed to Both',
    'Locked'
  ) NOT NULL DEFAULT 'Draft';
