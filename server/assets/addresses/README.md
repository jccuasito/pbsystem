# Philippine address reference

`philippines.json` is a locally stored, reduced hierarchy derived from the MIT-licensed
[barangay repository](https://github.com/bendlikeabamboo/barangay). Its source URL,
pinned Git revision, retrieval timestamp and the [official PSA PSGC reference](https://psa.gov.ph/classification/psgc/index)
are included in the snapshot. The upstream license is preserved in `LICENSE.txt`.

This snapshot contains 18 regions, 82 provinces plus the Special Geographic Area
(83 province-level groups), 1,643 cities/municipalities and 42,010 barangays.
Manila submunicipality barangays are associated with their city. NCR and independent
cities use their actual regional parent rather than an invented province.

The authenticated application endpoint filters this local reference; employee
names, addresses and other personal data are never sent to the upstream provider.
PSA's direct September 2026 Excel download was unavailable to the downloader, and
the PSGC Cloud bulk response was incomplete/outdated for this import; neither was
silently used as the source of this snapshot.

To refresh deliberately, run `node scripts/update-philippine-addresses.mjs`, review
the snapshot diff/source revision, run the address tests, regenerate the code map,
and rebuild. The importer validates completeness, unique codes and parent links
before replacing the file. It downloads JSON/license data only; it does not install
or execute upstream code. Geographic reference updates do not rewrite saved employee
address text. Postal codes are entered manually and are not inferred from PSGC codes.
