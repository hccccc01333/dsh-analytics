import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const BUNDLE = new URL('../lib/client.js', import.meta.url)

/** One module-loader registration captured while evaluating the bundle. */
interface LoadedEntry {
  id: string
  factory: (require: (specifier: string) => unknown) => { inject?: string[]; apply?: unknown }
}

test('client bundle registers under the harness module-loader contract', () => {
  assert.ok(existsSync(BUNDLE), 'lib/client.js missing; run pnpm build first')
  let captured: LoadedEntry | undefined
  const previousWindow = globalThis.window as unknown
  ;(globalThis as Record<string, unknown>).window = {
    __ModuleLoader__: {
      load: (entry: LoadedEntry) => { captured = entry },
    },
  }
  try {
    require('../lib/client.js')
  } finally {
    if (previousWindow === undefined) delete (globalThis as Record<string, unknown>).window
    else (globalThis as Record<string, unknown>).window = previousWindow
  }

  assert.ok(captured !== undefined)
  assert.equal(captured.id, 'dsh-analytics')
  assert.equal(typeof captured.factory, 'function')

  // Materialize the factory with the platform-module table; the only runtime
  // externals this bundle needs are react and its JSX runtime.
  const mod = captured.factory((specifier: string) => {
    if (specifier === 'react' || specifier === 'react/jsx-runtime') return {}
    throw new Error(`unexpected runtime external: ${specifier}`)
  })
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual(mod.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-sidebar',
  ])
})
