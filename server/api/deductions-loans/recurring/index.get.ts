import { defineEventHandler } from 'h3'
import { listRecurringDeductions } from '../../../utils/recurringDeductionCrud'
export default defineEventHandler(listRecurringDeductions)
