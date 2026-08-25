import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Markdown } from '../components/Markdown';

// The copy button reads `navigator.clipboard.writeText`; jsdom does not provide
// it, so give it a mock before any test exercises the copy path.
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('Markdown', () => {
  it('renders bold text as a strong element', () => {
    const { container } = render(<Markdown>{'**bold**'}</Markdown>);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('bold');
  });

  it('renders a heading as an h2 element', () => {
    const { container } = render(<Markdown>{'## Title'}</Markdown>);
    expect(container.querySelector('h2')?.textContent).toBe('Title');
  });

  it('renders inline code as a bare code element (no code-block wrapper)', () => {
    const { container } = render(<Markdown>{'use `foo()`'}</Markdown>);
    expect(container.querySelector('code')).not.toBeNull();
    expect(container.querySelector('.codeblock')).toBeNull();
  });

  it('renders a fenced code block with a language label and a pre>code body', () => {
    const { container } = render(<Markdown>{'```python\nprint("hi")\n```'}</Markdown>);
    const block = container.querySelector('.codeblock');
    expect(block).not.toBeNull();
    expect(block!.querySelector('.codeblock-lang')?.textContent).toBe('python');
    expect(block!.querySelector('pre code')).not.toBeNull();
  });

  it('renders a GFM table', () => {
    const { container } = render(<Markdown>{'| a | b |\n|---|---|\n| 1 | 2 |'}</Markdown>);
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('renders a blockquote', () => {
    const { container } = render(<Markdown>{'> quoted line'}</Markdown>);
    expect(container.querySelector('blockquote')).not.toBeNull();
  });

  it('copies the code to the clipboard when the copy button is clicked', async () => {
    render(<Markdown>{'```python\nprint("hi")\n```'}</Markdown>);

    const copyButton = await screen.findByRole('button', { name: /copy/i });
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('print("hi")'));
    // Button flips to a "Copied ✓" confirmation state.
    expect(await screen.findByText(/Copied/)).toBeInTheDocument();
  });

  it('renders a fenced block without a language as a <pre> (line breaks survive, no header)', () => {
    const { container } = render(<Markdown>{'```\nfoo\nbar\n```'}</Markdown>);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('foo');
    expect(container.querySelector('.codeblock-head')).toBeNull();
  });

  it('does not double-wrap a language-tagged codeblock inside an outer <pre>', () => {
    const { container } = render(<Markdown>{'```python\nprint("x")\n```'}</Markdown>);
    expect(container.querySelector('div.codeblock')).not.toBeNull();
    expect(container.querySelector('pre > .codeblock')).toBeNull();
  });
});
