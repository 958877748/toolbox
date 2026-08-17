import { parse, stringify } from "smol-toml"
import { DEFAULT_ENV_KEY, isGptModel, validEnvKey } from "./profiles.mjs"

export function parseConfig(source) {
  if (!source || !source.trim()) return {}
  try {
    return parse(source)
  } catch (error) {
    throw new Error(`Could not parse ~/.codex/config.toml as TOML: ${error.message}`)
  }
}

export function renderBaseConfig(source, endpoints, selectedId) {
  const config = parseConfig(source)
  const selected = endpoints.find((endpoint) => endpoint.id === selectedId) || endpoints[0]

  config.model_provider = selected.id
  if (selected.model) config.model = selected.model
  if (selected.model_catalog_json && !isGptModel(selected.model)) {
    config.model_catalog_json = selected.model_catalog_json
  } else if (isGptModel(selected.model)) {
    delete config.model_catalog_json
  }

  config.model_providers ??= {}
  for (const endpoint of endpoints) {
    const section = (config.model_providers[endpoint.id] ??= {})
    section.name = endpoint.name
    section.base_url = (endpoint.base_url || "").replace(/\/+$/, "")
    section.wire_api = "responses"
    if (endpoint.api_key) {
      section.experimental_bearer_token = endpoint.api_key
    } else {
      section.env_key = validEnvKey(endpoint.env_key) || DEFAULT_ENV_KEY
    }
  }

  return stringify(config)
}

export function renderProfileConfig(profile) {
  const config = { model_provider: profile.id }
  for (const [profileKey, configKey] of [
    ["model", "model"],
    ["model_catalog_json", "model_catalog_json"],
    ["context_window", "model_context_window"],
    ["reasoning_effort", "model_reasoning_effort"],
  ]) {
    if (!profile[profileKey]) continue
    if (profileKey === "model_catalog_json" && isGptModel(profile.model)) continue
    config[configKey] = profile[profileKey]
  }
  return stringify(config)
}

export function readModelProviders(source) {
  const config = parseConfig(source)
  return Object.entries(config.model_providers || {}).map(([id, section]) => ({
    id,
    name: section.name || id,
    base_url: section.base_url || "",
    wire_api: section.wire_api || null,
    env_key: section.env_key || null,
    api_key: section.experimental_bearer_token || null,
  }))
}

export function getCodexBaseUrl(source) {
  const config = parseConfig(source)
  const providers = config.model_providers || {}
  const activeId = config.model_provider
  const section = (activeId && providers[activeId]) || Object.values(providers)[0]
  return section?.base_url || null
}

export function getActiveProviderId(source) {
  return parseConfig(source).model_provider || null
}
