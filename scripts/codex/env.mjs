import { readFile, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

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
