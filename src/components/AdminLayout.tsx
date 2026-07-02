import { NavLink, Outlet } from "react-router-dom";

const subNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
  }`;

export default function AdminLayout() {
  return (
    <div className="space-y-6">
      <nav className="flex gap-1 border-b border-neutral-200 pb-3 dark:border-neutral-800">
        <NavLink to="/admin/scrape-health" className={subNavLinkClass}>
          Scrape Health
        </NavLink>
        <NavLink to="/admin/drivers" className={subNavLinkClass}>
          Drivers
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
