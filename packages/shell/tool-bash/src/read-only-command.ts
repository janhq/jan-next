/**
 * Conservative read-only classification for one bash command line, used only
 * to let sibling `bash` calls overlap. A command is read-only when every
 * pipeline stage and list member runs an allowlisted command whose arguments
 * cannot write, start another program, or change shell state that outlives
 * the call. Output redirection is allowed only to `/dev/null` or another file
 * descriptor; input redirection from a file is allowed. Anything the lexer
 * does not fully understand (command substitution, subshells, braces, here
 * documents, background `&`, shell expansions, unterminated
 * quotes, leading variable assignments, a command named by path) is not
 * read-only. A false negative only costs parallelism; a false positive could
 * let two commands race, so every unknown fails closed.
 * @module jan-tool-bash/read-only-command
 */

/** Argument rule for an allowlisted command: true when these arguments only read. */
type ArgRule = (args: readonly string[]) => boolean

const ANY: ArgRule = () => true

/** Reject the listed options, both bare and in `--long=value` form. */
function without(...options: readonly string[]): ArgRule {
  return args => !args.some(arg => options.some(option => arg === option || (option.startsWith('--') && arg.startsWith(`${option}=`))))
}

const FIND_ACTIONS = ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls']

/** `git` subcommands that read the repository without writing refs, the worktree, or files. */
const GIT_READ: Readonly<Record<string, true>> = {
  status: true, log: true, diff: true, show: true, 'rev-parse': true, 'ls-files': true, 'ls-tree': true, blame: true,
  grep: true, describe: true, shortlog: true, 'cat-file': true,
}

/** `git [-C dir | --no-pager]... <read subcommand>` without output-file, external-diff or pager options. */
const git: ArgRule = (args) => {
  let index = 0
  while (args[index] === '-C' || args[index] === '--no-pager') index += args[index] === '-C' ? 2 : 1
  const subcommand = args[index]
  if (subcommand === undefined || !Object.hasOwn(GIT_READ, subcommand)) return false
  return !args.slice(index + 1).some(arg =>
    arg.startsWith('--output') || arg === '--ext-diff' || arg === '-O' || arg.startsWith('--open-files-in-pager'))
}

/** `sort` without `-o`/`--output` (writes a file) or `--compress-program` (starts a program). */
const sort: ArgRule = args => !args.some(arg =>
  /^-[A-Za-z]*o/.test(arg) || arg.startsWith('--output') || arg.startsWith('--compress-program'))

/** A second operand names an output file; after the first operand, count even option-looking words. */
const uniq: ArgRule = (args) => {
  let options = true
  let operands = 0
  for (const arg of args) {
    if (options && arg.startsWith('-') && arg !== '-') {
      if (arg === '--') options = false
    } else {
      options = false
      if (++operands > 1) return false
    }
  }
  return true
}

const READ_ONLY: Readonly<Record<string, ArgRule>> = {
  ls: ANY, cat: ANY, head: ANY, tail: ANY, wc: ANY, pwd: ANY, echo: ANY, printf: ANY, sleep: ANY, true: ANY, false: ANY,
  stat: ANY, du: ANY, df: ANY, which: ANY, whoami: ANY, uname: ANY, basename: ANY, dirname: ANY,
  realpath: ANY, readlink: ANY, cut: ANY, tr: ANY, nl: ANY, diff: ANY, cmp: ANY, grep: ANY, egrep: ANY, fgrep: ANY,
  test: ANY, '[': ANY, jq: ANY, cd: ANY, printenv: ANY, id: ANY,
  file: without('-C', '--compile'),
  date: without('-s', '--set'),
  tree: without('-o'),
  rg: without('--pre'),
  find: without(...FIND_ACTIONS),
  sort,
  uniq,
  git,
}

/** Characters that end an unquoted word. */
const METACHARACTERS = ' \t\n;&|<>()'

/** Expansion markers that are not literal in an unquoted word. */
const EXPANSION_MARKERS = '`$*?~{}'

/** A lexed command line: list members and pipeline stages, each a list of words. */
type Segments = string[][]

/**
 * Split a command line into its simple commands, or return `undefined` when
 * it contains anything this classifier does not accept.
 * @param command - the bash command text.
 * @returns the words of each simple command, in order.
 */
