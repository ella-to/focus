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
import { useRef, useState } from 'react'

interface UnlockWorkspaceDialogProps {
  open: boolean
  workspaceName: string
  onOpenChange: (open: boolean) => void
  onUnlock: (password: string) => Promise<void>
}

export function UnlockWorkspaceDialog({
  open,
  workspaceName,
  onOpenChange,
  onUnlock,
}: UnlockWorkspaceDialogProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    
    if (!password) {
      setError('Enter a password to continue.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await onUnlock(password)
      setPassword('')
      onOpenChange(false)
    } catch (err) {
      const code = (err as { code?: string } | undefined)?.code
      let message = 'Unable to unlock workspace. Please try again.'
      if (code === 'WORKSPACE_UNLOCK_FAILED') {
        message = 'The password was incorrect. Try again.'
      } else if (code === 'EVENT_STORE_UNAVAILABLE') {
        message = 'Workspace decryption requires access to local storage.'
      }
      setError(message)
      setLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setPassword('')
      setError(null)
      setLoading(false)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Unlock Workspace</DialogTitle>
            <DialogDescription>
              Enter the password to unlock <span className="font-semibold text-foreground">"{workspaceName}"</span> and
              decrypt its bullets.
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={inputRef}
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder="Enter password"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={loading}
            data-testid="unlock-password-input"
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Checking
                </>
              ) : (
                'Unlock Workspace'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
