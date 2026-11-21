import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { authenticate } from '../src/lib/jellyfin.ts'
import { liveCall, channels, liveItems } from '../src/lib/liveTv.ts'

const memory = new Map()
globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v) }
const root = path.join(process.env.HOME, 'jellyfin-test/livetv')
await mkdir(root, { recursive: true })
const bridge = JSON.parse(execFileSync('docker', ['inspect', 'valvefin-jellyfin'], { encoding: 'utf8' }))[0].NetworkSettings.Networks.bridge.Gateway
const base = `http://${bridge}:8097`
const children = []
for (let i = 1; i <= 4; i++) {
  const dir = path.join(root, String(i)); await mkdir(dir, { recursive: true })
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`testsrc2=size=640x360:rate=25`,'-f','lavfi','-i',`sine=frequency=${300+i*100}:sample_rate=48000`,'-t','12','-c:v','libx264','-preset','ultrafast','-g','50','-pix_fmt','yuv420p','-c:a','aac',path.join(dir,'loop.mp4')])
  execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',path.join(dir,'loop.mp4'),'-frames:v','1',path.join(dir,'logo.png')])
  children.push(spawn('ffmpeg', ['-hide_banner','-loglevel','error','-re','-stream_loop','-1','-i',path.join(dir,'loop.mp4'),'-c','copy','-f','hls','-hls_time','2','-hls_list_size','8','-hls_flags','delete_segments+omit_endlist',path.join(dir,'index.m3u8')], { stdio: 'inherit' }))
}
const names = ['Valve Series', 'Valve Cinema', 'Valve Sports', 'Valve News']
await writeFile(path.join(root,'channels.m3u'), '#EXTM3U\n'+names.map((name,i)=>`#EXTINF:-1 tvg-id="valve${i+1}" tvg-chno="${i+1}" tvg-name="${name}" tvg-logo="${base}/${i+1}/logo.png",${name}\n${base}/${i+1}/index.m3u8`).join('\n'))
const stamp = ms => new Date(ms).toISOString().replace(/[-:T]/g,'').slice(0,14)+' +0000'
const begin = Math.floor(Date.now()/3600000)*3600000-3600000
let xml = '<?xml version="1.0" encoding="UTF-8"?><tv>'
for(let i=1;i<=4;i++) { xml+=`<channel id="valve${i}"><display-name>${names[i-1]}</display-name><icon src="${base}/${i}/logo.png"/></channel>`; for(let h=0;h<73;h++){const category=i===1?(h%3===2?'Kids':'Series'):['','', 'Movie','Sports','News'][i];xml+=`<programme channel="valve${i}" start="${stamp(begin+h*3600000)}" stop="${stamp(begin+(h+1)*3600000)}"><title>${category} Hour ${h}</title><desc>ValveFin local OTA guide fixture, channel ${i}.</desc><category>${category}</category>${i===1?`<episode-num system="xmltv_ns">0.${h}.</episode-num>`:''}${h%2===0?'<new/>':'<previously-shown/>'}</programme>`} }
await writeFile(path.join(root,'guide.xml'),xml+'</tv>')
const server = http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,base).pathname);if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return}const data=await readFile(file);res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type',file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':file.endsWith('.ts')?'video/mp2t':file.endsWith('.png')?'image/png':file.endsWith('.xml')?'application/xml':'text/plain');res.end(data)}catch{res.writeHead(404);res.end()}})
await new Promise(r=>server.listen(8097,bridge,r))
const s=await authenticate({serverUrl:'http://127.0.0.1:8096',username:'devin',password:'devin'})
const config=await liveCall(s,'/System/Configuration/livetv')
if(!config.TunerHosts?.some(t=>t.Url===base+'/channels.m3u')) await liveCall(s,'/LiveTv/TunerHosts','POST',{Type:'m3u',Url:base+'/channels.m3u',FriendlyName:'ValveFin OTA fixture',TunerCount:4,ImportFavoritesOnly:false,EnableTvgId:true})
if(!config.ListingProviders?.some(p=>p.Path===base+'/guide.xml')) await liveCall(s,'/LiveTv/ListingProviders','POST',{Type:'xmltv',Path:base+'/guide.xml',EnableAllTuners:true})
const tasks=await liveCall(s,'/ScheduledTasks');const task=tasks.find(t=>t.Key==='RefreshGuide')
if(!task)throw Error('RefreshGuide task unavailable')
await liveCall(s,`/ScheduledTasks/Running/${task.Id}`,'POST')
for(let n=0;n<180;n++){const cs=await channels(s);const ps=await liveItems(s,'/LiveTv/Programs',{HasAired:'false'});if(cs.length>=4&&ps.length>20){console.log(`PASS local M3U tuner: ${cs.length} channels, ${ps.length} future programs, 4 looping HTTP HLS streams, XMLTV for next 2 days`);break}await new Promise(r=>setTimeout(r,1000));if(n===179)throw Error('Guide refresh timed out')}
console.log('Live TV fixture HTTP server remains running on Docker bridge only')
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const child of children)child.kill();server.close(()=>process.exit())})
