import { Breadcrumbs } from '@/components/breadcrumbs'
import { BulletList } from '@/components/bullet-list'
import { DataControls } from '@/components/data-controls'
import { SearchBar } from '@/components/search-bar'
import { StoreProvider } from '@/lib/store-context'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'

export function BulletPage() {
  const { bulletId } = useParams<{ bulletId: string }>()
  const [showShortcuts, setShowShortcuts] = useState(true)

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

  return (
    <StoreProvider initialZoomedBulletId={bulletId || null}>
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-20">
          <div className="flex items-center justify-between gap-4 px-6 py-3">
            <h1 className="text-xl font-semibold text-foreground shrink-0">Focus</h1>
            <SearchBar />
            <div className="flex items-center gap-2 shrink-0">
              <DataControls onToggleShortcuts={() => setShowShortcuts(prev => !prev)} />
            </div>
          </div>
        </header>

        {/* Breadcrumbs */}
        <Breadcrumbs />

        {/* Main Content */}
        <main className="px-6 py-8 flex-1">
          <BulletList />
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
          <div className="fixed bottom-4 right-4 bg-card border border-border rounded-lg p-4 text-xs text-muted-foreground max-w-xs shadow-lg">
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
    </StoreProvider>
  )
}
