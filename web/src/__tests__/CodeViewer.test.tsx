import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodeViewer } from '../components/CodeViewer';

// CodeEditor uses CodeMirror (lazy-loaded, heavy), which doesn't mount cleanly in
// jsdom — stub it so we can assert the edit path hands the source to it and saves back.
vi.mock('../components/CodeEditor', () => ({
  CodeEditor: (props: { value?: string; onSave: (c: string) => Promise<void> }) => (
    <div data-testid="codeeditor" data-value={props.value}>
      <button onClick={() => void props.onSave('edited-from-mock')}>mock-save</button>
    </div>
  ),
}));

// The copy button reads `navigator.clipboard.writeText`; jsdom does not provide it.
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

const CPP = '#include <iostream>\nint main() {\n  std::cout << "hi";\n  return 0;\n}';

function viewer(text: string, onSave = vi.fn()) {
  return render(<CodeViewer name="main.cpp" path="src/main.cpp" text={text} onSave={onSave} />);
}

describe('CodeViewer', () => {
  it('renders the source highlighted with matching line numbers and a language badge', () => {
    const { container } = viewer(CPP);
    // The whole source is present in the code surface.
    expect(container.querySelector('.codeviewer-code')?.textContent).toContain('int main');
    expect(container.querySelector('.codeviewer-code')?.textContent).toContain('return 0');
    // One number per source line (CPP has 5 lines).
    const gutter = container.querySelector('.codeviewer-gutter')?.textContent ?? '';
    expect(gutter).toContain('1');
    expect(gutter).toContain('5');
    // Language badge labels the file.
    expect(screen.getByText('cpp')).toBeTruthy();
  });

  it('copies the raw source (no trailing newline) when Copy is clicked', async () => {
    const { container } = viewer('print("hi")\n');
    const copyButton = await screen.findByRole('button', { name: /copy/i });
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('print("hi")'));
    expect(await screen.findByText(/Copied/)).toBeInTheDocument();
    // A trailing newline still numbers the empty last line (2 numbers here).
    expect(container.querySelector('.codeviewer-gutter')?.textContent).toContain('2');
  });

  it('Edit mounts the (stubbed) highlighted editor with the source and saves back', async () => {
    const onSave = vi.fn();
    viewer('line1\nline2', onSave);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    // The lazy CodeEditor resolves asynchronously under Suspense.
    const editor = await screen.findByTestId('codeeditor');
    expect(editor).toHaveAttribute('data-value', 'line1\nline2');
    fireEvent.click(screen.getByText('mock-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('edited-from-mock'));
  });

  it('falls back to plain-text editing for very large files', () => {
    // >1 MB of source: highlighting + numbering a megabyte is too costly, so the
    // component opens the textarea directly instead of the highlighted gutters.
    const big = 'x'.repeat(1_000_001);
    const { container } = render(<CodeViewer name="huge.py" path="huge.py" text={big} onSave={vi.fn()} />);
    expect(screen.getByText(/too large for the highlighted view/i)).toBeTruthy();
    // The head row's name field is also a textbox, so the content area goes by tag.
    expect(container.querySelector('textarea')).toHaveValue(big);
    // No gutter/copy chrome for a file we render as plain text.
    expect(screen.queryByText(/copy/i)).toBeNull();
  });

  it('shows a binary message instead of rendering NUL-byte content', () => {
    // A Java `.class` is bytecode; rendering it as highlighted text would be mojibake.
    render(<CodeViewer name="Foo.class" path="Other/Foo.class" text={'bad\x00data'} onSave={vi.fn()} />);
    expect(screen.getByText(/binary file/i)).toBeTruthy();
    // No gutter/copy chrome, and no edit affordance for binary content.
    expect(screen.queryByText(/copy/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });
});
