import { NavLink, Outlet } from "react-router-dom";
import { useAdminSecret } from "../lib/adminSecret";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
  }`;

export default function Layout() {
  const { secret } = useAdminSecret();

  return (
    <div className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto max-w-6xl px-4 py-3 flex flex-wrap items-center gap-2">
          <NavLink to="/" className="mr-4 text-lg font-bold">
            PGP Times
          </NavLink>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/heats" className={navLinkClass}>Heats</NavLink>
            <NavLink to="/drivers" className={navLinkClass}>Drivers</NavLink>
            <NavLink to="/leaderboard" className={navLinkClass}>Leaderboard</NavLink>
            <NavLink to="/watchlist" className={navLinkClass}>Watchlist</NavLink>
            <NavLink to="/endurance" className={navLinkClass}>Endurance</NavLink>
            {secret && <NavLink to="/telemetry" className={navLinkClass}>Telemetry</NavLink>}
            <NavLink to="/admin/scrape-health" className={navLinkClass}>Admin</NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
