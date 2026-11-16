# Sources and attribution

The application uses the following data and assets:

- Taxi trips: January and February 2016 NYC yellow taxi CSVs, distributed in
  Databricks sample volumes under
  `/Volumes/samples/databricks/datasets/nyctaxi/tripdata/yellow/`.
  The [NYC Taxi and Limousine Commission](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page)
  publishes the trip records and field definitions.
- Map tiles and map data: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
- UI icons: [Lucide 0.468.0 SVGs](https://github.com/lucide-icons/lucide/tree/0.468.0/icons),
  rendered as Foldkit VNodes. [lucide-LICENSE.txt](lucide-LICENSE.txt) contains the license.
  `node scripts/generate-icons.mjs` regenerates the icon module from the repository root.
- ZIP labels: Census 2020 ZIP Code Tabulation Areas from
  [NYC Open Data](https://data.cityofnewyork.us/City-Government/ZIP-Code-Tabulation-Areas/35j5-n34v),
  pinned in `jobs/nyc-zcta.jsonl`. `npm run data:boundaries` regenerates that file
  from the repository root. The areas approximate ZIP geography. They do not
  represent recorded postal addresses or historical 2016 boundaries.
