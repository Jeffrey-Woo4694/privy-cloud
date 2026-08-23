import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocEditor } from '../components/DocEditor';
import { api } from '../api';

vi.mock('../api', async () => {
  const actual = (await vi.importActual('../api')) as typeof import('../api');
  return { api: { ...actual.api, officeSession: vi.fn() }, API_BASE: actual.API_BASE };
});
import { getToken } from '../auth';
vi.mock('../auth', () => ({ getToken: () => '' }));

describe('DocEditor', () => {
  it('shows a download fallback when the engine is disabled', async () => {
    (api.officeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: false });
    render(<DocEditor path="Documents/a.docx" name="a.docx" onSaved={() => {}} />);
    expect(await screen.findByText(/Editor unavailable/)).toBeTruthy();
  });
});
