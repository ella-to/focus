import { Button } from '@/components/ui/button'
import { Lock } from 'lucide-react'

interface LockedWorkspaceViewProps {
  workspaceName: string
  onUnlockClick: () => void
}

export function LockedWorkspaceView({ workspaceName, onUnlockClick }: LockedWorkspaceViewProps) {
  return (
    <div className="flex flex-col items-center justify-start">
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <div className="p-4 bg-muted rounded-full">
          <Lock className="size-8 text-foreground" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-foreground">Workspace is locked</h2>
          <p className="text-muted-foreground">
            The workspace <span className="font-semibold text-foreground">"{workspaceName}"</span> is protected with a
            password. Enter your password to view & edit the bullets.
          </p>
        </div>

        <Button onClick={onUnlockClick} size="lg" className="mt-4">
          Unlock Workspace
        </Button>
      </div>
    </div>
  )
}
