import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, ensureWorkspaceId, generateWorkspaceId } from './id'

const DB_NAME = 'focus-event-store'
const DB_VERSION = 4
const STORE_NAME = 'events'
const WORKSPACE_STORE = 'workspaces'
export const WORKSPACE_NOT_FOUND_ERROR = 'WORKSPACE_NOT_FOUND'

export type ParentId = string | null

export type EventType =
  | 'bullet_created'
  | 'bullet_deleted'
  | 'bullet_moved'
  | 'bullet_indented'
  | 'bullet_outdented'
  | 'bullet_content_updated'
  | 'bullet_context_updated'
  | 'bullet_collapsed_updated'
  | 'workspace_created'
  | 'workspace_renamed'
  | 'workspace_deleted'

export interface EventPayloadMap {
  bullet_created: {
    id: string
    parentId: ParentId
    index: number
    content: string
    context: string
    collapsed: boolean
    createdAt: number
  }
  bullet_deleted: {
    id: string
    parentId: ParentId
    index: number
  }
  bullet_moved: {
    id: string
    parentId: ParentId
    fromIndex: number
    toIndex: number
  }
  bullet_indented: {
    id: string
    fromParentId: ParentId
    fromIndex: number
    toParentId: string
    toIndex: number
  }
  bullet_outdented: {
    id: string
    fromParentId: string
    fromIndex: number
    toParentId: ParentId
    toIndex: number
  }
  bullet_content_updated: {
    id: string
    content: string
  }
  bullet_context_updated: {
    id: string
    context: string
  }
  bullet_collapsed_updated: {
    id: string
    collapsed: boolean
  }
  workspace_created: {
    id: string
    name: string
    createdAt: number
  }
  workspace_renamed: {
    id: string
    name: string
    updatedAt: number
  }
  workspace_deleted: {
    id: string
    deletedAt: number
  }
}

export type EventRecord<T extends EventType = EventType> = {
  id?: number
  type: T
  payload: EventPayloadMap[T]
  timestamp: number
  workspaceId: string
}

export interface WorkspaceRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

