import React, { useState } from 'react';
import { Banknote, Bell, CheckCheck, RotateCcw, Trash2 } from 'lucide-react';
import { api, useResource, useToast, date, pretty, ErrorBox, Empty, Loading, errorMessage } from '../lib/runtime.jsx';
import { PageTitle } from './dashboard.jsx';

export function NotificationsPage() {
  const state = useResource('/notifications');
  const toast = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState('');
  const rows = state.data?.filter(notification => !unreadOnly || !notification.readAt) || [];

  async function mark(id) {
    setBusy(`read:${id}`);
    try {
      await api.patch(`/notifications/${id}/read`);
      toast(id === 'all' ? 'All notifications marked as read.' : 'Notification marked as read.');
      state.reload();
    } catch (requestError) {
      toast(errorMessage(requestError), 'error');
    } finally {
      setBusy('');
    }
  }

  async function remove(id) {
    setBusy(`delete:${id}`);
    try {
      const response = await api.delete(`/notifications/${id}`);
      toast(id === 'read' ? `${response.data.deleted} read notification${response.data.deleted === 1 ? '' : 's'} cleared.` : 'Notification deleted.');
      state.reload();
    } catch (requestError) {
      toast(errorMessage(requestError), 'error');
    } finally {
      setBusy('');
    }
  }

  return <>
    <PageTitle eyebrow="STAY IN THE KNOW" title="Notifications" subtitle="Review, mark, filter, and clear workspace activity notifications." actions={<><button className="btn btn-light" disabled={Boolean(busy)} onClick={() => mark('all')}><CheckCheck size={16}/>Mark all read</button><button className="btn btn-light" disabled={Boolean(busy) || !state.data?.some(item => item.readAt)} onClick={() => remove('read')}><Trash2 size={16}/>Clear read</button></>}/>
    <section className="panel"><div className="panel-heading"><h3>Workspace activity</h3><label className="checkbox"><input type="checkbox" checked={unreadOnly} onChange={event => setUnreadOnly(event.target.checked)}/>Unread only</label></div>
      {state.error ? <ErrorBox message={state.error} retry={state.reload}/> : state.loading ? <Loading/> : rows.length ? <div className="notification-list">{rows.map(notification => <div className={`notification-item ${notification.readAt ? '' : 'unread'}`} key={notification.id}>
        <span className="notification-icon">{notification.type === 'REFUND' ? <RotateCcw size={19}/> : notification.type === 'PAYOUT' ? <Banknote size={19}/> : <Bell size={19}/>}</span>
        <div><strong>{notification.title}</strong><p>{notification.message}</p><small>{date(notification.createdAt)} · {pretty(notification.type)}</small></div>
        <div className="notification-actions">{!notification.readAt && <button className="icon-btn" disabled={Boolean(busy)} title="Mark as read" aria-label={`Mark ${notification.title} as read`} onClick={() => mark(notification.id)}><CheckCheck size={18}/></button>}<button className="icon-btn" disabled={Boolean(busy)} title="Delete notification" aria-label={`Delete ${notification.title}`} onClick={() => remove(notification.id)}><Trash2 size={17}/></button></div>
      </div>)}</div> : <Empty title={unreadOnly ? 'No unread notifications' : "You're all caught up"} description="New financial activity will appear here."/>}
    </section>
  </>;
}
