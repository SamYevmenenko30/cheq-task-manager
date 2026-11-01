// Without this, a second render() in the same file finds the first one still mounted and
// a query that should match once matches twice — a failure that says nothing about the
// code under test.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);
