import { defineEventHandler } from 'h3'
import { deactivatePositionAssignment } from '../../utils/positionAssignmentCrud'
export default defineEventHandler(deactivatePositionAssignment)
