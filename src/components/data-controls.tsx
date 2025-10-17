'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useStore } from '@/lib/store-context'
import { Download, Keyboard, Moon, MoreVertical, RotateCcw, Sun, Upload } from 'lucide-react'
import { observer } from 'mobx-react-lite'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'

export const DataControls = observer(({ onToggleShortcuts }: { onToggleShortcuts: () => void }) => {
  const store = useStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light')
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')
  }, [])

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
  }

  const handleExport = () => {
    const data = store.exportData()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `focus-export-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = event => {
      const content = event.target?.result as string
      const success = store.importData(content)
      if (success) {
        alert('Data imported successfully!')
      } else {
        alert('Failed to import data. Please check the file format.')
      }
    }
    reader.readAsText(file)

    // Reset input so the same file can be selected again
    e.target.value = ''
  }

  const handleDeleteCurrentWorkspace = async () => {
    try {
      await store.deleteCurrentWorkspace()
      setResetDialogOpen(false)
    } catch (error) {
      console.error(error)
      alert('Failed to delete the current workspace. Please try again.')
    }
  }

  const handleDeleteAllWorkspaces = async () => {
    try {
      await store.deleteAllWorkspaces()
      setResetDialogOpen(false)
    } catch (error) {
      console.error(error)
      alert('Failed to delete all workspaces. Please try again.')
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="h-9 w-9">
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">Menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export Data
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleImport}>
            <Upload className="mr-2 h-4 w-4" />
            Import Data
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={toggleTheme}>
            {theme === 'light' ? (
              <>
                <Moon className="mr-2 h-4 w-4" />
                Dark Mode
              </>
            ) : (
              <>
                <Sun className="mr-2 h-4 w-4" />
                Light Mode
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleShortcuts}>
            <Keyboard className="mr-2 h-4 w-4" />
            Toggle Shortcuts
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setResetDialogOpen(true)} className="text-destructive">
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset to Default
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="sm:max-w-[520px] space-y-4">
          <DialogHeader>
            <DialogTitle>Reset Workspaces</DialogTitle>
            <DialogDescription>
              Choose what to delete. Workspaces isolate bullets so you can keep personal and work notes separate.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Current workspace: <span className="font-medium text-foreground">{store.currentWorkspace}</span>
          </div>
          <DialogFooter className="!flex-col gap-3 sm:!flex-row sm:items-center sm:!justify-between">
            <Button variant="outline" onClick={() => setResetDialogOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:gap-3">
              <Button variant="secondary" onClick={handleDeleteCurrentWorkspace} className="w-full sm:w-auto">
                Delete Current Workspace
              </Button>
              <Button variant="destructive" onClick={handleDeleteAllWorkspaces} className="w-full sm:w-auto">
                Delete All Workspaces
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileChange} className="hidden" />
    </>
  )
})
