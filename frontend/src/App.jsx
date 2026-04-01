import { HashRouter, NavLink, Navigate, Route, Routes } from "react-router-dom"

import Dashboard from "./pages/Dashboard"
import AddProduct from "./pages/AddProduct"
import ProductList from "./pages/ProductList"
import ProductDetail from "./pages/ProductDetail"
import History from "./pages/History"
import Alerts from "./pages/Alerts"
import "./App.css"
function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <p className="eyebrow">Price monitoring & alerting</p>
            <h1>PricePulse</h1>
            <p className="tagline">Track the products you care about and get notified the moment the price drops below your target.</p>
          </div>

          <nav className="tabs" aria-label="Main navigation">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "tab tab-active" : "tab")}>
              Dashboard
            </NavLink>
            <NavLink to="/products" className={({ isActive }) => (isActive ? "tab tab-active" : "tab")}>
              Products
            </NavLink>
            <NavLink to="/history" className={({ isActive }) => (isActive ? "tab tab-active" : "tab")}>
              History
            </NavLink>
            <NavLink to="/alerts" className={({ isActive }) => (isActive ? "tab tab-active" : "tab")}>
              Alerts
            </NavLink>
            <NavLink to="/detail" className={({ isActive }) => (isActive ? "tab tab-active" : "tab")}>
              Product Detail
            </NavLink>
            <NavLink to="/add" className={({ isActive }) => (isActive ? "tab tab-active" : "tab")}>
              Add Product
            </NavLink>
          </nav>
        </header>

        <main className="page">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/add" element={<AddProduct />} />
            <Route path="/products" element={<ProductList />} />
            <Route path="/history" element={<History />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/detail" element={<ProductDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}

export default App
