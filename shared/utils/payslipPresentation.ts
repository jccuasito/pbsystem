export function payslipSiteNames(cutoff:any):string[]{
  return [...new Set<string>([cutoff?.siteName,...(cutoff?.sources||[]).map((source:any)=>source.siteName)]
    .filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))]
}
export function payslipPostedLabel(value:unknown){
  if(!value)return ''
  const parsed=new Date(String(value))
  return Number.isNaN(parsed.getTime())?'':new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Singapore',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(parsed)
}
