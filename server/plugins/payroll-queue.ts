import {payrollQueueEnabled} from '../utils/payrollJobStore'
import {runPayrollQueueTick,registerPayrollQueueStop} from '../utils/payrollQueue'

export default defineNitroPlugin(app=>{
  if(!payrollQueueEnabled()||process.env.PAYROLL_QUEUE_WORKER==='false')return
  let stopped=false,running:Promise<void>|null=null,lastWarning=0
  const tick=()=>{
    if(stopped||running)return
    running=runPayrollQueueTick().catch(()=>{
      if(Date.now()-lastWarning>60_000){console.warn('[payroll-queue] Worker unavailable; queued jobs remain stored. Check database/schema readiness.');lastWarning=Date.now()}
    }).finally(()=>{running=null})
  }
  const timer=setInterval(tick,2000);timer.unref?.();tick()
  const stop=async()=>{stopped=true;clearInterval(timer);await running}
  registerPayrollQueueStop(stop)
  app.hooks.hook('close',stop)
})
