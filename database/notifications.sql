CREATE TABLE IF NOT EXISTS staff_notification_read (
  UserID INT NOT NULL,
  NotificationKey VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Revision CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ReadAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (UserID, NotificationKey),
  CONSTRAINT fk_staff_notice_user FOREIGN KEY (UserID) REFERENCES `user`(UserID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS employee_notification_read (
  AccountID INT NOT NULL,
  NotificationKey VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Revision CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ReadAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (AccountID, NotificationKey),
  CONSTRAINT fk_employee_notice_account FOREIGN KEY (AccountID) REFERENCES employee_portal_account(AccountID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
