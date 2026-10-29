import React, { createContext, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Check, LoaderCircle, Leaf, ReceiptText, X, Eye, EyeOff } from 'lucide-react';

export const api = axios.create({ baseURL: '/api', withCredentials: true });
export const AuthContext = createContext(null);
export const ToastContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export const useToast = () => useContext(ToastContext);
export const money = cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format((cents || 0) / 100);
export const date = value => new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
export const pretty = value => String(value || '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
export const errorMessage = e => e.response?.data?.error || 'Could not connect. Check that the server is running.';
api.interceptors.response.use(r => r, e => { if (e.response?.status === 401 && !e.config?.url?.includes('/auth/')) window.dispatchEvent(new Event('cf-session-expired')); return Promise.reject(e); });
export function useResource(url) {
  const [result, setResult] = useState({ url: null, data: null, error: '', loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(previous => ({ url, data: previous.url === url ? previous.data : null, error: '', loading: true }));
    api.get(url, { signal: controller.signal }).then(response => {
      if (!controller.signal.aborted) setResult({ url, data: response.data, error: '', loading: false });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ url, data: null, error: errorMessage(error), loading: false });
    });
    return () => controller.abort();
  }, [url, revision]);
  const current = result.url === url ? result : { data: null, error: '', loading: true };
  return { data: current.data, error: current.error, loading: current.loading, reload: () => setRevision(value => value + 1) };
}
export function Loading() { return <div className="loading"><LoaderCircle className="spin" size={22}/><span>Loading your workspace…</span></div>; }
export function ErrorBox({ message, retry }) { return <div className="error-box" role="alert"><p>{message}</p>{retry && <button className="btn btn-light" onClick={retry}>Try again</button>}</div>; }
export function Logo({ light = false }) { return <Link className={`logo ${light ? 'light' : ''}`} to="/"><span className="logo-mark"><Leaf size={22} strokeWidth={1.7}/></span><span>CultureFrame<small>PAYMENTS WITH PURPOSE</small></span></Link>; }
export function Status({ value }) { return <span className={`status ${String(value).toLowerCase()}`}><span/>{pretty(value)}</span>; }
export function Empty({ title = 'No records yet', description = 'Records will appear here as you work.' }) { return <div className="empty"><ReceiptText size={32}/><h3>{title}</h3><p>{description}</p></div>; }
export function Modal({ title, children, onClose, wide = false }) {
  useEffect(() => { const previous = document.activeElement; const handler = e => { if (e.key === 'Escape') onClose(); if (e.key === 'Tab') { const nodes = [...document.querySelectorAll('.modal button:not(:disabled), .modal input, .modal select, .modal textarea, .modal a')]; const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }; document.addEventListener('keydown', handler); document.body.style.overflow = 'hidden'; setTimeout(() => document.querySelector('.modal button')?.focus(), 0); return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = ''; previous?.focus(); }; }, []);
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><h2 id="modal-title">{title}</h2><button className="icon-btn" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</section></div>;
}
export function Field({ label, children, hint }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function PasswordInput(props) { const [shown, setShown] = useState(false); return <div className="password-input"><input {...props} type={shown ? 'text' : 'password'}/><button type="button" aria-label={shown ? 'Hide password' : 'Show password'} onClick={() => setShown(!shown)}>{shown ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>; }
export async function download(url, filename) {
  const response = await api.get(url, { responseType: 'blob' });
  const object = URL.createObjectURL(response.data);
  const a = document.createElement('a'); a.href = object; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(object), 1000);
}
export function Providers({ children }) {
  const [user, setUser] = useState(null), [ready, setReady] = useState(false), [toast, setToast] = useState(null);
  const applyAuth = data => { setUser(data.user); api.defaults.headers.common['x-csrf-token'] = data.csrfToken; };
  const refresh = () => api.get('/auth/session').then(r => applyAuth(r.data));
  useEffect(() => { refresh().catch(() => {}).finally(() => setReady(true)); const expired = () => { setUser(null); setToast({ message: 'Your session expired. Please sign in again.', type: 'error' }); refresh(); }; window.addEventListener('cf-session-expired', expired); return () => window.removeEventListener('cf-session-expired', expired); }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 5500); return () => clearTimeout(t); } }, [toast]);
  return <AuthContext.Provider value={{ user, ready, applyAuth, refresh, setUser }}><ToastContext.Provider value={(message, type = 'success') => setToast({ message, type })}>{children}{toast && <div className={`toast ${toast.type}`} role="status"><span>{toast.type === 'success' ? <Check size={18}/> : <X size={18}/>}</span>{toast.message}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16}/></button></div>}</ToastContext.Provider></AuthContext.Provider>;
}
