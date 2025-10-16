const DB_NAME = 'focus-event-store'
const DB_VERSION = 1
const STORE_NAME = 'events'

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

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
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

function withStore<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return openDatabase().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode)
        const objectStore = transaction.objectStore(STORE_NAME)

        let result: T

        const fail = (error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)))
        }

        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () => fail(transaction.error || new Error('Transaction failed'))
        transaction.onabort = transaction.onerror

        Promise.resolve(handler(objectStore))
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

export function isEventStoreAvailable(): boolean {
  return isIndexedDbAvailable()
}

export async function appendEvent<T extends EventType>(
  record: Omit<EventRecord<T>, 'id'>,
): Promise<number | undefined> {
  if (!isIndexedDbAvailable()) {
    console.warn('[event-store] IndexedDB not available; event not persisted.')
    return undefined
  }

  return withStore('readwrite', async store => {
    const request = store.add(record)
    const id = await promisifyRequest(request)
    return typeof id === 'number' ? id : undefined
  })
}

export async function getAllEvents(): Promise<EventRecord[]> {
  if (!isIndexedDbAvailable()) {
    return []
  }

  return withStore('readonly', async store => {
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

export async function bulkInsertEvents(events: Omit<EventRecord, 'id'>[]): Promise<void> {
  if (!isIndexedDbAvailable()) {
    return
  }

  return withStore('readwrite', async store => {
    for (const event of events) {
      await promisifyRequest(store.add(event))
    }
  })
}
