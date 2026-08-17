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
kuaipao/gpt-5.4
kuaipao/gpt-5.4-mini
kuaipao/gpt-5.5
kuaipao/gpt-5.6-sol
kuaipao/gpt-5.6-terra
```

> Note: models are only listed if the provider currently serves them. Kuaipao
> removed `gpt-5.6-luna`; any stale picker entry for it fails with HTTP 503
> `model_not_found`. If you see a dead model, update the provider file or use
> the `pi` script (`toolbox pi fix`) which syncs live model lists.

The same menu includes **Manage Codex endpoints**, with built-in templates for
RawChat, OpenCode Go, and DeepSeek. API keys are never included in the package:
enter a key only when first selecting an endpoint. Keys are saved in local
`~/.codex/endpoints.json` and written into each endpoint's
`[model_providers.<id>]` section in `~/.codex/config.toml` as
`experimental_bearer_token`. Endpoint sections are only ever added or updated,
never deleted, so any number of endpoints can coexist in one config. Endpoints
without a saved key fall back to their environment variable
(`RAWCHAT_API_KEY`, `CODEX_API_KEY`, `DEEPSEEK_API_KEY`; custom endpoints
default to `CODEX_API_KEY`). The config is parsed with `smol-toml`, modified
as a TOML object, and serialized back; existing keys and sections are
preserved, but comments and manual formatting in `config.toml` are not kept
across a switch. Switching an endpoint only updates the root
`model_provider` / `model` / `model_catalog_json` values (`model_catalog_json`
is written as a relative per-endpoint file such as `deepseek.json`, resolved
by Codex against `~/.codex`). GPT models (`gpt-*`) do not need a model
catalog, so the `model_catalog_json` line is only written for non-GPT models
like `deepseek-v4-flash`; switching to a GPT endpoint removes a stale catalog
line from the root config.

Switching an endpoint installs **all** known endpoints into
`~/.codex/config.toml` under `[model_providers.<id>]` and writes one profile
file per endpoint: `~/.codex/<id>.config.toml`. Start Codex with:

    codex --profile <id>

Running plain `codex` keeps using the most recently switched endpoint.
Endpoints that need custom model metadata (OpenCode Go, DeepSeek) also get the
packaged catalog installed to a per-endpoint file such as
`~/.codex/opencode-go.json` or `~/.codex/deepseek.json`, with a matching
`model_catalog_json` entry written into the profile, so Codex uses the
correct model metadata instead of fallback defaults.

## Commands

| Command               | Description                              |
| --------------------- | ---------------------------------------- |
| `oct`                 | Interactive: pick providers to install or scripts to run |
| `oct <script>`        | Run a script directly (optional)         |
| `oct list`            | List providers and scripts               |
| `oct --force`         | Overwrite local edits                    |
| `OPENCODE_CONFIG_DIR=/x oct` | Install into a custom config dir |
| `oct pi ...`          | Manage the pi coding agent's default provider/model pair |

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

### pi script

pi stores the default model as two separate settings (`defaultProvider` +
`defaultModel`). Switching only one leaves a dead pair — e.g. provider=kuaipao
with model=deepseek-v4-flash gets rejected with HTTP 503 `model_not_found`, and
pi silently falls back to the old model. `oct pi switch` always writes both
fields together and validates the model against the provider's **live** model
list first:

```
$ oct pi list                       # current default + live model sources
$ oct pi models kuaipao             # live API model list for a provider
$ oct pi switch kuaipao gpt-5.6-terra   # set provider+model atomically
$ oct pi switch kuaipao gpt-5.6-luna    # REJECTED: luna is no longer served
$ oct pi fix --apply                # migrate a dead default to a live model
$ oct pi install-ext                # install missing pi provider extensions
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
