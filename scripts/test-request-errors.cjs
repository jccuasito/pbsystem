const {test} = require('node:test'), assert = require('node:assert/strict')
const {requestErrorMessage} = require('../shared/utils/requestError.ts')

test('transport errors never display the fetch URL, method or query values', () => {
  const message = '[GET] "/api/attendance/dtr?periodStart=2026-09-16&token=secret": <no response> Failed to fetch'
  assert.equal(requestErrorMessage({name:'FetchError',message}), 'Cannot connect to the server. Please check your connection and try again.')
  assert.equal(requestErrorMessage({name:'FetchError',statusCode:503,message}), 'The service is temporarily unavailable. Please try again shortly.')
  assert.equal(requestErrorMessage({name:'TypeError',message:'Failed to fetch'}), 'Cannot connect to the server. Please check your connection and try again.')
})
test('all server failures use a public message even when their data contains diagnostics', () => {
  for (const statusCode of [500,502,503]) {
    const result=requestErrorMessage({statusCode,data:{statusMessage:'SQLSTATE ER_BAD_FIELD_ERROR SELECT password FROM user',message:'private stack'},message:'D:/private/server/api/test.ts:12:3'})
    assert.equal(result,'The service is temporarily unavailable. Please try again shortly.')
  }
  assert.equal(requestErrorMessage({response:{status:504}}),'The request timed out. Please try again.')
})
test('expected validation/conflict messages and local Excel checks stay useful', () => {
  for (const statusCode of [400,409,422]) assert.equal(requestErrorMessage({statusCode,data:{statusMessage:'Choose an active shift for this agency.'}}),'Choose an active shift for this agency.')
  assert.equal(requestErrorMessage(new Error('Required columns: Employee ID or Employee No, and Date.')),'Required columns: Employee ID or Employee No, and Date.')
  const cause={statusCode:409,data:{statusMessage:'This PDF already exists for this cutoff.',data:{code:'ARCHIVE_DUPLICATE'}}}
  requestErrorMessage(cause)
  assert.equal(cause.data.data.code,'ARCHIVE_DUPLICATE','Formatting does not mutate error codes used by the workflow')
})
test('technical details are rejected even inside a nominal validation response', () => {
  for (const statusMessage of ['SELECT Password FROM user',"Unknown column 'Secret'",'ER_DUP_ENTRY: private data','D:\\private\\system\\server.ts','<script>alert(1)</script>','Internal error\n at secret.ts:12:3','[GET] /api/private: 500','https://internal.example/database']) {
    assert.equal(requestErrorMessage({statusCode:400,data:{statusMessage}},'Please review the form.'),'Please review the form.')
  }
  assert.equal(requestErrorMessage(new TypeError('Cannot read properties of undefined'),'Unable to read this file.'),'Unable to read this file.')
})
test('permission, throttling, cancellation and missing errors have clear fallbacks', () => {
  assert.equal(requestErrorMessage({status:401}),'Please sign in to continue.')
  assert.equal(requestErrorMessage({status:403}),'You do not have permission to perform this action.')
  assert.equal(requestErrorMessage({status:429}),'Too many requests. Please wait a moment before trying again.')
  assert.equal(requestErrorMessage({name:'AbortError'}),'The request was cancelled.')
  assert.equal(requestErrorMessage(null,'Unable to load the list.'),'Unable to load the list.')
})
