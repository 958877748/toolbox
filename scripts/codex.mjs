import { copyFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url))
const BUILTIN_CATALOG = path.join(PKG_ROOT, "codex-catalogs", "models.json")
const MANAGED_MARKER = "# managed by @guolei1994/tool"
const DEFAULT_ENV_KEY = "CODEX_API_KEY"

const BUILTIN_PROFILES = {
  rawchat: {
    base_url: "https://rawchat.cn/codex",
    model: "gpt-5.6-terra",
    context_window: 270000,
    compact_limit: 240000,
    reasoning_effort: "max",
    env_key: "RAWCHAT_API_KEY",
  },
  "opencode-go": {
    base_url: "https://opencode.ai/zen/go/v1",
    model: "deepseek-v4-flash",
    model_catalog_json: "models.json",
    context_window: 270000,
    compact_limit: 240000,
    reasoning_effort: "max",
    env_key: "CODEX_API_KEY",
  },
  deepseek: {
    base_url: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    model_catalog_json: "models.json",
    context_window: 270000,
    compact_limit: 240000,
    reasoning_effort: "max",
    env_key: "DEEPSEEK_API_KEY",
  },
}

const DEFAULT_PROFILE = {
  name: "custom",
  base_url: "https://rawchat.cn/codex",
  model: "gpt-5.6-terra",
  context_window: 270000,
  compact_limit: 240000,
  reasoning_effort: "max",
  env_key: DEFAULT_ENV_KEY,
}

function codexDir() {
  return (
    process.env.CODEX_HOME ||
    path.join(process.env.USERPROFILE || os.homedir(), ".codex")
  )
}

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

function maskKey(value) {
  if (!value) return "not set"
  if (value.length <= 8) return "********"
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function ask(question) {
  return new Promise((resolve) => {
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
    terminal.question(question, (answer) => {
      terminal.close()
      resolve(answer.trim())
    })
  })
}

async function askDefault(label, value) {
  const answer = await ask(`${label} [${value}]: `)
  return answer || value
}

function askSecret(question) {
  if (!process.stdin.isTTY) return ask(question)

  return new Promise((resolve) => {
    let value = ""
    const input = process.stdin
    const done = () => {
      input.off("keypress", onKeypress)
      input.setRawMode(false)
      process.stdout.write("\n")
      resolve(value)
    }
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === "c") {
        value = ""
        done()
      } else if (key.name === "return" || key.name === "enter") {
        done()
      } else if (key.name === "backspace") {
        if (value) {
          value = value.slice(0, -1)
          process.stdout.write("\b \b")
        }
      } else if (character && !key.ctrl && !key.meta) {
        value += character
        process.stdout.write("*")
      }
    }

    process.stdout.write(question)
    readline.emitKeypressEvents(input)
    input.setRawMode(true)
    input.resume()
    input.on("keypress", onKeypress)
  })
}

async function readProfiles() {
  const file = path.join(codexDir(), "endpoints.json")
  try {
    const raw = (await readFile(file, "utf8")).replace(/^\uFEFF/, "")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid format")
    return parsed
  } catch (error) {
    if (error.code === "ENOENT") return {}
    console.warn("Could not read ~/.codex/endpoints.json; starting with no saved endpoints.")
    return {}
  }
}

async function saveProfiles(profiles) {
  await mkdir(codexDir(), { recursive: true })
  await writeFile(
    path.join(codexDir(), "endpoints.json"),
    `${JSON.stringify(profiles, null, 2)}\n`,
    "utf8",
  )
}

