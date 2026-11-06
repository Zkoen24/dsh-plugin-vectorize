export default {
  root: '.',
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    pool: 'threads',
  },
}
