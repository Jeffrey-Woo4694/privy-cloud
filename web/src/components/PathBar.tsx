import { pathSegments, type Location } from '../sharingLocation';

// The file browser's top bar — two bordered groups, GNOME-Files style:
//   1. the back/forward nav group (‹ › joined in one rounded container), and
//   2. the breadcrumb "field": ancestor directories are clickable crumbs, while
//      the directory you're currently in is shown as emphasised, non-clickable text.
export function PathBar({ location, onNavigate, onBack, onForward, canGoBack, canGoForward, mobile = false }: {
  location: Location;
  onNavigate: (loc: Location) => void;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  // On the phone the sharing view has its own "← Back" button, so the ‹› nav group
  // is redundant, and jumping to Home from a deep folder is better served by the sidebar.
  mobile?: boolean;
}) {
  const segments = pathSegments(location);
  // Ancestor directories — clickable. On mobile the Home root crumb is dropped.
  const crumbs = segments.slice(0, -1).filter((s) => !mobile || s.key !== 'home');
  const current = segments[segments.length - 1]; // where you are now — reads, not a button
  return (
    <div className="path-bar">
      {!mobile && (
        <div className="path-nav" role="group" aria-label="navigate">
          <button className="path-nav-btn" onClick={onBack} disabled={!canGoBack} aria-label="back">‹</button>
          <span className="path-nav-div" aria-hidden="true" />
          <button className="path-nav-btn" onClick={onForward} disabled={!canGoForward} aria-label="forward">›</button>
        </div>
      )}
      <div className="path-field">
        {crumbs.map((s, i) => (
          <span key={s.key} className="path-seg">
            {i > 0 && <span className="path-sep">›</span>}
            <button className="path-crumb" onClick={() => onNavigate(s.location)}>{s.label}</button>
          </span>
        ))}
        {crumbs.length > 0 && <span className="path-sep">›</span>}
        <span className="path-current">{current.label}</span>
      </div>
    </div>
  );
}
