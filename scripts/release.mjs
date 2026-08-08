import { execSync } from "node:child_process"

export default async function release() {
  const version = execSync("npm version patch --no-git-tag-version", {
    encoding: "utf8",
  }).trim()
  console.log(`version bumped: ${version}`)
  execSync("npx -y npm@latest stage publish", { stdio: "inherit" })
  console.log(
    "\nStaged. Now approve it in the browser:\n" +
      "  npmjs.com -> Settings -> Staged Packages -> Approve (enter 2FA)",
  )
}
