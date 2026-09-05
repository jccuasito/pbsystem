-- Site-specific exception: daytime shifts only earn Night Differential when
-- the site's DTR policy explicitly enables it.  Night and other shift types
-- continue to follow the Night Differential settings on their shift code.
ALTER TABLE site_policy
  ADD COLUMN DayShiftNDEnabled TINYINT(1) NOT NULL DEFAULT 0 AFTER NDEnabled;
