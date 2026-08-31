// Crisp, theme-aware inline icons. The small toolbar icons (fill = currentColor so
// they adopt the button/text colour and re-theme with the app's light/dark toggle)
// are used by the file-view toolbar; the folder/document tiles are bespoke colour
// SVGs. Added on top is a monochrome line-icon family (stroke = currentColor) shared
// by the sidebar categories, chat, list view, grid badge and context menu, so the
// whole sharing UI reads as one system.

import { type Kind } from '@privy/shared';
import type { ReactNode } from 'react';

/* Grid / list / more (⋯) toolbar icons, as thin outline strokes (stroke = currentColor)
   matching the line-icon family below — the filled squares/bars/dots read as heavy next
   to the rest of the sharing UI. Same geometry, thinner stroke. */
export function GridIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden="true">
      <rect x="1.5" y="1.5" width="5.2" height="5.2" rx="1" />
      <rect x="9.3" y="1.5" width="5.2" height="5.2" rx="1" />
      <rect x="1.5" y="9.3" width="5.2" height="5.2" rx="1" />
      <rect x="9.3" y="9.3" width="5.2" height="5.2" rx="1" />
    </svg>
  );
}

export function DotsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden="true">
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="13" cy="8" r="1.3" />
    </svg>
  );
}

export function ListIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" aria-hidden="true">
      <line x1="2" y1="3.4" x2="14" y2="3.4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12.6" x2="14" y2="12.6" />
    </svg>
  );
}

/* ---------- Monochrome line-icon family (24×24, stroke = currentColor) ---------- */

/** The set of icon names understood by <ShapeIcon>. */
export type IconName =
  | 'image' | 'video' | 'slide' | 'document' | 'audio' | 'archive'
  | 'markdown' | 'folder' | 'other'
  | 'home' | 'recent' | 'trash' | 'user' | 'bot' | 'text' | 'paperclip'
  | 'folderPlus' | 'filePlus' | 'eye' | 'download' | 'pencil' | 'undo' | 'link' | 'chevronDown'
  | 'back' | 'star' | 'starFilled' | 'expand' | 'compress';

/* Repeated geometry shared by more than one name. */
const pencil = (<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>);
const trash = (<><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></>);
const folder = (<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />);

const PATHS: Record<IconName, ReactNode> = {
  // File kinds.
  image: (<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>),
  video: (<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18" /><path d="M3 7h4" /><path d="M3 12h4" /><path d="M3 17h4" /><path d="M17 3v18" /><path d="M17 7h4" /><path d="M17 12h4" /><path d="M17 17h4" /></>),
  slide: (<><path d="M2 3h20" /><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" /><path d="m7 21 5-5 5 5" /></>),
  document: (<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v5h5" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></>),
  audio: (<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>),
  archive: (<><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>),
  markdown: pencil,
  folder,
  other: (<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v5h5" /><path d="M9.1 11a2.5 2.5 0 0 1 4.2 1.7c0 1.7-2.2 1.7-2.2 3.3" /><path d="M11 19h.01" /></>),
  // Places / UI.
  home: (<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22v-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6" /></>),
  recent: (<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>),
  trash,
  user: (<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  bot: (<><path d="M12 8V4H8" /><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></>),
  text: (<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /><path d="M8 9h8" /><path d="M8 13h5" /></>),
  paperclip: (<path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />),
  // Context-menu actions.
  folderPlus: (<><path d="M12 10v6" /><path d="M9 13h6" />{folder}</>),
  filePlus: (<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v5h5" /><path d="M12 12v6" /><path d="M9 15h6" /></>),
  eye: (<><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>),
  download: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>),
  pencil,
  undo: (<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" /></>),
  link: (<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>),
  chevronDown: (<path d="m6 9 6 6 6-6" />),
  // Fullscreen toggle (viewer actions menu): corner brackets out (maximize) / in (minimize).
  expand: (<><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></>),
  compress: (<><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></>),
  // Navigation / bookmarks.
  back: (<><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>),
  star: (<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />),
  starFilled: (<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" />),
};

/** Small stroke icon; adopts the surrounding text colour via currentColor. */
export function ShapeIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
      {PATHS[name]}
    </svg>
  );
}

/** File-kind → line-icon mapping (replaces the old emoji). */
export const KIND_ICON: Record<Kind, IconName> = {
  image: 'image', video: 'video', slide: 'slide', document: 'document',
  audio: 'audio', archive: 'archive', markdown: 'markdown', folder: 'folder', other: 'other',
};

/* ---------- Theme toggle ---------- */

/** A Tai Chi (yin-yang) mark — one half dark, one half light, each carrying a bead
   of the opposite colour — used as the dark/light theme toggle. It shows both
   states at once, so one glyph serves everywhere; the button still just toggles. */
export function TaiChiIcon({ size = 20 }: { size?: number }) {
  const yin = '#12141a';   // the dark half
  const yang = '#f4f6fb';  // the light half
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="11" fill={yang} />
      {/* the dark half: outer right edge + the S-shaped divider */}
      <path d="M12 1a11 11 0 0 1 0 22 5.5 5.5 0 0 1 0-11 5.5 5.5 0 0 0 0-11z" fill={yin} />
      {/* the complementary beads: black bead nested in the white half, white bead in the dark half */}
      <circle cx="12" cy="6.5" r="1.9" fill={yin} />
      <circle cx="12" cy="17.5" r="1.9" fill={yang} />
      {/* hairline so the light half stays legible on light chips */}
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="rgba(128,132,142,.45)" strokeWidth="0.75" />
    </svg>
  );
}

/* ---------- Bespoke colour tiles ---------- */

/* Adwaita-style folder (GNOME native palette): a soft rounded blue folder with a
   paler back tab and a whisper of depth — used for directory tiles. */
export function FolderIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" style={{ width: '100%', height: '100%' }}>
      {/* back tab (paler, sits above the front) */}
      <path fill="#bcdaf7" d="M8 19 a5 5 0 0 1 5 -5 h16 a7 7 0 0 1 6 3 l2 3 a6 6 0 0 0 5 3 h10 a5 5 0 0 1 5 5 v3 H8 Z" />
      {/* front flap */}
      <rect x="7" y="25" width="50" height="29" rx="8" fill="#9ac4f4" />
      {/* bottom depth */}
      <path fill="#2f6fce" opacity=".15" d="M7 45 v1 a8 8 0 0 0 8 8 h34 a8 8 0 0 0 8 -8 v-1 z" />
    </svg>
  );
}

/* macOS document icon — a white page with a folded corner and a small blue shape
   badge for the file's kind, like the Finder's generic file with its per-type
   logo. The badge is a monochrome line icon tinted blue. The icon box is sized by
   .tile-icon, so all icons stay in proportion with the display-size zoom. */
export function FilePageIcon({ kind }: { kind: Kind }) {
  return (
    <span className="file-page">
      <svg className="file-page-svg" viewBox="0 0 64 64" aria-hidden="true">
        <path fill="#f2f4f8" d="M20 6 h24 l14 14 v30 a8 8 0 0 1 -8 8 H20 a8 8 0 0 1 -8 -8 V14 a8 8 0 0 1 8 -8 z" />
        <path fill="#dce1ec" d="M44 6 v10 a4 4 0 0 0 4 4 h10 z" />
      </svg>
      <span className="file-page-badge"><ShapeIcon name={KIND_ICON[kind]} /></span>
    </span>
  );
}
