import assert from 'node:assert/strict'
import { authenticate } from '../src/lib/jellyfin.ts'
import { airing, cancelRecording, channels, closeLive, liveCall, liveItems, openLive, programProgress, recordProgram, reportLive } from '../src/lib/liveTv.ts'

const memory = new Map()
globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v) }
globalThis.document = { createElement: () => ({ canPlayType: () => 'probably' }) }
assert.equal(airing({StartDate:'2020-01-01',EndDate:'2020-01-02'},Date.parse('2020-01-01T12:00:00Z')),true)
assert.equal(airing({}),false);assert.equal(programProgress({}),0)
assert.equal(programProgress({StartDate:'2020-01-01',EndDate:'2020-01-02'},Date.parse('2020-01-01T12:00:00Z')),50)
const s=await authenticate({serverUrl:'http://127.0.0.1:8096',username:'devin',password:'devin'})
const cs=await channels(s);assert.ok(cs.length>=4);assert.ok(cs.every(c=>c.CurrentProgram&&c.ImageTags?.Primary))
const on=await liveItems(s,'/LiveTv/Programs/Recommended',{IsAiring:'true'});assert.ok(on.some(p=>airing(p)))
for(const flag of ['IsSeries','IsMovie','IsSports','IsKids','IsNews'])assert.ok((await liveItems(s,'/LiveTv/Programs',{HasAired:'false',[flag]:'true'})).length,flag)
const guide=await liveItems(s,'/LiveTv/Programs',{ChannelIds:cs.map(c=>c.Id).join(','),MinStartDate:new Date(Date.now()-86400000).toISOString(),MaxStartDate:new Date(Date.now()+172800000).toISOString()});assert.ok(guide.length>192)
for(const type of ['Recordings','Timers','SeriesTimers'])assert.ok(Array.isArray(await liveItems(s,'/LiveTv/'+type)))
console.log(`PASS live API: ${cs.length} channels with logos/current programs, all six tabs, recommended On Now, five program filters, ${guide.length} guide entries over 2 days`)
const p=(await liveItems(s,'/LiveTv/Programs',{HasAired:'false',IsSeries:'true'})).find(p=>Date.parse(p.StartDate)>Date.now()+3600000)
const beforeTimers=await liveItems(s,'/LiveTv/Timers'),beforeSeries=await liveItems(s,'/LiveTv/SeriesTimers')
assert.ok(!beforeTimers.some(t=>t.ProgramId===p.Id),'fixture program must not already be scheduled')
try {
  await recordProgram(s,p,false)
  const timer=(await liveItems(s,'/LiveTv/Timers')).find(t=>t.ProgramId===p.Id);assert.ok(timer)
  await cancelRecording(s,timer.Id,false);assert.ok(!(await liveItems(s,'/LiveTv/Timers')).some(t=>t.Id===timer.Id))
  await recordProgram(s,p,true)
  const series=(await liveItems(s,'/LiveTv/SeriesTimers')).find(t=>!beforeSeries.some(b=>b.Id===t.Id));assert.ok(series)
  await cancelRecording(s,series.Id,true);assert.ok(!(await liveItems(s,'/LiveTv/SeriesTimers')).some(t=>t.Id===series.Id))
  console.log('PASS real DVR timer and series timer create/list/cancel')
} finally {
  for(const t of await liveItems(s,'/LiveTv/SeriesTimers'))if(!beforeSeries.some(b=>b.Id===t.Id))await cancelRecording(s,t.Id,true)
  for(const t of await liveItems(s,'/LiveTv/Timers'))if(!beforeTimers.some(b=>b.Id===t.Id))await cancelRecording(s,t.Id,false)
}
let live
try {
  live=await openLive(s,cs[0]);assert.ok(live.streamId);assert.ok(live.url.includes('LiveStreamId='))
  const r=await fetch(live.url);assert.equal(r.ok,true);assert.match(await r.text(),/#EXTM3U/)
  await reportLive(s,live,'start',0);await reportLive(s,live,'progress',1,true);await reportLive(s,live,'stop',1)
  console.log('PASS real AutoOpenLiveStream playback negotiation, live HLS playlist and session start/progress/stop with LiveStreamId')
} finally { if(live)await closeLive(s,live) }
const native=globalThis.fetch;const calls=[]
try{
  globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:init?.body&&JSON.parse(init.body)});const q=new URL(url).searchParams;const start=Number(q.get('StartIndex'));return Response.json({Items:Array.from({length:start<400?200:5},(_,i)=>({Id:String(start+i)}))})}
  assert.equal((await liveItems(s,'/LiveTv/Programs')).length,405)
  globalThis.fetch=async()=>Response.json({Items:[]});assert.deepEqual(await liveItems(s,'/LiveTv/Programs'),[])
  globalThis.fetch=async()=>new Response('Unavailable',{status:503});await assert.rejects(liveItems(s,'/LiveTv/Channels'))
  globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:init?.body&&JSON.parse(init.body)});return String(url).includes('/PlaybackInfo')?Response.json({PlaySessionId:'play',MediaSources:[{Id:'source',LiveStreamId:'opened-without-url'}]}):new Response(null,{status:204})}
  await assert.rejects(openLive(s,cs[0]),/did not provide/)
  assert.ok(calls.some(c=>c.url.includes('/LiveStreams/Close?LiveStreamId=opened-without-url')))
  assert.ok(calls.some(c=>c.body?.AutoOpenLiveStream===true&&c.body.EnableDirectPlay===false))
  console.log('PASS 405-item pagination without totals, empty/error responses, program boundaries/progress, unplayable live source closes opened tuner')
}finally{globalThis.fetch=native}
