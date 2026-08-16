import { defineEventHandler } from 'h3'
import { createPositionAssignment } from '../../utils/positionAssignmentCrud'
export default defineEventHandler(createPositionAssignment)
