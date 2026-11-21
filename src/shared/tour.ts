import type { CommandId } from './keymap'

export type TourStep = 'welcome' | 'import' | 'default' | 'spaces' | 'peek' | 'command' | 'pin' | 'split' | 'little' | 'incognito' | 'done'

export const TOUR_STEPS: TourStep[] = ['welcome', 'import', 'default', 'spaces', 'peek', 'command', 'pin', 'split', 'little', 'incognito', 'done']

export type TourEvent = CommandId | 'split'

const TRY_IT_COMPLETED_BY: Partial<Record<TourStep, TourEvent>> = {
  spaces: 'toggleSidebar',
  peek: 'toggleSidebar',
  command: 'newTab',
  pin: 'togglePin',
  split: 'split',
  little: 'littleArc',
  incognito: 'newIncognitoWindow'
}

export function tryEvent(step: TourStep): TourEvent | undefined {
  return TRY_IT_COMPLETED_BY[step]
}

/** Try-it steps float as a small card so the sidebar and the page stay usable. */
export function isFloating(step: TourStep): boolean {
  return step in TRY_IT_COMPLETED_BY
}

export function nextStep(step: TourStep): TourStep | undefined {
  return TOUR_STEPS[TOUR_STEPS.indexOf(step) + 1]
}

export function previousStep(step: TourStep): TourStep | undefined {
  const i = TOUR_STEPS.indexOf(step)
  return i > 0 ? TOUR_STEPS[i - 1] : undefined
}

export function stepAfter(step: TourStep, event: TourEvent): TourStep {
  return TRY_IT_COMPLETED_BY[step] === event ? (nextStep(step) ?? step) : step
}
