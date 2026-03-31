#!/usr/bin/env node
/**
 * build.mjs — Best-effort build of Claude Code v2.1.88 from source
 *
 * ⚠️  IMPORTANT: A complete rebuild requires the Bun runtime's compile-time
 *     intrinsics (feature(), MACRO, bun:bundle). This script provides a
 *     best-effort build using esbuild. See KNOWN_ISSUES.md for details.
 *
 * What this script does:
 *   1. Copy src/ → build-src/ (original untouched)
 *   2. Replace `feature('X')` → `false`  (compile-time → runtime)
 *   3. Replace `MACRO.VERSION` etc → string literals
 *   4. Replace `import from 'bun:bundle'` → stub
 *   5. Create stubs for missing feature-gated modules
 *   6. Bundle with esbuild → dist/cli.js
 *
 * Requirements: Node.js >= 18, npm
 * Usage:       node scripts/build.mjs
 */

import { readdir, readFile, writeFile, mkdir, cp, rm, stat } from 'node:fs/promises'
import { join, dirname, isAbsolute, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const VERSION = '2.1.88'
const BUILD = join(ROOT, 'build-src')
const ENTRY = join(BUILD, 'entry.ts')

// ── Helpers ────────────────────────────────────────────────────────────────

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory() && e.name !== 'node_modules') yield* walk(p)
    else yield p
  }
}

async function exists(p) { try { await stat(p); return true } catch { return false } }

async function ensureEsbuild() {
  try { execSync('npx esbuild --version', { stdio: 'pipe' }) }
  catch {
    console.log('📦 Installing esbuild...')
    execSync('npm install --save-dev esbuild', { cwd: ROOT, stdio: 'inherit' })
  }
}

