/**
 * Sync the pet plugin's master source into the harness checkout, where it is
 * built.
 *
 * `dsh-pets/plugin/` is the single master. `packages/client/ui-pet/` inside the
 * harness is a *build target*: it has to live there because the package's
 * tsconfig extends the workspace base and references sibling packages, so it
 * cannot compile anywhere else. Edit the master, run this, and the copy plus
 * `lib/client.js` follow.
 *
 *   node sync-to-harness.mjs           # copy what changed, prune what was removed
 *   node sync-to-harness.mjs --check   # report drift only; exit 1 if out of sync
 *   node sync-to-harness.mjs --build   # sync, then rebuild the client bundle
 *
 * The build target's own build products (`lib/`, `node_modules/`) are never
 * touched: they are not the master's business, and deleting them would mean a
 * full workspace rebuild on every sync.
 *
 * Set DSH_HARNESS to point at a different checkout.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, sep } from 'node:path'

/** Where the master lives, and where it is built. */
const MASTER = 'D:/ALAN/Codes/dsh-pets/plugin'
const HARNESS = process.env.DSH_HARNESS ?? 'D:/ALAN/Codes/deepseek-harness'
const TARGET = join(HARNESS, 'packages', 'client', 'ui-pet')

/** Entries in the target that belong to the build, not to the master. */
const BUILD_ONLY = new Set(['lib', 'node_modules', '.turbo', 'dist', '.git'])

/** Files the master owns at the package root; anything else there is left alone. */
const ROOT_FILES = new Set(['package.json', 'tsconfig.json', 'tsdown.config.ts', 'README.md'])

const args = new Set(process.argv.slice(2))
const checkOnly = args.has('--check')
const build = args.has('--build')

/** Every file under `root`, as paths relative to it, sorted. */
function walk(root, skip = new Set()) {
  const out = []
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else out.push(relative(root, full).split(sep).join('/'))
    }
  }
  visit(root)
  return out.sort()
}

/** Whether two files have identical bytes. */
function same(a, b) {
  const left = readFileSync(a)
  const right = readFileSync(b)
  return left.length === right.length && left.equals(right)
}

if (!existsSync(MASTER)) {
  console.error(`no master at ${MASTER}`)
  process.exit(2)
}
if (!existsSync(join(HARNESS, 'tsconfig.client.json'))) {
  console.error(`${HARNESS} does not look like the harness checkout (no tsconfig.client.json)\n`
    + 'set DSH_HARNESS to the right path')
  process.exit(2)
}
// A harness reinstall or a fresh clone has no ui-pet package at all (the harness
// repo does not track it). The master is complete enough to recreate it, and a
// pnpm workspace picks `packages/client/*` up by glob, so this is the restore
// path, not just a convenience. `--check` never creates anything.
const targetExists = existsSync(TARGET)
if (!targetExists && !checkOnly) {
  mkdirSync(TARGET, { recursive: true })
  console.log(`note: ${TARGET} was missing; recreating the package from the master`)
}

const masterFiles = walk(MASTER)
const masterSet = new Set(masterFiles)
const added = []
const updated = []
const sameFiles = []
for (const rel of masterFiles) {
  const from = join(MASTER, rel)
  const to = join(TARGET, rel)
  if (!existsSync(to)) added.push(rel)
  else if (!same(from, to)) updated.push(rel)
  else sameFiles.push(rel)
}

// Stale files: anything the master no longer has, inside the trees it owns.
// Mirrored directories are pruned; at the package root only the files the
// master owns are considered, so an unexpected file is reported, never deleted.
const stale = []
const staleDirs = []
const masterDirs = new Set([''])
for (const rel of masterFiles) {
  const parts = rel.split('/')
  for (let i = 1; i < parts.length; i += 1) masterDirs.add(parts.slice(0, i).join('/'))
}
for (const dir of [...masterDirs].sort()) {
  const full = dir === '' ? TARGET : join(TARGET, dir)
  // A freshly created (or freshly restored) target is missing most of the tree,
  // and scanning a directory that is not there yet is not drift — it is depth.
  if (!existsSync(full)) continue
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (BUILD_ONLY.has(entry.name)) continue
    const rel = dir === '' ? entry.name : `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (!masterDirs.has(rel)) staleDirs.push(rel)
      continue
    }
    if (masterSet.has(rel)) continue
    if (dir === '' && !ROOT_FILES.has(entry.name)) {
      console.log(`note: ${rel} exists in the target but is not the master's; left alone`)
      continue
    }
    stale.push(rel)
  }
}

const drift = [...added, ...updated, ...stale, ...staleDirs]
console.log(`master  ${MASTER}`)
console.log(`target  ${TARGET}`)
console.log(`  copy ${String(added.length).padStart(3)}   update ${String(updated.length).padStart(3)}`
  + `   prune ${String(stale.length + staleDirs.length).padStart(3)}   unchanged ${String(sameFiles.length).padStart(3)}`)

