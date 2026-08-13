# toolbox

A toolbox for [opencode](https://opencode.ai): declarative provider
definitions, installed on any machine with one command. No config file
editing, no hardcoded provider IDs.

## Install

```bash
npx @guolei1994/tool
```

Or install the CLI globally for repeat runs:

```bash
npm install -g @guolei1994/tool
oct
```

Then restart opencode. The provider appears in the model picker:

```bash
opencode models kuaipao
kuaipao/gpt-5.6-luna
kuaipao/gpt-5.6-sol
kuaipao/gpt-5.6-terra
```

The same menu includes **Manage Codex endpoints**, with built-in templates for
RawChat, OpenCode Go, and DeepSeek. API keys are never included in the package:
enter a key only when first selecting an endpoint; keys are saved solely in the
local `~/.codex/endpoints.json` and exported to per-endpoint environment
variables when you switch (`RAWCHAT_API_KEY`, `CODEX_API_KEY`,
`DEEPSEEK_API_KEY`; custom endpoints default to `CODEX_API_KEY`).

Switching an endpoint installs **all** known endpoints into
`~/.codex/config.toml` under `[model_providers.<id>]` and writes one profile
file per endpoint: `~/.codex/<id>.config.toml`. Start Codex with:

    codex --profile <id>

Running plain `codex` keeps using the most recently switched endpoint.
Endpoints that need custom model metadata (OpenCode Go, DeepSeek) also get the
packaged catalog `codex-catalogs/models.json` installed to `~/.codex/models.json`
and a `model_catalog_json` entry written into the profile, so Codex uses the
correct model metadata instead of fallback defaults.

## Commands

| Command               | Description                              |
| --------------------- | ---------------------------------------- |
| `oct`                 | Interactive: pick providers to install or scripts to run |
| `oct <script>`        | Run a script directly (optional)         |
| `oct list`            | List providers and scripts               |
| `oct --force`         | Overwrite local edits                    |
| `OPENCODE_CONFIG_DIR=/x oct` | Install into a custom config dir |

Interactive selection mixes both kinds — providers are marked `[p]`, scripts
`[s]`. Pick a number to install a provider or run a script; `a` does all:

```
$ oct
Available:
  1) [p] kuaipao
  2) [p] rawchat
  3) [s] hello
Select (numbers, e.g. 1,2 | a = all | q = quit): 1,3
+ C:\Users\you\.config\opencode\plugins\provider-registry.js
+ C:\Users\you\.config\opencode\providers\kuaipao.json
hello from toolbox (configDir: C:\Users\you\.config\opencode)
```

## How it works

- A small opencode plugin (`provider-registry.js`) is copied into
  `~/.config/opencode/plugins/` and auto-loaded at startup (no `plugin:`
  entry needed in `opencode.json`).
- The provider file is copied into `~/.config/opencode/providers/<id>.json`.
- The filename of each JSON file becomes the opencode provider ID.
- Local overrides win: files already present are never overwritten unless
  you pass `--force`.

## Adding a provider

Add a JSON file to `providers/` in this package, then republish and re-run
`oct` on each machine. For a machine-local one-off provider, just drop the
file into `~/.config/opencode/providers/` yourself:

```json
{
  "npm": "@ai-sdk/openai",
  "name": "My Endpoint",
  "options": {
    "baseURL": "https://example.com/v1"
  },
  "models": {
    "my-model": {
      "name": "My Model",
      "reasoning": true,
      "tool_call": true,
      "limit": { "context": 128000, "output": 65536 },
      "modalities": { "input": ["text"], "output": ["text"] }
    }
  }
}
```

## Adding a script

Scripts are plain `.mjs` modules in `scripts/` of this package. The filename
is the command name. Run them on any machine with:

```bash
oct <script-name> [args...]
```

Convention: export a default async function; it receives the positional
arguments and a context object:

```js
// scripts/hello.mjs
export default async function hello(args, { configDir }) {
  console.log(`hello from toolbox (configDir: ${configDir})`)
}
```

Scripts can import anything from `node:` built-ins (or add dependencies to
`package.json`). Republish and every machine gets the new script via
`npx @guolei1994/tool <name>`.

## Publishing updates

```bash
npm version patch
npm stage publish
```

Then approve the staged version on the npm website (Staged Packages page).

## License

MIT