async function runEsbuild(entry, outFile, version) {
  const banner = [
    '#!/usr/bin/env node',
    `// Claude Code v${version} (built from source)`,
    '// Copyright (c) Anthropic PBC. All rights reserved.',
  ].join('\n')
  const esbuild = await import('esbuild')
  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'esm',
      outfile: outFile,
      banner: { js: banner },
      packages: 'external',
      external: ['bun:*'],
      allowOverwrite: true,
      sourcemap: true,
      logLevel: 'silent',
      loader: {
        '.md': 'text',
        '.txt': 'text',
      },
      plugins: [
        {
          name: 'resolve-src-prefix',
          setup(build) {
            build.onResolve({ filter: /^src\// }, args => ({
              path: resolve(BUILD, args.path),
            }))
          },
        },
      ],
    })
    return { status: 0, stdout: '', stderr: '' }
  } catch (error) {
    const lines = []
    const errors = error?.errors || []
    for (const e of errors) {
      lines.push(`X [ERROR] ${e.text}`)
      if (e.location?.file) {
        lines.push(
          `    ${e.location.file}:${e.location.line}:${e.location.column}:`,
        )
      }
      if (e.notes?.length) {
        for (const note of e.notes.slice(0, 2)) {
          lines.push(`    note: ${note.text}`)
        }
      }
      lines.push('')
    }
    return {
      status: 1,
      stdout: '',
      stderr:
        lines.join('\n') || (error instanceof Error ? error.message : String(error)),
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1: Copy source
// ══════════════════════════════════════════════════════════════════════════════

await rm(BUILD, { recursive: true, force: true })
await mkdir(BUILD, { recursive: true })
await cp(join(ROOT, 'src'), join(BUILD, 'src'), { recursive: true })
console.log('✅ Phase 1: Copied src/ → build-src/')

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Transform source
// ══════════════════════════════════════════════════════════════════════════════

let transformCount = 0

// MACRO replacements
const MACROS = {
  'MACRO.VERSION': `'${VERSION}'`,
  'MACRO.BUILD_TIME': `''`,
  'MACRO.FEEDBACK_CHANNEL': `'https://github.com/anthropics/claude-code/issues'`,
  'MACRO.ISSUES_EXPLAINER': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
  'MACRO.FEEDBACK_CHANNEL_URL': `'https://github.com/anthropics/claude-code/issues'`,
  'MACRO.ISSUES_EXPLAINER_URL': `'https://github.com/anthropics/claude-code/issues/new/choose'`,
  'MACRO.NATIVE_PACKAGE_URL': `'@anthropic-ai/claude-code'`,
  'MACRO.PACKAGE_URL': `'@anthropic-ai/claude-code'`,
  'MACRO.VERSION_CHANGELOG': `''`,
}

for await (const file of walk(join(BUILD, 'src'))) {
  if (!file.match(/\.[tj]sx?$/)) continue

  let src = await readFile(file, 'utf8')
  let changed = false

  // 2a. feature('X') → false
  if (/\bfeature\s*\(\s*['"][A-Z_]+['"]\s*\)/.test(src)) {
    src = src.replace(/\bfeature\s*\(\s*['"][A-Z_]+['"]\s*\)/g, 'false')
    changed = true
  }

  // 2b. MACRO.X → literals
  for (const [k, v] of Object.entries(MACROS)) {
    if (src.includes(k)) {
      src = src.replaceAll(k, v)
      changed = true
    }
  }

  // 2c. Remove bun:bundle import (feature() is already replaced)
  if (src.includes("from 'bun:bundle'") || src.includes('from "bun:bundle"')) {
    src = src.replace(/import\s*\{\s*feature\s*\}\s*from\s*['"]bun:bundle['"];?\n?/g, '// feature() replaced with false at build time\n')
    changed = true
  }

  // 2d. Remove type-only import of global.d.ts
  if (src.includes('global.d.ts')) {
    src = src.replace(/import\s*['"][^'"]*global\.d\.ts['"];?\n?/g, '')
    changed = true
  }

  if (changed) {
    await writeFile(file, src, 'utf8')
    transformCount++
  }
}
console.log(`✅ Phase 2: Transformed ${transformCount} files`)

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 3: Create entry wrapper
// ══════════════════════════════════════════════════════════════════════════════

await writeFile(ENTRY, `#!/usr/bin/env node
// Claude Code v${VERSION} — built from source
// Copyright (c) Anthropic PBC. All rights reserved.
import './src/entrypoints/cli.tsx'
`, 'utf8')
console.log('✅ Phase 3: Created entry wrapper')

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4: Iterative stub + bundle
// ══════════════════════════════════════════════════════════════════════════════

await ensureEsbuild()

const OUT_DIR = join(ROOT, 'dist')
await mkdir(OUT_DIR, { recursive: true })
const OUT_FILE = join(OUT_DIR, 'cli.js')

// Run up to 5 rounds of: esbuild → collect missing → create stubs → retry
const MAX_ROUNDS = 5
let succeeded = false

for (let round = 1; round <= MAX_ROUNDS; round++) {
  console.log(`\n🔨 Phase 4 round ${round}/${MAX_ROUNDS}: Bundling...`)

  let esbuildOutput = ''
  const run = await runEsbuild(ENTRY, OUT_FILE, VERSION)
  if (run.status === 0) {
    succeeded = true
    break
  }
  esbuildOutput = (run.stderr || '') + (run.stdout || '')

  // Parse missing modules
  const missing = []
  const lines = esbuildOutput.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const missingMatch = lines[i]?.match(/Could not resolve "([^"]+)"/)
    if (!missingMatch) continue
    const mod = missingMatch[1]
    if (!mod || mod.startsWith('node:') || mod.startsWith('bun:')) continue
    let importer = ''
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const importerMatch = lines[j]?.match(/\s([A-Za-z]:\\[^:]+|[^:\s]+):\d+:\d+:/)
      if (importerMatch) {
        importer = importerMatch[1].replace(/\\/g, '/')
        break
      }
    }
    missing.push({ mod, importer })
  }

  for (const line of lines) {
    const cannotReadMatch = line.match(/Cannot read file:\s+(.+)$/)
    if (!cannotReadMatch) continue
    const absolutePath = cannotReadMatch[1].trim().replace(/\\/g, '/')
    missing.push({ mod: absolutePath, importer: '' })
  }

  for (const line of lines) {
    const noExportMatch = line.match(
      /No matching export in "([^"]+)" for import "([^"]+)"/,
    )
    if (!noExportMatch) continue
    const absolutePath = noExportMatch[1].trim().replace(/\\/g, '/')
    const exportName = noExportMatch[2].trim()
    missing.push({ mod: absolutePath, importer: '', exportName })
  }

  if (missing.length === 0) {
    // No more missing modules but still errors — check what
    const errLines = esbuildOutput.split('\n').filter(l => l.includes('ERROR')).slice(0, 5)
    console.log('❌ Unrecoverable errors:')
    if (errLines.length > 0) {
      errLines.forEach(l => console.log('   ' + l))
    } else {
      const preview = esbuildOutput
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, 12)
      preview.forEach(l => console.log('   ' + l))
    }
    break
  }

  const uniqueMissing = new Map()
  for (const item of missing) {
    uniqueMissing.set(
      `${item.importer}::${item.mod}::${item.exportName || ''}`,
      item,
    )
  }

  if (uniqueMissing.size === 0) {
    const errLines = esbuildOutput.split('\n').filter(l => l.includes('ERROR')).slice(0, 5)
    console.log('❌ Unrecoverable errors:')
    errLines.forEach(l => console.log('   ' + l))
    break
  }

  console.log(`   Found ${uniqueMissing.size} missing modules, creating stubs...`)

  // Create stubs
  let stubCount = 0
  for (const { mod, importer, exportName } of uniqueMissing.values()) {
    const cleanMod = mod.replace(/^\.\//, '')
    let targetPath

    if (isAbsolute(mod)) {
      targetPath = mod
    } else if (mod.startsWith('.')) {
      let importerAbs = join(BUILD, 'src', 'entry.ts')
      if (importer) {
        if (isAbsolute(importer)) {
          importerAbs = importer
        } else if (importer.startsWith('build-src/')) {
          importerAbs = resolve(ROOT, importer)
        } else if (importer.startsWith('src/')) {
          importerAbs = resolve(BUILD, importer)
        } else {
          importerAbs = resolve(ROOT, importer)
        }
      }
      targetPath = resolve(dirname(importerAbs), mod)
    } else {
      targetPath = join(BUILD, 'src', cleanMod)
    }

    if (exportName) {
      await mkdir(dirname(targetPath), { recursive: true }).catch(() => {})
      let content = ''
      if (await exists(targetPath)) {
        content = await readFile(targetPath, 'utf8')
      } else {
        content = '// Auto-generated stub\nconst __stub = () => {}\nexport default __stub\n'
      }

      const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const hasNamedExport = new RegExp(`\\bexport\\s+const\\s+${escaped}\\b`).test(content)
      if (!hasNamedExport) {
        content += `export const ${exportName} = __stub\n`
        await writeFile(targetPath, content, 'utf8')
        stubCount++
      }
      continue
    }

    // Text assets → empty file
    if (/\.(txt|md|json|d\.ts)$/.test(cleanMod)) {
      await mkdir(dirname(targetPath), { recursive: true }).catch(() => {})
      if (!await exists(targetPath)) {
        const content = cleanMod.endsWith('.json')
          ? '{}'
          : cleanMod.endsWith('.d.ts')
            ? 'export {}\n'
            : ''
        await writeFile(targetPath, content, 'utf8')
        stubCount++
      }
      continue
    }

    // JS/TS modules → export empty
    if (/\.[tj]sx?$/.test(cleanMod)) {
      await mkdir(dirname(targetPath), { recursive: true }).catch(() => {})
      if (!await exists(targetPath)) {
        const name = cleanMod.split('/').pop().replace(/\.[tj]sx?$/, '')
        const safeName = name.replace(/[^a-zA-Z0-9_$]/g, '_') || 'stub'
        await writeFile(targetPath, `// Auto-generated stub\nconst __stub = () => {}\nexport default __stub\nexport const ${safeName} = __stub\n`, 'utf8')
        stubCount++
      }
    }
  }
  console.log(`   Created ${stubCount} stubs`)
}

if (succeeded) {
  const size = (await stat(OUT_FILE)).size
  console.log(`\n✅ Build succeeded: ${OUT_FILE}`)
  console.log(`   Size: ${(size / 1024 / 1024).toFixed(1)}MB`)
  console.log(`\n   Usage:  node ${OUT_FILE} --version`)
  console.log(`           node ${OUT_FILE} -p "Hello"`)
} else {
  console.error('\n⚠️ Full source build failed; generating minimal fallback CLI...')
  await writeFile(
    OUT_FILE,
    `#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk'

const VERSION = '2.1.88-fallback'
const args = process.argv.slice(2)

if (args.includes('--version')) {
  console.log(VERSION)
  process.exit(0)
}

const promptIndex = args.findIndex(a => a === '-p' || a === '--print')
const prompt = promptIndex >= 0 ? args[promptIndex + 1] : undefined

if (!prompt) {
  console.error('Usage: node dist/cli.js -p "Hello" | --version')
  process.exit(1)
}

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is required for prompt requests.')
  process.exit(1)
}

const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022'

try {
  const client = new Anthropic({ apiKey })
  const resp = await client.messages.create({
    model,
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = resp.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\\n')
  console.log(text)
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error)
  console.error('Request failed:', msg)
  process.exit(1)
}
`,
    'utf8',
  )
  console.log(`✅ Fallback CLI created: ${OUT_FILE}`)
  console.log('   Usage: node dist/cli.js --version')
  console.log('          node dist/cli.js -p "Hello"')
}
