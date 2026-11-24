/** Skill switches: which skills a lookup may see, and the catalog a scope's editor shows. */
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { SkillSummary } from '@janhq/jan-skill'
import type { InheritedOff, ScopedSkillCatalog, ScopedSkillFolder, ScopedValues } from './types.ts'

/** Skill switch lists of one scope. */
export type SkillSwitches = Pick<ScopedValues, 'skillsDisabled' | 'skillFoldersDisabled'>

/**
 * Whether `child` is `parent` or inside it.
 * @param parent - absolute folder.
 * @param child - absolute path.
 * @returns true when `child` does not leave `parent`.
 */
export function within(parent: string, child: string): boolean {
  const rest = relative(parent, child)
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))
}

/**
 * Folder whose skills one folder switch covers: `<root>/<name>/SKILL.md` and `<root>/<name>.md` both belong to `<root>`.
 * @param skill - a discovered skill.
 * @returns the normalized root folder, or null for a skill without a file.
 */
export function skillRoot(skill: Pick<SkillSummary, 'path'>): string | null {
  if (skill.path === undefined) return null
  return resolve(basename(skill.path) === 'SKILL.md' ? dirname(dirname(skill.path)) : dirname(skill.path))
}

/**
 * Whether a scope switched one discovered root off. Matching is exact so every stored folder is one
 * editable catalog row, and clearing that row turns its skills back on.
 */
function folderOff(switches: SkillSwitches, root: string): boolean {
  return (switches.skillFoldersDisabled ?? []).some(folder => resolve(folder) === root)
}

function switchedOff(switches: SkillSwitches, skill: Pick<SkillSummary, 'name' | 'path'>): boolean {
  if (switches.skillsDisabled?.includes(skill.name) === true) return true
  const root = skillRoot(skill)
  return root !== null && folderOff(switches, root)
}

/**
 * Predicate for one lookup: a skill stays visible unless any applicable scope switched it or its folder off.
 * @param scopes - switch lists of every scope that applies to the lookup, widest first.
 * @returns the predicate, or undefined when nothing is switched off.
 */
export function skillVisibility(scopes: readonly SkillSwitches[]): ((skill: SkillSummary) => boolean) | undefined {
  const active = scopes.filter(switches => (switches.skillsDisabled?.length ?? 0) + (switches.skillFoldersDisabled?.length ?? 0) > 0)
  if (active.length === 0) return undefined
  return skill => !active.some(switches => switchedOff(switches, skill))
}

/** Show a folder under the home directory as `~/...`, the name people recognise. */
function homeRelative(path: string): string {
  const rest = relative(homedir(), path)
  return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest) ? `~/${rest.split(sep).join('/')}` : path
}

/**
 * Group skills by folder with the switches of the scope being edited and of the wider scopes.
 * @param skills - every skill a chat in the scope could load, before switches apply.
 * @param own - the edited scope's switches.
 * @param wider - wider scopes' switches, widest first.
 * @returns folders in discovery order, each with its skills.
 */
export function skillCatalog(
  skills: readonly SkillSummary[],
  own: SkillSwitches,
  wider: readonly { readonly at: InheritedOff; readonly switches: SkillSwitches }[],
): ScopedSkillCatalog {
  const folderOffAt = (root: string): InheritedOff | undefined => wider.find(({ switches }) => folderOff(switches, root))?.at
  const folders = new Map<string | null, ScopedSkillFolder & { skills: ScopedSkillFolder['skills'][number][] }>()
  for (const skill of skills) {
    const root = skillRoot(skill)
    let folder = folders.get(root)
    if (folder === undefined) {
      const offAt = root === null ? undefined : folderOffAt(root)
      folder = {
        path: root, label: root === null ? null : homeRelative(root),
        off: root !== null && folderOff(own, root),
        ...offAt === undefined ? {} : { offAt },
        skills: [],
      }
      folders.set(root, folder)
    }
    const offAt = wider.find(({ switches }) => switchedOff(switches, skill))?.at
    folder.skills.push({
      name: skill.name, description: skill.description, off: own.skillsDisabled?.includes(skill.name) === true,
      ...offAt === undefined ? {} : { offAt },
    })
  }
  return { folders: [...folders.values()] }
}
