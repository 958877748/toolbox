import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PROVIDERS_DIR = fileURLToPath(new URL("../providers/", import.meta.url))

function deepMerge(base, override) {
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing = out[key]
      out[key] =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? deepMerge(existing, value)
          : value
    } else {
      out[key] = value
    }
  }
  return out
}

export const ProviderRegistry = async () => ({
  config: async (config) => {
    const files = await readdir(PROVIDERS_DIR)
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const id = file.slice(0, -5)
      try {
        const provider = JSON.parse(
          await readFile(path.join(PROVIDERS_DIR, file), "utf8"),
        )
        if (!provider || typeof provider !== "object" || Array.isArray(provider))
          continue
        config.provider ??= {}
        config.provider[id] = deepMerge(provider, config.provider[id] ?? {})
      } catch (err) {
        console.warn(`[provider-registry] skipped ${file}: ${err.message}`)
      }
    }
  },
})
