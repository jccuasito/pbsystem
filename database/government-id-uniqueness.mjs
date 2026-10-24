// Fixed SQL expressions only; no request values are interpolated into these definitions.
export const typeKeySql = `CASE LOWER(TRIM(CONVERT(GovernmentType USING utf8mb4) COLLATE utf8mb4_bin))
  WHEN 'philsys' THEN 'philsys / national id' WHEN 'national id' THEN 'philsys / national id'
  WHEN 'philid' THEN 'philsys / national id' WHEN 'pcn' THEN 'philsys / national id'
  WHEN 'drivers license' THEN 'driver''s license' WHEN 'driver’s license' THEN 'driver''s license'
  WHEN 'driving license' THEN 'driver''s license' WHEN 'lto' THEN 'driver''s license'
  ELSE LOWER(TRIM(CONVERT(GovernmentType USING utf8mb4) COLLATE utf8mb4_bin)) END`
const compactSql = `UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CONVERT(GovernmentNumber USING utf8mb4) COLLATE utf8mb4_bin,'-',''),' ',''),CONVERT(CHAR(9) USING utf8mb4) COLLATE utf8mb4_bin,''),CONVERT(CHAR(10) USING utf8mb4) COLLATE utf8mb4_bin,''),CONVERT(CHAR(13) USING utf8mb4) COLLATE utf8mb4_bin,''))`
export const numberKeySql = `CASE WHEN LOWER(TRIM(CONVERT(GovernmentType USING utf8mb4) COLLATE utf8mb4_bin))='tin' THEN LEFT(${compactSql},9) ELSE ${compactSql} END`
export const identityColumns = {
  GovernmentTypeKey: `VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin GENERATED ALWAYS AS (${typeKeySql}) STORED`,
  GovernmentNumberKey: `VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin GENERATED ALWAYS AS (${numberKeySql}) STORED`,
  AttachmentSHA256: 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL',
}
