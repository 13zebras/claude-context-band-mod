export type CategoryKind = 'used' | 'free' | 'buffer' | 'deferred'
export type Category = { name: string; tokens: number; kind: CategoryKind }
export type Item = { name: string; tokens: number }
export type MemoryFile = { path: string; type: string; tokens: number }
export type McpTool = { name: string; tokens: number; isLoaded: boolean }
export type McpServer = { name: string; tokens: number; loaded: number; total: number; tools: McpTool[] }
export type Listing = { tokens: number; included: number; total: number; items: Item[] }
export type Cache = { read: number; written: number; uncached: number; output: number }

// One measurement of the context window, distilled from $.session.usage()
export type Snapshot = {
  tokens?: number
  window: number
  estimated: number
  compactAt?: number
  categories: Category[]
  memoryFiles: MemoryFile[]
  mcpServers: McpServer[]
  agents: Listing
  skills?: Listing
  commands?: Listing
  cache?: Cache
  cost?: number
  isExact: boolean
}

// The context fill after one main-thread turn
export type Point = { tokens: number; window: number }

export type Compaction = { trigger: string; before?: number; after?: number }

declare module 'claude-code' {
  interface PluginState {
    'context-band': {
      snapshot: Shaped<Snapshot | null>
      history: Shaped<Point[]>
      compactions: Shaped<Compaction[]>
      isExpanded: boolean
      isCounting: boolean
      alerted: string[]
    }
  }
}
