import assert from 'node:assert/strict'
import { test } from 'node:test'
import { en, zh } from '../src/client/locales.ts'

test('English dictionary stays key-identical to the Chinese source of truth', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})
