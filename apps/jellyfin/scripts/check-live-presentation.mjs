import assert from 'node:assert/strict'
import { programPresentation, programRows } from '../src/lib/liveTvPresentation.ts'

const session={serverUrl:'https://example.test/jellyfin',userId:'user',accessToken:'test',deviceId:'device',serverId:'server',userName:'User'}
const channel={Id:'channel',Name:'Channel One',Type:'TvChannel',ImageTags:{Primary:'logo'}}
const p={Id:'program',Name:'Program',Type:'Program',ImageTags:{Primary:'poster'},BackdropImageTags:['backdrop'],ParentBackdropItemId:'parent',ParentBackdropImageTags:['parent-art']}
assert.deepEqual(programRows,['On Now','Shows','Movies','Sports','Kids','News'])
const a=programPresentation(session,p,channel)
assert.equal(a.name,'Channel One');assert.equal(a.images.length,4)
assert.match(a.images[0].url,/program\/Images\/Primary/);assert.match(a.images[1].url,/program\/Images\/Backdrop/)
assert.match(a.images[2].url,/parent\/Images\/Backdrop/);assert.match(a.images[3].url,/channel\/Images\/Primary/);assert.equal(a.images[3].contain,true)
assert.equal(programPresentation(session,{...p,ChannelName:' EPG channel '},channel).name,'EPG channel')
assert.match(programPresentation(session,{Id:'p',Type:'Program',Name:'P',ImageTags:{Thumb:'thumb'}},channel).images[0].url,/Images\/Thumb/)
assert.equal(programPresentation(session,{Id:'p',Type:'Program',Name:'P'},channel).images.length,1)
assert.deepEqual(programPresentation(session,{Id:'p',Type:'Program',Name:'P'}),{name:'',logo:null,images:[]})
assert.equal(programPresentation(session,{...p,ChannelName:' '},channel).name,'Channel One')
console.log('PASS Programs row order, channel labels, primary/thumb/backdrop/parent/channel artwork precedence and empty metadata')
