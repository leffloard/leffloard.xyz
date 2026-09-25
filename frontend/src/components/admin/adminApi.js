import axios from 'axios';
import { API_BASE } from '../../lib/requests';

const SESSION_KEY = 'leffloard.admin.session';

export const NOT_CONFIGURED_MESSAGE = 'Admin panel is not configured on the server. See README.';

export const isNotConfigured = (error) =>
  error?.response?.status === 503 && /not configured/i.test(String(error.response.data?.detail || ''));

export function loadSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!session?.token) return null;
    if (session.expires_at && Date.parse(session.expires_at) <= Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    return;
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    return;
  }
}

export async function login(password) {
  const { data } = await axios.post(`${API_BASE}/admin/login`, { password }, { timeout: 15000 });
  return data;
}

export async function probeConfigured() {
  try {
    await axios.get(`${API_BASE}/admin/me`, { timeout: 10000 });
    return true;
  } catch (error) {
    return !isNotConfigured(error);
  }
}

export function createAdminClient(token, { onUnauthorized, onNotConfigured }) {
  const client = axios.create({
    baseURL: `${API_BASE}/admin`,
    timeout: 20000,
    headers: { Authorization: `Bearer ${token}` },
  });
  client.interceptors.response.use(undefined, (error) => {
    if (error.response?.status === 401) onUnauthorized();
    if (isNotConfigured(error)) onNotConfigured();
    return Promise.reject(error);
  });
  return client;
}

export const isHandledStatus = (error) => error?.response?.status === 401 || isNotConfigured(error);
