const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateRequestObject } = require('../server/utils/inputValidation.ts')

test('billing line keys are accepted only in the opted-in direct lines array', () => {
  const body = { billingId: 12, batchIds: [1, 2], lines: [{ id: 'source-1' }, { id: 'manual-2' }] }
  assert.equal(validateRequestObject(body, { billingLineIds: true }), body)
  assert.throws(() => validateRequestObject(body), /Identifiers/)
  assert.throws(() => validateRequestObject({ billingId: 'source-1', lines: [] }, { billingLineIds: true }), /Identifiers/)
  assert.throws(() => validateRequestObject({ nested: { lines: [{ id: 'source-1' }] } }, { billingLineIds: true }), /Identifiers/)
  assert.throws(() => validateRequestObject({ lines: [{ id: { value: 'manual-1' } }] }, { billingLineIds: true }), /billing line identifier/)
  assert.throws(() => validateRequestObject({ lines: [{ id: 'x'.repeat(101) }] }, { billingLineIds: true }), /billing line identifier/)
})
