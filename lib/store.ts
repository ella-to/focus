import { detach, flow, getSnapshot, types, type Instance } from 'mobx-state-tree'
import { nanoid } from 'nanoid'

import { replayEvents, type PersistedBullet } from './event-replayer'
import {
  appendEvent,
  bulkInsertEvents,
  clearEvents,
  getAllEvents,
  isEventStoreAvailable,
  type EventPayloadMap,
  type EventRecord,
  type EventType,
  type ParentId,
} from './event-store'

let recordingDepth = 0
let lastTimestamp = 0

function nextTimestamp(): number {
  const now = Date.now()
  if (now <= lastTimestamp) {
    lastTimestamp += 1
  } else {
    lastTimestamp = now
  }
  return lastTimestamp
}

function runWithoutRecording<T>(fn: () => T): T {
  recordingDepth++
  try {
    return fn()
  } finally {
    recordingDepth--
  }
}

async function runWithoutRecordingAsync<T>(fn: () => Promise<T>): Promise<T> {
  recordingDepth++
  try {
    return await fn()
  } finally {
    recordingDepth--
  }
}

function emitEvent<K extends EventType>(type: K, payload: EventPayloadMap[K]) {
  if (recordingDepth > 0 || !isEventStoreAvailable()) {
    return
  }

  const timestamp = nextTimestamp()
  void appendEvent({ type, payload, timestamp }).catch(error => {
    console.error(`[event-store] Failed to append event "${type}"`, error)
  })
}

function toSnapshot(node: PersistedBullet): any {
  return {
    id: node.id,
    content: node.content,
    context: node.context,
    collapsed: node.collapsed,
    createdAt: node.createdAt,
    children: node.children.map(child => toSnapshot(child)),
  }
}

function normalizePersistedBullet(bullet: any): PersistedBullet {
  return {
    id: bullet.id,
    content: bullet.content ?? '',
    context: bullet.context ?? '',
    collapsed: Boolean(bullet.collapsed),
    createdAt: typeof bullet.createdAt === 'number' ? bullet.createdAt : Date.now(),
    children: Array.isArray(bullet.children) ? bullet.children.map(normalizePersistedBullet) : [],
  }
}

function createPersistedBullet({
  content,
  context = '',
  collapsed = false,
  children = [],
}: {
  content: string
  context?: string
  collapsed?: boolean
  children?: PersistedBullet[]
}): PersistedBullet {
  return {
    id: nanoid(),
    content,
    context,
    collapsed,
    createdAt: Date.now(),
    children,
  }
}

function createWelcomeTree(): PersistedBullet[] {
  const welcome = createPersistedBullet({
    content: 'Welcome to Focus!',
    context: 'Press Shift+Enter to add notes. Click the bullet dot to zoom in.',
  })
  const child1 = createPersistedBullet({
    content: 'Press Enter to create a new bullet',
  })
  const child2 = createPersistedBullet({
    content: 'Press Tab to indent',
  })
  const child3 = createPersistedBullet({
    content: 'Press Shift+Tab to outdent',
  })

  welcome.children.push(child1, child2, child3)
  return [welcome]
}

function createCreationEvents(nodes: PersistedBullet[], parentId: ParentId): Array<Omit<EventRecord, 'id'>> {
  const events: Array<Omit<EventRecord, 'id'>> = []
  nodes.forEach((node, index) => {
    events.push({
      type: 'bullet_created',
      payload: {
        id: node.id,
        parentId,
        index,
        content: node.content,
        context: node.context,
        collapsed: node.collapsed,
        createdAt: node.createdAt,
      },
      timestamp: nextTimestamp(),
    })

    if (node.children.length > 0) {
      events.push(...createCreationEvents(node.children, node.id))
    }
  })
  return events
}

async function replaceEventStoreWithTree(nodes: PersistedBullet[]) {
  if (!isEventStoreAvailable()) {
    return
  }

  const events = createCreationEvents(nodes, null)
  await clearEvents()
  if (events.length === 0) {
    return
  }

  await bulkInsertEvents(events)
}

