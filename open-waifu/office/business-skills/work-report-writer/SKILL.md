---
name: work-report-writer
description: Turn current work records into daily, weekly and monthly reports and period summaries, stating deliverables, evidence for results, risks, dependencies and next-period plans, and deliver an editable Word file with office-docx.
license: MIT
---

# Daily, Weekly and Period Work Reports

## Set the period and the reader

Organize the content around the dates, period and audience the user specifies. Use the records already provided to produce a first draft, and mark necessary missing information as "To be confirmed". A daily report centers on the day's deliverables and the next working day's plan; a weekly report merges multi-day records by work theme; a monthly report or period summary compares results with targets and explains outcomes, causes and the plan for the next stage.

## Turn records into results

For each item, state what was completed, where the output is, its current status and its business impact. Register completed, in-progress, to-be-confirmed and planned work separately. Quantities, ratios and progress come from the user's materials; when calculating, state the numerator, denominator, unit and period. If the material gives no progress figure, show the steps already finished and the conditions still outstanding.

Record the stage actually reached for submission, review, release, acceptance and customer use separately. When the user supplies code records, read the specified repository and period within the current tools and permissions, then summarize by work theme. Cross-check what you find against the records the user provided.

## Organize by report type

- Daily report: today's overview, today's deliverables, in-progress items and help needed, next working day's plan.
- Weekly report: this week's results, key work, issues and dependencies, next week's plan.
- Monthly report and period summary: conclusion for the period, targets vs. actuals, main deliverables, issues and how they are handled, next-period plan, support that needs coordination.

For each risk, state the impact, the owner, the condition for resolving it and its current status. For each plan item, state the deliverable, owner, time and completion evidence; keep unknown dates as "To be confirmed". Use one consistent basis for targets, actuals, causes and plans, and summarize each item once under its theme.

## Build and review

Work with office-docx and the installed-level Python returned by load_workspace_dependencies. When the user selects an example, fetch a working copy with office_template, follow the example's heading levels, body styles and table column widths, and replace the entire text with the user's actual records. A daily report is usually one page; longer summaries paginate naturally by content, with repeating table headers, automatic row height and headings kept next to their body text.

Check the period, status, numbers, dates, owners and the evidence for each deliverable. Export a PDF with the official Kit and inspect it page by page, then deliver the editable DOCX with present. The projects, people, times and results in the example only demonstrate structure; the actual report is generated from the current materials.

## Sources and maintenance

The starting point is work-report-writer from the user-provided "open-source skill-185 (1).zip", brought in through the original Office PR. This version was rewritten by DSH Desktop with new rules for organizing materials, date and progress basis, and Word delivery; the original MIT license is kept.
