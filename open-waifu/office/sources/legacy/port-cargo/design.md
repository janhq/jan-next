# Bluehaven Port cargo flow and handling efficiency

## Layout and workflow

365 days and 2,190 simulated handling records: throughput swings, inbound and outbound mix, routes and handling efficiency. Five worksheets.

Call office_template to prepare the native working copy and the reference inputs. Use the official office-docx or office-xlsx skill and the installed Python to change the document, data and charts; recalculate the Excel file with the official LibreOffice Kit and render the final file, check each page, then deliver it with present.

Base workflow: office-xlsx. Business methods: dataset-health-audit and data-viz-gen. The port name and all data are simulated. inputs/port.json holds 365 days and 2,190 handling records; one record is one inbound unloading or outbound loading operation. Cargo tonnes and TEU container counts are tracked separately, and handled volume is counted per operation. All raw records are kept, and the Daily Summary and Operation Detail sheets preview the first 39 rows. Eight native charts reference calculated cells, and the summary and efficiency figures are derived by formulas. checks.json is computed independently from the raw JSON. When the date range changes, update the script dates, formula bounds, chart axis ranges and check values together.
