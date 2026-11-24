import assert from 'node:assert/strict'
import test from 'node:test'
import { officeSkills } from '../skills.mjs'

const all = { word: true, powerpoint: true, excel: true, operations: true }

test('registers the router, the chosen formats, and LibreOffice operations only when switched on', () => {
  assert.deepEqual(officeSkills(all),
    ['office', 'office-docx', 'office-pptx', 'office-xlsx', 'office-render', 'office-recalculate', 'office-export-pdf'])
  assert.deepEqual(officeSkills({ ...all, powerpoint: false, operations: false }), ['office', 'office-docx', 'office-xlsx'])
})

test('lists nothing, not a lone router, when every format is off', () => {
  assert.deepEqual(officeSkills({ word: false, powerpoint: false, excel: false, operations: true }), [])
})
