import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Without Vitest globals, Testing Library does not unmount renders on its own
afterEach(cleanup);
