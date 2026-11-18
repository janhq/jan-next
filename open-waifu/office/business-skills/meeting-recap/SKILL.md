---
name: meeting-recap
description: Turn meeting transcripts, notes or chat logs into actionable minutes that separate decisions, discussion and suggestions, open questions and action items, keep owners, dates and source evidence, and deliver an editable Word file.
license: MIT
---

# Meeting Minutes

Prepare minutes from the user's materials that attendees can confirm and the project team can act on. The focus is what was decided, what still needs confirmation, who drives each item and when it is due. The selected DOCX example provides the layout; the user's materials provide the facts.

## 1. Read the materials and build the evidence base

Read the full transcript, meeting notes and attachments, and record file names plus paragraph, timestamp or speaker positions. For long materials, split by topic first, then merge repeated discussion of the same topic. Keep the original evidence for scope, numbers, conditions, responsibilities and dates.

Take meeting details from the materials: name, date, time, format, attendees, chair. Fill in what is available; write "To be confirmed" for missing fields. The note taker is the person the user names; speakers found in the materials and the formal attendee list are identified separately.

Record the source of file metadata and of spoken meeting dates separately. Convert relative deadlines only after the base date is confirmed; judge metadata by the evidence, and use an existing date only in the sense the materials state.

When several people, abbreviations or ASR misrecognitions are involved, check context and attachments first. If an ambiguity remains, keep the original wording and list the open points together. Produce a first draft from what is available and flag key contradictions to the user at delivery.

## 2. Set each item's status from the source text

Assign each item one of the following statuses before writing it into the minutes:

| Status | Basis | How to write it |
| --- | --- | --- |
| Decided | Explicitly confirmed, jointly accepted, or decided by someone with authority | State the decision, its scope and the conditions for it to take effect |
| Suggestion / discussion | Proposals, personal opinions, alternatives | Keep who proposed it, the reasons and the outcome of the discussion |
| Open | Explicitly left for evaluation, approval or more material | State the open question, the decision conditions and the next step |
| Changed | A later statement explicitly modifies or withdraws an earlier arrangement | Use the last explicit arrangement and keep the reason for the change |

Keep qualifiers such as "tentative", "suggested", "possibly", "after the client confirms" and "once the evaluation passes" together with the conclusion. "Agreed to evaluate the proposal" maps to an evaluation task; the status of formally adopting the proposal is set only by an explicit adoption decision.

Keep original units, statistical scope and time basis for numbers. When figures conflict, list both sources and the fields that need confirmation. When consolidating several meetings, track the final decision by meeting date and item version.

## 3. Extract action items

When the source states explicit work or a commitment, extract the task, owner, deadline and acceptance criteria. Describe each task as "verb + object + completion condition". Merge identical tasks into one item and link it to its topic.

- The owner comes from an explicit assignment or a volunteer; if the material says only "product side", keep "product side"; if missing, write "To be confirmed".
- Record deadlines as stated. Write explicit dates as YYYY-MM-DD; keep phrases such as "next week" or "end of month" verbatim and, where useful, add the base date the material provides and the specific date to be confirmed.
- Fill in priority only when the source states it; acceptance criteria come from what the meeting required, otherwise write "To be confirmed".
- Show action items together in one table. Topic notes explain the decision, background and key disagreements.
- If this meeting explicitly created no new tasks, say so and omit the empty table.

Working-group responsibilities, vision or general principles belong in the topic notes; work already completed appears as progress or as the basis of a decision.

## 4. Organize readable minutes

Use this structure by default and adjust the page count to the actual content:

1. **Meeting name and details**: time, format, attendees and meeting goal, shown compactly.
2. **Conclusions and open items**: key decisions and their effective conditions first, so readers see the result quickly.
3. **Topic notes**: organize by theme with background, key discussion, and decided or open status. The level of detail follows the user's request and the complexity of the material; keep the reasons and disagreements that affect judgment.
4. **Action items**: task, owner, deadline, acceptance criteria; add a "Source" column when traceability is needed.
5. **Items to confirm**: list missing information, contradictions and dependencies together; omit when everything is complete.

Keep the same fact consistent across conclusions, topics and action items. Use natural, clear business language; headings, numbering and tables carry the information hierarchy. If suggestions, risk speculation or follow-up writing advice are valuable, label them separately as "Editor's notes" so they stay distinct from meeting decisions.

## 5. Build the Word file

When the user selects the meeting minutes example, call office_template(template_id="meeting-minutes") first and work on the returned copy; build the file with office-docx and the installed-level Python provided by load_workspace_dependencies.

Keep the selected original's A4 portrait page, roughly 2 cm margins and native heading styles. Title about 23 pt, Heading 1 about 14 pt, Heading 2 about 12 pt, black; body 11 pt with exactly 16 pt line spacing. Set keep_with_next on headings, clear the default borders on the Title style and on heading paragraphs, and turn the document grid off or set paragraph snapToGrid to false so the real line spacing holds. The original's fonts stay with the copy; when changing fonts, confirm with the current Kit font diagnostics and page-by-page results.

The action table of the meeting example has three columns, "Task and deliverable / Owner / Deadline", with widths 10.2 / 3.1 / 3.7 cm. Task cells layer the task, acceptance criteria and source; owner and deadline are centered. When changing column widths, update both table.columns and cell.width so the native tblGrid and the cells agree. Tables use exactly 14 pt line spacing, enough cell padding, automatic row height, rows that do not split across pages and a repeating header row; the footer keeps its PAGE / NUMPAGES fields. The number of action items and pages follows from the current materials.

Replace the whole example's content with the user's materials, keeping real heading styles, editable paragraphs and tables. Export a PDF with the official Kit and render it page by page to check the layout; the native DOCX is the final deliverable. Once headings, tables, fonts, pagination and body text are confirmed readable, deliver with present.

For the structure checker, use the real path of ../scripts/check_office.py under the loaded office-docx resource directory; for LibreOffice Kit, use the Installed LibreOffice Kit path provided by the loaded skill. The first review pass checks suggestion status, relative deadlines, source speakers and complete action coverage; the page-by-page pass checks headings against the following text, field column widths, density of the last page and font diagnostics.

## 6. Quality review

Before delivery, check each point:

- Every decision has source evidence, and its status matches its effective conditions.
- Statements, suggestions, decided items and open items are clearly separated, and later changes are reflected.
- Names, scope, numbers, units and dates all match the current materials.
- Action items cover the work the source states explicitly; owners and deadlines keep the material's wording, and missing fields are marked "To be confirmed".
- Each task is registered once in the action table, and information is consistent between topics and summaries.
- The example DOCX's sample content has been fully replaced by this meeting's facts.
- Every page has been rendered and checked, and the tables and pagination meet reading and editing needs.

Optionally run scripts/validate_minutes.py to check a Markdown draft for sections, table fields, dates and duplicate tasks. The script validates structure; factual accuracy is checked against the source item by item.

## Sources and maintenance

The starting point is meeting-recap from the user-provided "open-source skill-185 (1).zip"; the original license and attribution files ship with the package. After the original Office PR merged it, it moved into DSH Desktop. This version was rewritten by DSH Desktop with new organizing rules, Word delivery and validation. The archived name and the historical "Kimi 185" review label describe the local source; authorship follows the bundled license.
