import type { MouseEvent } from 'react'
import type { AppState, ID, Rect } from '../../../shared/types'
import { activeSpace, cx, dispatch } from '../api'
import { actionAlignment, browserAction, ExtensionButton, partitionOf, useBrowserActions } from '../ExtensionBar'
import { Icon } from '../icons'

const WIDTH = 260
const GAP = 6
const EDGE = 8

export function ExtensionsPopover({ state, profileId, anchor, close }: { state: AppState; profileId: ID; anchor: Rect; close: () => void }) {
  const ready = useBrowserActions(partitionOf(profileId))
  const pins = state.profiles.find((p) => p.id === profileId)?.pinnedExtensions ?? []
  const space = activeSpace(state)
  const tab = space?.activeItemId ? state.live[space.activeItemId]?.wcId : undefined
  const alignment = actionAlignment(state)
  const wanted = state.settings.sidebarRight ? anchor.x + anchor.width - WIDTH : anchor.x
  const left = Math.max(EDGE, Math.min(wanted, window.innerWidth - WIDTH - EDGE))

  const open = (e: MouseEvent, extensionId: string) => {
    e.stopPropagation()
    e.preventDefault()
    close()
    void browserAction().activate(partitionOf(profileId), { eventType: 'click', extensionId, tabId: tab ?? -1, alignment, anchorRect: anchor })
  }

  return (
    <>
      <div className="scrim clear" onMouseDown={close} />
      <div className="extensions-popover" style={{ left, top: anchor.y + anchor.height + GAP, width: WIDTH }}>
        <div className="extensions-title">Extensions</div>
        {(state.extensions[profileId] ?? []).map((e) => {
          const pinned = pins.includes(e.id)
          return (
            <div key={e.id} className="extension-row" data-id={e.id} onClickCapture={(ev) => !(ev.target as Element).closest('.pin') && open(ev, e.id)}>
              {ready.has(e.id) ? <ExtensionButton id={e.id} profileId={profileId} tab={tab} alignment={alignment} /> : <span className="extension-action" />}
              <span className="extension-name">{e.name}</span>
              <button
                className={cx('icon-btn pin', pinned && 'on')}
                title={pinned ? 'Unpin' : 'Pin'}
                onClick={() => dispatch({ type: 'extensionPin', profileId, extensionId: e.id, pinned: !pinned })}
              >
                <Icon name="pin" size={14} />
              </button>
            </div>
          )
        })}
        <div className="extensions-line" />
        <button className="extension-row manage" onClick={() => dispatch({ type: 'overlay', mode: { kind: 'settings', section: 'extensions' } })}>
          <Icon name="settings" size={14} />
          <span className="extension-name">Manage extensions</span>
        </button>
      </div>
    </>
  )
}
