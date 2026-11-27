import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const styles = 'src/renderer/src'
const ownColours = ['tokens.css', 'canvas.css', 'panels/spotlights.css']

const hexColour = /#[0-9a-f]{3,8}\b/i

const exceptions: { why: string; file: string; declaration: RegExp }[] = [
  { why: "the permission prompt's neutral greys ignore the space", file: 'prompt.css', declaration: /^--perm-/ },
  { why: 'Settings has its own surfaces', file: 'panels/settings.css', declaration: /^--set-/ },
  { why: 'the Little Window bar is always dark', file: 'little.css', declaration: /^--little-bar:/ },
  { why: 'the hue wheel and the hue slider show every colour', file: 'panels/color-picker.css', declaration: /^background: (conic|linear)-gradient\(/ },
  { why: 'an extension without an icon gets a grey letter tile, whatever the space', file: 'extension-bar.css', declaration: /^background: #757575$/ },
  { why: "an extension's badge has a grey edge, whatever the space", file: 'extension-bar.css', declaration: /^box-shadow: 0 0 1px 1px #444$/ },
  { why: "the selected result's icon is dark on a white tile in light and dark", file: 'panels/command-bar.css', declaration: /^color: #1d1b22$/ }
]

const isException = (file: string, declaration: string) =>
  exceptions.some((exception) => exception.file === file && exception.declaration.test(declaration))

const declarationsIn = (css: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/[;{}]/)
    .map((part) => part.trim().replace(/\s+/g, ' ').replace(/^([\w-]+) ?: ?/, '$1: '))
    .filter((part) => /^[\w-]+: /.test(part))

const literalsIn = (file: string) =>
  declarationsIn(readFileSync(`${styles}/${file}`, 'utf8'))
    .filter((declaration) => hexColour.test(declaration) && !isException(file, declaration))
    .map((declaration) => `${file} ${declaration}`)

test('a hex colour is a token, not a literal in a stylesheet', () => {
  const stylesheets = globSync('**/*.css', { cwd: styles }).map((file) => file.replaceAll('\\', '/'))
  assert.deepEqual(stylesheets.filter((file) => !ownColours.includes(file)).flatMap(literalsIn), [])
})

test('a declaration is found however it is laid out', () => {
  assert.deepEqual(declarationsIn('.tab {\n  background:\n    #fff;\n  color : red; /* #000 */ }'), ['background: #fff', 'color: red'])
})
