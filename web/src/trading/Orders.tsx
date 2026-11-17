import { useState } from 'react';
import { fmtUsd } from '../../../shared/money';
import type { ClientMessage } from '../../../shared/protocol';
import type { Order } from '../../../shared/types';

const describe = (o: Order) => {
  if (o.type === 'stop') return `Stop ${fmtUsd(o.stopPrice ?? 0)}${o.triggered ? ' (triggered)' : ''}`;
  if (o.type === 'limit') return `Limit ${fmtUsd(o.limitPrice ?? 0)}`;
  return 'Market';
};

export function Orders({ orders, onSend }: { orders: Order[]; onSend: (m: ClientMessage) => void }) {
  return (
    <div>
      <div className="panel-title flex items-center justify-between">
        <span>Working orders</span>
        {orders.length > 0 && <button className="text-[12px] underline" onClick={() => onSend({ type: 'cancel_all' })}>Cancel all</button>}
      </div>
      {orders.length === 0 ? <p className="px-3 py-2 text-[13px] text-muted">No working orders.</p> : (
        <ul className="text-[13px]">{orders.map((o) => <OrderRow key={o.id} o={o} onSend={onSend} />)}</ul>
      )}
    </div>
  );
}

function OrderRow({ o, onSend }: { o: Order; onSend: (m: ClientMessage) => void }) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(o.qty));
  const [price, setPrice] = useState(String(o.type === 'stop' ? o.stopPrice : o.limitPrice ?? ''));
  const save = () => {
    const changes: { qty?: number; limitPrice?: number; stopPrice?: number } = { qty: Number(qty) };
    if (o.type === 'limit') changes.limitPrice = Number(price);
    if (o.type === 'stop') changes.stopPrice = Number(price);
    onSend({ type: 'modify_order', orderId: o.id, changes });
    setEditing(false);
  };
  return (
    <li className="flex items-center gap-2 border-t border-rule/50 px-3 py-1">
      <span className={`w-9 font-semibold ${o.side === 'buy' ? 'text-up' : 'text-down'}`}>{o.side === 'buy' ? 'Buy' : 'Sell'}</span>
      <span className="font-semibold">{o.symbol}</span>
      {editing ? (
        <>
          <input aria-label="New quantity" className="num w-16" value={qty} onChange={(e) => setQty(e.target.value)} />
          {o.type !== 'market' && <input aria-label="New price" className="num w-20" value={price} onChange={(e) => setPrice(e.target.value)} />}
          <button className="btn" onClick={save}>Save</button>
          <button className="text-muted" onClick={() => setEditing(false)}>Cancel edit</button>
        </>
      ) : (
        <>
          <span className="num">{o.qty}</span>
          <span className="num text-muted">{describe(o)}</span>
          {o.status === 'pending_parent' && <span className="text-[12px] text-muted">waits for entry fill</span>}
          <span className="ml-auto flex gap-2">
            <button className="underline text-muted" onClick={() => setEditing(true)}>Modify</button>
            <button className="underline" onClick={() => onSend({ type: 'cancel_order', orderId: o.id })}>Cancel</button>
          </span>
        </>
      )}
    </li>
  );
}
