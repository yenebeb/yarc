export interface HistoryRow {
  url: string
  title: string
  time: number
  visitCount: number
}

export interface LittleState {
  url: string
  title: string
  favicon?: string
  loading: boolean
  barColor: string
  profileName: string
  /** The space "Open in" moves the page to. */
  spaceName: string
  /** Other spaces with this profile exist, so "Open in…" has a menu. */
  moreSpaces: boolean
}
