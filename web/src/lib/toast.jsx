import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(() => {});
let seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((msg, kind = 'error') => {
    const id = ++seq;
    setToasts((list) => [...list, { id, msg: String(msg), kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 6000);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      {toasts.map((t, i) => (
        <div key={t.id} className={`toast${t.kind === 'error' ? ' is-error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'} style={{ bottom: 16 + i * 56 }}>
          {t.msg}
        </div>
      ))}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
