"use client";

import type React from "react";

import { createContext, useContext, useRef, useEffect } from "react";
import { initializeStore, type IRootStore } from "./store";

const StoreContext = createContext<IRootStore | null>(null);

export function StoreProvider({
  children,
  initialZoomedBulletId,
}: {
  children: React.ReactNode;
  initialZoomedBulletId?: string | null;
}) {
  const storeRef = useRef<IRootStore | null>(null);
  const hasLoadedRef = useRef(false);

  if (!storeRef.current) {
    storeRef.current = initializeStore();
  }

  useEffect(() => {
    const store = storeRef.current;
    if (!store || hasLoadedRef.current) {
      return;
    }

    if (store.bullets.length === 0) {
      store.loadFromLocalStorage();
    }

    hasLoadedRef.current = true;
  }, []);

  useEffect(() => {
    const store = storeRef.current;
    if (!store) {
      return;
    }

    if (initialZoomedBulletId !== undefined) {
      store.setZoomedBulletId(initialZoomedBulletId);
    }
  }, [initialZoomedBulletId]);

  useEffect(() => {
    const store = storeRef.current;
    if (!store) return;

    const interval = setInterval(() => {
      store.saveToLocalStorage();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <StoreContext.Provider value={storeRef.current}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useStore must be used within StoreProvider");
  }
  return store;
}
