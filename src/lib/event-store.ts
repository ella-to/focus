const DB_NAME = 'focus-event-store'
const DB_VERSION = 2
const STORE_NAME = 'events'
const WORKSPACE_STORE = 'workspaces'
export const DEFAULT_WORKSPACE = 'default'
export const WORKSPACE_EXISTS_ERROR = 'WORKSPACE_EXISTS'
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
}

export type EventRecord<T extends EventType = EventType> = {
  id?: number
  type: T
  payload: EventPayloadMap[T]
  timestamp: number
  workspace: string
}

export interface WorkspaceRecord {
  name: string
  createdAt: number
  updatedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
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
        const txn = request.transaction
        if (!txn) {
          return
        }

        const oldVersion = event.oldVersion
        let eventsStore: IDBObjectStore

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          eventsStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
        } else {
          eventsStore = txn.objectStore(STORE_NAME)
        }

        if (oldVersion < 2) {
          if (!eventsStore.indexNames.contains('workspace')) {
            eventsStore.createIndex('workspace', 'workspace', { unique: false })
          }

          let workspaceStore: IDBObjectStore
          if (!db.objectStoreNames.contains(WORKSPACE_STORE)) {
            workspaceStore = db.createObjectStore(WORKSPACE_STORE, { keyPath: 'name' })
          } else {
            workspaceStore = txn.objectStore(WORKSPACE_STORE)
          }

          const defaultWorkspace: WorkspaceRecord = {
            name: DEFAULT_WORKSPACE,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }

          workspaceStore.put(defaultWorkspace)

          const cursorRequest = eventsStore.openCursor()
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (!cursor) {
              return
            }
            const value = cursor.value as EventRecord
            if (!value.workspace) {
              value.workspace = DEFAULT_WORKSPACE
              cursor.update(value)
            }
            cursor.continue()
          }
        }
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

function withStore<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
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
  workspace: string,
  record: Omit<EventRecord<T>, 'id' | 'workspace'>,
): Promise<number | undefined> {
  if (!isIndexedDbAvailable()) {
    console.warn('[event-store] IndexedDB not available; event not persisted.')
    return undefined
  }

  return withStore('readwrite', async store => {
    const request = store.add({ ...record, workspace })
    const id = await promisifyRequest(request)
    return typeof id === 'number' ? id : undefined
  })
}

export async function getAllEvents(workspace?: string): Promise<EventRecord[]> {
  if (!isIndexedDbAvailable()) {
    return []
  }

  return withStore('readonly', async store => {
    if (workspace) {
      let events: EventRecord[] = []
      if (store.indexNames.contains('workspace')) {
        const index = store.index('workspace')
        const request = index.getAll(IDBKeyRange.only(workspace))
        events = ((await promisifyRequest(request)) as EventRecord[]) ?? []
      }
      return events
    }

    const request = store.getAll()
    const events = await promisifyRequest(request)
    return (events as EventRecord[]) ?? []
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
  workspace: string,
  events: Omit<EventRecord, 'id' | 'workspace'>[],
): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  return withStore('readwrite', async store => {
    for (const event of events) {
      await promisifyRequest(store.add({ ...event, workspace }))
    }
  })
}

export async function clearEventsForWorkspace(workspace: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  await withStore('readwrite', async store => {
    if (!store.indexNames.contains('workspace')) {
      return
    }

    const index = store.index('workspace')
    const request = index.openCursor(IDBKeyRange.only(workspace))

    await iterateCursor(request, cursor => {
      return promisifyRequest(cursor.delete()).then(() => undefined)
    })
  })
}

export async function replaceWorkspaceEvents(
  workspace: string,
  events: Omit<EventRecord, 'id' | 'workspace'>[],
): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  await clearEventsForWorkspace(workspace)

  if (events.length === 0) {
    return
  }

  await bulkInsertEvents(workspace, events)
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  if (!isIndexedDbAvailable()) {
    return [
      {
        name: DEFAULT_WORKSPACE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]
  }

  const workspaces = await withTransaction('readonly', [WORKSPACE_STORE], async transaction => {
    const store = transaction.objectStore(WORKSPACE_STORE)
    const request = store.getAll()
    const records = await promisifyRequest(request)
    return (records as WorkspaceRecord[]) ?? []
  })

  if (workspaces.length === 0) {
    return []
  }

  return [...workspaces].sort((a, b) => a.createdAt - b.createdAt)
}

export async function workspaceExists(name: string): Promise<boolean> {
  if (!isIndexedDbAvailable()) {
    return name === DEFAULT_WORKSPACE
  }

  return withTransaction('readonly', [WORKSPACE_STORE], async transaction => {
    const store = transaction.objectStore(WORKSPACE_STORE)
    const request = store.get(name)
    const record = await promisifyRequest(request)
    return Boolean(record)
  })
}

export async function createWorkspaceRecord(name: string): Promise<WorkspaceRecord> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Workspace name is required')
  }

  const now = Date.now()
  const record: WorkspaceRecord = {
    name: trimmed,
    createdAt: now,
    updatedAt: now,
  }

  if (!isIndexedDbAvailable()) {
    return record
  }

  await withTransaction('readwrite', [WORKSPACE_STORE], async transaction => {
    const store = transaction.objectStore(WORKSPACE_STORE)
    const existing = await promisifyRequest(store.get(trimmed))
    if (existing) {
      const error = new Error(`Workspace "${trimmed}" already exists`)
      ;(error as any).code = WORKSPACE_EXISTS_ERROR
      throw error
    }

    await promisifyRequest(store.add(record))
  })

  return record
}