export const Bullet: any = types
  .model('Bullet', {
    id: types.identifier,
    content: types.string,
    context: types.optional(types.string, ''),
    children: types.array(types.late(() => Bullet)),
    collapsed: types.optional(types.boolean, false),
    createdAt: types.optional(types.number, () => Date.now()),
  })
  .actions(self => ({
    setContent(content: string) {
      self.content = content
    },
    setContext(context: string) {
      self.context = context
    },
    toggleCollapsed() {
      self.collapsed = !self.collapsed
    },
    setCollapsed(collapsed: boolean) {
      self.collapsed = collapsed
    },
    addChild(bullet: Instance<typeof Bullet>) {
      self.children.push(bullet)
    },
    removeChild(id: string) {
      const index = self.children.findIndex(child => child.id === id)
      if (index !== -1) {
        self.children.splice(index, 1)
      }
    },
    insertChildAt(index: number, bullet: Instance<typeof Bullet>) {
      self.children.splice(index, 0, bullet)
    },
    removeChildAndReturn(id: string): Instance<typeof Bullet> | null {
      const index = self.children.findIndex(child => child.id === id)
      if (index !== -1) {
        const child = self.children[index]
        self.children.splice(index, 1)
        return child
      }
      return null
    },
  }))

export const RootStore = types
  .model('RootStore', {
    bullets: types.array(Bullet),
    zoomedBulletId: types.maybeNull(types.string),
    history: types.array(types.frozen()),
    historyIndex: types.optional(types.number, -1),
    searchQuery: types.optional(types.string, ''),
  })
  .views(self => ({
    get zoomedBullet() {
      if (!self.zoomedBulletId) return null
      return this.findBulletById(self.zoomedBulletId)
    },
    findBulletById(id: string, bullets = self.bullets): Instance<typeof Bullet> | null {
      for (const bullet of bullets) {
        if (bullet.id === id) return bullet
        const found = this.findBulletById(id, bullet.children as any)
        if (found) return found
      }
      return null
    },
    getBreadcrumbs(bulletId: string): Instance<typeof Bullet>[] {
      const breadcrumbs: Instance<typeof Bullet>[] = []
      const findPath = (id: string, bullets: any[], path: any[]): boolean => {
        for (const bullet of bullets) {
          if (bullet.id === id) {
            breadcrumbs.push(...path, bullet)
            return true
          }
          if (findPath(id, bullet.children, [...path, bullet])) {
            return true
          }
        }
        return false
      }
      findPath(bulletId, self.bullets as any, [])
      return breadcrumbs
    },
    findBulletWithContext(
      id: string,
      bullets: any[] = self.bullets,
      parent: Instance<typeof Bullet> | null = null,
    ): {
      bullet: Instance<typeof Bullet>
      parent: Instance<typeof Bullet> | null
      siblings: any[]
      index: number
    } | null {
      for (let i = 0; i < bullets.length; i++) {
        const bullet = bullets[i]
        if (bullet.id === id) {
          return { bullet, parent, siblings: bullets, index: i }
        }
        const found = this.findBulletWithContext(id, bullet.children, bullet)
        if (found) return found
      }
      return null
    },
    fuzzyMatch(text: string, query: string): boolean {
      if (!query) return true
      const lowerText = text.toLowerCase()
      const lowerQuery = query.toLowerCase()

      // Simple fuzzy matching: check if all characters in query appear in order in text
      let queryIndex = 0
      for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
        if (lowerText[i] === lowerQuery[queryIndex]) {
          queryIndex++
        }
      }
      return queryIndex === lowerQuery.length
    },
    bulletMatchesSearch(bullet: Instance<typeof Bullet>, query: string): boolean {
      if (!query) return true

      // Check if bullet content or context matches
      if (this.fuzzyMatch(bullet.content, query) || this.fuzzyMatch(bullet.context, query)) {
        return true
      }

      // Check if any child matches
      for (const child of bullet.children) {
        if (this.bulletMatchesSearch(child, query)) {
          return true
        }
      }

      return false
    },
    get filteredBullets() {
      if (!self.searchQuery) {
        return this.zoomedBullet ? this.zoomedBullet.children : self.bullets
      }

      const bullets = this.zoomedBullet ? this.zoomedBullet.children : self.bullets
      return bullets.filter((bullet: Instance<typeof Bullet>) => this.bulletMatchesSearch(bullet, self.searchQuery))
    },
  }))
  .actions(self => {
    const storeWithActions = self as typeof self & {
      saveToHistory(): void
      createEmptyBullet(
        parent: Instance<typeof Bullet> | null,
        options?: { skipHistory?: boolean },
      ): Instance<typeof Bullet>
    }

    return {
      setSearchQuery(query: string) {
        self.searchQuery = query
      },
      saveToHistory() {
        const snapshot = {
          bullets: getSnapshot(self.bullets),
          zoomedBulletId: self.zoomedBulletId,
        }
        // Remove any history after current index
        self.history.splice(self.historyIndex + 1)
        self.history.push(snapshot as any)
        self.historyIndex = self.history.length - 1

        // Limit history to 100 items
        if (self.history.length > 100) {
          self.history.shift()
          self.historyIndex--
        }
      },
      undo() {
        if (self.historyIndex > 0) {
          self.historyIndex--
          const snapshot = self.history[self.historyIndex] as any
          self.bullets.clear()
          snapshot.bullets.forEach((b: any) => self.bullets.push(Bullet.create(b)))
          self.zoomedBulletId = snapshot.zoomedBulletId
        }
      },
      redo() {
        if (self.historyIndex < self.history.length - 1) {
          self.historyIndex++
          const snapshot = self.history[self.historyIndex] as any
          self.bullets.clear()
          snapshot.bullets.forEach((b: any) => self.bullets.push(Bullet.create(b)))
          self.zoomedBulletId = snapshot.zoomedBulletId
        }
      },
      updateBulletContent(bulletId: string, content: string) {
        const bullet = self.findBulletById(bulletId)
        if (!bullet) {
          return
        }

        bullet.setContent(content)
        emitEvent('bullet_content_updated', { id: bulletId, content })
      },
      updateBulletContext(bulletId: string, context: string) {
        const bullet = self.findBulletById(bulletId)
        if (!bullet) {
          return
        }

        bullet.setContext(context)
        emitEvent('bullet_context_updated', { id: bulletId, context })
      },
      setBulletCollapsed(bulletId: string, collapsed: boolean) {
        const bullet = self.findBulletById(bulletId)
        if (!bullet) {
          return
        }

        bullet.setCollapsed(collapsed)
        emitEvent('bullet_collapsed_updated', { id: bulletId, collapsed })
      },
      toggleBulletCollapsed(bulletId: string) {
        const bullet = self.findBulletById(bulletId)
        if (!bullet) {
          return
        }

        bullet.toggleCollapsed()
        emitEvent('bullet_collapsed_updated', { id: bulletId, collapsed: bullet.collapsed })
      },
      indentBullet(bulletId: string) {
        const context = self.findBulletWithContext(bulletId)
        if (!context) return false

        const { bullet, index, parent, siblings } = context

        // Can't indent if it's the first bullet (no previous sibling)
        if (index === 0) return false

        // Get the previous sibling
        const prevBullet = siblings[index - 1]

        // Detach so we can reparent without killing observers
        const detachedBullet = detach(bullet)

        // Add as child of previous sibling using same instance
        prevBullet.addChild(detachedBullet)

        storeWithActions.saveToHistory()
        emitEvent('bullet_indented', {
          id: bulletId,
          fromParentId: parent ? parent.id : null,
          fromIndex: index,
          toParentId: prevBullet.id,
          toIndex: prevBullet.children.length - 1,
        })
        return true
      },
      outdentBullet(bulletId: string) {
        const context = self.findBulletWithContext(bulletId)
        if (!context) return false

        const { bullet, parent } = context

        // Can't outdent if already at root level
        if (!parent) return false

        const parentContext = self.findBulletWithContext(parent.id)
        if (!parentContext) return false

        const fromParentId = parent.id
        const fromIndex = context.index
        const targetParentId = parentContext.parent ? parentContext.parent.id : null
        const targetIndex = parentContext.index + 1

        // Detach before re-inserting elsewhere
        const detachedBullet = detach(bullet)

        // Add as sibling of parent (right after parent)
        if (parentContext.parent) {
          parentContext.parent.insertChildAt(targetIndex, detachedBullet)
        } else {
          self.bullets.splice(targetIndex, 0, detachedBullet)
        }

        storeWithActions.saveToHistory()
        emitEvent('bullet_outdented', {
          id: bulletId,
          fromParentId,
          fromIndex,
          toParentId: targetParentId,
          toIndex: targetIndex,
        })
        return true
      },
      createAndInsertBullet(afterBulletId: string, asChild = false) {
        const context = self.findBulletWithContext(afterBulletId)
        if (!context) return null

        const newBullet = Bullet.create({
          id: nanoid(),
          content: '',
          context: '',
          children: [],
          createdAt: Date.now(),
        })

        const { bullet, parent, index } = context
        let parentId: ParentId
        let insertIndex: number

        if (asChild) {
          bullet.insertChildAt(0, newBullet)
          parentId = bullet.id
          insertIndex = 0
        } else {
          if (parent) {
            parent.insertChildAt(index + 1, newBullet)
            parentId = parent.id
            insertIndex = index + 1
          } else {
            const rootIndex = index + 1
            self.bullets.splice(rootIndex, 0, newBullet)
            parentId = null
            insertIndex = rootIndex
          }
        }

        storeWithActions.saveToHistory()
        emitEvent('bullet_created', {
          id: newBullet.id,
          parentId,
          index: insertIndex,
          content: newBullet.content,
          context: newBullet.context,
          collapsed: newBullet.collapsed,
          createdAt: newBullet.createdAt,
        })
        return newBullet
      },
      deleteBullet(bulletId: string, skipConfirmation = false) {
        const context = self.findBulletWithContext(bulletId)
        if (!context) {
          return { success: false, hasChildren: false }
        }

        const { bullet, parent } = context
        const deletionPayload = {
          id: bullet.id,
          parentId: parent ? parent.id : null,
          index: context.index,
        }

        // Check if bullet has children
        const hasChildren = bullet.children.length > 0

        // If has children and not skipping confirmation, return info for dialog
        if (hasChildren && !skipConfirmation) {
          return { success: false, hasChildren: true, bulletId }
        }

        if (self.zoomedBulletId) {
          const zoomedBullet = self.findBulletById(self.zoomedBulletId)

          // Check if this is the last child of the zoomed bullet
          if (zoomedBullet && zoomedBullet.children.length === 1 && zoomedBullet.children[0].id === bulletId) {
            // Delete the last child (and its children if any)
            zoomedBullet.removeChild(bulletId)
            emitEvent('bullet_deleted', deletionPayload)
            // Create a new empty bullet
            const newBullet = storeWithActions.createEmptyBullet(zoomedBullet, { skipHistory: true })
            storeWithActions.saveToHistory()
            return {
              success: true,
              hasChildren: false,
              newBulletId: newBullet?.id,
            }
          }
        } else if (self.bullets.length === 1 && self.bullets[0].id === bulletId) {
          // Delete the only bullet (and its children if any)
          self.bullets.splice(0, 1)
          emitEvent('bullet_deleted', deletionPayload)
          // Create a new empty bullet
          const newBullet = storeWithActions.createEmptyBullet(null, { skipHistory: true })
          storeWithActions.saveToHistory()
          return {
            success: true,
            hasChildren: false,
            newBulletId: newBullet?.id,
          }
        }

        // Normal deletion
        if (parent) {
          parent.removeChild(bullet.id)
        } else {
          const index = self.bullets.findIndex(b => b.id === bullet.id)
          if (index !== -1) {
            self.bullets.splice(index, 1)
          }
        }

        storeWithActions.saveToHistory()
        emitEvent('bullet_deleted', deletionPayload)
        return { success: true, hasChildren: false }
      },
      zoomToBullet(id: string | null) {
        self.zoomedBulletId = id

        // If zooming into a bullet with no children, create an empty bullet
        if (id) {
          const bullet = self.findBulletById(id)
          if (bullet && bullet.children.length === 0) {
            storeWithActions.createEmptyBullet(bullet, { skipHistory: true })
          }
        }

        storeWithActions.saveToHistory()
      },
      zoomOut() {
        if (!self.zoomedBulletId) return

        const breadcrumbs = self.getBreadcrumbs(self.zoomedBulletId)
        if (breadcrumbs.length > 1) {
          // Zoom to parent (second to last in breadcrumbs)
          const parent = breadcrumbs[breadcrumbs.length - 2]
          self.zoomedBulletId = parent.id
        } else {
          // Already at top level, zoom out to root
          self.zoomedBulletId = null
        }

        storeWithActions.saveToHistory()
      },
      loadFromEventStore: flow(function* () {
        if (typeof window === 'undefined') return

        let persistedBullets: PersistedBullet[] = []

        if (isEventStoreAvailable()) {
          try {
            const events = (yield getAllEvents()) as EventRecord[]
            if (events.length > 0) {
              persistedBullets = replayEvents(events)
            } else {
              persistedBullets = createWelcomeTree()
              yield replaceEventStoreWithTree(persistedBullets)
            }
          } catch (error) {
            console.error('Failed to load events from IndexedDB', error)
            persistedBullets = createWelcomeTree()
          }
        } else {
          persistedBullets = createWelcomeTree()
        }

        runWithoutRecording(() => {
          self.bullets.clear()
          persistedBullets.forEach(node => self.bullets.push(Bullet.create(toSnapshot(node))))
        })

        self.history.clear()
        self.historyIndex = -1
        storeWithActions.saveToHistory()
      }),
      exportData() {
        const data = {
          bullets: getSnapshot(self.bullets),
          zoomedBulletId: self.zoomedBulletId,
          exportedAt: new Date().toISOString(),
        }
        return JSON.stringify(data, null, 2)
      },
      importData(jsonString: string) {
        try {
          const data = JSON.parse(jsonString)
          if (!data.bullets || !Array.isArray(data.bullets)) {
            throw new Error('Invalid data format')
          }

          const normalized = data.bullets.map(normalizePersistedBullet) as PersistedBullet[]

          runWithoutRecording(() => {
            self.bullets.clear()
            normalized.forEach(node => self.bullets.push(Bullet.create(toSnapshot(node))))
          })

          self.zoomedBulletId = null
          self.history.clear()
          self.historyIndex = -1
          storeWithActions.saveToHistory()

          runWithoutRecordingAsync(async () => {
            await replaceEventStoreWithTree(normalized)
          }).catch(error => {
            console.error('Failed to persist imported data to IndexedDB', error)
          })
          return true
        } catch (e) {
          console.error('Failed to import data', e)
          return false
        }
      },
      resetToDefault() {
        const welcomeTree = createWelcomeTree()

        runWithoutRecording(() => {
          self.bullets.clear()
          welcomeTree.forEach(node => self.bullets.push(Bullet.create(toSnapshot(node))))
        })

        self.zoomedBulletId = null
        self.history.clear()
        self.historyIndex = -1
        storeWithActions.saveToHistory()

        runWithoutRecordingAsync(async () => {
          await replaceEventStoreWithTree(welcomeTree)
        }).catch(error => {
          console.error('Failed to reset IndexedDB event store', error)
        })
      },
      moveBulletUp(bulletId: string) {
        const context = self.findBulletWithContext(bulletId)
        if (!context) {
          return false
        }

        const { bullet, index, siblings } = context

        // Can't move up if it's the first bullet
        if (index === 0) {
          return false
        }

        // Detach node so we can reinsert without killing observers
        const detachedBullet = detach(bullet)

        // Insert at previous position using the same instance
        siblings.splice(index - 1, 0, detachedBullet)

        storeWithActions.saveToHistory()
        emitEvent('bullet_moved', {
          id: bulletId,
          parentId: context.parent ? context.parent.id : null,
          fromIndex: index,
          toIndex: index - 1,
        })
        return true
      },
      moveBulletDown(bulletId: string) {
        const context = self.findBulletWithContext(bulletId)
        if (!context) {
          return false
        }

        const { bullet, index, siblings } = context

        // Can't move down if it's the last bullet
        if (index >= siblings.length - 1) {
          return false
        }

        // Detach node so we can reinsert without killing observers
        const detachedBullet = detach(bullet)

        // Insert at next position using the same instance
        siblings.splice(index + 1, 0, detachedBullet)

        storeWithActions.saveToHistory()
        emitEvent('bullet_moved', {
          id: bulletId,
          parentId: context.parent ? context.parent.id : null,
          fromIndex: index,
          toIndex: index + 1,
        })
        return true
      },
      createEmptyBullet(parent: Instance<typeof Bullet> | null, options?: { skipHistory?: boolean }) {
        const newBullet = Bullet.create({
          id: nanoid(),
          content: '',
          context: '',
          children: [],
          createdAt: Date.now(),
        })

        let parentId: ParentId
        let index: number

        if (parent) {
          parent.addChild(newBullet)
          parentId = parent.id
          index = parent.children.length - 1
        } else {
          self.bullets.push(newBullet)
          parentId = null
          index = self.bullets.length - 1
        }

        emitEvent('bullet_created', {
          id: newBullet.id,
          parentId,
          index,
          content: newBullet.content,
          context: newBullet.context,
          collapsed: newBullet.collapsed,
          createdAt: newBullet.createdAt,
        })

        if (!options?.skipHistory) {
          storeWithActions.saveToHistory()
        }

        // Focus the new bullet after a short delay
        setTimeout(() => {
          const contentDiv = document.querySelector(
            `[data-bullet-id="${newBullet.id}"] .bullet-content`,
          ) as HTMLDivElement
          if (contentDiv) {
            contentDiv.focus()
          }
        }, 50)

        return newBullet
      },
      setZoomedBulletId(id: string | null) {
        self.zoomedBulletId = id
      },
    }
  })

export interface IBullet extends Instance<typeof Bullet> {}
export interface IRootStore extends Instance<typeof RootStore> {}

let store: IRootStore | null = null

export function initializeStore() {
  if (store === null) {
    store = RootStore.create({
      bullets: [],
      zoomedBulletId: null,
      history: [],
      historyIndex: -1,
      searchQuery: '',
    })
  }
  return store
}

export function getStore() {
  return store
}
