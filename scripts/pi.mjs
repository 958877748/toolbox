/**
 * toolbox pi — manage the pi coding agent's default provider/model pair.
 *
 * pi stores provider and model as two separate settings (defaultProvider +
 * defaultModel). Switching only one leaves a stale pair, e.g. provider=kuaipao
 * with model=deepseek-v4-flash — kuaipao rejects it with model_not_found and pi
 * silently falls back to the first available model (usually the old one).
 *
 * This script always writes BOTH together and validates the model against the
 * provider's live model list before applying, so a switch can never land on a
 * dead pair again.
 *
 * Usage (via `toolbox pi ...` or `node bin/cli.js pi ...`):
 *   toolbox pi                     List providers, live models and current default
 *   toolbox pi models [provider]   Show live model lists (kuaipao/rawchat hit the
 *                                  API, others read ~/.pi/agent/models-store.json)
 *   toolbox pi switch <provider> <model> [thinking]   Set default provider+model
 *   toolbox pi fix [--apply]      Migrate a dead default pair to a live model
 *   toolbox pi install-ext [--force]  Install missing pi provider extensions from
 *                                  this package's providers/*.json
 *
 * Options:
 *   --force    Bypass validation when the live list could not be fetched.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PROVIDERS_DIR = fileURLToPath(new URL("../providers/", import.meta.url))

function agentDir() {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent")
}
const settingsFile = () => path.join(agentDir(), "settings.json")
const modelsStoreFile = () => path.join(agentDir(), "models-store.json")
const extensionsDir = () => path.join(agentDir(), "extensions")

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

const LIVE_PROVIDERS = {
  kuaipao: {
    baseUrl: () => process.env.KUAIPAO_BASE_URL || "https://kuaipao.pro/v1",
    apiKey: () => process.env.KUAIPAO_API_KEY || "",
    modelsUrl: (base) => `${base.replace(/\/+$/, "")}/models`,
  },
  rawchat: {
    baseUrl: () => "https://rawchat.cn/codex",
    // The shipped rawchat extension embeds its key; prefer an env var, then the
    // extension file, so the manager can validate just like pi's extension does.
    apiKey: () =>
      process.env.RAWCHAT_API_KEY ||
      readExtensionApiKey("rawchat") ||
      "",
    modelsUrl: (base) => `${base.replace(/\/+$/, "")}/v1/models`,
  },
}

/** Pull an apiKey literal out of an installed pi extension file, if any. */
function readExtensionApiKey(provider) {
  const file = path.join(extensionsDir(), `${provider}.ts`)
  try {
    const source = readFileSync(file, "utf8")
    const match = source.match(/apiKey\s*[:=]\s*["']([^"']+)["']/)
    return match ? match[1] : ""
  } catch {
    return ""
  }
}

