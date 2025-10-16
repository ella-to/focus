"use client"

import { observer } from "mobx-react-lite"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useStore } from "@/lib/store-context"
import { useRef, useEffect } from "react"

export const SearchBar = observer(() => {
  const store = useStore()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Cmd/Ctrl + F to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault()
        inputRef.current?.focus()
      }
      // Escape to clear search when focused
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        store.setSearchQuery("")
        inputRef.current?.blur()
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [store])

  const handleClearSearch = () => {
    store.setSearchQuery("")
    // Maintain focus on the input after clearing
    setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
  }

  return (
    <div className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        type="text"
        placeholder="Search bullets... (Cmd+F)"
        value={store.searchQuery}
        onChange={(e) => store.setSearchQuery(e.target.value)}
        className="pl-9 pr-9 h-9 bg-background/50 border-border/50 focus-visible:ring-1"
      />
      {store.searchQuery && (
        <button
          onClick={handleClearSearch}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Clear search"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
})

SearchBar.displayName = "SearchBar"