export async function deleteWorkspaceRecord(name: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  await withTransaction('readwrite', [WORKSPACE_STORE, STORE_NAME], async transaction => {
    const workspaceStore = transaction.objectStore(WORKSPACE_STORE)
    const eventsStore = transaction.objectStore(STORE_NAME)

    const existing = await promisifyRequest(workspaceStore.get(name))
    if (!existing) {
      const error = new Error(`Workspace "${name}" not found`)
      ;(error as any).code = WORKSPACE_NOT_FOUND_ERROR
      throw error
    }

    await promisifyRequest(workspaceStore.delete(name))

    if (!eventsStore.indexNames.contains('workspace')) {
      return
    }

    const index = eventsStore.index('workspace')
    const request = index.openCursor(IDBKeyRange.only(name))

    await iterateCursor(request, cursor => {
      return promisifyRequest(cursor.delete()).then(() => undefined)
    })
  })
}

export async function renameWorkspaceRecord(oldName: string, newName: string): Promise<void> {
  const trimmed = newName.trim()
  if (!trimmed) {
    throw new Error('Workspace name is required')
  }

  if (!isIndexedDbAvailable()) {
    return
  }

  await withTransaction('readwrite', [WORKSPACE_STORE, STORE_NAME], async transaction => {
    const workspaceStore = transaction.objectStore(WORKSPACE_STORE)
    const eventsStore = transaction.objectStore(STORE_NAME)

    const existing = await promisifyRequest(workspaceStore.get(oldName))
    if (!existing) {
      const error = new Error(`Workspace "${oldName}" not found`)
      ;(error as any).code = WORKSPACE_NOT_FOUND_ERROR
      throw error
    }

    const duplicate = await promisifyRequest(workspaceStore.get(trimmed))
    if (duplicate) {
      const error = new Error(`Workspace "${trimmed}" already exists`)
      ;(error as any).code = WORKSPACE_EXISTS_ERROR
      throw error
    }

    await promisifyRequest(workspaceStore.delete(oldName))
    await promisifyRequest(
      workspaceStore.add({
        ...existing,
        name: trimmed,
        updatedAt: Date.now(),
      } satisfies WorkspaceRecord),
    )

    if (!eventsStore.indexNames.contains('workspace')) {
      return
    }

    const index = eventsStore.index('workspace')
    const request = index.openCursor(IDBKeyRange.only(oldName))

    await iterateCursor(request, cursor => {
      const value = cursor.value as EventRecord
      value.workspace = trimmed
      return promisifyRequest(cursor.update(value)).then(() => undefined)
    })
  })
}

export async function deleteAllWorkspaces(): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  await withTransaction('readwrite', [WORKSPACE_STORE, STORE_NAME], async transaction => {
    const workspaceStore = transaction.objectStore(WORKSPACE_STORE)
    const eventsStore = transaction.objectStore(STORE_NAME)

    await Promise.all([
      promisifyRequest(workspaceStore.clear()),
      promisifyRequest(eventsStore.clear()),
    ])
  })
}
