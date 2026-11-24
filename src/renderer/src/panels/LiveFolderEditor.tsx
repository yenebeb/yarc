import { useState, type FormEvent } from 'react'
import { cleanLiveSource, githubPreset, githubQuery, isRepoName, liveFolderName, type GitHubPreset } from '../../../shared/live-folders'
import { findFolder } from '../../../shared/tree'
import type { AppState, LiveSource } from '../../../shared/types'
import { activeSpace, cx, dispatch } from '../api'
import { Icon } from '../icons'
import './panels.css'
import './editors.css'

const KINDS: { id: LiveSource['kind']; name: string; detail: string }[] = [
  { id: 'github', name: 'GitHub pull requests', detail: 'From a search on github.com' },
  { id: 'feed', name: 'RSS or Atom feed', detail: 'Or a site that has one' }
]

const PRESETS: { id: GitHubPreset; name: string }[] = [
  { id: 'mine', name: 'Mine' },
  { id: 'review', name: 'Review requested' },
  { id: 'repo', name: 'A repository' },
  { id: 'custom', name: 'Any search' }
]

export function LiveFolderEditor({ state, close, folderId }: { state: AppState; close: () => void; folderId?: string }) {
  const space = activeSpace(state)
  const folder = folderId ? findFolder(space, folderId) : undefined
  const live = folder?.live
  const initial = live?.kind === 'github' ? githubPreset(live.query) : { preset: 'mine' as const, repo: '' }
  const profile = state.profiles.find((p) => p.id === space.profileId)

  const [name, setName] = useState(folder?.name ?? '')
  const [kind, setKind] = useState<LiveSource['kind']>(live?.kind ?? 'github')
  const [preset, setPreset] = useState<GitHubPreset>(initial.preset)
  const [repo, setRepo] = useState(initial.repo)
  const [custom, setCustom] = useState(live?.kind === 'github' ? live.query : 'is:pr is:open ')
  const [feed, setFeed] = useState(live?.kind === 'feed' ? live.url : '')

  const query = githubQuery(preset, repo, custom)
  const source: LiveSource = kind === 'github' ? { kind, query } : { kind, url: feed }
  const cleaned = cleanLiveSource(source)
  const valid = !!cleaned && (kind !== 'github' || preset !== 'repo' || isRepoName(repo))

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!valid) return
    dispatch({ type: 'saveLiveFolder', id: folder?.id, name, source })
    close()
  }

  const remove = () => {
    if (!folder) return
    dispatch({ type: 'deleteFolder', id: folder.id })
    close()
  }

  return (
    <div className="panel sheet live-folder-editor">
      <form className="contents" onSubmit={submit}>
        <header>
          <Icon name="liveFolder" />
          <span>{folder ? 'Edit Live Folder' : 'New Live Folder'}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn" title="Cancel" onClick={close}>
            <Icon name="x" />
          </button>
        </header>
        <div className="body">
          <div className="field">
            <span>Fill it with</span>
            <div className="segmented" role="radiogroup" aria-label="Source">
              {KINDS.map((k) => (
                <button type="button" role="radio" aria-checked={kind === k.id} key={k.id} className={cx(kind === k.id && 'on')} onClick={() => setKind(k.id)}>
                  {k.name}
                  <small>{k.detail}</small>
                </button>
              ))}
            </div>
          </div>

          {kind === 'github' ? (
            <>
              <div className="field">
                <span>Pull requests</span>
                <div className="segmented compact" role="radiogroup" aria-label="Pull requests">
                  {PRESETS.map((p) => (
                    <button type="button" role="radio" aria-checked={preset === p.id} key={p.id} className={cx(preset === p.id && 'on')} onClick={() => setPreset(p.id)}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              {preset === 'repo' && (
                <label className="field">
                  <span>Repository</span>
                  <input className="text-input" autoFocus placeholder="owner/name or its github.com address" value={repo} onChange={(e) => setRepo(e.target.value)} />
                </label>
              )}
              {preset === 'custom' && (
                <label className="field">
                  <span>GitHub search</span>
                  <input className="text-input" autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} />
                </label>
              )}
              <p className="note" style={{ margin: 0 }}>
                {preset !== 'custom' && query && <code>{query}</code>}
                {preset !== 'custom' && query && <br />}
                YARC asks github.com with the {profile?.name ?? 'space’s'} profile’s own login, so sign in to GitHub in this space to see your pull requests and private repositories.
              </p>
            </>
          ) : (
            <label className="field">
              <span>Feed or site address</span>
              <input className="text-input" autoFocus placeholder="https://example.com/feed.xml" value={feed} onChange={(e) => setFeed(e.target.value)} />
            </label>
          )}

          <label className="field">
            <span>Name</span>
            <input className="text-input" placeholder={cleaned ? liveFolderName(cleaned) : 'Live Folder'} value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <p className="note" style={{ margin: 0 }}>
            The folder refreshes every 10 minutes and when you open it. New items appear at the top; ones that are gone leave, unless their tab is open.
          </p>

          <div className="actions">
            {folder && (
              <button type="button" className="btn danger" onClick={remove}>
                Delete live folder
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!valid}>
              {folder ? 'Save' : 'Create live folder'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
