import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StructuredViewer } from '../components/StructuredViewer';

describe('StructuredViewer', () => {
  it('renders a CSV as a table', () => {
    render(<StructuredViewer name="a.csv" text={'x,y\n1,2'} onEdit={() => {}} />);
    expect(screen.getByText('x')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });
});