async function readConfig() {
  try {
    return await readFile(path.join(codexDir(), "config.toml"), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return ""
    throw error
  }
}

function tomlString(value) {
  return JSON.stringify(String(value))
}

const SECTION_RE = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/

function normalizeLines(source) {
  const lines = source ? source.replace(/\r\n/g, "\n").split("\n") : []
  if (lines.length === 1 && lines[0] === "") lines.pop()
  return lines
}

function findSectionHeader(lines, name) {
  return lines.findIndex((line) => {
    const match = line.match(SECTION_RE)
    return match && match[1] === name
  })
}

function sectionEnd(lines, headerIndex) {
  let end = lines.length
  for (let index = headerIndex + 1; index < lines.length; index++) {
    if (SECTION_RE.test(lines[index])) {
      end = index
      break
    }
  }
  return end
}

function keyPattern(key) {
  return new RegExp(`^(\\s*)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`)
}

function updateTomlSection(source, sectionName, values, removeKeys = []) {
  const lines = normalizeLines(source)
  let start = 0
  let end = lines.length

  if (sectionName) {
    const headerIndex = findSectionHeader(lines, sectionName)
    if (headerIndex === -1) {
      if (lines.length > 0 && lines.at(-1) !== "") lines.push("")
      lines.push(`[${sectionName}]`)
      for (const [key, value] of Object.entries(values)) lines.push(`${key} = ${value}`)
      return lines.join("\n") + "\n"
    }
    start = headerIndex + 1
    end = sectionEnd(lines, headerIndex)
  } else {
    end = lines.findIndex((line) => SECTION_RE.test(line))
    if (end === -1) end = lines.length
  }

  const changed = new Set()
  for (let index = start; index < end; index++) {
    for (const key of removeKeys) {
      if (keyPattern(key).test(lines[index])) lines[index] = ""
    }
    for (const [key, value] of Object.entries(values)) {
      const match = lines[index].match(keyPattern(key))
      if (match) {
        lines[index] = `${match[1]}${key} = ${value}`
        changed.add(key)
        break
      }
    }
  }

  let offset = 0
  for (const [key, value] of Object.entries(values)) {
    if (!changed.has(key)) {
      lines.splice(end + offset, 0, `${key} = ${value}`)
      offset++
    }
  }
  return lines.filter((line) => line !== "").join("\n") + "\n"
}

function upsertSection(source, name, values, removeKeys = []) {
  const lines = normalizeLines(source)
  const headerIndex = findSectionHeader(lines, name)
  if (headerIndex === -1) {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("")
    lines.push(`[${name}]`)
    for (const [key, value] of Object.entries(values)) lines.push(`${key} = ${value}`)
    return lines.join("\n") + "\n"
  }

  const start = headerIndex + 1
  const end = sectionEnd(lines, headerIndex)
  const changed = new Set()
  for (let index = start; index < end; index++) {
    for (const key of removeKeys) {
      if (keyPattern(key).test(lines[index])) lines[index] = ""
    }
    for (const [key, value] of Object.entries(values)) {
      const match = lines[index].match(keyPattern(key))
      if (match) {
        lines[index] = `${match[1]}${key} = ${value}`
        changed.add(key)
        break
      }
    }
  }

  let offset = 0
  for (const [key, value] of Object.entries(values)) {
    if (!changed.has(key)) {
      lines.splice(end + offset, 0, `${key} = ${value}`)
      offset++
    }
  }
  return lines.filter((line) => line !== "").join("\n") + "\n"
}

function ensureSectionMarker(source, name) {
  const lines = normalizeLines(source)
  const headerIndex = findSectionHeader(lines, name)
  if (headerIndex === -1) return source
  const start = headerIndex + 1
  if (lines[start] === MANAGED_MARKER) return source
  lines.splice(start, 0, MANAGED_MARKER)
  return lines.join("\n") + "\n"
}

function listSections(source) {
  const lines = normalizeLines(source)
  const sections = []
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(SECTION_RE)
    if (match) sections.push({ name: match[1], start: index, end: sectionEnd(lines, index) })
  }
  return sections
}

function removeSection(source, name) {
  const lines = normalizeLines(source)
  const headerIndex = findSectionHeader(lines, name)
  if (headerIndex === -1) return source
  lines.splice(headerIndex, sectionEnd(lines, headerIndex) - headerIndex)
  return lines.filter((line) => line !== "").join("\n") + "\n"
}

function removeStaleManagedSections(source, ids) {
  let result = source
  while (true) {
    const stale = listSections(result).find((section) => {
      if (!section.name.startsWith("model_providers.")) return false
      const id = section.name.slice("model_providers.".length)
      if (ids.has(id)) return false
      const body = normalizeLines(result).slice(section.start + 1, section.end)
      return body.includes(MANAGED_MARKER)
    })
    if (!stale) return result
    result = removeSection(result, stale.name)
  }
}

