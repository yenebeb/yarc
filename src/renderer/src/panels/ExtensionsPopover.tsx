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
  const pins = state.profiles.find((profile) => profile.id === profileId)?.pinnedExtensions ?? []
  const space = activeSpace(state)
  const tab = space?.activeItemId ? state.live[space.activeItemId]?.wcId : undefined
  const alignment = actionAlignment(state)
  const wanted = state.settings.sidebarRight ? anchor.x + anchor.width - WIDTH : anchor.x
  const left = Math.max(EDGE, Math.min(wanted, window.innerWidth - WIDTH - EDGE))

  const open = (event: MouseEvent, extensionId: string) => {
    event.stopPropagation()
    event.preventDefault()
    close()
    void browserAction().activate(partitionOf(profileId), { eventType: 'click', extensionId, tabId: tab ?? -1, alignment, anchorRect: anchor })
  }

  return (
    <>
      <div className="scrim clear" onMouseDown={close} />
      <div className="extensions-popover" style={{ left, top: anchor.y + anchor.height + GAP, width: WIDTH }}>
        <div className="extensions-title">Extensions</div>
        {(state.extensions[profileId] ?? []).map((extension) => {
          const pinned = pins.includes(extension.id)
          return (
            <div key={extension.id} className="extension-row" data-id={extension.id} onClickCapture={(event) => !(event.target as Element).closest('.pin') && open(event, extension.id)}>
              {ready.has(extension.id) ? <ExtensionButton id={extension.id} profileId={profileId} tab={tab} alignment={alignment} /> : <span className="extension-action" />}
              <span className="extension-name">{extension.name}</span>
              <button
                className={cx('icon-btn pin', pinned && 'on')}
                title={pinned ? 'Unpin' : 'Pin'}
                onClick={() => dispatch({ type: 'extensionPin', profileId, extensionId: extension.id, pinned: !pinned })}
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
