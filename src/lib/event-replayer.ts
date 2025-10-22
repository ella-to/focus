import type { EventPayloadMap, EventRecord, EventType, ParentId } from './event-store'

export interface PersistedBullet {
  id: string
  content: string
  context: string
  collapsed: boolean
  checked: boolean
  createdAt: number
  children: PersistedBullet[]
}

interface ReplayState {
  root: PersistedBullet[]
  nodes: Map<string, PersistedBullet>
  parents: Map<string, ParentId>
}

function createState(): ReplayState {
  return {
    root: [],
    nodes: new Map(),
    parents: new Map(),
  }
}

function getChildren(state: ReplayState, parentId: ParentId): PersistedBullet[] | null {
  if (!parentId) {
    return state.root
  }
  const parent = state.nodes.get(parentId)
  if (!parent) {
    return null
  }
  return parent.children
}

function removeFromParent(state: ReplayState, id: string): PersistedBullet | null {
  const parentId = state.parents.get(id) ?? null
  const siblings = getChildren(state, parentId)
  if (!siblings) {
    return null
  }
  const index = siblings.findIndex(node => node.id === id)
  if (index === -1) {
    return null
  }
  const [node] = siblings.splice(index, 1)
  return node
}

function deleteSubtree(state: ReplayState, node: PersistedBullet) {
  state.nodes.delete(node.id)
  state.parents.delete(node.id)
  node.children.forEach(child => deleteSubtree(state, child))
}

function insertNode(state: ReplayState, node: PersistedBullet, parentId: ParentId, index: number) {
  const siblings = getChildren(state, parentId)
  if (!siblings) {
    return
  }
  const insertIndex = Math.min(Math.max(index, 0), siblings.length)
  siblings.splice(insertIndex, 0, node)
  state.parents.set(node.id, parentId)
}

function ensureNode(state: ReplayState, payload: EventPayloadMap['bullet_created']) {
  if (state.nodes.has(payload.id)) {
    return
  }

  const node: PersistedBullet = {
    id: payload.id,
    content: payload.content,
    context: payload.context,
    collapsed: payload.collapsed,
    checked: false,
    createdAt: payload.createdAt,
    children: [],
  }

  state.nodes.set(node.id, node)
  insertNode(state, node, payload.parentId, payload.index)
}

function applyBulletCreated(state: ReplayState, payload: EventPayloadMap['bullet_created']) {
  ensureNode(state, payload)
}

function applyBulletDeleted(state: ReplayState, payload: EventPayloadMap['bullet_deleted']) {
  const node = removeFromParent(state, payload.id)
  if (node) {
    deleteSubtree(state, node)
  }
}

function applyMove(state: ReplayState, id: string, toParentId: ParentId, toIndex: number) {
  const node = removeFromParent(state, id)
  if (!node) {
    return
  }
  insertNode(state, node, toParentId, toIndex)
}

function applyBulletMoved(state: ReplayState, payload: EventPayloadMap['bullet_moved']) {
  applyMove(state, payload.id, payload.parentId, payload.toIndex)
}

function applyBulletIndented(state: ReplayState, payload: EventPayloadMap['bullet_indented']) {
  applyMove(state, payload.id, payload.toParentId, payload.toIndex)
}

function applyBulletOutdented(state: ReplayState, payload: EventPayloadMap['bullet_outdented']) {
  applyMove(state, payload.id, payload.toParentId, payload.toIndex)
}

function applyBulletContentUpdated(state: ReplayState, payload: EventPayloadMap['bullet_content_updated']) {
  const node = state.nodes.get(payload.id)
  if (node) {
    node.content = payload.content
  }
}

function applyBulletContextUpdated(state: ReplayState, payload: EventPayloadMap['bullet_context_updated']) {
  const node = state.nodes.get(payload.id)
  if (node) {
    node.context = payload.context
  }
}

function applyBulletCollapsedUpdated(state: ReplayState, payload: EventPayloadMap['bullet_collapsed_updated']) {
  const node = state.nodes.get(payload.id)
  if (node) {
    node.collapsed = payload.collapsed
  }
}

function applyBulletCheckedUpdated(state: ReplayState, payload: EventPayloadMap['bullet_checked_updated']) {
  const node = state.nodes.get(payload.id)
  if (node) {
    node.checked = payload.checked
  }
}

function applyWorkspaceCreated(_state: ReplayState, _payload: EventPayloadMap['workspace_created']) {
  /* no-op */
}

function applyWorkspaceRenamed(_state: ReplayState, _payload: EventPayloadMap['workspace_renamed']) {
  /* no-op */
}

function applyWorkspaceDeleted(_state: ReplayState, _payload: EventPayloadMap['workspace_deleted']) {
  /* no-op */
}

const handlers: {
  [K in EventType]: (state: ReplayState, payload: EventPayloadMap[K]) => void
} = {
  bullet_created: applyBulletCreated,
  bullet_deleted: applyBulletDeleted,
  bullet_moved: applyBulletMoved,
  bullet_indented: applyBulletIndented,
  bullet_outdented: applyBulletOutdented,
  bullet_content_updated: applyBulletContentUpdated,
  bullet_context_updated: applyBulletContextUpdated,
  bullet_collapsed_updated: applyBulletCollapsedUpdated,
  bullet_checked_updated: applyBulletCheckedUpdated,
  workspace_created: applyWorkspaceCreated,
  workspace_renamed: applyWorkspaceRenamed,
  workspace_deleted: applyWorkspaceDeleted,
}

export function replayEvents(events: EventRecord[]): PersistedBullet[] {
  const state = createState()

  for (const event of events) {
    const handler = handlers[event.type]
    if (!handler) {
      continue
    }
    try {
      handler(state, event.payload as any)
    } catch (error) {
      console.error('[event-replayer] Failed to apply event', event, error)
    }
  }

  return state.root
}
