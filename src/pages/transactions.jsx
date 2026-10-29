import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Search, RotateCcw } from 'lucide-react';
import { useResource, money, date, pretty, Status, Loading, ErrorBox, Empty } from '../lib/runtime.jsx';
import { PageTitle, StatCard } from './dashboard.jsx';
import { Pager, ExportButtons, PaymentDetail, paymentStatuses, useDebounce } from './records.jsx';

export function Transactions() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '', status = params.get('status') || '', method = params.get('method') || '';
  const from = params.get('from') || '', to = params.get('to') || '', sort = params.get('sort') || 'createdAt:desc';
  const page = Math.max(1, Number(params.get('page')) || 1), selected = params.get('detail');
  const query = new URLSearchParams({ page, limit: 10, q: useDebounce(q), status, method, from, to, sort: sort.split(':')[0], direction: sort.split(':')[1] || 'desc' }).toString();
  const state = useResource(`/transactions?${query}`), methods = useResource('/methods');
  function update(key, value) { setParams(previous => { const next = new URLSearchParams(previous); value ? next.set(key, String(value)) : next.delete(key); if (!['page', 'detail'].includes(key)) next.delete('page'); return next; }); }
  const summary = state.data?.summary;
  return <>
    <PageTitle eyebrow="A TRACEABLE FINANCIAL HISTORY" title="Transaction history" subtitle="Search recorded payments, inspect activity, and export the filtered history. Process payments from the Payments page."/>
    {summary && <div className="stats-grid"><StatCard label="Matching transactions" value={state.data.total} note="All records matching the current filters" dark/><StatCard label="Verified collections" value={money(summary.verifiedCents)} note="Verified gross payments before refunds"/><StatCard label="Completed refunds" value={money(summary.refundedCents)} note="Refunds against matching payments" Icon={RotateCcw}/><StatCard label="Net verified collections" value={money(summary.netVerifiedCents)} note="Verified collections less completed refunds"/></div>}
    <section className="panel">
      <div className="table-toolbar"><div className="search-field"><Search size={16}/><input aria-label="Search transaction history" placeholder="Search transaction, order, customer, or seller" value={q} onChange={e => update('q', e.target.value)}/></div><select aria-label="Filter transaction status" value={status} onChange={e => update('status', e.target.value)}><option value="">All statuses</option>{paymentStatuses.map(value => <option key={value} value={value}>{pretty(value)}</option>)}</select><select aria-label="Filter transaction method" value={method} onChange={e => update('method', e.target.value)}><option value="">All methods</option>{methods.data?.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select><ExportButtons module="transactions" query={query}/></div>
      <div className="table-subfilters"><label>From <input aria-label="Transactions from date" type="date" value={from} onChange={e => update('from', e.target.value)}/></label><label>To <input aria-label="Transactions to date" type="date" min={from} value={to} onChange={e => update('to', e.target.value)}/></label><label>Sort <select aria-label="Sort transaction history" value={sort} onChange={e => update('sort', e.target.value)}><option value="createdAt:desc">Newest first</option><option value="createdAt:asc">Oldest first</option><option value="amountCents:desc">Amount: high to low</option><option value="amountCents:asc">Amount: low to high</option><option value="reference:asc">Reference A–Z</option></select></label><button className="btn btn-light btn-sm" onClick={() => setParams({})}>Clear filters</button></div>
      {state.error ? <ErrorBox message={state.error} retry={state.reload}/> : state.loading && !state.data ? <Loading/> : state.data?.rows.length ? <div className="table-wrap"><table><thead><tr><th>Transaction / Order</th><th>Customer / Seller</th><th>Gross amount</th><th>Refunded</th><th>Method</th><th>Status</th><th>Recorded</th><th/></tr></thead><tbody>{state.data.rows.map(payment => <tr key={payment.id}><td><button className="table-link" onClick={() => update('detail', payment.id)}>{payment.reference}</button><small>{payment.order.externalId}</small></td><td>{payment.order.customer.name}<small>{payment.order.seller.name}</small></td><td className="amount">{money(payment.amountCents)}</td><td>{money(payment.refundedCents)}</td><td>{payment.method.name}</td><td><Status value={payment.status}/></td><td>{date(payment.createdAt)}</td><td><button className="icon-btn" aria-label={`View transaction ${payment.reference}`} onClick={() => update('detail', payment.id)}><ArrowUpRight size={17}/></button></td></tr>)}</tbody></table></div> : <Empty title="No matching transactions" description="Adjust the filters or create a payment request in Payments."/>}
      <Pager data={state.data} onPage={value => update('page', value)}/>
    </section>
    {selected && <PaymentDetail readOnly id={selected} onClose={() => update('detail', '')}/>}
  </>;
}