// Pick a sane default when the user asks for a provider without a model.
const DEFAULT_MODEL_PREFERENCE = {
  kuaipao: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
  rawchat: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"],
  "opencode-go": ["deepseek-v4-flash", "deepseek-v4-pro"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
}

async function exists(p) {
  try {
    await readFile(p)
    return true
  } catch {
    return false
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

async function readSettings() {
  return readJson(settingsFile(), {})
}

function filterChatModels(ids) {
  return ids
    .filter((id) => /^gpt-/i.test(id))
    .filter((id) => !/image|compact/i.test(id))
    .sort()
}

/** Live model ids for kuaipao/rawchat via their API, or undefined when unreachable. */
async function fetchLiveModels(provider) {
  const def = LIVE_PROVIDERS[provider]
  if (!def) return undefined
  const base = def.baseUrl()
  const key = def.apiKey()
  if (!key) return undefined
  try {
    const url = def.modelsUrl(base)
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return undefined
    const data = await res.json()
    const ids = (data.data || data.models || []).map((m) => m.id)
    return filterChatModels(ids)
  } catch {
    return undefined
  }
}

/** Model ids for catalog-backed providers from pi's cached models-store.json. */
function catalogModels(provider) {
  const store = readJsonSync(modelsStoreFile(), {})
  const entry = store[provider]
  if (!entry) return undefined
  const models = (entry.models || [])
    .map((m) => (typeof m === "string" ? m : m.id))
    .filter(Boolean)
    .sort()
  return models.length > 0 ? models : undefined
}

function readJsonSync(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return fallback
  }
}

/**
 * Best-effort model validation across every source we have.
 * Returns { live, dead } opinions or undefined when nothing could be checked.
 */
async function validateModels(provider, requested) {
  const { default: providerJson } = await import(
    pathToFileURL(path.join(PROVIDERS_DIR, `${provider}.json`)).href
  ).catch(() => ({ default: undefined }))

  const fromApi = await fetchLiveModels(provider)
  const fromCatalog = catalogModels(provider)
  const fromPackage = providerJson?.models ? Object.keys(providerJson.models) : undefined
  const sources = [fromApi, fromCatalog, fromPackage].filter(Boolean)

  if (sources.length === 0) return undefined

  const union = [...new Set(sources.flat())]
  if (requested && !union.includes(requested)) {
    const maybeDead = sources.filter((s) => s.includes(requested)).length === 0
    return { live: union, dead: maybeDead ? requested : undefined }
  }
  return { live: union, dead: undefined }
}

async function suggestDefault(provider) {
  const order = DEFAULT_MODEL_PREFERENCE[provider] || []
  const checked = await validateModels(provider)
  const live = checked?.live
  if (live) {
    const hit = order.find((m) => live.includes(m)) || live[0]
    if (hit) return hit
  }
  return order[0]
}

async function cmdList() {
  const settings = await readSettings()
  const currentProvider = settings.defaultProvider || "(not set)"
  const currentModel = settings.defaultModel || "(not set)"
  const currentThinking = settings.defaultThinkingLevel || "off"
  console.log(`pi agent dir: ${agentDir()}`)
  console.log(`Current default: ${currentProvider}/${currentModel} (thinking: ${currentThinking})`)
  console.log("")
  console.log("Known providers:")
  for (const provider of Object.keys(LIVE_PROVIDERS)) {
    const apiKey = LIVE_PROVIDERS[provider].apiKey()
    const status = apiKey
      ? (await fetchLiveModels(provider)) ? "(live, key ok)" : "(key set, API unreachable)"
      : "(no API key — models not checked)"
    console.log(`  ${provider}  ${status}`)
  }
  for (const provider of ["opencode-go", "deepseek"]) {
    const models = catalogModels(provider)
    console.log(`  ${provider}  ${models ? `(cached: ${models.join(", ")})` : "(no cached catalog)"}`)
  }
}

async function cmdModels(providerArg) {
  const providers = providerArg ? [providerArg] : Object.keys(LIVE_PROVIDERS)
  for (const provider of providers) {
    const fromApi = await fetchLiveModels(provider)
    const fromCatalog = catalogModels(provider)
    const { default: providerJson } = await import(
      pathToFileURL(path.join(PROVIDERS_DIR, `${provider}.json`)).href
    ).catch(() => ({ default: undefined }))
    const fromPackage = providerJson?.models ? Object.keys(providerJson.models) : undefined
    console.log(`\n${provider}:`)
    if (fromApi) console.log(`  live API:  ${fromApi.join(", ")}`)
    if (fromCatalog) console.log(`  catalog:   ${fromCatalog.join(", ")}`)
    if (fromPackage) console.log(`  package:   ${fromPackage.join(", ")}`)
    if (!fromApi && !fromCatalog && !fromPackage) console.log("  (no model source available)")
  }
}

async function cmdSwitch(provider, model, thinking, opts) {
  if (!provider) {
    console.error("usage: toolbox pi switch <provider> <model> [thinking]")
    process.exit(1)
  }
  if (thinking && !THINKING_LEVELS.includes(thinking)) {
    console.error(`invalid thinking level "${thinking}" (choose: ${THINKING_LEVELS.join(", ")})`)
    process.exit(1)
  }
  if (!model) {
    const suggested = await suggestDefault(provider)
    if (!suggested) {
      console.error(`no live model list for "${provider}" and no default preference — pass a model explicitly`)
      process.exit(1)
    }
    console.log(`auto-picked model for ${provider}: ${suggested}`)
    model = suggested
  }

  const checked = await validateModels(provider, model)
  if (checked?.dead && !opts.force) {
    console.error(
      `"${model}" is NOT in ${provider}'s live model list.\n` +
        `available: ${checked.live.join(", ")}\n` +
        `refusing to write a dead default. Use --force to override, or pick one of the available models.`,
    )
    process.exit(1)
  }
  if (!checked && !opts.force) {
    console.warn(
      `could not validate "${model}" against ${provider} (API unreachable or no key).\n` +
        `writing anyway — use --force next time to silence this.`,
    )
  }

  const settings = await readSettings()
  settings.defaultProvider = provider
  settings.defaultModel = model
  if (thinking) settings.defaultThinkingLevel = thinking
  await writeJson(settingsFile(), settings)

  console.log(
    `pi default set to ${provider}/${model}${thinking ? ` (thinking: ${thinking})` : ""}.`,
  )
  console.log("Note: the running session keeps its own model. Restart pi, or press")
  console.log("/model in the picker to switch the current session.")
}

async function cmdFix(opts) {
  const settings = await readSettings()
  const provider = settings.defaultProvider
  const model = settings.defaultModel
  if (!provider || !model) {
    console.log("No default provider/model pair to check (settings look empty).")
    return
  }
  const checked = await validateModels(provider, model)
  if (!checked) {
    console.log(`Cannot validate ${provider}/${model} (no live list reachable). Leaving as-is.`)
    return
  }
  if (!checked.dead) {
    console.log(`${provider}/${model} is in the live model list — nothing to fix.`)
    return
  }
  console.log(`${provider}/${model} is DEAD (not served anymore).`)
  const suggested = await suggestDefault(provider)
  if (!suggested) {
    console.log("No replacement preference — switch manually with: toolbox pi switch <provider> <model>")
    return
  }
  if (!opts.apply) {
    console.log(`candidate: ${provider}/${suggested}\nre-run with --apply to migrate.`)
    return
  }
  await cmdSwitch(provider, suggested, undefined, { ...opts, force: true })
}

/** Install pi provider extensions from this package's providers/*.json if missing. */
async function cmdInstallExt(opts) {
  const dir = extensionsDir()
  await mkdir(dir, { recursive: true })
  let installed = 0
  for (const file of (await readdir(PROVIDERS_DIR)).filter((f) => f.endsWith(".json"))) {
    const provider = file.slice(0, -5)
    const target = path.join(dir, `${provider}.ts`)
    if ((await exists(target)) && !opts.force) {
      console.log(`= ${target} (exists, use --force to overwrite)`)
      continue
    }
    const { default: providerJson } = await import(
      pathToFileURL(path.join(PROVIDERS_DIR, file)).href
    )
    const modelIds = Object.keys(providerJson.models || {})
    const envKey = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`
    const baseUrl = ((providerJson.options || {}).baseURL || "").replace(/\/+$/, "")
    const ext = [
      'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
      "",
      `// Generated by toolbox (providers/${file}). Edit providers/${file} and re-run:`,
      `//   toolbox pi install-ext --force`,
      "",
      "export default async function (pi: ExtensionAPI) {",
      `  const apiKey = process.env.${envKey} || "";`,
      `  const baseUrl = process.env.${envKey.replace("API_KEY", "BASE_URL")} || "${baseUrl}";`,
      "  if (!apiKey) {",
      `    console.error("[${provider}] 未配置 ${envKey}，跳过注册。");`,
      "    return;",
      "  }",
      "  try {",
      "    const response = await fetch(`${baseUrl}/models`, {",
      '      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },',
      "    });",
      "    if (!response.ok) { console.error(`[${provider}] 拉取模型列表失败: ${response.status}`); return; }",
      "    const data = await response.json() as { data?: { id: string }[]; models?: { id: string }[] };",
      "    const modelList = (data.data || data.models || []).map((m) => m.id);",
      "    // Compat: fall back to the packaged model list when the API returns nothing useful.",
      `    const packaged = ${JSON.stringify(modelIds)};`,
      "    const ids = modelList.filter((id) => id.startsWith(\"gpt-\") && !/image|compact/i.test(id));",
      "    const models = (ids.length > 0 ? ids : packaged).map((id) => ({",
      '      id, name: id.toUpperCase().replace(/-/g, " "), reasoning: true,',
      '      thinkingLevelMap: { xhigh: "xhigh", minimal: "low" },',
      '      input: ["text"], contextWindow: 256000, maxTokens: 128000,',
      "    }));",
      '    pi.registerProvider("' + provider + '", { name: "' + providerJson.name + '", baseUrl, apiKey: "$' + envKey + '", api: "openai-responses", models });',
      `    console.log("[${provider}] 已注册 " + models.length + " 个模型");`,
      "  } catch (error) { console.error(`[${provider}] 初始化失败:`, error); }",
      "}",
      "",
    ].join("\n")
    await writeFile(target, ext, "utf8")
    console.log(`+ ${target}`)
    installed++
  }
  console.log(`${installed} extension(s) installed. Restart pi so it registers the providers.`)
}

const scriptIdx = process.argv.findIndex((a) => a.endsWith("pi.mjs"))
const sub = process.argv[scriptIdx + 1]
const rest = process.argv.slice(scriptIdx + 2)
const opts = { force: rest.includes("--force"), apply: rest.includes("--apply") }
const args = rest.filter((a) => !a.startsWith("--"))

async function main() {
  try {
    if (sub === "models") await cmdModels(args[0])
    else if (sub === "switch") await cmdSwitch(args[0], args[1], args[2], opts)
    else if (sub === "fix") await cmdFix(opts)
    else if (sub === "install-ext") await cmdInstallExt(opts)
    else await cmdList()
  } catch (error) {
    console.error(`toolbox pi: ${error.message}`)
    process.exit(1)
  }
}

main()