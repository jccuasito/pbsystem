-- Preserve existing status values and records. Only add the Finalized state.
ALTER TABLE billing MODIFY COLUMN Status
  ENUM('Draft','For Approval','Approved','Sent','Paid','Finalized') DEFAULT 'Draft';
