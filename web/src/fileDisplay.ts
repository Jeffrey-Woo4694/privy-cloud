/** A display name shortened so the file type always survives: "…word.md" instead of
 *  a tail-cut that would hide the extension. Used by the grid tiles (3-line clamp)
 *  and the viewer top bar (single line), where the full name lives in the `title`
 *  tooltip / the editor's name field instead.
 *
 *  For tiles the budget must fit within the real 3-line box: at the default tile
 *  width the content box is ~96px and each line holds ~11-14 chars, so keeping the
 *  total (base + "…" + type) under ~32 chars guarantees the type survives the clamp.
 *  A larger budget once produced a string that wrapped to a 4th line and got
 *  clipped, hiding the extension. The viewer bar shares the same 32-char budget:
 *  on a phone the bar is Back + name + one menu button, and ~32 chars is what fits
 *  without wrapping (wrapping is what pushed the old long names to four lines). */
export function truncatedName(name: string, isDir: boolean, max = 32): string {
  // Hidden files (".gitignore") and directories have no trailing type.
  const dot = name.lastIndexOf('.');
  const hasType = !isDir && dot > 0;
  const type = hasType ? name.slice(dot + 1) : ''; // "md" — no leading dot
  const base = hasType ? name.slice(0, dot) : name;
  if (name.length > max) {
    const cap = Math.max(max - type.length - 1, 0); // leave room for "…" + type
    return base.slice(0, cap) + '…' + type;
  }
  return name;
}
