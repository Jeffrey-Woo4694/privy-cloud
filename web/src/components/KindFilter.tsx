import { KINDS, type Kind } from '@privy/shared';

export type KindFilterValue = Kind | 'all';

export function KindFilter({ value, onChange }: { value: KindFilterValue; onChange: (k: KindFilterValue) => void }) {
  return (
    <div className="kinds">
      <button className={`kind-chip${value === 'all' ? ' on' : ''}`} onClick={() => onChange('all')}>All</button>
      {KINDS.map((k) => (
        <button key={k.key} className={`kind-chip${value === k.key ? ' on' : ''}`} onClick={() => onChange(k.key)}>{k.label}</button>
      ))}
    </div>
  );
}
