import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = fileURLToPath(new URL("..", import.meta.url))
const sourcePath = resolve(rootDir, "src/index.js")
const outputPath = resolve(rootDir, "dist/browser.js")

const source = await readFile(sourcePath, "utf8")
const lines = source.split("\n")

while (lines.length && lines[lines.length - 1] === "") {
  lines.pop()
}

if (!lines[0] || !lines[0].startsWith("export function bindTopographyToggle")) {
  throw new Error("Unexpected source format in src/index.js")
}

lines[0] = lines[0].replace(/^export\s+/, "")

const body = lines
  .map(function (line) {
    return line ? "  " + line : ""
  })
  .join("\n")

const output = `;(function (global) {
  "use strict"

${body}

  global.TopographyToggle = {
    bindTopographyToggle: bindTopographyToggle,
  }
})(typeof globalThis !== "undefined" ? globalThis : window)
`

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, output)
