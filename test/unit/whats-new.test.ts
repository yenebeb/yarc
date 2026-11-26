import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { whatsNewLines, whatsNewProblem } from '../../scripts/whats-new.mjs'

const description = (...section: string[]) =>
  ['Moves the hourly timer into little.ts so it survives a reload.', '', "## What's New", '', ...section, '', '## Testing', '', '- Unit tests'].join('\r\n')

describe("The app shows a PR's What's New section, not its title", () => {
  test('one change per line, without bullets', () => {
    assert.deepEqual(whatsNewLines(description('- A Little Window left in the background for an hour closes', '* Its page goes to the archive')), [
      'A Little Window left in the background for an hour closes',
      'Its page goes to the archive'
    ])
  })

  test('"none" keeps the PR out of the app', () => {
    assert.deepEqual(whatsNewLines(description('none')), [])
    assert.deepEqual(whatsNewLines(description('- None.')), [])
  })

  test("the template's hints are not changes", () => {
    assert.deepEqual(whatsNewLines(description('<!-- One line per change,', 'for YARC users. -->', '- Pages can share your screen')), ['Pages can share your screen'])
  })

  test('the section ends at the next heading', () => {
    assert.deepEqual(whatsNewLines(description('- Pages can share your screen')), ['Pages can share your screen'])
  })

  test("a tool's footer under the section is not a change", () => {
    const footers = [
      '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
      '',
      'https://claude.ai/code/session_0123',
      'Co-Authored-By: Claude <noreply@anthropic.com>',
      '',
      '---',
      'Anything under a horizontal rule'
    ]
    assert.deepEqual(whatsNewLines(["## What's New", '', '- Pages can share your screen', '', ...footers].join('\n')), ['Pages can share your screen'])
    assert.deepEqual(whatsNewLines(["## What's New", '', 'none', '', ...footers].join('\n')), [])
    assert.match(whatsNewProblem(["## What's New", '', ...footers].join('\n')) ?? '', /is empty/)
  })

  test("the heading's apostrophe and case don't matter", () => {
    assert.deepEqual(whatsNewLines('### what’s new\n- Teams meeting links open properly'), ['Teams meeting links open properly'])
  })

  test('a description without the section (an older PR) has no answer, so its title is used', () => {
    assert.equal(whatsNewLines('Fixes the release upload.'), undefined)
    assert.equal(whatsNewLines(null), undefined)
  })
})

describe('A PR can only merge with the section filled in', () => {
  test('filled in with changes, or with "none"', () => {
    assert.equal(whatsNewProblem(description('- Pages can share your screen')), undefined)
    assert.equal(whatsNewProblem(description('none')), undefined)
  })

  test('missing', () => {
    assert.match(whatsNewProblem('Fixes the release upload.') ?? '', /needs a "## What's New" section/)
  })

  test('left as the template has it', () => {
    assert.match(whatsNewProblem(description('<!-- One line per change, or "none". -->')) ?? '', /is empty/)
  })
})
