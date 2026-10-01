import {useEffect,useRef} from 'react';
import {Chart,BarController,BarElement,CategoryScale,LinearScale,Tooltip,Legend} from 'chart.js';
Chart.register(BarController,BarElement,CategoryScale,LinearScale,Tooltip,Legend);
export function BarChart({title,rows,horizontal=false}:{title:string;rows:[string,number][];horizontal?:boolean}){
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    if(!ref.current)return;
    const chart=new Chart(ref.current,{type:'bar',data:{labels:rows.map(r=>r[0]),datasets:[{label:'Count',data:rows.map(r=>r[1]),backgroundColor:'#257e73',borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,animation:false,indexAxis:horizontal?'y':'x',plugins:{legend:{display:false}},scales:{x:{...(horizontal?{beginAtZero:true,ticks:{precision:0}}:{ticks:{maxTicksLimit:12,maxRotation:45}})},y:{...(!horizontal?{beginAtZero:true,ticks:{precision:0}}:{})}}}});
    const before=()=>chart.resize(680,260),after=()=>chart.resize();window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);
    return ()=>{window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after);chart.destroy();};
  },[rows,horizontal]);
  return <section className="chart-panel"><h3>{title}</h3><div className="chart-canvas"><canvas ref={ref} role="img" aria-label={`${title}: ${rows.map(([k,v])=>`${k}: ${v}`).join('; ')}`}/></div><details className="no-print"><summary>View chart data</summary><div className="table-scroll"><table><thead><tr><th>Category / date</th><th>Count</th></tr></thead><tbody>{rows.map(([k,v])=><tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table></div></details></section>;
}
