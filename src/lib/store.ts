import { applySnapshot, detach, flow, getSnapshot, types, type Instance } from 'mobx-state-tree'

import { decryptString, deriveKey, encryptString, generateRandomVerificationString, generateSalt } from './crypto'
import { replayEvents, type PersistedBullet } from './event-replayer'
import {
  appendEvent,
  createWorkspaceRecord,
  deleteAllWorkspaces,
  deleteWorkspaceRecord,
  getAllEvents,
  getWorkspaceRecord,
  isEventStoreAvailable,
  listWorkspaces,
  renameWorkspaceRecord,
  replaceWorkspaceEvents,
  updateWorkspaceLockState,
  type EncryptedEventPayload,
  type EventPayloadMap,
  type EventRecord,
  type EventType,
  type ParentId,
  type WorkspaceRecord,
} from './event-store'
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, generateBulletId, generateWorkspaceId } from './id'

let recordingDepth = 0
let lastTimestamp = 0
let activeWorkspace: string | null = null

function setActiveWorkspace(id: string | null) {
  activeWorkspace = id
}

function getActiveWorkspace() {
  return activeWorkspace
}

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
  const workspaceId = getActiveWorkspace()
  if (!workspaceId) {
    return
  }

  void appendEvent(workspaceId, { type, payload, timestamp }).catch(error => {
    console.error(`[event-store] Failed to append event "${type}"`, error)
  })
}

function toSnapshot(node: PersistedBullet): any {
  return {
    id: node.id,
    content: node.content,
    context: node.context,
    collapsed: node.collapsed,
    checked: node.checked,
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
    checked: Boolean(bullet.checked),
    createdAt: typeof bullet.createdAt === 'number' ? bullet.createdAt : Date.now(),
    children: Array.isArray(bullet.children) ? bullet.children.map(normalizePersistedBullet) : [],
  }
}

function createPersistedBullet({
  content,
  context = '',
  collapsed = false,
  checked = false,
  children = [],
}: {
  content: string
  context?: string
  collapsed?: boolean
  checked?: boolean
  children?: PersistedBullet[]
}): PersistedBullet {
  return {
    id: generateBulletId(),
    content,
    context,
    collapsed,
    checked,
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

function createBlankWorkspaceTree(): PersistedBullet[] {
  return [
    createPersistedBullet({
      content: '',
      context: '',
      children: [],
    }),
  ]
}

function createCreationEvents(
  nodes: PersistedBullet[],
  parentId: ParentId,
): Array<Omit<EventRecord, 'id' | 'workspaceId'>> {
  const events: Array<Omit<EventRecord, 'id' | 'workspaceId'>> = []
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

async function replaceEventStoreWithTree(workspaceId: string, nodes: PersistedBullet[]) {
  if (!isEventStoreAvailable()) {
    return
  }

  const events = createCreationEvents(nodes, null)
  await replaceWorkspaceEvents(workspaceId, events)
}

type LockVerificationPayload = {
  salt: string
  iv: string
  data: string
}

function parseVerificationPayload(value: string | null | undefined): LockVerificationPayload | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.salt === 'string' &&
      typeof parsed.iv === 'string' &&
      typeof parsed.data === 'string'
    ) {
      return { salt: parsed.salt, iv: parsed.iv, data: parsed.data }
    }
    return null
  } catch (error) {
    console.error('[store] Failed to parse verification payload', error)
    return null
  }
}

function isEncryptedPayload(payload: unknown): payload is EncryptedEventPayload {
  return (
    Boolean(payload) &&
    typeof payload === 'object' &&
    (payload as EncryptedEventPayload).__encrypted === true &&
    typeof (payload as EncryptedEventPayload).iv === 'string' &&
    typeof (payload as EncryptedEventPayload).data === 'string'
  )
}

