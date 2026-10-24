import { expect, mock, test } from 'claude-code/testing'
import type { ContextCategoryKind, On, SessionMeasureInput, SessionUsage } from 'claude-code'

const BAND = {
  plugin: 'context-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'context-band',
  component: 'Pane',
  requestId: 'context',
  props: {
    title: 'Context',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const category = (name: string, tokens: number, kind: ContextCategoryKind) => ({
  name,
  tokens,
  kind,
  color: 'inactive',
  isDeferred: kind === 'deferred',
})

const USAGE: SessionUsage = {
  startedAt: 0,
  rateLimits: [],
  cost: { usd: 1.5 },
  context: {
    tokens: 60_000,
    window: 200_000,
    percent: 30,
    breakdown: {
      categories: [
        category('System prompt', 3_000, 'used'),
        category('Messages', 57_000, 'used'),
        category('Free space', 107_000, 'free'),
        category('Autocompact buffer', 33_000, 'buffer'),
        category('MCP tools', 45_000, 'deferred'),
      ],
      totalTokens: 60_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'auto',
      percentage: 30,
      gridRows: [],
      model: 'Opus 5.5',
      memoryFiles: [{ path: '/Users/me/.claude/CLAUDE.md', type: 'User', tokens: 1_200 }],
      mcpTools: [
        { name: 'mcp__linear__create_issue', serverName: 'linear', tokens: 500, isLoaded: true },
        { name: 'mcp__linear__list_teams', serverName: 'linear', tokens: 400, isLoaded: false },
      ],
      agents: [{ agentType: 'Explore', source: 'built-in', tokens: 300 }],
      skills: {
        totalSkills: 2,
        includedSkills: 2,
        tokens: 900,
        skillFrontmatter: [
          { name: 'simplify', source: 'built-in', tokens: 500 },
          { name: 'loop', source: 'built-in', tokens: 400 },
        ],
      },
      autoCompactThreshold: 167_000,
      isAutoCompactEnabled: true,
      apiUsage: {
        input_tokens: 1_000,
        output_tokens: 2_000,
        cache_read_input_tokens: 57_000,
        cache_creation_input_tokens: 2_000,
      },
    },
  },
}

// Stands in for the engine beneath the mod; collects the toasts and panes it raises
function engine(on: On) {
  const toasts: string[] = []
  const panes: string[] = []
  mock.store(on)
  on('command.register', () => ({ value: { command: 'ctx' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    panes.push(e.id)
    return { value: { isPlaced: true } }
  })

  return { toasts, panes }
}

const measure = (tokens: number): SessionMeasureInput => ({
  context: { tokens, window: 200_000, percent: Math.round((tokens / 200_000) * 100) },
  rateLimits: [],
  changed: ['context'],
})

test('the summary shows the fill and the autocompact distance', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Text', text: /^60k$/ }))?.text).toBe('60k')
    expect(await ui.find({ type: 'Text', text: /autocompact @167k \(107k left\)/ })).toBeDefined()
    expect((await ui.find({ key: 'toggle' }))?.props.hotkey).toBe('c')
    expect((await ui.find({ key: 'toggle' }))?.props.action).toBe('app:cycleDiffBase')
    expect(await ui.find({ type: 'Text', text: /Memory/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('c expands the band, deferred tools on a row of their own', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'toggle' })

    expect(await ui.find({ type: 'Text', text: /Memory/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\.claude\/CLAUDE\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/2 loaded/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /95% hit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Deferred/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /deferred\)/ })).toBeUndefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /Memory/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('p opens the side pane, which lists every tool and skill', async ($, on) => {
  const { panes } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'pane' })
  await band.unmount()
  expect(panes).toEqual(['context'])

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: /^MCP servers/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^create_issue/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^list_teams/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^simplify/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\/Users\/me\/\.claude\/CLAUDE\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /28\.5%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('turns build a trend and an estimate of turns to compact', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for (const tokens of [40_000, 50_000, 60_000]) await $.session.measure(measure(tokens))

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /\+10k\/turn/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~11 turns to compact/ })).toBeDefined()
  await ui.unmount()
})

test('a toast at 80% and 90%, once each', async ($, on) => {
  const { toasts } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const tokens of [150_000, 166_000, 182_000, 170_000]) await $.session.measure(measure(tokens))

  expect(toasts).toEqual(['Context at 83%', 'Context at 91%'])
})
