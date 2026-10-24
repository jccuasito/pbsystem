-- Existing ID types and numbers are retained. Run the idempotent installer
-- scripts/apply-government-id-attachments.mjs on existing databases.
ALTER TABLE government
  MODIFY COLUMN GovernmentType VARCHAR(80) NOT NULL,
  ADD COLUMN AttachmentPath VARCHAR(80) NULL,
  ADD COLUMN AttachmentName VARCHAR(255) NULL,
  ADD COLUMN AttachmentMimeType VARCHAR(60) NULL,
  ADD COLUMN AttachmentSize INT UNSIGNED NULL;
