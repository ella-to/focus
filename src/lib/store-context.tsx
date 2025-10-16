'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useRef } from 'react'

import { initializeStore, type IRootStore } from './store'

const StoreContext = createContext<IRootStore | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<IRootStore | null>(null)
  const hasLoadedRef = useRef(false)

  if (!storeRef.current) {
    storeRef.current = initializeStore()
  }

  useEffect(() => {
    const store = storeRef.current
    if (!store || hasLoadedRef.current) {
      return
    }

    void store.bootstrap()

    hasLoadedRef.current = true
  }, [])

  return <StoreContext.Provider value={storeRef.current}>{children}</StoreContext.Provider>
}

export function useStore() {
  const store = useContext(StoreContext)
  if (!store) {
    throw new Error('useStore must be used within StoreProvider')
  }
  return store
}