async function upgradeDatabase(db: IDBDatabase, transaction: IDBTransaction, oldVersion: number) {
  let eventsStore: IDBObjectStore

  if (!db.objectStoreNames.contains(STORE_NAME)) {
    eventsStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
  } else {
    eventsStore = transaction.objectStore(STORE_NAME)
  }

  if (!eventsStore.indexNames.contains('workspaceId')) {
    eventsStore.createIndex('workspaceId', 'workspaceId', { unique: false })
  }

  let workspaceStore!: IDBObjectStore
  const shouldCreateStore = !db.objectStoreNames.contains(WORKSPACE_STORE)
  let existingWorkspaces: WorkspaceRecord[] = []
  let recreateWorkspaceStore = shouldCreateStore
  const idUpdates = new Map<string, string>()

  if (!shouldCreateStore) {
    const legacyStore = transaction.objectStore(WORKSPACE_STORE)
    const keyPath = legacyStore.keyPath
    const records = ((await promisifyRequest(legacyStore.getAll())) as any[]) ?? []

    if (keyPath !== 'id') {
      recreateWorkspaceStore = true
      existingWorkspaces = records.map(record => {
        const rawName = record?.name ? String(record.name) : DEFAULT_WORKSPACE_NAME
        const createdAt = typeof record?.createdAt === 'number' ? record.createdAt : Date.now()
        const updatedAt = typeof record?.updatedAt === 'number' ? record.updatedAt : createdAt
        const normalizedId = ensureWorkspaceId(rawName)
        const previousId = record?.name ? String(record.name) : ''
        if (previousId && normalizedId !== previousId) {
          idUpdates.set(previousId, normalizedId)
        }
        return {
          id: normalizedId,
          name: rawName,
          createdAt,
          updatedAt,
        }
      })
    } else {
      existingWorkspaces = records.map(record => {
        const rawId = record?.id ? String(record.id) : 'default'
        const normalizedId = ensureWorkspaceId(rawId)
        if (normalizedId !== rawId) {
          idUpdates.set(rawId, normalizedId)
        }
        const rawName = record?.name ? String(record.name) : DEFAULT_WORKSPACE_NAME
        const createdAt = typeof record?.createdAt === 'number' ? record.createdAt : Date.now()
        const updatedAt = typeof record?.updatedAt === 'number' ? record.updatedAt : createdAt
        return {
          id: normalizedId,
          name: rawName,
          createdAt,
          updatedAt,
        }
      })
      workspaceStore = legacyStore
    }
  }

  if (recreateWorkspaceStore) {
    if (db.objectStoreNames.contains(WORKSPACE_STORE)) {
      db.deleteObjectStore(WORKSPACE_STORE)
    }
    workspaceStore = db.createObjectStore(WORKSPACE_STORE, { keyPath: 'id' })
  } else if (!workspaceStore) {
    workspaceStore = transaction.objectStore(WORKSPACE_STORE)
  }

  const workspaceIds = new Set(existingWorkspaces.map(workspace => workspace.id))

  if (existingWorkspaces.length === 0) {
    const now = Date.now()
    const defaultWorkspace: WorkspaceRecord = {
      id: DEFAULT_WORKSPACE_ID,
      name: DEFAULT_WORKSPACE_NAME,
      createdAt: now,
      updatedAt: now,
    }
    await promisifyRequest(workspaceStore.put(defaultWorkspace))
    existingWorkspaces.push(defaultWorkspace)
    workspaceIds.add(defaultWorkspace.id)
  } else {
    if (!recreateWorkspaceStore) {
      for (const [oldId, newId] of idUpdates) {
        if (oldId && oldId !== newId) {
          try {
            await promisifyRequest(workspaceStore.delete(oldId))
          } catch {
            // ignore missing records
          }
        }
      }
    }

    for (const record of existingWorkspaces) {
      workspaceIds.add(record.id)
      await promisifyRequest(workspaceStore.put(record))
    }
  }

  if (oldVersion < 3) {
    await iterateCursor(eventsStore.openCursor(), async cursor => {
      const value = cursor.value as Record<string, unknown>
      if (!value.workspaceId) {
        const legacyIdSource = typeof value.workspace === 'string' ? String(value.workspace) : 'default'
        const workspaceId = ensureWorkspaceId(legacyIdSource)
        const workspaceName = typeof value.workspace === 'string' ? String(value.workspace) : DEFAULT_WORKSPACE_NAME

        if (!workspaceIds.has(workspaceId)) {
          const now = Date.now()
          const record: WorkspaceRecord = {
            id: workspaceId,
            name: workspaceName,
            createdAt: now,
            updatedAt: now,
          }
          await promisifyRequest(workspaceStore.put(record))
          existingWorkspaces.push(record)
          workspaceIds.add(workspaceId)
        }

        value.workspaceId = workspaceId
        delete value.workspace
        cursor.update(value)
      }
    })
  }

  if (oldVersion < 4 && idUpdates.size > 0) {
    await iterateCursor(eventsStore.openCursor(), async cursor => {
      const value = cursor.value as Record<string, unknown>
      const currentId = typeof value.workspaceId === 'string' ? value.workspaceId : ''
      const updatedId = idUpdates.get(currentId)
      if (updatedId) {
        value.workspaceId = updatedId
        cursor.update(value)
      }
    })
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available in this environment'))
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = event => {
        const db = request.result
        const transaction = request.transaction
        if (!transaction) {
          return
        }

        upgradeDatabase(db, transaction, event.oldVersion).catch(error => {
          console.error('[event-store] Failed to upgrade database', error)
          try {
            transaction.abort()
          } catch (abortError) {
            console.error('[event-store] Failed to abort transaction after upgrade error', abortError)
          }
        })
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'))
    })
  }

  return dbPromise
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function withTransaction<T>(
  mode: IDBTransactionMode,
  storeNames: string[],
  handler: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  return openDatabase().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeNames, mode)

        let result: T

        const fail = (error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)))
        }

        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () => fail(transaction.error || new Error('Transaction failed'))
        transaction.onabort = transaction.onerror

        Promise.resolve(handler(transaction))
          .then(value => {
            result = value
          })
          .catch(error => {
            fail(error)
            try {
              transaction.abort()
            } catch {
              // ignore abort errors
            }
          })
      }),
  )
}

function withStore<T>(mode: IDBTransactionMode, handler: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  return withTransaction(mode, [STORE_NAME], transaction => handler(transaction.objectStore(STORE_NAME)))
}

function iterateCursor(
  request: IDBRequest<IDBCursorWithValue | null>,
  onCursor: (cursor: IDBCursorWithValue) => void | Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }

      Promise.resolve(onCursor(cursor))
        .then(() => cursor.continue())
        .catch(error => reject(error instanceof Error ? error : new Error(String(error))))
    }

    request.onerror = () => {
      reject(request.error || new Error('Cursor iteration failed'))
    }
  })
}

export function isEventStoreAvailable(): boolean {
  return isIndexedDbAvailable()
}

export async function appendEvent<T extends EventType>(
  workspaceId: string,
  record: Omit<EventRecord<T>, 'id' | 'workspaceId'>,
): Promise<number | undefined> {
  if (!isIndexedDbAvailable()) {
    console.warn('[event-store] IndexedDB not available; event not persisted.')
    return undefined
  }

  return withStore('readwrite', async store => {
    const request = store.add({ ...record, workspaceId })
    const id = await promisifyRequest(request)
    return typeof id === 'number' ? id : undefined
  })
}

export async function getAllEvents(workspaceId?: string): Promise<EventRecord[]> {
  if (!isIndexedDbAvailable()) {
    return []
  }

  return withStore('readonly', async store => {
    if (workspaceId) {
      if (!store.indexNames.contains('workspaceId')) {
        return []
      }
      const index = store.index('workspaceId')
      const request = index.getAll(IDBKeyRange.only(workspaceId))
      const events = await promisifyRequest(request)
      return ((events as EventRecord[]) ?? []).sort((a, b) => a.timestamp - b.timestamp)
    }

    const request = store.getAll()
    const events = await promisifyRequest(request)
    return ((events as EventRecord[]) ?? []).sort((a, b) => a.timestamp - b.timestamp)
  })
}

