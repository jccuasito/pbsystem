import { saveEmployeeSection } from '../../utils/employeeCrud'

export default defineEventHandler((event) => saveEmployeeSection(event, 'delete'))
