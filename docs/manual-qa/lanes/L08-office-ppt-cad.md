# L08: Office, PPTX, CAD

## Summary

The Word and Excel buttons beside the composer, the gallery of seven English templates, preview paging, "Use this example", making DOCX, XLSX and PPTX files from chat and opening them in a real application, and the CAD Part Studio panel. Presentations and CAD come from two third-party plugins that this lane installs into its own scratch profile.

Needs: the seed, one real provider key for the `real` cases (the stub model cannot call tools), the Office template bundle that ships with the app (built by the L00 build), the network to install `dsh-ppt` 0.20.8 and `dsh-cad` 0.17.0 as in L07-10 and L07-12, and a word processor and a spreadsheet application (Word, Pages, Excel, Numbers or LibreOffice) to open the results. Port block 9480. Templates, in the order the gallery lists them: Word has Meeting minutes: launch preparation (4 pages), China freshly made coffee market report (7 pages), Xiaomi EV research report, Official notice: holiday service arrangements. Excel has Annual business and customer analysis (6 sheets, 20 preview pages), Port cargo flow and handling efficiency (5 pages), Fluorescent enzyme screen and batch QC (4 pages).

Provider key: the recipe's `unset` loop removes every key from the shell. Export exactly one real key before launch for the `real` cases (L08-11 to L08-16, L08-18, L08-23, L08-24, L08-27 and L08-29). Before the first send in a `stub` or `any` case, switch the picker to `qa-mock / mock-model`: the default model on a fresh home is `anthropic/claude-sonnet-5-5[1m]`.

