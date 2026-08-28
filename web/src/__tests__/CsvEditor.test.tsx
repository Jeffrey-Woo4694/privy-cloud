import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CsvEditor } from '../components/CsvEditor';

describe('CsvEditor', () => {
  it('renders cells and saves edited content as CSV', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    // JSX attribute strings don't process JS escapes, so pass the newline via a JS expression.
    render(<CsvEditor initialText={'a,b\nc,d'} name="data.csv" onSave={onSave} onCancel={() => {}} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.map((i) => (i as HTMLInputElement).value)).toEqual(['a', 'b', 'c', 'd']);
    fireEvent.change(inputs[0], { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('X,b\nc,d');
  });

  it('quotes cells with commas on save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CsvEditor initialText="a,b" name="data.csv" onSave={onSave} onCancel={() => {}} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'x,y' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('"x,y",b');
  });

  it('calls onCancel', () => {
    const onCancel = vi.fn();
    render(<CsvEditor initialText="a,b" name="data.csv" onSave={vi.fn().mockResolvedValue(undefined)} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
