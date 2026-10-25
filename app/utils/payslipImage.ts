import { payslipSiteNames, payslipPostedLabel } from '~~/shared/utils/payslipPresentation'

type Draw = {kind:'text';text:string;x:number;y:number;font:string;color:string;align:CanvasTextAlign}|{kind:'box';x:number;y:number;width:number;height:number;color:string}
const money=(value:unknown)=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value||0))
const date=(value:string)=>new Intl.DateTimeFormat('en-PH',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(new Date(value+'T00:00:00Z'))

// Render only the posted snapshot supplied by the portal. No DOM capture, remote
// image/font service, or upload is involved, so the entire payslip fits one PNG.
export function drawPayslipImage(canvas:HTMLCanvasElement,snapshot:any){
 const ctx=canvas.getContext('2d')
 if(!ctx)throw new Error('Image export is unavailable in this browser. Use Print / save PDF.')
 const pad=32,ink='#17365b',muted='#617794',blue='#2460db',line='#dce5f2',commands:Draw[]=[]
 const box=(x:number,top:number,w:number,h:number,color:string)=>commands.push({kind:'box',x,y:top,width:w,height:h,color})
 function text(value:unknown,x:number,top:number,size=23,weight=400,color=ink,align:CanvasTextAlign='left'){
  commands.push({kind:'text',text:String(value??''),x,y:top,font:`${weight} ${size}px Arial, sans-serif`,color,align})
 }
 function wrap(value:unknown,maxWidth:number,size=23,weight=400){
  ctx.font=`${weight} ${size}px Arial, sans-serif`
  const result:string[]=[],words=String(value??'').split(/\s+/).filter(Boolean)
  let current=''
  for(const word of words){
   if(ctx.measureText(current?current+' '+word:word).width<=maxWidth){current=current?current+' '+word:word;continue}
   if(current){result.push(current);current=''}
   for(const char of Array.from(word)){
    if(current&&ctx.measureText(current+char).width>maxWidth){result.push(current);current=''}
    current+=char
   }
  }
  if(current)result.push(current)
  return result.length?result:['—']
 }
 const {employee,cutoff}=snapshot
 const rows=cutoff.lines||[],earnings=rows.filter((row:any)=>['earnings','adjustment'].includes(row.section)).map((row:any)=>({...row,label:row.section==='adjustment'?row.label.replace(/^Adjustment · /,'Adjustment: '):row.label}))
 const government=rows.filter((row:any)=>row.section==='government'),other=rows.filter((row:any)=>row.section==='other')
 function paragraph(value:unknown,x:number,y:number,maxWidth:number,size=22,weight=400,color=ink){
  for(const row of wrap(value,maxWidth,size,weight)){text(row,x,y,size,weight,color);y+=size+8}
  return y
 }
 function layout(width:number){
  commands.length=0
  box(0,0,width,8,blue)
  text(`PAYSLIP · ${String(cutoff.status||'Approved').toUpperCase()}`,pad,32,19,700,blue)
  let left=paragraph(employee.AgencyName||'Payroll',pad,64,width*.6-pad*2,30,700)
  left=paragraph(`${employee.EmployeeName} · ${employee.EmployeeNumber||`EMP-${String(employee.EmployeeID).padStart(4,'0')}`}`,pad,left+4,width*.6-pad*2,21,400,muted)
  text('PAYROLL CUTOFF',width-pad,32,18,700,muted,'right')
  const dates=wrap(`${date(cutoff.periodStart)} – ${date(cutoff.periodEnd)}`,width*.4-pad*2,23,700)
  dates.forEach((value,index)=>text(value,width-pad,65+index*31,23,700,ink,'right'))
  let right=65+dates.length*31
  text(`${cutoff.assignmentType} · ${(cutoff.payrollIds||[]).length} payroll record(s)`,width-pad,right+5,19,400,muted,'right');right+=32
  const metaTop=Math.max(left,right)+24
  box(0,metaTop,width,1,line)
  const meta=[{label:'EMPLOYEE',value:employee.EmployeeName,x:pad,w:width*.4-pad*2},{label:'POSITION',value:employee.PositionName||'Employee',x:width*.4+pad,w:width*.25-pad*2},{label:'SITE IN THIS CUTOFF',value:payslipSiteNames(cutoff).join(' / ')||'Site not recorded',x:width*.65+pad,w:width*.35-pad*2}]
  const metaBottom=Math.max(...meta.map(item=>{text(item.label,item.x,metaTop+22,17,700,muted);return paragraph(item.value,item.x,metaTop+48,item.w,21,600)}))+22
  box(0,metaBottom,width,1,line)
  const columns=[{title:'Gross income',rows:earnings,totalLabel:'Total gross income',total:cutoff.gross,start:0,end:width*.4,hours:true},{title:'Government deductions',rows:government,totalLabel:'Government total',total:government.reduce((sum:number,row:any)=>sum+Number(row.amount),0),start:width*.4,end:width*.7,hours:false},{title:'Other deductions',rows:other,totalLabel:'Other total',total:other.reduce((sum:number,row:any)=>sum+Number(row.amount),0),start:width*.7,end:width,hours:false}]
  const bottoms=columns.map(column=>{
   const x=column.start+pad,end=column.end-pad,inner=end-x
   let y=paragraph(column.title.toUpperCase(),x,metaBottom+28,inner,22,700,blue)+20
   const amounts=[...column.rows.map((row:any)=>money(row.amount)),money(column.total)]
   ctx.font='600 22px Arial, sans-serif'
   const amountWidth=Math.max(136,...amounts.map(value=>ctx.measureText(value).width))+12
   const hoursX=end-amountWidth-18,labelWidth=inner-amountWidth-(column.hours?100:20)
   text(column.hours?'PAY ITEM':'ITEM',x,y,16,700,muted)
   if(column.hours)text('HOURS',hoursX,y,16,700,muted,'right')
   text('AMOUNT',end,y,16,700,muted,'right');y+=30
   box(x,y,inner,1,line);y+=15
   if(!column.rows.length)y=paragraph(column.hours?'No earning lines.':`No ${column.title.toLowerCase()}.`,x,y,inner,20,400,muted)+14
   for(const row of column.rows){
    const bottom=paragraph(row.label,x,y,labelWidth,21)
    if(column.hours)text(Number(row.hours)?Number(row.hours).toFixed(2):'—',hoursX,y,21,400,muted,'right')
    text(money(row.amount),end,y,22,600,ink,'right')
    y=bottom+10;box(x,y,inner,1,'#edf1f7');y+=14
   }
   return y
  })
  const totalTop=Math.max(metaBottom+220,...bottoms)+16
  columns.forEach(column=>{
   const x=column.start+pad,end=column.end-pad
   text(column.totalLabel,x,totalTop,21,700);text(money(column.total),end,totalTop,23,700,ink,'right')
   if(column.start)box(column.start,metaBottom,1,totalTop-metaBottom+58,line)
  })
  let y=totalTop+58
  box(0,y,width,88,'#eaf2ff');box(0,y,width,1,line)
  text('Total deductions',width*.48,y+32,21,600)
  text(money(cutoff.deductions),width*.71,y+30,25,700,ink,'right')
  text('Net pay',width*.76,y+32,22,700)
  text(money(cutoff.net),width-pad,y+25,34,700,blue,'right');y+=112
  if(cutoff.sources?.length){
   text('Payroll sources in this cutoff',pad,y,21,700);y+=38
   for(const source of cutoff.sources){
    const top=y
    y=paragraph(source.siteName||'Site not recorded',pad,y,width*.6-pad*2,21,600)
    if(source.clientName||source.batchId)y=paragraph(`${source.clientName||''}${source.batchId?` · DTR-${String(source.batchId).padStart(4,'0')}`:''}`,pad,y,width*.6-pad*2,18,400,muted)
    text(money(source.gross)+' gross',width*.8,top,20,400,ink,'right');text(money(source.net)+' net',width-pad,top,20,400,ink,'right')
    y+=12
   }
  }
  const note=['Personal copy · Keep your payslip private.',snapshot.postedAt?'Posted '+payslipPostedLabel(snapshot.postedAt):''].filter(Boolean).join('   |   ')
  y=paragraph(note,pad,y+8,width-pad*2,17,400,muted)
  return y+24
 }
 let width=1600,height=layout(width)
 // Keep even unusually long, fully itemized payslips landscape without clipping.
 if(height>width/1.45){width=Math.ceil(height*1.45);height=layout(width)}
 if(Math.max(width,height)>16000)throw new Error('This payslip is too large for one image. Use Print / save PDF instead.')
 const scale=Math.min(2,Math.sqrt(12000000/(width*height)),16000/Math.max(width,height))
 canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale)
 ctx.scale(scale,scale);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height)
 ctx.textBaseline='top'
 for(const command of commands){
  ctx.fillStyle=command.color
  if(command.kind==='box')ctx.fillRect(command.x,command.y,command.width,command.height)
  else{ctx.font=command.font;ctx.textAlign=command.align;ctx.fillText(command.text,command.x,command.y)}
 }
 return canvas
}

export async function createPayslipPng(snapshot:any){
 const canvas=drawPayslipImage(document.createElement('canvas'),snapshot)
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Unable to create the payslip image. Try Print / save PDF.')),'image/png'))
 const employee=String(snapshot.employee.EmployeeNumber||`EMP-${snapshot.employee.EmployeeID}`).replace(/[^a-z0-9_-]/gi,'-').slice(0,60)
 return{blob,fileName:`Payslip-${employee}-${snapshot.cutoff.periodStart}-${snapshot.cutoff.periodEnd}.png`}
}
