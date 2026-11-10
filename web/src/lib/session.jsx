import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

// Who is signed in, plus server modes from /api/health (simulate banner etc).
const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ user: null, health: null, ready: false });

  const refresh = useCallback(async () => {
    const [health, user] = await Promise.all([
      api('/api/health').catch(() => null),
      api('/api/auth/me').then((r) => r.user).catch(() => null),
    ]);
    setState({ user, health, ready: true });
    return user;
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { json: {} }).catch(() => {});
    window.location.href = '/';
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return <SessionContext.Provider value={{ ...state, refresh, logout }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
