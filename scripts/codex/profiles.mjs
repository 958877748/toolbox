import { mkdir, readFile, writeFile } from "node:fs/promises"
import { codexDir, endpointsFile } from "./env.mjs"

export const DEFAULT_ENV_KEY = "CODEX_API_KEY"

export const BUILTIN_PROFILES = {
  rawchat: {
    base_url: "https://rawchat.cn/codex",
    model: "gpt-5.6-terra",
    context_window: 270000,
    reasoning_effort: "max",
    env_key: "RAWCHAT_API_KEY",
  },
  "opencode-go": {
    base_url: "https://opencode.ai/zen/go/v1",
    model: "deepseek-v4-flash",
    model_catalog_json: "opencode-go.json",
    context_window: 270000,
    reasoning_effort: "max",
    env_key: "CODEX_API_KEY",
  },
  deepseek: {
    base_url: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    model_catalog_json: "deepseek.json",
    context_window: 270000,
    reasoning_effort: "max",
    env_key: "DEEPSEEK_API_KEY",
  },
}

export const DEFAULT_PROFILE = {
  name: "custom",
  base_url: "https://rawchat.cn/codex",
  model: "gpt-5.6-terra",
  context_window: 270000,
  reasoning_effort: "max",
  env_key: DEFAULT_ENV_KEY,
}

export function slugify(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "endpoint"
}

export function validEnvKey(value) {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : null
}

export function isGptModel(model) {
  return /^gpt/i.test(String(model || ""))
}

export function assignEndpointId(endpoints, name, preferredId) {
  const ids = new Set(endpoints.map((endpoint) => endpoint.id).filter(Boolean))
  const base = preferredId || slugify(name)
  let id = base
  for (let index = 2; ids.has(id); index++) id = `${base}-${index}`
  return id
}

export function profileNames(profiles) {
  return Object.keys(profiles).sort((a, b) => a.localeCompare(b))
}

const TEMPLATE_MANAGED_KEYS = ["context_window", "model_catalog_json", "env_key"]

// Fields derived from the endpoint name/id or fixed by the templates that must
// not be persisted into endpoints.json (they are recomputed on every read).
const DERIVED_KEYS = ["id", "name", "wire_api"]

export function stripStaleTemplateKeys(profile, name) {
  const result = { ...profile }
  for (const key of DERIVED_KEYS) delete result[key]
  const builtin = BUILTIN_PROFILES[name]
  if (!builtin) return result
  for (const key of TEMPLATE_MANAGED_KEYS) {
    if (builtin[key] === undefined || result[key] === builtin[key]) delete result[key]
  }
  return result
}

export function allProfiles(savedProfiles) {
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

export async function readProfiles() {
  const file = endpointsFile()
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

export async function saveProfiles(profiles) {
  await mkdir(codexDir(), { recursive: true })
  await writeFile(endpointsFile(), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")
}
