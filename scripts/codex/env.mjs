import { readFile, stat, appendFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import os from "node:os"
import path from "node:path"

const execFileAsync = promisify(execFile)

export function codexDir() {
  return (
    process.env.CODEX_HOME ||
    path.join(process.env.USERPROFILE || os.homedir(), ".codex")
  )
}

export async function exists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

export const configFile = () => path.join(codexDir(), "config.toml")
export const endpointsFile = () => path.join(codexDir(), "endpoints.json")
export const profileFile = (id) => path.join(codexDir(), `${id}.config.toml`)

export async function readConfig() {
  try {
    return await readFile(configFile(), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return ""
    throw error
  }
}

// Persist an API key as a user environment variable so codex can read it on
// either platform without any API key ever touching config.toml.
//   Windows: HKCU\Environment via reg add (persists across reboots, codex reads
//            it because the var is a real user env var, no shell needed).
//   Linux/macOS: append `export NAME="value"` to the user's shell rc file
//            (first existing of ~/.zshrc, ~/.bashrc, ~/.profile).
export async function setEnvVar(name, value) {
  name = String(name).trim().replace(/[^A-Za-z0-9_]/g, "_")
  value = String(value).replace(/["\\$]/g, "\\$&")

  if (process.platform === "win32") {
    await execFileAsync("reg", [
      "add", "HKCU\\Environment",
      "/v", name, "/t", "REG_SZ", "/d", value, "/f",
    ])
    return
  }

  const candidates = [".zshrc", ".bashrc", ".profile"]
  for (const file of candidates) {
    const shellFile = path.join(os.homedir(), file)
    const existing = await readFile(shellFile, "utf8").catch(() => null)
    if (existing === null) continue
    if (!existing.includes(`export ${name}=`)) {
      await appendFile(shellFile, `\nexport ${name}="${value}"\n`, "utf8")
    }
    return
  }
  throw new Error("No shell rc file (~/.zshrc, ~/.bashrc, ~/.profile) found to store the key.")
}
