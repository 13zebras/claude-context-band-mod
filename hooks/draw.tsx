import type { ElementTable } from 'claude-code'

import type { Compaction, Point, Snapshot } from '../types'
import {
  RED,
  cells,
  chunk,
  fmt,
  joinRuns,
  outlook,
  paintCategories,
  pctColor,
  shortPath,
  signed,
  sparkline,
} from './shared'
import type { Entry, Run } from './shared'

type Ui = Pick<ElementTable, 'Box' | 'Button' | 'Text'>

export type View = {
  snap: Snapshot
  points: Point[]
  compacted: Compaction[]
  isCounting: boolean
  columns: number
  recount: () => void
}

export type BandView = View & {
  isExpanded: boolean
  isAgentView: boolean
  toggle: () => void
  openPane: () => void
}

const SPARK_POINTS = 16
const GRID = 10

// The engine action the toggle borrows, so a chord bound to it in
// keybindings.json presses the toggle from the prompt
const TOGGLE_ACTION = 'app:cycleDiffBase'

const paint = ({ Text }: Ui, runs: Run[]) =>
  runs.map(run => <Text color={run.color}>{run.text}</Text>)

const label = ({ Text }: Ui, text: string) => <Text dimColor>{text.padEnd(9)}</Text>

const percent = (share: number) => `${(share * 100).toFixed(1)}%`

function entries({ Text }: Ui, list: Entry[]) {
  if (list.length === 0) return <Text dimColor>none</Text>

  return list.map((entry, i) => (
    <Text dimColor={entry.isDim}>
      {i > 0 && <Text dimColor> · </Text>}
      <Text dimColor>{entry.name} </Text>
      {fmt(entry.tokens)}
      {entry.note !== undefined && <Text dimColor> {entry.note}</Text>}
    </Text>
  ))
}

function fill({ Text }: Ui, snap: Snapshot, current: number) {
  return (
    <Text>
      <Text color={pctColor((current / snap.window) * 100)}>
        {snap.tokens === undefined ? '~' : ''}
        {fmt(current)}
      </Text>
      <Text dimColor> / {fmt(snap.window)}</Text>
    </Text>
  )
}

function autocompact({ Text }: Ui, snap: Snapshot, left: number | undefined) {
  if (snap.compactAt === undefined || left === undefined) {
    return <Text dimColor> · autocompact off</Text>
  }
  if (left <= 0) return <Text color={RED}> · autocompact due</Text>

  return (
    <Text dimColor>
      {' '}
      · autocompact @{fmt(snap.compactAt)} ({fmt(left)} left)
    </Text>
  )
}

function cacheLine(ui: Ui, snap: Snapshot) {
  const { Text } = ui
  const { cache } = snap
  if (cache === undefined) return <Text dimColor>no response yet</Text>

  const hit = (cache.read / Math.max(1, cache.read + cache.written + cache.uncached)) * 100

  return (
    <Text>
      {entries(ui, [
        { name: 'read', tokens: cache.read },
        { name: 'wrote', tokens: cache.written },
        { name: 'uncached', tokens: cache.uncached },
        { name: 'output', tokens: cache.output },
      ])}
      <Text dimColor> → </Text>
      <Text color={pctColor(100 - hit)}>{Math.round(hit)}% hit</Text>
    </Text>
  )
}

function compaction({ Text }: Ui, item: Compaction) {
  return (
    <Text>
      {item.before === undefined ? '?' : fmt(item.before)} →{' '}
      {item.after === undefined ? '?' : fmt(item.after)}
      <Text dimColor> ({item.trigger})</Text>
    </Text>
  )
}

function sessionLine(ui: Ui, v: View, last: number | undefined) {
  const { Text } = ui
  const latest = v.compacted.at(-1)

  return (
    <Text>
      {v.snap.cost !== undefined && <Text>${v.snap.cost.toFixed(2)} · </Text>}
      {last !== undefined && (
        <Text>
          <Text dimColor>last turn </Text>
          {signed(last)}
          <Text dimColor> · </Text>
        </Text>
      )}
      {latest === undefined ? (
        <Text dimColor>no compactions yet</Text>
      ) : (
        <Text>
          {v.compacted.length}
          <Text dimColor> {v.compacted.length === 1 ? 'compaction' : 'compactions'}, last </Text>
          {compaction(ui, latest)}
        </Text>
      )}
    </Text>
  )
}

