import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fmtCost, fmtMoney, fmtPct, fmtTime, fmtTokens } from '../src/client/format.ts'

test('fmtTokens compacts large counts', () => {
  assert.equal(fmtTokens(812), '812')
  assert.equal(fmtTokens(45600), '45.6K')
  assert.equal(fmtTokens(1234000), '1.23M')
  assert.equal(fmtTokens(12300000), '12.3M')
})

test('fmtMoney formats small amounts with precision', () => {
  assert.match(fmtMoney(0.00087725, 'USD'), /0\.0009/)
  assert.match(fmtMoney(12.34, 'USD'), /12\.34/)
})

test('fmtCost joins per-currency entries and handles empty lists', () => {
  assert.equal(fmtCost(undefined), '—')
  assert.equal(fmtCost([]), '—')
  assert.match(fmtCost([{ currency: 'USD', amount: 1.2 }]), /1\.20/)
})

test('fmtPct renders ratios as percentages', () => {
  assert.equal(fmtPct(0.764), '76.4%')
  assert.equal(fmtPct(0), '0.0%')
})

test('fmtTime renders a compact local time', () => {
  const output = fmtTime(Date.parse('2026-08-01T10:05:00Z'))
  assert.match(output, /^\d{2}:\d{2}$/)
})
