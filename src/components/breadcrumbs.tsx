import { useStore } from '@/lib/store-context'
import { ChevronRight, Home } from 'lucide-react'
import { observer } from 'mobx-react-lite'
import { useNavigate } from 'react-router-dom'

export const Breadcrumbs = observer(() => {
  const store = useStore()
  const navigate = useNavigate()

  if (!store.zoomedBulletId) return null

  const breadcrumbs = store.getBreadcrumbs(store.zoomedBulletId)

  const handleBreadcrumbClick = (bulletId: string | null) => {
    store.zoomToBullet(bulletId)
    if (bulletId) {
      navigate(`/${bulletId}`)
    } else {
      navigate('/')
    }
  }

  return (
    <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <button
        onClick={() => handleBreadcrumbClick(null)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Go to home">
        <Home className="w-4 h-4" />
      </button>

      {breadcrumbs.slice(0, -1).map(bullet => (
        <div key={bullet.id} className="flex items-center gap-2">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <button
            onClick={() => handleBreadcrumbClick(bullet.id)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]">
            {bullet.content || 'Untitled'}
          </button>
        </div>
      ))}

      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-2">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground truncate max-w-[200px]">
            {breadcrumbs[breadcrumbs.length - 1].content || 'Untitled'}
          </span>
        </div>
      )}
    </div>
  )
})

Breadcrumbs.displayName = 'Breadcrumbs'
