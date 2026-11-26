import { useEffect, useState } from 'react'
import { pinnedOf } from '../../shared/extension-pins'
import type { AppState, ID } from '../../shared/types'
import { dispatch } from './api'
import { Icon } from './icons'
import './extension-bar.css'

interface ActionState {
  actions: { id: string }[]
}

interface BrowserActionApi {
  addEventListener(name: 'update', listener: (state: ActionState) => void): void
  removeEventListener(name: 'update', listener: (state: ActionState) => void): void
  getState(partition: string): Promise<ActionState>
  addObserver(partition: string): void
  removeObserver(partition: string): void
  activate(partition: string, details: { eventType: 'click'; extensionId: string; tabId: number; alignment: string; anchorRect: { x: number; y: number; width: number; height: number } }): Promise<void>
}

/** What electron-chrome-extensions' preload exposes to the pages that show extension buttons. */
export const browserAction = (): BrowserActionApi => (globalThis as unknown as { browserAction: BrowserActionApi }).browserAction

export const partitionOf = (profileId: ID) => `persist:profile-${profileId}`

/** Ids the library has state for: a `browser-action` button throws if drawn before that. */
export function useBrowserActions(partition: string, enabled = true): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    // Before the profile's extensions start, the library drops the subscription for good.
    if (!enabled) return
    const onUpdate = (state: ActionState) => {
      setIds(new Set(state.actions.map((action) => action.id)))
      // A standalone button only redraws when one of its attributes changes.
      for (const button of document.querySelectorAll<HTMLButtonElement & { update(): void }>('button[is="browser-action"]')) button.update()
    }
    const api = browserAction()
    api.addEventListener('update', onUpdate)
    api.addObserver(partition)
    void api.getState(partition)
    return () => {
      api.removeEventListener('update', onUpdate)
      api.removeObserver(partition)
    }
  }, [partition, enabled])
  return ids
}

export function ExtensionButton({ id, profileId, tab, alignment }: { id: string; profileId: ID; tab?: number; alignment: string }) {
  return <button is="browser-action" className="extension-action" id={id} partition={partitionOf(profileId)} tab={tab === undefined ? undefined : String(tab)} alignment={alignment} />
}

export const actionAlignment = (state: AppState) => (state.settings.sidebarRight ? 'bottom left' : 'bottom right')

export function ExtensionBar({ state, profileId, tab }: { state: AppState; profileId: ID; tab?: number }) {
  const installed = state.extensions[profileId] ?? []
  const ready = useBrowserActions(partitionOf(profileId), installed.length > 0)
  const profile = state.profiles.find((candidate) => candidate.id === profileId)
  if (!installed.length || !profile) return null
  return (
    <>
      {pinnedOf(profile, installed)
        .filter((extension) => ready.has(extension.id))
        .map((extension) => (
          <ExtensionButton key={extension.id} id={extension.id} profileId={profileId} tab={tab} alignment={actionAlignment(state)} />
        ))}
      <button
        className="icon-btn extensions-button"
        title="Extensions"
        onClick={(event) => {
          const { x, y, width, height } = event.currentTarget.getBoundingClientRect()
          dispatch({ type: 'extensionsPopover', profileId, anchor: { x, y, width, height } })
        }}
      >
        <Icon name="puzzle" size={14} />
      </button>
    </>
  )
}

declare module 'react' {
  interface ButtonHTMLAttributes<T> {
    partition?: string
    tab?: string
    alignment?: string
  }
}
