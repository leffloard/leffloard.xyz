export const API_BASE = `${(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')}/api`;

export const REQUEST_TYPES = ['appointment', 'revision', 'inquiry'];

export const TYPE_LABELS = {
  appointment: 'Appointment',
  revision: 'Revision',
  inquiry: 'Inquiry',
};

export const SERVICES = [
  'Web Development',
  'Discord Bot',
  'Authentication System',
  'Loader / Desktop App',
  'Other',
];

export const STATUSES = ['new', 'confirmed', 'declined', 'completed'];

export const STATUS_LABELS = {
  new: 'New',
  confirmed: 'Confirmed',
  declined: 'Declined',
  completed: 'Completed',
};

export const DURATIONS = [15, 30, 45, 60];

export const LIMITS = {
  name: 80,
  email: 254,
  contact_handle: 80,
  subject: 120,
  message: 4000,
  project_reference: 120,
  admin_note: 2000,
  client_message: 2000,
};

export const MAX_DAYS_AHEAD = 120;

export function contactHref({ type, service, subject } = {}) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (service) params.set('service', service);
  if (subject) params.set('subject', subject);
  const query = params.toString();
  return `/${query ? `?${query}` : ''}#contact`;
}

export function fieldErrorsFromResponse(data) {
  const detail = data?.detail;
  if (!Array.isArray(detail)) return null;
  const errors = {};
  for (const item of detail) {
    if (!item || typeof item !== 'object') continue;
    const field = item.field ?? (Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : undefined);
    const message = item.message ?? String(item.msg ?? '').replace(/^Value error,\s*/, '');
    const key = typeof field === 'string' && field ? field : '_form';
    if (message && !errors[key]) errors[key] = message;
  }
  return errors;
}

export function apiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error?.response) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  const detail = error.response.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  return fallback;
}
