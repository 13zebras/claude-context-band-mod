import { atom, read, update } from 'claude-code'
import type {
  ContextBreakdownDetail,
  EngineInterface,
  Register,
  SessionMeasureInput,
} from 'claude-code'

import { drawBand, drawPane } from './draw'
import { toSnapshot } from './shared'

// Change a tag when its value's fields change: it declines what an earlier
// version stored, which outlives a reload
const snapshot = atom({ plugin: 'context-band', key: 'snapshot' } as const, null, {
  shape: 'snapshot-2',
})
const history = atom({ plugin: 'context-band', key: 'history' } as const, [], {
  shape: 'history-1',
})
const compactions = atom({ plugin: 'context-band', key: 'compactions' } as const, [], {
  shape: 'compactions-1',
})
const isExpanded = atom({ plugin: 'context-band', key: 'isExpanded' } as const, false)
const isCounting = atom({ plugin: 'context-band', key: 'isCounting' } as const, false)
const alerted = atom({ plugin: 'context-band', key: 'alerted' } as const, [])

const PANE = 'context'
const MAX_POINTS = 40
const THRESHOLDS = [80, 90]
const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

// `summary` estimates locally; `full` sends token-count requests as /context does
async function refresh($: EngineInterface, detail: ContextBreakdownDetail) {
  const usage = await $.session.usage({ breakdown: detail }).catch(() => null)
  const measured = usage && toSnapshot(usage, detail === 'full')
  if (measured) await update($, snapshot, () => measured)
}

async function recount($: EngineInterface) {
  await update($, isCounting, () => true)
  try {
    await refresh($, 'full')
  } finally {
    await update($, isCounting, () => false)
  }
}

async function toggle($: EngineInterface) {
  const value = await update($, isExpanded, open => !open)
  await $.store.set('isExpanded', value)
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Context' })
}

// Toasts once when context or a rate limit crosses 80% or 90%, and re-arms
// once it drops back below
async function alert($: EngineInterface, e: SessionMeasureInput) {
  const readings = [
    { name: 'Context', percent: e.context.percent },
    ...e.rateLimits.map(limit => ({
      name: `${LIMIT_NAMES[limit.kind] ?? limit.kind} limit`,
      percent: limit.percentUsed,
    })),
  ]
  const before = await read($, alerted)
  const crossed: string[] = []

  for (const { name, percent = 0 } of readings) {
    const keys = THRESHOLDS.filter(t => percent >= t).map(t => `${name} ${t}`)
    crossed.push(...keys)
    if (keys.some(key => !before.includes(key))) {
      $.ui.toast(`${name} at ${Math.round(percent)}%`)
    }
  }

  await update($, alerted, () => crossed)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ctx',
      description: 'Context band: show more or less; "full" counts exactly; "pane" opens the side pane',
      argumentHint: '[full|pane]',
      immediate: true,
    })
    const started = await next(e)

    const stored = await $.store.get('isExpanded')
    if (typeof stored === 'boolean') await update($, isExpanded, () => stored)
    await refresh($, 'summary')

    return started
  })

  on('session.measure', async ($, e, next) => {
    await alert($, e)

    const { tokens, window } = e.context
    if (e.changed.includes('context') && tokens !== undefined) {
      await update($, history, points => [...points, { tokens, window }].slice(-MAX_POINTS))
    }
    if (e.changed.includes('context') || e.changed.includes('cost')) {
      await refresh($, 'summary')
    }

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (result.skip !== undefined || e.agentId !== undefined || e.trigger === 'precompute') {
      return result
    }

    const compaction = {
      trigger: e.trigger,
      before: result.tokensBefore,
      after: result.tokensAfter,
    }
    await update($, compactions, list => [...list, compaction].slice(-20))
    await refresh($, 'summary')

    return result
  }).catch(($, e, next) => next(e)) // a failed record never blocks the compaction

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, snapshot, () => null)
      await update($, history, () => [])
      await update($, compactions, () => [])
      await update($, alerted, () => [])
    }

    return next(e)
  })

  on('command.run', { command: 'ctx' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'full') await recount($)
    else if (arg === 'pane') await openPane($)
    else await toggle($)

    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    const points = await read($, history)
    const compacted = await read($, compactions)
    const expanded = await read($, isExpanded)
    const counting = await read($, isCounting)

    if (e.props.hasSurvey || snap === null) {
      return next(e)
    }

    return drawBand($.ui.resolve(e), {
      snap,
      points,
      compacted,
      isCounting: counting,
      isExpanded: expanded,
      isAgentView: e.props.view.agentId !== undefined,
      columns: e.props.bodyColumns,
      recount: () => recount($),
      toggle: () => toggle($),
      openPane: () => openPane($),
    })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const snap = await read($, snapshot)
    const points = await read($, history)
    const compacted = await read($, compactions)
    const counting = await read($, isCounting)
    const { Text } = $.ui.resolve(e)

    if (snap === null) {
      return <Text dimColor>No measurement yet: one comes after the next turn.</Text>
    }

    return drawPane($.ui.resolve(e), {
      snap,
      points,
      compacted,
      isCounting: counting,
      columns: e.props.bodyColumns,
      recount: () => recount($),
    })
  })
}
