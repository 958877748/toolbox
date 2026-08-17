# toolbox — AI agent guide

`@guolei1994/tool` is the user's personal npm toolbox: distributes opencode
provider endpoints and small scripts to any machine with one interactive
command (`npx @guolei1994/tool`). GitHub: https://github.com/958877748/toolbox

## Layout

- `providers/<id>.json` — opencode provider definitions; filename = provider ID
- `scripts/<name>.mjs` — runnable scripts; filename = command name
- `scripts/codex.mjs` — Codex endpoint manager: keeps every endpoint in
  `~/.codex/config.toml`'s `[model_providers.*]` (add/update only, never
  removes sections or keys), writes one `~/.codex/<id>.config.toml` profile
  per endpoint, switches with `codex --profile <id>`; internals live in
  `scripts/codex/` (profiles, TOML parse/render via `smol-toml`, config sync,
  UI)
- `scripts/pi.mjs` — pi agent model manager: switches `~/.pi/agent/settings.json`
  `defaultProvider` + `defaultModel` (+ thinking) atomically, validates the model
  against the provider's live model list (kuaipao/rawchat hit their APIs,
  opencode-go/deepseek read pi's cached models-store), and auto-migrates dead
  pairs (e.g. kuaipao removed `gpt-5.6-luna`; requests now 503 `model_not_found`)
- `bin/cli.js` — CLI: interactive menu mixing both kinds, `list`, direct run
- `index.js` — the opencode plugin registry (copied to `~/.config/opencode/plugins/`)

pi extensions the user installs live in `~/.pi/agent/extensions/`: they register
providers with `pi.registerProvider()` using a live `/models` fetch, so their
model lists are never stale at runtime (unlike static provider files like
`providers/kuaipao.json`, which must be updated when an upstream removes a model).

## Adding a script

1. Create `scripts/<name>.mjs` exporting a default async function:
   ```js
   export default async function myname(args, { configDir }) {
     // args: array of positional arguments
   }
   ```
   The function is optional — a module with side effects also works.
2. Test locally: `node bin/cli.js <name>` (or interactively: `node bin/cli.js`).

## Adding a provider

1. Create `providers/<id>.json` (schema: `npm`, `name`, `options.baseURL`,
   `models`).
2. Test: `OPENCODE_CONFIG_DIR=<tempdir> node bin/cli.js`, select the provider,
   then verify with `opencode models <id>`.

## Testing

- `node --check bin/cli.js`
- Interactive flows via piped stdin: `echo "1" | node bin/cli.js`
- Always use a temp `OPENCODE_CONFIG_DIR`, never the real config.

## Releasing (IMPORTANT — user does the final step)

1. `git add -A && git commit -m "..."`
2. `node bin/cli.js release` (bumps version, stages to npm)
   — or manually: `npm version patch --no-git-tag-version`, then
   `npx -y npm@latest stage publish`
3. Tell the user: **browser → npmjs.com → Settings → Staged Packages →
   Approve** (they must enter their 2FA; you cannot and should not do this
   for them). Wait for confirmation.
4. After approval: `git push` and verify with `npm view @guolei1994/tool version`.

Never run `npm publish` directly on this account — it fails with EOTP and
the user prefers the staged web-approval flow.
