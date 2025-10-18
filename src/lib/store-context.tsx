'use client'

import type React from 'react'
import { createContext, useContext, useRef } from 'react'

import { initializeStore, type IRootStore } from './store'

const StoreContext = createContext<IRootStore | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<IRootStore | null>(null)

  if (!storeRef.current) {
    storeRef.current = initializeStore()
  }

  return <StoreContext.Provider value={storeRef.current}>{children}</StoreContext.Provider>
}

export function useStore() {
  const store = useContext(StoreContext)
  if (!store) {
    throw new Error('useStore must be used within StoreProvider')
  }
  return store
}