export function drawBand(ui: Ui, v: BandView) {
  const { Box, Button, Text } = ui
  const { snap, points } = v
  const { current, left, last, average, turnsLeft } = outlook(snap, points)
  const recent = points.slice(-SPARK_POINTS)

  const summary = (
    <Box flexDirection="row" justifyContent="space-between">
      <Box flexShrink={1}>
        <Text wrap="truncate-end">
          {fill(ui, snap, current)}
          {autocompact(ui, snap, left)}
          {recent.length > 1 && <Text dimColor> · </Text>}
          {recent.length > 1 && paint(ui, sparkline(recent))}
          {average !== undefined && <Text dimColor> {signed(average)}/turn</Text>}
          {turnsLeft !== undefined && <Text dimColor> · ~{turnsLeft} turns to compact</Text>}
          {v.isAgentView && <Text dimColor> · main session</Text>}
        </Text>
      </Box>
      <Box flexDirection="row" gap={2} paddingLeft={1}>
        {v.isExpanded && (
          <Button
            key="recount"
            label={v.isCounting ? 'counting…' : 'exact'}
            hotkey="r"
            plain
            dimColor
            onPress={v.recount}
          />
        )}
        <Button key="pane" label="pane" hotkey="p" plain dimColor onPress={v.openPane} />
        <Button
          key="toggle"
          label={v.isExpanded ? 'less' : 'more'}
          hotkey="c"
          action={TOGGLE_ACTION}
          plain
          dimColor
          onPress={v.toggle}
        />
      </Box>
    </Box>
  )

  // A blank row on top sets the band apart from the transcript above it
  if (!v.isExpanded) {
    return (
      <Box flexDirection="column" paddingTop={1}>
        {summary}
      </Box>
    )
  }

  const segments = paintCategories(snap.categories)
  const shown = segments.filter(s => s.kind !== 'deferred')
  const deferred = segments.filter(s => s.kind === 'deferred')
  const { skills, commands, agents } = snap

  return (
    <Box flexDirection="column" paddingTop={1}>
      {summary}
      <Text>{paint(ui, joinRuns(cells(segments, Math.max(10, v.columns))))}</Text>
      <Text>
        {shown.map(segment => (
          <Text>
            <Text color={segment.color}>{segment.text}</Text>
            <Text dimColor> {segment.name} </Text>
            {fmt(segment.tokens)}
            {'  '}
          </Text>
        ))}
        <Text dimColor>{snap.isExact ? 'exact counts' : 'estimated'}</Text>
      </Text>
      {deferred.length > 0 && (
        <Text wrap="truncate-end">
          {label(ui, 'Deferred')}
          {entries(ui, deferred)}
        </Text>
      )}
      <Text wrap="truncate-end">
        {label(ui, 'Memory')}
        {entries(
          ui,
          snap.memoryFiles.map(file => ({
            name: shortPath(file.path),
            tokens: file.tokens,
            note: `(${file.type})`,
          })),
        )}
      </Text>
      <Text wrap="truncate-end">
        {label(ui, 'MCP')}
        {entries(
          ui,
          snap.mcpServers.map(server => ({
            name: server.name,
            tokens: server.tokens,
            note: `${server.loaded}/${server.total} loaded`,
          })),
        )}
      </Text>
      <Text wrap="truncate-end">
        {label(ui, 'Listings')}
        {entries(ui, [
          ...(skills
            ? [{ name: 'skills', tokens: skills.tokens, note: `${skills.included}/${skills.total}` }]
            : []),
          { name: 'agents', tokens: agents.tokens, note: `${agents.total}` },
          ...(commands
            ? [
                {
                  name: 'commands',
                  tokens: commands.tokens,
                  note: `${commands.included}/${commands.total}`,
                },
              ]
            : []),
        ])}
      </Text>
      <Text wrap="truncate-end">
        {label(ui, 'Cache')}
        {cacheLine(ui, snap)}
      </Text>
      <Text wrap="truncate-end">
        {label(ui, 'Session')}
        {sessionLine(ui, v, last)}
      </Text>
    </Box>
  )
}

