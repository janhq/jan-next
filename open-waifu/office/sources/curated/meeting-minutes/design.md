# Meeting minutes: launch preparation

This example is the authoritative template input for a finished DOCX of meeting minutes. The finished file was made with the built-in `meeting-recap` skill, the official `office-docx` skill, the installed Python and the official Kit, revised through content and layout feedback, and approved as usable on 2026-10-12.

The content draft comes from an official Lark "launch preparation alignment" demo; the finished file is a re-organized Word example, with the people, schedule and tasks translated into English. The installed resources contain the approved file and this note.

## Content structure

Meeting name and compact meeting details, main arrangements, discussion record organized by topic, one continuous action table, and follow-up. The five topics cover promotion and warm-up, scripts and demos, online showcase and materials, the product manual, and the experience area and schedule. The fifteen sample action items show how to organize task, deliverable standard, owner, due date and source; the number of items for a new task follows the current material.

The user's material supplies the facts and the example supplies structure and layout. Replace the sample topic, brand, people, dates, tasks and source positions. Keep relative deadlines as stated and convert them only once a base date is confirmed; keep suggestions marked as suggestions. Topic text keeps the reasons and dependencies that affect decisions, and states each fact in one place.

## Native layout

- A4 portrait with about 2 cm margins. The original runs four pages in English; the page count of a new file follows its content.
- Native `Title`, `Heading 1` and `Heading 2` in black at 23 / 14 / 12 pt, 11 pt body text with exact 16 pt line spacing; headings are kept with the text that follows. The Title style and heading paragraphs have no default border.
- Arial throughout for Latin text. A CJK fallback font stays registered as the East Asian font for any non-Latin names; Latin text does not depend on it.
- Three-column action table: Task and deliverable / Owner / Due, with widths of 10.2 / 3.1 / 3.7 cm. The task cell has layers for task, deliverable and source, with the source in small type; owner and due date are centered. Rows have automatic height, are never split across pages, repeat the header row and use light alternating fill.
- When changing column widths, update the native tblGrid and the cell widths together; the table uses exact 14 pt line spacing. The document grid is off and paragraphs keep their actual line spacing. The footer uses editable PAGE / NUMPAGES fields.

## Using the example

The selected example ID is `meeting-minutes`. Call `office_template(template_id="meeting-minutes")` first to prepare the native working copy of the current revision; organize the user's current material with `meeting-recap` and update the working copy with the official `office-docx` skill and the installed Python returned by `load_workspace_dependencies`. Keep the native paragraphs, headings, table and page numbers.

Run the structure check with the checker resource path returned by the loaded skill, export a PDF with the Kit of the current installation and check each page. Rendering path, Python and font results follow the current installed resources. Deliver the final DOCX.

preview-checks.json drives the glyph-coverage check for this example's build preview: the title must be fully inked. The user's material and the action content still come from the meeting source; the visual check of each page keeps verifying body text, table and pagination.