function migrateLegacyCodexProvider(source, endpoints) {
  const baseUrls = new Set(
    endpoints.map((endpoint) => (endpoint.base_url || "").replace(/\/+$/, "")),
  )
  const section = listSections(source).find((item) => item.name === "model_providers.codex")
  if (!section) return source
  const body = normalizeLines(source).slice(section.start + 1, section.end).join("\n")
  const baseUrl = body.match(/^\s*base_url\s*=\s*"([^"]+)"/m)?.[1]
  if (baseUrl && baseUrls.has(baseUrl.replace(/\/+$/, ""))) {
    return removeSection(source, "model_providers.codex")
  }
  return source
}

export function renderBaseConfig(source, endpoints, selectedId) {
  const selected = endpoints.find((endpoint) => endpoint.id === selectedId) || endpoints[0]
  const rootValues = { model_provider: tomlString(selected.id) }
  const rootRemove = ["auto_compact_token_limit"]
  for (const [profileKey, configKey] of [
    ["model", "model"],
    ["model_catalog_json", "model_catalog_json"],
    ["context_window", "model_context_window"],
    ["compact_limit", "model_auto_compact_token_limit"],
    ["reasoning_effort", "model_reasoning_effort"],
  ]) {
    if (selected[profileKey]) {
      rootValues[configKey] =
        profileKey === "context_window" || profileKey === "compact_limit"
          ? String(selected[profileKey])
          : tomlString(selected[profileKey])
    } else {
      rootRemove.push(configKey)
    }
  }
  let result = updateTomlSection(source, "", rootValues, rootRemove)

  const ids = new Set(endpoints.map((endpoint) => endpoint.id))
  for (const endpoint of endpoints) {
    const sectionName = `model_providers.${endpoint.id}`
    result = upsertSection(result, sectionName, {
      name: tomlString(endpoint.name),
      base_url: tomlString((endpoint.base_url || "").replace(/\/+$/, "")),
      env_key: tomlString(validEnvKey(endpoint.env_key) || DEFAULT_ENV_KEY),
      wire_api: '"responses"',
    })
    result = ensureSectionMarker(result, sectionName)
  }
  result = removeStaleManagedSections(result, ids)
  result = migrateLegacyCodexProvider(result, endpoints)
  return result
}

export function renderProfileConfig(profile) {
  const lines = ["# Managed by @guolei1994/tool - Codex profile"]
  lines.push(`model_provider = ${tomlString(profile.id)}`)
  for (const [profileKey, configKey] of [
    ["model", "model"],
    ["model_catalog_json", "model_catalog_json"],
    ["context_window", "model_context_window"],
    ["compact_limit", "model_auto_compact_token_limit"],
    ["reasoning_effort", "model_reasoning_effort"],
  ]) {
    if (!profile[profileKey]) continue
    const numeric = profileKey === "context_window" || profileKey === "compact_limit"
    lines.push(
      `${configKey} = ${numeric ? String(profile[profileKey]) : tomlString(profile[profileKey])}`,
    )
  }
  return lines.join("\n") + "\n"
}

export function getCodexBaseUrl(config) {
  const activeId = getActiveProviderId(config)
  const sections = [...config.matchAll(/^\s*\[model_providers\.([^\]]+)\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/gm)]
  const wanted = sections.find(([, id]) => id === activeId) || sections[0]
  return wanted?.[2].match(/^\s*base_url\s*=\s*"([^"]+)"/m)?.[1] || null
}

export function getActiveProviderId(config) {
  return config.match(/^\s*model_provider\s*=\s*"([^"]+)"/m)?.[1] || null
}

function slugify(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "endpoint"
}

function validEnvKey(value) {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : null
}

function assignEndpointId(endpoints, name, preferredId) {
  const ids = new Set(endpoints.map((endpoint) => endpoint.id).filter(Boolean))
  const base = preferredId || slugify(name)
  let id = base
  for (let index = 2; ids.has(id); index++) id = `${base}-${index}`
  return id
}

