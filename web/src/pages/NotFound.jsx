import { Link } from 'react-router-dom';
import { useTitle } from '../lib/hooks.js';

export default function NotFound() {
  useTitle('Not found');
  return (
    <main id="main" className="page">
      <h1 className="page-title">Page not found</h1>
      <p className="page-lead">That address does not exist. <Link to="/">Go to the start</Link>.</p>
    </main>
  );
}
