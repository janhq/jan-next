import { describe, expect, it } from 'vitest'
import { isReadOnlyCommand } from '../src/read-only-command.ts'

describe('isReadOnlyCommand', () => {
  it.each([
    'git status',
    'git -C repo --no-pager log --oneline -5',
    'ls -la src && cat README.md | head -20',
    'grep -rn TODO src 2>/dev/null; wc -l src/example.py',
    'rg -n "foo bar" src 2>&1 | sort | uniq',
    "find . -name '*.py' -type f",
    '[ -f README.md ]',
    "uniq -- 'a*.txt'",
    'uniq -c -- input.txt',
    'sort "\\$SORT_FLAGS"',
    'cat < input.txt',
    'echo done # trailing comment',
  ])('allows %s', (command) => {
    expect(isReadOnlyCommand(command)).toBe(true)
  })

  it.each([
    ['writes a file', 'echo hi > out.txt'],
    ['appends a file', 'ls >> out.txt'],
    ['runs a test suite', 'python3 -m pytest -q'],
    ['names a uniq output file', 'uniq in.txt out.txt'],
    ['names a dash-prefixed uniq output file', 'uniq -- in.txt -out.txt'],
    ['names a uniq output file after standard input', 'uniq - out.txt'],
    ['expands a glob into uniq operands', 'uniq *.txt'],
    ['expands a character class into uniq operands', 'uniq report[12].txt'],
    ['expands sort arguments', 'sort $SORT_FLAGS input.txt'],
    ['expands a quoted sort argument', 'sort "$SORT_FLAG" input.txt'],
    ['compiles a magic file', 'file -C -m magic'],
    ['sets the hostname', 'hostname box'],
    ['deletes via find', 'find . -name "*.tmp" -delete'],
    ['executes via find', 'find . -exec rm {} \\;'],
    ['sorts into a file', 'sort -o out.txt in.txt'],
    ['writes git state', 'git commit -m x'],
    ['writes git diff to a file', 'git diff --output=patch.diff'],
    ['substitutes a command', 'echo $(rm -rf x)'],
    ['substitutes with backticks', 'cat `ls`'],
    ['substitutes inside double quotes', 'echo "$(touch x)"'],
    ['expands parameters', 'cat ${FILE}'],
    ['opens a subshell', '(cd src && ls)'],
    ['backgrounds a command', 'sleep 5 &'],
    ['reads a here document', 'cat <<EOF\nx\nEOF'],
    ['sets a variable first', 'FOO=1 ls'],
    ['runs a program by path', './run.sh'],
    ['pipes into a writer', 'cat a | tee b'],
    ['leaves a quote open', "echo 'unterminated"],
    ['pipes stderr', 'ls |& cat'],
    ['uses a ripgrep preprocessor', 'rg --pre ./x foo'],
    ['is empty', '   '],
  ])('rejects a command that %s', (_why, command) => {
    expect(isReadOnlyCommand(command)).toBe(false)
  })
})