// The whole breakdown, unabridged: the pane scrolls where the band cannot
export function drawPane(ui: Ui, v: View) {
  const { Box, Button, Text } = ui
  const { snap, points, compacted } = v
  const { current, left, last, average, turnsLeft } = outlook(snap, points)
  const segments = paintCategories(snap.categories)
  const shown = segments.filter(s => s.kind !== 'deferred')
  const deferred = segments.filter(s => s.kind === 'deferred')
  const total = shown.reduce((n, s) => n + s.tokens, 0) || 1
  const grid = chunk(cells(segments, GRID * GRID), GRID)
  const nameWidth = Math.max(0, ...shown.map(s => s.name.length))
  const isWide = v.columns >= GRID * 2 + nameWidth + 20
  const loadedTools = snap.mcpServers.reduce((n, server) => n + server.loaded, 0)
  const allTools = snap.mcpServers.reduce((n, server) => n + server.total, 0)
  const { skills, commands, agents } = snap

  const section = (title: string, note: string | undefined, body: JSX.Element) => (
    <Box flexDirection="column">
      <Text>
        <Text weight="bold">{title}</Text>
        {note !== undefined && <Text dimColor> {note}</Text>}
      </Text>
      {body}
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>
          <Text>
            {fill(ui, snap, current)}
            <Text dimColor> ({Math.round((current / snap.window) * 100)}%)</Text>
            {autocompact(ui, snap, left)}
            <Text dimColor> · {snap.isExact ? 'exact counts' : 'estimated'}</Text>
          </Text>
        </Box>
        <Box paddingLeft={1}>
          <Button
            key="recount"
            label={v.isCounting ? 'counting…' : 'exact'}
            hotkey="r"
            plain
            dimColor
            onPress={v.recount}
          />
        </Box>
      </Box>

      <Box flexDirection={isWide ? 'row' : 'column'} gap={isWide ? 3 : 1}>
        <Box flexDirection="column">
          {grid.map(row => (
            <Text>{paint(ui, joinRuns(row.map(cell => ({ ...cell, text: `${cell.text} ` }))))}</Text>
          ))}
        </Box>
        <Box flexDirection="column">
          {shown.map(segment => (
            <Text>
              <Text color={segment.color}>{segment.text}</Text> {segment.name.padEnd(nameWidth)}{' '}
              {fmt(segment.tokens).padStart(6)}
              <Text dimColor> {percent(segment.tokens / total).padStart(6)}</Text>
            </Text>
          ))}
        </Box>
      </Box>

      {deferred.length > 0 &&
        section('Deferred', 'tool schemas loaded on demand, outside the window', (
          <Text>{entries(ui, deferred)}</Text>
        ))}

      {section('Trend', `${points.length} turns measured`, (
        <Text>
          {points.length > 1 ? paint(ui, sparkline(points)) : <Text dimColor>needs two turns</Text>}
          {average !== undefined && <Text dimColor> {signed(average)}/turn</Text>}
          {last !== undefined && <Text dimColor> · last turn {signed(last)}</Text>}
          {turnsLeft !== undefined && <Text dimColor> · ~{turnsLeft} turns to compact</Text>}
        </Text>
      ))}

      {section('Memory files', `${snap.memoryFiles.length}`, (
        <Box flexDirection="column">
          {snap.memoryFiles.map(file => (
            <Box flexDirection="row" justifyContent="space-between">
              <Box flexShrink={1}>
                <Text wrap="truncate-start">
                  <Text dimColor>{file.type.padEnd(8)}</Text>
                  {file.path}
                </Text>
              </Box>
              <Text> {fmt(file.tokens)}</Text>
            </Box>
          ))}
        </Box>
      ))}

      {section('MCP servers', `${loadedTools}/${allTools} tools loaded`, (
        <Box flexDirection="column">
          {snap.mcpServers.map(server => (
            <Box flexDirection="column">
              <Text>
                {server.name}
                <Text dimColor>
                  {' '}
                  {fmt(server.tokens)} · {server.loaded}/{server.total} loaded
                </Text>
              </Text>
              <Box paddingLeft={2}>
                <Text>
                  {entries(
                    ui,
                    server.tools.map(tool => ({ ...tool, isDim: !tool.isLoaded })),
                  )}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      ))}

      {skills &&
        section('Skills', `${fmt(skills.tokens)} · ${skills.included}/${skills.total} listed`, (
          <Text>{entries(ui, skills.items)}</Text>
        ))}

      {section('Agents', `${fmt(agents.tokens)} · ${agents.total}`, (
        <Text>{entries(ui, agents.items)}</Text>
      ))}

      {commands && (
        <Text>
          <Text weight="bold">Commands</Text>
          <Text dimColor>
            {' '}
            {fmt(commands.tokens)} · {commands.included}/{commands.total} listed
          </Text>
        </Text>
      )}

      {section('Cache', undefined, cacheLine(ui, snap))}

      {section('Session', undefined, (
        <Box flexDirection="column">
          {sessionLine(ui, v, last)}
          {compacted.length > 1 &&
            compacted.map((item, i) => (
              <Text>
                <Text dimColor>{`#${i + 1}`.padEnd(4)}</Text>
                {compaction(ui, item)}
              </Text>
            ))}
        </Box>
      ))}
    </Box>
  )
}
