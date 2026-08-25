import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodeEditor } from '../components/CodeEditor';

// CodeMirror needs real DOM measurement that jsdom can't provide, so stub the CM
// component with a plain textarea. This tests the CodeEditor's own behavior — the
// live editor is verified in the browser. The module still imports the real language
// packages/theme, which don't touch the DOM at import time.
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="cm" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

describe('CodeEditor', () => {
  it('renders the source in the editor', () => {
    render(<CodeEditor path="main.rs" value="fn main() {}" ext="rs" onSave={vi.fn()} />);
    expect(screen.getByTestId('cm')).toHaveValue('fn main() {}');
  });

  it('Save writes the edited content back through onSave', async () => {
    const onSave = vi.fn();
    render(<CodeEditor path="main.rs" value="fn main() {}" ext="rs" onSave={onSave} />);
    fireEvent.change(screen.getByTestId('cm'), { target: { value: 'fn main() { println!("hi"); }' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('fn main() { println!("hi"); }'));
  });

  it('Ctrl+S saves without the default browser handler', async () => {
    const onSave = vi.fn();
    const { getByTestId } = render(<CodeEditor path="a.py" value="print(1)" ext="py" onSave={onSave} />);
    fireEvent.change(getByTestId('cm'), { target: { value: 'print(2)' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('print(2)'));
  });
});
