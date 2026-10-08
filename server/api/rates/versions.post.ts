import { defineEventHandler } from 'h3'
import { createRateVersion } from '../../utils/rateVersionCrud'

export default defineEventHandler(createRateVersion)