export async function clearEvents(): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  return withStore('readwrite', async store => {
    await promisifyRequest(store.clear())
  })
}

export async function bulkInsertEvents(
  workspaceId: string,
  events: Omit<EventRecord, 'id' | 'workspaceId'>[],
): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  return withStore('readwrite', async store => {
    for (const event of events) {
      await promisifyRequest(store.add({ ...event, workspaceId }))
    }
  })
}

export async function clearEventsForWorkspace(workspaceId: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  await withStore('readwrite', async store => {
    if (!store.indexNames.contains('workspaceId')) {
      return
    }

    const index = store.index('workspaceId')
    const request = index.openCursor(IDBKeyRange.only(workspaceId))

    await iterateCursor(request, cursor => {
      return promisifyRequest(cursor.delete()).then(() => undefined)
    })
  })
}

export async function replaceWorkspaceEvents(
  workspaceId: string,
  events: Omit<EventRecord, 'id' | 'workspaceId'>[],
): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  await clearEventsForWorkspace(workspaceId)

  if (events.length === 0) {
    return
  }

  await bulkInsertEvents(workspaceId, events)
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  if (!isIndexedDbAvailable()) {
    return [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: DEFAULT_WORKSPACE_NAME,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]
  }

  const workspaces = await withTransaction('readonly', [WORKSPACE_STORE], async transaction => {
    const store = transaction.objectStore(WORKSPACE_STORE)
    const request = store.getAll()
    const records = await promisifyRequest(request)
    const items = (records as WorkspaceRecord[] | undefined) ?? []
    return items.map(record => {
      const id = record?.id ? ensureWorkspaceId(String(record.id)) : DEFAULT_WORKSPACE_ID
      const name = record?.name ? String(record.name) : DEFAULT_WORKSPACE_NAME
      const createdAt = typeof record?.createdAt === 'number' ? record.createdAt : Date.now()
      const updatedAt = typeof record?.updatedAt === 'number' ? record.updatedAt : createdAt
      return { id, name, createdAt, updatedAt }
    })
  })

  return [...workspaces].sort((a, b) => a.createdAt - b.createdAt)
}

export async function createWorkspaceRecord(name: string): Promise<WorkspaceRecord> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Workspace name is required')
  }

  const now = Date.now()
  const record: WorkspaceRecord = {
    id: generateWorkspaceId(),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
  }

  if (!isIndexedDbAvailable()) {
    return record
  }

  await withTransaction('readwrite', [WORKSPACE_STORE], async transaction => {
    const store = transaction.objectStore(WORKSPACE_STORE)
    await promisifyRequest(store.add(record))
  })

  return record
}

export async function deleteWorkspaceRecord(id: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  await withTransaction('readwrite', [WORKSPACE_STORE, STORE_NAME], async transaction => {
    const workspaceStore = transaction.objectStore(WORKSPACE_STORE)
    const eventsStore = transaction.objectStore(STORE_NAME)

    const existing = await promisifyRequest(workspaceStore.get(id))
    if (!existing) {
      const error = new Error(`Workspace "${id}" not found`)
      ;(error as any).code = WORKSPACE_NOT_FOUND_ERROR
      throw error
    }

    await promisifyRequest(workspaceStore.delete(id))

    if (!eventsStore.indexNames.contains('workspaceId')) {
      return
    }

    const index = eventsStore.index('workspaceId')
    const request = index.openCursor(IDBKeyRange.only(id))

    await iterateCursor(request, cursor => {
      return promisifyRequest(cursor.delete()).then(() => undefined)
    })
  })
}

export async function renameWorkspaceRecord(id: string, name: string): Promise<WorkspaceRecord> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Workspace name is required')
  }

  if (!isIndexedDbAvailable()) {
    return {
      id,
      name: trimmed,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  return withTransaction('readwrite', [WORKSPACE_STORE], async transaction => {
    const workspaceStore = transaction.objectStore(WORKSPACE_STORE)

    const existing = (await promisifyRequest(workspaceStore.get(id))) as WorkspaceRecord | undefined
    if (!existing) {
      const error = new Error(`Workspace "${id}" not found`)
      ;(error as any).code = WORKSPACE_NOT_FOUND_ERROR
      throw error
    }

    const updated: WorkspaceRecord = {
      ...existing,
      name: trimmed,
      updatedAt: Date.now(),
    }

    await promisifyRequest(workspaceStore.put(updated))
    return updated
  })
}

export async function deleteAllWorkspaces(): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  await withTransaction('readwrite', [WORKSPACE_STORE, STORE_NAME], async transaction => {
    const workspaceStore = transaction.objectStore(WORKSPACE_STORE)
    const eventsStore = transaction.objectStore(STORE_NAME)

    await Promise.all([promisifyRequest(workspaceStore.clear()), promisifyRequest(eventsStore.clear())])
  })
}
