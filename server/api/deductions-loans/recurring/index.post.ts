import { defineEventHandler } from 'h3'
import { saveRecurringDeduction } from '../../../utils/recurringDeductionCrud'
export default defineEventHandler(saveRecurringDeduction)
