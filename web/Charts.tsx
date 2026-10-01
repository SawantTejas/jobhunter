import {useEffect,useRef} from 'react';
import {Chart,BarController,BarElement,LineController,LineElement,PointElement,CategoryScale,LinearScale,Tooltip,Legend} from 'chart.js';
Chart.register(BarController,BarElement,LineController,LineElement,PointElement,CategoryScale,LinearScale,Tooltip,Legend);
export function BarChart({title,rows,horizontal=false,valueLabel="Count"}:{title:string;rows:[string,number][];horizontal?:boolean;valueLabel?:string}){
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    if(!ref.current)return;
    const chart=new Chart(ref.current,{type:'bar',data:{labels:rows.map(r=>r[0]),datasets:[{label:valueLabel,data:rows.map(r=>r[1]),backgroundColor:'#257e73',borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,animation:false,indexAxis:horizontal?'y':'x',plugins:{legend:{display:false}},scales:{x:{...(horizontal?{beginAtZero:true,ticks:{precision:0}}:{ticks:{maxTicksLimit:12,maxRotation:45}})},y:{...(!horizontal?{beginAtZero:true,ticks:{precision:0}}:{})}}}});
    const before=()=>chart.resize(680,260),after=()=>chart.resize();window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);
    return ()=>{window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after);chart.destroy();};
  },[rows,horizontal,valueLabel]);
  return <section className="chart-panel"><h3>{title}</h3><div className="chart-canvas"><canvas ref={ref} role="img" aria-label={`${title}: ${rows.map(([k,v])=>`${k}: ${v}`).join('; ')}`}/></div><details className="no-print"><summary>View chart data</summary><div className="table-scroll"><table><thead><tr><th>Category / date</th><th>{valueLabel}</th></tr></thead><tbody>{rows.map(([k,v])=><tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table></div></details></section>;
}
export function LineChart({title,labels,series}:{title:string;labels:string[];series:{name:string;values:number[]}[]}){
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{if(!ref.current)return;const chart=new Chart(ref.current,{type:'line',data:{labels,datasets:series.map((s,i)=>({label:s.name,data:s.values,borderColor:['#257e73','#8260b1'][i%2],backgroundColor:['#257e73','#8260b1'][i%2],pointRadius:labels.length>60?0:2,tension:0,fill:false}))},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:series.length>1}},scales:{x:{ticks:{maxTicksLimit:10,maxRotation:45}},y:{beginAtZero:true,ticks:{precision:0}}}}});const before=()=>chart.resize(680,260),after=()=>chart.resize();window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);return ()=>{window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after);chart.destroy();};},[labels,series]);
  return <section className="chart-panel"><h3>{title}</h3><div className="chart-canvas"><canvas ref={ref} role="img" aria-label={`${title}. ${labels.length} daily values. Data table follows.`}/></div><details className="no-print"><summary>View chart data</summary><div className="table-scroll"><table><thead><tr><th>Date</th>{series.map(s=><th key={s.name}>{s.name}</th>)}</tr></thead><tbody>{labels.map((day,i)=><tr key={day}><td>{day}</td>{series.map(s=><td key={s.name}>{s.values[i]}</td>)}</tr>)}</tbody></table></div></details></section>;
}
