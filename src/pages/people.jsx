import React, { useState } from 'react';
import { ArrowUpRight, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useResource, money, pretty, Status, Loading, ErrorBox, Empty, Modal } from '../lib/runtime.jsx';
import { PageTitle } from './dashboard.jsx';
import { PaymentDetail } from './records.jsx';
import { ImportForm } from './management.jsx';
import { DeletePerson, PersonForm } from './people-crud.jsx';

export function PeoplePage({ sellers = false }) {
  const state = useResource(sellers ? '/sellers' : '/customers');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [payment, setPayment] = useState(null);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(undefined);
  const [deleting, setDeleting] = useState(null);
  const rows = state.data?.filter(person => `${person.name} ${person.email} ${person.externalId} ${person.craft || ''}`.toLowerCase().includes(q.toLowerCase())) || [];
  const canDelete = selected?.source === 'ADMIN_IMPORT' && (sellers
    ? !(selected.orders?.length || selected.earnings?.length || selected.payouts?.length)
    : selected.orderCount === 0);

  return <>
    <PageTitle
      eyebrow={sellers ? 'THE MAKERS BEHIND THE CRAFT' : 'CONNECTED CUSTOMER RECORDS'}
      title={sellers ? 'Seller records' : 'Customer records'}
      subtitle="Create and maintain authorized records, or import linked records from CultureFrame."
      actions={<><button className="btn btn-dark" onClick={() => setEditing(null)}><Plus size={16}/>Add {sellers ? 'seller' : 'customer'}</button><button className="btn btn-light" onClick={() => setImporting(true)}>Import order & records</button></>}
    />
    <section className="panel">
      <div className="table-toolbar"><div className="search-field"><Search size={16}/><input aria-label={sellers ? 'Search sellers' : 'Search customers'} placeholder={`Search ${sellers ? 'seller' : 'customer'} name, email, or reference…`} value={q} onChange={event => setQ(event.target.value)}/></div><span className="muted small">{rows.length} {sellers ? 'sellers' : 'customers'}</span></div>
      {state.loading && !state.data ? <Loading/> : state.error ? <ErrorBox message={state.error} retry={state.reload}/> : rows.length ? <div className="table-wrap"><table><thead><tr><th>{sellers ? 'Seller / Craft' : 'Customer'}</th><th>Contact</th><th>Reference</th><th>{sellers ? 'Net earnings' : 'Verified spending'}</th><th>Source</th><th/></tr></thead><tbody>{rows.map(person => <tr key={person.id}>
        <td><div className="person-cell"><span className="mini-avatar">{person.name.split(' ').map(value => value[0]).slice(0, 2).join('')}</span><div><button className="table-link" onClick={() => setSelected(person)}>{person.name}</button><small>{sellers ? person.craft : `${person.orderCount} orders`}</small></div></div></td>
        <td>{person.email}<small>{person.phone || person.location || '—'}</small></td><td>{person.externalId}</td><td className="amount">{money(sellers ? person.netCents : person.totalSpentCents)}</td><td><span className="source-tag">{pretty(person.source)}</span></td><td><button className="icon-btn" aria-label={`View ${person.name}`} onClick={() => setSelected(person)}><ArrowUpRight size={17}/></button></td>
      </tr>)}</tbody></table></div> : <Empty title={`No matching ${sellers ? 'sellers' : 'customers'}`} description={`Add a ${sellers ? 'seller' : 'customer'} or import an authorized order with linked records.`}/>} 
    </section>

    {selected && <Modal title={sellers ? 'Seller record' : 'Customer record'} wide onClose={() => setSelected(null)}>
      <div className="detail-hero"><div><h3>{selected.name}</h3><span>{selected.email}</span><small>{selected.externalId} · {pretty(selected.source)}</small></div><div><strong>{money(sellers ? selected.netCents : selected.totalSpentCents)}</strong><small>{sellers ? 'Net earnings' : 'Verified spending after refunds'}</small></div></div>
      <p className="muted">{sellers ? `${selected.craft} · ${selected.location}` : `${selected.phone || 'No phone'} · ${selected.address || 'No address'}`}</p>
      {selected.source === 'ADMIN_IMPORT' ? <div className="detail-actions"><button className="btn btn-light" onClick={() => { setEditing(selected); setSelected(null); }}><Pencil size={16}/>Edit record</button><button className="btn btn-light" disabled={!canDelete} title={canDelete ? 'Delete this unused record' : 'Records with order or financial history cannot be deleted.'} onClick={() => { setDeleting(selected); setSelected(null); }}><Trash2 size={16}/>Delete record</button></div> : <div className="info-banner"><p>This record is controlled by {selected.source === 'SIMULATOR' ? 'the development simulator' : 'CultureFrame'} and must be edited in its source system.</p></div>}
      {sellers ? <>
        <div className="detail-grid">{[['Gross sales', selected.grossCents], ['Commission', selected.commissionCents], ['Processing fees', selected.feeCents], ['Refund deductions', selected.refundCents], ['Paid out', selected.paidCents], ['Available balance', selected.availableCents]].map(([key, value]) => <div key={key}><small>{key}</small><strong>{money(value)}</strong></div>)}</div>
        <h4>Payment records</h4>{selected.earnings?.length ? selected.earnings.map(earning => <div key={earning.id} className="history-row"><button className="table-link" onClick={() => { setSelected(null); setPayment(earning.paymentId); }}>View payment <ArrowUpRight size={14}/></button><strong>{money(earning.grossCents)}</strong><span>Net {money(earning.netCents)}</span></div>) : <p className="muted">No payment records.</p>}
        <h4>Payout history</h4>{selected.payouts?.length ? selected.payouts.map(payout => <div className="history-row" key={payout.id}><span>{payout.reference}</span><strong>{money(payout.amountCents)}</strong><Status value={payout.status}/></div>) : <p className="muted">No payouts yet.</p>}
      </> : <>
        <h4>Orders & payment history</h4>{selected.orders?.length ? selected.orders.map(order => <div className="customer-order" key={order.id}><strong>{order.externalId}</strong><p>{order.product} × {order.quantity} · {money(order.amountCents)}</p>{order.payments.map(item => <div className="history-row" key={item.id}><button className="table-link" onClick={() => { setSelected(null); setPayment(item.id); }}>{item.reference}</button><Status value={item.status}/><span>{item.refunds.length} refund requests</span></div>)}</div>) : <p className="muted">No orders linked to this customer.</p>}
      </>}
    </Modal>}
    {payment && <PaymentDetail id={payment} onClose={() => setPayment(null)}/>} 
    {importing && <ImportForm onClose={() => setImporting(false)} onSuccess={state.reload}/>} 
    {editing !== undefined && <PersonForm sellers={sellers} record={editing} onClose={() => setEditing(undefined)} onSaved={state.reload}/>} 
    {deleting && <DeletePerson sellers={sellers} record={deleting} onClose={() => setDeleting(null)} onDeleted={state.reload}/>} 
  </>;
}
