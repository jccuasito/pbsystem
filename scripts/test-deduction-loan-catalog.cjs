const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const { transformSync } = require('esbuild')
const sfc = require('@vue/compiler-sfc')

function evaluate(source, dependencies = {}) {
  const module = { exports: {} }
  vm.runInNewContext(
    transformSync(source, { loader: 'ts', format: 'cjs' }).code,
    { module, require: name => dependencies[name] || {} },
  )
  return module.exports
}

test('catalog page compiles as a reusable-name lookup form', () => {
  const filename = 'app/pages/deductions-loans/catalog/index.vue'
  const source = fs.readFileSync(filename, 'utf8')
  const { descriptor, errors } = sfc.parse(source, { filename })
  assert.deepEqual(errors, [])
  const compiled = sfc.compileScript(descriptor, { id: 'deduction-loan-catalog-test' })
  assert.deepEqual(sfc.compileTemplate({
    source: descriptor.template.content,
    filename,
    id: 'deduction-loan-catalog-test',
    compilerOptions: { bindingMetadata: compiled.bindings },
  }).errors, [])
  for (const style of descriptor.styles) {
    assert.deepEqual(sfc.compileStyle({ source: style.content, filename, id: 'deduction-loan-catalog-test', scoped: style.scoped }).errors, [])
  }
  assert.doesNotMatch(descriptor.template.content, /Loan amount|Deduction amount|Remaining balance|Amortization/i)
  assert.doesNotMatch(descriptor.template.content, /Provider or agency|Government agency/i)
  assert.doesNotMatch(descriptor.template.content, /Deduction category|Default frequency|Description/i)
  assert.match(descriptor.template.content, /Parent classification/)
  assert.match(descriptor.template.content, /Sub-classification/)
  assert.match(descriptor.template.content, /classification-group-row/)
  assert.match(descriptor.template.content, /<th>Name<\/th>/)
  assert.doesNotMatch(descriptor.template.content, /class="tabs"/)
  assert.match(descriptor.template.content, /\+ Add classification/)
  assert.match(descriptor.template.content, /\+ Add sub-classification/)
  assert.match(descriptor.scriptSetup.content, /openTypeForClassification/)
  assert.doesNotMatch(descriptor.scriptSetup.content, /DeductionCategory|DeductionPeriod|GovernmentAgency/)
})

test('MySQL catalog CRUD preserves existing type IDs and blocks unsafe classification deactivation', { skip: process.env.CATALOG_TEST_DATABASE !== '1' }, async () => {
  const env = { ...require('node:util').parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env }
  const connection = await require('mysql2/promise').createConnection({
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD,
    database: env.DB_NAME || 'pbsystem',
    dateStrings: true,
  })
  await connection.beginTransaction()
  try {
    const pool = {
      execute: (...args) => connection.execute(...args),
      getConnection: async () => ({
        execute: (...args) => connection.execute(...args),
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
      }),
    }
    const api = evaluate(fs.readFileSync('server/utils/deductionLoanCatalogCrud.ts', 'utf8'), {
      '../connection/dbconnect': pool,
      './auth': { requireSession: () => ({ sub: 1 }) },
      h3: {
        createError: options => Object.assign(new Error(options.statusMessage), options),
        getRouterParam: event => event.resource,
        readBody: async event => event.body,
      },
    })

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const classification = await api.createDeductionLoanCatalog({
      resource: 'classification',
      body: { ClassificationName: `TEST LOAN CLASS ${suffix}`, AppliesTo: 'Loan', Status: 'Active' },
    })
    const deductionClassification = await api.createDeductionLoanCatalog({
      resource: 'classification',
      body: { ClassificationName: `TEST DEDUCTION CLASS ${suffix}`, AppliesTo: 'Deduction', Status: 'Active' },
    })
    const secondLoanClassification = await api.createDeductionLoanCatalog({
      resource: 'classification',
      body: { ClassificationName: `TEST SECOND LOAN CLASS ${suffix}`, AppliesTo: 'Loan', Status: 'Active' },
    })
    const loan = await api.createDeductionLoanCatalog({
      resource: 'loan-type',
      body: { LoanName: `TEST LOAN ${suffix}`, ClassificationID: classification.id, Status: 'Active' },
    })
    const sameNameUnderAnotherParent = await api.createDeductionLoanCatalog({
      resource: 'loan-type',
      body: { LoanName: `TEST LOAN ${suffix}`, ClassificationID: secondLoanClassification.id, Status: 'Active' },
    })
    await assert.rejects(
      api.createDeductionLoanCatalog({
        resource: 'loan-type',
        body: { LoanName: `test loan ${suffix}`, ClassificationID: classification.id, Status: 'Active' },
      }),
      error => error.statusCode === 409 && /selected classification/.test(error.statusMessage),
    )
    await assert.rejects(
      api.updateDeductionLoanCatalog({
        resource: 'loan-type',
        body: { id: sameNameUnderAnotherParent.id, LoanName: `TEST LOAN ${suffix}`, ClassificationID: classification.id, Status: 'Active' },
      }),
      error => error.statusCode === 409 && /selected classification/.test(error.statusMessage),
    )
    const deduction = await api.createDeductionLoanCatalog({
      resource: 'deduction-type',
      body: { DeductionName: `TEST DEDUCTION ${suffix}`, ClassificationID: deductionClassification.id, Status: 'Active' },
    })

    const loans = await api.listDeductionLoanCatalog({ resource: 'loan-type' })
    const deductions = await api.listDeductionLoanCatalog({ resource: 'deduction-type' })
    const savedLoan = loans.items.find(item => Number(item.LoanTypeID) === Number(loan.id))
    const savedDeduction = deductions.items.find(item => Number(item.DeductionTypeID) === Number(deduction.id))
    assert.equal(savedLoan.ClassificationID, classification.id)
    assert.equal(savedDeduction.ClassificationID, deductionClassification.id)
    assert.equal('LoanAmount' in savedLoan, false)
    assert.equal('Amount' in savedDeduction, false)

    await api.updateDeductionLoanCatalog({
      resource: 'loan-type',
      body: { id: loan.id, LoanName: `UPDATED LOAN ${suffix}`, ClassificationID: classification.id, Status: 'Active' },
    })
    const updated = (await api.listDeductionLoanCatalog({ resource: 'loan-type' })).items.find(item => Number(item.LoanTypeID) === Number(loan.id))
    assert.equal(updated.LoanName, `UPDATED LOAN ${suffix}`)

    await assert.rejects(
      api.deleteDeductionLoanCatalog({ resource: 'classification', body: { id: classification.id } }),
      error => error.statusCode === 409,
    )
    await api.deleteDeductionLoanCatalog({ resource: 'loan-type', body: { id: loan.id } })
    await api.deleteDeductionLoanCatalog({ resource: 'loan-type', body: { id: sameNameUnderAnotherParent.id } })
    await api.deleteDeductionLoanCatalog({ resource: 'deduction-type', body: { id: deduction.id } })
    await api.deleteDeductionLoanCatalog({ resource: 'classification', body: { id: classification.id } })
    await api.deleteDeductionLoanCatalog({ resource: 'classification', body: { id: secondLoanClassification.id } })
    await api.deleteDeductionLoanCatalog({ resource: 'classification', body: { id: deductionClassification.id } })
    const inactive = (await api.listDeductionLoanCatalog({ resource: 'classification' })).items.find(item => Number(item.ClassificationID) === Number(classification.id))
    assert.equal(inactive.Status, 'Inactive')
  } finally {
    await connection.rollback()
    await connection.end()
  }
})

