-- Run the scoped installer first; it preserves each agency's DTR, rate, shift,
-- deployment, account, policy and holiday references while separating site records.
-- node --env-file=.env scripts/apply-independent-agency-sites.mjs --site-id=<explicit-site-id>
-- Add --restore-site-id=<same-id> only when restoration is requested.
-- The installer adds this constraint only when no shared legacy sites remain:
ALTER TABLE site_agency ADD UNIQUE KEY uq_site_single_agency (SiteID);