export const Bullet: any = types
  .model('Bullet', {
    id: types.identifier,
    content: types.string,
    context: types.optional(types.string, ''),
    children: types.array(types.late(() => Bullet)),
    collapsed: types.optional(types.boolean, false),
    checked: types.optional(types.boolean, false),
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
    toggleChecked() {
      self.checked = !self.checked
    },
    setChecked(checked: boolean) {
      self.checked = checked
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

const WorkspaceModel = types.model('Workspace', {
  id: types.identifier,
  name: types.string,
  createdAt: types.number,
  updatedAt: types.number,
  locked: types.optional(types.boolean, false),
  lockTestName: types.maybeNull(types.string),
  lockTestValue: types.maybeNull(types.string),
})

export const RootStore = types
  .model('RootStore', {
    bullets: types.array(Bullet),
    zoomedBulletId: types.maybeNull(types.string),
    history: types.array(types.frozen()),
    historyIndex: types.optional(types.number, -1),
    searchQuery: types.optional(types.string, ''),
    workspaces: types.array(WorkspaceModel),
    currentWorkspace: types.maybeNull(types.string),
    lockedWorkspaceId: types.maybeNull(types.string),
    isBootstrapped: types.optional(types.boolean, false),
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
    get currentWorkspaceRecord() {
      return self.workspaces.find(workspace => workspace.id === self.currentWorkspace) ?? null
    },
    get isCurrentWorkspaceLocked() {
      if (!self.currentWorkspace) return false
      return this.currentWorkspaceRecord?.locked ?? false
    },
  }))
  .actions(self => {
    const storeWithActions = self as typeof self & {
      saveToHistory(): void
      createEmptyBullet(
        parent: Instance<typeof Bullet> | null,
        options?: { skipHistory?: boolean },
      ): Instance<typeof Bullet>
      loadFromEventStore(workspaceId?: string): Promise<void>
    }

    const applyWorkspaceRecords = (records: WorkspaceRecord[]) => {
      const sorted = [...records].sort((a, b) => {
        if (a.createdAt === b.createdAt) {
          return a.name.localeCompare(b.name)
        }
        return a.createdAt - b.createdAt
      })

      self.workspaces.replace(sorted.map(record => WorkspaceModel.create(record)))

      if (self.lockedWorkspaceId) {
        const lockedRecord = self.workspaces.find(workspace => workspace.id === self.lockedWorkspaceId)
        if (!lockedRecord?.locked) {
          self.lockedWorkspaceId = null
        }
      }
    }

    const snapshotWorkspaces = (): WorkspaceRecord[] =>
      self.workspaces.map(workspace => ({
        id: workspace.id,
        name: workspace.name,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        locked: workspace.locked,
        lockTestName: workspace.lockTestName,
        lockTestValue: workspace.lockTestValue,
      }))

    const persistWorkspaceSelection = (workspaceId: string | null) => {
      setActiveWorkspace(workspaceId)
      self.currentWorkspace = workspaceId
      if (!workspaceId) {
        self.lockedWorkspaceId = null
      }
    }

    return {
      bootstrap: flow(function* (initialWorkspaceId?: string) {
        if (self.isBootstrapped) {
          if (initialWorkspaceId && initialWorkspaceId !== self.currentWorkspace) {
            const candidate = self.workspaces.find(workspace => workspace.id === initialWorkspaceId)
            if (candidate) {
              yield storeWithActions.loadFromEventStore(candidate.id)
            }
          }
          return self.currentWorkspace
        }

        let records: WorkspaceRecord[] = []

        if (isEventStoreAvailable()) {
          try {
            records = (yield listWorkspaces()) as WorkspaceRecord[]
          } catch (error) {
            console.error('[store] Failed to list workspaces', error)
          }
        }

        if (records.length === 0) {
          const now = Date.now()
          let fallbackRecord: WorkspaceRecord = {
            id: DEFAULT_WORKSPACE_ID,
            name: DEFAULT_WORKSPACE_NAME,
            createdAt: now,
            updatedAt: now,
          }

          if (isEventStoreAvailable()) {
            try {
              fallbackRecord = (yield createWorkspaceRecord(DEFAULT_WORKSPACE_NAME)) as WorkspaceRecord
              records = (yield listWorkspaces()) as WorkspaceRecord[]
            } catch (error) {
              console.error('[store] Failed to create default workspace', error)
            }
          } else {
            records = [fallbackRecord]
          }

          if (records.length === 0) {
            records = [fallbackRecord]
          }
        }

        applyWorkspaceRecords(records)

        const trimmedInitialId = initialWorkspaceId?.trim() || null
        const fallbackWorkspaceId = records[0]?.id ?? null
        const targetWorkspaceId =
          trimmedInitialId && records.some(workspace => workspace.id === trimmedInitialId)
            ? trimmedInitialId
            : fallbackWorkspaceId

        if (targetWorkspaceId) {
          yield storeWithActions.loadFromEventStore(targetWorkspaceId)
        } else {
          persistWorkspaceSelection(null)
          self.bullets.clear()
        }

        self.isBootstrapped = true
        return self.currentWorkspace
      }),
      selectWorkspace: flow(function* (workspaceId: string) {
        const trimmed = workspaceId.trim()
        if (!trimmed || trimmed === self.currentWorkspace) {
          return
        }

        if (!self.workspaces.some(workspace => workspace.id === trimmed)) {
          console.warn(`[store] Workspace "${trimmed}" not found`)
          return
        }

        yield storeWithActions.loadFromEventStore(trimmed)
      }),
      createWorkspace: flow(function* (workspaceName: string) {
        const trimmed = workspaceName.trim()
        if (!trimmed) {
          const error = new Error('Workspace name is required')
          ;(error as any).code = 'WORKSPACE_NAME_REQUIRED'
          throw error
        }

        let record: WorkspaceRecord

        if (isEventStoreAvailable()) {
          try {
            record = (yield createWorkspaceRecord(trimmed)) as WorkspaceRecord
            yield appendEvent(record.id, {
              type: 'workspace_created',
              payload: { id: record.id, name: record.name, createdAt: record.createdAt },
              timestamp: nextTimestamp(),
            })
            const records = (yield listWorkspaces()) as WorkspaceRecord[]
            applyWorkspaceRecords(records)
          } catch (error) {
            console.error('[store] Failed to create workspace', error)
            throw error
          }
        } else {
          const now = Date.now()
          record = {
            id: generateWorkspaceId(),
            name: trimmed,
            createdAt: now,
            updatedAt: now,
          }
          const records = [...snapshotWorkspaces(), record]
          applyWorkspaceRecords(records)
        }

        yield storeWithActions.loadFromEventStore(record.id)
        return record
      }),
      renameCurrentWorkspace: flow(function* (nextName: string) {
        const trimmed = nextName.trim()
        const currentId = self.currentWorkspace
        const currentRecord = self.currentWorkspaceRecord
        if (!currentId || !currentRecord) {
          return
        }

        if (!trimmed) {
          const error = new Error('Workspace name is required')
          ;(error as any).code = 'WORKSPACE_NAME_REQUIRED'
          throw error
        }

        if (trimmed === currentRecord.name) {
          return
        }

        if (isEventStoreAvailable()) {
          try {
            const updated = (yield renameWorkspaceRecord(currentId, trimmed)) as WorkspaceRecord
            yield appendEvent(currentId, {
              type: 'workspace_renamed',
              payload: { id: currentId, name: updated.name, updatedAt: updated.updatedAt },
              timestamp: nextTimestamp(),
            })
            const records = (yield listWorkspaces()) as WorkspaceRecord[]
            applyWorkspaceRecords(records)
          } catch (error) {
            console.error('[store] Failed to rename workspace', error)
            throw error
          }
        } else {
          const records = snapshotWorkspaces().map(record =>
            record.id === currentId ? { ...record, name: trimmed, updatedAt: Date.now() } : record,
          )
          applyWorkspaceRecords(records)
        }

        yield storeWithActions.loadFromEventStore(currentId)
      }),
      deleteCurrentWorkspace: flow(function* () {
        const currentId = self.currentWorkspace
        if (!currentId) {
          return
        }

        if (self.lockedWorkspaceId === currentId) {
          self.lockedWorkspaceId = null
        }

        if (isEventStoreAvailable()) {
          try {
            yield deleteWorkspaceRecord(currentId)
          } catch (error) {
            console.error('[store] Failed to delete workspace', error)
            throw error
          }

          let records: WorkspaceRecord[] = []
          try {
            records = (yield listWorkspaces()) as WorkspaceRecord[]
          } catch (error) {
            console.error('[store] Failed to refresh workspace list', error)
          }

          if (records.length === 0) {
            const welcomeTree = createWelcomeTree()
            let fallbackRecord: WorkspaceRecord = {
              id: DEFAULT_WORKSPACE_ID,
              name: DEFAULT_WORKSPACE_NAME,
              createdAt: welcomeTree[0]?.createdAt ?? Date.now(),
              updatedAt: Date.now(),
            }

            try {
              fallbackRecord = (yield createWorkspaceRecord(DEFAULT_WORKSPACE_NAME)) as WorkspaceRecord
              records = (yield listWorkspaces()) as WorkspaceRecord[]
            } catch (error) {
              console.error('[store] Failed to recreate default workspace', error)
              records = [fallbackRecord]
            }

            yield replaceEventStoreWithTree(fallbackRecord.id, welcomeTree)

            if (records.length === 0) {
              records = [fallbackRecord]
            }
          }

          applyWorkspaceRecords(records)
          const nextWorkspaceId = records[0]?.id ?? null
          if (nextWorkspaceId) {
            yield storeWithActions.loadFromEventStore(nextWorkspaceId)
          } else {
            persistWorkspaceSelection(null)
          }
        } else {
          let records = snapshotWorkspaces().filter(record => record.id !== currentId)
          if (records.length === 0) {
            const now = Date.now()
            records = [
              {
                id: DEFAULT_WORKSPACE_ID,
                name: DEFAULT_WORKSPACE_NAME,
                createdAt: now,
                updatedAt: now,
              },
            ]
          }

          applyWorkspaceRecords(records)
          const nextWorkspaceId = records[0]?.id ?? null
          if (nextWorkspaceId) {
            yield storeWithActions.loadFromEventStore(nextWorkspaceId)
          } else {
            persistWorkspaceSelection(null)
          }
        }
      }),
      deleteAllWorkspaces: flow(function* () {
        self.lockedWorkspaceId = null

        if (isEventStoreAvailable()) {
          try {
            yield deleteAllWorkspaces()
          } catch (error) {
            console.error('[store] Failed to delete all workspaces', error)
            throw error
          }

          const welcomeTree = createWelcomeTree()

          let defaultRecord: WorkspaceRecord = {
            id: DEFAULT_WORKSPACE_ID,
            name: DEFAULT_WORKSPACE_NAME,
            createdAt: welcomeTree[0]?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
          }

          try {
            defaultRecord = (yield createWorkspaceRecord(DEFAULT_WORKSPACE_NAME)) as WorkspaceRecord
          } catch (error) {
            console.error('[store] Failed to create default workspace after clearing', error)
          }

          yield replaceEventStoreWithTree(defaultRecord.id, welcomeTree)

          let records: WorkspaceRecord[] = []
          try {
            records = (yield listWorkspaces()) as WorkspaceRecord[]
          } catch (error) {
            records = [defaultRecord]
          }

          if (records.length === 0) {
            records = [defaultRecord]
          }

          applyWorkspaceRecords(records)
          yield storeWithActions.loadFromEventStore(defaultRecord.id)
        } else {
          const now = Date.now()
          const defaultRecord: WorkspaceRecord = {
            id: DEFAULT_WORKSPACE_ID,
            name: DEFAULT_WORKSPACE_NAME,
            createdAt: now,
            updatedAt: now,
          }
          applyWorkspaceRecords([defaultRecord])
          yield storeWithActions.loadFromEventStore(defaultRecord.id)
        }
      }),
      lockWorkspace: flow(function* (workspaceId: string, password: string) {
        const trimmedId = workspaceId.trim()
        if (!trimmedId) {
          return
        }

        const target = self.workspaces.find(workspace => workspace.id === trimmedId)
        if (!target) {
          const error = new Error('Workspace not found')
          ;(error as any).code = 'WORKSPACE_NOT_FOUND'
          throw error
        }

        if (!password) {
          const error = new Error('Password is required')
          ;(error as any).code = 'WORKSPACE_PASSWORD_REQUIRED'
          throw error
        }

        if (target.locked) {
          return
        }

        if (!isEventStoreAvailable()) {
          const error = new Error('Event store is not available')
          ;(error as any).code = 'EVENT_STORE_UNAVAILABLE'
          throw error
        }

        try {
          const events = (yield getAllEvents(trimmedId)) as EventRecord[]
          const salt = generateSalt()
          const key = (yield deriveKey(password, salt)) as CryptoKey
          const verificationName = generateRandomVerificationString()
          const verificationEncrypted = (yield encryptString(key, verificationName)) as {
            ciphertext: string
            iv: string
          }

          const encryptedEvents: Array<Omit<EventRecord, 'id' | 'workspaceId'>> = []

          for (const event of events) {
            if (event.type.startsWith('workspace_')) {
              encryptedEvents.push({
                type: event.type,
                payload: event.payload,
                timestamp: event.timestamp,
              })
              continue
            }

            const plaintext = JSON.stringify(event.payload)
            const encryptedPayload = (yield encryptString(key, plaintext)) as { ciphertext: string; iv: string }
            encryptedEvents.push({
              type: event.type,
              payload: {
                __encrypted: true,
                iv: encryptedPayload.iv,
                data: encryptedPayload.ciphertext,
              },
              timestamp: event.timestamp,
            })
          }

          yield replaceWorkspaceEvents(trimmedId, encryptedEvents)

          const verificationPayload: LockVerificationPayload = {
            salt,
            iv: verificationEncrypted.iv,
            data: verificationEncrypted.ciphertext,
          }

          const updatedRecord = (yield updateWorkspaceLockState(trimmedId, {
            locked: true,
            lockTestName: verificationName,
            lockTestValue: JSON.stringify(verificationPayload),
          })) as WorkspaceRecord

          target.locked = true
          target.lockTestName = updatedRecord.lockTestName ?? verificationName
          target.lockTestValue = updatedRecord.lockTestValue ?? JSON.stringify(verificationPayload)

          if (self.currentWorkspace === trimmedId) {
            self.lockedWorkspaceId = trimmedId

            runWithoutRecording(() => {
              self.zoomedBulletId = null
              applySnapshot(self.bullets, [])
            })

            self.history.clear()
            self.historyIndex = -1
          }

          return true
        } catch (error) {
          console.error('[store] Failed to lock workspace', error)
          throw error
        }
      }),
      unlockWorkspace: flow(function* (workspaceId: string, password: string) {
        const trimmedId = workspaceId.trim()
        if (!trimmedId) {
          return
        }

        const target = self.workspaces.find(workspace => workspace.id === trimmedId)
        if (!target) {
          const error = new Error('Workspace not found')
          ;(error as any).code = 'WORKSPACE_NOT_FOUND'
          throw error
        }

        if (!target.locked) {
          return
        }

        if (!password) {
          const error = new Error('Password is required')
          ;(error as any).code = 'WORKSPACE_PASSWORD_REQUIRED'
          throw error
        }

        if (!isEventStoreAvailable()) {
          const error = new Error('Event store is not available')
          ;(error as any).code = 'EVENT_STORE_UNAVAILABLE'
          throw error
        }

        try {
          const persistedRecord = (yield getWorkspaceRecord(trimmedId)) as WorkspaceRecord | undefined
          const verificationName = persistedRecord?.lockTestName ?? target.lockTestName
          const verificationPayload = parseVerificationPayload(persistedRecord?.lockTestValue ?? target.lockTestValue)

          if (!verificationName || !verificationPayload) {
            const error = new Error('Workspace lock metadata is missing or corrupted')
            ;(error as any).code = 'WORKSPACE_LOCK_METADATA_MISSING'
            throw error
          }

          let key: CryptoKey
          try {
            key = (yield deriveKey(password, verificationPayload.salt)) as CryptoKey
          } catch (deriveError) {
            console.error('[store] Failed to derive key during unlock', deriveError)
            const error = new Error('Unable to unlock workspace')
            ;(error as any).code = 'WORKSPACE_UNLOCK_FAILED'
            throw error
          }

          let verificationResult: string
          try {
            verificationResult = (yield decryptString(key, verificationPayload.data, verificationPayload.iv)) as string
          } catch (decryptError) {
            console.error('[store] Failed to verify workspace password', decryptError)
            const error = new Error('Incorrect password')
            ;(error as any).code = 'WORKSPACE_UNLOCK_FAILED'
            throw error
          }

          if (verificationResult !== verificationName) {
            const error = new Error('Incorrect password')
            ;(error as any).code = 'WORKSPACE_UNLOCK_FAILED'
            throw error
          }

          const events = (yield getAllEvents(trimmedId)) as EventRecord[]
          const decryptedEvents: Array<Omit<EventRecord, 'id' | 'workspaceId'>> = []

          for (const event of events) {
            if (event.type.startsWith('workspace_')) {
              decryptedEvents.push({
                type: event.type,
                payload: event.payload,
                timestamp: event.timestamp,
              })
              continue
            }

            if (!isEncryptedPayload(event.payload)) {
              const error = new Error('Encountered unencrypted event while unlocking workspace')
              ;(error as any).code = 'WORKSPACE_UNLOCK_FAILED'
              throw error
            }

            let plaintext: string
            try {
              plaintext = (yield decryptString(key, event.payload.data, event.payload.iv)) as string
            } catch (decryptError) {
              console.error('[store] Failed to decrypt workspace events', decryptError)
              const error = new Error('Unable to decrypt workspace events')
              ;(error as any).code = 'WORKSPACE_UNLOCK_FAILED'
              throw error
            }

            try {
              const parsedPayload = JSON.parse(plaintext)
              decryptedEvents.push({
                type: event.type,
                payload: parsedPayload,
                timestamp: event.timestamp,
              })
            } catch (parseError) {
              console.error('[store] Failed to parse decrypted payload', parseError)
              const error = new Error('Unable to decrypt workspace events')
              ;(error as any).code = 'WORKSPACE_UNLOCK_FAILED'
              throw error
            }
          }

          yield replaceWorkspaceEvents(trimmedId, decryptedEvents)

          const updatedRecord = (yield updateWorkspaceLockState(trimmedId, {
            locked: false,
            lockTestName: null,
            lockTestValue: null,
          })) as WorkspaceRecord

          target.locked = Boolean(updatedRecord.locked)
          target.lockTestName = updatedRecord.lockTestName ?? null
          target.lockTestValue = updatedRecord.lockTestValue ?? null

          if (self.lockedWorkspaceId === trimmedId) {
            self.lockedWorkspaceId = null
          }

          if (self.currentWorkspace === trimmedId) {
            yield storeWithActions.loadFromEventStore(trimmedId)
          }

          return true
        } catch (error) {
          if (!(error instanceof Error)) {
            console.error('[store] Unknown error during unlock', error)
            const wrapped = new Error('Unable to unlock workspace')
            ;(wrapped as any).code = 'WORKSPACE_UNLOCK_FAILED'
            throw wrapped
          }

          if (!(error as any).code) {
            ;(error as any).code = 'WORKSPACE_UNLOCK_FAILED'
          }

          throw error
        }
      }),
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
      setBulletChecked(bulletId: string, checked: boolean) {
        const bullet = self.findBulletById(bulletId)
        if (!bullet) {
          return
        }

        bullet.setChecked(checked)
        emitEvent('bullet_checked_updated', { id: bulletId, checked })
      },
      toggleBulletChecked(bulletId: string) {
        const bullet = self.findBulletById(bulletId)
        if (!bullet) {
          return
        }

        bullet.toggleChecked()
        emitEvent('bullet_checked_updated', { id: bulletId, checked: bullet.checked })
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
          id: generateBulletId(),
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
      loadFromEventStore: flow(function* (workspaceId?: string) {
        if (typeof window === 'undefined') return

        const resolvedWorkspaceId = workspaceId?.trim() || self.currentWorkspace || self.workspaces[0]?.id || null

        if (!resolvedWorkspaceId) {
          persistWorkspaceSelection(null)
          self.bullets.clear()
          self.history.clear()
          self.historyIndex = -1
          return
        }

        persistWorkspaceSelection(resolvedWorkspaceId)

        const workspaceRecord = self.workspaces.find(workspace => workspace.id === resolvedWorkspaceId) ?? null
        if (workspaceRecord?.locked) {
          self.lockedWorkspaceId = resolvedWorkspaceId

          runWithoutRecording(() => {
            self.zoomedBulletId = null
            applySnapshot(self.bullets, [])
          })

          self.history.clear()
          self.historyIndex = -1
          return
        }

        self.lockedWorkspaceId = null

        let persistedBullets: PersistedBullet[] = []

        if (isEventStoreAvailable()) {
          try {
            const events = (yield getAllEvents(resolvedWorkspaceId)) as EventRecord[]
            if (events.length > 0) {
              const latestTimestamp = events.reduce((max, event) => Math.max(max, event.timestamp), 0)
              if (latestTimestamp > lastTimestamp) {
                lastTimestamp = latestTimestamp
              }

              const workspaceEvents = events.filter(event => event.type.startsWith('workspace_'))
              const bulletEvents = events.filter(event => !event.type.startsWith('workspace_'))

              if (bulletEvents.length > 0) {
                persistedBullets = replayEvents(bulletEvents)
              } else if (workspaceEvents.length > 0) {
                persistedBullets = createBlankWorkspaceTree()
                const creationEvents = createCreationEvents(persistedBullets, null)
                const normalizedWorkspaceEvents = workspaceEvents.map(event => ({
                  type: event.type,
                  payload: event.payload,
                  timestamp: event.timestamp,
                }))
                yield replaceWorkspaceEvents(resolvedWorkspaceId, [...normalizedWorkspaceEvents, ...creationEvents])
              } else {
                persistedBullets = createWelcomeTree()
                yield replaceEventStoreWithTree(resolvedWorkspaceId, persistedBullets)
              }
            } else {
              persistedBullets = createWelcomeTree()
              yield replaceEventStoreWithTree(resolvedWorkspaceId, persistedBullets)
            }
          } catch (error) {
            console.error('Failed to load events from IndexedDB', error)
            persistedBullets = createWelcomeTree()
            yield replaceEventStoreWithTree(resolvedWorkspaceId, persistedBullets)
          }
        } else {
          persistedBullets = createWelcomeTree()
        }

        const previousZoomedId = self.zoomedBulletId

        runWithoutRecording(() => {
          self.zoomedBulletId = null
          const snapshot = persistedBullets.map(node => toSnapshot(node))
          applySnapshot(self.bullets, snapshot)
        })

        if (previousZoomedId) {
          const restored = self.findBulletById(previousZoomedId)
          if (restored) {
            self.zoomedBulletId = previousZoomedId
          }
        }

        self.history.clear()
        self.historyIndex = -1
        storeWithActions.saveToHistory()
      }),
      exportData() {
        const data = {
          bullets: getSnapshot(self.bullets),
          zoomedBulletId: self.zoomedBulletId,
          workspaceId: self.currentWorkspace,
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
            self.zoomedBulletId = null
            const snapshot = normalized.map(node => toSnapshot(node))
            applySnapshot(self.bullets, snapshot)
          })
          self.history.clear()
          self.historyIndex = -1
          storeWithActions.saveToHistory()

          runWithoutRecordingAsync(async () => {
            const workspaceId = self.currentWorkspace || self.workspaces[0]?.id || DEFAULT_WORKSPACE_ID
            await replaceEventStoreWithTree(workspaceId, normalized)
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
          self.zoomedBulletId = null
          const snapshot = welcomeTree.map(node => toSnapshot(node))
          applySnapshot(self.bullets, snapshot)
        })

        self.history.clear()
        self.historyIndex = -1
        storeWithActions.saveToHistory()

        runWithoutRecordingAsync(async () => {
          const workspaceId = self.currentWorkspace || self.workspaces[0]?.id || DEFAULT_WORKSPACE_ID
          await replaceEventStoreWithTree(workspaceId, welcomeTree)
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
          id: generateBulletId(),
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
      workspaces: [],
      currentWorkspace: null,
      lockedWorkspaceId: null,
      isBootstrapped: false,
    })
  }
  return store
}

export function getStore() {
  return store
}
