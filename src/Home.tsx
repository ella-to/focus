import { Breadcrumbs } from '@/components/breadcrumbs'
import { BulletList } from '@/components/bullet-list'
import { DataControls } from '@/components/data-controls'
import { SearchBar } from '@/components/search-bar'
import { Button } from '@/components/ui/button'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
import { StoreProvider, useStore } from '@/lib/store-context'
import { observer } from 'mobx-react-lite'
import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'

export function Home() {
  return (
    <StoreProvider>
      <HomeContent />
    </StoreProvider>
  )
}

const HomeContent = observer(() => {
  const store = useStore()
  const { workspaceId, bulletId } = useParams<{ workspaceId?: string; bulletId?: string }>()
  const navigate = useNavigate()
  const [showShortcuts, setShowShortcuts] = useState(true)
  const lastSyncedIdRef = useRef<string | null>(null)

  const routeWorkspaceId = workspaceId ?? null
  const routeBulletId = bulletId ?? null

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'x' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement
        if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          return
        }
        e.preventDefault()
        setShowShortcuts(prev => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [])

  useEffect(() => {
    let cancelled = false

    const syncWorkspace = async () => {
      if (!store.isBootstrapped) {
        const loadedId = (await store.bootstrap(routeWorkspaceId ?? undefined)) ?? store.currentWorkspace
        if (cancelled) return

        const activeId = loadedId || store.currentWorkspace || store.workspaces[0]?.id || null
        if (!routeWorkspaceId || (activeId && routeWorkspaceId !== activeId)) {
          if (activeId) {
            const includeRouteBullet = routeWorkspaceId === activeId && !!routeBulletId
            const nextPath = includeRouteBullet ? `/${activeId}/${routeBulletId}` : `/${activeId}`
            navigate(nextPath, { replace: true })
          }
        }
        return
      }

      if (!routeWorkspaceId) {
        const fallbackId = store.currentWorkspace || store.workspaces[0]?.id || null
        if (fallbackId) {
          const nextPath = `/${fallbackId}`
          navigate(nextPath, { replace: true })
        }
        return
      }

      if (routeWorkspaceId !== store.currentWorkspace) {
        const exists = store.workspaces.some(workspace => workspace.id === routeWorkspaceId)
        if (exists) {
          await store.selectWorkspace(routeWorkspaceId)
        } else if (store.workspaces.length > 0) {
          const fallbackId = store.workspaces[0].id
          const nextPath = `/${fallbackId}`
          navigate(nextPath, { replace: true })
        }
      }
    }

    void syncWorkspace()

    return () => {
      cancelled = true
    }
  }, [store, store.isBootstrapped, store.workspaces, store.currentWorkspace, routeWorkspaceId, routeBulletId, navigate])

  useEffect(() => {
    if (!store.isBootstrapped) {
      return
    }

    if (!routeWorkspaceId || routeWorkspaceId !== store.currentWorkspace) {
      return
    }

    const normalizedBulletId = routeBulletId ?? null
    if (normalizedBulletId === lastSyncedIdRef.current) {
      return
    }

    store.setZoomedBulletId(normalizedBulletId)
    lastSyncedIdRef.current = normalizedBulletId
  }, [store, store.isBootstrapped, store.currentWorkspace, routeWorkspaceId, routeBulletId])

  useEffect(() => {
    if (!store.isBootstrapped) {
      return
    }

    const currentWorkspace = store.currentWorkspace
    if (!currentWorkspace || currentWorkspace !== routeWorkspaceId) {
      return
    }

    const currentZoomId = store.zoomedBulletId ?? null
    if (currentZoomId === routeBulletId) {
      lastSyncedIdRef.current = currentZoomId
      return
    }

    lastSyncedIdRef.current = currentZoomId
    const nextPath = currentZoomId ? `/${currentWorkspace}/${currentZoomId}` : `/${currentWorkspace}`
    navigate(nextPath, { replace: true })
  }, [store.isBootstrapped, store.currentWorkspace, store.zoomedBulletId, routeWorkspaceId, routeBulletId, navigate])

  const isStoreReady = store.isBootstrapped && store.currentWorkspace === routeWorkspaceId && store.historyIndex >= 0
  const bulletExists =
    isStoreReady && routeBulletId ? store.findBulletById(routeBulletId) : null
  const showNotFound = isStoreReady && routeBulletId !== null && !bulletExists

  const handleReturnHome = () => {
    store.zoomToBullet(null)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="flex w-full items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0 text-foreground">
            <h1 className="text-xl font-semibold shrink-0">Focus</h1>
          </div>
          <div className="flex-1 min-w-0">
            <SearchBar />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <WorkspaceSwitcher />
            <DataControls onToggleShortcuts={() => setShowShortcuts(prev => !prev)} />
          </div>
        </div>
      </header>

      {/* Breadcrumbs */}
      {!showNotFound && <Breadcrumbs />}

      {/* Main Content */}
      <main className="px-6 py-8 flex-1">
        {showNotFound ? (
          <div className="flex flex-col items-center justify-center text-center gap-4 py-24">
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-2">Bullet not found</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                We couldn't find a bullet with id <span className="font-mono text-foreground">{routeBulletId}</span>.
              </p>
            </div>
            <Button onClick={handleReturnHome}>Go to root</Button>
          </div>
        ) : (
          <BulletList />
        )}
      </main>

      <footer className="border-t border-border bg-card/30 backdrop-blur-sm mt-auto">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <span>
            Made by{' '}
            <a
              href="https://github.com/alinz"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:underline font-medium">
              Ali Najafizadeh
            </a>
          </span>
          <span className="text-border">•</span>
          <span>
            <a
              href="https://github.com/ella-to/focus"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:underline font-medium">
              Source available
            </a>
          </span>
        </div>
      </footer>

      {/* Keyboard Shortcuts Help */}
      {showShortcuts && (
        <div className="fixed bottom-14 right-4 bg-card border border-border rounded-lg p-4 text-xs text-muted-foreground max-w-xs shadow-lg">
          <div className="font-semibold text-foreground mb-2">Keyboard Shortcuts</div>
          <div className="space-y-1">
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">X</kbd> Toggle shortcuts
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Cmd+F</kbd> Search
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> New bullet
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Shift+Enter</kbd> Add notes
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Esc</kbd> Exit notes
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Tab</kbd> Indent
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Shift+Tab</kbd> Outdent
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Backspace</kbd> Delete empty
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Cmd+Enter</kbd> Zoom in
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Cmd+Shift+↑</kbd> Zoom out
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Cmd+↑</kbd> Move up
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Cmd+↓</kbd> Move down
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Cmd+Z</kbd> Undo
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Cmd+Shift+Z</kbd> Redo
            </div>
            <div>
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd> Navigate
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

HomeContent.displayName = 'HomeContent'