| ID | Via | Steps | Expect | Sev |
|---|---|---|---|---|
| L08-01 | any | Open a new chat. Look beside the composer. | Two buttons, Word and Excel, each with a document or sheet icon and its label, both unpressed. No gallery shows. No raw keys such as `desktop-office.templates` | P1 |
| L08-02 | any | Click Word. Click it again. Click Excel. Click Word. | Word shows as pressed and a gallery opens below the composer card at the card's width. The second click closes it. Excel shows only the Excel examples. Switching mode clears any selected example. Only one of the two is pressed at a time | P1 |
| L08-03 | any | With Word on, read the gallery. Then with Excel on. | Word lists the four Word examples and Excel the three Excel examples above, each card with a thumbnail and its English title. The grid has three columns and scrolls inside itself. A card never shows another mode's example | P1 |
| L08-04 | any | Open the preview (eye icon) of all seven examples in turn and look at page 1 of each. | Every thumbnail and every preview page is English, readable, not blank and not cut off. Excel thumbnails start at the sheet header. No Chinese characters in titles, thumbnails or previews. The preview loads within 3 seconds | P0 |
| L08-05 | any | Open the Meeting minutes preview. Press Tab several times, then Escape. Open it again and click outside the dialog. | The dialog is modal, titled with the example, with a close button and focus inside. Tab cycles inside it. Escape and a click outside close it and focus returns to the eye icon that opened it | P2 |
| L08-06 | any | In the Coffee market preview (7 pages) press the right arrow, Next, Home and End, and click Previous. | Word examples show two pages side by side: "Pages 1-2 of 7", then 3-4, 5-6, and a final single page 7 centered at the same scale. Previous is disabled on page 1 and Next on the last. Home and End jump to the ends. Page captions read "Page n". The pages stay sharp at full window | P1 |
| L08-07 | any | In the Annual business preview click each sheet name in the top strip, then page with the arrows. | The strip lists the six sheets. Clicking one jumps to its first page and marks it pressed. Captions read "Overview - Page n" with the sheet name. The 20 pages page through in order and the strip follows the page | P1 |
| L08-08 | any | Click a card (not the eye). Click the small x on the chip that appears. | The card shows as selected and a tilted thumbnail chip appears at the composer with a x labelled "Remove example". The x deselects it and the card shows unselected. Selecting a second card moves the selection | P1 |
| L08-09 | any | Open a preview and press "Use this example". | The example is selected, the preview closes, the chip appears, and the button shows "Loading..." only while the request runs. Focus is not lost | P1 |
| L08-10 | stub | Select the Official notice example, type "Draft a notice about holiday hours" and send. Quit and relaunch, open the chat. | The sent message shows only what was typed. No internal text such as `selected_template_id` or "Office example selected" appears. The example shows as a row at the top of the chat that opens its preview, and it is still there after relaunch | P0 |
| L08-11 | real | Select Meeting minutes, paste fixture F1 below and send. | The agent loads the template, builds a new DOCX, and presents it as a delivery card with the file name and a native open control. The turn ends with a short summary, not the whole document pasted in chat | P0 |
| L08-12 | real | Open the DOCX from F1 with its Open control in Word or Pages. | It opens without a repair prompt. It keeps the example's page setup, fonts, headings and table style. All four action items appear with owner, due date and deliverable. No fact from the example (launch preparation) leaks in. It has no empty placeholder paragraph or bracketed filler | P0 |
| L08-13 | real | Select Official notice and send fixture F2. Open the result. | The letterhead names Northwind Traders Facilities Office, not a sample organization. Notice number NT-2026-14, divider, title, To and From lines, numbered sections, signature office, date, cc list and page numbers are all present and correct. Page layout matches the example preview | P0 |
| L08-14 | real | Select the coffee market example, send fixture F3, then repeat with Xiaomi EV and fixture F4. Open both results. | Each is a Word report with its chapter structure, charts that match the supplied numbers, and a source or notes section. A figure the fixture did not supply is marked as unsupported, not invented. Charts show axis labels and a legend. Opens without repair | P0 |
| L08-15 | real | Select Annual business, send fixture F5 and open the XLSX. Then select Fluorescent enzyme screen with F6 and Port cargo with F7. | Each opens in the spreadsheet application without repair. Cells hold native formulas, not pasted values: change one input and its totals and charts update. Charts are native charts. Sheet names and layout follow the example. Samples above the stated threshold are flagged | P0 |
| L08-16 | real | With Word on and no example selected, ask for a one-page project status memo. Do the same with Excel and a 12-row expense table. | A DOCX and an XLSX are produced and presented. Each opens and holds the content asked for. Without an example the agent uses the plain format, not a template's layout | P1 |
| L08-17 | stub | With Word on, switch the model to `qa-mock`, send "hello". Switch Word off and send again. | The stub answers in plain text with no crash and no file. The Word state is kept across the turn and Word off is respected on the next turn. No error toast | P2 |
| L08-18 | real | After L08-11, open Artifacts in the sidebar and filter by Documents, then Spreadsheets. Use Show in folder on a row. | The files from L08-11 to L08-15 are listed under the right filter with their chat title. Show in folder reveals the real file in Finder. A file deleted on disk shows as unavailable | P1 |
| L08-19 | any | Resize the window to 900 x 600 with the gallery open. Open a preview. | The gallery stays under the composer, scrolls inside itself, and no card is cut off. The preview dialog fits the window, its footer and Use button stay visible, and paging still works | P2 |
| L08-20 | any | Switch the language to Chinese. Look at the buttons, gallery and a preview. Switch back. | Word and Excel keep their names. The gallery heading, card labels, preview, paging and "Use this example" are Chinese with no English key. Example titles stay English. Switching back restores English with no leftover Chinese | P2 |
| L08-21 | any | Using only the keyboard: Tab to Word, press Space, Tab into the gallery, press Enter on a card, then open its preview and page with the arrows. | Word, each card, its eye button, the chip x and the dialog controls take focus in visual order with a visible ring. Space toggles Word. Every control has an accessible name ("Select example Meeting minutes..."). Nothing traps focus outside the dialog | P2 |
| L08-22 | any | Open More > Presentations after installing `dsh-ppt`. If a Presentations or PPT button shows beside Word and Excel, press it, then Word. | The Presentations page opens with its title and an empty state or the project list, no error. If the PPT button exists, pressing it turns Word and Excel off and the reverse, so only one mode is on | P1 |
| L08-23 | real | Ask for "a 6-slide deck on our launch plan, with an editable PPTX and a project bundle", answering any question the agent asks. Open the PPTX with its Open control in PowerPoint or Keynote. | The agent produces and presents a PPTX. It opens without repair, has 6 slides, readable text that fits its boxes, and consistent fonts. The deck appears on the Presentations page by name | P0 |
| L08-24 | real | On the Presentations page open that project. Edit a slide title, move a slide, press undo, save, quit and relaunch. | The edits show in the preview and survive relaunch. Undo restores the order and text. The status says saved. Rendering the PPTX again reflects the edits. No lost work | P0 |
| L08-25 | any | In the Presentations workbench find the update check at the bottom. | It states the installed version (0.20.8) and whether an update exists. Automatic installation is off by default, and nothing installs without a click. A failed check says so in plain words | P2 |
| L08-26 | any | After installing `dsh-cad`, open the CAD panel (right of the chat). Look at its tab strip. | A resident panel with tabs Part (Part Studio, selected), and a + menu offering Assembly and Drawing. A new document shows an empty viewport with a helpful empty state, not an error. The panel reopens after relaunch | P1 |
| L08-27 | real | Ask: "model a 100 x 60 x 5 plate with a 20 mm hole in the middle and R2 fillets on the four corners". | Tool cards for each step appear in the chat, and the Part tab builds the plate step by step: first the slab, then the hole, then the rounded corners. The final model has a visible hole and rounded corners, and the chat ends with a summary | P0 |
| L08-28 | any | In the viewport orbit with the mouse, zoom with the wheel, pan, click a ViewCube face, hover and click a face and an edge. | Orbit, zoom and pan are smooth. The ViewCube re-orients to the clicked side. A hover highlights the face or edge and clicking shows a measurement (area in mm2 or length in mm). No lag over one second | P1 |
| L08-29 | real | Ask the agent to "export plate.step", then save fixture F8 as `tetra.stl` in the project folder and ask it to open `tetra.stl`. | The STEP file is written only because it was asked for, and presented. The STL renders as a tetrahedron in the viewer with a one-line result in the chat. A missing path gives a plain error and no empty viewer | P1 |
| L08-30 | any | Switch the theme between light and dark with the model on screen. Quit and relaunch. | The viewport, grid, axes and ViewCube restyle live with no reload. After relaunch the panel restores the plate from the saved operations, and the document is listed under the folder button | P1 |

