import { readdir } from "node:fs/promises"
import readline from "node:readline"
import { ask } from "../lib/ask.mjs"
import { applyProfile } from "./config.mjs"
import { codexDir, exists, profileFile, readConfig, setEnvVar } from "./env.mjs"
import {
  BUILTIN_PROFILES,
  DEFAULT_ENV_KEY,
  DEFAULT_PROFILE,
  allEndpoints,
  allProfiles,
  assignEndpointId,
  profileNames,
  saveProfiles,
  slugify,
  stripStaleTemplateKeys,
} from "./profiles.mjs"
import { getActiveProviderId, getCodexBaseUrl, envKeyFor, readModelProviders } from "./toml.mjs"
export { ask } from "../lib/ask.mjs"

function maskKey(value) {
  if (!value) return "not set"
  if (value.length <= 8) return "********"
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}


export async function askDefault(label, value) {
  const answer = await ask(`${label} [${value}]: `)
  return answer || value
}

export function askSecret(question) {
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

export async function chooseProfile(profiles, title) {
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

export async function configureProfile(existing = null) {
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

export async function addOrEditProfile(profiles, existingName = null) {
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
    delete profiles[existingName]
  }

  const stored = { ...stripStaleTemplateKeys(profile, existingName || profile.name), id }
  delete stored.name
  profiles[profile.name] = stored
  await saveProfiles(profiles)
  console.log("Endpoint saved locally.")
}

// Switch list source of truth: [model_providers.*] in ~/.codex/config.toml,
// overlaid with saved profiles (api_key, model, ...) from endpoints.json
// and builtin templates; saved endpoints not yet in config are appended.
async function switchEndpoints(savedProfiles) {
  const configProviders = new Map(readModelProviders(await readConfig()).map((p) => [p.id, p]))
  const saved = allProfiles(savedProfiles)
  const merged = []
  for (const [id, provider] of configProviders) {
    const overlay = saved[provider.name] || saved[id] || {}
    merged.push({
      ...overlay,
      ...provider,
      name: provider.name,
      id,
      api_key: provider.api_key || overlay.api_key,
    })
  }
  for (const [name, profile] of Object.entries(saved)) {
    const id = profile.id || slugify(name)
    if (!configProviders.has(id)) merged.push({ ...profile, name, id })
  }
  return Object.fromEntries(merged.map((endpoint) => [endpoint.name, endpoint]))
}

export async function switchEndpoint(profiles) {
  const selected = await chooseProfile(await switchEndpoints(profiles), "Choose a Codex endpoint")
  if (!selected) return
  const { name, profile } = selected

  // Make sure an API key exists (interactive prompt only if not already saved),
  // then persist it as the endpoint's env var. Codex reads the env var;
  // config.toml never carries the token. The key also stays in endpoints.json
  // so the list keeps showing "key saved" and you never set env vars yourself.
  if (!profile.api_key) {
    const key = await askSecret(`API key for ${name}: `)
    if (!key) {
      console.log("An API key is required to switch to this endpoint.")
      return
    }
    profile.api_key = key
  }
  const envKey = envKeyFor(profile)
  await setEnvVar(envKey, profile.api_key)
  console.log(`Key saved to environment variable ${envKey}.`)
  profiles[name] = stripStaleTemplateKeys(profile, name)
  await saveProfiles(profiles)

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

export async function showCurrent(profiles) {
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
      (await exists(profileFile(activeId)))
        ? `  Run with profile: codex --profile ${activeId}`
        : "  No toolbox profile file for the active provider yet.",
    )
  }
  const installed = await listProfileFiles()
  if (installed.length > 0) {
    console.log(`  Installed profiles: ${installed.join(", ")}`)
  }
}

export async function removeProfile(profiles) {
  const selected = await chooseProfile(profiles, "Forget a saved API key")
  if (!selected) return
  const { name } = selected
  if (!profiles[name]?.api_key) {
    console.log("No saved API key for this endpoint.")
    return
  }
  const confirmation = await ask(`Forget the saved API key for ${name}? [y/N]: `)
  if (!/^y(es)?$/i.test(confirmation)) return
  const envKey = envKeyFor({ id: name, ...profiles[name] })
  delete profiles[name].api_key
  await saveProfiles(profiles)
  console.log(`Saved API key forgotten from endpoints.json.`)
  console.log(`The environment variable ${envKey} may still hold the key — remove it with:`)
  console.log(
    process.platform === "win32"
      ? `  reg delete HKCU\\Environment /v ${envKey} /f`
      : `  unset ${envKey}  (and remove the export line from ~/.profile)`,
  )
}
