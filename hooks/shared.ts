import type { SessionUsage } from 'claude-code'

import type { Category, Item, McpServer, Point, Snapshot } from '../types'

const SPARKS = '▁▂▃▄▅▆▇█'

// The palette of statusline-command.sh, so the band matches the status line
export const RED = '#ff0014'
const ORANGE = '#ff6400'
const YELLOW = 'yellow'
const YELLOW_GREEN = '#78d200'
const GREEN = '#28c800'
const OLIVE = '#64aa32'
const BLUE = '#3c82ff'
const DARK_BLUE = '#3c5aff'
const PURPLE = '#be28ff'
const MAGENTA = '#ff00c8'
const CYAN = '#00b4c8'
const BROWN = '#a0785f'
const GRAY = '#78787d'
const DARK_GRAY = '#5a5a5a'

const CATEGORY_COLORS = [BLUE, PURPLE, MAGENTA, ORANGE, YELLOW, OLIVE, CYAN, BROWN, DARK_BLUE]

export type Run = { text: string; color: string }
export type Segment = Category & Run
export type Entry = Item & { note?: string; isDim?: boolean }

// Same thresholds as pct_color in the status line
export function pctColor(percent: number): string {
  if (percent >= 90) return RED
  if (percent >= 70) return ORANGE
  if (percent >= 50) return YELLOW
  if (percent >= 40) return YELLOW_GREEN
  return GREEN
}

export function fmt(tokens: number): string {
  const n = Math.abs(tokens)
  const sign = tokens < 0 ? '-' : ''
  if (n < 1000) return `${sign}${Math.round(n)}`
  if (n < 100_000) return `${sign}${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${sign}${Math.round(n / 1000)}k`
  return `${sign}${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
}

export const signed = (tokens: number) => `${tokens >= 0 ? '+' : ''}${fmt(tokens)}`
export const shortPath = (path: string) => path.split('/').slice(-2).join('/')
const byTokens = (a: { tokens: number }, b: { tokens: number }) => b.tokens - a.tokens

// Joins neighbouring cells of one colour into a single Text run
export function joinRuns(cells: Run[]): Run[] {
  const out: Run[] = []
  for (const cell of cells) {
    const last = out.at(-1)
    if (last?.color === cell.color) last.text += cell.text
    else out.push({ ...cell })
  }
  return out
}

export function chunk<T>(list: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, (i + 1) * size),
  )
}

export function toSnapshot(usage: SessionUsage, isExact: boolean): Snapshot | null {
  const { context, cost } = usage
  const breakdown = context.breakdown
  if (!breakdown) return null

  const servers = new Map<string, McpServer>()
  for (const tool of breakdown.mcpTools) {
    const server = servers.get(tool.serverName) ?? {
      name: tool.serverName,
      tokens: 0,
      loaded: 0,
      total: 0,
      tools: [],
    }
    server.total += 1
    if (tool.isLoaded) {
      server.loaded += 1
      server.tokens += tool.tokens
    }
    server.tools.push({
      name: tool.name.replace(/^mcp__.+?__/, ''),
      tokens: tool.tokens,
      isLoaded: tool.isLoaded,
    })
    servers.set(tool.serverName, server)
  }
  for (const server of servers.values()) server.tools.sort(byTokens)

  const { skills, slashCommands, apiUsage, agents } = breakdown

  return {
    tokens: context.tokens,
    window: context.window,
    estimated: breakdown.totalTokens,
    compactAt: breakdown.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined,
    categories: breakdown.categories.map(({ name, tokens, kind }) => ({ name, tokens, kind })),
    memoryFiles: breakdown.memoryFiles
      .map(({ path, type, tokens }) => ({ path, type, tokens }))
      .sort(byTokens),
    mcpServers: [...servers.values()].sort(byTokens),
    agents: {
      tokens: agents.reduce((n, agent) => n + agent.tokens, 0),
      included: agents.length,
      total: agents.length,
      items: agents.map(agent => ({ name: agent.agentType, tokens: agent.tokens })).sort(byTokens),
    },
    skills: skills && {
      tokens: skills.tokens,
      included: skills.includedSkills,
      total: skills.totalSkills,
      items: skills.skillFrontmatter
        .map(skill => ({ name: skill.name, tokens: skill.tokens }))
        .sort(byTokens),
    },
    commands: slashCommands && {
      tokens: slashCommands.tokens,
      included: slashCommands.includedCommands,
      total: slashCommands.totalCommands,
      items: [],
    },
    cache: apiUsage
      ? {
          read: apiUsage.cache_read_input_tokens,
          written: apiUsage.cache_creation_input_tokens,
          uncached: apiUsage.input_tokens,
          output: apiUsage.output_tokens,
        }
      : undefined,
    cost: cost?.usd,
    isExact,
  }
}

// Growth per turn since the last compaction: the last turn's, and the
// average of the last five
export function trend(points: Point[]) {
  const deltas = points.slice(1).map((point, i) => point.tokens - (points[i]?.tokens ?? 0))
  const sinceCompaction = deltas.slice(deltas.findLastIndex(d => d < 0) + 1).slice(-5)
  const average = sinceCompaction.length
    ? sinceCompaction.reduce((n, d) => n + d, 0) / sinceCompaction.length
    : undefined

  return { last: deltas.at(-1), average }
}

// The summary's figures: the live fill, and how far auto-compaction is
export function outlook(snap: Snapshot, points: Point[]) {
  const current = snap.tokens ?? snap.estimated
  const left = snap.compactAt === undefined ? undefined : snap.compactAt - current
  const { last, average } = trend(points)
  const turnsLeft =
    left !== undefined && left > 0 && average !== undefined && average > 0
      ? Math.ceil(left / average)
      : undefined

  return { current, left, last, average, turnsLeft }
}

export function sparkline(points: Point[]): Run[] {
  return joinRuns(
    points.map(({ tokens, window }) => {
      const percent = (tokens / window) * 100
      const level = Math.min(SPARKS.length - 1, Math.floor((percent / 100) * SPARKS.length))

      return { text: SPARKS.charAt(level), color: pctColor(percent) }
    }),
  )
}

export function paintCategories(categories: Category[]): Segment[] {
  let used = 0

  return categories.map(category => {
    if (category.kind === 'used') {
      const color = CATEGORY_COLORS[used++ % CATEGORY_COLORS.length] ?? BLUE
      return { ...category, text: '█', color }
    }
    if (category.kind === 'free') return { ...category, text: '░', color: DARK_GRAY }
    if (category.kind === 'buffer') return { ...category, text: '▒', color: GRAY }
    return { ...category, text: '·', color: DARK_GRAY }
  })
}

// One cell per `count`th of the window; deferred tool schemas sit outside it
export function cells(segments: Segment[], count: number): Run[] {
  const shown = segments.filter(s => s.kind !== 'deferred')
  const total = shown.reduce((n, s) => n + s.tokens, 0) || 1
  let tokens = 0
  let filled = 0

  return shown.flatMap(segment => {
    tokens += segment.tokens
    const end = Math.round((tokens / total) * count)
    const run = Array.from({ length: end - filled }, () => ({
      text: segment.text,
      color: segment.color,
    }))
    filled = end
    return run
  })
}
