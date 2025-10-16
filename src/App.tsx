import { Route, Routes } from 'react-router-dom'

import { BulletPage } from './routes/BulletPage'
import { Home } from './routes/Home'
import { Layout } from './routes/Layout'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/:bulletId" element={<BulletPage />} />
      </Route>
    </Routes>
  )
}

export default App
