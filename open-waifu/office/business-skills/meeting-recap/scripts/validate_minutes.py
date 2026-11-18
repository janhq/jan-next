#!/usr/bin/env python3
"""Check minutes structure; factual fidelity is checked against source material."""
import re
import sys
from datetime import date
from pathlib import Path

PENDING = 'To be confirmed'


class ValidationResult:
    def __init__(self):
        self.errors, self.warnings, self.info = [], [], []

    @property
    def passed(self):
        return not self.errors

    def report(self):
        lines = ['Meeting minutes structure check: ' + ('passed' if self.passed else 'needs fixes')]
        for kind, items in [('Error', self.errors), ('To confirm', self.warnings), ('Info', self.info)]:
            lines += [kind + ': ' + item for item in items]
        return '\n'.join(lines)


def section(content, names):
    for name in names:
        match = re.search(r'^##\s+' + re.escape(name) + r'[^\n]*\n(.*?)(?=^##\s|\Z)', content, re.M | re.S | re.I)
        if match:
            return match.group(1)
    return None


def cells(line):
    value = line.strip()
    if value.startswith('|'):
        value = value[1:]
    if value.endswith('|'):
        value = value[:-1]
    return [cell.strip() for cell in value.split('|')]


def validate(content):
    result = ValidationResult()
    if not re.search(r'^#\s+.*\bmeeting\s+(minutes|recap)\b', content, re.M | re.I):
        result.errors.append('The main title should include "Meeting Minutes"')
    topics = section(content, ['Topic Notes', 'Discussion Notes', 'Detailed Notes'])
    if topics is None or not topics.strip():
        result.errors.append('Provide topic notes with an explicit status for each item')
    actions = section(content, ['Action Items', 'Action Item Summary'])
    if actions is None or not actions.strip():
        result.errors.append('List the action items, or record that this meeting produced no new tasks')
        return result
    table = [cells(line) for line in actions.splitlines() if line.strip().startswith('|')]
    if table:
        header = [value.lower() for value in table[0]]
        aliases = [('Task', 'Task Description', 'Item'), ('Owner',), ('Deadline', 'Due Date'),
                   ('Deliverable', 'Completion Criteria', 'Deliverables')]
        positions = []
        for labels in aliases:
            names = [label.lower() for label in labels]
            index = next((i for i, value in enumerate(header) if value in names), None)
            if index is None:
                result.errors.append('The action item table needs a column: ' + labels[0])
            positions.append(index)
        if all(index is not None for index in positions):
            seen = set()
            count = 0
            for row in table[1:]:
                if all(re.fullmatch(r':?-+:?', value.replace(' ', '')) for value in row):
                    continue
                if len(row) != len(header):
                    result.errors.append('Action item column count must match the header'); continue
                count += 1
                values = [row[i] for i in positions]
                if any(not value for value in values):
                    result.errors.append('Mark missing action item fields as "' + PENDING + '"')
                task, owner, deadline, deliverable = values
                identity = re.sub(r'\s+', '', task).lower()
                if identity in seen:
                    result.errors.append('Merge duplicate tasks: ' + task)
                seen.add(identity)
                if any(PENDING.lower() in value.lower() for value in values):
                    result.warnings.append(task + ' has fields to be confirmed')
                for value in re.findall(r'\b\d{4}-\d{2}-\d{2}\b', deadline):
                    try:
                        date.fromisoformat(value)
                    except ValueError:
                        result.errors.append('Check the date in the deadline: ' + value)
            if count == 0:
                result.errors.append('Fill in the action items, or state in the body that this meeting produced no new tasks')
            result.info.append('Action item count: ' + str(count))
    return result


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Usage: python3 validate_minutes.py meeting-minutes.md')
    result = validate(Path(sys.argv[1]).read_text(encoding='utf-8'))
    print(result.report())
    sys.exit(0 if result.passed else 1)
