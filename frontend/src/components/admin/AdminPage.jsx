import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RotateCcw, ShieldAlert } from 'lucide-react';
import AdminLogin from './AdminLogin';
import AdminDashboard from './AdminDashboard';
import {
  NOT_CONFIGURED_MESSAGE,
  clearSession,
  createAdminClient,
  loadSession,
  probeConfigured,
  saveSession,
} from './adminApi';

function useAdminDocument() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Admin | Mert Kaan Koparan';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);
    return () => {
      document.title = previousTitle;
      robots.remove();
    };
  }, []);
}

function NotConfigured({ onRetry }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-[#0f0f10] p-6 text-center sm:p-8">
        <div className="mx-auto mb-4 w-fit rounded-lg bg-amber-400/10 p-3">
          <ShieldAlert className="text-amber-300" size={24} aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-white" role="alert">
          {NOT_CONFIGURED_MESSAGE}
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          Set ADMIN_PASSWORD_HASH and ADMIN_JWT_SECRET in the backend environment and restart the server.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-cyan-400 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-500 transition-colors hover:text-cyan-400"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back to site
          </Link>
        </div>
      </div>
    </main>
  );
}

const AdminPage = () => {
  const [session, setSession] = useState(loadSession);
  const [notice, setNotice] = useState('');
  const [configured, setConfigured] = useState(true);

  useAdminDocument();

  const endSession = useCallback((message) => {
    clearSession();
    setSession(null);
    setNotice(message);
  }, []);

  const handleUnauthorized = useCallback(
    () => endSession('Your session has expired. Please sign in again.'),
    [endSession]
  );
  const handleNotConfigured = useCallback(() => setConfigured(false), []);

  useEffect(() => {
    if (session || !configured) return undefined;
    let active = true;
    probeConfigured().then((ok) => {
      if (active && !ok) setConfigured(false);
    });
    return () => {
      active = false;
    };
  }, [session, configured]);

  useEffect(() => {
    if (!session?.expires_at) return undefined;
    const remaining = Date.parse(session.expires_at) - Date.now();
    if (Number.isNaN(remaining)) return undefined;
    const timer = setTimeout(handleUnauthorized, Math.min(Math.max(remaining, 0), 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [session, handleUnauthorized]);

  const api = useMemo(
    () =>
      session
        ? createAdminClient(session.token, {
            onUnauthorized: handleUnauthorized,
            onNotConfigured: handleNotConfigured,
          })
        : null,
    [session, handleUnauthorized, handleNotConfigured]
  );

  const handleLogin = (data) => {
    if (!data?.token) {
      setNotice('The server returned an unexpected response. Please try again.');
      return;
    }
    const next = { token: data.token, expires_at: data.expires_at || null };
    saveSession(next);
    setNotice('');
    setSession(next);
  };

  if (!configured) {
    return <NotConfigured onRetry={() => setConfigured(true)} />;
  }

  if (!api) {
    return <AdminLogin notice={notice} onLogin={handleLogin} onNotConfigured={handleNotConfigured} />;
  }

  return <AdminDashboard api={api} onLogout={() => endSession('You have been signed out.')} />;
};

export default AdminPage;
