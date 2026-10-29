import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AdminApp } from '../../src/workspace.jsx';
import { api, AuthContext, ToastContext, useResource } from '../../src/lib/runtime.jsx';

// Chart layout requires a real browser. These tests exercise the actual page components and routing.
vi.mock('recharts', async () => {
  const React = await import('react');
  const Container = ({ children }) => React.createElement('div', null, children);
  const Chart = ({ children }) => React.createElement('svg', null, children);
  const Blank = () => null;
  return { ResponsiveContainer: Container, ...Object.fromEntries(['AreaChart', 'PieChart', 'BarChart', 'LineChart'].map(name => [name, Chart]).concat(['Area', 'XAxis', 'YAxis', 'CartesianGrid', 'Tooltip', 'Pie', 'Cell', 'Bar', 'Line'].map(name => [name, Blank]))) };
});
const admin = { id: 'test-admin', email: 'admin@example.test', displayName: 'Test Administrator', mustChangePassword: false };
const summary = Object.fromEntries(['verifiedCents', 'totalTransactions', 'successfulPayments', 'pendingPayments', 'sellerEarningsCents', 'totalRefunds', 'completedRefunds', 'pendingPayoutCents', 'failedPayments', 'refundedCents', 'netCollectionsCents', 'paidCents', 'netVerifiedCents'].map(key => [key, 0]));
const report = { summary, payments: [], refunds: [], payouts: [], daily: [], monthly: [], statuses: [], methods: [] };
const integration = { mode: 'SIMULATOR', database: 'Isolated test storage', logs: [], counts: { orders: 0, customers: 0, sellers: 0 }, website: 'https://example.test', apiConfigured: false };
function response(url) {
  const path = url.split('?')[0];
  if (['/dashboard', '/reports'].includes(path)) return report;
  if (path === '/integration') return integration;
  if (path === '/settings') return { organizationName: 'Test CultureFrame', contactEmail: 'admin@example.test', commissionBps: 1000, refundDays: 30, notificationsEnabled: true };
  if (path === '/auth/profile') return { user: admin, history: [] };
  if (['/payments', '/transactions', '/refunds', '/receipts', '/payouts', '/audit'].includes(path)) return { rows: [], total: 0, page: 1, limit: 10, summary };
  if (['/methods', '/customers', '/sellers', '/earnings', '/notifications', '/orders'].includes(path)) return [];
  throw new Error(`Unexpected API request: ${url}`);
}
function Location() { return <output data-testid="location">{useLocation().pathname + useLocation().search}</output>; }
function Harness({ path = '/admin', force = false }) {
  const [user, setUser] = useState({ ...admin, mustChangePassword: force });
  return <AuthContext.Provider value={{ user, ready: true, setUser, applyAuth: data => setUser(data.user) }}><ToastContext.Provider value={vi.fn()}><MemoryRouter initialEntries={[path]}><Location/><Routes><Route path="/admin/*" element={<AdminApp/>}/><Route path="/login" element={<h1>Sign in</h1>}/></Routes></MemoryRouter></ToastContext.Provider></AuthContext.Provider>;
}
beforeEach(() => { vi.spyOn(api, 'get').mockImplementation(async url => ({ data: response(url) })); });
const pages = [
  ['Overview', 'Workspace overview', '/dashboard', '/admin'],
  ['Payments', 'Payment management', '/payments', '/admin/payments'],
  ['Transactions', 'Transaction history', '/transactions', '/admin/transactions'],
  ['Refunds', 'Refund management', '/refunds', '/admin/refunds'],
  ['Receipts', 'Digital receipts', '/receipts', '/admin/receipts'],
  ['Customers', 'Customer records', '/customers', '/admin/customers'],
  ['Sellers', 'Seller records', '/sellers', '/admin/sellers'],
  ['Seller earnings', 'Seller earnings', '/earnings', '/admin/earnings'],
  ['Payouts', 'Payout management', '/payouts', '/admin/payouts'],
  ['Financial reports', 'Financial reports', '/reports', '/admin/reports'],
  ['Notifications', 'Notifications', '/notifications', '/admin/notifications'],
  ['Audit logs', 'Audit logs', '/audit', '/admin/audit'],
  ['CultureFrame integration', 'CultureFrame integration', '/integration', '/admin/integration'],
  ['System settings', 'System settings', '/settings', '/admin/settings'],
  ['Admin profile', 'Administrator profile', '/auth/profile', '/admin/profile'],
];
describe('Admin navigation', () => {
  it('every sidebar click renders its own page, URL, active link, and API data', async () => {
    const user = userEvent.setup(); render(<Harness/>);
    await screen.findByRole('heading', { level: 1, name: 'Workspace overview' });
    for (const [label, heading, endpoint, path] of pages) {
      api.get.mockClear();
      const link = within(screen.getByRole('navigation')).getByRole('link', { name: label, exact: true });
      // Visit another page before Overview so its resource request is exercised too.
      if (label === 'Overview') await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'Payments', exact: true }));
      await user.click(link);
      expect(await screen.findByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByTestId('location')).toHaveTextContent(path);
      expect(link).toHaveAttribute('aria-current', 'page');
      await waitFor(() => expect(api.get.mock.calls.some(([url]) => url.split('?')[0] === endpoint)).toBe(true));
      if (label !== 'Overview') expect(screen.queryByRole('heading', { name: 'Workspace overview' })).not.toBeInTheDocument();
    }
  }, 30000);
  it.each(pages)('loads %s directly without redirecting to Overview', async (_label, heading, _endpoint, path) => {
    render(<Harness path={path}/>);
    expect(await screen.findByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(path);
  });
  it('supports a trailing slash and shows unknown routes explicitly', async () => {
    const { unmount } = render(<Harness path="/admin/payments/"/>);
    await screen.findByRole('heading', { name: 'Payment management' });
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Payments', exact: true })).toHaveAttribute('aria-current', 'page');
    unmount();
    render(<Harness path="/admin/does-not-exist"/>);
    expect(await screen.findByRole('heading', { name: 'Admin page not found' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/does-not-exist');
  });
  it('keeps payment creation in Payments and transaction history read only', async () => {
    const user = userEvent.setup(); render(<Harness path="/admin/payments"/>);
    await screen.findByRole('button', { name: 'New payment' });
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'Transactions', exact: true }));
    await screen.findByRole('heading', { name: 'Transaction history' });
    expect(screen.queryByRole('button', { name: 'New payment' })).not.toBeInTheDocument();
    expect(await screen.findByText('Matching transactions')).toBeVisible();
  });
  it('does not carry customer filters or dialogs into Sellers', async () => {
    const user = userEvent.setup(); render(<Harness path="/admin/customers"/>);
    await user.type(screen.getByRole('textbox', { name: 'Search customers' }), 'customer only');
    await user.click(screen.getByRole('button', { name: 'Add customer' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'Sellers', exact: true }));
    expect(await screen.findByRole('textbox', { name: 'Search sellers' })).toHaveValue('');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows and retries a seller earnings report failure instead of showing an empty report', async () => {
    let attempts = 0;
    api.get.mockImplementation(async url => {
      if (url === '/earnings') {
        attempts += 1;
        if (attempts === 1) throw { response: { data: { error: 'Seller earnings temporarily unavailable' } } };
        return { data: [] };
      }
      return { data: response(url) };
    });
    const user = userEvent.setup(); render(<Harness path="/admin/reports"/>);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Report type' }), 'earnings');
    expect(await screen.findByRole('alert')).toHaveTextContent('Seller earnings temporarily unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No records in this report')).toBeVisible();
  });
  it('surfaces and retries unavailable integration status in System settings', async () => {
    let attempts = 0;
    api.get.mockImplementation(async url => {
      if (url === '/integration') {
        attempts += 1;
        if (attempts <= 2) throw { response: { data: { error: 'Integration status temporarily unavailable' } } };
        return { data: integration };
      }
      return { data: response(url) };
    });
    const user = userEvent.setup(); render(<Harness path="/admin/settings"/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Integration status temporarily unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(attempts).toBe(3));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('keeps global search on Transactions and passes search filters to the API', async () => {
    const user = userEvent.setup(); render(<Harness/>);
    await user.type(screen.getByRole('textbox', { name: 'Search transactions' }), 'ORDER-123{Enter}');
    expect(await screen.findByRole('heading', { name: 'Transaction history' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Search transaction history' })).toHaveValue('ORDER-123');
    await waitFor(() => expect(api.get.mock.calls.some(([url]) => url.startsWith('/transactions?') && new URLSearchParams(url.split('?')[1]).get('q') === 'ORDER-123')).toBe(true));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter transaction status' }), 'FAILED');
    await waitFor(() => expect(api.get.mock.calls.some(([url]) => url.startsWith('/transactions?') && new URLSearchParams(url.split('?')[1]).get('status') === 'FAILED')).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('textbox', { name: 'Search transaction history' })).toHaveValue('');
  }, 15000);
  it('shows the current module error and recovers without redirecting to Overview', async () => {
    api.get.mockImplementation(async url => { if (url.startsWith('/refunds')) throw { response: { data: { error: 'Refunds temporarily unavailable' } } }; return { data: response(url) }; });
    const user = userEvent.setup(); render(<Harness path="/admin/refunds"/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Refunds temporarily unavailable');
    expect(screen.getByRole('heading', { name: 'Refund management' })).toBeVisible();
    api.get.mockImplementation(async url => ({ data: response(url) }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No refund requests')).toBeVisible();
  });
  it('completes first-login setup and returns to the requested module', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { user: admin, csrfToken: 'test-token' } });
    const user = userEvent.setup(); render(<Harness path="/admin/refunds" force/>);
    await screen.findByRole('heading', { name: 'Make this account your own' });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/setup-password');
    await user.click(screen.getByLabelText('Initial password')); await user.paste('InitialTestPassword2026!');
    await user.click(screen.getByLabelText(/^New password/, { selector: 'input' })); await user.paste('ChangedTestPassword2026!');
    await user.click(screen.getByLabelText('Confirm new password')); await user.paste('ChangedTestPassword2026!');
    await user.click(screen.getByRole('button', { name: 'Update password & open workspace' }));
    expect(await screen.findByRole('heading', { name: 'Refund management' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/refunds');
  }, 15000);
});
describe('Module data isolation', () => {
  it('clears old data on URL change and ignores a late response from a previous page', async () => {
    const pending = new Map();
    api.get.mockImplementation(url => new Promise(resolve => pending.set(url, resolve)));
    const { result, rerender } = renderHook(({ url }) => useResource(url), { initialProps: { url: '/customers' } });
    await act(async () => pending.get('/customers')({ data: ['Customer'] }));
    expect(result.current.data).toEqual(['Customer']);
    rerender({ url: '/sellers' });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    rerender({ url: '/earnings' });
    await act(async () => pending.get('/earnings')({ data: ['Earnings'] }));
    await act(async () => pending.get('/sellers')({ data: ['Late seller'] }));
    expect(result.current.data).toEqual(['Earnings']);
  });
});
