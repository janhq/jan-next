# Annual business and customer analysis: layout and usage notes

Business method: saas-metrics-coach. Base authoring: office-xlsx.

The six worksheets are Overview, Growth Forecast, Growth Quality, Retention, Monthly Data and Cohort Data. The workbook has 11 native charts: 365 points of daily new MRR with a 7-day average, revenue by plan, MRR movement, a cohort retention heat map and three forecast scenarios (Cautious, Base, Ambitious). Native formulas link inputs to metrics.

The layout uses a plain white background, dark navy headings and teal, blue and terracotta chart colors. Each sheet is organized as metrics, charts, data detail and calculation source. The first sheet shows the annual metrics, daily swings and quarterly detail together. Calculation sources sit below the presentation area of each sheet, long tables continue row by row, and the tabs at the bottom switch between worksheets.

Clearcloud Software and all business figures are simulated. Daily new MRR is split from the monthly totals using weekday, campaign and month-end weights, so each month still sums to its monthly total. Amounts in the presentation area are in USD 10k; the data sheets are in USD. When reusing the workbook, replace the inputs and business assumptions for the current task, check the currency units and the MRR and customer reconciliations and scenario results, then recalculate and check the preview.

The user browses the example cards and chooses "Use this example" at the bottom of the preview; the host then binds the current revision of `annual-business`. Prepare the native XLSX and this note with office_template, then build the file for the current task with the Office workflow.
