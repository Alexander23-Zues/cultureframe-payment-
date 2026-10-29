import React, { useState } from 'react';
import { Routes, Route, Navigate, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, CreditCard, ArrowLeftRight, RotateCcw, ReceiptText, Users, Store, Wallet, Banknote, ChartNoAxesCombined, Bell, ScrollText, Link2, Settings, UserRound, LogOut, PanelLeftClose, PanelLeftOpen, Search, Menu, X, ChevronRight, Leaf } from 'lucide-react';
import { useAuth, useToast, useResource, api, Loading, Logo, errorMessage } from './lib/runtime.jsx';
import { Dashboard } from './pages/dashboard.jsx';
import { Payments, Refunds, Receipts, Payouts } from './pages/records.jsx';
import { People, Earnings, Reports, Notifications, AuditLogs } from './pages/operations.jsx';
import { Integration, SettingsPage, Profile } from './pages/management.jsx';
import { Transactions } from './pages/transactions.jsx';
export const navItems = [
  ['', 'Overview', LayoutDashboard, 'WORKSPACE'], ['payments', 'Payments', CreditCard], ['transactions', 'Transactions', ArrowLeftRight], ['refunds', 'Refunds', RotateCcw], ['receipts', 'Receipts', ReceiptText],
  ['customers', 'Customers', Users, 'PEOPLE & EARNINGS'], ['sellers', 'Sellers', Store], ['earnings', 'Seller earnings', Wallet], ['payouts', 'Payouts', Banknote],
  ['reports', 'Financial reports', ChartNoAxesCombined, 'ADMINISTRATION'], ['notifications', 'Notifications', Bell], ['audit', 'Audit logs', ScrollText], ['integration', 'CultureFrame integration', Link2], ['settings', 'System settings', Settings], ['profile', 'Admin profile', UserRound],
];
export function AdminApp() {
  const auth = useAuth(), navigate = useNavigate(), location = useLocation(), toast = useToast();
  const [collapsed, setCollapsed] = useState(false), [mobile, setMobile] = useState(false), [search, setSearch] = useState('');
  if (!auth.ready) return <Loading/>;
  if (!auth.user) return <Navigate to="/login" replace/>;
  if (location.pathname.endsWith('/')) return <Navigate to={location.pathname.replace(/\/+$/, '') + location.search} state={location.state} replace/>;
  if (auth.user.mustChangePassword && location.pathname !== '/admin/setup-password') return <Navigate to="/admin/setup-password" state={{ returnTo: location.pathname + location.search }} replace/>;
  const current = navItems.find(([path]) => location.pathname === `/admin${path ? '/' + path : ''}`)?.[1] || 'Workspace';
  async function logout() { try { await api.post('/auth/logout'); auth.setUser(null); navigate('/login'); } catch (e) { toast(errorMessage(e), 'error'); } }
  const requested = location.state?.returnTo;
  const returnTo = typeof requested === 'string' && /^\/admin(?:\/|\?|$)/.test(requested) && !requested.startsWith('/admin/setup-password') ? requested : '/admin';
  if (auth.user.mustChangePassword) {
    return <div className="admin-setup"><header className="admin-setup-header"><Logo/><button className="btn btn-light" onClick={logout}><LogOut size={16}/>Sign out</button></header><main className="admin-setup-content"><p className="setup-step">ACCOUNT SETUP · STEP 1 OF 1</p><Profile force/><p className="setup-explanation">Dashboard, payments, and other admin pages will unlock after you save your new password.</p></main></div>;
  }
  if (location.pathname === '/admin/setup-password') return <Navigate to={returnTo} replace/>;
  return <div className={`workspace ${collapsed ? 'collapsed' : ''}`}>
    {mobile && <div className="sidebar-overlay" onClick={() => setMobile(false)}/>}
    <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}><Link to="/admin" className="sidebar-logo"><span className="sidebar-logo-icon"><Leaf size={24}/></span><span>CultureFrame<small>PAYMENT MANAGEMENT</small></span></Link><button className="mobile-sidebar-close icon-btn" aria-label="Close sidebar" onClick={() => setMobile(false)}><X/></button><nav>{navItems.map(([path, title, Icon, group]) => <React.Fragment key={path}>{group && <span className="nav-group">{group}</span>}<NavLink title={collapsed ? title : undefined} to={`/admin${path ? '/' + path : ''}`} end onClick={() => setMobile(false)}><Icon size={18} strokeWidth={1.7}/><span>{title}</span></NavLink></React.Fragment>)}</nav><div className="sidebar-bottom"><div className="sidebar-purpose"><Leaf size={18}/><p>Rooted in culture.<br/><strong>Built with purpose.</strong></p></div><button className="logout" onClick={logout}><LogOut size={18}/><span>Sign out</span></button></div></aside>
    <div className="workspace-main"><header className="workspace-header"><div className="header-location"><button className="icon-btn desktop-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}</button><button className="icon-btn mobile-menu" aria-label="Open sidebar" onClick={() => setMobile(true)}><Menu size={20}/></button><span className="header-home">Workspace</span><ChevronRight size={14}/><strong>{current}</strong></div><div className="header-actions"><form className="header-search" onSubmit={e => { e.preventDefault(); navigate(`/admin/transactions?q=${encodeURIComponent(search)}`); }}><Search size={16}/><input aria-label="Search transactions" placeholder="Search transactions…" value={search} onChange={e => setSearch(e.target.value)}/><kbd>↵</kbd></form><Link className="header-bell icon-btn" aria-label="Notifications" to="/admin/notifications"><Bell size={19}/></Link><Link className="header-profile" to="/admin/profile"><span className="avatar">{auth.user.displayName.split(' ').map(w => w[0]).slice(0, 2).join('')}</span><span>{auth.user.displayName.split(' ')[0]}<small>Super administrator</small></span></Link></div></header>
      <main className="workspace-content"><ModeBanner/><div className="admin-page" key={location.pathname}><Routes><Route index element={<Dashboard/>}/><Route path="payments" element={<Payments/>}/><Route path="transactions" element={<Transactions/>}/><Route path="refunds" element={<Refunds/>}/><Route path="receipts" element={<Receipts/>}/><Route path="customers" element={<People/>}/><Route path="sellers" element={<People sellers/>}/><Route path="earnings" element={<Earnings/>}/><Route path="payouts" element={<Payouts/>}/><Route path="reports" element={<Reports/>}/><Route path="notifications" element={<Notifications/>}/><Route path="audit" element={<AuditLogs/>}/><Route path="integration" element={<Integration/>}/><Route path="settings" element={<SettingsPage/>}/><Route path="profile" element={<Profile/>}/><Route path="*" element={<AdminPageNotFound/>}/></Routes></div></main><footer className="workspace-footer"><span>CultureFrame Payments</span><span>Mansalay, Oriental Mindoro <i/> Asia/Manila</span></footer></div></div>;
}
function AdminPageNotFound() { return <section className="empty"><h1>Admin page not found</h1><p>This address does not match an admin module.</p><Link className="btn btn-dark" to="/admin">Return to overview</Link></section>; }
function ModeBanner() {
  const state = useResource('/integration');
  if (!state.data) return null;
  return <div className="mode-banner"><span className="mode-dot"/><strong>{state.data.mode === 'SIMULATOR' ? 'Development workspace' : 'Live integration unverified'}</strong><span>{state.data.mode === 'SIMULATOR' ? 'Sample records are simulated. No real money is moved.' : 'Manual records are available. Gateway and CultureFrame activation require verification.'}</span><Link to="/admin/integration">Connection details <ChevronRight size={14}/></Link></div>;
}
