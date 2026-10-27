export type ArchiveCutoff={start:string;end:string;key:string;label:string}
export function archiveCutoffs(year:number):ArchiveCutoff[]{
 if(!Number.isInteger(year)||year<1900||year>2100)return []
 const day=(value:string)=>new Date(value+'T00:00:00Z').toLocaleDateString('en-PH',{timeZone:'Asia/Singapore',month:'short',day:'numeric',year:'numeric'})
 const rows:ArchiveCutoff[]=[]
 for(let month=1;month<=12;month++){
  const prefix=year+'-'+String(month).padStart(2,'0')+'-',last=new Date(Date.UTC(year,month,0)).getUTCDate()
  for(const [first,end] of [[1,15],[16,last]]){const start=prefix+String(first).padStart(2,'0'),finish=prefix+end;rows.push({start,end:finish,key:start+':'+finish,label:day(start)+' - '+day(finish)})}
 }
 return rows.reverse()
}
