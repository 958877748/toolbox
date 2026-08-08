#!/usr/bin/env node
import { copyFile, mkdir, readdir, stat } from "node:fs/promises"
import { createInterface } from "node:readline"
import path from "node:path"
import os from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url))
const SRC_PROVIDERS = path.join(PKG_ROOT, "providers")
const SRC_SCRIPTS = path.join(PKG_ROOT, "scripts")
const SRC_PLUGIN = path.join(PKG_ROOT, "index.js")
const PLUGIN_NAME = "provider-registry.js"

const configDir =
  process.env.OPENCODE_CONFIG_DIR ||
  path.join(os.homedir(), ".config", "opencode")
const dstPlugins = path.join(configDir, "plugins")
const dstProviders = path.join(configDir, "providers")

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function listProviders() {
  return (await readdir(SRC_PROVIDERS))
    .filter((f) => f.endsWith(".json"))
    .sort()
}

async function listScripts() {
  return (await readdir(SRC_SCRIPTS))
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => f.slice(0, -4))
    .sort()
}

async function cmdList() {
  const providers = (await listProviders()).map((f) => f.slice(0, -5))
  const scripts = await listScripts()
  console.log(`Built-in providers (${providers.length}):`)
  for (const id of providers) console.log(`  ${id}`)
  console.log(`\nScripts (${scripts.length}):`)
  for (const name of scripts) console.log(`  ${name}`)
  console.log("\nRun: oct               interactive provider install")
  console.log("      oct <script>     run a script")
}

function askChoice(choices) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    console.log("Built-in providers:")
    for (let i = 0; i < choices.length; i++) {
      console.log(`  ${i + 1}) ${choices[i]}`)
    }
    rl.question(
      "Select (numbers, e.g. 1,2 | a = all | q = quit): ",
      (answer) => {
        rl.close()
        resolve(answer.trim())
      },
    )
  })
}

async function selectProviders(available) {
  const ids = available.map((f) => f.slice(0, -5))
  const answer = await askChoice(ids)
  if (/^q$/i.test(answer)) return null
  if (/^a$/i.test(answer)) return ids
  const selected = new Set()
  for (const part of answer.split(/[,\s]+/)) {
    const n = parseInt(part, 10)
    if (n >= 1 && n <= ids.length) selected.add(ids[n - 1])
  }
  return [...selected]
}

async function cmdInstall(ids, force) {
  await mkdir(dstPlugins, { recursive: true })
  await mkdir(dstProviders, { recursive: true })

  const dstPlugin = path.join(dstPlugins, PLUGIN_NAME)
  if (force || !(await exists(dstPlugin))) {
    await copyFile(SRC_PLUGIN, dstPlugin)
    console.log(`+ ${dstPlugin}`)
  } else {
    console.log(`= ${dstPlugin} (exists, use --force to overwrite)`)
  }

  const available = await listProviders()
  const wanted = ids.length > 0 ? ids : available.map((f) => f.slice(0, -5))
  let added = 0
  let skipped = 0
  for (const id of wanted) {
    const file = `${id}.json`
    if (!available.includes(file)) {
      console.log(`! ${id}: not a built-in provider`)
      continue
    }
    const dst = path.join(dstProviders, file)
    if (force || !(await exists(dst))) {
      await copyFile(path.join(SRC_PROVIDERS, file), dst)
      console.log(`+ ${dst}`)
      added++
    } else {
      skipped++
      console.log(`= ${dst} (exists, use --force to overwrite)`)
    }
  }

  console.log(
    `\n${added} provider(s) installed, ${skipped} skipped. ` +
      `Restart opencode to load them.`,
  )
}

async function cmdRun(name, args) {
  const candidates = [
    path.join(SRC_SCRIPTS, `${name}.mjs`),
    path.join(SRC_SCRIPTS, `${name}.js`),
  ]
  const file = (await Promise.all(candidates.map(exists)))
    .map((ok, i) => (ok ? candidates[i] : null))
    .find(Boolean)
  if (!file) {
    console.error(`toolbox: unknown script "${name}"`)
    process.exit(1)
  }
  const mod = await import(pathToFileURL(file).href)
  if (typeof mod.default === "function") {
    await mod.default(args, { configDir })
  }
}

const [, , command, ...rest] = process.argv
const force = rest.includes("--force")
const args = rest.filter((a) => !a.startsWith("--"))

if (command === "list") {
  await cmdList()
} else if (!command) {
  const available = await listProviders()
  const selected = await selectProviders(available)
  if (!selected || selected.length === 0) {
    console.log("Nothing selected.")
  } else {
    await cmdInstall(selected, force)
  }
} else {
  const scripts = await listScripts()
  if (scripts.includes(command)) {
    await cmdRun(command, args)
  } else {
    console.log(`toolbox

Usage:
  toolbox                  Install providers (interactive selection)
  toolbox <script>        Run a script
  toolbox list             List providers and scripts

Options:
  --force    Overwrite existing files in ~/.config/opencode

The provider-registry plugin is auto-installed on first use.
`)
  }
}
