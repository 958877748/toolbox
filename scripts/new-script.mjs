import { writeFile } from "node:fs/promises"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

const SCRIPTS_DIR = fileURLToPath(new URL("../scripts/", import.meta.url))

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export default async function newScript(args) {
  let name = args[0]
  if (!name) name = await ask("Script name: ")
  name = name.replace(/\.mjs$/, "")
  if (!/^[a-z0-9-]+$/.test(name)) {
    console.error(`invalid script name: ${name}`)
    process.exit(1)
  }
  const file = path.join(SCRIPTS_DIR, `${name}.mjs`)
  const template = `export default async function ${name}(args, { configDir }) {
  console.log("${name} ran with args:", args)
}

`
  try {
    await writeFile(file, template, { flag: "wx" })
    console.log(`+ ${file}`)
  } catch {
    console.error(`already exists: ${name}`)
    process.exit(1)
  }
}
