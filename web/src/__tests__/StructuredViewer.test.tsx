import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StructuredViewer } from '../components/StructuredViewer';

describe('StructuredViewer', () => {
  it('renders JSON pretty-printed', () => {
    const { container } = render(<StructuredViewer name="a.json" text='{"x":1}' onEdit={() => {}} />);
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('"x"');
  });
});
