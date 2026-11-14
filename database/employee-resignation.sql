-- Inactive is retained as the stored availability flag for existing integrations.
-- The UI labels it Resigned. Do not infer dates for previously Inactive employees.
ALTER TABLE employee ADD COLUMN IF NOT EXISTS ResignationDate DATE NULL AFTER Status;
