import { defineEventHandler } from 'h3'
import { listPositionAssignments } from '../../utils/positionAssignmentCrud'
export default defineEventHandler(listPositionAssignments)
