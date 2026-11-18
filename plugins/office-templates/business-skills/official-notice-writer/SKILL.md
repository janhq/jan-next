---
name: official-notice-writer
description: Write English organizational notices, official memos and announcements from the user's materials: memo header block, purpose, key facts, required action, deadline and contact, delivered as an editable Word file with office-docx and the official memo template.
---

# Official Notice and Memo Writer

Turn the user's materials into a clear organizational notice, official memo or announcement that readers can act on after one pass. The selected official memo template provides the layout; the user's materials provide every fact.

## 1. Settle the basics before writing

Identify from the materials, and ask only when something cannot be inferred:

- **Purpose**: inform, instruct, remind, announce a change, or request a response. One document, one main purpose.
- **Audience**: who must act, who only needs to know. Name groups explicitly (for example "all department heads") instead of "everyone".
- **Sender and authority**: the issuing person or office and the basis for the instruction (policy, decision, meeting, regulation). Never invent authority.
- **Document type**: notice (instructs or informs a defined group), memo (internal, between named people or teams), announcement (broad, usually informational).
- **Facts**: dates, times, places, amounts, names, reference numbers, links. Copy them exactly from the materials.

Write what the material determines. Mark every unknown field "To be confirmed" (for example "Reference: To be confirmed"); do not guess dates, numbers, names or approvals.

## 2. Header block

Use a compact block at the top, one field per line:

```
TO:        [Recipient group or named recipients]
FROM:      [Issuer name, title, office]
DATE:      [Issue date, e.g. 2026-11-18]
SUBJECT:   [One line: action + subject, e.g. "Updated expense approval limits effective 1 Dec"]
REFERENCE: [Document or file number; "To be confirmed" if none is given]
```

Add CC only when the materials name additional recipients. The SUBJECT line must make sense on its own and state the action or change, not just the topic ("Office closure on 24 Dec", not "Holiday matters").

## 3. Body structure

Follow this order; drop a section only if the materials truly have nothing for it.

1. **Purpose** (1-2 sentences): why this is being sent and what it changes or asks.
2. **Key facts**: what, when, where, who is affected, and what the decision or policy basis is. Use a short list or a small table for three or more parallel facts.
3. **Required action**: numbered steps, each starting with a verb and naming the responsible group. Separate "must do" from "for information".
4. **Deadline**: exact date and time with time zone when relevant, and what happens if it is missed (only if the materials say so).
5. **Contact**: name or team, email or phone, and the best channel for questions.

Close with a sign-off line (name, title, office) and any attachments list ("Attachment: ...").

## 4. Tone rules

- Plain, direct, courteous; active voice; one idea per sentence; aim for under 25 words per sentence.
- Lead with the point. The first paragraph must let a busy reader know what is happening and what they must do.
- Use "must" for obligations, "should" for recommendations, "may" for permissions. Do not soften required actions.
- State dates as "Friday 5 December 2026" or ISO "2026-12-05"; never "next week" or "soon" in a formal notice.
- Keep units, currency and numbers exactly as in the source. Define abbreviations on first use.
- Avoid slang, exclamation marks, filler ("please be advised that") and unexplained jargon.
- Sensitive news (layoffs, incidents, policy tightening): state facts neutrally, say what is being done, and give a support contact.

## 5. Checklist before delivery

- [ ] Purpose is clear from the SUBJECT line and the first paragraph.
- [ ] Every recipient group and the issuer are named; authority is stated only if sourced.
- [ ] Each required action has an owner and a deadline.
- [ ] Dates, times, amounts, names and reference numbers match the materials exactly.
- [ ] Unknown fields are marked "To be confirmed" and listed in your reply.
- [ ] A contact for questions is present.
- [ ] Length fits one page unless the content requires more; headings, lists and tables carry the structure.
- [ ] No placeholder text or sample content from the template remains.

## 6. Build the Word file

When the user selects the official memo example, call office_template with that template's ID first and work on the returned editable copy. Build with office-docx and the installed-level Python returned by load_workspace_dependencies. The selected template provides layout: page setup, header block styling, heading and body styles, spacing, footer and page numbers. The user's materials provide facts: replace all of the template's sample text, names, dates and numbers.

- Keep native paragraph and table styles; do not flatten the document into images or text boxes.
- Fill the template's header fields (TO / FROM / DATE / SUBJECT / REFERENCE) with real values or "To be confirmed".
- Use a table only for parallel facts or action lists; repeat the header row if it can break across pages.
- Export a PDF with the official Kit, render every page, and check wrapping in the header block, table columns, signature position and page count.
- Deliver the final editable DOCX with present.

See references/notice-patterns.md for ready-to-adapt patterns for common notice types.
