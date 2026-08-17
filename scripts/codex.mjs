import { readProfiles } from "./codex/profiles.mjs"
import {
  addOrEditProfile,
  ask,
  chooseProfile,
  removeProfile,
  showCurrent,
  switchEndpoint,
} from "./codex/ui.mjs"

export { applyProfile } from "./codex/config.mjs"
export { allEndpoints } from "./codex/profiles.mjs"
export {
  getActiveProviderId,
  getCodexBaseUrl,
  renderBaseConfig,
  renderProfileConfig,
} from "./codex/toml.mjs"

export default async function codex() {
  while (true) {
    const profiles = await readProfiles()
    console.log("\nCodex endpoint manager")
    console.log("  1) Switch endpoint")
    console.log("  2) Add endpoint")
    console.log("  3) Edit endpoint")
    console.log("  4) Show current endpoint")
    console.log("  5) Forget saved API key")
    console.log("  0) Back")
    const choice = await ask("Select: ")
    if (choice === "0") return
    if (choice === "1") await switchEndpoint(profiles)
    if (choice === "2") await addOrEditProfile(profiles)
    if (choice === "3") {
      const selected = await chooseProfile(profiles, "Edit an endpoint")
      if (selected) await addOrEditProfile(profiles, selected.name)
    }
    if (choice === "4") await showCurrent(profiles)
    if (choice === "5") await removeProfile(profiles)
  }
}
