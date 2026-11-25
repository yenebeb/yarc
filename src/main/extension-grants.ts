import type { Extension } from 'electron'
import { writeFileAtomic } from './atomic-file'
import { readFileSync } from 'node:fs'

export interface Grant {
  origins: string[]
  permissions: string[]
}

/** Optional permissions extensions were given at runtime (chrome.permissions.request), per profile. electron-chrome-extensions forgets them at every load. */
export class ExtensionGrants {
  private file: string
  private all: Record<string, Grant>

  constructor(file: string) {
    this.file = file
    try {
      this.all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Grant>
    } catch {
      this.all = {}
    }
  }

  get(extensionId: string): Grant | undefined {
    return this.all[extensionId]
  }

  add(extension: Extension, request: { origins?: string[]; permissions?: string[] }): void {
    const had = this.all[extension.id] ?? { origins: [], permissions: [] }
    this.all[extension.id] = {
      origins: [...new Set([...had.origins, ...(request.origins ?? [])])],
      permissions: [...new Set([...had.permissions, ...(request.permissions ?? [])])]
    }
    this.save()
  }

  forget(extensionId: string): void {
    if (!(extensionId in this.all)) return
    delete this.all[extensionId]
    this.save()
  }

  private save(): void {
    try {
      writeFileAtomic(this.file, JSON.stringify(this.all))
    } catch (err) {
      console.warn('[extensions] could not save granted permissions', err)
    }
  }

  /** Puts them back into the library's own record, which permissions.contains/getAll answer from. */
  restore(into: Grant | undefined, extensionId: string): void {
    const grant = this.all[extensionId]
    if (!into || !grant) return
    for (const o of grant.origins) if (!into.origins.includes(o)) into.origins.push(o)
    for (const p of grant.permissions) if (!into.permissions.includes(p)) into.permissions.push(p)
  }
}