function lex(command: string): Segments | undefined {
  let current: string[] = []
  const segments: Segments = [current]
  let word = ''
  let inWord = false
  let index = 0
  const flush = () => {
    if (inWord) current.push(word)
    word = ''
    inWord = false
  }
  const separate = () => {
    flush()
    current = []
    segments.push(current)
  }
  while (index < command.length) {
    const char = command.charAt(index)
    const next = command[index + 1]
    if (char === "'") {
      const end = command.indexOf("'", index + 1)
      if (end < 0) return undefined
      word += command.slice(index + 1, end)
      inWord = true
      index = end + 1
    } else if (char === '"') {
      const end = readDoubleQuoted(command, index)
      if (end === undefined) return undefined
      word += end.text
      inWord = true
      index = end.next
    } else if (char === '\\') {
      if (next === undefined) return undefined
      if (next !== '\n') {
        word += next
        inWord = true
      }
      index += 2
    } else if (char === '(' || char === ')' || EXPANSION_MARKERS.includes(char)
      || (char === '[' && (inWord || (next !== undefined && !METACHARACTERS.includes(next))))) {
      return undefined
    } else if (char === '#' && !inWord) {
      const end = command.indexOf('\n', index)
      index = end < 0 ? command.length : end
    } else if (char === ' ' || char === '\t') {
      flush()
      index++
    } else if (char === '\n' || char === ';') {
      separate()
      index++
    } else if (char === '|') {
      if (next === '&') return undefined
      separate()
      index += next === '|' ? 2 : 1
    } else if (char === '&') {
      if (next === '&') {
        separate()
        index += 2
      } else if (next === '>') {
        flush()
        const end = readRedirect(command, index + 1)
        if (end === undefined) return undefined
        index = end
      } else {
        return undefined
      }
    } else if (char === '>' || char === '<') {
      // Digits glued to the operator name the file descriptor, not an argument.
      if (inWord && /^\d+$/.test(word)) {
        word = ''
        inWord = false
      } else {
        flush()
      }
      const end = readRedirect(command, index)
      if (end === undefined) return undefined
      index = end
    } else {
      word += char
      inWord = true
      index++
    }
  }
  flush()
  return segments.filter(segment => segment.length > 0)
}

/** Read a literal double-quoted word; any interpolation requires exclusive scheduling. */
function readDoubleQuoted(command: string, start: number): { text: string; next: number } | undefined {
  let text = ''
  let index = start + 1
  while (index < command.length && command[index] !== '"') {
    const char = command.charAt(index)
    if (char === '`' || char === '$') return undefined
    const escaped = command[index + 1]
    if (char === '\\' && escaped !== undefined && '"\\$`\n'.includes(escaped)) {
      if (escaped !== '\n') text += escaped
      index += 2
    } else {
      text += char
      index++
    }
  }
  return index < command.length ? { text, next: index + 1 } : undefined
}

/**
 * Read one redirection whose operator starts at `start` (`>` or `<`). Output
 * may only go to `/dev/null` or duplicate a descriptor; input may come from a
 * file or a descriptor. Here documents and read-write opens are rejected.
 * @returns the index after the redirection, or `undefined` when it is not read-only.
 */
function readRedirect(command: string, start: number): number | undefined {
  const output = command[start] === '>'
  let index = start + 1
  if (output && (command[index] === '>' || command[index] === '|')) index++
  if (!output && (command[index] === '<' || command[index] === '>')) return undefined
  if (command[index] === '&') {
    const match = /^(\d+|-)/.exec(command.slice(index + 1))
    return match === null ? undefined : index + 1 + match[0].length
  }
  while (command[index] === ' ' || command[index] === '\t') index++
  let target = ''
  while (index < command.length && !METACHARACTERS.includes(command.charAt(index))) {
    const char = command.charAt(index)
    if (EXPANSION_MARKERS.includes(char) || char === '[') return undefined
    if (char === "'") {
      const end = command.indexOf("'", index + 1)
      if (end < 0) return undefined
      target += command.slice(index + 1, end)
      index = end + 1
    } else if (char === '"') {
      const quoted = readDoubleQuoted(command, index)
      if (quoted === undefined) return undefined
      target += quoted.text
      index = quoted.next
    } else if (char === '\\') {
      const escaped = command[index + 1]
      if (escaped === undefined) return undefined
      if (escaped !== '\n') target += escaped
      index += 2
    } else {
      target += char
      index++
    }
  }
  if (target.length === 0) return undefined
  return output && target !== '/dev/null' ? undefined : index
}

/**
 * Whether a bash command line only reads, so it may run beside other
 * read-only calls.
 * @param command - the bash command text.
 * @returns true only when every simple command is allowlisted with read-only arguments.
 */
export function isReadOnlyCommand(command: string): boolean {
  const segments = lex(command)
  if (segments === undefined || segments.length === 0) return false
  return segments.every(([name, ...args]) => {
    if (name === undefined || /^[A-Za-z_][A-Za-z0-9_]*=/.test(name)) return false
    const rule = Object.hasOwn(READ_ONLY, name) ? READ_ONLY[name] : undefined
    return rule !== undefined && rule(args)
  })
}
