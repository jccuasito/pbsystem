CREATE TABLE IF NOT EXISTS system_runtime (
  RuntimeID TINYINT NOT NULL PRIMARY KEY,
  CacheEpoch CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
) ENGINE=InnoDB;
INSERT IGNORE INTO system_runtime(RuntimeID,CacheEpoch) VALUES (1,UUID());

CREATE TABLE IF NOT EXISTS payroll_job (
  JobID CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  RequestKey CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  BatchID INT NOT NULL,
  RequestedBy INT NOT NULL,
  ExpectedHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Status ENUM('Queued','Running','Succeeded','Failed','NeedsReview') NOT NULL DEFAULT 'Queued',
  ActiveBatchID INT GENERATED ALWAYS AS (CASE WHEN Status IN ('Queued','Running') THEN BatchID ELSE NULL END) STORED,
  RunToken CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  Attempts INT NOT NULL DEFAULT 0,
  ResultJson TEXT NULL,
  ErrorCode SMALLINT NULL,
  Message VARCHAR(300) NULL,
  CreatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  StartedAt DATETIME(6) NULL,
  FinishedAt DATETIME(6) NULL,
  UNIQUE KEY uq_payroll_job_request(RequestedBy,RequestKey),
  UNIQUE KEY uq_payroll_job_active_batch(ActiveBatchID),
  KEY ix_payroll_job_queue(Status,CreatedAt,JobID),
  KEY ix_payroll_job_owner(RequestedBy,CreatedAt),
  CONSTRAINT fk_payroll_job_batch FOREIGN KEY (BatchID) REFERENCES attendance_dtr(BatchID) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_job_actor FOREIGN KEY (RequestedBy) REFERENCES `user`(UserID) ON DELETE RESTRICT
) ENGINE=InnoDB;
