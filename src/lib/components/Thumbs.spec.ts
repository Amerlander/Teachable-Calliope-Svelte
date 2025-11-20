import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import Thumbs from './Thumbs.svelte';

describe('Thumbs component', () => {
  it('renders no images if there is no active class', () => {
    const { getByText } = render(Thumbs);
    expect(getByText('Keine Klasse ausgewählt')).toBeTruthy();
  });
});
