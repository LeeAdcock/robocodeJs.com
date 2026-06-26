// Local development mode lets the app run with no external Postgres and no
// Google sign-in, so a fresh clone works with just `npm install && npm run dev`.
//
// It is ON when the process is NOT in production or test AND no database host is
// configured. A real deployment always sets both NODE_ENV=production and
// RDS_HOSTNAME, so it can never enable this by accident; the test exclusion
// keeps the suite (which runs with NODE_ENV=test and mocks the db) on the normal
// code paths; and the auth bypass re-checks NODE_ENV !== 'production' too.
export const isLocalDev =
  process.env.NODE_ENV !== 'production' &&
  process.env.NODE_ENV !== 'test' &&
  !process.env.RDS_HOSTNAME;
