import { pathSegments, type Location } from '../sharingLocation';

export function PathBar({ location, onNavigate, onBack, canGoBack }: {
  location: Location;
  onNavigate: (loc: Location) => void;
  onBack: () => void;
  canGoBack: boolean;
}) {
  const segments = pathSegments(location);
  return (
    <div className="path-bar">
      <button className="path-back" onClick={onBack} disabled={!canGoBack} aria-label="back">‹</button>
      {segments.map((s, i) => (
        <span key={s.key} className="path-seg">
          {i > 0 && <span className="path-sep">▸</span>}
          <button className="path-crumb" onClick={() => onNavigate(s.location)}>{s.label}</button>
        </span>
      ))}
    </div>
  );
}
