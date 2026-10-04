const key = (code: string) => `pp:token:${code.toUpperCase()}`;
export const SESSION_CHANGE_EVENT = 'pp:sessions-changed';
// Only enumerate room codes. Tokens are read separately when a player returns.
export const getSavedRoomCodes = (): string[] => {
  try {
    const codes: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const match = k?.match(/^pp:token:([A-Z0-9]{1,8})$/);
      if (match && localStorage.getItem(k!)) codes.push(match[1]);
    }
    return codes.sort();
  } catch { return []; }
};
export const getToken = (code: string): string => {
  try { return localStorage.getItem(key(code)) ?? ''; } catch { return ''; }
};
export const setToken = (code: string, t: string) => {
  try {
    if (t) localStorage.setItem(key(code), t);
    else localStorage.removeItem(key(code));
    window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
  } catch { /* ignore */ }
};
export const errMsg = (e: unknown): string => {
  const x = e as { data?: { error?: string; message?: string }; message?: string } | null;
  return x?.data?.error ?? x?.data?.message ?? x?.message ?? 'Something went wrong.';
};
export const money = (n: number | null | undefined) => (n == null ? '-' : `$${n.toLocaleString()}`);
