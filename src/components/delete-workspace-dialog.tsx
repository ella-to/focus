import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useRef, useState, useEffect } from 'react'

interface DeleteWorkspaceDialogProps {
  open: boolean
  workspaceName: string
  onOpenChange: (open: boolean) => void
  onDelete: () => Promise<void>
}

export function DeleteWorkspaceDialog({
  open,
  workspaceName,
  onOpenChange,
  onDelete,
}: DeleteWorkspaceDialogProps) {
  const [confirmationName, setConfirmationName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset dialog state when it opens
  useEffect(() => {
    if (open) {
      setConfirmationName('')
      setError(null)
      setLoading(false)

      // Delay focus by 200ms to allow mobile to adjust screen properly
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 200)

      return () => clearTimeout(timer)
    }
  }, [open])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!confirmationName) {
      setError('Please enter the workspace name to confirm.')
      return
    }

    if (confirmationName.trim() !== workspaceName.trim()) {
      setError('Workspace name does not match.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await onDelete()
      setConfirmationName('')
      onOpenChange(false)
    } catch (err) {
      setError('Failed to delete workspace. Please try again.')
      setLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Clear state when closing
      setConfirmationName('')
      setError(null)
      setLoading(false)
    }
    onOpenChange(newOpen)
  }

  const isDeleteEnabled = confirmationName.trim() === workspaceName.trim()

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Delete Workspace</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the workspace{' '}
              <span className="font-semibold text-foreground">"{workspaceName}"</span> and all of its bullets.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-semibold text-foreground">{workspaceName}</span> to confirm deletion:
            </p>
            <Input
              ref={inputRef}
              type="text"
              value={confirmationName}
              onChange={event => {
                setConfirmationName(event.target.value)
                setError(null)
              }}
              placeholder={workspaceName}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={loading}
              data-testid="delete-workspace-confirmation-input"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={loading || !isDeleteEnabled}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Deleting
                </>
              ) : (
                'Delete Workspace'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