Fixtures. Paste each into the composer as written.

- F1: "Northwind Traders launch sync. Decision: ship on 12 December. Actions: Priya finalizes the pricing page by 3 December; Marcus runs the load test by 5 December; Lena writes the support runbook by 8 December; Omar sends the press embargo list by 9 December. Open question: who approves the refund policy."
- F2: "Facilities Office of Northwind Traders, notice NT-2026-14, to all staff: the office closes 24 and 25 December, has limited service 26 to 31 December, and reopens 2 January. Contact desk@northwind.example. Copy to Security and Reception."
- F3: "Brand A had 4,200 stores in 2024 with same-store sales down 3%. Brand B had 2,100 stores with up 1%. Brand C had 900 stores with up 5%. Write the market report for investors."
- F4: "Company X: 2025 revenue 120 bn, net margin 6%, 300,000 deliveries. Risks: price war and supply chain. Write the research report for a fund manager, focusing on margin."
- F5: "Monthly revenue in thousands for one year: 100, 104, 109, 113, 118, 123, 129, 134, 140, 145, 151, 158, with 2% monthly churn. Build the workbook."
- F6: "Eight samples read 120, 340, 90, 410, 150, 380, 95, 405 against a control of 100. Flag samples above 3 times the control."
- F7: "Berth A handled 1200, 1350, 1100, 1250, 1300 tonnes a day over five days; berth B 900, 800, 950, 870, 910; berth C 600, 650, 700, 640, 690. Compare efficiency."
- F8: The ASCII STL below.

```text
solid tetra
facet normal 0 0 -1
outer loop
vertex 0 0 0
vertex 0 10 0
vertex 10 0 0
endloop
endfacet
facet normal 0 -1 0
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 0 10
endloop
endfacet
facet normal -1 0 0
outer loop
vertex 0 0 0
vertex 0 0 10
vertex 0 10 0
endloop
endfacet
facet normal 1 1 1
outer loop
vertex 10 0 0
vertex 0 10 0
vertex 0 0 10
endloop
endfacet
endsolid tetra
```
