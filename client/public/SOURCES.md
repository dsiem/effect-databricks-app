Map basemap: OpenStreetMap contributors, https://www.openstreetmap.org/copyright

UI icons: selected Lucide 0.468.0 SVGs, rendered as Foldkit VNodes.
Source: https://github.com/lucide-icons/lucide/tree/0.468.0/icons
License: lucide-LICENSE.txt (included with the application).
Regenerate with: node scripts/generate-icons.mjs

Ingestion ZIP-area labels: Census 2020 ZIP Code Tabulation Areas distributed by
NYC Department of City Planning / NYC Open Data.
https://data.cityofnewyork.us/City-Government/ZIP-Code-Tabulation-Areas/35j5-n34v
Pinned in jobs/nyc-zcta.jsonl on 2026-11-15 with full geometry precision.
Regenerate with npm run data:boundaries. These areas approximate ZIP geography;
they do not identify recorded postal addresses or historical 2016 boundaries.
