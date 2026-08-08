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

## Commands

| Command               | Description                              |
| --------------------- | ---------------------------------------- |
| `oct`                 | Interactive provider selection           |
| `oct list`            | List built-in providers                  |
| `oct --force`         | Overwrite local edits                    |
| `OPENCODE_CONFIG_DIR=/x oct` | Install into a custom config dir |

Interactive install:

```
$ oct
Built-in providers:
  1) kuaipao
  2) rawchat
Select (numbers, e.g. 1,2 | a = all | q = quit): 1
+ C:\Users\you\.config\opencode\plugins\provider-registry.js
+ C:\Users\you\.config\opencode\providers\kuaipao.json
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
`oct install <id>` on each machine. For a machine-local one-off provider,
just drop the file into `~/.config/opencode/providers/` yourself:

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

## Publishing updates

```bash
npm version patch
npm publish
```

Check that the package name is still available first:

```bash
npm view @guolei1994/tool
```

## License

MIT
