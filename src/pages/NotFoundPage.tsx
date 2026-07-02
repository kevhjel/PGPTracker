import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link to="/" className="text-blue-600 hover:underline dark:text-blue-400">
        Back home
      </Link>
    </div>
  );
}
