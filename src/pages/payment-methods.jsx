import React, { useState } from 'react';
import { CreditCard, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, useResource, useToast, ErrorBox, Field, Loading, Modal, errorMessage, pretty } from '../lib/runtime.jsx';
import { FormActions } from './records.jsx';

function MethodForm({ method, simulatorMode, onClose, onSaved }) {
  const editing = Boolean(method?.id);
  const locked = Boolean(method?.usageCount);
  const [name, setName] = useState(method?.name || '');
  const [kind, setKind] = useState(method?.kind || 'MANUAL');
  const [enabled, setEnabled] = useState(method?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { name, kind, enabled };
      if (editing) await api.patch(`/methods/${method.id}`, payload);
      else await api.post('/methods', payload);
      onSaved(editing ? 'Payment method updated.' : 'Payment method created.');
      onClose();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={editing ? 'Edit payment method' : 'Add payment method'} onClose={onClose}><form onSubmit={submit}>
    <p className="form-intro">Manual methods require an administrator to verify the real transfer reference and evidence. Simulator methods never move money and are limited to development orders.</p>
    {locked && <div className="warning-box">This method is used by {method.usageCount} payment{method.usageCount === 1 ? '' : 's'}. Its name and type are locked to preserve receipts and audit history.</div>}
    <Field label="Method name"><input required minLength={2} maxLength={80} value={name} disabled={locked} onChange={event => setName(event.target.value)}/></Field>
    <Field label="Processing type" hint={kind === 'MANUAL' ? 'The administrator confirms the transfer before settlement.' : 'Development-only confirmation; no real funds move.'}><select value={kind} disabled={locked} onChange={event => { const value = event.target.value; setKind(value); if (value === 'SIMULATOR' && simulatorMode !== 'SIMULATOR') setEnabled(false); }}><option value="MANUAL">Manual verification</option><option value="SIMULATOR">Development simulator</option></select></Field>
    <label className="toggle-row"><div><strong>Available for new payments</strong><small>Disabled methods remain visible in historical records.</small></div><input className="switch" type="checkbox" checked={enabled} disabled={kind === 'SIMULATOR' && simulatorMode !== 'SIMULATOR'} onChange={event => setEnabled(event.target.checked)}/></label>
    {error && <ErrorBox message={error}/>}<FormActions busy={busy} label={editing ? 'Save method' : 'Create method'} onClose={onClose}/>
  </form></Modal>;
}

export function PaymentMethods({ simulatorMode }) {
  const state = useResource('/methods');
  const toast = useToast();
  const [editing, setEditing] = useState(undefined);
  const [deleting, setDeleting] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [deleteError, setDeleteError] = useState('');

  function saved(message) {
    toast(message);
    state.reload();
  }

  async function toggle(method) {
    setBusyId(method.id);
    try {
      await api.patch(`/methods/${method.id}`, { enabled: !method.enabled });
      toast(`${method.name} ${method.enabled ? 'disabled' : 'enabled'}.`);
      state.reload();
    } catch (requestError) {
      toast(errorMessage(requestError), 'error');
    } finally {
      setBusyId('');
    }
  }

  async function remove() {
    setBusyId(deleting.id);
    setDeleteError('');
    try {
      await api.delete(`/methods/${deleting.id}`);
      toast('Payment method deleted.');
      setDeleting(null);
      state.reload();
    } catch (requestError) {
      setDeleteError(errorMessage(requestError));
    } finally {
      setBusyId('');
    }
  }

  return <section className="panel payment-methods-panel">
    <div className="panel-heading"><div><h3>Payment methods</h3><p>Manual verification and local simulation</p></div><button className="btn btn-light btn-sm" onClick={() => setEditing(null)}><Plus size={15}/>Add method</button></div>
    <div className="settings-body">
      {state.loading && !state.data ? <Loading/> : state.error ? <ErrorBox message={state.error} retry={state.reload}/> : state.data?.length ? <div className="payment-method-list">{state.data.map(method => {
        const simulatorUnavailable = method.kind === 'SIMULATOR' && simulatorMode !== 'SIMULATOR';
        return <div className="payment-method-row" key={method.id}>
          <span className="payment-method-icon"><CreditCard size={17}/></span>
          <div className="payment-method-copy"><strong>{method.name}</strong><small>{method.kind === 'MANUAL' ? 'Manual verification' : 'Development simulator'} · {method.usageCount} payment{method.usageCount === 1 ? '' : 's'}</small></div>
          <span className={`method-state ${method.enabled ? 'active' : ''}`}>{method.enabled ? 'Active' : 'Disabled'}</span>
          <label className="method-switch" title={simulatorUnavailable ? 'Simulator is unavailable outside development.' : `${method.enabled ? 'Disable' : 'Enable'} ${method.name}`}><span className="sr-only">Enable {method.name}</span>{busyId === method.id ? <LoaderCircle className="spin" size={17}/> : <input className="switch" type="checkbox" checked={method.enabled} disabled={simulatorUnavailable || Boolean(busyId)} onChange={() => toggle(method)}/>}</label>
          <button className="icon-btn bordered" aria-label={`Edit ${method.name}`} title={method.usageCount ? 'Used methods are locked to preserve history.' : `Edit ${method.name}`} disabled={Boolean(method.usageCount)} onClick={() => setEditing(method)}><Pencil size={15}/></button>
          <button className="icon-btn bordered" aria-label={`Delete ${method.name}`} title={method.usageCount ? 'Disable this method instead; it is used by payments.' : `Delete ${method.name}`} disabled={Boolean(method.usageCount)} onClick={() => { setDeleteError(''); setDeleting(method); }}><Trash2 size={15}/></button>
        </div>;
      })}</div> : <p className="muted small">No payment methods configured. Add a manual method to accept verified transfers.</p>}
      <p className="method-safety-note">GCash, Maya, and bank transfers are manual records until a certified provider integration is configured. Always verify the actual transfer before marking a payment successful.</p>
    </div>
    {editing !== undefined && <MethodForm method={editing} simulatorMode={simulatorMode} onClose={() => setEditing(undefined)} onSaved={saved}/>} 
    {deleting && <Modal title="Delete payment method" onClose={() => setDeleting(null)}><p className="form-intro">Delete <strong>{deleting.name}</strong>? This is allowed only because it has no payment history. This action cannot be undone.</p>{deleteError && <ErrorBox message={deleteError}/>}<div className="form-actions"><button className="btn btn-light" onClick={() => setDeleting(null)}>Cancel</button><button className="btn btn-dark" disabled={busyId === deleting.id} onClick={remove}>{busyId === deleting.id ? <LoaderCircle className="spin" size={17}/> : <Trash2 size={16}/>}Delete method</button></div></Modal>}
  </section>;
}
