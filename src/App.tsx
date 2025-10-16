import { Routes, Route } from "react-router-dom";
import { Layout } from "./routes/Layout";
import { Home } from "./routes/Home";
import { BulletPage } from "./routes/BulletPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/:bulletId" element={<BulletPage />} />
      </Route>
    </Routes>
  );
}

export default App;
