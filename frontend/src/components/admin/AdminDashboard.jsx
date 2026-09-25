import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderGit2,
  Inbox,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  ServerCrash,
  X,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { ChannelBadge, StatusBadge, TypeBadge } from './badges';
import RequestDetailSheet from './RequestDetailSheet';
import { STATUSES, STATUS_LABELS, apiErrorMessage } from '../../lib/requests';
import { formatCalendarDate, formatDateTime, formatRelative } from '../../lib/datetime';
import { isHandledStatus } from './adminApi';

const PAGE_SIZE = 20;

const STATUS_TABS = [...STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })), { value: 'all', label: 'All' }];

const TYPE_FILTERS = [
  { value: 'all', label: 'All types' },
  { value: 'appointment', label: 'Appointments' },
  { value: 'revision', label: 'Revisions' },
  { value: 'inquiry', label: 'Inquiries' },
];

const EMPTY_COUNTS = { new: 0, confirmed: 0, declined: 0, completed: 0 };

// aria-disabled rather than disabled keeps keyboard focus on the button while a request is running.
const pageButtonClass =
  'rounded-lg border border-gray-700 p-2 text-white transition-colors hover:border-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-gray-700';

function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function RequestRow({ item, onOpen }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="grid w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-white/[0.03] focus:outline-none focus-visible:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-5"
      >
        <div className="flex items-center gap-2 sm:block">
          <TypeBadge type={item.type} />
          <span className="sm:hidden">
            <StatusBadge status={item.status} />
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium text-white">
            {item.name}
            <span className="font-normal text-gray-500"> · {item.email}</span>
          </p>
          <p className="truncate text-sm text-gray-400">{item.subject}</p>
          {item.type === 'appointment' && item.preferred_date && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-cyan-300/90">
              <CalendarClock size={12} aria-hidden="true" />
              {formatCalendarDate(item.preferred_date)} · {item.preferred_time}
              <span className="text-gray-500">
                ({item.timezone}
                {item.duration_minutes ? `, ${item.duration_minutes} min` : ''})
              </span>
            </p>
          )}
          {item.type === 'revision' && item.project_reference && (
            <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-fuchsia-300/80">
              <FolderGit2 size={12} aria-hidden="true" />
              {item.project_reference}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
          <span className="hidden sm:inline-flex">
            <StatusBadge status={item.status} />
          </span>
          <time dateTime={item.created_at} title={formatDateTime(item.created_at)} className="text-xs text-gray-500">
            {formatRelative(item.created_at)}
          </time>
        </div>
      </button>
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-gray-800" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="flex items-center gap-4 px-5 py-5">
          <Skeleton className="h-5 w-24 bg-gray-800" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5 bg-gray-800" />
            <Skeleton className="h-3 w-3/5 bg-gray-800/70" />
          </div>
          <Skeleton className="hidden h-5 w-20 bg-gray-800 sm:block" />
        </li>
      ))}
    </ul>
  );
}

