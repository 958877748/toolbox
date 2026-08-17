// Shared line-question helper.
// - TTY: one fresh readline interface per question (compatible with raw-mode askSecret).
// - Pipe: a self-managed line queue, so all piped lines survive across questions
//   even when they arrive before the first question is asked. EOF answers "0" (Back)
//   so scripted flows exit cleanly instead of hanging.

import readline from "node:readline"

const isTTY = Boolean(process.stdin.isTTY)
const queue = []
let buffer = ""
let ended = false
let pending = null
let pumping = false

function pump() {
  if (pending && queue.length > 0) {
    const resolve = pending
    pending = null
    resolve(queue.shift())
  }
}

function startPump() {
  if (pumping) return
  pumping = true
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => {
    buffer += chunk
    let idx
    while ((idx = buffer.indexOf("\n")) >= 0) {
      queue.push(buffer.slice(0, idx).replace(/\r$/, ""))
      buffer = buffer.slice(idx + 1)
      pump()
    }
  })
  process.stdin.on("end", () => {
    if (buffer) queue.push(buffer.replace(/\r$/, ""))
    buffer = ""
    ended = true
    pump()
    if (pending) {
      const resolve = pending
      pending = null
      resolve("0")
    }
  })
}

export function ask(question) {
  if (isTTY) {
    return new Promise((resolve) => {
      const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
      terminal.question(question, (answer) => {
        terminal.close()
        resolve(answer.trim())
      })
    })
  }
  startPump()
  return new Promise((resolve) => {
    if (queue.length > 0) {
      resolve(queue.shift().trim())
    } else if (ended) {
      resolve("0")
    } else {
      pending = (line) => resolve(line.trim())
    }
  })
}
