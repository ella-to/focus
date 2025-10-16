import { Outlet } from 'react-router-dom'
import { Suspense } from 'react'

export function Layout() {
  return (
    <Suspense fallback={null}>
      <Outlet />
    </Suspense>
  )
}
