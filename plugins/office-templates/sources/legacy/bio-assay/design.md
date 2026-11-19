# Fluorescent enzyme activity screen and batch QC

## Layout and workflow

3 batches and 288 simulated wells: dose response, technical replicate CV, cross-batch statistics and three plate heat maps. Four worksheets.

Call office_template to prepare the native working copy and the reference inputs. Use the official office-docx or office-xlsx skill and the installed Python to change the document, data and charts; recalculate the Excel file with the official LibreOffice Kit and render the final file, check each page, then deliver it with present.

Base workflow: office-xlsx. Business methods: dataset-health-audit and data-viz-gen. inputs/bio.json holds 3 independent simulated batches of 96 wells each, with 8 technical replicates per dose. Readings are first normalized to each plate's blank and solvent control, then the sample SD of the three batch means is computed (n = 3); technical replicates are used to judge within-plate stability. All 288 wells are kept, and one simulated deviation shows up in the CV and heat map. The 15% CV is an adjustable demo threshold. The 50% interval formula checks the curve direction first and asks for a segment-by-segment review when the response rebounds. The Raw Readings sheet previews the first 39 rows; the 4 native charts and the 3-plate conditional-format heat maps update with the data. Method sources are listed in the workbook.
