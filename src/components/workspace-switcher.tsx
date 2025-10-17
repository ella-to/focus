'use client'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { WORKSPACE_EXISTS_ERROR } from '@/lib/event-store'
import { useStore } from '@/lib/store-context'
import { cn } from '@/lib/utils'
import { Check, ChevronsUpDown, Layers, Loader2, Pencil, Plus } from 'lucide-react'
import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState } from 'react'

type DialogMode = 'create' | 'rename'

type DialogState = {
  mode: DialogMode | null
  error: string | null
  loading: boolean
  value: string
}

const INITIAL_DIALOG_STATE: DialogState = {
  mode: null,
  error: null,
  loading: false,
  value: '',
}

export const WorkspaceSwitcher = observer(() => {
  const store = useStore()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [dialogState, setDialogState] = useState<DialogState>(INITIAL_DIALOG_STATE)
  const inputRef = useRef<HTMLInputElement>(null)
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }
    return window.matchMedia('(max-width: 640px)').matches
  })

  const currentWorkspace = store.currentWorkspace ?? ''
  const workspaces = store.workspaces
  const isDialogOpen = dialogState.mode !== null

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia('(max-width: 640px)')
    const updateIsMobile = () => setIsMobile(mediaQuery.matches)

    updateIsMobile()
    mediaQuery.addEventListener('change', updateIsMobile)

    return () => mediaQuery.removeEventListener('change', updateIsMobile)
  }, [])

  useEffect(() => {
    if (!isDialogOpen) {
      return
    }

    const timeout = window.setTimeout(() => {
      inputRef.current?.focus()
      if (dialogState.mode === 'create') {
        inputRef.current?.select()
      }
    }, 50)

    return () => window.clearTimeout(timeout)
  }, [dialogState.mode, isDialogOpen])

  const closeDialog = () => {
    setDialogState(INITIAL_DIALOG_STATE)
  }

  const handleOpenDialog = (mode: DialogMode) => {
    setPopoverOpen(false)
    setMobileMenuOpen(false)
    setDialogState({ mode, error: null, loading: false, value: mode === 'rename' ? currentWorkspace : '' })
  }

  const handleSelectWorkspace = (workspaceName: string) => {
    setPopoverOpen(false)
    setMobileMenuOpen(false)
    if (!workspaceName || workspaceName === currentWorkspace) {
      return
    }
    void store.selectWorkspace(workspaceName)
  }

  const handleDialogSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dialogState.mode) {
      return
    }

    const trimmed = dialogState.value.trim()
    if (!trimmed) {
      setDialogState(prev => ({ ...prev, error: 'Please enter a workspace name.' }))
      return
    }

    setDialogState(prev => ({ ...prev, loading: true, error: null }))

    try {
      if (dialogState.mode === 'create') {
        await store.createWorkspace(trimmed)
      } else {
        await store.renameCurrentWorkspace(trimmed)
      }
      closeDialog()
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code
      const message =
        code === WORKSPACE_EXISTS_ERROR
          ? 'A workspace with this name already exists.'
          : 'Something went wrong. Please try again.'
      setDialogState(prev => ({ ...prev, loading: false, error: message }))
    }
  }

  const isLoading = !store.isBootstrapped && workspaces.length === 0
  const currentLabel = isLoading ? 'Loading workspaces...' : currentWorkspace || 'Select workspace'
  const commandList = (
    <Command className="h-full">
      <CommandInput placeholder="Search workspaces" autoFocus={!isMobile} />
      <CommandList>
        <CommandEmpty>No workspace found.</CommandEmpty>
        <CommandGroup heading="Workspaces">
          {workspaces.map(workspace => {
            const name = workspace.name
            const isActive = name === currentWorkspace
            return (
              <CommandItem key={name} value={name} onSelect={handleSelectWorkspace}>
                <Check className={cn('mr-2 size-4', isActive ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{name}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="create-workspace" onSelect={() => handleOpenDialog('create')} className="gap-2">
            <Plus className="size-4" />
            Create workspace
          </CommandItem>
          <CommandItem
            value="rename-workspace"
            onSelect={() => handleOpenDialog('rename')}
            className="gap-2"
            disabled={!currentWorkspace}>
            <Pencil className="size-4" />
            Rename current workspace
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )

  return (
    <>
      {isMobile ? (
        <>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label="Open workspace menu"
            disabled={isLoading}
            onClick={() => setMobileMenuOpen(true)}>
            <Layers className="size-4" />
          </Button>
          <Dialog open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <DialogContent className="max-w-none h-[calc(100vh-3rem)] gap-0 overflow-hidden p-0 sm:max-w-[420px] sm:h-auto sm:rounded-lg sm:p-6">
              <div className="flex h-full flex-col">
                <div className="border-b border-border px-4 py-3 sm:px-0 sm:py-0">
                  <DialogTitle className="text-left text-lg font-semibold sm:text-xl">Workspaces</DialogTitle>
                  <DialogDescription className="text-left text-sm text-muted-foreground sm:hidden">
                    Switch, create, or rename workspaces.
                  </DialogDescription>
                </div>
                <div className="flex-1 overflow-y-auto">{commandList}</div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 min-w-[160px] justify-between gap-2 truncate px-3 font-medium"
              aria-label="Select workspace"
              disabled={isLoading}>
              <span className="truncate text-left">{currentLabel}</span>
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="end">
            {commandList}
          </PopoverContent>
        </Popover>
      )}

      <Dialog open={isDialogOpen} onOpenChange={open => (!open ? closeDialog() : undefined)}>
        <DialogContent className="sm:max-w-[420px]">
          <form onSubmit={handleDialogSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{dialogState.mode === 'create' ? 'Create workspace' : 'Rename workspace'}</DialogTitle>
              <DialogDescription>
                {dialogState.mode === 'create'
                  ? 'Workspaces keep bullets grouped together. Give it a descriptive name.'
                  : 'Update the workspace name. All bullets will stay linked to the new name.'}
              </DialogDescription>
            </DialogHeader>
            <Input
              ref={inputRef}
              value={dialogState.value}
              onChange={event => setDialogState(prev => ({ ...prev, value: event.target.value, error: null }))}
              placeholder="Workspace name"
              autoCapitalize="sentences"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              data-testid="workspace-name-input"
            />
            {dialogState.error && <p className="text-sm text-destructive">{dialogState.error}</p>}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={dialogState.loading}>
                {dialogState.loading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Saving
                  </>
                ) : dialogState.mode === 'create' ? (
                  'Create'
                ) : (
                  'Rename'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
})

WorkspaceSwitcher.displayName = 'WorkspaceSwitcher'
