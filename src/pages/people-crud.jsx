import React, { useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { api, useToast, ErrorBox, Field, Modal, errorMessage } from '../lib/runtime.jsx';
import { FormActions } from './records.jsx';

export function PersonForm({ sellers, record, onClose, onSaved }) {
  const editing = Boolean(record?.id);
  const linked = sellers ? Boolean(record?.orders?.length) : Boolean(record?.orderCount);
  const [form, setForm] = useState(sellers ? {
    externalId: record?.externalId || '', name: record?.name || '', email: record?.email || '', craft: record?.craft || '', location: record?.location || 'Mansalay, Oriental Mindoro',
  } : {
    externalId: record?.externalId || '', name: record?.name || '', email: record?.email || '', phone: record?.phone || '', address: record?.address || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const change = key => event => setForm(previous => ({ ...previous, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editing) await api.patch(`/${sellers ? 'sellers' : 'customers'}/${record.id}`, form);
      else await api.post(sellers ? '/sellers' : '/customers', form);
      toast(`${sellers ? 'Seller' : 'Customer'} ${editing ? 'updated' : 'created'}.`);
      onSaved();
      onClose();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={`${editing ? 'Edit' : 'Add'} ${sellers ? 'seller' : 'customer'}`} onClose={onClose}><form onSubmit={submit}>
    <p className="form-intro">This creates or updates an authorized administrative record. CultureFrame-synchronized records must be changed in their source system.</p>
    <Field label="External reference" hint={linked ? 'References linked to orders are locked.' : 'Use the stable reference from the source record.'}><input required minLength={1} maxLength={100} disabled={linked} value={form.externalId} onChange={change('externalId')}/></Field>
    <Field label={sellers ? 'Seller name' : 'Customer name'}><input required minLength={2} maxLength={100} value={form.name} onChange={change('name')}/></Field>
    <Field label="Email address"><input required type="email" maxLength={190} value={form.email} onChange={change('email')}/></Field>
    {sellers ? <><Field label="Craft category"><input required minLength={2} maxLength={100} value={form.craft} onChange={change('craft')}/></Field><Field label="Location"><input required minLength={2} maxLength={200} value={form.location} onChange={change('location')}/></Field></> : <><Field label="Phone number (optional)"><input maxLength={30} value={form.phone} onChange={change('phone')}/></Field><Field label="Address (optional)"><textarea rows={3} maxLength={250} value={form.address} onChange={change('address')}/></Field></>}
    {error && <ErrorBox message={error}/>}<FormActions busy={busy} label={editing ? 'Save changes' : `Create ${sellers ? 'seller' : 'customer'}`} onClose={onClose}/>
  </form></Modal>;
}

export function DeletePerson({ sellers, record, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/${sellers ? 'sellers' : 'customers'}/${record.id}`);
      toast(`${sellers ? 'Seller' : 'Customer'} deleted.`);
      onDeleted();
      onClose();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }
  return <Modal title={`Delete ${sellers ? 'seller' : 'customer'}`} onClose={onClose}><p className="form-intro">Delete <strong>{record.name}</strong>? Only records with no orders or financial history can be removed.</p>{error && <ErrorBox message={error}/>}<div className="form-actions"><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-dark" disabled={busy} onClick={remove}>{busy ? <LoaderCircle className="spin" size={17}/> : <Trash2 size={16}/>}Delete record</button></div></Modal>;
}
