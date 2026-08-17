import { copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { codexDir, configFile, exists, profileFile, readConfig } from "./env.mjs"
import { DEFAULT_ENV_KEY, allEndpoints, isGptModel, slugify, validEnvKey } from "./profiles.mjs"
import { renderBaseConfig, renderProfileConfig } from "./toml.mjs"

const PKG_ROOT = fileURLToPath(new URL("../../", import.meta.url))
const BUILTIN_CATALOG = path.join(PKG_ROOT, "codex-catalogs", "models.json")
const BUILTIN_CATALOGS = new Map([
  ["opencode-go.json", BUILTIN_CATALOG],
  ["deepseek.json", BUILTIN_CATALOG],
])

export async function ensureCatalog(profile) {
  const configured = profile.model_catalog_json
  if (!configured || isGptModel(profile.model)) return undefined
  const source = BUILTIN_CATALOGS.get(configured)
  if (!source) return configured
  const destination = path.join(codexDir(), configured)
  if (!(await exists(destination))) {
    await mkdir(codexDir(), { recursive: true })
    await copyFile(source, destination)
    console.log(`+ ${destination} (bundled model catalog installed)`)
  }
  return configured
}

export async function applyProfile(savedProfiles, selected) {
  const directory = codexDir()
  const configPath = configFile()
  const original = await readConfig()
  await mkdir(directory, { recursive: true })
  if (original) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    await copyFile(configPath, `${configPath}.toolbox-backup-${stamp}`)
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
  await writeFile(configPath, renderBaseConfig(original, endpoints, selectedWithId.id), "utf8")
  await writeFile(profileFile(selectedWithId.id), renderProfileConfig(selectedWithId), "utf8")
  console.log(`Switched to ${selectedWithId.name} (provider: ${selectedWithId.id}).`)
  console.log(`Run Codex with: codex --profile ${selectedWithId.id}`)
  console.log("Plain `codex` also uses this endpoint until you switch again.")
  console.log("The saved API key is written into config.toml for this endpoint.")
}
