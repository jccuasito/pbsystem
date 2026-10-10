import { defineEventHandler } from 'h3'
import { changePayrollDeductionOverride } from '../../../../utils/payrollDeductionOverrideCrud'
export default defineEventHandler(changePayrollDeductionOverride)