async function persistEndpointKeys(endpoints) {
  for (const endpoint of endpoints) {
    if (!endpoint.api_key) continue
    const envKey = validEnvKey(endpoint.env_key) || DEFAULT_ENV_KEY
    process.env[envKey] = endpoint.api_key
    await new Promise((resolve, reject) => {
      execFile("setx", [envKey, endpoint.api_key], { windowsHide: true }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

async function ensureCatalog(profile) {
  const configured = profile.model_catalog_json
  if (!configured) return undefined
  if (configured !== "models.json") return configured
  const destination = path.join(codexDir(), "models.json")
  if (!(await exists(destination))) {
    await mkdir(codexDir(), { recursive: true })
    await copyFile(BUILTIN_CATALOG, destination)
    console.log(`+ ${destination} (bundled model catalog installed)`)
  }
  return destination.replace(/\\/g, "/")
}

export async function testEndpoint(profile) {
  const baseUrl = profile.base_url.replace(/\/+$/, "")
  const headers = { Authorization: `Bearer ${profile.api_key}` }
  for (const suffix of ["/models", "/health"]) {
    try {
      const response = await fetch(`${baseUrl}${suffix}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: `Authentication failed at ${suffix} (HTTP ${response.status}).` }
      }
      return { ok: true, message: `Endpoint reached at ${suffix} (HTTP ${response.status}).` }
    } catch {
      // Try the next conventional endpoint before reporting the connection failure.
    }
  }
  return { ok: false, message: "Could not reach this endpoint." }
}

function profileNames(profiles) {
  return Object.keys(profiles).sort((a, b) => a.localeCompare(b))
}

const TEMPLATE_MANAGED_KEYS = ["context_window", "compact_limit", "model_catalog_json", "env_key"]

function stripStaleTemplateKeys(profile, name) {
  const builtin = BUILTIN_PROFILES[name]
  if (!builtin) return { ...profile }
  const result = { ...profile }
  for (const key of TEMPLATE_MANAGED_KEYS) {
    if (builtin[key] === undefined || result[key] === builtin[key]) delete result[key]
  }
  return result
}

function allProfiles(savedProfiles) {
  const merged = {}
  const names = new Set([...Object.keys(BUILTIN_PROFILES), ...Object.keys(savedProfiles)])
  for (const name of names) {
    merged[name] = { ...BUILTIN_PROFILES[name], ...savedProfiles[name] }
  }
  return merged
}

export function allEndpoints(savedProfiles) {
  const merged = allProfiles(savedProfiles)
  const seen = new Set()
  return Object.entries(merged).map(([name, profile]) => {
    let id = profile.id || slugify(name)
    while (seen.has(id)) id = `${profile.id || slugify(name)}-${seen.size + 1}`
    seen.add(id)
    return {
      ...profile,
      name,
      id,
      env_key: validEnvKey(profile.env_key) || BUILTIN_PROFILES[name]?.env_key || DEFAULT_ENV_KEY,
    }
  })
}

async function chooseProfile(profiles, title) {
  const endpoints = allProfiles(profiles)
  const names = profileNames(endpoints)
  console.log(`\n${title}`)
  names.forEach((name, index) => {
    const profile = endpoints[name]
    const keyStatus = profile.api_key ? "key saved" : "API key required"
    console.log(`  ${index + 1}) ${name}  ${profile.base_url}  (${keyStatus})`)
  })
  console.log("  0) Back")
  const answer = await ask("Select: ")
  const number = Number.parseInt(answer, 10)
  if (number < 1 || number > names.length) return null
  const name = names[number - 1]
  return { name, profile: { ...endpoints[name] } }
}

async function configureProfile(existing = null) {
  const profile = {
    ...DEFAULT_PROFILE,
    ...existing,
    name: existing?.name || DEFAULT_PROFILE.name,
  }
  while (true) {
    console.log("\nEndpoint details")
    console.log(`  Name: ${profile.name}`)
    console.log(`  Base URL: ${profile.base_url}`)
    console.log(`  API key: ${maskKey(profile.api_key)}`)
    console.log(`  Env var: ${profile.env_key || DEFAULT_ENV_KEY}`)
    console.log(`  Model: ${profile.model || "Codex default"}`)
    console.log(`  Reasoning effort: ${profile.reasoning_effort || "Codex default"}`)
    console.log("\n  1) Save these values")
    console.log("  2) Edit a field")
    console.log("  0) Cancel")
    const choice = await ask("Select: ")
    if (choice === "0") return null
    if (choice === "1") {
      if (!profile.api_key) {
        const key = await askSecret("API key: ")
        if (!key) {
          console.log("An API key is required to save an endpoint.")
          continue
        }
        profile.api_key = key
      }
      return profile
    }
    if (choice !== "2") continue

    console.log("\n  1) Name")
    console.log("  2) Base URL")
    console.log("  3) API key")
    console.log("  4) Model")
    console.log("  5) Reasoning effort")
    console.log("  6) Env var")
    console.log("  0) Done editing")
    const field = await ask("Select field: ")
    if (field === "1") profile.name = await askDefault("Endpoint name", profile.name)
    if (field === "2") profile.base_url = await askDefault("Base URL", profile.base_url)
    if (field === "3") {
      const key = await askSecret(`API key [${maskKey(profile.api_key)}, Enter to keep]: `)
      if (key) profile.api_key = key
    }
    if (field === "4") profile.model = await askDefault("Model", profile.model || "gpt-5.6-sol")
    if (field === "5") profile.reasoning_effort = await askDefault("Reasoning effort", profile.reasoning_effort || "max")
    if (field === "6") profile.env_key = await askDefault("Env var", profile.env_key || DEFAULT_ENV_KEY)
  }
}

async function removeProfileFile(id) {
  try {
    await unlink(path.join(codexDir(), `${id}.config.toml`))
    console.log(`- ${path.join(codexDir(), `${id}.config.toml`)}`)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}

async function addOrEditProfile(profiles, existingName = null) {
  const endpoints = allProfiles(profiles)
  const existing = existingName ? { ...endpoints[existingName], name: existingName } : null
  const profile = await configureProfile(existing)
  if (!profile) return

  const others = Object.entries(profiles)
    .filter(([name]) => name !== existingName)
    .map(([name, saved]) => ({
      ...BUILTIN_PROFILES[name],
      ...saved,
      name,
      id: saved?.id || slugify(name),
    }))
  const id = assignEndpointId(others, profile.name, profile.id)

  if (existingName && profile.name !== existingName) {
    const oldId = existing?.id || slugify(existingName)
    delete profiles[existingName]
    await removeProfileFile(oldId)
  }

  const stored = { ...stripStaleTemplateKeys(profile, existingName || profile.name), id }
  delete stored.name
  profiles[profile.name] = stored
  await saveProfiles(profiles)
  console.log("Endpoint saved locally.")
}

export async function applyProfile(savedProfiles, selected) {
  const directory = codexDir()
  const configFile = path.join(directory, "config.toml")
  const original = await readConfig()
  await mkdir(directory, { recursive: true })
  if (original) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    await copyFile(configFile, `${configFile}.toolbox-backup-${stamp}`)
  }

  const endpoints = allEndpoints(savedProfiles)
  const selectedWithId =
    endpoints.find((endpoint) => endpoint.name === selected.name) ||
    (() => {
      const id = selected.id || slugify(selected.name)
      return {
        ...selected,
        id,
        name: selected.name,
        env_key: validEnvKey(selected.env_key) || DEFAULT_ENV_KEY,
      }
    })()

  selectedWithId.model_catalog_json = await ensureCatalog(selectedWithId)
  await writeFile(configFile, renderBaseConfig(original, endpoints, selectedWithId.id), "utf8")
  await writeFile(
    path.join(directory, `${selectedWithId.id}.config.toml`),
    renderProfileConfig(selectedWithId),
    "utf8",
  )
  await persistEndpointKeys(endpoints)
  console.log(`Switched to ${selectedWithId.name} (provider: ${selectedWithId.id}).`)
  console.log(`Run Codex with: codex --profile ${selectedWithId.id}`)
  console.log("Plain `codex` also uses this endpoint until you switch again.")
  console.log("Open a new terminal before starting Codex so the API key is picked up.")
}

async function switchEndpoint(profiles) {
  const selected = await chooseProfile(profiles, "Choose a Codex endpoint")
  if (!selected) return
  const { name, profile } = selected
  if (!profile.api_key) {
    const key = await askSecret(`API key for ${name}: `)
    if (!key) {
      console.log("An API key is required to switch this endpoint.")
      return
    }
    profile.api_key = key
    profiles[name] = stripStaleTemplateKeys(profile, name)
    await saveProfiles(profiles)
    console.log("API key saved locally.")
  }
  console.log("Testing endpoint...")
  const result = await testEndpoint(profile)
  console.log(result.message)
  if (!result.ok) {
    const proceed = await ask("Switch anyway? [y/N]: ")
    if (!/^y(es)?$/i.test(proceed)) return
  }
  await applyProfile(profiles, selected)
}

async function listProfileFiles() {
  try {
    const files = await readdir(codexDir())
    return files
      .filter((file) => /^[\w-]+\.config\.toml$/.test(file))
      .map((file) => file.replace(/\.config\.toml$/, ""))
      .sort()
  } catch (error) {
    if (error.code === "ENOENT") return []
    throw error
  }
}

async function showCurrent(profiles) {
  const config = await readConfig()
  console.log("\nCurrent Codex endpoint")
  const baseUrl = getCodexBaseUrl(config)
  if (!baseUrl) {
    console.log("  No Codex endpoint is configured.")
    return
  }
  const current = baseUrl.replace(/\/+$/, "")
  const endpoints = allEndpoints(profiles)
  const endpoint = endpoints.find((item) => item.base_url.replace(/\/+$/, "") === current)
  console.log(`  ${endpoint ? endpoint.name : "Custom endpoint"}: ${current}`)
  const activeId = getActiveProviderId(config)
  if (activeId) {
    console.log(`  Active provider: ${activeId}`)
    console.log(
      (await exists(path.join(codexDir(), `${activeId}.config.toml`)))
        ? `  Run with profile: codex --profile ${activeId}`
        : "  No toolbox profile file for the active provider yet.",
    )
  }
  const installed = await listProfileFiles()
  if (installed.length > 0) {
    console.log(`  Installed profiles: ${installed.join(", ")}`)
  }
}

async function syncConfigAfterRemoval(savedProfiles, removedId) {
  const endpoints = allEndpoints(savedProfiles)
  const configFile = path.join(codexDir(), "config.toml")
  const original = await readConfig()
  if (!original) return
  const currentId = getActiveProviderId(original)
  if (currentId === removedId) {
    if (endpoints.length === 0) return
    console.log("The removed endpoint was active; switching to a remaining endpoint.")
    await applyProfile(savedProfiles, endpoints[0])
    return
  }
  if (!endpoints.some((endpoint) => endpoint.id === currentId)) return
  await writeFile(configFile, renderBaseConfig(original, endpoints, currentId), "utf8")
}

async function removeProfile(profiles) {
  const selected = await chooseProfile(profiles, "Forget a saved endpoint")
  if (!selected) return
  const { name } = selected
  if (!profiles[name]) {
    console.log("This is a built-in template with no saved API key.")
    return
  }
  const confirmation = await ask(`Remove ${name}? [y/N]: `)
  if (!/^y(es)?$/i.test(confirmation)) return
  const removedId = profiles[name].id || slugify(name)
  delete profiles[name]
  await saveProfiles(profiles)
  await removeProfileFile(removedId)
  await syncConfigAfterRemoval(profiles, removedId)
  console.log("Saved API key and local settings removed. The built-in template remains available.")
}

export default async function codex() {
  if (process.platform !== "win32") {
    console.log("Codex endpoint management currently supports Windows only.")
    return
  }

  while (true) {
    const profiles = await readProfiles()
    console.log("\nCodex endpoint manager")
    console.log("  1) Switch endpoint")
    console.log("  2) Add endpoint")
    console.log("  3) Edit endpoint")
    console.log("  4) Test endpoint")
    console.log("  5) Show current endpoint")
    console.log("  6) Remove endpoint")
    console.log("  0) Back")
    const choice = await ask("Select: ")
    if (choice === "0") return
    if (choice === "1") await switchEndpoint(profiles)
    if (choice === "2") await addOrEditProfile(profiles)
    if (choice === "3") {
      const selected = await chooseProfile(profiles, "Edit an endpoint")
      if (selected) await addOrEditProfile(profiles, selected.name)
    }
    if (choice === "4") {
      const selected = await chooseProfile(profiles, "Test endpoint")
      if (selected) {
        console.log("Testing endpoint...")
        console.log((await testEndpoint(selected.profile)).message)
      }
    }
    if (choice === "5") await showCurrent(profiles)
    if (choice === "6") await removeProfile(profiles)
  }
}
