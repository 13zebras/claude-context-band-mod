# context-band

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that shows a detailed, live breakdown of your context window in a band directly above the prompt, so you can see what is filling the window, how fast it is growing, and how long until auto-compaction, without running `/context`.

It is built to sit next to a custom status line rather than repeat it: there is no model name, effort, rate-limit or git information here, only the context window.

## What it shows

### Summary line (always on)

```
60k / 200k · autocompact @167k (107k left) · ▂▃▃▄▅ +10k/turn · ~11 turns to compact     p: pane  c: more
```

- **Fill**: input tokens in the window over the model's window size, coloured green → yellow → orange → red as it fills. A leading `~` means the figure is an estimate (before the first response, or right after a compaction).
- **Autocompact**: the token count where auto-compaction runs and how far away it is (`autocompact off` or `autocompact due` when that applies).
- **Trend**: a sparkline of the fill after each of the last 16 turns, each bar coloured by how full the window was, then the average growth per turn and an estimate of the turns left before auto-compaction.

### Expanded view (`c: more`)

```
60k / 200k · autocompact @167k (107k left) · ▂▃▃▄▅ +10k/turn · ~11 turns to compact     r: exact  p: pane  c: less
████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
█ System prompt 3k  █ System tools 12k  █ Memory files 4.2k  █ Messages 41k  ░ Free space 107k  ▒ Autocompact buffer 33k  estimated
Deferred MCP tools 45k · System tools 12k
Memory   .claude/CLAUDE.md 1.2k (User) · memory/MEMORY.md 2.1k (AutoMem)
MCP      linear 5.1k 12/40 loaded · neon 2.4k 3/70 loaded
Listings skills 2k 48/52 · agents 1.1k 6 · commands 400 30/31
Cache    read 57k · wrote 2k · uncached 1k · output 2k → 95% hit
Session  $1.50 · last turn +8.2k · 1 compaction, last 162k → 18k (auto)
```

- **Category bar**: one stacked bar across the band, each category in its own colour, with free space (`░`) and the compaction buffer (`▒`) in grey, and a legend with every category's tokens.
- **Deferred**: tool schemas that load on demand and sit outside the window, on a row of their own.
- **Memory**: every CLAUDE.md, rules and auto-memory file in the context, largest first.
- **MCP**: tokens per server and how many of its tools are loaded.
- **Listings**: what the skill, agent and slash-command listings cost.
- **Cache**: the last response's cache read / write / uncached / output tokens and the cache hit rate.
- **Session**: cost so far, the last turn's growth, and compaction history.

### Side pane (`p: pane`)

Everything, unabridged, in a pane that docks beside the conversation in fullscreen mode (or opens above the prompt otherwise) and scrolls:

- a 10×10 grid of the window, one square per 1%, beside a table of every category with its tokens and share
- the deferred tool schemas
- the full trend: every measured turn, average and last-turn growth, turns to compaction
- every memory file with its full path
- every MCP server with every one of its tools (unloaded tools dimmed)
- every skill and agent with its listing cost
- the slash-command listing, cache figures, cost and every compaction

### Alerts

A toast when the context window, the 5-hour limit or the 7-day limit crosses **80%** and again at **90%**, once each; it re-arms when the figure drops back below.

## Keys and commands

| Do | How |
| --- | --- |
| Show more / less | `ctrl+x c` from the prompt (after the one-time setup below), or `ctrl+x tab` then `c`, or click `c: more`, or `/ctx` |
| Open the side pane | `ctrl+x tab` then `p`, or click `p: pane`, or `/ctx pane` |
| Count tokens exactly | `ctrl+x tab` then `r` (expanded view or pane), or `/ctx full` |
| Collapse the band entirely | `ctrl+x ctrl+a` (Claude Code's own band toggle) |
| Close the pane | `ctrl+x x` |
| Leave the band or pane | `esc` |

`ctrl+x tab` focuses the band; while it has focus, its letter hotkeys work and the arrow keys scroll.

Counts are **estimated** by default, computed locally at no cost after every turn. **Exact** counting asks the token-count API once per tool and memory file, as `/context` does, so it is on demand only; the legend says which you are looking at.

### One-time setup for `ctrl+x c`

A mod cannot define a keyboard shortcut of its own, so the band's toggle borrows a built-in action, `app:cycleDiffBase`, which is otherwise only used while the diff sidebar is open. Add this line to the `Chat` context in `~/.claude/keybindings.json` (create the file if you have none):

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+x c": "app:cycleDiffBase"
      }
    }
  ]
}
```

While the diff sidebar is open, `ctrl+x c` goes to the sidebar instead of the band. `ctrl+c` cannot be used in the chord: Claude Code reserves it for interrupt and exit.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install context-band --marketplace 13zebras/claude-context-band-mod
```

Answer `y` to add the marketplace, then pick a scope (the user scope loads it in every session). The band appears above the prompt straight away.

From a shell:

```
claude plugin install context-band --marketplace 13zebras/claude-context-band-mod
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `13zebras/claude-context-band-mod`, then **Add plugin**.

To remove it, from a shell: `claude plugin uninstall context-band`.

## Requirements and notes

- A Claude Code build with mods (function hooks). Mods are early access and their API can change between releases; this was written against Claude Code 2.1.309.
- Draws in the terminal and the desktop app (the band is only raised there); the side pane draws on every surface.
- The figures are always the main conversation's, also while a subagent's transcript is on screen (the band then says `main session`).
- The trend needs two turns before it shows; it restarts after `/clear`.

## Development

```
hooks/register.tsx   state and hooks: measuring, alerts, compactions, /ctx, render hooks
hooks/draw.tsx       the band and the pane
hooks/shared.ts      formatting, colours, the snapshot taken from $.session.usage()
types/index.d.ts     the $.state contract
tests/band.test.tsx  tests
```

Run from the repository folder:

```
claude plugin validate .
claude plugin test .
```

To work on it live, start a session with `claude --plugin-dir <this folder>`: saving a file reloads the mod. Once Claude Code has loaded it, `.claude-plugin/types/` holds the API's type declarations and `tsc -p .` type-checks the mod.