const AdminDashboard = ({ api, onLogout }) => {
  const [status, setStatus] = useState('new');
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim(), 350);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [notifications, setNotifications] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailKey, setDetailKey] = useState(0);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    setPage(1);
  }, [status, type, query]);

  useEffect(() => {
    let active = true;
    api
      .get('/me')
      .then(({ data: me }) => {
        if (active) setNotifications(me?.notifications || null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    const params = { page, limit: PAGE_SIZE };
    if (status !== 'all') params.status = status;
    if (type !== 'all') params.type = type;
    if (query) params.q = query;
    setLoading(true);
    api
      .get('/requests', { params, signal: controller.signal })
      .then(({ data: result }) => {
        const items = Array.isArray(result?.items) ? result.items : [];
        const total = Number(result?.total) || 0;
        if (!items.length && total > 0 && page > 1) {
          setPage(Math.max(1, Math.ceil(total / PAGE_SIZE)));
          return;
        }
        setData({ items, total, counts: { ...EMPTY_COUNTS, ...result?.counts } });
        setError('');
      })
      .catch((err) => {
        if (axios.isCancel(err) || isHandledStatus(err)) return;
        setError(apiErrorMessage(err, 'Could not load requests.'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, status, type, query, page, reloadKey]);

  const counts = data?.counts || EMPTY_COUNTS;
  const allCount = STATUSES.reduce((sum, key) => sum + (Number(counts[key]) || 0), 0);
  const total = data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openRequest = (item) => {
    setSelected(item);
    setDetailKey((key) => key + 1);
    setDetailOpen(true);
  };

  const handleDeleted = useCallback(() => {
    setDetailOpen(false);
    reload();
  }, [reload]);

  const clearFilters = () => {
    setStatus('all');
    setType('all');
    setSearch('');
  };

  const list = (() => {
    if (error && !data) {
      return (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <ServerCrash className="mb-3 text-red-400" size={28} aria-hidden="true" />
          <p className="text-white">{error}</p>
          <button
            type="button"
            onClick={reload}
            className="mt-4 rounded-lg border border-gray-700 px-4 py-2 text-sm text-white transition-colors hover:border-cyan-400 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            Retry
          </button>
        </div>
      );
    }
    if (!data) return <ListSkeleton />;
    if (!data.items.length) {
      const nothingYet = allCount === 0 && type === 'all' && !query;
      const statusOnly = type === 'all' && !query && status !== 'all';
      return (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <Inbox className="mb-3 text-gray-600" size={32} aria-hidden="true" />
          <p className="font-medium text-white">
            {nothingYet
              ? 'No requests yet.'
              : statusOnly
                ? `No ${STATUS_LABELS[status].toLowerCase()} requests.`
                : 'No requests match these filters.'}
          </p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            {nothingYet
              ? 'Appointment, revision and inquiry requests from the contact form will show up here.'
              : statusOnly
                ? 'Requests with other statuses are in the other tabs.'
                : 'Try another status, type or search term.'}
          </p>
          {!nothingYet && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 rounded-lg border border-gray-700 px-4 py-2 text-sm text-white transition-colors hover:border-cyan-400 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
            >
              Show all requests
            </button>
          )}
        </div>
      );
    }
    return (
      <ul className="divide-y divide-gray-800">
        {data.items.map((item) => (
          <RequestRow key={item.id} item={item} onOpen={openRequest} />
        ))}
      </ul>
    );
  })();

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 bg-[#0a0a0a]/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-cyan-400">&lt;LeffLoard&gt; Admin</span>
            <h1 className="text-2xl font-bold text-white">Requests</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {notifications && (
              <>
                <ChannelBadge label="Discord" enabled={Boolean(notifications.discord)} />
                <ChannelBadge label="Email" enabled={Boolean(notifications.email)} />
              </>
            )}
            <Link
              to="/"
              className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-gray-400 transition-colors hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
            >
              <ExternalLink size={14} aria-hidden="true" />
              View site
            </Link>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-700 px-3 text-sm text-white transition-colors hover:border-cyan-400 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
            >
              <LogOut size={14} aria-hidden="true" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Tabs value={status} onValueChange={setStatus}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <TabsList className="h-10 border border-gray-800 bg-[#0f0f10]" aria-label="Filter by status">
                {STATUS_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="gap-1.5 px-3 text-gray-400 data-[state=active]:bg-gray-800 data-[state=active]:text-white"
                  >
                    {tab.label}
                    {data && (
                      <span className="rounded bg-black/40 px-1.5 font-mono text-xs text-gray-400">
                        {tab.value === 'all' ? allCount : Number(counts[tab.value]) || 0}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger
                  aria-label="Filter by type"
                  className="h-10 border-gray-800 bg-[#0f0f10] text-white focus:ring-2 focus:ring-cyan-400/40 sm:w-44"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-gray-800 bg-[#0f0f10] text-white">
                  {TYPE_FILTERS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative sm:w-72">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, email, subject..."
                  aria-label="Search requests"
                  className="h-10 border-gray-800 bg-[#0f0f10] pl-9 pr-9 text-white placeholder:text-gray-500 focus-visible:ring-2 focus-visible:ring-cyan-400/40 [&::-webkit-search-cancel-button]:hidden"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {STATUS_TABS.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-4 focus-visible:ring-offset-0">
              <section
                aria-busy={loading}
                aria-label={`${tab.label} requests`}
                className="overflow-hidden rounded-xl border border-gray-800 bg-[#0f0f10]"
              >
                <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3 text-sm text-gray-500 sm:px-5">
                  <span aria-live="polite">
                    {data
                      ? `${total} ${total === 1 ? 'request' : 'requests'}`
                      : error
                        ? 'Requests could not be loaded'
                        : 'Loading requests...'}
                  </span>
                  <button
                    type="button"
                    onClick={() => !loading && reload()}
                    aria-disabled={loading || undefined}
                    className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-gray-400 transition-colors hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 aria-disabled:opacity-60 aria-disabled:hover:text-gray-400"
                  >
                    {loading ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw size={14} aria-hidden="true" />
                    )}
                    Refresh
                  </button>
                </div>
                {error && data && (
                  <p className="border-b border-gray-800 bg-red-500/10 px-5 py-2 text-sm text-red-300" role="alert">
                    {error}
                  </p>
                )}
                <div className={loading && data ? 'opacity-60 transition-opacity' : undefined}>{list}</div>
                {data && total > PAGE_SIZE && (
                  <nav
                    aria-label="Pagination"
                    className="flex items-center justify-between gap-3 border-t border-gray-800 px-4 py-3 text-sm text-gray-500 sm:px-5"
                  >
                    <span>
                      {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => !loading && page > 1 && setPage(page - 1)}
                        aria-disabled={page <= 1 || loading || undefined}
                        aria-label="Previous page"
                        className={pageButtonClass}
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                      </button>
                      <span className="font-mono text-xs">
                        {page} / {pageCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => !loading && page < pageCount && setPage(page + 1)}
                        aria-disabled={page >= pageCount || loading || undefined}
                        aria-label="Next page"
                        className={pageButtonClass}
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </nav>
                )}
              </section>
            </TabsContent>
          ))}
        </Tabs>
      </main>

      {selected && (
        <RequestDetailSheet
          key={detailKey}
          api={api}
          request={selected}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          emailEnabled={notifications ? Boolean(notifications.client_email ?? notifications.email) : true}
          onUpdated={reload}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
};

export default AdminDashboard;
