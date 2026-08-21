import { CATEGORY_PLACES, locationKey, type Location } from '../sharingLocation';

const VIRTUAL_PLACES: Array<{ label: string; icon: string; location: Location }> = [
  { label: 'Home', icon: '🏠', location: { type: 'home' } },
  { label: 'Recent', icon: '🕒', location: { type: 'recent' } },
  { label: 'Trash', icon: '🗑️', location: { type: 'trash' } },
];

export function SharingSidebar({ location, onSelect }: { location: Location; onSelect: (loc: Location) => void }) {
  return (
    <div className="sharing-sidebar">
      {VIRTUAL_PLACES.map((p) => (
        <button key={p.label} className={`sidebar-item${locationKey(p.location) === locationKey(location) ? ' active' : ''}`}
          onClick={() => onSelect(p.location)}>
          <span className="sidebar-icon">{p.icon}</span>{p.label}
        </button>
      ))}
      <div className="sidebar-divider" />
      {CATEGORY_PLACES.map((p) => (
        <button key={p.id} className={`sidebar-item${locationKey(p.location) === locationKey(location) ? ' active' : ''}`}
          onClick={() => onSelect(p.location)}>
          <span className="sidebar-icon">{p.icon}</span>{p.label}
        </button>
      ))}
    </div>
  );
}
