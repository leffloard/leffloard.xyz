import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2, Lock } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { isNotConfigured, login } from './adminApi';
import { apiErrorMessage } from '../../lib/requests';

const AdminLogin = ({ notice, onLogin, onNotConfigured }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!password) {
      setError('Please enter the admin password.');
      inputRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const data = await login(password);
      onLogin(data);
    } catch (err) {
      if (isNotConfigured(err)) {
        onNotConfigured();
        return;
      }
      const status = err.response?.status;
      setError(
        status === 401
          ? 'Incorrect password.'
          : status === 429
            ? apiErrorMessage(err, 'Too many attempts. Please try again later.')
            : apiErrorMessage(err, 'Sign in failed. Please try again.')
      );
      setPassword('');
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-gray-800 bg-[#0f0f10] p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-lg bg-cyan-400/10 p-3">
              <Lock className="text-cyan-400" size={22} aria-hidden="true" />
            </div>
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-cyan-400">Admin</span>
              <h1 className="text-xl font-bold text-white">Sign in</h1>
            </div>
          </div>

          {notice && (
            <p className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
              {notice}
            </p>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <Label htmlFor="admin-password" className="mb-2 block text-sm font-medium text-gray-400">
                Password
              </Label>
              <Input
                ref={inputRef}
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'admin-password-error' : undefined}
                className="h-11 border-gray-800 bg-[#0a0a0a] text-white focus-visible:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-400/30 aria-[invalid=true]:border-red-500/70"
              />
              {error && (
                <p id="admin-password-error" role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-red-400">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  {error}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 font-semibold text-black transition-colors hover:bg-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f10] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-cyan-400"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Back to site
        </Link>
      </div>
    </main>
  );
};

export default AdminLogin;
