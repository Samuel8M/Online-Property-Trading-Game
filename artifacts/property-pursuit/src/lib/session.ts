const key = (code: string) => `pp:token:${code.toUpperCase()}`;
export const getToken = (code: string): string => {
  try { return localStorage.getItem(key(code)) ?? ''; } catch { return ''; }
};
export const setToken = (code: string, t: string) => {
  try { localStorage.setItem(key(code), t); } catch { /* ignore */ }
};
export const errMsg = (e: unknown): string => {
  const x = e as { data?: { error?: string; message?: string }; message?: string } | null;
  return x?.data?.error ?? x?.data?.message ?? x?.message ?? 'Something went wrong.';
};
export const money = (n: number | null | undefined) => (n == null ? '-' : `$${n.toLocaleString()}`);