if (checkOnly) {
  if (drift.length === 0) {
    console.log('\nin sync')
    process.exit(0)
  }
  console.log('\nout of sync:')
  for (const rel of added) console.log(`  missing in target  ${rel}`)
  for (const rel of updated) console.log(`  differs            ${rel}`)
  for (const rel of stale) console.log(`  stale in target    ${rel}`)
  for (const rel of staleDirs) console.log(`  stale dir          ${rel}/`)
  console.log('\nrun: node sync-to-harness.mjs')
  process.exit(1)
}

for (const rel of [...added, ...updated]) {
  const to = join(TARGET, rel)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(join(MASTER, rel), to)
  console.log(`  ${added.includes(rel) ? 'copy  ' : 'update'} ${rel}`)
}
for (const rel of stale) {
  rmSync(join(TARGET, rel))
  console.log(`  prune  ${rel}`)
}
for (const rel of staleDirs.sort((a, b) => b.length - a.length)) {
  const full = join(TARGET, rel)
  // A whole directory the master no longer has is pruned with its contents —
  // requiring it to be empty first left the orphan's parent behind forever — but
  // never if a build-only entry (lib/, node_modules/) is hiding inside it.
  const holdsBuildOutput = (dir) => readdirSync(dir, { withFileTypes: true }).some(entry =>
    BUILD_ONLY.has(entry.name) || (entry.isDirectory() && holdsBuildOutput(join(dir, entry.name))))
  if (holdsBuildOutput(full)) {
    console.log(`note: ${rel}/ holds build output of its own; left alone`)
    continue
  }
  rmSync(full, { recursive: true })
  console.log(`  prune  ${rel}/`)
}

if (!build) {
  console.log('\nsynced. rebuild with: node sync-to-harness.mjs --build')
  process.exit(0)
}

// The build: the harness's own commands, from the harness root. Their exit codes
// are not the verdict — the bundler writes deprecation warnings to stderr and a
// pipeline can turn that into a non-zero status — so the artifact's freshness is.
console.log('\nbuilding')
const steps = [
  ['node', ['--max-old-space-size=4096', 'node_modules/typescript/bin/tsc', '-b', 'tsconfig.client.json']],
  ['node', ['node_modules/tsdown/dist/run.mjs', '--env.DSH_BUILD_FACE', 'client']],
]
const codes = []
for (const [command, argv] of steps) {
  try {
    execFileSync(command, argv, { cwd: HARNESS, stdio: 'inherit' })
    codes.push(0)
  } catch (error) {
    codes.push(typeof error.status === 'number' ? error.status : 1)
  }
}

const artifact = join(TARGET, 'lib', 'client.js')
if (!existsSync(artifact)) {
  console.error(`\nno bundle at ${artifact} (step exit codes ${codes.join(', ')})`)
  process.exit(1)
}
// Only what the artifact is actually built from. The prose in `README.md` is part
// of the master and gets synced, but a doc edit does not make the bundle stale —
// and a freshness check that cries wolf over a typo fix is a check people learn to
// ignore, which is how a real "the build did not take" gets waved through.
const BUILD_INPUTS = ['package.json', 'tsconfig.json', 'tsdown.config.ts']
const sourceFiles = masterFiles.filter((rel) => rel.startsWith('src/') || BUILD_INPUTS.includes(rel))
const newestMaster = Math.max(...sourceFiles.map(rel => statSync(join(MASTER, rel)).mtimeMs))
const built = statSync(artifact)
const size = (built.size / 1024 / 1024).toFixed(2)
console.log(`\nbundle ${size} MiB, built ${new Date(built.mtimeMs).toLocaleString()}`
  + `  (step exit codes ${codes.join(', ')})`)

// A non-zero step still leaves a bundle behind: the bundler does not type-check,
// so it succeeds even when `tsc` could not resolve a dependency and emitted
// degraded declarations. Reporting that as a successful sync would be the exact
// "green light over a broken build" this tool exists to prevent.
if (codes.some(code => code !== 0)) {
  console.error('\nthe build is NOT clean — a step exited non-zero above.\n'
    + 'If it was `Cannot find module` / `error TS2307`, the package is missing its dependency\n'
    + 'links (they are pnpm\'s job, not this tool\'s). Restore them with:\n'
    + '  cd <harness> && corepack pnpm install --no-frozen-lockfile --ignore-scripts\n'
    + '(the workspace lockfile has no entry for this hand-added package, so a frozen install refuses)')
  process.exit(1)
}
if (built.mtimeMs < newestMaster) {
  console.error('the bundle is OLDER than the master — the build did not take; check the output above')
  process.exit(1)
}
console.log('bundle is newer than every source file it is built from, and every build step exited 0')
