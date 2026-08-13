import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"

const DEFAULT_PROFILE = {
  name: "rawchat",
  base_url: "https://rawchat.cn/codex",
  model: "gpt-5.6-sol",
  reasoning_effort: "high",
}

function codexDir() {
  return path.join(process.env.USERPROFILE || os.homedir(), ".codex")
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
    const parsed = JSON.parse(await readFile(file, "utf8"))
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

function updateTomlSection(source, sectionName, values, removeKeys = []) {
  const lines = source ? source.replace(/\r\n/g, "\n").split("\n") : []
  if (lines.length === 1 && lines[0] === "") lines.pop()
  const headerPattern = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/
  let start = 0
  let end = lines.length

  if (sectionName) {
    const headerIndex = lines.findIndex((line) => {
      const match = line.match(headerPattern)
      return match && match[1] === sectionName
    })
    if (headerIndex === -1) {
      if (lines.length > 0 && lines.at(-1) !== "") lines.push("")
      lines.push(`[${sectionName}]`)
      for (const [key, value] of Object.entries(values)) lines.push(`${key} = ${value}`)
      return lines.join("\n") + "\n"
    }
    start = headerIndex + 1
    end = lines.length
    for (let index = start; index < lines.length; index++) {
      if (headerPattern.test(lines[index])) {
        end = index
        break
      }
    }
  } else {
    end = lines.findIndex((line) => headerPattern.test(line))
    if (end === -1) end = lines.length
  }

  const changed = new Set()
  for (let index = start; index < end; index++) {
    for (const key of removeKeys) {
      if (new RegExp(`^(\\s*)${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*=`).test(lines[index])) {
        lines[index] = ""
      }
    }
    for (const [key, value] of Object.entries(values)) {
      const match = lines[index].match(new RegExp(`^(\\s*)${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*=`))
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

export function renderCodexConfig(source, profile) {
  const rootValues = { model_provider: '"codex"' }
  const rootRemove = []
  for (const [profileKey, configKey] of [
    ["model", "model"],
    ["model_catalog_json", "model_catalog_json"],
    ["context_window", "model_context_window"],
    ["compact_limit", "auto_compact_token_limit"],
    ["reasoning_effort", "model_reasoning_effort"],
  ]) {
    if (profile[profileKey]) {
      const numeric = profileKey === "context_window" || profileKey === "compact_limit"
      rootValues[configKey] = numeric ? String(profile[profileKey]) : tomlString(profile[profileKey])
    } else {
      rootRemove.push(configKey)
    }
  }
  let result = updateTomlSection(source, "", rootValues, rootRemove)
  result = updateTomlSection(result, "model_providers.codex", {
    name: '"codex"',
    base_url: tomlString(profile.base_url.replace(/\/+$/, "")),
    env_key: '"CODEX_API_KEY"',
  })
  return result
}

export function getCodexBaseUrl(config) {
  const section = config.match(
    /^\s*\[model_providers\.codex\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m,
  )
  return section?.[1].match(/^\s*base_url\s*=\s*"([^"]+)"/m)?.[1] || null
}

async function persistApiKey(apiKey) {
  process.env.CODEX_API_KEY = apiKey
  await new Promise((resolve, reject) => {
    execFile("setx", ["CODEX_API_KEY", apiKey], { windowsHide: true }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function applyProfile(profile) {
  const directory = codexDir()
  const configFile = path.join(directory, "config.toml")
  const original = await readConfig()
  await mkdir(directory, { recursive: true })
  if (original) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    await copyFile(configFile, `${configFile}.toolbox-backup-${stamp}`)
  }
  await writeFile(configFile, renderCodexConfig(original, profile), "utf8")
  await persistApiKey(profile.api_key)
}

async function testEndpoint(profile) {
  const baseUrl = profile.base_url.replace(/\/+$/, "")
  const headers = { Authorization: `Bearer ${profile.api_key}` }
  for (const suffix of ["/health", "/models"]) {
    try {
      const response = await fetch(`${baseUrl}${suffix}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: `Authentication failed (HTTP ${response.status}).` }
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

function printProfile(profile, marker = "") {
  console.log(`${marker}${profile.name}: ${profile.base_url}`)
  console.log(`   model: ${profile.model || "Codex default"}; effort: ${profile.reasoning_effort || "Codex default"}; key: ${maskKey(profile.api_key)}`)
}

async function chooseProfile(profiles, title) {
  const names = profileNames(profiles)
  if (names.length === 0) {
    console.log("\nNo saved endpoints yet.")
    return null
  }
  console.log(`\n${title}`)
  names.forEach((name, index) => console.log(`  ${index + 1}) ${name}  ${profiles[name].base_url}`))
  console.log("  0) Back")
  const answer = await ask("Select: ")
  const number = Number.parseInt(answer, 10)
  return number >= 1 && number <= names.length ? names[number - 1] : null
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
    console.log("  0) Done editing")
    const field = await ask("Select field: ")
    if (field === "1") profile.name = await askDefault("Endpoint name", profile.name)
    if (field === "2") profile.base_url = await askDefault("Base URL", profile.base_url)
    if (field === "3") {
      const key = await askSecret(`API key [${maskKey(profile.api_key)}, Enter to keep]: `)
      if (key) profile.api_key = key
    }
    if (field === "4") profile.model = await askDefault("Model", profile.model || "gpt-5.6-sol")
    if (field === "5") profile.reasoning_effort = await askDefault("Reasoning effort", profile.reasoning_effort || "high")
  }
}

async function addOrEditProfile(profiles, existingName = null) {
  const profile = await configureProfile(existingName ? { ...profiles[existingName], name: existingName } : null)
  if (!profile) return
  if (existingName && profile.name !== existingName) delete profiles[existingName]
  profiles[profile.name] = { ...profile }
  delete profiles[profile.name].name
  await saveProfiles(profiles)
  console.log("Endpoint saved locally.")
}

async function switchEndpoint(profiles) {
  const name = await chooseProfile(profiles, "Switch Codex endpoint")
  if (!name) return
  const profile = profiles[name]
  console.log("Testing endpoint...")
  const result = await testEndpoint(profile)
  console.log(result.message)
  if (!result.ok) {
    const proceed = await ask("Switch anyway? [y/N]: ")
    if (!/^y(es)?$/i.test(proceed)) return
  }
  await applyProfile(profile)
  console.log(`Switched to ${name}. Open a new terminal before starting Codex.`)
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
  const name = profileNames(profiles).find((item) => profiles[item].base_url.replace(/\/+$/, "") === current)
  console.log(`  ${name || "Custom endpoint"}: ${current}`)
}

async function removeProfile(profiles) {
  const name = await chooseProfile(profiles, "Remove saved endpoint")
  if (!name) return
  const confirmation = await ask(`Remove ${name}? [y/N]: `)
  if (!/^y(es)?$/i.test(confirmation)) return
  delete profiles[name]
  await saveProfiles(profiles)
  console.log("Endpoint removed from local saved profiles.")
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
      const name = await chooseProfile(profiles, "Edit saved endpoint")
      if (name) await addOrEditProfile(profiles, name)
    }
    if (choice === "4") {
      const name = await chooseProfile(profiles, "Test endpoint")
      if (name) {
        console.log("Testing endpoint...")
        console.log((await testEndpoint(profiles[name])).message)
      }
    }
    if (choice === "5") await showCurrent(profiles)
    if (choice === "6") await removeProfile(profiles)
  }
}
