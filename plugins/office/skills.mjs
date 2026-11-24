/**
 * Which bundled Office skills a configuration registers.
 * @param {{ word: boolean, powerpoint: boolean, excel: boolean, operations: boolean }} config - The switches.
 * @returns {string[]} skill names; empty when nothing is on, so no router skill is listed without a workflow.
 */
export function officeSkills(config) {
  const formats = [
    config.word && 'office-docx', config.powerpoint && 'office-pptx', config.excel && 'office-xlsx',
  ].filter(Boolean)
  if (formats.length === 0) return []
  return ['office', ...formats, ...config.operations ? ['office-render', 'office-recalculate', 'office-export-pdf'] : []]
}
