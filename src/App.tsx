import { Route, Routes } from 'react-router-dom'

import { Home } from './Home'
import { Layout } from './routes/Layout'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route path=":bulletId?" element={<Home />} />
      </Route>
    </Routes>
  )
}

export default App
