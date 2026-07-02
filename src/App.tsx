import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import HeatBrowserPage from './pages/HeatBrowserPage'
import HeatDetailPage from './pages/HeatDetailPage'
import LeaderboardPage from './pages/LeaderboardPage'
import DriverSearchPage from './pages/DriverSearchPage'
import DriverProfilePage from './pages/DriverProfilePage'
import DriverAnalyticsPage from './pages/DriverAnalyticsPage'
import WatchlistPage from './pages/WatchlistPage'
import EndurancePage from './pages/EndurancePage'
import AdminScrapeHealthPage from './pages/admin/AdminScrapeHealthPage'
import AdminDriversPage from './pages/admin/AdminDriversPage'
import NotFoundPage from './pages/NotFoundPage'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/heats" element={<HeatBrowserPage />} />
        <Route path="/heats/:heatNo" element={<HeatDetailPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/drivers" element={<DriverSearchPage />} />
        <Route path="/drivers/:driverId" element={<DriverProfilePage />} />
        <Route path="/drivers/:driverId/analytics" element={<DriverAnalyticsPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/endurance" element={<EndurancePage />} />
        <Route path="/admin/scrape-health" element={<AdminScrapeHealthPage />} />
        <Route path="/admin/drivers" element={<AdminDriversPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
